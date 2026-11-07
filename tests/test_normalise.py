"""Tests for the normaliser: one per rule in docs/DATA.md, from the fixture."""
import json
import unittest
from pathlib import Path

from adapters.bibliocommons import normalise as n

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "tpl" / "briefs-le-guin.json"
BRIEFS = json.loads(FIXTURE.read_text(encoding="utf-8"))


def facets(**brief):
    return n.facets_for(brief)


class RuleOneAuthorHeadings(unittest.TestCase):
    def test_an_author_heading_is_dropped(self):
        heading = "Kimmerer, Robin Wall, 1953-"
        self.assertEqual(facets(subjectHeadings=[heading]), set())
        self.assertTrue(n.is_author_heading(heading, ["Kimmerer, Robin Wall, 1953-"]))

    def test_a_heading_matching_the_work_s_author_is_dropped(self):
        self.assertEqual(
            facets(subjectHeadings=["Le Guin, Ursula K."], authors=["Le Guin, Ursula K."]),
            set())
        self.assertFalse(n.is_author_heading("Wizards Juvenile fiction.",
                                             ["Le Guin, Ursula K."]))


class RuleTwoFastHeadings(unittest.TestCase):
    def test_a_fast_heading_is_dropped(self):
        self.assertEqual(facets(subjectHeadings=["Dragons. fast"]), set())
        self.assertTrue(n.is_fast_heading("Women. fast"))
        self.assertFalse(n.is_fast_heading("Dragons."))


class RuleThreeBisac(unittest.TestCase):
    def test_the_second_level_is_kept(self):
        self.assertEqual(
            facets(subjectHeadings=["FICTION / Science Fiction / Action & Adventure bisacsh"]),
            {"bisac:science-fiction"})

    def test_general_falls_back_to_the_top_level(self):
        self.assertEqual(
            facets(subjectHeadings=["JUVENILE FICTION / General. bisacsh"]),
            {"bisac:juvenile-fiction"})


class RuleFourFormSubdivisions(unittest.TestCase):
    def test_the_form_word_is_stripped_to_give_the_topic(self):
        self.assertEqual(facets(subjectHeadings=["Wizards Juvenile fiction."]),
                         {"topic:wizards"})
        self.assertEqual(facets(subjectHeadings=["Communal living Fiction."]),
                         {"topic:communal-living"})

    def test_the_longest_form_word_wins(self):
        self.assertEqual(facets(subjectHeadings=["Cats Juvenile fiction."]),
                         {"topic:cats"})
        self.assertEqual(facets(subjectHeadings=["Comic books, strips, etc"]), set())

    def test_a_heading_with_no_form_word_is_still_a_topic(self):
        self.assertEqual(facets(subjectHeadings=["Magic"]), {"topic:magic"})


class RuleFiveGenres(unittest.TestCase):
    def test_a_genre_word_becomes_a_genre(self):
        self.assertEqual(facets(subjectHeadings=["Science Fiction"]), {"genre:science-fiction"})
        self.assertEqual(facets(subjectHeadings=["Fantasy."]), {"genre:fantasy"})

    def test_genre_form_values_are_genres(self):
        self.assertEqual(facets(genreForm=["Juvenile fiction"]), {"genre:juvenile-fiction"})
        self.assertEqual(facets(genreForm=["Science fiction", "Fiction"]),
                         {"genre:science-fiction"})

    def test_fiction_and_literature_alone_say_nothing(self):
        self.assertEqual(facets(subjectHeadings=["Fiction"]), set())
        self.assertEqual(facets(subjectHeadings=["Literature"]), set())
        self.assertEqual(facets(genreForm=["Fiction"]), set())


class RuleSixSections(unittest.TestCase):
    def test_fiction_shelf_words(self):
        self.assertEqual(facets(callNumber="SCIENCE FICTION LEG"),
                         {"section:science-fiction"})
        self.assertEqual(n.section_from_call_number("FICTION LEG"), "section:fiction")
        self.assertEqual(n.section_from_call_number("LHS FIC LEG"), "section:fiction")

    def test_dewey_hundreds(self):
        self.assertEqual(facets(callNumber="813.54 L2453.109"), {"section:800"})
        self.assertEqual(n.section_from_call_number("523.58 GOL"), "section:500")
        self.assertEqual(n.section_from_call_number("025.4 LEG"), "section:000")

    def test_on_order_and_absent_give_no_section(self):
        self.assertEqual(facets(callNumber="ON ORDER"), set())
        self.assertEqual(facets(callNumber=None), set())
        self.assertEqual(facets(), set())
        self.assertIsNone(n.section_from_call_number("EB00K"))

    def test_the_section_labels_are_the_words_the_pack_uses(self):
        self.assertEqual(n.section_label("section:000"), "general works (000s)")
        self.assertEqual(n.section_label("section:100"), "the philosophy shelves (100s)")
        self.assertEqual(n.section_label("section:200"), "the religion shelves (200s)")
        self.assertEqual(n.section_label("section:300"),
                         "the shelves about people and society (300s)")
        self.assertEqual(n.section_label("section:400"), "the language shelves (400s)")
        self.assertEqual(n.section_label("section:500"), "the science shelves (500s)")
        self.assertEqual(n.section_label("section:600"),
                         "the shelves about how things are made (600s)")
        self.assertEqual(n.section_label("section:700"), "the art shelves (700s)")
        self.assertEqual(n.section_label("section:800"), "the literature shelves (800s)")
        self.assertEqual(n.section_label("section:900"), "the history shelves (900s)")
        self.assertEqual(n.section_label("section:science-fiction"),
                         "the science fiction shelves")
        self.assertEqual(n.section_label("section:fantasy"), "the fantasy shelves")
        self.assertEqual(n.section_label("section:mystery"), "the mystery shelves")
        self.assertEqual(n.section_label("section:horror"), "the horror shelves")
        self.assertEqual(n.section_label("section:romance"), "the romance shelves")
        self.assertEqual(n.section_label("section:fiction"), "the fiction shelves")
        self.assertIsNone(n.section_label("section:unknown"))


class RuleSevenSeries(unittest.TestCase):
    def test_a_series_is_trimmed_and_slugged(self):
        brief = {"series": [{"name": "Earthsea ", "volume": "2."}]}
        self.assertEqual(facets(**brief), {"series:earthsea"})
        self.assertEqual(n.labels_for(brief)["series:earthsea"], "the Earthsea series")


class RuleEightMerge(unittest.TestCase):
    def test_the_fixture_gives_twenty_works(self):
        self.assertEqual(len(n.works_from(BRIEFS)), 20)

    def test_a_work_is_the_union_of_its_manifestations(self):
        works = n.works_from(BRIEFS)
        groups = {}
        for brief in BRIEFS:
            groups.setdefault(brief["groupKey"], []).append(brief)
        for work in works:
            expected = set()
            for brief in groups[work["groupKey"]]:
                expected |= n.facets_for(brief)
            self.assertEqual(set(work["facets"]), expected)
            self.assertNotIn("description", work)

    def test_the_preferred_format_gives_the_record_id(self):
        self.assertEqual(n._format_rank("BK") < n._format_rank("LPRINT") <
                         n._format_rank("EBOOK") < n._format_rank("EAUDIOBOOK") <
                         n._format_rank("DVD"), True)
        work = n.work_from([
            {"groupKey": "g", "id": "audio", "format": "EAUDIOBOOK",
             "title": "A Book", "authors": ["Le Guin, Ursula K."]},
            {"groupKey": "g", "id": "print", "format": "BK",
             "title": "A Book", "authors": ["Le Guin, Ursula K."]},
            {"groupKey": "g", "id": "ebook", "format": "EBOOK",
             "title": "A Book", "authors": ["Le Guin, Ursula K."]},
        ])
        self.assertEqual(work["id"], "print")
        self.assertEqual(work["formats"], ["BK", "EBOOK", "EAUDIOBOOK"])
        self.assertEqual(work["author"], "Ursula K. Le Guin")


class Words(unittest.TestCase):
    def test_slug(self):
        self.assertEqual(n.slug("Wizards"), "wizards")
        self.assertEqual(n.slug("Life on other planets."), "life-on-other-planets")
        self.assertEqual(n.slug("Fantasy & Magic"), "fantasy-magic")
        self.assertEqual(n.slug("  "), "")

    def test_author_display(self):
        self.assertEqual(n.author_display("Le Guin, Ursula K., 1929-2018"),
                         "Ursula K. Le Guin")
        self.assertEqual(n.author_display("Golub, L. (Leon)"), "L. Golub")
        self.assertEqual(n.author_display("Guin, Ursula K. Le"), "Ursula K. Le Guin")

    def test_author_key(self):
        self.assertEqual(n.author_key("Golub, L. (Leon)"), "golub, l")
        self.assertEqual(n.author_key("Le Guin, Ursula K., 1929-2018"), "le guin, u")


class AuthorSpellings(unittest.TestCase):
    """TPL files a particle surname two ways; both must key the same."""

    def test_both_spellings_key_the_same(self):
        self.assertEqual(n.author_key("Le Guin, Ursula K., 1929-2018"), "le guin, u")
        self.assertEqual(n.author_key("Le Guin, Ursula"), "le guin, u")
        self.assertEqual(n.author_key("Guin, Ursula K. Le"), "le guin, u")

    def test_the_reversed_spelling_displays_with_the_particle(self):
        self.assertEqual(n.author_display("Guin, Ursula K. Le"), "Ursula K. Le Guin")

    def test_a_lowercase_particle_is_moved_too(self):
        self.assertEqual(n.author_key("Berg, Jan van"), "van berg, j")

    def test_a_last_word_that_is_not_a_particle_is_left_alone(self):
        self.assertEqual(n.author_key("Mandel, Emily St. John"), "mandel, e")
        self.assertEqual(n.author_key("Miller, Walter M. Jr."), "miller, w")
        self.assertEqual(n.author_key("Kimmerer, Robin Wall"), "kimmerer, r")


class AuthorKeysMeetTheSlice(unittest.TestCase):
    def test_a_found_work_keys_the_way_the_pack_does(self):
        slice_works = json.loads(
            (Path(__file__).resolve().parent.parent / "data" / "slice.json")
            .read_text(encoding="utf-8"))["works"]
        slice_by_author = {work["author"]: work["authorKey"] for work in slice_works}
        # The four pack authors this page can show; the slice writes each key.
        pack_keys = {"le guin, u", "atwood, m", "mandel, e", "kimmerer, r"}
        self.assertLessEqual(pack_keys, {work["authorKey"] for work in slice_works})

        matched = 0
        for work in n.works_from(BRIEFS):
            expected = slice_by_author.get(work["author"])
            if expected is None:
                continue
            matched += 1
            self.assertEqual(work["authorKey"], expected, work["author"])
        self.assertGreaterEqual(matched, 1, "no fixture author is a pack author")
        # Every authored work on this page is Le Guin, under either spelling.
        self.assertEqual({work["authorKey"] for work in n.works_from(BRIEFS)
                          if work["author"]}, {"le guin, u"})

    def test_the_three_pack_titles_carry_the_slice_key(self):
        slice_by_title = {}
        for work in json.loads(
                (Path(__file__).resolve().parent.parent / "data" / "slice.json")
                .read_text(encoding="utf-8"))["works"]:
            slice_by_title.setdefault(work["title"], set()).add(work["authorKey"])
        found = {}
        for work in n.works_from(BRIEFS):
            found.setdefault(work["title"], set()).add(work["authorKey"])
        for title in ("A Wizard of Earthsea", "The Dispossessed",
                      "The Left Hand of Darkness"):
            self.assertIn(title, found)
            self.assertEqual(found[title], slice_by_title[title], title)


class PackConfigAgreesWithThisConfig(unittest.TestCase):
    """The pack's genre table writes the same shelf words this module does."""

    def test_every_label_matches_character_for_character(self):
        path = Path(__file__).resolve().parent.parent / "adapters" / "pack" / "config.json"
        table = json.loads(path.read_text(encoding="utf-8"))["genreToSection"]
        self.assertEqual(len(table), 12, sorted(table))
        for genre, entry in table.items():
            self.assertIsInstance(entry["label"], str, genre)
            self.assertEqual(entry["label"], n.section_label("section:" + entry["key"]),
                             genre)


class FixtureFacets(unittest.TestCase):
    def test_every_work_has_facets_and_a_section(self):
        works = n.works_from(BRIEFS)
        self.assertTrue(all(work["facets"] for work in works))
        self.assertTrue(any(f.startswith("section:") for f in
                            [facet for work in works for facet in work["facets"]]))


if __name__ == "__main__":
    unittest.main()
