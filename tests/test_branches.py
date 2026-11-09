"""data/branches.json: the library's branches with their places, for the travel-time tool."""

import json
import os
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(REPO, "data", "branches.json"), encoding="utf-8") as handle:
    BRANCHES = json.load(handle)


class BranchesTest(unittest.TestCase):
    def test_shape(self):
        self.assertEqual(set(BRANCHES), {"fetched", "source", "branches"})
        rows = BRANCHES["branches"]
        self.assertEqual(len(rows), 94)
        for row in rows:
            self.assertEqual(set(row) - {"aliases", "code"}, {"name", "street", "lat", "lon"})
            self.assertTrue(43 < row["lat"] < 44.2 and -80 < row["lon"] < -78.8, row["name"])

    def test_codes_and_names_are_unique(self):
        rows = BRANCHES["branches"]
        codes = [r["code"] for r in rows if "code" in r]
        self.assertEqual(len(set(codes)), len(codes))
        self.assertEqual([r["name"] for r in rows if "code" not in r], ["Amesbury Park", "Cedarbrae"],
                         "the two added from the events service have no feed code and none is invented")
        self.assertEqual(len({r["name"] for r in rows}), len(rows))


if __name__ == "__main__":
    unittest.main()
