"""Tests for T1.0: the pack becomes the slice, the tags and the practice shelf.

The tests read the shipped data/ files and rebuild them from the pack, so a hand
edit to a generated file, a dropped note or an invented facet fails here.
"""

import copy
import json
import os
import sys
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TESTS)
ADAPTERS = os.path.join(REPO, "adapters")
PACK_DIR = os.path.join(ADAPTERS, "pack")
DATA = os.path.join(REPO, "data")

for path in (ADAPTERS, PACK_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

import pack_to_slice as adapter  # noqa: E402


def read(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as handle:
        return json.load(handle)


def resolve_pack_path():
    """The pack's books.json: NEXTBOOK_PACK when set, else the documented default."""
    override = os.environ.get("NEXTBOOK_PACK")
    if override:
        return os.path.expanduser(override)
    return os.path.expanduser(adapter.load_config()["packPath"])


# The residency pack is not part of this repo; on another machine (or in CI)
# these tests skip, loudly, instead of erroring at import.
PACK_PATH = resolve_pack_path()
if not os.path.isfile(PACK_PATH):
    raise unittest.SkipTest(
        "the W13 residency pack is not on this machine: %s\n"
        "  set NEXTBOOK_PACK=<path to books.json> to run the pack tests" % PACK_PATH)

PACK, PACK_PATH = adapter.load_pack(PACK_PATH)
CONFIG = adapter.load_config()
SLICE = read("slice.json")
TAGS = read("tags.json")
PRACTICE = read("practice.json")


def walk_keys(value, found=None):
    """Every (path, key) pair in a JSON tree."""
    found = [] if found is None else found
    if isinstance(value, dict):
        for key, child in value.items():
            found.append(key)
            walk_keys(child, found)
    elif isinstance(value, list):
        for child in value:
            walk_keys(child, found)
    return found


class PackAgreesWithSlice(unittest.TestCase):
    def test_thirty_works_in_pack_order(self):
        self.assertEqual(len(SLICE["works"]), 30)
        self.assertEqual(len(SLICE["works"]), len(PACK["books"]))
        for work, book in zip(SLICE["works"], PACK["books"]):
            self.assertEqual(work["id"], book["id"])
            self.assertEqual(work["groupKey"], "pack:" + book["id"])
            self.assertEqual(work["title"], book["title"])
            self.assertEqual(work["author"], book["author"])
            self.assertEqual(work["year"], book["year"])

    def test_no_book_was_invented(self):
        pack_ids = {book["id"] for book in PACK["books"]}
        ids = [work["id"] for work in SLICE["works"]]
        self.assertEqual(len(ids), len(set(ids)), "duplicate work ids")
        self.assertEqual(set(ids), pack_ids)

    def test_library_is_search_only(self):
        library = SLICE["library"]
        self.assertEqual(library["name"], "Toronto Public Library")
        self.assertIsNone(library["recordUrl"])
        self.assertEqual(library["searchUrl"],
                         "https://tpl.bibliocommons.com/v2/search?searchType=keyword&query={q}")
        self.assertEqual(library["idPattern"], "^[a-z0-9-]+$")

    def test_formats_are_written_out_empty(self):
        for work in SLICE["works"]:
            self.assertEqual(work["formats"], [], work["id"])

    def test_ids_fit_the_pattern(self):
        import re
        pattern = re.compile(SLICE["library"]["idPattern"])
        for work in SLICE["works"]:
            self.assertRegex(work["id"], pattern)


class AuthorKey(unittest.TestCase):
    def test_examples(self):
        cases = {
            "Ursula K. Le Guin": "le guin, u",
            "Emily St. John Mandel": "mandel, e",
            "Walter M. Miller Jr.": "miller, w",
            "N. K. Jemisin": "jemisin, n",
            "Silvia Moreno-Garcia": "moreno-garcia, s",
            "C. L. Polk": "polk, c",
            "Toni Morrison": "morrison, t",
        }
        for name, expected in cases.items():
            self.assertEqual(adapter.author_key(name), expected, name)

    def test_every_work_has_one(self):
        for work in SLICE["works"]:
            self.assertEqual(work["authorKey"], adapter.author_key(work["author"]))
            self.assertIn(", ", work["authorKey"])


class ContentTypeAndAudience(unittest.TestCase):
    def test_every_work_follows_the_table(self):
        for work, book in zip(SLICE["works"], PACK["books"]):
            expected = "FICTION" if any(
                CONFIG["genreToContentType"][genre] == "FICTION" for genre in book["genre"]
            ) else "NONFICTION"
            self.assertEqual(work["contentType"], expected, work["id"])

    def test_a_mixed_genre_book_with_a_history_shelf_is_still_fiction(self):
        by_id = {work["id"]: work for work in SLICE["works"]}
        self.assertEqual(by_id["five-little-indians"]["contentType"], "FICTION")
        self.assertIn("section:900", by_id["five-little-indians"]["facets"])
        self.assertEqual(by_id["braiding"]["contentType"], "NONFICTION")

    def test_audience(self):
        by_id = {book["id"]: book for book in PACK["books"]}
        for work in SLICE["works"]:
            self.assertEqual(work["audience"], CONFIG["audience"][by_id[work["id"]]["audience"]])
        self.assertEqual(by_id["earthsea"]["audience"], "either")
        self.assertNotIn("either", {work["audience"] for work in SLICE["works"]})


class Facets(unittest.TestCase):
    def test_every_facet_is_in_the_dictionary(self):
        for work in SLICE["works"]:
            for facet in work["facets"]:
                self.assertIn(facet, SLICE["facets"], "%s: %s" % (work["id"], facet))

    def test_dictionary_counts_are_true(self):
        counts = {}
        for work in SLICE["works"]:
            for facet in work["facets"]:
                counts[facet] = counts.get(facet, 0) + 1
        for facet, entry in SLICE["facets"].items():
            self.assertEqual(entry["works"], counts.get(facet, 0), facet)
            self.assertGreaterEqual(entry["works"], 2, facet)
            self.assertTrue(entry["label"], facet)
            self.assertEqual(entry["kind"], facet.split(":", 1)[0])

    def test_singletons_were_dropped(self):
        # Each of these is carried by one work only in the pack, so rule 9 drops it.
        for facet in ("genre:horror", "genre:romance", "genre:nature", "genre:ideas",
                      "topic:childhood", "topic:money", "topic:nature"):
            self.assertNotIn(facet, SLICE["facets"])
            for work in SLICE["works"]:
                self.assertNotIn(facet, work["facets"])

    def test_three_facets_and_a_section_each(self):
        for work in SLICE["works"]:
            self.assertGreaterEqual(len(work["facets"]), 3, work["id"])
            sections = [f for f in work["facets"] if f.startswith("section:")]
            self.assertTrue(sections, work["id"])

    def test_at_least_six_sections(self):
        sections = adapter.sections_of(SLICE)
        self.assertGreaterEqual(len(sections), 6, sections)

    def test_section_labels_are_the_library_words(self):
        labels = {entry["label"] for key, entry in SLICE["facets"].items()
                  if key.startswith("section:")}
        self.assertIn("the science fiction shelves", labels)
        self.assertIn("the history shelves (900s)", labels)
        self.assertIn("the shelves about people and society (300s)", labels)

    def test_topic_facets_come_from_themes(self):
        themes = {theme for book in PACK["books"] for theme in book["themes"]}
        for facet in SLICE["facets"]:
            if facet.startswith("topic:"):
                self.assertIn(facet.split(":", 1)[1], themes)


class Tags(unittest.TestCase):
    def test_every_book_is_tagged_under_its_group_key(self):
        self.assertEqual(set(TAGS["works"]), {"pack:" + b["id"] for b in PACK["books"]})

    def test_mood_pace_and_note_are_the_packs_words(self):
        for book in PACK["books"]:
            entry = TAGS["works"]["pack:" + book["id"]]
            self.assertEqual(entry["mood"], book["mood"], book["id"])
            self.assertEqual(entry["pace"], book["pace"], book["id"])
            self.assertEqual(entry["note"], book["note"], book["id"])

    def test_vocab_is_the_packs_vocab(self):
        self.assertEqual(TAGS["vocab"]["mood"], PACK["vocab"]["mood"])
        self.assertEqual(TAGS["vocab"]["pace"], PACK["vocab"]["pace"])
        for entry in TAGS["works"].values():
            self.assertIn(entry["pace"], TAGS["vocab"]["pace"])
            for mood in entry["mood"]:
                self.assertIn(mood, TAGS["vocab"]["mood"])


class Practice(unittest.TestCase):
    def setUp(self):
        self.entries = PRACTICE["entries"]
        self.ratings = [entry["rating"] for entry in self.entries]
        self.states = [entry["state"] for entry in self.entries]

    def test_twelve_entries_with_the_asked_spread(self):
        self.assertEqual(len(self.entries), 12)
        self.assertEqual(self.ratings.count("loved"), 4)
        self.assertEqual(self.ratings.count("liked"), 3)
        self.assertEqual(self.ratings.count("ok"), 1)
        self.assertEqual(self.ratings.count("not-for-me"), 1)
        self.assertEqual(self.states.count("stopped"), 1)
        self.assertEqual(self.states.count("reading"), 1)
        self.assertEqual(self.states.count("want"), 1)

    def test_unrated_states_carry_no_rating(self):
        for entry in self.entries:
            if entry["state"] in ("stopped", "reading", "want"):
                self.assertIsNone(entry["rating"], entry["id"])
            else:
                self.assertIsNotNone(entry["rating"], entry["id"])

    def test_entries_point_at_slice_works(self):
        works = {work["groupKey"]: work for work in SLICE["works"]}
        ids = [entry["id"] for entry in self.entries]
        self.assertEqual(len(ids), len(set(ids)), "a book is on the shelf twice")
        for entry in self.entries:
            self.assertIn(entry["groupKey"], works)
            work = works[entry["groupKey"]]
            self.assertEqual(entry["id"], work["id"])
            self.assertEqual(entry["title"], work["title"])
            self.assertEqual(entry["author"], work["author"])
            self.assertEqual(entry["key"], "w:" + entry["groupKey"])

    def test_spread_of_sections_and_genres(self):
        works = {work["id"]: work for work in SLICE["works"]}
        sections = set()
        genres = set()
        for entry in self.entries:
            for facet in works[entry["id"]]["facets"]:
                if facet.startswith("section:"):
                    sections.add(facet)
                elif facet.startswith("genre:"):
                    genres.add(facet)
        self.assertGreaterEqual(len(sections), 5, sections)
        self.assertGreaterEqual(len(genres), 5, genres)

    def test_dates_are_fixed_not_generated(self):
        dates = [entry["updated"] for entry in self.entries]
        self.assertEqual(len(dates), len(set(dates)))
        for date in dates:
            self.assertRegex(date, r"^2026-10-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(dates, sorted(dates))


class NoBlurbs(unittest.TestCase):
    def test_no_book_carries_a_publisher_blurb_or_a_rating(self):
        for work in SLICE["works"]:
            for key in ("description", "jacket", "rating"):
                self.assertNotIn(key, work)
        for entry in TAGS["works"].values():
            for key in ("description", "jacket", "rating"):
                self.assertNotIn(key, entry)
        for entry in PRACTICE["entries"]:
            for key in ("description", "jacket"):
                self.assertNotIn(key, entry)

    def test_no_file_has_a_description_or_jacket_key_anywhere(self):
        for name in ("slice.json", "tags.json", "practice.json", "slice.schema.json",
                     "tags.schema.json", "practice.schema.json"):
            keys = walk_keys(read(name))
            self.assertNotIn("description", keys, name)
            self.assertNotIn("jacket", keys, name)


class Reproducible(unittest.TestCase):
    def test_the_builder_is_deterministic(self):
        first, dropped_first = adapter.build_slice(PACK, CONFIG, PACK_PATH)
        second, dropped_second = adapter.build_slice(copy.deepcopy(PACK), CONFIG, PACK_PATH)
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))
        self.assertEqual(dropped_first, dropped_second)

    def test_shipped_files_match_a_fresh_build(self):
        slice_doc, _ = adapter.build_slice(PACK, CONFIG, PACK_PATH)
        self.assertEqual(SLICE, json.loads(json.dumps(slice_doc)))
        self.assertEqual(TAGS, json.loads(json.dumps(adapter.build_tags(PACK, CONFIG))))
        self.assertEqual(PRACTICE, json.loads(json.dumps(adapter.build_practice(PACK, CONFIG))))

    def test_dropped_facets_are_named(self):
        _, dropped = adapter.build_slice(PACK, CONFIG, PACK_PATH)
        self.assertEqual(len(dropped), 13, dropped)
        self.assertIn("section:500", dropped)
        self.assertEqual(dropped, sorted(dropped))


if __name__ == "__main__":
    unittest.main()
