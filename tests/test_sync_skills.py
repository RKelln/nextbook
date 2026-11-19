"""The Claude Code copies of the skills match .agents/skills/ (run tools/sync-skills.py to fix)."""
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class SyncSkillsTest(unittest.TestCase):
    def test_check_passes(self):
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "sync-skills.py"), "--check"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_sources_are_portable(self):
        for p in (ROOT / ".agents" / "skills").glob("*/SKILL.md"):
            text = p.read_text(encoding="utf-8")
            self.assertRegex(text, r"\A---\nname: %s\ndescription: .+\n---\n" % re.escape(p.parent.name), str(p))
            self.assertNotIn("$ARGUMENTS", text, str(p))
            self.assertNotIn(".claude/", text, str(p))


if __name__ == "__main__":
    unittest.main()
