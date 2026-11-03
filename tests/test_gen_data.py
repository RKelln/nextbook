"""Tests for T1.7: data/*.json -> app/data/*.js, with escapes that cannot be eaten.

Two things are being proved here. First, the generated file is a real script
that a JSON reader and a JavaScript engine both give back unchanged. Second, no
text from the data can end the script element: `<`, `>` and `&` reach disk as
the six characters `\\u003c`, `\\u003e`, `\\u0026`, never as themselves.

Every test that writes files does it in a temporary folder. The repo's own
data/ and app/data/ are only read, and only by the last test.
"""
import json
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

import gen_data  # noqa: E402

SCRIPT = TOOLS / "gen_data.py"


def run_cli(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          capture_output=True, text=True)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def body_of(text: str, name: str) -> str:
    """The JSON inside `Nextbook.data.put('<name>', ...);`."""
    prefix = f"Nextbook.data.put('{name}', "
    assert text.startswith(prefix), text[:80]
    assert text.endswith(");\n"), repr(text[-10:])
    return text[len(prefix):-3]


class TheEscapesThemselves(unittest.TestCase):
    def test_each_escape_is_six_characters(self):
        self.assertEqual(set(gen_data.JSON_OUT_ESCAPES),
                         {"<", ">", "&", chr(0x2028), chr(0x2029)})
        for char, escape in gen_data.JSON_OUT_ESCAPES.items():
            self.assertEqual(len(escape), 6, escape)
            self.assertEqual(escape[0], "\\")
            self.assertEqual(escape[1], "u")
            self.assertRegex(escape[2:], r"^[0-9a-f]{4}$")
            self.assertEqual(int(escape[2:], 16), ord(char))

    def test_js_text_replaces_all_three(self):
        text = gen_data.js_text("x", {"t": "a < b > c & d"})
        self.assertNotIn("<", text)
        self.assertNotIn(">", text)
        self.assertNotIn("&", text)
        backslash = chr(92)
        self.assertIn(backslash + "u003c", text)
        self.assertIn(backslash + "u003e", text)
        self.assertIn(backslash + "u0026", text)
        self.assertEqual(json.loads(body_of(text, "x")), {"t": "a < b > c & d"})


class AHostileTitle(unittest.TestCase):
    """`</script>` in a title must not end the script that carries the data."""

    TITLE = "</script><script>alert('x')</script> & <b>bold</b> 5 > 4"
    VALUE = {"schema": "nextbook/tags-1", "works": {"k": {"note": TITLE}}}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / "data"
        self.out = Path(self.tmp.name) / "app" / "data"
        write_json(self.data / "tags.json", self.VALUE)

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_literal_angle_bracket_or_ampersand_reaches_disk(self):
        self.assertEqual(run_cli("--data-dir", str(self.data), "--out-dir", str(self.out)).returncode, 0)
        text = (self.out / "tags.js").read_text(encoding="utf-8")
        self.assertNotIn("<", text)
        self.assertNotIn(">", text)
        self.assertNotIn("&", text)
        self.assertNotIn("</script>", text)
        self.assertIn(chr(92) + "u003c/script" + chr(92) + "u003e", text)

    def test_the_json_round_trips(self):
        gen_data.build(self.data, self.out)
        text = (self.out / "tags.js").read_text(encoding="utf-8")
        self.assertEqual(json.loads(body_of(text, "tags")), self.VALUE)

    @unittest.skipIf(shutil.which("node") is None, "node is not installed")
    def test_javascript_gives_the_title_back(self):
        gen_data.build(self.data, self.out)
        driver = Path(self.tmp.name) / "load.js"
        driver.write_text(
            "const fs = require('fs');\n"
            "const vm = require('vm');\n"
            "const data = {};\n"
            "vm.runInNewContext(fs.readFileSync(process.argv[2], 'utf8'),\n"
            "  {Nextbook: {data: {put: function (name, value) { data[name] = value; }}}});\n"
            "process.stdout.write(JSON.stringify(data));\n",
            encoding="utf-8")
        result = subprocess.run(["node", str(driver), str(self.out / "tags.js")],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        loaded = json.loads(result.stdout)
        self.assertEqual(loaded["tags"]["works"]["k"]["note"], self.TITLE)


class LineSeparators(unittest.TestCase):
    """U+2028 and U+2029: legal JSON, a broken JavaScript literal before ES2019.

    A note can carry one (a catalogue's own text, or a person's), so it must
    reach disk as the six characters `\\u2028` / `\\u2029` and still read back
    as the same string.
    """

    NOTE = "one" + chr(0x2028) + "two" + chr(0x2029) + "three"
    VALUE = {"schema": "nextbook/tags-1", "works": {"k": {"note": NOTE}}}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / "data"
        self.out = Path(self.tmp.name) / "app" / "data"
        write_json(self.data / "tags.json", self.VALUE)

    def tearDown(self):
        self.tmp.cleanup()

    def generated(self) -> str:
        gen_data.build(self.data, self.out)
        return (self.out / "tags.js").read_text(encoding="utf-8")

    def test_no_raw_line_separator_reaches_disk(self):
        raw = self.generated().encode("utf-8")
        self.assertNotIn(b"\xe2\x80\xa8", raw, "a raw U+2028 was written")
        self.assertNotIn(b"\xe2\x80\xa9", raw, "a raw U+2029 was written")
        text = raw.decode("utf-8")
        backslash = chr(92)
        self.assertIn(backslash + "u2028", text)
        self.assertIn(backslash + "u2029", text)

    def test_the_note_round_trips(self):
        self.assertEqual(json.loads(body_of(self.generated(), "tags")), self.VALUE)

    @unittest.skipIf(shutil.which("node") is None, "node is not installed")
    def test_javascript_gives_the_note_back(self):
        self.generated()
        driver = Path(self.tmp.name) / "load.js"
        driver.write_text(
            "const fs = require('fs');\n"
            "const vm = require('vm');\n"
            "const data = {};\n"
            "vm.runInNewContext(fs.readFileSync(process.argv[2], 'utf8'),\n"
            "  {Nextbook: {data: {put: function (name, value) { data[name] = value; }}}});\n"
            "process.stdout.write(JSON.stringify(data));\n",
            encoding="utf-8")
        result = subprocess.run(["node", str(driver), str(self.out / "tags.js")],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        loaded = json.loads(result.stdout)
        self.assertEqual(loaded["tags"]["works"]["k"]["note"], self.NOTE)


class CheckAndWrite(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / "data"
        self.out = Path(self.tmp.name) / "app" / "data"
        write_json(self.data / "slice.json", {"schema": "nextbook/slice-1", "works": []})
        write_json(self.data / "tags.json", {"schema": "nextbook/tags-1", "works": {}})

    def tearDown(self):
        self.tmp.cleanup()

    def cli(self, *args):
        return run_cli("--data-dir", str(self.data), "--out-dir", str(self.out), *args)

    def test_check_passes_only_after_a_run(self):
        self.assertEqual(self.cli("--check").returncode, 1)
        self.assertEqual(self.cli().returncode, 0)
        result = self.cli("--check")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("up to date (2 files)", result.stdout)

    def test_check_fails_after_the_data_changes(self):
        self.assertEqual(self.cli().returncode, 0)
        changed = json.loads((self.data / "tags.json").read_text(encoding="utf-8"))
        changed["works"]["pack:x"] = {"note": "changed"}
        write_json(self.data / "tags.json", changed)
        result = self.cli("--check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("tags.js", result.stdout)
        self.assertIn("old", result.stdout)
        self.assertEqual(self.cli().returncode, 0)
        self.assertEqual(self.cli("--check").returncode, 0)

    def test_a_missing_json_is_skipped_without_error(self):
        result = self.cli()
        self.assertEqual(result.returncode, 0)
        self.assertIn("wrote", result.stdout)
        self.assertIn("no data/found.json", result.stdout)
        self.assertFalse((self.out / "found.js").exists())
        self.assertFalse((self.out / "events.js").exists())

    def test_a_file_with_no_json_left_is_removed_and_is_stale(self):
        (self.out).mkdir(parents=True)
        (self.out / "events.js").write_text("Nextbook.data.put('events', {});\n", encoding="utf-8")
        self.assertEqual(self.cli("--check").returncode, 1)
        result = self.cli()
        self.assertEqual(result.returncode, 0)
        self.assertFalse((self.out / "events.js").exists())
        self.assertIn("removed", result.stdout)
        self.assertEqual(self.cli("--check").returncode, 0)

    def test_only_the_five_names_are_written(self):
        (self.data / "workshop.json").write_text("{}", encoding="utf-8")
        self.cli()
        self.assertEqual(sorted(path.name for path in self.out.glob("*.js")),
                         ["slice.js", "tags.js"])

    def test_the_call_is_one_line_confined_call(self):
        self.cli()
        text = (self.out / "slice.js").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("Nextbook.data.put('slice', {"))
        self.assertTrue(text.endswith(");\n"))
        self.assertEqual(text.count("Nextbook.data.put("), 1)

    def test_invalid_json_says_which_file(self):
        (self.data / "tags.json").write_text("{not json", encoding="utf-8")
        result = self.cli()
        self.assertEqual(result.returncode, 2)
        self.assertIn("tags.json", result.stderr)
        self.assertIn("not valid JSON", result.stderr)


class TheShippedFiles(unittest.TestCase):
    """The committed app/data files are what data/ says they are."""

    def test_the_committed_data_is_current(self):
        problems = gen_data.check(REPO / "data", REPO / "app" / "data",
                                  names=("slice", "tags", "practice"))
        self.assertEqual(problems, [], "\n".join(problems))


if __name__ == "__main__":
    unittest.main()
