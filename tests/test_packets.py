"""Tests for T8.5: one paste packet per mode brief.

A packet is for a person with a chat window and no repo: one text, pasted whole, that
asks a chat for one mode file. These tests hold the promises that make that work --
every brief has a packet, every packet has the six parts, nothing points at a machine
or a repo the person does not have, and --check is honest and writes nothing.

Packets are built in a temporary folder. Nothing here writes dist/.
"""

import contextlib
import io
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
REPO = TESTS.parent
TOOLS = REPO / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import packets  # noqa: E402

# The same check the task asks for, written once so a failure names the line.
FORBIDDEN = (
    "/home/",
    "~/",
    "http://localhost",
    "https://localhost",
    "residency",
)
AT_PATH_RE = re.compile(r"@[A-Za-z0-9_./~-]")


def copy_tree(root):
    """A small repo of the parts a packet reads: the docs and the example."""
    root = Path(root)
    (root / "docs").mkdir(parents=True, exist_ok=True)
    (root / "app" / "modes").mkdir(parents=True, exist_ok=True)
    shutil.copytree(REPO / "docs" / "modes", root / "docs" / "modes")
    shutil.copy2(REPO / "docs" / "CONTRACT.md", root / "docs" / "CONTRACT.md")
    for name in ("more-by.js", "more-by.check.js"):
        shutil.copy2(REPO / "app" / "modes" / name, root / "app" / "modes" / name)
    return root


def quiet_check(root, out):
    """packets.main --check, with its report kept out of the test's own output."""
    with contextlib.redirect_stdout(io.StringIO()):
        return packets.main(["--check"], root=root, out=out)


class PacketTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="packets-"))
        cls.out = cls.tmp / "dist" / "packets"
        packets.write_all(REPO, cls.out)
        cls.ids = packets.brief_ids(REPO)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def packet(self, mode_id):
        return (self.out / (mode_id + ".txt")).read_text(encoding="utf-8")

    def test_every_brief_produces_a_packet(self):
        names = {p.name for p in self.out.glob("*.txt")}
        expected = {mode_id + ".txt" for mode_id in self.ids} | {"README.txt"}
        self.assertEqual(names, expected)
        self.assertEqual(len(self.ids), 11, "the menu has eleven briefs")
        for mode_id in self.ids:
            self.assertTrue(self.packet(mode_id).startswith("NEXTBOOK MODE PACKET: " + mode_id))

    def test_every_packet_has_all_six_sections_in_order(self):
        for mode_id in self.ids:
            text = self.packet(mode_id)
            positions = [text.find(h) for h in packets.HEADINGS]
            self.assertNotIn(-1, positions, mode_id + " is missing a heading")
            self.assertEqual(positions, sorted(positions), mode_id + " has its headings out of order")
            self.assertEqual(packets.missing_sections(text), [], mode_id + " has an empty section")

    def test_packets_are_self_contained(self):
        for mode_id in self.ids:
            text = self.packet(mode_id)
            low = text.lower()
            for word in FORBIDDEN:
                self.assertNotIn(word, low, mode_id + " mentions " + word)
            self.assertIsNone(AT_PATH_RE.search(text), mode_id + " has an @ path")
            self.assertIsNone(re.search(r"\bT\d+(?:\.\d+[a-z]?)?\b", text), mode_id + " has a ticket id")
            self.assertNotIn("ticket", low, mode_id + " mentions a ticket")

    def test_packets_are_lf_only(self):
        for mode_id in self.ids:
            text = self.packet(mode_id)
            self.assertNotIn("\r", text, mode_id + " has a CR")
            self.assertNotIn("\r\n", text)

    def test_the_example_check_file_is_quoted_whole(self):
        check = (REPO / "app" / "modes" / "more-by.check.js").read_text(encoding="utf-8")
        mode = (REPO / "app" / "modes" / "more-by.js").read_text(encoding="utf-8")
        text = self.packet("survey")
        self.assertIn(check.replace("\r\n", "\n").strip("\n"), text)
        self.assertIn(mode.replace("\r\n", "\n").strip("\n"), text)
        self.assertIn("Nextbook.check('more-by'", text)

    def test_a_packet_is_a_readable_size(self):
        for mode_id in self.ids:
            size = len(self.packet(mode_id))
            self.assertGreaterEqual(size, packets.MIN_CHARS, mode_id + " is too short to be self-contained")
            self.assertLessEqual(size, packets.MAX_CHARS, mode_id + " is over the hard limit")

    def test_the_banned_names_are_quoted(self):
        names = packets.banned_names(REPO)
        self.assertGreaterEqual(len(names), 15)
        text = self.packet("survey")
        for name in names:
            self.assertIn(name, text, "the packet does not name " + name)

    def test_the_trimmed_example_keeps_the_code(self):
        mode, check = packets.example_parts(REPO, trim_comments=True)
        self.assertNotIn("// Pure:", mode)
        self.assertNotIn("// choose, on a tiny shelf", check)
        self.assertIn("likedAuthors(entries)", mode)
        self.assertIn("Nextbook.check('more-by'", check)

    def test_a_packet_over_the_limit_trims_comments_and_says_so(self):
        old = packets.MAX_CHARS
        packets.MAX_CHARS = 100
        try:
            text = packets.build_packet(REPO, "survey")
        finally:
            packets.MAX_CHARS = old
        self.assertNotIn("// Pure:", text)
        self.assertIn("Some comments were removed from the example", text)
        self.assertTrue(text.rstrip().endswith("short.)"), text.rstrip()[-80:])

    def test_the_readme_lists_every_packet_and_the_rule(self):
        text = (self.out / "README.txt").read_text(encoding="utf-8")
        for mode_id in self.ids:
            self.assertIn(mode_id + ".txt", text)
        self.assertIn("more-by.txt", text)
        self.assertIn("drops anything", text)
        self.assertIn("eleven packets", text)


class CheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="packets-check-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_check_passes_on_this_repo(self):
        self.assertEqual(quiet_check(REPO, self.tmp / "out"), 0)

    def test_check_writes_nothing(self):
        out = self.tmp / "out"
        self.assertEqual(quiet_check(REPO, out), 0)
        self.assertFalse(out.exists(), "--check made a folder")

    def test_check_fails_when_a_brief_is_removed(self):
        root = copy_tree(self.tmp / "repo")
        (root / "docs" / "modes" / "swap.md").unlink()
        code = quiet_check(root, self.tmp / "out")
        self.assertEqual(code, 2)
        self.assertFalse((self.tmp / "out").exists())

    def test_check_fails_when_a_brief_is_empty(self):
        root = copy_tree(self.tmp / "repo")
        (root / "docs" / "modes" / "ladder.md").write_text("", encoding="utf-8")
        self.assertEqual(quiet_check(root, self.tmp / "out"), 2)

    def test_check_fails_when_a_section_is_missing(self):
        sample = "\n\n".join(h + "\n\nsomething" for h in packets.HEADINGS[:5])
        missing = packets.missing_sections(sample)
        self.assertEqual(missing, [packets.HEADINGS[5]])

    def test_the_command_line_check_exits_zero(self):
        done = subprocess.run([sys.executable, str(TOOLS / "packets.py"), "--check"],
                              capture_output=True, text=True, cwd=str(REPO))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertTrue(done.stdout.startswith("OK: "), done.stdout)

    def test_an_unknown_id_exits_two(self):
        done = subprocess.run([sys.executable, str(TOOLS / "packets.py"), "not-a-mode"],
                              capture_output=True, text=True, cwd=str(REPO))
        self.assertEqual(done.returncode, 2)
        self.assertIn("I do not know the brief", done.stderr)

    def test_one_packet_goes_to_stdout_and_nothing_else(self):
        done = subprocess.run([sys.executable, str(TOOLS / "packets.py"), "survey"],
                              capture_output=True, text=True, cwd=str(REPO))
        self.assertEqual(done.returncode, 0)
        self.assertTrue(done.stdout.startswith("NEXTBOOK MODE PACKET: survey"))
        self.assertEqual(done.stdout.count("## 1. The job"), 1)
        self.assertEqual(done.stderr, "")


if __name__ == "__main__":
    unittest.main()
