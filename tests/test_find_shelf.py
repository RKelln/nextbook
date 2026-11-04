"""Tests for T8.9c: matching an imported shelf at the library, one book at a time.

The opener is faked (the pattern in `test_fetch.py`), so nothing here touches
the network and no test ever really sleeps. Pages are built from the adapter's
own fixture, so the books are real catalogue records (AGENTS.md rule 6).

Every test writes in a temporary folder holding its own copy of data/slice.json;
the repo's data/ is never changed.
"""
import contextlib
import hashlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
REPO = TESTS.parent
TOOLS = REPO / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import find  # noqa: E402
from adapters.bibliocommons import fetch  # noqa: E402
from test_fetch import FakeClock, FakeNetwork  # noqa: E402

BRIEFS = json.loads((TESTS / "fixtures" / "tpl" / "briefs-le-guin.json").read_text(encoding="utf-8"))
ROBOTS = (TESTS / "fixtures" / "tpl" / "robots.txt").read_text(encoding="utf-8")
ROBOTS_URL = "https://tpl.bibliocommons.com/robots.txt"
TS = "2026-11-07T11:40:00Z"

BY_TITLE = {}
for _brief in BRIEFS:
    BY_TITLE.setdefault(_brief["title"], _brief)

AUTHOR = "Ursula K. Le Guin"
# One real record per title, so each query brings back a different book.
TITLES = ("The Dispossessed", "The Left Hand of Darkness", "The Lathe of Heaven",
          "The Tombs of Atuan", "The Farthest Shore")
QUERY = {title: find.query_words(title=title, author=AUTHOR) for title in TITLES}


def page_html(briefs) -> str:
    """A page shaped like the catalogue's: one JSON block, entities.bibs."""
    bibs = {}
    for index, brief in enumerate(briefs):
        bibs[brief.get("id") or f"anon-{index}"] = {"briefInfo": brief}
    payload = {"entities": {"bibs": bibs}}
    return ('<!doctype html><html><body><script type="application/json">'
            + json.dumps(payload) + "</script></body></html>")


def body(title) -> str:
    return page_html([BY_TITLE[title]])


def bodies_for(*titles) -> dict:
    return {fetch.search_url(QUERY[title], 1): body(title) for title in titles}


def body_for_all() -> dict:
    return bodies_for(*TITLES)


def entry(title, author=AUTHOR, **extra) -> dict:
    value = {"key": "t:" + find.norm_title(title) + "|" + author.casefold(),
             "title": title, "author": author, "state": "read", "rating": None}
    value.update(extra)
    return value


class ShelfNetwork(FakeNetwork):
    """Stands in for urlopen and remembers what the person had been told so far."""

    def __init__(self, bodies=None):
        super().__init__(bodies)
        self.stream: "io.StringIO | None" = None
        self.snapshots = []

    def __call__(self, request, timeout=None):
        self.snapshots.append(self.stream.getvalue() if self.stream is not None else "")
        return super().__call__(request, timeout)


class FailingNetwork:
    """Every request fails, the way a dead connection fails."""

    def __init__(self):
        self.urls = []

    def __call__(self, request, timeout=None):
        self.urls.append(request.full_url)
        raise OSError("network down")


def keys_anywhere(value):
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            found.append(key)
            found.extend(keys_anywhere(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(keys_anywhere(child))
    return found


class ShelfTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.data = root / "data"
        self.data.mkdir()
        shutil.copy(REPO / "data" / "slice.json", self.data / "slice.json")
        self.out = root / "app" / "data"
        self.cache = root / "cache"
        self.cache.mkdir()
        self.found_path = self.data / "found.json"
        self.shelf_path = root / "my-shelf.json"
        self.clock = FakeClock()

    # -- helpers -----------------------------------------------------------

    def write_shelf(self, entries, name="my-shelf.json") -> Path:
        path = Path(self.tmp.name) / name
        path.write_text(json.dumps({"schema": "nextbook/shelf-1",
                                    "exported": TS, "entries": entries}), encoding="utf-8")
        return path

    def go(self, entries, limit=None, bodies=None, robots_text: "str | None" = ROBOTS,
           opener=None, cache_dir=None):
        """Run one shelf against a fake network; returns what `from_shelf` returned."""
        self.write_shelf(entries)
        buffer = io.StringIO()
        net = opener or ShelfNetwork(bodies or {})
        net.stream = buffer
        fetcher = fetch.Fetcher(robots_text=robots_text, opener=net,
                                sleep=self.clock.sleep, clock=self.clock,
                                cache_dir=cache_dir or self.cache)
        with contextlib.redirect_stdout(buffer):
            result = find.from_shelf(
                self.shelf_path,
                limit=find.DEFAULT_LIMIT if limit is None else limit,
                data_dir=self.data, out_dir=self.out, getter=fetcher.get,
                cached=fetcher.is_cached, begin_search=fetcher.begin_search, now=TS)
        self.output = buffer.getvalue()
        self.net = net
        self.fetcher = fetcher
        return result

    def found(self):
        return json.loads(self.found_path.read_text(encoding="utf-8"))

    def main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = find.main(argv)
        return code, out.getvalue(), err.getvalue()


class ItSaysTheQueryFirst(ShelfTestCase):
    def test_the_query_is_printed_before_the_request(self):
        result = self.go([entry("The Dispossessed")], bodies=bodies_for("The Dispossessed"))
        self.assertEqual(result["searched"], 1)
        self.assertTrue(self.net.snapshots, "the fetcher was never called")
        self.assertIn('Searching 1 of 1: "The Dispossessed Ursula K. Le Guin"',
                      self.net.snapshots[0])
        self.assertNotIn("Searched 1,", self.net.snapshots[0],
                         "the closing line cannot be there before the first request")

    def test_the_address_is_one_search_page_on_the_configured_library(self):
        self.go([entry("The Dispossessed")], bodies=bodies_for("The Dispossessed"))
        url = self.net.urls[0]
        self.assertTrue(url.startswith(fetch.load_library()["host"] + "/v2/search?"))
        self.assertIn("page=1", url)
        self.assertEqual(self.net.requests[0].get_header("User-agent"), fetch.USER_AGENT)

    def test_the_counter_counts_the_books_of_this_run(self):
        self.go([entry(title) for title in TITLES], limit=2, bodies=body_for_all())
        self.assertIn('Searching 1 of 2:', self.output)
        self.assertIn('Searching 2 of 2:', self.output)
        self.assertNotIn("Searching 3 of 2", self.output)


class ItPacesLikeAPerson(ShelfTestCase):
    def test_five_seconds_between_requests_including_the_first(self):
        """Four searches is already more than one search's three-page budget."""
        bodies = dict(body_for_all())
        bodies[ROBOTS_URL] = ROBOTS
        result = self.go([entry(title) for title in TITLES], limit=4,
                         bodies=bodies, robots_text=None)
        self.assertEqual(result["searched"], 4)
        self.assertEqual(self.net.urls[0], ROBOTS_URL, "robots.txt is read once, first")
        self.assertEqual(len(self.net.urls), 5)
        self.assertEqual(self.clock.sleeps, [5.0, 5.0, 5.0, 5.0],
                         "every search, the first one included, waits five seconds")

    def test_a_cached_page_makes_no_request_and_waits_for_nothing(self):
        query = QUERY["The Dispossessed"]
        digest = hashlib.sha1(fetch.search_url(query, 1).encode("utf-8")).hexdigest()
        (self.cache / f"{digest}.html").write_text(body("The Dispossessed"), encoding="utf-8")

        result = self.go([entry("The Dispossessed")], bodies={})
        self.assertEqual(self.net.urls, [], "a cached page must not reach the network")
        self.assertEqual(self.clock.sleeps, [], "a cached page must not wait")
        self.assertIn("cached", self.output.lower())
        self.assertNotIn("Searching", self.output)
        self.assertEqual(result["searched"], 0)
        self.assertEqual(len(self.found()["works"]), 1,
                         "a cached page is still merged into found.json")

    def test_the_limit_makes_a_run_stop_and_says_what_is_left(self):
        result = self.go([entry(title) for title in TITLES], limit=2, bodies=body_for_all())
        self.assertEqual(len(self.net.urls), 2)
        self.assertEqual(result["left"], 3)
        self.assertIn("Searched 2, found 2, 0 had nothing, 3 to go. "
                      "Run it again for the next 2.", self.output)

    def test_a_second_run_skips_what_the_first_one_found(self):
        entries = [entry(title) for title in TITLES[:3]]
        first = self.go(entries, limit=1, bodies=body_for_all())
        self.assertEqual(first["searched"], 1)
        self.assertEqual(len(self.net.urls), 1)

        self.clock.sleeps.clear()
        second = self.go(entries, bodies=body_for_all())
        self.assertEqual(second["searched"], 2)
        self.assertEqual(len(self.net.urls), 2)
        self.assertNotIn(QUERY[TITLES[0]],
                         [request.full_url for request in self.net.requests])
        self.assertIn("Searching 1 of 2:", self.output)
        self.assertEqual(len(self.found()["works"]), 3)

    def test_a_book_with_a_record_is_never_searched_again(self):
        entries = [entry("The Dispossessed", id="S234C1129065"),
                   {"key": "w:dispossessed", "groupKey": "dispossessed_g",
                    "title": "The Left Hand of Darkness", "author": AUTHOR,
                    "state": "read", "rating": None}]
        result = self.go(entries, bodies={})
        self.assertEqual(self.net.urls, [])
        self.assertNotIn("Searching", self.output)
        self.assertIn("Nothing to search", self.output)
        self.assertFalse(result["ok"])

    def test_an_entry_with_no_title_is_named_and_skipped(self):
        entries = [{"key": "t:nothing|", "title": "  ", "author": "",
                    "state": "want", "rating": None},
                   entry("The Dispossessed")]
        result = self.go(entries, bodies=bodies_for("The Dispossessed"))
        self.assertEqual(result["searched"], 1)
        self.assertIn('Skipping "t:nothing|": it has no title to search for.', self.output)
        self.assertLess(self.output.index("Skipping"), self.output.index("Searching 1 of 1"))


class ItWritesWhatItFound(ShelfTestCase):
    def test_the_works_are_written_with_the_words_that_found_them(self):
        self.go([entry("The Dispossessed"), entry("The Left Hand of Darkness")],
                bodies=bodies_for("The Dispossessed", "The Left Hand of Darkness"))
        doc = self.found()
        self.assertEqual(doc["schema"], "nextbook/found-1")
        self.assertEqual(len(doc["works"]), 2)
        for work in doc["works"]:
            self.assertEqual(set(work["found"]), {"query"})
            self.assertTrue(work["id"])
            self.assertTrue(work["groupKey"])
        queries = {work["found"]["query"] for work in doc["works"]}
        self.assertEqual(queries, {QUERY["The Dispossessed"],
                                   QUERY["The Left Hand of Darkness"]})
        self.assertEqual(len(doc["searches"]), 2)
        self.assertEqual(doc["searches"][0]["fetched"], TS)

    def test_the_page_gets_its_safe_found_file(self):
        self.go([entry("The Dispossessed")], bodies=bodies_for("The Dispossessed"))
        generated = self.out / "found.js"
        self.assertTrue(generated.is_file())
        text = generated.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("Nextbook.data.put('found', {"))
        self.assertNotIn("<", text)
        body_text = text[len("Nextbook.data.put('found', "):-3]
        self.assertEqual(len(json.loads(body_text)["works"]), 1)

    def test_no_blurb_cover_or_rating_is_written(self):
        self.go([entry("The Dispossessed")], bodies=bodies_for("The Dispossessed"))
        text = self.found_path.read_text(encoding="utf-8")
        for key in find.FORBIDDEN_FIELDS:
            self.assertNotIn(key, text)
        for key in keys_anywhere(self.found()):
            self.assertNotIn(key, find.FORBIDDEN_FIELDS)

    def test_every_search_failing_writes_nothing(self):
        net = FailingNetwork()
        result = self.go([entry("The Dispossessed"), entry("The Left Hand of Darkness")],
                         opener=net)
        self.assertEqual(len(net.urls), 2)
        self.assertEqual(result["searched"], 2)
        self.assertEqual(result["found"], 0)
        self.assertEqual(result["nothing"], 2)
        self.assertFalse(result["ok"])
        self.assertFalse(self.found_path.exists())
        self.assertFalse((self.out / "found.js").exists())
        self.assertIn("Could not reach the library", self.output)
        self.assertIn("Searched 2, found 0, 2 had nothing, 0 to go.", self.output)


class TheShelfFile(ShelfTestCase):
    def test_a_file_that_is_not_json_is_one_sentence_and_exit_2(self):
        self.shelf_path.write_text("{not json", encoding="utf-8")
        code, out, err = self.main(["--from-shelf", str(self.shelf_path),
                                    "--data-dir", str(self.data),
                                    "--out-dir", str(self.out)])
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        lines = [line for line in err.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, err)
        self.assertIn("not JSON", lines[0])
        self.assertNotIn("Traceback", err)
        self.assertFalse(self.found_path.exists())

    def test_a_file_with_no_entries_list_is_one_sentence_and_exit_2(self):
        self.shelf_path.write_text(json.dumps({"schema": "nextbook/shelf-1"}),
                                   encoding="utf-8")
        code, out, err = self.main(["--from-shelf", str(self.shelf_path),
                                    "--data-dir", str(self.data),
                                    "--out-dir", str(self.out)])
        self.assertEqual(code, 2)
        lines = [line for line in err.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, err)
        self.assertIn("no list of books", lines[0])
        self.assertNotIn("Traceback", err)

    def test_a_shelf_whose_books_all_have_records_runs_nothing_and_exits_1(self):
        self.write_shelf([entry("The Dispossessed", id="S234C1129065")])
        code, out, err = self.main(["--from-shelf", str(self.shelf_path),
                                    "--data-dir", str(self.data),
                                    "--out-dir", str(self.out)])
        self.assertEqual(code, 1)
        self.assertIn("Nothing to search", out)
        self.assertEqual(err, "")

    def test_a_limit_below_one_is_refused(self):
        self.write_shelf([entry("The Dispossessed")])
        code, out, err = self.main(["--from-shelf", str(self.shelf_path), "--limit", "0",
                                    "--data-dir", str(self.data),
                                    "--out-dir", str(self.out)])
        self.assertEqual(code, 2)
        self.assertIn("--limit must be 1 or more", err)

    def test_from_shelf_refuses_the_single_search_flags(self):
        self.write_shelf([entry("The Dispossessed")])
        for flag, extra in (("--words", ["birds"]), ("--title", ["x"]),
                            ("--author", ["y"]), ("--pages", ["2"])):
            with self.subTest(flag=flag):
                err = io.StringIO()
                with contextlib.redirect_stderr(err):
                    with self.assertRaises(SystemExit) as raised:
                        find.main(["--from-shelf", str(self.shelf_path), *extra])
                self.assertEqual(raised.exception.code, 2)
                self.assertIn(flag, err.getvalue())

    def test_clear_still_works(self):
        self.go([entry("The Dispossessed")], bodies=bodies_for("The Dispossessed"))
        code, out, err = self.main(["--clear", "--data-dir", str(self.data),
                                    "--out-dir", str(self.out)])
        self.assertEqual(code, 0, err)
        self.assertEqual(self.found()["works"], [])


if __name__ == "__main__":
    unittest.main()
