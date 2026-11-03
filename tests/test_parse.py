"""Tests for the search-page parser. No network."""
import json
import unittest
from pathlib import Path

from adapters.bibliocommons import parse

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "tpl"


def tiny_page():
    payload = {
        "entities": {
            "bibs": {
                "S1C1": {"briefInfo": {
                    "id": "S1C1", "groupKey": "a_group", "title": "A Book",
                    "authors": ["Ursula K. Le Guin"],
                    "subjectHeadings": ["Wizards Juvenile fiction."],
                    "callNumber": "813.54 LEG",
                    "description": "The publisher's blurb. -- Provided by publisher.",
                    "jacket": {"type": "SYNDETICS", "url": "https://example.invalid/j.jpg"},
                    "rating": {"average": 4.5},
                }},
                "S2C2": {"briefInfo": {
                    "id": "S2C2", "groupKey": "b_group", "title": "Another Book",
                    "authors": [], "subjectHeadings": [],
                }},
            }
        }
    }
    return ("<html><head></head><body>"
            '<script type="application/json">' + json.dumps(payload) + "</script>"
            "</body></html>")


class BriefsTest(unittest.TestCase):
    def test_a_tiny_hand_made_page(self):
        briefs = parse.briefs(tiny_page())
        self.assertEqual([b["id"] for b in briefs], ["S1C1", "S2C2"])
        self.assertEqual(briefs[0]["title"], "A Book")
        self.assertEqual(briefs[0]["subjectHeadings"], ["Wizards Juvenile fiction."])
        self.assertEqual(briefs[0]["callNumber"], "813.54 LEG")

    def test_description_jacket_and_rating_are_dropped(self):
        brief = parse.briefs(tiny_page())[0]
        for field in parse.DROPPED_FIELDS:
            self.assertNotIn(field, brief)
        self.assertEqual(sorted(brief), ["authors", "callNumber", "groupKey", "id",
                                         "subjectHeadings", "title"])

    def test_a_page_without_the_block_raises(self):
        with self.assertRaises(parse.ParseError):
            parse.briefs("<html><body>a page with no payload</body></html>")

    def test_a_broken_json_block_is_skipped_for_a_later_one(self):
        page = ('<script type="application/json">{not json}</script>'
                '<script type="application/json">{"entities": {"bibs": {}}}</script>')
        self.assertEqual(parse.briefs(page), [])

    def test_every_bib_on_a_long_page_is_kept(self):
        # A page of 25: a reader that stops at the first ten (a slice) must fail
        # here, not on a fixture nobody grows.
        bibs = {}
        for number in range(25):
            record_id = "S%03dC1" % number
            bibs[record_id] = {"briefInfo": {
                "id": record_id,
                "groupKey": "group_%03d" % number,
                "title": "Book %d" % number,
                "authors": ["Author, A."],
                "subjectHeadings": ["Magic"],
            }}
        page = ('<html><body><script type="application/json">'
                + json.dumps({"entities": {"bibs": bibs}})
                + "</script></body></html>")
        found = parse.briefs(page)
        self.assertEqual(len(found), 25)
        self.assertEqual([brief["id"] for brief in found],
                         ["S%03dC1" % number for number in range(25)])


class FixtureTest(unittest.TestCase):
    def test_the_saved_page_still_holds_its_briefs(self):
        briefs = json.loads((FIXTURES / "briefs-le-guin.json").read_text(encoding="utf-8"))
        self.assertEqual(len(briefs), 63)
        self.assertEqual(len({b["groupKey"] for b in briefs}), 20)
        for brief in briefs:
            for field in parse.DROPPED_FIELDS:
                self.assertNotIn(field, brief)


if __name__ == "__main__":
    unittest.main()
