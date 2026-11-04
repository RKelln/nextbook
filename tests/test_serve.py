"""Tests for T5.4: tools/serve.py serves app/, reloads, moves the tab by .dev-go, and stays on this computer.

Everything here uses a made-up app folder in a temporary directory and a real server on a real port, bound the
same way the command binds it. The repo's own app/ is only read, by the one test that checks the real page.
"""
import contextlib
import http.client
import io
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

TESTS = Path(__file__).resolve().parent
REPO = TESTS.parent
TOOLS = REPO / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import serve  # noqa: E402


def make_app(root: Path) -> None:
    """The smallest folder that behaves like app/: a page, a style, a core script, a mode, a data file."""
    (root / "app").mkdir(parents=True)
    app = root / "app"
    (app / "index.html").write_text(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<title>nextbook</title>\n</head>\n<body>\n<p>hi</p>\n</body>\n</html>\n", encoding="utf-8")
    (app / "nextbook.css").write_text("body { color: black; }\n", encoding="utf-8")
    (app / "core").mkdir()
    (app / "core" / "base.js").write_text("window.Nextbook = {};\n", encoding="utf-8")
    (app / "modes").mkdir()
    (app / "modes" / "list.js").write_text("Nextbook.modes = [];\n", encoding="utf-8")
    (app / "modes" / "more-by.js").write_text("Nextbook.mode({ id: 'more-by' });\n", encoding="utf-8")
    (app / "data").mkdir()
    (app / "data" / "slice.js").write_text("Nextbook.data.put('slice', {});\n", encoding="utf-8")
    # Things the page must never be given.
    (app / "data" / "found.json").write_text('{"schema": "nextbook/found-1"}', encoding="utf-8")
    (app / "index.html~").write_text("an editor's backup\n", encoding="utf-8")


class ServeCase(unittest.TestCase):
    """A temp folder with an app in it, a server on a free port, and a way to ask it questions."""

    workshop = False
    reload = True

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        make_app(self.repo)
        self.root = self.repo / "app"
        self.httpd = serve.make_server(self.root, 0, workshop=self.workshop, reload=self.reload, verbose=False)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()

    def get(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request("GET", path)
            r = conn.getresponse()
            return r.status, r.read(), dict(r.getheaders())
        finally:
            conn.close()

    def post(self, path, body):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request("POST", path, body=body.encode("utf-8"),
                         headers={"Content-Type": "text/plain", "Content-Length": str(len(body))})
            r = conn.getresponse()
            return r.status, r.read()
        finally:
            conn.close()

    def raw(self, request):
        """The bytes the server sends, header block and all: what a browser reads off the wire."""
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as sock:
            sock.sendall(request)
            chunks = []
            while True:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                chunks.append(chunk)
        return b"".join(chunks)

    def write_go(self, text):
        (self.repo / ".dev-go").write_text(text, encoding="utf-8")

    def go_exists(self):
        return (self.repo / ".dev-go").exists()


class TestServing(ServeCase):
    def test_answers_on_127_0_0_1_for_this_folder(self):
        status, body, headers = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>nextbook</title>", body)
        self.assertEqual(headers.get("Cache-Control"), "no-store")

    def test_serves_the_files_the_page_loads(self):
        for path in ("/core/base.js", "/modes/list.js", "/modes/more-by.js", "/data/slice.js", "/nextbook.css"):
            status, body, _ = self.get(path)
            self.assertEqual(status, 200, path)
            self.assertTrue(body, path)

    def test_refuses_what_the_page_does_not_load(self):
        for path in ("/data/found.json", "/index.html~", "/.dev-go", "/../docs/BUILD.md",
                     "/core/../../AGENTS.md", "/app/index.html", "/dist/nextbook.html"):
            status, _, _ = self.get(path)
            self.assertEqual(status, 404, path)

    def test_head_sends_the_headers_and_no_body(self):
        """A HEAD asks for the headers only: the body is not written, whatever the file is."""
        for path, size in (("/", None), ("/core/base.js", (self.root / "core" / "base.js").stat().st_size)):
            with self.subTest(path=path):
                raw = self.raw(("HEAD %s HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n" % path).encode("ascii"))
                head, sep, body = raw.partition(b"\r\n\r\n")
                self.assertTrue(sep, "the answer had no header block")
                self.assertTrue(head.startswith(b"HTTP/1.0 200"), head[:40])
                self.assertEqual(body, b"", "HEAD must not send the body")
                if size is not None:
                    self.assertIn(b"Content-Length: %d" % size, head)
        status, body, _ = self.get("/core/base.js")      # and a GET still has one
        self.assertEqual(status, 200)
        self.assertTrue(body)

    def test_workshop_is_off_unless_asked(self):
        status, _, _ = self.get("/data/workshop.js")
        self.assertEqual(status, 404)

    def test_the_real_page_is_served(self):
        """The repo's own app/index.html has the </head> the helper needs, and the app's own files pass the
        public-path rule (a .json under app/ is refused; there are none today, and that is the point)."""
        page = (serve.APP / "index.html").read_text(encoding="utf-8")
        self.assertIsNotNone(serve.add_scripts(page, "<script>x</script>"))
        for rel in serve.watched_files(serve.APP):
            self.assertTrue(serve.is_public(rel), rel)
        self.assertIn("index.html", serve.watched_files(serve.APP))
        self.assertIn("modes/more-by.js", serve.watched_files(serve.APP))


class TestReload(ServeCase):
    def test_the_reload_endpoint_reports_a_changed_file(self):
        status, first, headers = self.get("/__dev")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "text/plain; charset=utf-8")
        first = first.decode("ascii")
        self.assertEqual(len(first), 12)

        # No change yet: same token.
        self.assertEqual(self.get("/__dev")[1].decode("ascii"), first)

        # Saving a mode is the workshop's whole loop.
        time.sleep(0.01)
        (self.root / "modes" / "more-by.js").write_text(
            "Nextbook.mode({ id: 'more-by', name: 'More by them' });\n", encoding="utf-8")
        second = self.get("/__dev")[1].decode("ascii")
        self.assertNotEqual(second, first, "saving a file must change the token")

    def test_the_page_carries_the_token_and_the_helper(self):
        status, body, _ = self.get("/")
        self.assertEqual(status, 200)
        token = self.get("/__dev")[1].decode("ascii")
        text = body.decode("utf-8")
        self.assertIn("nextbook-dev-reload", text)
        self.assertIn(json.dumps(token), text)
        self.assertIn("/__dev", text)
        self.assertLess(text.index("nextbook-dev-reload"), text.index("</head>"),
                        "the helper goes in the head, before the app's own scripts")

    def test_the_saved_page_on_disk_is_untouched(self):
        before = (self.root / "index.html").read_bytes()
        self.get("/")
        self.assertEqual((self.root / "index.html").read_bytes(), before)


class TestPaths(ServeCase):
    """What the page may ask for: a regular file, inside app/, and nothing else."""

    def test_a_nul_byte_in_the_path_is_a_bad_request(self):
        for path in ("/%00", "/core/base.js%00.js", "/%00/../../AGENTS.md"):
            with self.subTest(path=path):
                status, body, _ = self.get(path)
                self.assertEqual(status, 400, path)
                self.assertNotIn(b"Traceback", body)

    def test_encoded_traversal_stays_inside_the_folder(self):
        for path in ("/%2e%2e/%2e%2e/AGENTS.md", "/..%2f..%2fAGENTS.md",
                     "/core/%2e%2e/%2e%2e/docs/BUILD.md", "/core/..%5c..%5cAGENTS.md"):
            with self.subTest(path=path):
                status, _, _ = self.get(path)
                self.assertIn(status, (400, 404), path)

    def test_a_symlink_out_of_the_folder_is_not_followed(self):
        outside = Path(self.tmp.name) / "secret.js"
        outside.write_text("window.secret = true;\n", encoding="utf-8")
        link = self.root / "modes" / "leak.js"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("this machine cannot make a symlink")
        status, body, _ = self.get("/modes/leak.js")
        self.assertEqual(status, 404)
        self.assertNotIn(b"secret", body)

    def test_a_directory_named_like_a_script_is_not_a_listing(self):
        trap = self.root / "modes" / "trap.js"
        trap.mkdir()
        (trap / "inside.txt").write_text("x\n", encoding="utf-8")
        status, body, _ = self.get("/modes/trap.js")
        self.assertEqual(status, 404, "a folder is not a file the page asked for")
        self.assertNotIn(b"inside.txt", body)
        self.assertFalse(serve.is_public("modes/trap.js", self.root))
        self.assertTrue(serve.is_public("modes/trap.js"), "the name rule alone says .js")


class TestNoReload(ServeCase):
    reload = False

    def test_no_helper_is_added(self):
        status, body, _ = self.get("/")
        self.assertEqual(status, 200)
        self.assertNotIn(b"nextbook-dev-reload", body)


class TestWorkshop(ServeCase):
    workshop = True

    def test_the_workshop_flag_is_a_script_the_page_already_asks_for(self):
        status, body, headers = self.get("/data/workshop.js")
        self.assertEqual(status, 200)
        self.assertIn("application/javascript", headers.get("Content-Type", ""))
        text = body.decode("utf-8")
        self.assertIn("Nextbook.data.put('workshop'", text)
        self.assertIn('"workshop": true', text)
        # It is made up on the way out: the served folder is not written to.
        self.assertFalse((self.root / "data" / "workshop.js").exists(),
                         "the workshop flag must never be written into the app folder")


class TestGo(ServeCase):
    def test_a_note_moves_the_page_to_the_hash(self):
        self.write_go("shelf\n")
        status, body, _ = self.get("/")
        self.assertEqual(status, 200)
        text = body.decode("utf-8")
        self.assertIn('var go = "shelf"', text, "the page must be told the screen to go to")
        self.assertIn("Nextbook.shell.go(route)", text, "it moves there by the app's own router")
        self.assertIn("window.location.hash = '#' + route", text, "and falls back to the hash")

    def test_the_note_is_not_cleared_until_a_page_reports_it_was_shown(self):
        self.write_go("find\n")
        self.assertEqual(self.get("/__go")[1].decode("utf-8"), "find")
        self.get("/")                                  # a page was sent...
        self.assertTrue(self.go_exists(), "sending the page must not eat the note")
        self.assertEqual(self.get("/__go")[1].decode("utf-8"), "find")

        status, body = self.post("/__go-shown", "find")  # ...and now it says it drew it
        self.assertEqual(status, 204)
        self.assertFalse(self.go_exists(), "the note goes once a page reports it was shown")
        self.assertEqual(self.get("/__go")[1], b"")

    def test_a_report_for_another_screen_leaves_the_note(self):
        self.write_go("shelf\n")
        status, _ = self.post("/__go-shown", "find")
        self.assertEqual(status, 204)
        self.assertTrue(self.go_exists(), "an old report must not clear a newer note")

    def test_writing_the_same_screen_twice_works_twice(self):
        for _ in range(2):
            self.write_go("shelf\n")
            self.assertEqual(self.get("/__go")[1].decode("utf-8"), "shelf")
            self.get("/")
            self.post("/__go-shown", "shelf")
            self.assertFalse(self.go_exists())

    def test_a_note_with_no_tab_waits(self):
        self.write_go("selftest\n")
        self.get("/__go")
        self.assertTrue(self.go_exists(), "a note with nothing listening must survive")
        self.assertIn('var go = "selftest"', self.get("/")[1].decode("utf-8"))

    def test_junk_is_not_a_route(self):
        for text in ("", "\n", "two words\n", "find;rm -rf /\n", "Find\n", "'find'\n", "../../etc/passwd\n",
                     "x" * 61 + "\n"):
            self.assertEqual(serve.go_route(text), "", repr(text))
        for text in ("find", "shelf\n", "#selftest\n", "sites/new\n"):
            self.assertNotEqual(serve.go_route(text), "", repr(text))

    def test_a_junk_note_is_ignored_and_left_alone(self):
        self.write_go("two words\n")
        self.assertEqual(self.get("/__go")[1], b"")
        self.assertNotIn(b'var go = "two words"', self.get("/")[1])
        self.assertTrue(self.go_exists(), "the server never edits the note; only a page's report does")

    def test_clearing_the_note_does_not_change_the_reload_token(self):
        """.dev-go is not a watched file: showing and clearing a note must not reload the tab again."""
        self.write_go("find\n")
        first = self.get("/__dev")[1].decode("ascii")
        self.post("/__go-shown", "find")
        self.assertFalse(self.go_exists())
        self.assertEqual(self.get("/__dev")[1].decode("ascii"), first)

    def test_the_page_forgets_what_it_last_showed_when_the_note_is_gone(self):
        """Otherwise the second note with the same word looks like the one already on screen."""
        text = self.get("/")[1].decode("utf-8")
        self.assertIn("if (!route) { shown = ''; return; }", text)


HARNESS = r'''"use strict";
// Run the page's own reload helper against a fake page, so the poll can be stepped by hand.
const fs = require("fs");
const code = fs.readFileSync(process.argv[2], "utf8");
const calls = [];
const queue = [];
let onVisibility = null;
const onLoad = [];
global.window = {
  addEventListener: function (name, fn) { if (name === "load") onLoad.push(fn); },
  location: { hash: "", reload: function () { throw new Error("reload"); } },
  Nextbook: { shell: { go: function (route) { calls.push(route); } } }
};
global.Nextbook = global.window.Nextbook;
global.document = {
  hidden: false,
  activeElement: null,
  addEventListener: function (name, fn) { if (name === "visibilitychange") onVisibility = fn; },
  createElement: function () {
    return { setAttribute: function () {}, appendChild: function () {},
             addEventListener: function () {}, style: {} };
  },
  body: { appendChild: function () {} }
};
global.sessionStorage = { getItem: function () { return null; }, setItem: function () {} };
global.fetch = function (url) {
  const route = String(url).split("?")[0];
  let text = "";
  if (route === "/__go") text = queue.length ? queue.shift() : "";
  else if (route === "/__dev") text = "tok";
  return Promise.resolve({ text: function () { return Promise.resolve(text); } });
};
global.setTimeout = function () { return 0; };
(0, eval)(code);
const settle = function () { return new Promise(function (r) { setImmediate(r); }); };
(async function () {
  if (!onLoad.length) throw new Error("the script registered no load handler");
  queue.push("shelf");          // a note waits for the tab
  onLoad[0]();
  await settle(); await settle();
  queue.push("");               // the note was drawn, so the server clears it
  onVisibility();
  await settle(); await settle();
  queue.push("shelf");          // the same word written again must move the tab again
  onVisibility();
  await settle(); await settle();
  process.stdout.write(JSON.stringify(calls));
})().catch(function (e) { console.error(e.stack || e); process.exit(1); });
'''

NODE = shutil.which("node")


@unittest.skipUnless(NODE, "node is not installed, so the page's own script cannot be run here")
class TestThePageScript(unittest.TestCase):
    """.dev-go's promise, run as the page runs it: the same word twice moves the tab twice."""

    def run_script(self, script):
        with tempfile.TemporaryDirectory() as tmp:
            harness = Path(tmp) / "harness.js"
            page_script = Path(tmp) / "reload.js"
            harness.write_text(HARNESS, encoding="utf-8")
            page_script.write_text(script, encoding="utf-8")
            done = subprocess.run([NODE, str(harness), str(page_script)],
                                  capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout)

    def test_the_same_word_twice_moves_the_tab_twice(self):
        self.assertEqual(self.run_script(serve.RELOAD_JS % (json.dumps("tok"), json.dumps(""))),
                         ["shelf", "shelf"])

    def test_a_note_shown_once_is_not_shown_again_while_it_stays(self):
        """The poll runs every second: a note that is still pending must not re-route every tick."""
        script = serve.RELOAD_JS % (json.dumps("tok"), json.dumps(""))
        with tempfile.TemporaryDirectory() as tmp:
            harness = Path(tmp) / "harness.js"
            page_script = Path(tmp) / "reload.js"
            harness.write_text(HARNESS.replace('queue.push("");', 'queue.push("shelf");'),
                               encoding="utf-8")
            page_script.write_text(script, encoding="utf-8")
            done = subprocess.run([NODE, str(harness), str(page_script)],
                                  capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout), ["shelf"], "one pending note, one move")


class TestThisComputerOnly(unittest.TestCase):
    def test_the_server_binds_127_0_0_1_and_nothing_else(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_app(repo)
            httpd = serve.make_server(repo / "app", 0, verbose=False)
            try:
                self.assertEqual(httpd.server_address[0], "127.0.0.1")
                self.assertEqual(httpd.socket.getsockname()[0], "127.0.0.1")
                self.assertEqual(serve.HOST, "127.0.0.1")
            finally:
                httpd.server_close()

    def test_it_refuses_to_bind_another_address(self):
        for host in ("0.0.0.0", "::", "", "localhost", "192.168.1.20"):
            with self.assertRaises(SystemExit) as caught:
                serve.main(["--host", host, "--check"])
            self.assertNotEqual(caught.exception.code, 0, host)
            self.assertIn("127.0.0.1", str(caught.exception.code))

    def test_only_the_loopback_has_the_port(self):
        """The same port answers on 127.0.0.1 and is REFUSED on this machine's own address: not a page, not a
        different error, a refused connection."""
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_app(repo)
            httpd = serve.make_server(repo / "app", 0, verbose=False)
            port = httpd.server_address[1]
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                try:
                    conn.request("GET", "/")
                    self.assertEqual(conn.getresponse().status, 200, "the server is not up to test")
                finally:
                    conn.close()
                lan = serve_lan_address()
                if not lan or lan == "127.0.0.1":
                    self.skipTest("this machine has no second IPv4 address to try")
                with self.assertRaises(ConnectionRefusedError):
                    socket.create_connection((lan, port), timeout=2)
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)


class TestCheck(unittest.TestCase):
    """--check says what it checked and exits non-zero when the server would not work."""

    def test_check_refuses_a_page_it_would_have_to_500_on(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_app(repo)
            (repo / "app" / "index.html").write_text(
                "<!doctype html><html><body>no head here</body></html>\n", encoding="utf-8")
            err = io.StringIO()
            with mock.patch.object(serve, "APP", repo / "app"), mock.patch.object(serve, "ROOT", repo), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                with self.assertRaises(SystemExit) as caught:
                    serve.main(["--check", "--port", "0"])
            self.assertEqual(caught.exception.code, 1)
            self.assertIn("</head>", err.getvalue())

    def test_check_refuses_a_port_that_is_taken(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_app(repo)
            holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            holder.bind(("127.0.0.1", 0))
            holder.listen(1)
            self.addCleanup(holder.close)
            port = holder.getsockname()[1]
            err = io.StringIO()
            with mock.patch.object(serve, "APP", repo / "app"), mock.patch.object(serve, "ROOT", repo), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                with self.assertRaises(SystemExit) as caught:
                    serve.main(["--check", "--port", str(port)])
            self.assertEqual(caught.exception.code, 1)
            self.assertIn(str(port), err.getvalue())

    def test_check_passes_on_a_folder_that_can_be_served(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_app(repo)
            err = io.StringIO()
            with mock.patch.object(serve, "APP", repo / "app"), mock.patch.object(serve, "ROOT", repo), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                serve.main(["--check", "--port", "0"])       # returns, says nothing is wrong
            self.assertIn("index.html", err.getvalue())
            self.assertNotIn("serve: cannot", err.getvalue())

    def test_a_port_outside_the_range_is_one_plain_sentence(self):
        for port in ("-1", "70000"):
            with self.subTest(port=port):
                err = io.StringIO()
                with contextlib.redirect_stderr(err):
                    with self.assertRaises(SystemExit) as caught:
                        serve.main(["--port", port, "--check"])
                self.assertNotEqual(caught.exception.code, 0)
                self.assertIn("--port", str(caught.exception.code))
                self.assertNotIn("Traceback", err.getvalue())


def serve_lan_address():
    """This machine's address on the local network, or '' when it has none. Opens no connection: a UDP connect
    picks the route without sending anything."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("192.0.2.1", 9))                  # TEST-NET-1: reserved, and never routed to
        return sock.getsockname()[0]
    except OSError:
        return ""
    finally:
        sock.close()


if __name__ == "__main__":
    unittest.main()
