"""Tests for T5.4: tools/serve.py serves app/, reloads, moves the tab by .dev-go, and stays on this computer.

Everything here uses a made-up app folder in a temporary directory and a real server on a real port, bound the
same way the command binds it. The repo's own app/ is only read, by the one test that checks the real page.
"""
import http.client
import json
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

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
        """A port held on 127.0.0.1 cannot be reached through another address on this machine. The check is
        made where an address exists; when the machine has no other one, the bind assertion above is the proof."""
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            make_app(repo)
            httpd = serve.make_server(repo / "app", 0, verbose=False)
            port = httpd.server_address[1]
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                lan = serve_lan_address()
                if lan and lan != "127.0.0.1":
                    status = connect_status(lan, port)
                    self.assertNotEqual(status, 200, "%s:%d answered; the server must not answer there" % (lan, port))
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)


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


def connect_status(host, port):
    """200 when something answered as this server, 0 when the connection was refused or failed."""
    conn = http.client.HTTPConnection(host, port, timeout=2)
    try:
        conn.request("GET", "/")
        r = conn.getresponse()
        r.read()
        return r.status
    except OSError:
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    unittest.main()
