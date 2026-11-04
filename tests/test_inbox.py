"""Tests for tools/inbox.py, the one writer for the page's inbox (T8.9d).

Every test writes into a temporary folder: the repo's app/data/ is never touched.
The wrapper is checked the way tools/build.py checks a data file, because a stray `<`
in a title would end the script element.
"""
import contextlib
import datetime
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
REPO = TESTS.parent
TOOLS = REPO / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import inbox  # noqa: E402


class InboxTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name) / "app" / "data"
        self.target = self.out / "inbox.js"

    def main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = inbox.main(argv + ["--out-dir", str(self.out)])
        return code, out.getvalue(), err.getvalue()

    def written(self):
        """The document the page will read, out of the wrapper build.py knows."""
        text = self.target.read_text(encoding="utf-8")
        match = re.match(r"^Nextbook\.data\.put\('inbox', (.*)\);\n$", text, re.S)
        assert match is not None, text[:80]
        return text, json.loads(match.group(1))


class ItWritesAFileThePageCanRead(InboxTestCase):
    def test_the_wrapper_and_its_escapes_are_the_ones_gen_data_writes(self):
        records = Path(self.tmp.name) / "records.json"
        records.write_text(json.dumps([
            {"title": "A <B> & C", "author": "Some Writer", "state": "read", "rating": "ok"},
        ]), encoding="utf-8")

        code, out, err = self.main(["--file", str(records)])

        self.assertEqual(code, 0, err)
        text, doc = self.written()
        self.assertEqual(doc["schema"], "nextbook/inbox-1")
        self.assertEqual(doc["source"], "ai")
        for char in "<>&":
            self.assertNotIn(char, text, "a raw " + char + " could end the script element")
        self.assertIn("\\u003c", text)
        self.assertIn("\\u0026", text)
        self.assertEqual(doc["records"][0]["title"], "A <B> & C", "the escape reads back as itself")
        self.assertIn("Wrote ", out)
        self.assertIn("1 change.", out)

    def test_the_id_is_sixteen_hex_and_the_date_has_its_offset(self):
        code, out, err = self.main(["--add", "Piranesi", "--author", "Susanna Clarke"])
        self.assertEqual(code, 0, err)
        _text, doc = self.written()

        self.assertTrue(re.fullmatch(r"[0-9a-f]{16}", doc["id"]), doc["id"])

        stamp = datetime.datetime.fromisoformat(doc["updated"])
        self.assertIsNotNone(stamp.tzinfo, "an ISO 8601 time with an offset")
        self.assertIsNotNone(stamp.utcoffset())
        self.assertEqual(doc["records"][0]["updated"], doc["updated"],
                         "the entry is dated when it is written, so the page takes it")

        code, _out, err = self.main(["--add", "Piranesi", "--author", "Susanna Clarke"])
        self.assertEqual(code, 0, err)
        _text, second = self.written()
        self.assertNotEqual(second["id"], doc["id"], "each write is a new note")

    def test_every_entry_gets_one_key(self):
        records = Path(self.tmp.name) / "records.json"
        records.write_text(json.dumps([
            {"title": "The Dispossessed", "author": "Ursula K. Le Guin", "state": "read"},
            {"title": "Piranesi", "id": "234C1129065", "state": "want"},
            {"title": "Station Eleven", "groupKey": "pack:station-eleven", "state": "want"},
            {"key": "t:kindred|octavia e butler", "title": "Kindred", "author": "Octavia E. Butler"},
        ]), encoding="utf-8")

        code, out, err = self.main(["--file", str(records)])

        self.assertEqual(code, 0, err)
        _text, doc = self.written()
        # A key of its own for each, and the three the list carries land on the work.
        self.assertEqual([r["key"] for r in doc["records"]], [
            "w:pack:dispossessed",
            "w:234C1129065",
            "w:pack:station-eleven",
            "t:kindred|octavia e butler",
        ])
        self.assertEqual(doc["matched"], 1)  # only the one with no id given: the others already name their work
        self.assertIn("4 changes.", out)

    def test_add_makes_one_entry_with_the_state_and_rating_asked_for(self):
        code, out, err = self.main(["--add", "Piranesi", "--author", "Susanna Clarke",
                                    "--state", "read", "--rating", "loved"])
        self.assertEqual(code, 0, err)
        _text, doc = self.written()

        self.assertEqual(len(doc["records"]), 1)
        entry = doc["records"][0]
        # A book the app already carries becomes that work, so the note lands on it rather
        # than beside it as a second Piranesi.
        self.assertEqual(entry["key"], "w:pack:piranesi")
        self.assertEqual(entry["id"], "piranesi")
        self.assertEqual(entry["groupKey"], "pack:piranesi")
        self.assertEqual(doc["matched"], 1)
        self.assertEqual(entry["title"], "Piranesi")
        self.assertEqual(entry["author"], "Susanna Clarke")
        self.assertEqual(entry["state"], "read")
        self.assertEqual(entry["rating"], "loved")

    def test_a_book_the_list_does_not_carry_keeps_a_title_and_author_key(self):
        code, out, err = self.main(["--add", "A Book Nobody Carries", "--author", "Nobody At All",
                                    "--state", "read"])
        self.assertEqual(code, 0, err)
        _text, doc = self.written()

        entry = doc["records"][0]
        self.assertEqual(entry["key"], "t:book nobody carries|nobody at all")
        self.assertNotIn("id", entry)
        self.assertEqual(doc["matched"], 0)

    def test_the_wrong_author_does_not_claim_a_work_with_the_same_title(self):
        code, out, err = self.main(["--add", "Piranesi", "--author", "Somebody Else"])
        self.assertEqual(code, 0, err)
        _text, doc = self.written()

        self.assertEqual(doc["records"][0]["key"], "t:piranesi|somebody else")
        self.assertEqual(doc["matched"], 0)


class ItRefusesWhatItCannotWrite(InboxTestCase):
    def test_a_records_file_that_is_not_a_list_is_one_sentence_and_exit_2(self):
        records = Path(self.tmp.name) / "records.json"
        records.write_text(json.dumps({"title": "Piranesi"}), encoding="utf-8")

        code, out, err = self.main(["--file", str(records)])

        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        lines = [line for line in err.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, err)
        self.assertIn("not a list of books", lines[0])
        self.assertNotIn("Traceback", err)
        self.assertFalse(self.target.exists(), "nothing was written")

    def test_a_record_that_is_not_a_book_is_named_and_nothing_is_written(self):
        records = Path(self.tmp.name) / "records.json"
        records.write_text(json.dumps([{"title": "Piranesi"}, "Kindred"]), encoding="utf-8")

        code, out, err = self.main(["--file", str(records)])

        self.assertEqual(code, 2)
        self.assertIn("Record 2", err)
        self.assertFalse(self.target.exists())

    def test_a_record_with_no_title_and_no_id_has_no_key_and_is_refused(self):
        code, out, err = self.main(["--add", "   "])
        self.assertEqual(code, 2)
        self.assertEqual(len([line for line in err.splitlines() if line.strip()]), 1, err)
        self.assertFalse(self.target.exists())

    def test_a_bad_state_is_refused_by_the_command(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                inbox.main(["--add", "Piranesi", "--state", "finished"])
        self.assertEqual(raised.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
