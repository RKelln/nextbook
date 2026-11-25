"""Tests for `find.py --suggest`: titles an agent remembers, checked at the library.

The network is faked as in `test_find_shelf.py`; pages are built from the
adapter's real Le Guin fixture. A suggestion is kept only when the catalogue
returns the same title by the same author, and only that one book.
"""
import contextlib
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
from test_fetch import FakeClock  # noqa: E402
from test_find_shelf import (BRIEFS, BY_TITLE, ROBOTS, FailingNetwork,  # noqa: E402
                             ShelfNetwork, page_html)

LE_GUIN = "Ursula K. Le Guin"


def address(title, author=LE_GUIN):
    return fetch.book_search_url(title, author)


def noisy_page(title):
    """The book asked for, plus three others, as a real search page would have."""
    others = [b for t, b in BY_TITLE.items() if t != title][:3]
    return page_html(others + [BY_TITLE[title]])


class SuggestTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.data = root / "data"
        self.data.mkdir()
        # An empty starting list, so no fixture book is "already in your list".
        (self.data / "slice.json").write_text(json.dumps({"works": []}), encoding="utf-8")
        self.out = root / "app" / "data"
        self.cache = root / "cache"
        self.cache.mkdir()
        self.found_path = self.data / "found.json"
        self.clock = FakeClock()

    def go(self, suggestions, bodies=None, opener=None):
        buffer = io.StringIO()
        net = opener or ShelfNetwork(bodies or {})
        net.stream = buffer
        fetcher = fetch.Fetcher(robots_text=ROBOTS, opener=net, sleep=self.clock.sleep,
                                clock=self.clock, cache_dir=self.cache)
        with contextlib.redirect_stdout(buffer):
            result = find.suggest(suggestions, data_dir=self.data, out_dir=self.out,
                                  getter=fetcher.get, cached=fetcher.is_cached,
                                  begin_search=fetcher.begin_search, now="2026-11-25T12:00:00Z")
        self.output = buffer.getvalue()
        self.net = net
        return result

    def found(self):
        return json.loads(self.found_path.read_text(encoding="utf-8"))


class ParsingLines(unittest.TestCase):
    def test_the_usual_separators(self):
        text = "\n".join([
            "1. Circe — Madeline Miller",
            "- The Dispossessed - Ursula K. Le Guin",
            "Piranesi by Susanna Clarke",
            "Stand by Me by Stephen King",
            "Beloved\tToni Morrison",
            "# a comment",
            "",
            '"Station Eleven" | Emily St. John Mandel',
            "Just a title",
            "Stand by Me|Stephen King",
            "Twenty Thousand Leagues Under the Sea - Not a Dash | Jules Verne",
        ])
        self.assertEqual(find.parse_suggestions(text), [
            ("Circe", "Madeline Miller"),
            ("The Dispossessed", "Ursula K. Le Guin"),
            ("Piranesi", "Susanna Clarke"),
            ("Stand by Me", "Stephen King"),
            ("Beloved", "Toni Morrison"),
            ("Station Eleven", "Emily St. John Mandel"),
            ("Just a title", ""),
            ("Stand by Me", "Stephen King"),
            ("Twenty Thousand Leagues Under the Sea - Not a Dash", "Jules Verne"),
        ])


class TheSearchAddress(unittest.TestCase):
    def test_fielded_title_and_author(self):
        url = fetch.book_search_url("Moby-Dick", "Herman Melville")
        self.assertIn("searchType=bl", url)
        self.assertIn("title%3A%28Moby-Dick%29%20AND%20contributor%3A%28Herman%20Melville%29", url)

    def test_initials_and_query_syntax_are_dropped(self):
        url = fetch.book_search_url("Circe: (A Novel)", "Ursula K. Le Guin")
        self.assertIn("title%3A%28Circe%20A%20Novel%29", url)
        self.assertIn("contributor%3A%28Ursula%20Guin%29", url)

    def test_no_author_searches_title_only(self):
        self.assertNotIn("contributor", fetch.book_search_url("Piranesi", ""))


class Matching(unittest.TestCase):
    def test_same_book_under_either_author_spelling(self):
        work = {"title": "The Dispossessed", "author": "Guin, Ursula K. Le"}
        self.assertTrue(find.is_suggested_book(work, "Dispossessed", "Ursula Le Guin"))

    def test_subtitle_and_article_do_not_matter(self):
        work = {"title": "Circe", "author": "Miller, Madeline"}
        self.assertTrue(find.is_suggested_book(work, "Circe: A Novel", "Madeline Miller"))

    def test_another_author_with_the_same_title_is_not_it(self):
        work = {"title": "The Dispossessed", "author": "Smith, Jane"}
        self.assertFalse(find.is_suggested_book(work, "The Dispossessed", LE_GUIN))

    def test_a_study_guide_is_not_the_book(self):
        work = {"title": "The Dispossessed: A Study Guide", "author": "Le Guin, Ursula K."}
        self.assertTrue(find.is_suggested_book(work, "The Dispossessed", LE_GUIN))
        work = {"title": "Study Guide to The Dispossessed", "author": "Gale"}
        self.assertFalse(find.is_suggested_book(work, "The Dispossessed", LE_GUIN))


class KeepsOnlyTheMatch(SuggestTestCase):
    def test_one_book_kept_from_a_page_of_four(self):
        result = self.go([("The Dispossessed", LE_GUIN)],
                         bodies={address("The Dispossessed"): noisy_page("The Dispossessed")})
        self.assertEqual(result["added"], 1)
        works = self.found()["works"]
        self.assertEqual([w["title"] for w in works], ["The Dispossessed"])
        self.assertTrue(works[0]["found"]["suggested"])
        self.assertTrue(self.found()["searches"][0]["suggested"])
        self.assertIn("Found: The Dispossessed", self.output)

    def test_a_made_up_title_is_said_and_adds_nothing(self):
        title = "The Glass Orchard of Anarres"
        result = self.go([(title, LE_GUIN)],
                         bodies={address(title): noisy_page("The Dispossessed")})
        self.assertEqual(result["added"], 0)
        self.assertEqual(result["missing"], [f'"{title}" by {LE_GUIN}'])
        self.assertFalse(self.found_path.exists())
        self.assertIn("Not found:", self.output)
        self.assertIn("may be made up", self.output)

    def test_a_title_already_in_the_list_costs_no_request(self):
        self.go([("The Dispossessed", LE_GUIN)],
                bodies={address("The Dispossessed"): noisy_page("The Dispossessed")})
        requests = len(self.net.urls)
        result = self.go([("Dispossessed", "Le Guin")])
        self.assertEqual(result["already"], 1)
        self.assertEqual(len(self.net.urls), 0, "no request for a book already listed")
        self.assertGreater(requests, 0)


class LimitsAndFailures(SuggestTestCase):
    def test_at_most_ten_are_checked(self):
        many = [(f"Made Up Title {n}", LE_GUIN) for n in range(14)]
        result = self.go(many)
        self.assertEqual(result["checked"], find.MAX_SUGGESTIONS)
        self.assertEqual(len(self.net.urls), find.MAX_SUGGESTIONS)
        self.assertIn("Checking the first 10", self.output)

    def test_paced_five_seconds_apart(self):
        self.go([("The Dispossessed", LE_GUIN), ("The Lathe of Heaven", LE_GUIN)],
                bodies={address("The Dispossessed"): noisy_page("The Dispossessed"),
                        address("The Lathe of Heaven"): noisy_page("The Lathe of Heaven")})
        # robots.txt is given, so the first request has nothing before it to wait on.
        self.assertEqual(len(self.net.urls), 2)
        self.assertEqual(self.clock.sleeps, [5.0])

    def test_a_dead_connection_stops_after_the_first(self):
        net = FailingNetwork()
        net.stream = None
        result = self.go([("A", "B"), ("C", "D"), ("E", "F")], opener=net)
        self.assertTrue(result["stopped"])
        self.assertEqual(len(net.urls), 1)
        self.assertFalse(result["ok"])
        self.assertIn("Could not reach the library", self.output)


class TheCommandLine(unittest.TestCase):
    def main(self, argv, stdin=""):
        out, err = io.StringIO(), io.StringIO()
        old = sys.stdin
        sys.stdin = io.StringIO(stdin)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                try:
                    code = find.main(argv)
                except SystemExit as exit_:
                    code = exit_.code
        finally:
            sys.stdin = old
        return code, out.getvalue(), err.getvalue()

    def test_an_empty_list_stops_before_any_request(self):
        code, _out, err = self.main(["birds", "--suggest", "-"], stdin="\n# nothing\n")
        self.assertEqual(code, 2)
        self.assertIn("no suggested titles", err)

    def test_not_with_title(self):
        code, _out, err = self.main(["--title", "X", "--suggest", "-"], stdin="A | B\n")
        self.assertEqual(code, 2)
        self.assertIn("--suggest", err)

    def test_the_fixture_is_real(self):
        self.assertTrue(BRIEFS)


if __name__ == "__main__":
    unittest.main()
