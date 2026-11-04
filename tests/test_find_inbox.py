"""Tests for T8.9d's `find.py --write-inbox`: the matched books go back to the page.

The network is faked the way `test_find_shelf.py` fakes it (its helpers are reused here), and
every test writes in a temporary folder. `tools/inbox.py` is the writer both commands share, so
this only has to prove that the right entries are handed to it and that the closing line says so.
"""
import contextlib
import io
import json
import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
REPO = TESTS.parent
TOOLS = REPO / "tools"
for path in (TESTS, TOOLS):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import find  # noqa: E402
from adapters.bibliocommons import fetch  # noqa: E402
from test_find_shelf import (  # noqa: E402
    ROBOTS, TS, ShelfNetwork, ShelfTestCase, bodies_for, entry,
)
from test_find_shelf import FailingNetwork  # noqa: E402


class WriteInbox(ShelfTestCase):
    def run_shelf(self, entries, *, bodies=None, opener=None, write_inbox=True):
        """One shelf run through a fake fetcher; returns what `from_shelf` returned."""
        self.write_shelf(entries)
        buffer = io.StringIO()
        net = opener or ShelfNetwork(bodies or {})
        net.stream = buffer
        fetcher = fetch.Fetcher(robots_text=ROBOTS, opener=net,
                                sleep=self.clock.sleep, clock=self.clock,
                                cache_dir=self.cache)
        with contextlib.redirect_stdout(buffer):
            result = find.from_shelf(
                self.shelf_path, limit=find.DEFAULT_LIMIT, data_dir=self.data, out_dir=self.out,
                getter=fetcher.get, cached=fetcher.is_cached,
                begin_search=fetcher.begin_search, now=TS, write_inbox=write_inbox)
        self.output = buffer.getvalue()
        return result

    def inbox_doc(self):
        text = (self.out / "inbox.js").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("Nextbook.data.put('inbox', {"), text[:60])
        return json.loads(text[len("Nextbook.data.put('inbox', "):-3])

    def test_the_matched_books_are_written_back_with_their_record_ids(self):
        entries = [entry("The Dispossessed"), entry("The Left Hand of Darkness")]
        result = self.run_shelf(entries, bodies=bodies_for("The Dispossessed", "The Left Hand of Darkness"))

        self.assertEqual(result["matched"], 2)
        doc = self.inbox_doc()
        self.assertEqual(doc["schema"], "nextbook/inbox-1")
        self.assertEqual(doc["source"], "ai")
        self.assertEqual(len(doc["records"]), 2)

        by_key = {record["key"]: record for record in doc["records"]}
        self.assertEqual(set(by_key), {e["key"] for e in entries}, "the keys the shelf already has")
        for record in doc["records"]:
            self.assertTrue(record["id"], "the library's record id")
            self.assertTrue(record["groupKey"], "and the group key, so the work is one book")
            self.assertEqual(record["updated"], TS, "dated with this run, so the page takes it")
            self.assertEqual(record["state"], "read", "the person's own state rides along")

        # The closing line is the last thing said, and it names the file and the count.
        lines = [line for line in self.output.splitlines() if line.strip()]
        self.assertEqual(lines[-1], f"Wrote {self.out / 'inbox.js'} for 2 matched books.")
        self.assertIn("Searched 2, found 2, 0 had nothing, 0 to go.", self.output)

    def test_a_run_that_matched_nothing_writes_no_note(self):
        result = self.run_shelf([entry("The Dispossessed"), entry("The Left Hand of Darkness")],
                         opener=FailingNetwork())

        self.assertEqual(result["matched"], 0)
        self.assertFalse((self.out / "inbox.js").exists())
        self.assertNotIn("Wrote ", self.output)

    def test_a_shelf_with_nothing_to_search_writes_no_note(self):
        entries = [entry("The Dispossessed", id="S234C1129065")]
        result = self.run_shelf(entries, bodies={})

        self.assertFalse(result["ok"])
        self.assertFalse((self.out / "inbox.js").exists())
        self.assertIn("Nothing to search", self.output)

    def test_the_note_is_not_written_without_the_flag(self):
        self.run_shelf([entry("The Dispossessed")], bodies=bodies_for("The Dispossessed"),
                write_inbox=False)
        self.assertFalse((self.out / "inbox.js").exists())
        self.assertNotIn("Wrote ", self.output)

    def test_the_command_takes_the_flag_only_with_from_shelf(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            with self.assertRaises(SystemExit) as raised:
                find.main(["--write-inbox", "birds"])
        self.assertEqual(raised.exception.code, 2)
        self.assertIn("--from-shelf", err.getvalue())

    def test_the_command_reaches_the_note_with_no_book_to_search(self):
        """The flag is wired through `main`, with no network: a shelf whose books all have ids."""
        self.write_shelf([entry("The Dispossessed", id="S234C1129065")])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = find.main(["--from-shelf", str(self.shelf_path), "--write-inbox",
                              "--data-dir", str(self.data), "--out-dir", str(self.out)])
        self.assertEqual(code, 1)
        self.assertFalse((self.out / "inbox.js").exists())


if __name__ == "__main__":
    unittest.main()
