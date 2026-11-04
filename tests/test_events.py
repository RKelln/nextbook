"""Tests for the events snapshot. Two saved feed pages, no network.

`events-page.xml` is one real page of `gateway.bibliocommons.com/v2/libraries/
tpl/rss/events?locations=CL&...`, read once through `fetch.Fetcher` on
2026-11-03 and saved as it came. `events-edge.xml` is three items of that same
page, rearranged: one cancelled, one virtual with no location, one given a long
tag-laden summary. The shapes are the feed's own; no event was invented.
"""
import datetime as dt
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from adapters.bibliocommons import events

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

    def test_an_offset_is_moved_to_this_machines_local_zone(self):
        aware = events.parse_local("2026-11-03T23:00:00Z")
        self.assertEqual(aware.astimezone(dt.timezone.utc),
                         dt.datetime(2026, 11, 3, 23, tzinfo=dt.timezone.utc))
        written = events.local_iso(aware)
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

    def run_main(self, pages, *args):
        stub = StubFetcher(pages)
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = events.main(["--branch", "CL", "--days", "21",
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

    def test_pages_are_asked_for_as_batch_reads_and_stop_on_an_empty_page(self):
        _, _, _, stub = self.run_main([PAGE, PAGE, ""])
        self.assertEqual([kind for _, kind in stub.calls], ["batch", "batch", "batch"])
        self.assertIn("page=1", stub.calls[0][0])
        self.assertIn("page=2", stub.calls[1][0])
        self.assertIn("locations=CL", stub.calls[0][0])
        self.assertIn("startDate=", stub.calls[0][0])
        self.assertIn("endDate=", stub.calls[0][0])

    def test_the_window_is_today_and_the_days_asked_for(self):
        _, _, _, stub = self.run_main([PAGE, ""])
        today = dt.date.today()
        self.assertIn(f"startDate={today.isoformat()}", stub.calls[0][0])
        self.assertIn(f"endDate={(today + dt.timedelta(days=21)).isoformat()}",
                      stub.calls[0][0])


if __name__ == "__main__":
    unittest.main()
