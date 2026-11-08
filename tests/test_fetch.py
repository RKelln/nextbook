"""Tests for the polite fetcher. No network, no real sleeping."""
import hashlib
import ssl
import tempfile
import unittest
import urllib.error
from unittest import mock
from pathlib import Path

from adapters.bibliocommons import fetch

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "tpl"
ROBOTS = (FIXTURES / "robots.txt").read_text(encoding="utf-8")
SEARCH = "https://tpl.bibliocommons.com/v2/search?searchType=keyword&query=le+guin&page=1"


class FakeResponse:
    def __init__(self, body):
        self.body = body.encode("utf-8")
        self.closed = False

    def read(self):
        return self.body

    def close(self):
        self.closed = True


class FakeNetwork:
    """Stands in for urlopen and records every request it was given."""

    def __init__(self, bodies=None):
        self.requests = []
        self.bodies = bodies or {}

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        return FakeResponse(self.bodies.get(request.full_url, "<html>page</html>"))

    @property
    def urls(self):
        return [r.full_url for r in self.requests]


class FakeClock:
    """A clock and a sleep that moves it, so pacing can be asserted."""

    def __init__(self):
        self.now = 1000.0
        self.sleeps = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class FetcherHarness(unittest.TestCase):
    """A fetcher wired to a fake network, a fake clock and a scratch cache."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.net = FakeNetwork()
        self.clock = FakeClock()

    def make(self, **kwargs):
        kwargs.setdefault("robots_text", ROBOTS)
        kwargs.setdefault("opener", self.net)
        kwargs.setdefault("sleep", self.clock.sleep)
        kwargs.setdefault("clock", self.clock)
        kwargs.setdefault("cache_dir", self.tmp.name)
        return fetch.Fetcher(**kwargs)


class FetcherTest(FetcherHarness):
    def test_a_disallowed_path_raises(self):
        fetcher = self.make()
        with self.assertRaises(fetch.DisallowedPath):
            fetcher.get("https://tpl.bibliocommons.com/item/read_alike_list/123", "on-demand")
        self.assertEqual(self.net.urls, [])

    def test_a_record_path_raises(self):
        fetcher = self.make()
        with self.assertRaises(fetch.DisallowedPath):
            fetcher.get("https://tpl.bibliocommons.com/v2/record/S234C4805630", "on-demand")
        self.assertEqual(self.net.urls, [])

    def test_another_host_raises(self):
        fetcher = self.make()
        with self.assertRaises(fetch.DisallowedPath):
            fetcher.get("https://example.invalid/v2/search?query=le+guin", "on-demand")
        self.assertEqual(self.net.urls, [])

    def test_a_traversal_out_of_the_search_path_raises(self):
        fetcher = self.make()
        for url in (
            # a literal climb out
            "https://tpl.bibliocommons.com/v2/search/../../item/full_record/S234C1",
            # the percent-encoded spelling of the same climb
            "https://tpl.bibliocommons.com/v2/search/%2e%2e/%2e%2e/item/full_record/S234C1",
            # backslashes, encoded, which a server may read as separators
            "https://tpl.bibliocommons.com/v2/search/..%5c..%5citem%5cfull_record%5cS234C1",
            # the same climb in upper-case hex
            "https://tpl.bibliocommons.com/v2/search/%2E%2E/%2E%2E/item/full_record/S234C1",
        ):
            with self.subTest(url=url):
                with self.assertRaises(fetch.DisallowedPath):
                    fetcher.get(url, "on-demand")
        self.assertEqual(self.net.urls, [], "a traversal must not reach the network")

    def test_a_decoded_control_character_raises(self):
        fetcher = self.make()
        with self.assertRaises(fetch.DisallowedPath):
            fetcher.get("https://tpl.bibliocommons.com/v2/search/%00/x", "on-demand")
        self.assertEqual(self.net.urls, [])

    def test_a_plain_search_path_still_fetches(self):
        fetcher = self.make()
        url = "https://tpl.bibliocommons.com/v2/search?searchType=keyword&query=x"
        fetcher.get(url, "on-demand")
        self.assertEqual(self.net.urls, [url])

    def test_a_dot_segment_is_normalised_away_not_refused(self):
        fetcher = self.make()
        fetcher.get("https://tpl.bibliocommons.com/v2/search/./?searchType=keyword&query=x",
                    "on-demand")
        self.assertEqual(self.net.urls,
                         ["https://tpl.bibliocommons.com/v2/search?searchType=keyword&query=x"])

    def test_robots_rules_are_enforced_inside_get(self):
        robots = "User-agent: *\nCrawl-delay: 120\nDisallow: /v2/search/private\n"
        fetcher = self.make(robots_text=robots)
        with self.assertRaises(fetch.DisallowedPath):
            fetcher.get("https://tpl.bibliocommons.com/v2/search/private/x", "on-demand")
        self.assertEqual(self.net.urls, [], "a robots.txt disallow must not reach the network")
        fetcher.get(SEARCH, "on-demand")
        self.assertEqual(len(self.net.urls), 1)

    def test_a_query_wildcard_stops_a_fetch_before_the_network(self):
        fetcher = self.make(robots_text="User-agent: *\nDisallow: /*?\n")
        with self.assertRaises(fetch.DisallowedPath):
            fetcher.get(SEARCH, "on-demand")
        self.assertEqual(self.net.urls, [])

    def test_two_uncached_batch_gets_wait_the_delay(self):
        fetcher = self.make()
        fetcher.get(fetch.search_url("le guin", 1), "batch")
        fetcher.get(fetch.search_url("le guin", 2), "batch")
        self.assertEqual(self.clock.sleeps, [120.0])
        self.assertEqual(len(self.net.urls), 2)

    def test_on_demand_waits_five_seconds_and_refuses_a_fourth_page(self):
        fetcher = self.make()
        for page in (1, 2, 3):
            fetcher.get(fetch.search_url("le guin", page), "on-demand")
        self.assertEqual(self.clock.sleeps, [5.0, 5.0])
        with self.assertRaises(fetch.TooManyPages):
            fetcher.get(fetch.search_url("le guin", 4), "on-demand")
        self.assertEqual(len(self.net.urls), 3)

    def test_a_cached_get_makes_no_call_and_does_not_wait(self):
        fetcher = self.make()
        body = fetcher.get(SEARCH, "on-demand")
        again = fetcher.get(SEARCH, "on-demand")
        self.assertEqual(body, again)
        self.assertEqual(len(self.net.urls), 1)
        self.assertEqual(self.clock.sleeps, [])
        self.assertEqual(len(list(Path(self.tmp.name).glob("*.html"))), 1)

    def test_a_cached_body_needs_no_network_at_all(self):
        def boom(*args, **kwargs):
            raise AssertionError("a cache hit must not open the network")
        fetcher = self.make(opener=boom, robots_text=None)
        digest = hashlib.sha1(SEARCH.encode("utf-8")).hexdigest()
        (Path(self.tmp.name) / f"{digest}.html").write_text("cached body", encoding="utf-8")
        self.assertEqual(fetcher.get(SEARCH, "on-demand"), "cached body")

    def test_the_user_agent_and_cache_name(self):
        fetcher = self.make()
        fetcher.get(SEARCH, "on-demand")
        self.assertEqual(self.net.requests[0].get_header("User-agent"), fetch.USER_AGENT)
        name = Path(self.tmp.name).glob("*.html")
        digest = next(name).stem
        self.assertRegex(digest, r"^[0-9a-f]{40}$")

    def test_batch_uses_the_crawl_delay_when_it_is_longer(self):
        robots = ROBOTS.replace("Crawl-delay: 120", "Crawl-delay: 90")
        # 90 is below the floor, so the floor still wins.
        fetcher = self.make(robots_text=robots)
        fetcher.get(fetch.search_url("le guin", 1), "batch")
        fetcher.get(fetch.search_url("le guin", 2), "batch")
        self.assertEqual(self.clock.sleeps, [120.0])

    def test_a_batch_then_on_demand_pair_waits_the_crawl_delay(self):
        fetcher = self.make()
        fetcher.get(fetch.search_url("le guin", 1), "batch")
        fetcher.get(fetch.search_url("le guin", 2), "on-demand")
        self.assertEqual(self.clock.sleeps, [120.0])

    def test_an_on_demand_then_batch_pair_waits_the_crawl_delay(self):
        fetcher = self.make()
        fetcher.get(fetch.search_url("le guin", 1), "on-demand")
        fetcher.get(fetch.search_url("le guin", 2), "batch")
        self.assertEqual(self.clock.sleeps, [120.0])

    def test_a_raised_crawl_delay_is_refused(self):
        robots = ROBOTS.replace("Crawl-delay: 120", "Crawl-delay: 600")
        fetcher = self.make(robots_text=robots)
        with self.assertRaises(fetch.RobotsRefused):
            fetcher.get(SEARCH, "on-demand")
        self.assertEqual(self.net.urls, [])

    def test_robots_is_read_once_through_the_opener(self):
        net = FakeNetwork({"https://tpl.bibliocommons.com/robots.txt": ROBOTS})
        fetcher = self.make(opener=net, robots_text=None)
        fetcher.get(SEARCH, "on-demand")
        fetcher.get(fetch.search_url("le guin", 2), "on-demand")
        self.assertEqual(net.urls.count("https://tpl.bibliocommons.com/robots.txt"), 1)

    def test_the_robots_read_is_paced_and_counted(self):
        net = FakeNetwork({"https://tpl.bibliocommons.com/robots.txt": ROBOTS})
        fetcher = self.make(opener=net, robots_text=None)
        fetcher.get(SEARCH, "on-demand")
        # robots.txt goes first with no wait; the search after it waits its delay.
        self.assertEqual(net.urls[0], "https://tpl.bibliocommons.com/robots.txt")
        self.assertEqual(self.clock.sleeps, [5.0])
        fetcher.get(fetch.search_url("le guin", 2), "on-demand")
        self.assertEqual(net.urls.count("https://tpl.bibliocommons.com/robots.txt"), 1)
        self.assertEqual(self.clock.sleeps, [5.0, 5.0])


class RobotsParserTest(unittest.TestCase):
    def test_the_real_robots_txt_is_understood(self):
        robots = fetch.parse_robots(ROBOTS)
        self.assertEqual(robots.crawl_delay, 120.0)
        self.assertTrue(robots.allowed("/v2/search"))
        self.assertTrue(robots.allowed("/v2/browse/titles/new"))
        self.assertFalse(robots.allowed("/item/read_alike_list/S234C"))
        self.assertFalse(robots.allowed("/v2/availability/123"))
        self.assertFalse(robots.allowed("/item/full_record/1"))

    def test_the_real_robots_txt_allows_a_search_with_its_query(self):
        robots = fetch.parse_robots(ROBOTS)
        self.assertTrue(robots.allowed("/v2/search?searchType=keyword&query=le%20guin"))
        self.assertTrue(robots.allowed("/v2/browse/titles/new?page=1"))
        self.assertFalse(robots.allowed("/v2/availability/123?library=TPL"))

    def test_a_rule_is_a_prefix_so_the_child_is_blocked_and_the_parent_is_not(self):
        robots = fetch.parse_robots("User-agent: *\nDisallow: /v2/search/private\n")
        self.assertTrue(robots.allowed("/v2/search"))
        self.assertFalse(robots.allowed("/v2/search/private"))
        self.assertFalse(robots.allowed("/v2/search/private/x"))

    def test_a_star_matches_any_run_of_characters(self):
        robots = fetch.parse_robots("User-agent: *\nDisallow: /item/*/full_record\n")
        self.assertFalse(robots.allowed("/item/S234C1/full_record"))
        self.assertFalse(robots.allowed("/item/S234C1/full_record/extra"))
        self.assertTrue(robots.allowed("/item/S234C1/brief"))

    def test_a_trailing_dollar_anchors_the_end(self):
        robots = fetch.parse_robots("User-agent: *\nDisallow: /v2/search$\n")
        self.assertFalse(robots.allowed("/v2/search"))
        self.assertTrue(robots.allowed("/v2/search?searchType=keyword"))

    def test_a_query_wildcard_rule_disallows_the_whole_search(self):
        # `Disallow: /*?` means "any address with a query string" — every request
        # this adapter makes. The old reader split on "?" and turned the rule
        # into the empty prefix, allowing all.
        robots = fetch.parse_robots("User-agent: *\nDisallow: /*?\n")
        self.assertFalse(robots.allowed("/v2/search?searchType=keyword&query=x"))
        self.assertFalse(robots.allowed("/v2/browse/titles/new?page=1"))

    def test_a_question_mark_is_a_literal_not_a_wildcard(self):
        robots = fetch.parse_robots("User-agent: *\nDisallow: /v2/search?x\n")
        self.assertFalse(robots.allowed("/v2/search?x"))
        self.assertTrue(robots.allowed("/v2/search"))
        self.assertTrue(robots.allowed("/v2/search?y"))

    def test_our_own_group_wins_over_the_wildcard(self):
        text = ("User-agent: *\nDisallow: /\n\n"
                "User-agent: nextbook\nCrawl-delay: 10\nDisallow: /secret\nAllow: /\n")
        robots = fetch.parse_robots(text)
        self.assertEqual(robots.crawl_delay, 10.0)
        self.assertTrue(robots.allowed("/v2/search"))
        self.assertFalse(robots.allowed("/secret/x"))

    def test_a_tie_goes_to_allow(self):
        robots = fetch.parse_robots("User-agent: *\nDisallow: /v2\nAllow: /v2\n")
        self.assertTrue(robots.allowed("/v2/search"))

    def test_an_empty_disallow_does_not_block(self):
        robots = fetch.parse_robots("User-agent: *\nDisallow:\n")
        self.assertTrue(robots.allowed("/v2/search"))


class EventsGatewayTest(FetcherHarness):
    """The only route to the events feed: the gateway host and its one path.

    The catalogue tests above never touch the gateway, so without these a
    regression that refuses the feed — or that lets the gateway fetch anything
    else — would leave the whole suite green and break the only way the events
    snapshot is made.
    """

    def setUp(self):
        super().setUp()
        self.events = fetch.events_url("CL", "2026-11-03", "2026-11-24")
        self.gateway = fetch.GATEWAY_HOST

    def test_the_events_url_is_allowed_and_fetched(self):
        fetcher = self.make()
        body = fetcher.get(self.events, "batch")
        self.assertEqual(len(self.net.urls), 1)
        self.assertEqual(self.net.urls[0], self.events)
        self.assertTrue(self.net.urls[0].startswith(
            self.gateway + "/v2/libraries/tpl/rss/events?"))
        self.assertIn("locations=CL", self.net.urls[0])
        self.assertIn("startDate=2026-11-03", self.net.urls[0])
        self.assertIn("page=1", self.net.urls[0])
        self.assertEqual(body, "<html>page</html>")

    def test_the_gateway_robots_txt_is_not_read(self):
        fetcher = self.make(robots_text=None)  # a read would go to the opener
        fetcher.get(self.events, "batch")
        self.assertEqual([url for url in self.net.urls if url.endswith("/robots.txt")], [],
                         "the gateway answers 404 for robots.txt; reading it is one wasted request")

    def assert_the_feed_still_works(self):
        """The refusal was about the path, not a gateway that got shut off.

        Without this, a fetcher that refuses everything on the gateway would
        satisfy every refusal test here, and the feed route could be broken in
        silence — the very regression these tests exist for.
        """
        fetcher = self.make()
        fetcher.get(self.events, "batch")
        self.assertEqual(self.net.urls[-1], self.events)

    def test_a_made_up_gateway_path_is_refused(self):
        fetcher = self.make()
        for path in ("/v2/libraries/tpl/rss/blog",
                     "/v2/libraries/tpl/rss/events/extra/page",
                     "/item/full_record/S234C1"):
            with self.subTest(path=path):
                with self.assertRaises(fetch.DisallowedPath):
                    fetcher.get(self.gateway + path, "batch")
        self.assertEqual(self.net.urls, [], "an unlisted gateway path must not reach the network")
        self.assert_the_feed_still_works()

    def test_another_librarys_events_path_is_refused(self):
        fetcher = self.make()
        url = self.events.replace("/libraries/tpl/", "/libraries/nypl/")
        self.assertNotEqual(url, self.events)
        with self.assertRaises(fetch.DisallowedPath):
            fetcher.get(url, "batch")
        self.assertEqual(self.net.urls, [])
        self.assert_the_feed_still_works()

    def test_the_search_path_on_the_gateway_is_refused(self):
        fetcher = self.make()
        with self.assertRaises(fetch.DisallowedPath):
            fetcher.get(self.gateway + "/v2/search?searchType=keyword&query=le+guin",
                        "batch")
        self.assertEqual(self.net.urls, [])
        self.assert_the_feed_still_works()

    def test_the_events_path_on_the_library_host_is_refused(self):
        fetcher = self.make()
        url = self.events.replace(self.gateway, "https://tpl.bibliocommons.com")
        self.assertTrue(url.startswith("https://tpl.bibliocommons.com/"))
        with self.assertRaises(fetch.DisallowedPath):
            fetcher.get(url, "batch")
        self.assertEqual(self.net.urls, [])
        self.assert_the_feed_still_works()

    def test_a_gateway_page_two_waits_the_crawl_delay(self):
        fetcher = self.make()
        fetcher.get(fetch.events_url("CL", "2026-11-03", "2026-11-24", 1), "batch")
        fetcher.get(fetch.events_url("CL", "2026-11-03", "2026-11-24", 2), "batch")
        self.assertEqual(self.clock.sleeps, [fetch.BATCH_FLOOR],
                         "the gateway serves no robots.txt, so the batch delay paces it")
        self.assertEqual(len(self.net.urls), 2)
        self.assertIn("page=2", self.net.urls[1])


class LibraryTest(unittest.TestCase):
    def test_the_host_comes_from_the_library_file(self):
        library = fetch.load_library("tpl")
        self.assertEqual(library["subdomain"], "tpl")
        self.assertEqual(library["name"], "Toronto Public Library")
        self.assertEqual(library["host"], "https://tpl.bibliocommons.com")
        self.assertTrue(fetch.search_url("le guin", 2).startswith(library["host"] + "/v2/search"))
        self.assertEqual(fetch.search_url("le guin", 2).count("page=2"), 1)


class CertFallbackTest(unittest.TestCase):
    """Python without root certificates (python.org macOS) falls back to the system file."""

    def _cert_error(self):
        return urllib.error.URLError(ssl.SSLCertVerificationError("unable to get local issuer certificate"))

    def test_retries_with_a_verifying_system_context_after_a_cert_failure(self):
        calls = []

        def fake_urlopen(request, timeout=None, context=None):
            calls.append(context)
            if context is None:
                raise self._cert_error()
            return "ok"

        sentinel = object()
        with mock.patch.object(fetch.urllib.request, "urlopen", fake_urlopen), \
                mock.patch.object(fetch, "_fallback_contexts", lambda: iter([sentinel])):
            self.assertEqual(fetch._default_open("req"), "ok")
        self.assertEqual(calls, [None, sentinel])

    def test_other_errors_are_not_retried(self):
        calls = []

        def fake_urlopen(request, timeout=None, context=None):
            calls.append(context)
            raise urllib.error.URLError("timed out")

        with mock.patch.object(fetch.urllib.request, "urlopen", fake_urlopen), \
                mock.patch.object(fetch, "_fallback_contexts", lambda: iter([object()])):
            with self.assertRaises(urllib.error.URLError):
                fetch._default_open("req")
        self.assertEqual(calls, [None])

    def test_still_fails_when_no_system_bundle_helps(self):
        def fake_urlopen(request, timeout=None, context=None):
            raise self._cert_error()

        with mock.patch.object(fetch.urllib.request, "urlopen", fake_urlopen), \
                mock.patch.object(fetch, "_fallback_contexts", lambda: iter([])):
            with self.assertRaises(urllib.error.URLError):
                fetch._default_open("req")


if __name__ == "__main__":
    unittest.main()
