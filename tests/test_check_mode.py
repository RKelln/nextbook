"""Tests for T4.2 and T5.5a: the mode check runner and its no-Node wrapper.

Every test builds a throwaway repo in a temp folder: `tools/check-mode.js`, the pure
core files, the real `app/data/` files and a small mode of its own. The repo's
`app/modes/` is never read or written, and nothing here touches the network.

The mode fixtures are deliberately plain: a reason that names the book, no banned
words, and a check file with one trivial assertion. The failing copies are made from
that same text, so a failure names one thing at a time.

`tools/check.sh` runs `tools/check-mode.js` through osascript, which only a Mac has.
`test_check_sh_without_osascript_says_so` covers the honest fallback on this box;
`test_check_sh_passes_the_same_exit_codes` puts a stub `osascript` on PATH that runs
the runner with node, so the wrapper's arguments and exit codes are exercised here.
The JXA branch itself stays unverified until T7.1 on the Mac.
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
REPO = TESTS.parent
RUNNER = REPO / "tools" / "check-mode.js"
CHECK_SH = REPO / "tools" / "check.sh"
NODE = shutil.which("node")
OSASCRIPT = shutil.which("osascript")

# The runner's list, in the order app/index.html loads them (core/slice.js joined for
# Nextbook.pool.load(), which runModeChecks needs). core/store.js and data/workshop.js are
# part of the page's list too; both are guarded when the file is absent.
CORE = ["base", "slice", "score", "reason", "links", "contract", "seam", "store"]
DATA = ["slice", "tags", "practice", "found", "events", "workshop"]

MODE = """Nextbook.mode({
  id: '@ID@',
  name: 'Probe',
  purpose: 'A fixture for the runner test.',
  shape: 'list',
  inputs: [],
  strings: { nothing: '@NOTHING@' },
  logic: {
    first(works) { return works.slice(0, 2); }
  },
  choose(ctx) {
    @BEFORE@
    const picks = this.logic.first(ctx.works.filter(w => !ctx.onShelf(w.id)))
      .map(w => ({ id: w.id, why: 'It shares a subject with ' + w.title + '.' }));
    return picks.length ? { picks } : { picks: [], note: ctx.t('nothing') };
  }
});
"""

EMPTY_MODE = """Nextbook.mode({
  id: '@ID@',
  name: 'Empty',
  purpose: 'Never answers with anything.',
  shape: 'list',
  inputs: [],
  strings: {},
  logic: {},
  choose(ctx) { return { picks: [] }; }
});
"""

CHECK = """Nextbook.check('@ID@', (t, mode) => {
  t.ok(mode.logic.first([1, 2, 3]).length === 2, 'takes two books');
});
"""

EMPTY_CHECK = """Nextbook.check('@ID@', (t) => {
  t.ok(true, 'nothing to test');
});
"""

WARNING = "WARNING: This mode is not in app/modes/list.js, so the app will not show it."


def mode_text(mode_id, nothing="Nothing on this shelf yet.", before="", template=MODE):
    return template.replace("@ID@", mode_id).replace("@NOTHING@", nothing).replace("@BEFORE@", before)


def check_text(mode_id, template=CHECK):
    return template.replace("@ID@", mode_id)


def build(tmp, modes, listed):
    """A small repo: the runner, the core, the data, a manifest and the mode files.

    `modes` is {file name: text} and `listed` is the manifest's ids.
    """
    root = Path(tmp)
    (root / "tools").mkdir(parents=True)
    shutil.copy2(RUNNER, root / "tools" / "check-mode.js")
    shutil.copy2(CHECK_SH, root / "tools" / "check.sh")
    (root / "app" / "core").mkdir(parents=True)
    for name in CORE:
        shutil.copy2(REPO / "app" / "core" / f"{name}.js", root / "app" / "core" / f"{name}.js")
    (root / "app" / "data").mkdir(parents=True)
    for name in DATA:
        source = REPO / "app" / "data" / f"{name}.js"
        if source.exists():
            shutil.copy2(source, root / "app" / "data" / f"{name}.js")
    (root / "app" / "modes").mkdir(parents=True)
    ids = ", ".join("'%s'" % i for i in listed)
    (root / "app" / "modes" / "list.js").write_text(
        "'use strict';\nNextbook.modes = [%s];\n" % ids, encoding="utf-8")
    for name, text in modes.items():
        (root / "app" / "modes" / name).write_text(text, encoding="utf-8")
    return root


def run(root, *args, env=None):
    return subprocess.run([str(NODE), "tools/check-mode.js", *args], cwd=str(root),
                          capture_output=True, text=True, env=env, timeout=60)


@unittest.skipUnless(NODE, "the runner needs node")
class CheckModeTest(unittest.TestCase):
    def probe(self, **kwargs):
        """A temp repo with the passing mode `probe`, listed."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        return build(tmp.name, {"probe.js": mode_text("probe"),
                                "probe.check.js": check_text("probe")}, ["probe"])

    def test_a_passing_mode_exits_0(self):
        result = run(self.probe(), "probe")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS The scan: no words a mode may not use.", result.stdout)
        self.assertIn("PASS The file does nothing when it loads except call Nextbook.mode({...}).", result.stdout)
        self.assertIn("OK probe: ", result.stdout)
        self.assertNotIn("FAIL", result.stdout)
        self.assertNotIn("WARNING", result.stdout)

    def test_a_failing_mode_exits_1(self):
        # A copy with innerHTML in code fails, and the failure names the word.
        root = self.probe()
        (root / "app" / "modes" / "probe.js").write_text(
            mode_text("probe", before="const bad = ctx.el.innerHTML;"), encoding="utf-8")
        result = run(root, "probe")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('FAIL The scan: "innerHTML" is inside choose', result.stdout)
        self.assertIn("FAILED probe: ", result.stdout)

    def test_a_banned_word_inside_a_string_passes(self):
        # "The library could not fetch this." is a sentence, not a call: the scan leaves strings out.
        root = self.probe()
        (root / "app" / "modes" / "probe.js").write_text(
            mode_text("probe", nothing="The library could not fetch this."), encoding="utf-8")
        result = run(root, "probe")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS The scan: no words a mode may not use.", result.stdout)
        self.assertIn("only books typed in", result.stdout)

    def test_no_picks_and_no_note_fails_by_name(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = build(tmp.name, {"probe.js": mode_text("probe", template=EMPTY_MODE),
                                "probe.check.js": check_text("probe", EMPTY_CHECK)}, ["probe"])
        result = run(root, "probe")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("FAIL an empty shelf: This way of choosing books found nothing and did not say why.", result.stdout)
        self.assertIn("FAILED probe: ", result.stdout)

    def test_code_outside_the_mode_call_fails(self):
        # The one rule the browser does not have: a mode file only registers the mode.
        root = self.probe()
        (root / "app" / "modes" / "probe.js").write_text(
            "var extra = 1;\n" + mode_text("probe"), encoding="utf-8")
        result = run(root, "probe")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("FAIL There is code outside the one Nextbook.mode({...}) call, on line 1", result.stdout)

    def test_use_strict_outside_the_call_is_not_code(self):
        root = self.probe()
        (root / "app" / "modes" / "probe.js").write_text(
            "'use strict';\n" + mode_text("probe"), encoding="utf-8")
        result = run(root, "probe")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_an_unlisted_mode_warns_and_still_passes(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = build(tmp.name, {"probe.js": mode_text("probe"),
                                "probe.check.js": check_text("probe"),
                                "side.js": mode_text("side"),
                                "side.check.js": check_text("side")}, ["probe"])
        result = run(root, "side")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(WARNING, result.stdout)
        self.assertIn("OK side: ", result.stdout)

    def test_all_runs_every_listed_mode(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        files = {}
        for mode_id in ("alpha", "beta"):
            files["%s.js" % mode_id] = mode_text(mode_id)
            files["%s.check.js" % mode_id] = check_text(mode_id)
        root = build(tmp.name, files, ["alpha", "beta"])
        result = run(root, "--all")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OK alpha: ", result.stdout)
        self.assertIn("OK beta: ", result.stdout)
        self.assertIn("OK --all: 2 modes, ", result.stdout)

    def test_all_fails_when_one_mode_fails(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        files = {"probe.js": mode_text("probe"), "probe.check.js": check_text("probe"),
                 "empty.js": mode_text("empty", template=EMPTY_MODE),
                 "empty.check.js": check_text("empty", EMPTY_CHECK)}
        root = build(tmp.name, files, ["probe", "empty"])
        result = run(root, "--all")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("OK probe: ", result.stdout)
        self.assertIn("FAILED empty: ", result.stdout)
        self.assertIn("FAILED --all: 2 modes, ", result.stdout)

    def test_a_listed_mode_with_no_file_fails_in_all(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = build(tmp.name, {"probe.js": mode_text("probe"),
                                "probe.check.js": check_text("probe")}, ["probe", "ghost"])
        result = run(root, "--all")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('FAIL The app lists "ghost" but there is no app/modes/ghost.js.', result.stdout)

    def test_a_bad_invocation_exits_2(self):
        root = self.probe()
        for args in ([], ["Probe"], ["--nope"], ["--dir"], ["probe", "extra"], ["no-such-mode"]):
            with self.subTest(args=args):
                result = run(root, *args)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertIn("STOP: ", result.stdout)

    def test_a_missing_check_file_is_a_stop(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = build(tmp.name, {"probe.js": mode_text("probe")}, ["probe"])
        result = run(root, "probe")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("STOP: I cannot find app/modes/probe.check.js.", result.stdout)

    def test_dir_runs_a_mode_elsewhere(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = build(tmp.name, {}, ["probe"])
        other = root / "reference" / "modes"
        other.mkdir(parents=True)
        (other / "side.js").write_text(mode_text("side"), encoding="utf-8")
        (other / "side.check.js").write_text(check_text("side"), encoding="utf-8")
        result = run(root, "--dir", "reference/modes", "side")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OK side: ", result.stdout)
        # The manifest is still app/modes/list.js, so a reference mode is not listed: it warns.
        self.assertIn(WARNING, result.stdout)

    # ---- R1: every other way of registering a mode is a FAIL, never a silent skip --------------
    def test_a_registration_without_the_literal_call_fails(self):
        # The one rule the runner adds: whatever registered the def, the source has to show the
        # Nextbook.mode({...}) call. Each of these used to exit 0 with the load-rule line missing.
        root = self.probe()
        base = mode_text("probe").rstrip()
        head = "Nextbook.mode("
        self.assertTrue(base.startswith(head) and base.endswith("});"), base)
        after = base[len(head):]                      # {...});
        ways = {
            "alias": "var m = Nextbook.mode;\nm(" + after,
            "bracket": "Nextbook['mode'](" + after,
            "call": "Nextbook.mode.call(Nextbook, " + after,
            "defs": "Nextbook.modeDefs['probe'] = " + after[:-2] + ";",
        }
        for name, text in ways.items():
            with self.subTest(way=name):
                (root / "app" / "modes" / "probe.js").write_text(text + "\n", encoding="utf-8")
                result = run(root, "probe")
                self.assertEqual(result.returncode, 1, name + ": " + result.stdout + result.stderr)
                self.assertIn(
                    "FAIL I could not see the Nextbook.mode({...}) call in this file. "
                    "A mode registers itself with that call, and nothing else.", result.stdout)
                self.assertNotIn("PASS The file does nothing when it loads", result.stdout)
                self.assertIn("FAILED probe: ", result.stdout)

    # ---- R2: two calls in one file is a FAIL that names the second one ------------------------
    def test_two_mode_calls_fail_and_name_the_second_line(self):
        root = self.probe()
        first = mode_text("probe")
        second = mode_text("probe")
        (root / "app" / "modes" / "probe.js").write_text(first + second, encoding="utf-8")
        result = run(root, "probe")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        second_line = first.count("\n") + 1
        self.assertIn("This file calls Nextbook.mode({...}) 2 times; the second call is on line %d"
                      % second_line, result.stdout)
        self.assertNotIn("PASS The file does nothing when it loads", result.stdout)
        self.assertIn("FAILED probe: ", result.stdout)

    # ---- R3: the --all path checks every id before it becomes a path --------------------------
    def test_all_refuses_a_manifest_id_that_is_not_a_mode_id(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = build(tmp.name, {"probe.js": mode_text("probe"),
                                "probe.check.js": check_text("probe")},
                     ["probe", "../../outside/evil"])
        result = run(root, "--all")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('STOP: The mode id must use only the letters a-z and hyphens', result.stdout)
        self.assertNotIn("OK probe: ", result.stdout)

    # ---- R4: --dir is confined to the repo ----------------------------------------------------
    def test_dir_outside_the_repo_is_refused(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        base = Path(tmp.name)
        root = build(base / "repo", {"probe.js": mode_text("probe"),
                                     "probe.check.js": check_text("probe")}, ["probe"])
        outside = base / "outside"
        outside.mkdir()
        (outside / "side.js").write_text(mode_text("side"), encoding="utf-8")
        (outside / "side.check.js").write_text(check_text("side"), encoding="utf-8")
        for given, label in (("../outside", "relative"), (str(outside), "absolute")):
            with self.subTest(dir=label):
                result = run(root, "--dir", given, "side")
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertIn("STOP: I cannot find the folder %s. It has to be a folder in this repo."
                              % given, result.stdout)
                self.assertNotIn("OK side: ", result.stdout)

    # ---- R5: a missing or non-array manifest is a STOP, not "nothing to check" ----------------
    def test_all_stops_when_the_manifest_is_missing_or_not_a_list(self):
        root = self.probe()
        (root / "app" / "modes" / "list.js").unlink()
        missing = run(root, "--all")
        self.assertEqual(missing.returncode, 2, missing.stdout + missing.stderr)
        self.assertIn("STOP: app/modes/list.js is missing, so there is nothing to run. "
                      "In the app, that file is the list of modes.", missing.stdout)
        self.assertNotIn("there was nothing to check", missing.stdout)

        (root / "app" / "modes" / "list.js").write_text(
            "'use strict';\nNextbook.modes = 'probe';\n", encoding="utf-8")
        string = run(root, "--all")
        self.assertEqual(string.returncode, 2, string.stdout + string.stderr)
        self.assertIn("STOP: app/modes/list.js did not set Nextbook.modes to a list, "
                      "so there is nothing to run.", string.stdout)
        self.assertNotIn("there was nothing to check", string.stdout)

    # ---- R6: --all --dir checks every mode file in that folder --------------------------------
    def test_all_with_dir_checks_every_mode_file_in_name_order(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = build(tmp.name, {}, ["probe"])
        other = root / "reference" / "modes"
        other.mkdir(parents=True)
        for mode_id in ("beta", "alpha"):
            (other / ("%s.js" % mode_id)).write_text(mode_text(mode_id), encoding="utf-8")
            (other / ("%s.check.js" % mode_id)).write_text(check_text(mode_id), encoding="utf-8")
        (other / "notes.txt").write_text("not a mode", encoding="utf-8")
        result = run(root, "--all", "--dir", "reference/modes")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OK alpha: ", result.stdout)
        self.assertIn("OK beta: ", result.stdout)
        self.assertIn("OK --all: 2 modes, ", result.stdout)
        self.assertLess(result.stdout.index("OK alpha: "), result.stdout.index("OK beta: "))

    # ---- R7: the vm context has its own console, not the host's -------------------------------
    def test_a_mode_cannot_escape_through_the_console(self):
        root = self.probe()
        (root / "app" / "modes" / "probe.js").write_text(
            mode_text("probe", before="console.log.constructor('return process')().exit(0);"),
            encoding="utf-8")
        result = run(root, "probe")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("FAILED probe: ", result.stdout)
        self.assertNotIn("OK probe: ", result.stdout)
        # The summary printed and the exit code is the runner's: the host process was never reached.
        self.assertRegex(result.stdout, r"FAILED probe: \d+ passed, \d+ failed")

    # ---- R9: the file list is the page's list -------------------------------------------------
    def test_the_runner_loads_store_and_workshop_like_the_page(self):
        root = self.probe()
        (root / "app" / "data" / "workshop.js").write_text(
            "Nextbook.workshopLoaded = true;\n", encoding="utf-8")
        (root / "app" / "modes" / "probe.check.js").write_text(
            "Nextbook.check('probe', (t) => {\n"
            "  t.ok(typeof Nextbook.store === 'object' && typeof Nextbook.store.open === 'function',\n"
            "    'loads core/store.js like the page');\n"
            "  t.ok(Nextbook.workshopLoaded === true, 'loads data/workshop.js like the page');\n"
            "});\n", encoding="utf-8")
        result = run(root, "probe")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS The check: loads core/store.js like the page", result.stdout)
        self.assertIn("PASS The check: loads data/workshop.js like the page", result.stdout)

    # ---- R10: the whole file is scanned, not only its functions -------------------------------
    def test_code_in_the_call_argument_outside_a_function_fails(self):
        root = self.probe()
        text = mode_text("probe").rstrip()
        head, tail = "Nextbook.mode({", "});"
        self.assertTrue(text.startswith(head) and text.endswith(tail), text)
        body = text[len(head):-len(tail)]
        (root / "app" / "modes" / "probe.js").write_text(
            "Nextbook.mode((eval('1'), {" + body + "}));\n", encoding="utf-8")
        result = run(root, "probe")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('FAIL The file scan: "eval(" is on line 1', result.stdout)
        self.assertIn("FAILED probe: ", result.stdout)

    def test_a_banned_word_only_in_a_sentence_still_passes_the_file_scan(self):
        root = self.probe()
        (root / "app" / "modes" / "probe.js").write_text(
            mode_text("probe", nothing="Do not call eval( in a sentence like this."), encoding="utf-8")
        result = run(root, "probe")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS The file scan: no words a mode may not use in the file.", result.stdout)

    # ---- R11: a mode that will not load still gets its per-mode summary -----------------------
    def test_all_summarises_a_mode_whose_file_will_not_load(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        files = {"probe.js": mode_text("probe"), "probe.check.js": check_text("probe"),
                 "bad.js": "Nextbook.mode({ id: 'bad',\n", "bad.check.js": check_text("bad")}
        root = build(tmp.name, files, ["probe", "bad"])
        result = run(root, "--all")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("FAIL app/modes/bad.js: A file would not load:", result.stdout)
        self.assertIn("FAILED bad: 0 passed, 1 failed", result.stdout)
        self.assertIn("FAILED --all: 2 modes, ", result.stdout)



@unittest.skipUnless(NODE, "the runner needs node")
class CheckShTest(unittest.TestCase):
    def make(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        return build(tmp.name, {"probe.js": mode_text("probe"),
                                "probe.check.js": check_text("probe")}, ["probe"])

    def run_sh(self, root, *args, env=None):
        return subprocess.run(["bash", "tools/check.sh", *args], cwd=str(root),
                              capture_output=True, text=True, env=env, timeout=60)

    @unittest.skipIf(OSASCRIPT, "this box has osascript, so the fallback cannot be seen")
    def test_check_sh_without_osascript_says_so(self):
        result = self.run_sh(self.make(), "probe")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("STOP: This needs osascript, which only a Mac has.", result.stdout)
        self.assertIn("node tools/check-mode.js probe", result.stdout)

    def test_check_sh_still_stops_on_a_bad_id(self):
        result = self.run_sh(self.make(), "Probe")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("STOP: The mode id must use only the letters a-z", result.stdout)

    # ---- R8: empty --dir, --dir --all, and a launcher that dies ------------------------------
    def test_check_sh_stops_on_an_empty_dir_argument(self):
        result = self.run_sh(self.make(), "--dir=")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("STOP: --dir needs a folder, for example: --dir <folder>", result.stdout)

    def test_check_sh_does_not_eat_all_as_a_folder(self):
        result = self.run_sh(self.make(), "--dir", "--all")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("STOP: I cannot find the folder --all. It has to be a folder in this repo.",
                      result.stdout)
        self.assertNotIn("Give the mode id", result.stdout)

    def test_check_sh_maps_a_launcher_failure_to_a_stop(self):
        root = self.make()
        stub = root / "bin" / "osascript"
        stub.parent.mkdir()
        for status in ("127", "143"):
            with self.subTest(status=status):
                stub.write_text("#!/bin/sh\nexit %s\n" % status, encoding="utf-8")
                stub.chmod(0o755)
                env = dict(os.environ, PATH="%s:%s" % (stub.parent, os.environ.get("PATH", "")))
                result = self.run_sh(root, "probe", env=env)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_check_sh_passes_the_same_exit_codes(self):
        # A stub osascript that runs the runner with node: this checks the wrapper's
        # arguments and exit codes, never the JXA branch itself.
        root = self.make()
        env = None
        if not OSASCRIPT:
            stub = root / "bin" / "osascript"
            stub.parent.mkdir()
            stub.write_text("#!/bin/sh\nshift 2\nexec node \"$@\"\n", encoding="utf-8")
            stub.chmod(0o755)
            env = dict(os.environ, PATH="%s:%s" % (stub.parent, os.environ.get("PATH", "")))
        result = self.run_sh(root, "probe", env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OK probe: ", result.stdout)

        (root / "app" / "modes" / "empty.js").write_text(
            mode_text("empty", template=EMPTY_MODE), encoding="utf-8")
        (root / "app" / "modes" / "empty.check.js").write_text(
            check_text("empty", EMPTY_CHECK), encoding="utf-8")
        failing = self.run_sh(root, "empty", env=env)
        self.assertEqual(failing.returncode, 1, failing.stdout + failing.stderr)
        self.assertIn("FAILED empty: ", failing.stdout)


if __name__ == "__main__":
    unittest.main()
