"""Tests for the hand-written validator: it passes the shipped data and fails
the things AGENTS.md rule 4 and the schemas forbid. A validator that cannot fail
is not a check.
"""

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TESTS)
ADAPTERS = os.path.join(REPO, "adapters")
DATA = os.path.join(REPO, "data")

if ADAPTERS not in sys.path:
    sys.path.insert(0, ADAPTERS)

import validate as validator  # noqa: E402


def read(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


SLICE = read(os.path.join(DATA, "slice.json"))
SLICE_SCHEMA = read(os.path.join(DATA, "slice.schema.json"))
TAGS = read(os.path.join(DATA, "tags.json"))
TAGS_SCHEMA = read(os.path.join(DATA, "tags.schema.json"))
PRACTICE = read(os.path.join(DATA, "practice.json"))
PRACTICE_SCHEMA = read(os.path.join(DATA, "practice.schema.json"))


def errors_for(doc, schema):
    return validator.validate(doc, schema, "$")


class ShippedFiles(unittest.TestCase):
    def test_all_three_pass(self):
        for name in ("slice.json", "tags.json", "practice.json"):
            errors, _ = validator.validate_file(os.path.join(DATA, name))
            self.assertEqual(errors, [], "%s: %s" % (name, errors))

    def test_every_data_file_has_a_schema(self):
        for name in sorted(os.listdir(DATA)):
            if name.endswith(".json") and not name.endswith(".schema.json"):
                self.assertTrue(os.path.exists(validator.schema_path_for(os.path.join(DATA, name))),
                                name)


class ItCanFail(unittest.TestCase):
    def test_missing_required_key(self):
        doc = copy.deepcopy(SLICE)
        del doc["works"][0]["title"]
        errors = errors_for(doc, SLICE_SCHEMA)
        self.assertTrue(any("missing required key 'title'" in error for error in errors), errors)

    def test_wrong_type(self):
        doc = copy.deepcopy(SLICE)
        doc["works"][0]["year"] = "1974"
        errors = errors_for(doc, SLICE_SCHEMA)
        self.assertTrue(any("expected integer" in error for error in errors), errors)

    def test_nullable_field_still_checked(self):
        doc = copy.deepcopy(SLICE)
        doc["library"]["searchUrl"] = 7
        errors = errors_for(doc, SLICE_SCHEMA)
        self.assertTrue(any("library.searchUrl" in error for error in errors), errors)

    def test_forbidden_book_keys(self):
        for key in ("description", "jacket", "rating"):
            doc = copy.deepcopy(SLICE)
            doc["works"][3][key] = "x"
            errors = errors_for(doc, SLICE_SCHEMA)
            self.assertTrue(any(key in error for error in errors), (key, errors))

    def test_forbidden_key_in_a_tag_entry(self):
        doc = copy.deepcopy(TAGS)
        doc["works"]["pack:dispossessed"]["description"] = "a publisher blurb"
        errors = errors_for(doc, TAGS_SCHEMA)
        self.assertTrue(any("description" in error for error in errors), errors)

    def test_practice_keeps_rating_but_not_description(self):
        ok = copy.deepcopy(PRACTICE)
        ok["entries"][0]["rating"] = "loved"
        self.assertEqual(errors_for(ok, PRACTICE_SCHEMA), [])
        bad = copy.deepcopy(PRACTICE)
        bad["entries"][0]["description"] = "a publisher blurb"
        errors = errors_for(bad, PRACTICE_SCHEMA)
        self.assertTrue(any("description" in error for error in errors), errors)

    def test_unexpected_key(self):
        doc = copy.deepcopy(SLICE)
        doc["works"][0]["shelf"] = "read"
        errors = errors_for(doc, SLICE_SCHEMA)
        self.assertTrue(any("unexpected key 'shelf'" in error for error in errors), errors)

    def test_count_rules(self):
        doc = copy.deepcopy(SLICE)
        doc["facets"]["topic:memory"]["works"] = 1
        errors = errors_for(doc, SLICE_SCHEMA)
        self.assertTrue(any("below the minimum" in error for error in errors), errors)

    def test_practice_entry_count_and_state(self):
        doc = copy.deepcopy(PRACTICE)
        doc["entries"][0]["state"] = "finished"
        errors = errors_for(doc, PRACTICE_SCHEMA)
        self.assertTrue(any("is not one of" in error for error in errors), errors)

        short = copy.deepcopy(PRACTICE)
        short["entries"].pop()
        errors = errors_for(short, PRACTICE_SCHEMA)
        self.assertTrue(any("needs at least 13" in error for error in errors), errors)

    def test_bool_is_not_an_integer(self):
        doc = copy.deepcopy(SLICE)
        doc["works"][0]["year"] = True
        errors = errors_for(doc, SLICE_SCHEMA)
        self.assertTrue(any("expected integer" in error for error in errors), errors)


class SourcesCanBePackOrCatalogue(unittest.TestCase):
    """A future catalogue slice writes {url, fetched, bibs, works}; both must pass."""

    def test_the_shipped_pack_shaped_source_passes(self):
        self.assertEqual(errors_for(copy.deepcopy(SLICE), SLICE_SCHEMA), [])

    def test_a_catalogue_shaped_source_passes(self):
        doc = copy.deepcopy(SLICE)
        doc["sources"] = [{
            "url": "https://tpl.bibliocommons.com/v2/search?searchType=keyword&query=le+guin",
            "fetched": "2026-11-03",
            "bibs": 63,
            "works": 20,
        }]
        self.assertEqual(errors_for(doc, SLICE_SCHEMA), [])

    def test_a_source_with_an_extra_documented_key_passes(self):
        doc = copy.deepcopy(SLICE)
        doc["sources"][0]["note"] = "read once, on demand"
        self.assertEqual(errors_for(doc, SLICE_SCHEMA), [])

    def test_a_source_without_works_still_fails(self):
        doc = copy.deepcopy(SLICE)
        doc["sources"][0].pop("works")
        errors = errors_for(doc, SLICE_SCHEMA)
        self.assertTrue(any("missing required key 'works'" in error for error in errors), errors)

    def test_a_declared_source_field_is_still_type_checked(self):
        doc = copy.deepcopy(SLICE)
        doc["sources"][0]["bibs"] = "63"
        errors = errors_for(doc, SLICE_SCHEMA)
        self.assertTrue(any("bibs" in error and "expected integer" in error for error in errors),
                        errors)


class CommandLine(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="nextbook-validate-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_cli(self, *paths):
        return subprocess.run(
            [sys.executable, os.path.join(ADAPTERS, "validate.py")] + list(paths),
            cwd=REPO, capture_output=True, text=True,
        )

    def test_shipped_files_exit_zero(self):
        result = self.run_cli("data/slice.json", "data/tags.json", "data/practice.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("all 3 files valid", result.stdout)
        self.assertEqual(result.stdout.count("OK"), 3)

    def test_a_broken_file_exits_non_zero_and_names_the_key(self):
        doc = copy.deepcopy(SLICE)
        doc["works"][0]["description"] = "a publisher blurb"
        shutil.copy(os.path.join(DATA, "slice.schema.json"), self.tmp)
        broken = os.path.join(self.tmp, "slice.json")
        with open(broken, "w", encoding="utf-8") as handle:
            json.dump(doc, handle)
        result = self.run_cli(broken)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("FAIL", result.stdout)
        self.assertIn("description", result.stdout)

    def test_a_missing_schema_is_a_failure(self):
        empty = os.path.join(self.tmp, "tags.json")
        with open(empty, "w", encoding="utf-8") as handle:
            json.dump(TAGS, handle)
        result = self.run_cli(empty)
        self.assertEqual(result.returncode, 1)
        self.assertIn("no schema", result.stdout)


if __name__ == "__main__":
    unittest.main()
