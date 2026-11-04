"""Tests for T1.8: one search a person asked for, merged into found.json.

The fetcher is faked everywhere, so nothing here touches the network. The fake
page is built from the adapter's own saved fixture (`fixtures/tpl/briefs-le-
guin.json`), so the works are real catalogue records and the facets are the
normaliser's real output, not invented books (AGENTS.md rule 6).

Every test writes in a temporary folder holding its own copy of data/slice.json;
the repo's data/ is never changed. The one repo-level test is `git check-ignore`.
"""
import contextlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TESTS = Path(__file__).resolve().parent
REPO = TESTS.parent
TOOLS = REPO / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import find  # noqa: E402
from adapters.bibliocommons import fetch  # noqa: E402

BRIEFS = json.loads((TESTS / "fixtures" / "tpl" / "briefs-le-guin.json").read_text(encoding="utf-8"))
SLICE = json.loads((REPO / "data" / "slice.json").read_text(encoding="utf-8"))


def page_html(briefs=None) -> str:
    """A page shaped like the catalogue's: one JSON block, entities.bibs."""
    briefs = BRIEFS if briefs is None else briefs
    bibs = {}
    for index, brief in enumerate(briefs):
        # A real brief always has an id; a test brief that has none (a record
        # with no identity) still needs a key in the payload.
        bibs[brief.get("id") or f"anon-{index}"] = {"briefInfo": brief}
    payload = {"entities": {"bibs": bibs}}
    return ('<!doctype html><html><body><script type="application/json">'
            + json.dumps(payload) + "</script></body></html>")


class FakeFetcher:
    """Stands in for `fetch.get`; remembers what stdout looked like when called."""

    def __init__(self, html=None, error=None):
        self.html = page_html() if html is None else html
        self.error = error
        self.calls = []
        self.stream: "io.StringIO | None" = None
        self.snapshot: "str | None" = None

    def __call__(self, url, kind="on-demand"):
        if self.stream is not None:
            self.snapshot = self.stream.getvalue()
        self.calls.append((url, kind))
        if self.error is not None:
            raise self.error
        return self.html


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


class FindTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / "data"
        self.out = Path(self.tmp.name) / "app" / "data"
        self.data.mkdir()
        shutil.copy(REPO / "data" / "slice.json", self.data / "slice.json")
        self.found_path = self.data / "found.json"
        self.fake = FakeFetcher()

    def tearDown(self):
        self.tmp.cleanup()

    def run_find(self, **kwargs):
        kwargs.setdefault("getter", self.fake)
        kwargs.setdefault("data_dir", self.data)
        kwargs.setdefault("out_dir", self.out)
        kwargs.setdefault("now", "2026-11-07T11:40:00Z")
        buffer = io.StringIO()
        self.fake.stream = buffer
        with contextlib.redirect_stdout(buffer):
            result = find.run(**kwargs)
        self.output = buffer.getvalue()
        return result

    def found(self):
        return json.loads(self.found_path.read_text(encoding="utf-8"))


class ItSaysWhatItWillSend(FindTestCase):
    def test_the_search_and_address_are_printed_before_the_fetch(self):
        self.run_find(words="le guin")
        self.assertIsNotNone(self.fake.snapshot, "the fetcher was never called")
        snapshot = self.fake.snapshot or ""
        self.assertIn('Search: "le guin"', snapshot)
        self.assertIn("Address:", snapshot)
        self.assertIn("query=le%20guin", snapshot)
        # Nothing about the outcome can be there yet.
        self.assertNotIn("Added", snapshot)

    def test_the_address_is_a_search_on_the_configured_library(self):
        self.run_find(words="le guin")
        url, kind = self.fake.calls[0]
        self.assertTrue(url.startswith(fetch.load_library()["host"] + "/v2/search?"))
        self.assertEqual(kind, "on-demand")
        self.assertIn("page=1", url)

    def test_a_title_and_author_are_shown_as_asked(self):
        self.run_find(title="The Left Hand of Darkness", author="Ursula K. Le Guin")
        snapshot = self.fake.snapshot or ""
        self.assertIn('Search: title "The Left Hand of Darkness" by "Ursula K. Le Guin"',
                      snapshot)
        self.assertIn("Words sent to the library: The Left Hand of Darkness Ursula K. Le Guin",
                      snapshot)

    def test_up_to_three_pages_are_shown_and_a_fourth_is_refused(self):
        self.run_find(words="le guin", pages=9)
        snapshot = self.fake.snapshot or ""
        self.assertIn("at most 3 pages", self.output)
        self.assertIn("Address (page 1):", snapshot)
        self.assertIn("Address (page 3):", snapshot)
        self.assertNotIn("Address (page 4):", snapshot)
        self.assertLessEqual(len(self.fake.calls), fetch.MAX_ON_DEMAND_PAGES)


class ItAddsWorks(FindTestCase):
    def test_a_search_adds_works_with_facets(self):
        result = self.run_find(words="le guin")
        doc = self.found()
        self.assertEqual(doc["schema"], "nextbook/found-1")
        self.assertEqual(len(doc["works"]), 12)
        self.assertEqual(result["added"], 12)
        for work in doc["works"]:
            self.assertTrue(work["facets"], work["title"])
            self.assertEqual(work["found"], {"query": "le guin"})
            self.assertTrue(work["id"])
            self.assertTrue(work["groupKey"])
        for key, entry in doc["facets"].items():
            self.assertEqual(entry["kind"], key.partition(":")[0])
            self.assertTrue(entry["label"])
            self.assertGreaterEqual(entry["works"], 1)
        self.assertEqual(doc["searches"][0]["query"], "le guin")
        self.assertEqual(doc["searches"][0]["works"], 12)
        self.assertEqual(doc["searches"][0]["fetched"], "2026-11-07T11:40:00Z")

    def test_a_book_already_on_the_list_keeps_its_library_record(self):
        """The record is written, so the pool can fold it into that book (T2.2).

        The catalogue files this book under its own groupKey, not the slice's
        `pack:left-hand`, so the pool can only match it by title and author --
        which is exactly what `app/core/slice.js` does.
        """
        brief = next(b for b in BRIEFS if b["id"] == "S234C3712372")
        before = {find.norm_title(work["title"]) for work in SLICE["works"]}
        self.assertIn("left hand of darkness", before)

        result = self.run_find(words="le guin")
        works = {find.norm_title(work["title"]): work for work in self.found()["works"]}

        for known in ("dispossessed", "left hand of darkness", "wizard of earthsea"):
            self.assertIn(known, before, "the slice should already have this book")
            self.assertIn(known, works, "the record of a book on the list was dropped")

        record = works["left hand of darkness"]
        self.assertEqual(record["id"], brief["id"])
        self.assertEqual(record["groupKey"], brief["groupKey"])
        self.assertEqual(record["callNumber"], brief["callNumber"])
        self.assertEqual(record["found"], {"query": "le guin"})

        self.assertEqual(len(self.found()["works"]), 12)
        self.assertEqual(result["added"], 12)
        self.assertEqual(result["linked"], 3)
        self.assertEqual(result["known"], 0)
        self.assertIn("Added 12 books. 3 were already in your list and now have "
                      "their page at the library.", self.output)

    def test_the_three_strongest_subjects_are_printed(self):
        result = self.run_find(words="le guin")
        self.assertEqual([label for label, _ in result["subjects"]],
                         ["science fiction", "fantasy", "magic"])
        self.assertEqual(len(result["subjects"]), 3)
        self.assertIn("Strongest subjects: science fiction (13), fantasy (6), magic (5).",
                      self.output)
        for label, count in result["subjects"]:
            self.assertGreater(count, 0)
            self.assertNotIn("shelves", label)

    def test_a_brief_with_no_identity_does_not_change_the_subject_counts(self):
        """merge() drops a brief with no id, groupKey or title; it must not be counted.

        Its headings reach neither the written file nor the sentence printed
        under it, so the totals are the books the person actually got.
        """
        anonymous = {"format": "BK", "subjectHeadings": ["Ghosts", "Haunted houses"]}
        self.fake = FakeFetcher(html=page_html([anonymous]))
        result = self.run_find(words="le guin")
        self.assertEqual(result["added"], 0)
        self.assertEqual(result["subjects"], [])
        self.assertNotIn("ghosts", self.output)
        self.assertIn("No subjects came back with these books.", self.output)
        self.assertFalse(self.found_path.exists())

    def test_running_it_twice_adds_nothing(self):
        self.run_find(words="le guin")
        before = self.found_path.read_text(encoding="utf-8")
        result = self.run_find(words="le guin")
        self.assertEqual(result["added"], 0)
        self.assertEqual(result["known"], 12)
        self.assertEqual(result["linked"], 0)
        self.assertEqual(self.found_path.read_text(encoding="utf-8"), before)
        self.assertEqual(len(self.found()["searches"]), 1)
        self.assertIn("Added no new books.", self.output)
        self.assertNotIn("page at the library", self.output)

    def test_no_description_anywhere(self):
        self.run_find(words="le guin")
        text = self.found_path.read_text(encoding="utf-8")
        self.assertNotIn("description", text)
        for key in keys_anywhere(self.found()):
            self.assertNotIn(key, find.FORBIDDEN_FIELDS)

    def test_the_page_gets_a_safe_found_file(self):
        self.run_find(words="le guin")
        generated = self.out / "found.js"
        self.assertTrue(generated.is_file())
        text = generated.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("Nextbook.data.put('found', {"))
        self.assertNotIn("<", text)
        self.assertNotIn(">", text)
        self.assertNotIn("&", text)
        body = text[len("Nextbook.data.put('found', "):-3]
        self.assertEqual(len(json.loads(body)["works"]), 12)


class ItKeepsThePersonSafe(FindTestCase):
    def test_a_refused_page_changes_nothing_and_says_so(self):
        self.fake = FakeFetcher(error=fetch.DisallowedPath("robots.txt says no"))
        result = self.run_find(words="le guin")
        self.assertEqual(result["added"], 0)
        self.assertFalse(result["ok"])
        self.assertFalse(self.found_path.exists())
        self.assertIn("would not give that page", self.output)
        self.assertIn('Search: "le guin"', self.output)

    def test_a_broken_found_file_is_refused_not_overwritten(self):
        self.found_path.write_text("{not json", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_find(words="le guin")
        self.assertEqual(self.found_path.read_text(encoding="utf-8"), "{not json")

    def test_no_description_can_be_written(self):
        doc = find.empty_found()
        doc["works"] = [{"id": "x", "title": "x", "facets": [], "description": "blurb"}]
        with self.assertRaises(find.FindError):
            find._refuse_forbidden(doc)
        self.assertFalse(self.found_path.exists())

    def test_a_forbidden_field_is_refused_whatever_its_case(self):
        for key in ("Description", "DESCRIPTION", "Jacket", "Rating"):
            doc = find.empty_found()
            doc["works"] = [{"id": "x", "title": "x", "facets": [], key: "blurb"}]
            with self.assertRaises(find.FindError, msg=key):
                find._refuse_forbidden(doc)


class Clearing(FindTestCase):
    def test_clear_empties_the_file_and_the_page(self):
        self.run_find(words="le guin")
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = find.clear(self.data, self.out)
        self.assertEqual(code, 0)
        self.assertEqual(self.found()["works"], [])
        self.assertEqual(self.found()["facets"], {})
        self.assertEqual(self.found()["searches"], [])
        generated = (self.out / "found.js").read_text(encoding="utf-8")
        body = json.loads(generated[len("Nextbook.data.put('found', "):-3])
        self.assertEqual(body["works"], [])

    def test_clear_with_nothing_to_clear_says_so(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = find.clear(self.data, self.out)
        self.assertEqual(code, 0)
        self.assertIn("no found books to clear", buffer.getvalue())
        self.assertFalse(self.found_path.exists())

    def test_clear_with_no_found_file_still_empties_the_page(self):
        """A stale app/data/found.js must not keep showing books that are gone."""
        self.out.mkdir(parents=True)
        stale = self.out / "found.js"
        stale.write_text("Nextbook.data.put('found', {\"works\": [{\"id\": \"S1\"}]});\n",
                         encoding="utf-8")
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = find.main(["--clear", "--data-dir", str(self.data),
                              "--out-dir", str(self.out)])
        self.assertEqual(code, 0, buffer.getvalue())
        self.assertIn("no found books to clear", buffer.getvalue())
        self.assertFalse(self.found_path.exists())
        if stale.exists():
            prefix = "Nextbook.data.put('found', "
            body = json.loads(stale.read_text(encoding="utf-8")[len(prefix):-3])
            self.assertEqual(body["works"], [], "the page still has books to show")


class TheCommandLine(FindTestCase):
    def test_the_cli_runs_one_search_and_writes_the_page_file(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            with mock.patch.object(fetch, "get", self.fake):
                code = find.main(["--title", "The Left Hand of Darkness",
                                  "--author", "Ursula K. Le Guin",
                                  "--data-dir", str(self.data), "--out-dir", str(self.out)])
        self.assertEqual(code, 0, buffer.getvalue())
        self.assertTrue(self.found_path.is_file())
        self.assertTrue((self.out / "found.js").is_file())
        self.assertEqual(self.fake.calls[0][1], "on-demand")

    def test_words_and_a_title_together_are_refused(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                find.main(["birds", "--title", "x"])
        self.assertEqual(raised.exception.code, 2)

    def test_no_words_at_all_is_refused(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                find.main([])
        self.assertEqual(raised.exception.code, 2)


class TheSmallPieces(unittest.TestCase):
    def test_norm_title_matches_the_core_rule(self):
        self.assertEqual(find.norm_title("The Left Hand of Darkness"),
                         "left hand of darkness")
        self.assertEqual(find.norm_title("Handmaid\u2019s Tale"), "handmaids tale")
        self.assertEqual(find.norm_title("  A  Tale for the Time Being! "),
                         "tale for the time being")

    def test_identities_cover_id_group_and_title(self):
        work = {"id": "S1", "groupKey": "g", "title": "The Dispossessed",
                "authorKey": "le guin, u"}
        keys = find.identities(work)
        self.assertIn("id:S1", keys)
        self.assertIn("group:g", keys)
        self.assertIn("title:dispossessed|le guin, u", keys)

    def test_the_linked_sentence_reads_for_one_book(self):
        self.assertEqual(find._linked_clause(1),
                         "1 was already in your list and now has its page at the library.")
        self.assertEqual(find._linked_clause(3),
                         "3 were already in your list and now have their page at the library.")

    @unittest.skipUnless((REPO / ".git").exists(), "not a git checkout (a downloaded ZIP), so there is no ignore rule to read")
    def test_the_found_file_is_gitignored(self):
        result = subprocess.run(["git", "-C", str(REPO), "check-ignore", "data/found.json"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("data/found.json", result.stdout.strip())


if __name__ == "__main__":
    unittest.main()
