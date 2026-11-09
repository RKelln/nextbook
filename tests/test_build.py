"""Tests for T5.1: the one file carries no address of its own.

The page is made in memory from the real `app/`, so nothing here writes `dist/` and nothing here
needs a browser. The rule the tests hold: every http(s) address in the output is the library's
own template, carried as data in a JSON block; the page itself asks for nothing. That is the
"works from a folder with the network off" property, in a form a test can see.
"""
import json
import re
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

import build  # noqa: E402

URL_RE = re.compile(r"https?://[^\s\"'<>]+")
PAGE = ('<!doctype html><html><head><meta charset="utf-8"><title>t</title></head>'
        '<body><script src="%s"></script></body></html>')


def page_of(body):
    """The same template with any body: the parts around it are the ones the packer needs."""
    return ('<!doctype html><html><head><meta charset="utf-8"><title>t</title></head>'
            '<body>' + body + '</body></html>')


def strings(value):
    """Every string in a JSON value, however it is nested."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from strings(k)
            yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)


def block_json(html, name):
    """The parsed body of `<script type="application/json" id="nb-<name>">`."""
    m = re.search(r'<script type="application/json" id="nb-' + re.escape(name) + r'">(.*?)</script>',
                  html, re.S)
    if not m:
        raise AssertionError("the one file has no nb-" + name + " block")
    return json.loads(m.group(1))


class OneFileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html, cls.info = build.build_page()

    def test_nothing_is_left_to_fetch(self):
        order = build.parse_boot_order(self.html)
        self.assertEqual(order, {"styles": [], "scripts": []})
        self.assertIn("<style>", self.html)
        self.assertIn('id="nb-slice"', self.html)

    def test_the_only_addresses_are_the_librarys(self):
        outside = build.BLOCK_RE.sub("", self.html)
        # The one address outside a data block is the policy's connect-src, the same origin as the
        # events service in the slice (PolicyTest proves they match).
        outside = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', "", outside)
        self.assertEqual(URL_RE.findall(outside), [],
                         "the page itself must hold no address: every one belongs in a data block")
        library = json.loads((REPO / "data" / "slice.json").read_text(encoding="utf-8"))["library"]
        origins = set()
        for value in strings(library):
            m = re.match(r"(https?://[^/]+)", value)
            if m:
                origins.add(m.group(1))
        self.assertTrue(origins, "the library has no address to allow")
        found = []
        for body in build.BLOCK_RE.findall(self.html):
            for value in strings(json.loads(re.sub(r"^<script[^>]*>|</script>$", "", body))):
                for url in URL_RE.findall(value):
                    found.append(url)
                    self.assertIn(re.match(r"(https?://[^/]+)", url).group(1), origins,
                                  "%s is not the library's own address" % url)
        self.assertTrue(found, "the library's search template should be carried as data")

    def test_the_data_is_unchanged(self):
        slice_json = json.loads((REPO / "data" / "slice.json").read_text(encoding="utf-8"))
        self.assertEqual(block_json(self.html, "slice"), slice_json)
        self.assertEqual(len(block_json(self.html, "slice")["works"]), 60)

    def test_the_modes_are_inline_and_the_shell_is_not_asked_for_them(self):
        self.assertIn("id: 'more-by'", self.html)
        self.assertIn('"more-by"', self.html)
        self.assertIn("Nextbook.check('more-by'", self.html)
        self.assertIn("Nextbook.modes = [];", self.html, "the shim keeps the shell from fetching modes/")
        held = re.search(r"window\.__nbPackedModes = (\[.*?\]);", self.html)
        assert held is not None, "the shim must hand the mode list back after boot"
        self.assertEqual(json.loads(held.group(1)), ["more-by"], "no mode is listed twice")

    def test_a_missing_data_file_is_left_out(self):
        html, info = build.assemble(PAGE % "data/none.js", build.read)
        self.assertNotIn("nb-none", html)
        self.assertTrue(any("data/none.js" in n for n in info["notes"]))


class FoundTest(unittest.TestCase):
    """A take-home keeps what the person's helper found (T5.1)."""

    def test_found_is_carried_when_the_folder_has_one(self):
        import shutil
        import tempfile
        found = {"schema": "nextbook/found-1", "works": [{"id": "w1", "title": "Found Book"}],
                 "searches": [{"query": "birds", "fetched": "2026-11-03"}]}
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp) / "app"
            shutil.copytree(build.APP, app)
            (app / "data" / "found.js").write_text(
                "Nextbook.data.put('found', " + json.dumps(found) + ");\n", encoding="utf-8")
            old = build.APP
            build.APP = app
            try:
                html, info = build.build_page()
            finally:
                build.APP = old
        self.assertIn("found", info["blocks"])
        self.assertEqual(block_json(html, "found"), found)


class OffFolderTest(unittest.TestCase):
    def test_a_script_off_the_folder_stops_the_build(self):
        for src in ("https://cdn.example.com/x.js", "//cdn.example.com/x.js", "/elsewhere/x.js", "../x.js"):
            with self.subTest(src=src):
                with self.assertRaises(build.BuildError):
                    build.assemble(PAGE % src, build.read)

    def test_every_tag_that_can_fetch_is_checked(self):
        """An image, a frame, a link or a form posts the person elsewhere just as surely as a script."""
        cases = (
            ("img", '<img src="https://cdn.example/x.png" alt="">', "img", "https://cdn.example/x.png"),
            ("iframe", '<iframe src="//cdn.example/f.html"></iframe>', "iframe", "//cdn.example/f.html"),
            ("a", '<a href="/elsewhere/page.html">x</a>', "a", "/elsewhere/page.html"),
            ("form", '<form action="https://collect.example/post"></form>', "form",
             "https://collect.example/post"),
            ("formaction", '<button formaction="../out.php">go</button>', "button", "../out.php"),
            ("img in single quotes", "<img src='https://cdn.example/y.png'>", "img", "https://cdn.example/y.png"),
        )
        for label, body, tag, value in cases:
            with self.subTest(label=label):
                with self.assertRaises(build.BuildError) as caught:
                    build.assemble(page_of(body), build.read)
                message = str(caught.exception)
                self.assertIn("<" + tag + ">", message, "the sentence must name the tag")
                self.assertIn(value, message, "the sentence must name the value")

    def test_a_link_within_the_page_is_not_a_fetch(self):
        html, _ = build.assemble(page_of('<a href="#find">find</a>'), build.read)
        self.assertIn('href="#find"', html)


class TolerantTagTest(unittest.TestCase):
    """A tag is a tag however it is spelled: defer, single quotes, rel after href."""

    def assert_nothing_left(self, html):
        self.assertEqual(build.parse_boot_order(html), {"styles": [], "scripts": []})
        build.check_no_refs_left(html)

    def test_a_defer_script_is_inlined(self):
        html, info = build.assemble(page_of('<script defer src="core/base.js"></script>'), build.read)
        self.assertEqual(info["scripts"], 1)
        self.assert_nothing_left(html)
        self.assertNotIn("core/base.js", html)

    def test_a_single_quoted_script_is_inlined(self):
        html, info = build.assemble(page_of("<script src='core/base.js'></script>"), build.read)
        self.assertEqual(info["scripts"], 1)
        self.assert_nothing_left(html)

    def test_a_reordered_style_link_is_inlined(self):
        html, _ = build.assemble(page_of('<link href="nextbook.css" rel="stylesheet">'), build.read)
        self.assertIn("<style>", html)
        self.assert_nothing_left(html)

    def test_boot_order_reads_the_same_tags_the_inliner_does(self):
        order = build.parse_boot_order(page_of('<script defer src="core/base.js"></script>'))
        self.assertEqual(order["scripts"], ["core/base.js"])
        order = build.parse_boot_order(page_of("<link href='x.css' rel='stylesheet'>"))
        self.assertEqual(order["styles"], ["x.css"])

    def test_a_tag_the_packer_cannot_carry_is_named_not_shipped(self):
        with self.assertRaises(build.BuildError) as caught:
            build.check_no_refs_left(page_of('<img src="pic.png" alt="">'))
        self.assertIn("<img>", str(caught.exception))
        self.assertIn("pic.png", str(caught.exception))


class PolicyTest(unittest.TestCase):
    """The one file carries a Content-Security-Policy: its own scripts by hash, one connection."""

    def policy(self, html):
        m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">', html)
        self.assertIsNotNone(m, "the one file has a policy")
        return dict(p.split(" ", 1) for p in m.group(1).split("; "))

    def test_every_inline_script_is_allowed_by_hash_and_nothing_else(self):
        html, _ = build.build_page()
        scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
        self.assertGreater(len(scripts), 10)
        allowed = self.policy(html)["script-src"].split(" ")
        self.assertEqual(sorted(allowed), sorted(build.sha256_token(s) for s in scripts))
        self.assertNotIn("unsafe-inline", self.policy(html)["script-src"])
        self.assertNotIn("unsafe-eval", self.policy(html)["script-src"])
        self.assertEqual(self.policy(html)["default-src"], "'none'")

    def test_the_page_may_connect_to_the_events_host_and_no_other(self):
        html, info = build.build_page()
        slice_doc = block_json(html, "slice")
        host = re.match(r"https://[^/]+", slice_doc["library"]["events"]["apiUrl"]).group(0)
        self.assertEqual(self.policy(html)["connect-src"], host)
        self.assertEqual(info["connect"], host)

    def test_a_file_built_in_a_workshop_folder_can_be_edited_and_keeps_its_one_connection(self):
        # The take-home file is the person's to change, so a hash must not blank it at the first edit.
        build.build_starter()
        starter = build.DIST / "starter"
        subprocess.run([sys.executable, str(starter / "tools" / "build.py")], check=True, cwd=starter,
                       capture_output=True)
        html = (starter / "dist" / "nextbook.html").read_text(encoding="utf-8")
        hosted, _ = build.build_page()
        policy = self.policy(html)
        self.assertEqual(policy["script-src"], "'unsafe-inline'")
        self.assertEqual(policy["connect-src"], self.policy(hosted)["connect-src"])
        self.assertEqual(policy["default-src"], "'none'")
        self.assertIn("Yours to change", html)
        self.assertNotIn("Yours to change", hosted)
        self.assertNotIn("unsafe-inline", self.policy(hosted)["script-src"])

    def test_a_library_with_no_events_service_gets_no_connection_at_all(self):
        self.assertEqual(build.make_csp(["'sha256-x'"], None).split("; ")[4], "connect-src 'none'")
        self.assertIsNone(build.events_origin('{"library": {"name": "X"}}'))
        self.assertIsNone(build.events_origin('{"library": {"events": {"apiUrl": "http://x.test/a/"}}}'))


class TravelTimesNeverShipTest(unittest.TestCase):
    """Travel times come from one start point and reveal it, and people share the one file."""

    def test_the_packer_leaves_data_distance_js_out_of_the_page(self):
        marker = "TRAVEL-TIMES-MARKER"
        template = page_of('<script src="data/distance.js"></script>')

        def read(path):
            if str(path).endswith("distance.js"):
                return "Nextbook.data.put('distance', {\"label\":\"" + marker + "\"});\n"
            return (REPO / "app" / "modes" / "list.js").read_text(encoding="utf-8")

        html, info = build.assemble(template, read)
        self.assertNotIn(marker, html)
        self.assertNotIn("nb-distance", html)
        self.assertTrue(any("distance.js" in n for n in info["notes"]))

    def test_the_real_page_and_the_starter_carry_no_travel_files(self):
        import contextlib
        import io
        made = []
        for rel in ("data/distance-map.json", "data/distance-transit-cache.json", "app/data/distance.js"):
            path = REPO / rel
            if not path.exists():
                path.write_text('{"label": "TRAVEL-TIMES-MARKER", "branches": []}\n', encoding="utf-8")
                made.append(path)
        self.addCleanup(lambda: [p.unlink() for p in made if p.exists()])
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        old = build.DIST
        build.DIST = Path(tmp.name) / "dist"
        self.addCleanup(lambda: setattr(build, "DIST", old))
        with contextlib.redirect_stdout(io.StringIO()):
            for name, modes in (("nextbook.html", None), ("demo.html", build.DEMO_MODES)):
                info = build.write_page(name, modes)
                self.assertNotIn("TRAVEL-TIMES-MARKER", info["out"].read_text(encoding="utf-8"), name)
            build.build_starter()
        starter = build.DIST / "starter"
        self.assertFalse((starter / ".claude/commands/distance-map.md").exists())
        self.assertFalse((starter / ".claude/skills/distance-map").exists())
        for path in starter.rglob("*"):
            if path.is_file():
                self.assertNotIn("distance", path.name.replace("distance-map.py", ""), str(path))
                self.assertNotIn("TRAVEL-TIMES-MARKER", path.read_text(encoding="utf-8", errors="ignore"), str(path))

    def test_git_ignores_the_travel_files(self):
        ignore = (REPO / ".gitignore").read_text(encoding="utf-8")
        for rel in ("data/distance-map.json", "data/distance-transit-cache.json", "app/data/distance.js"):
            self.assertIn(rel, ignore)


class DistCleanTest(unittest.TestCase):
    """dist/ is generated: a build replaces what it writes and leaves its siblings alone."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dist = Path(self.tmp.name) / "dist"
        self.old = build.DIST
        build.DIST = self.dist
        self.addCleanup(lambda: setattr(build, "DIST", self.old))

    def test_agent_tools_ship_without_live_data(self):
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            build.build_starter()
        out = self.dist / "starter"
        for name in ["tools/read-shelf.py", "tools/serve.py", ".claude/skills/use-nextbook/SKILL.md",
                     ".claude/commands/use-nextbook.md"]:
            self.assertTrue((out / name).is_file(), name)
        self.assertFalse((out / "nextbook-live.json").exists())
        self.assertFalse((out / "app/data/inbox.js").exists())
        self.assertNotIn("X-Nextbook-Token", (build.write_page("nextbook.html")["out"]).read_text())

    def test_a_rebuild_replaces_its_own_file(self):
        self.dist.mkdir()
        (self.dist / "nextbook.html").write_text("old\n", encoding="utf-8")
        info = build.write_page("nextbook.html")
        self.assertTrue((self.dist / "nextbook.html").is_file())
        self.assertNotEqual((self.dist / "nextbook.html").read_text(encoding="utf-8"), "old\n")
        self.assertEqual(info["out"], self.dist / "nextbook.html")

    def test_the_three_builds_live_side_by_side(self):
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            build.write_page("nextbook.html")
            build.write_page("demo.html", build.DEMO_MODES)
            build.build_starter()
        self.assertTrue((self.dist / "nextbook.html").is_file(), "the starter must not delete the one file")
        self.assertTrue((self.dist / "demo.html").is_file())
        self.assertTrue((self.dist / "starter" / "tools" / "build.py").is_file())

    def test_a_stray_file_is_named_not_silently_shipped(self):
        import contextlib
        import io
        self.dist.mkdir()
        (self.dist / "leftover.txt").write_text("stale\n", encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            build.write_page("nextbook.html")
        self.assertTrue((self.dist / "leftover.txt").is_file(), "a sibling's file is not deleted")
        self.assertIn("did not write it", out.getvalue())

    def test_clean_empties_dist(self):
        self.dist.mkdir()
        (self.dist / "nextbook.html").write_text("old\n", encoding="utf-8")
        build.reset_dist()
        self.assertEqual(list(self.dist.iterdir()), [])

    def test_clear_output_will_not_touch_a_path_outside_dist(self):
        self.dist.mkdir()
        outside = Path(self.tmp.name) / "keep.txt"
        outside.write_text("keep\n", encoding="utf-8")
        with self.assertRaises(build.BuildError):
            build.clear_output(outside)
        self.assertTrue(outside.is_file())

    def test_it_will_only_clear_a_folder_named_dist(self):
        build.DIST = Path(self.tmp.name) / "elsewhere"
        build.DIST.mkdir()
        (build.DIST / "keep.txt").write_text("keep\n", encoding="utf-8")
        with self.assertRaises(build.BuildError):
            build.reset_dist()
        self.assertTrue((build.DIST / "keep.txt").is_file(), "nothing outside dist/ is ever deleted")


class StarterTest(unittest.TestCase):
    def test_the_starter_lists_only_the_example_mode(self):
        self.assertEqual(build.parse_mode_ids(build.starter_list_js()), ["more-by"])

    def test_the_tools_the_starter_carries_do_not_name_the_demo_folder(self):
        """T5.2's Done-when greps the built starter for the folder of finished demo modes."""
        for rel in ("tools/build.py", "tools/serve.py", "tools/check-mode.js", "tools/check.sh"):
            text = (REPO / rel).read_text(encoding="utf-8")
            self.assertNotIn("reference", text.lower(), rel)


if __name__ == "__main__":
    unittest.main()
