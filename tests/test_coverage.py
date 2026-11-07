"""tools/coverage.py says which fields the data really carries."""
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Coverage(unittest.TestCase):
    def test_it_reports_hand_tags_as_pack_only(self):
        out = subprocess.run([sys.executable, str(ROOT / "tools" / "coverage.py")],
                             capture_output=True, text=True, check=True).stdout
        self.assertIn("books in the list", out)
        self.assertIn("hand-written pace word", out)
        self.assertIn("parts of the library", out)
        self.assertIn("cover only the starting pack", out)


if __name__ == "__main__":
    unittest.main()
