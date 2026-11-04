"""Tests for the events snapshot. Two saved feed pages, no network.

`events-page.xml` is one real page of `gateway.bibliocommons.com/v2/libraries/
tpl/rss/events?locations=CL&...`, read once through `fetch.Fetcher` on
2026-11-03 and saved as it came. `events-edge.xml` is three items of that same
page, rearranged: one cancelled, one virtual with no location, one given a long
tag-laden summary. The shapes are the feed's own; no event was invented.

The zone tests run the same feed under two different `TZ` values: a snapshot
must not depend on where the machine running it thinks it is.
"""
import datetime as dt
import io
import json
import os
import re
import tempfile
import time
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from adapters.bibliocommons import events, fetch

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "tpl"
PAGE = (FIXTURES / "events-page.xml").read_text(encoding="utf-8")
EDGE = (FIXTURES / "events-edge.xml").read_text(encoding="utf-8")

EVENT_KEYS = ["id", "title", "start", "end", "branch", "virtual", "categories",
              "summary", "url"]
SNAPSHOT_KEYS = {"fetched", "branch", "window", "source", "events"}


class StubFetcher:
    """Stands in for `fetch.Fetcher`: no network, and it says how it was asked."""

    def __init__(self, pages):
        self.pages = list(pages)
        self.calls = []

    def get(self, url, kind="on-demand"):
        self.calls.append((url, kind))
        index = len(self.calls) - 1
        return self.pages[index] if index < len(self.pages) else ""


def with_offset(page, value="2026-11-03T23:00:00Z"):
    """The saved page with its first `start_date_local` made offset-bearing.

    The real feed sends `*_date_local` as the branch's wall clock; some of its
    values carry an offset too, and those are the ones the zone rule is about.
    """
    pattern = re.compile(r"<bc:start_date_local>[^<]*</bc:start_date_local>")
    return pattern.sub(f"<bc:start_date_local>{value}</bc:start_date_local>", page, count=1)


def keys_anywhere(value):
    """Every dictionary key in a JSON-shaped value, at any depth."""
    found = set()
    if isinstance(value, dict):
        for key, child in value.items():
            found.add(key)
            found |= keys_anywhere(child)
    elif isinstance(value, list):
        for child in value:
            found |= keys_anywhere(child)
    return found


class ZoneTest(unittest.TestCase):
    """A test that can make the runner believe it is in a chosen zone."""

    def setUp(self):
        self._saved_zone = os.environ.get("TZ")
        self.addCleanup(self._restore_zone)

    def _restore_zone(self):
        if self._saved_zone is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = self._saved_zone
        time.tzset()

    def under(self, zone):
        """Make the runner believe it is in `zone` (as the reviewer did)."""
        os.environ["TZ"] = zone
        time.tzset()


class ParseTest(unittest.TestCase):
    def test_the_saved_page_is_the_librarys_feed(self):
        records = events.parse_page(PAGE)
        self.assertEqual(len(records), 25)
        self.assertEqual({r["branch_code"] for r in records}, {"CL"})
        self.assertEqual({r["branch"] for r in records}, {"North York Central Library"})
        self.assertTrue(all(r["url"].startswith("https://tpl.bibliocommons.com/events/")
                            for r in records))

    def test_dates_keep_the_wall_clock_the_feed_calls_local(self):
        # The feed sends the same moment twice: the UTC field and the local one.
        self.assertIn("<bc:start_date>2026-11-03T23:00:00Z</bc:start_date>", PAGE)
        self.assertIn("<bc:start_date_local>2026-11-03T18:00</bc:start_date_local>", PAGE)
        first = events.build_events(events.parse_page(PAGE), "CL")[0]
        self.assertEqual(first["start"], "2026-11-03T18:00:00",
                         "a naive local value must not be shifted")
        self.assertEqual(first["end"], "2026-11-03T20:00:00")

    def test_an_offset_is_moved_to_the_librarys_zone_not_this_machines(self):
        aware = events.parse_local("2026-11-03T23:00:00Z")
        self.assertEqual(aware.astimezone(dt.timezone.utc),
                         dt.datetime(2026, 11, 3, 23, tzinfo=dt.timezone.utc))
        written = events.local_iso(aware)
        self.assertEqual(written, "2026-11-03T18:00:00-05:00",
                         "a Toronto event must be written on Toronto's clock")
        self.assertEqual(dt.datetime.fromisoformat(written).astimezone(dt.timezone.utc),
                         dt.datetime(2026, 11, 3, 23, tzinfo=dt.timezone.utc),
                         "the instant is kept, only the zone changes")

    def test_a_missing_or_unreadable_date_is_empty_not_invented(self):
        self.assertEqual(events.local_iso(events.parse_local("")), "")
        self.assertEqual(events.local_iso(events.parse_local("not a date")), "")

    def test_cancelled_events_are_read_then_dropped(self):
        records = events.parse_page(EDGE)
        self.assertEqual(len(records), 3, "the parser keeps every item it was sent")
        self.assertEqual([r["cancelled"] for r in records], [True, False, False])
        kept = events.build_events(records, "CL")
        self.assertEqual(len(kept), 2)
        self.assertNotIn(records[0]["title"], [event["title"] for event in kept])

    def test_a_virtual_event_has_no_location_and_says_so(self):
        kept = events.build_events(events.parse_page(EDGE), "CL")
        online = [event for event in kept if event["virtual"]]
        self.assertEqual(len(online), 1)
        self.assertEqual(online[0]["branch"], "")

    def test_a_row_for_another_branch_is_not_trusted(self):
        records = events.parse_page(EDGE)
        records[2]["branch_code"] = "NY"
        kept = events.build_events(records, "CL")
        self.assertNotIn(records[2]["title"], [event["title"] for event in kept],
                         "a filter the feed ignored must not slip another branch in")

    def test_a_dtd_is_refused_before_it_is_parsed(self):
        with self.assertRaises(ValueError):
            events.parse_page('<!DOCTYPE rss [<!ENTITY x "y">]><rss/>')

    def test_an_empty_answer_is_no_items(self):
        self.assertEqual(events.parse_page(""), [])
        self.assertEqual(events.parse_page("   \n"), [])


class SummaryTest(unittest.TestCase):
    def test_every_summary_is_at_most_300_characters_and_tagless(self):
        for text in (PAGE, EDGE):
            for event in events.build_events(events.parse_page(text), "CL"):
                with self.subTest(title=event["title"]):
                    self.assertLessEqual(len(event["summary"]), 300)
                    self.assertNotIn("<", event["summary"])
                    self.assertNotIn(">", event["summary"])

    def test_a_long_summary_is_cut_at_a_word_and_ends_in_a_short_ellipsis(self):
        long = "<p>" + " ".join(["word"] * 200) + "</p>"
        summary = events.clean_summary(long)
        self.assertLessEqual(len(summary), 300)
        self.assertTrue(summary.endswith(" ..."))
        self.assertEqual(summary.count("word"), len(summary[:-4].split(" ")))
        self.assertFalse(summary[:-4].endswith("wor"))

    def test_entities_and_markup_are_plain_text(self):
        summary = events.clean_summary("<p>A &amp; B<br>and <b>more</b></p>")
        self.assertEqual(summary, "A & B and more")

    def test_a_short_summary_is_left_alone(self):
        self.assertEqual(events.clean_summary("  Story   time\n"), "Story time")

    def test_a_summary_cut_once_keeps_the_space_before_its_ellipsis(self):
        long = "<p>" + " ".join(["word"] * 200) + "</p>"
        once = events.clean_summary(long)
        self.assertTrue(once.endswith(" ..."))
        self.assertEqual(events.clean_summary(once), once,
                         "a summary already cut must come back unchanged")
        cut = [event["summary"] for event in events.build_events(
            events.parse_page(EDGE), "CL") if event["summary"].endswith("...")]
        for summary in cut:
            with self.subTest(summary=summary[-20:]):
                self.assertTrue(summary.endswith(" ..."),
                                "the space before the ellipsis was eaten again")


class LibraryZoneTest(ZoneTest):
    """The snapshot is the library's clock, not the machine's that made it."""

    def test_the_same_feed_writes_the_same_snapshot_in_any_runner_zone(self):
        page = with_offset(PAGE)
        written = []
        for zone in ("UTC", "America/Vancouver"):
            self.under(zone)
            records = events.parse_page(page)
            self.assertIn("2026-11-03T18:00:00-05:00",
                          [record["start"] for record in records],
                          f"23:00Z is 18:00 in Toronto, not in the runner's zone ({zone})")
            self.assertFalse([record["start"] for record in records
                              if "+00:00" in record["start"]],
                             "no feed time may be written in UTC by accident")
            snap = events.snapshot(events.build_events(records, "CL"), "CL",
                                   dt.date(2026, 11, 3), dt.date(2026, 11, 24),
                                   now=dt.datetime(2026, 11, 3, 19, 49, 50,
                                                   tzinfo=dt.timezone.utc))
            self.assertEqual(snap["fetched"], "2026-11-03T14:49:50-05:00",
                             f"`fetched` must be the library's clock under TZ={zone}")
            written.append(json.dumps(snap, sort_keys=True))
        self.assertEqual(written[0], written[1],
                         "the same feed must not make two different snapshots")

    def test_the_librarys_zone_follows_the_librarys_daylight_saving(self):
        self.under("UTC")
        self.assertEqual(events.local_iso(events.parse_local("2026-07-04T23:00:00Z")),
                         "2026-07-04T19:00:00-04:00",
                         "July in Toronto is -04:00, so this is not a fixed offset")
        self.assertEqual(events.local_iso(events.parse_local("2026-11-03T23:00:00Z")),
                         "2026-11-03T18:00:00-05:00")

    def test_without_zoneinfo_the_offset_is_fixed_and_said_out_loud(self):
        saved_zoneinfo, saved_warned = events.ZoneInfo, events._zone_warned
        self.addCleanup(self._restore_zoneinfo, saved_zoneinfo, saved_warned)
        events.ZoneInfo = None
        events._zone_warned = False
        events.library_timezone.cache_clear()
        message = io.StringIO()
        with redirect_stderr(message):
            written = events.local_iso(events.parse_local("2026-11-03T23:00:00Z"))
        self.assertEqual(written, "2026-11-03T18:00:00-05:00",
                         "the fallback keeps standard time, and loses an hour in summer")
        self.assertIn("-05:00", message.getvalue(),
                      "the fallback must say which offset it used, in a sentence")

    def _restore_zoneinfo(self, saved_zoneinfo, saved_warned):
        events.ZoneInfo = saved_zoneinfo
        events._zone_warned = saved_warned
        events.library_timezone.cache_clear()


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        self.events = events.build_events(events.parse_page(PAGE), "CL")
        self.snap = events.snapshot(self.events, "CL", dt.date(2026, 11, 3),
                                    dt.date(2026, 11, 24),
                                    now=dt.datetime(2026, 11, 3, 12, 0))

    def test_the_snapshot_has_exactly_the_promised_keys(self):
        self.assertEqual(set(self.snap), SNAPSHOT_KEYS)
        self.assertEqual(set(self.snap["window"]), {"start", "end"})
        for event in self.snap["events"]:
            self.assertEqual(list(event), EVENT_KEYS)

    def test_no_field_anywhere_is_called_description(self):
        self.assertNotIn("description", keys_anywhere(self.snap))

    def test_the_window_and_the_source_are_recorded(self):
        self.assertEqual(self.snap["branch"], "CL")
        self.assertEqual(self.snap["window"], {"start": "2026-11-03",
                                              "end": "2026-11-24"})
        self.assertEqual(self.snap["source"],
                         "gateway.bibliocommons.com/v2/libraries/tpl/rss/"
                         "events?locations=CL&startDate=2026-11-03&endDate=2026-11-24&page=1")
        self.assertTrue(self.snap["fetched"].startswith("2026-11-03T12:00:00"))

    def test_events_are_in_time_order(self):
        starts = [event["start"] for event in self.snap["events"]]
        self.assertEqual(starts, sorted(starts))

    def test_the_events_carry_no_publisher_blurb_key(self):
        for event in self.snap["events"]:
            self.assertEqual(set(event), set(EVENT_KEYS))


class CommandTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name) / "events.json"

    def run_main(self, pages, *args, branch="CL", fetcher=None):
        stub = fetcher or StubFetcher(pages)
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = events.main(["--branch", branch, "--days", "21",
                                "--out", str(self.out), *args], fetcher=stub)
        return code, stdout.getvalue(), stderr.getvalue(), stub

    def test_a_wrong_branch_code_reports_and_writes_nothing(self):
        code, out, err, _ = self.run_main([""])
        self.assertEqual(code, 2)
        self.assertIn("No events found for branch 'CL'", err)
        self.assertIn("Nothing was written", err)
        self.assertFalse(self.out.exists(), "an empty answer must not replace a snapshot")
        self.assertEqual(out, "")

    def test_a_page_is_written_and_named(self):
        code, out, err, _ = self.run_main([PAGE, ""])
        self.assertEqual(code, 0)
        self.assertIn("25 events", out)
        self.assertIn("-> " + str(self.out), out)
        snap = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(len(snap["events"]), 25)
        self.assertEqual(set(snap), SNAPSHOT_KEYS)
        self.assertNotIn("description", keys_anywhere(snap))
        self.assertEqual(events.check_snapshot(snap), [],
                         "what is written must pass data/events.schema.json")

    def test_pages_are_asked_for_as_batch_reads_and_stop_on_an_empty_page(self):
        _, _, _, stub = self.run_main([PAGE, PAGE, ""])
        self.assertEqual([kind for _, kind in stub.calls], ["batch", "batch", "batch"])
        self.assertIn("page=1", stub.calls[0][0])
        self.assertIn("page=2", stub.calls[1][0])
        self.assertIn("locations=CL", stub.calls[0][0])
        self.assertIn("startDate=", stub.calls[0][0])
        self.assertIn("endDate=", stub.calls[0][0])

    def test_the_window_is_the_librarys_today_and_the_days_asked_for(self):
        _, _, _, stub = self.run_main([PAGE, ""])
        today = dt.datetime.now(tz=events.library_timezone()).date()
        self.assertIn(f"startDate={today.isoformat()}", stub.calls[0][0])
        self.assertIn(f"endDate={(today + dt.timedelta(days=21)).isoformat()}",
                      stub.calls[0][0])

    def test_rows_with_no_branch_code_are_not_evidence_the_branch_is_right(self):
        # Every location removed, as an unknown code that answers with virtual
        # rows alone would: the rows parse, but none of them names branch CL.
        page = re.sub(r"<bc:location>.*?</bc:location>", "", EDGE, flags=re.S)
        self.assertNotIn("<bc:location>", page)
        code, out, err, _ = self.run_main([page, ""])
        self.assertEqual(code, 2)
        self.assertIn("without the code for branch 'CL'", err)
        self.assertIn("Nothing was written", err)
        self.assertFalse(self.out.exists(), "an unproven branch must not be written")
        self.assertEqual(out, "")

    def test_a_snapshot_the_schema_would_reject_is_not_written(self):
        # `--branch ''` used to exit 0 and write a file with an empty branch,
        # which data/events.schema.json rejects (minLength 1).
        code, out, err, _ = self.run_main([PAGE, ""], branch="")
        self.assertEqual(code, 2)
        self.assertIn("does not match data/events.schema.json", err)
        self.assertIn("Nothing was written", err)
        self.assertFalse(self.out.exists(), "the schema must be checked before the write")
        self.assertEqual(out, "")

    def test_a_network_failure_is_one_plain_sentence_not_a_traceback(self):
        def refused(request, timeout=None):
            raise urllib.error.URLError("Name or service not known")

        fetcher = fetch.Fetcher(opener=refused, cache_dir=self.tmp.name,
                                sleep=lambda seconds: None)
        code, out, err, _ = self.run_main([], fetcher=fetcher)
        self.assertEqual(code, 1)
        self.assertIn("Nothing was written", err)
        self.assertIn("Name or service not known", err)
        self.assertNotIn("Traceback", err)
        self.assertFalse(self.out.exists())
        self.assertEqual(out, "")

    def test_a_window_the_page_cap_cannot_cover_is_labelled_with_what_it_covers(self):
        # Five full pages is the cap: page six is never asked for, and the file
        # must not claim the whole 21 days were read.
        code, out, err, stub = self.run_main([PAGE] * 5)
        self.assertEqual(code, 0)
        self.assertEqual(len(stub.calls), events.MAX_PAGES)
        self.assertNotIn("page=6", [call[0] for call in stub.calls])
        snap = json.loads(self.out.read_text(encoding="utf-8"))
        covered = max(event["start"][:10] for event in snap["events"])
        self.assertEqual(snap["window"]["end"], covered,
                         "the file's window is the window that was read")
        self.assertNotEqual(snap["window"]["end"],
                            (dt.datetime.now(tz=events.library_timezone()).date()
                             + dt.timedelta(days=21)).isoformat())
        self.assertIn(f"covers {snap['window']['start']} to {covered}", err)
        self.assertEqual(events.check_snapshot(snap), [])


if __name__ == "__main__":
    unittest.main()
