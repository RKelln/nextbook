#!/usr/bin/env python3
# Ported from searchdesk/tools/serve.py (MIT, same author). Serving, reload and .dev-go only.
"""Serve nextbook while somebody watches an agent change it.

    python3 tools/serve.py                # the app, reloading itself when a file changes
    python3 tools/serve.py --workshop     # the same, as a practice copy: the practice shelf only
    python3 tools/serve.py --port 9000    # another port (8000 is the default; 0 picks a free one)

Then open the address it prints. Standard library only: Python 3.9 or newer and nothing else.

Why this exists
  The app needs no server: opening app/index.html from a file works, and that is the documented way to use it.
  But when somebody is watching a screen while an agent edits, "save, then reload the page by hand" is a step
  people forget. This serves app/ over http and reloads the page when a file changes. There is no build step:
  index.html loads core/ and modes/ as their own files, so the agent's next save is the next reload.

  Every response says no-store, so what is on the screen is what is on the disk.

  A reload never costs anyone their typing. When a text box has focus and something in it, the page shows a
  small bar and waits for a click. Half a sentence is worth more than a fresh screen.

This computer only
  It binds 127.0.0.1 and nothing else: there is no way to open it on the wifi, on a phone, or from another
  machine. That is a rule in this project, not a default somebody can flip, so --host refuses any value but
  127.0.0.1 rather than quietly widening the door. It also serves only what the page loads: index.html,
  nextbook.css, core/, modes/ and data/ -- never .json (a person's exported shelf is a .json), never a hidden
  file, never anything outside app/.

Moving the open tab to a screen
  Write a screen's name into .dev-go in this folder -- one word, for example `shelf` -- and the open tab goes
  there by itself:

      echo shelf > .dev-go        # or: find, selftest

  That is what the other half of a workshop needs: the agent finishes something, says "look at this", and the
  screen that is already open moves to it. No new tab, no keyboard shortcut, no AppleScript.

  The note stays in the file until a page says it drew it: the page sends that back to the server over
  /__go-shown, and only then is the note taken out. Search Desk cleared it as the page was sent, so a tab
  closed at the wrong moment, or a page that failed before it drew anything, ate the note and nothing moved.
  Keeping it until the page reports also means the same word written twice works twice, and a note written
  with no tab open waits for the next one.

  A name is only ever a screen id and at most one slash (60 characters, no quotes or spaces); anything else
  in the file is ignored, because a typo must not become a route. A name that is not a screen falls back to
  #find, which the app's own router already does.

  The note is read, never written: saving the page or the files leaves .dev-go alone.

The workshop flag
  With --workshop the server answers the page's request for app/data/workshop.js with a small script that sets
  the flag (`Nextbook.data.put('workshop', ...)`), so the page takes the practice shelf as its only shelf. The
  file is made up on the way out. Nothing is written into app/: the repo's folder stays exactly what it was,
  and a participant who opens app/index.html from a file afterwards gets the ordinary copy. A temporary copy
  of app/ was the other way to do it, and it was rejected because the copy would be a snapshot: saving
  app/modes/x.js would not reach the page that is supposed to reload. Serving app/ itself keeps the reload
  honest.

  index.html already asks for data/workshop.js, so the flag needs no line added to the page. If it ever did,
  the line would go inside a <script> element: bare, it is text on the page, the flag stays undefined, and the
  copy silently opens as an ordinary one. That was the first Search Desk bug, and this route is how it is
  avoided rather than remembered.

Why a poll and not a stream
  Events would arrive sooner, at the price of a held-open connection per tab, a reconnect story, and a second
  moving part to break in a room with no technician. A poll of one tiny endpoint once a second is invisible to
  a person and is the same code in every browser. A tab that was asleep checks again the moment it is looked
  at.

Options
  --port N        port to listen on (default 8000; 0 picks a free one)
  --host H        only 127.0.0.1 is accepted; anything else is refused with a message
  --workshop      serve the copy whose flag makes the practice shelf the only shelf
  --no-reload     serve the files exactly as they are, with no reload helper
  --quiet         do not log each request
  --check         check the page can be sent and the port is free, print the files it watches,
                  then stop (exit 1 with a sentence when either check fails)
"""

import argparse
import functools
import hashlib
import http.server
import json
import posixpath
import re
import socket
import sys
import threading
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
GO_FILE = ".dev-go"
HOST = "127.0.0.1"

# What the page loads. Everything else is refused: a dev server is not a way to hand out a person's exported
# shelf (a .json) or the repo's notes.
SERVE_FILES = ("index.html", "nextbook.css")
SERVE_DIRS = ("core", "modes", "data")
NEVER = (".git", "docs", "tools", "tests", "dist", "research", "node_modules", "__pycache__")
WORKSHOP_ROUTE = "/data/workshop.js"

# A screen name: the app's ids are lowercase with hyphens, and at most one / for a screen behind a tap.
GO_RE = re.compile(r"^#?[a-z][a-z0-9-]*(?:/[a-z0-9-]+)?$")

WORKSHOP_JS = "Nextbook.data.put('workshop', {\"workshop\": true});\n"


# ---- pure parts, tested in tests/test_serve.py ----------------------------------------------------------

def is_public(rel, root=None):
    """May the page have this app-relative path? 'core/base.js' yes, 'data/slice.js' yes, 'index.html' yes,
    'nextbook.css' yes; 'data/found.json' no, '.DS_Store' no, 'AGENTS.md' no, '../data/x.js' no.

    With `root`, the name must also be a regular file there: a folder called `modes/x.js` is not a file the
    page asked for, and must never become a directory listing."""
    parts = [p for p in str(rel).replace("\\", "/").split("/") if p and p != "."]
    if not parts:
        return False
    for p in parts:
        if p.startswith("."):                       # .git, .DS_Store, .env: anything hidden, at any level
            return False
        if p in NEVER:
            return False
    name = parts[-1]
    if name.endswith("~") or name.endswith(".json"):    # an editor's backup, or a person's exported shelf
        return False
    if len(parts) == 1:
        if name not in SERVE_FILES:
            return False
    elif not (parts[0] in SERVE_DIRS and name.endswith(".js")):
        return False
    return True if root is None else (Path(root) / "/".join(parts)).is_file()


def watched_files(root):
    """Every app-relative path the reload watches, sorted. Deterministic, so a test can compare it.

    .dev-go is deliberately not here. A note is read by the page and cleared by a report, and if the note were
    part of the token, clearing it would look like a change and reload the page a second time for nothing."""
    out = [name for name in SERVE_FILES if (root / name).is_file()]
    for folder in SERVE_DIRS:
        base = root / folder
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.is_file() and is_public(path.relative_to(root).as_posix(), root):
                out.append(path.relative_to(root).as_posix())
    return sorted(set(out))


def token_for(root, files):
    """A short string that changes when any watched file changes. Stat only, never a read, so it is cheap
    enough to call on every poll. It is a hash of the files, not of a clock, so restarting the server does not
    look like a change and reload nothing."""
    h = hashlib.sha256()
    for rel in files:
        try:
            st = (root / rel).stat()
            h.update(("%s|%d|%d\n" % (rel, st.st_mtime_ns, st.st_size)).encode("utf-8"))
        except OSError:
            h.update(("%s|gone\n" % rel).encode("utf-8"))
    return h.hexdigest()[:12]


def go_route(text):
    """The screen name in .dev-go, or '' when there is not one to act on. First line only, trimmed, no quotes
    and no spaces: this is a route, written by somebody in a hurry. Returns '' rather than raising, because an
    unreadable note must never take the page down."""
    if not text:
        return ""
    first = str(text).strip().split("\n")[0].strip()
    if not first or len(first) > 60 or not GO_RE.match(first):
        return ""
    return first[1:] if first.startswith("#") else first


def read_go(root):
    """The pending screen name, or ''. It is not taken out of the file here: the note stays until a page says
    it drew it, so a tab that died on the way cannot swallow it."""
    try:
        return go_route((Path(root) / GO_FILE).read_text(encoding="utf-8"))
    except OSError:
        return ""


def clear_go(root, route):
    """Take the note out of the file, but only if it is still the note that was shown. A newer note written
    while the old one was in flight is left alone. True when the file is gone."""
    path = Path(root) / GO_FILE
    if not route or read_go(root) != route:
        return False
    try:
        path.unlink()
        return True
    except OSError as e:
        say("  could not take %s out of .dev-go (%s); it will be used again" % (route, e.strerror or e))
        return False


def dev_script(token, go, reload=True):
    """The text this server adds to the page it sends. Never written to disk, so app/index.html stays the plain
    source page."""
    if not reload:
        return ""
    return ("<script>\n/* Added by tools/serve.py as it sends this page. It is not in the file on disk. */\n"
            + (RELOAD_JS % (json.dumps(token or ""), json.dumps(go or ""))) + "</script>\n")


def add_scripts(html, scripts):
    """The page with `scripts` in its head, before the app's own scripts, so the helper is in place by the time
    the page fires `load`. None when the page has no </head>: better to serve it untouched than half-changed."""
    if not scripts:
        return html
    at = html.find("</head>")
    if at < 0:
        return None
    return html[:at] + scripts + html[at:]


RELOAD_JS = r"""(function () {
  var MARK = 'nextbook-dev-reload';
  if (window[MARK]) return;                       // the server added this twice: once is enough
  window[MARK] = true;
  var token = %s;                                 // what was on disk when this page was sent
  var go = %s;                                    // a screen to go to, or ''
  var shown = go;
  var waiting = false;
  function typing() {
    var a = document.activeElement;
    if (!a) return false;
    var tag = (a.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    var type = (a.type || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit') return false;
    return !!a.value;                              // an empty box costs nothing to lose
  }
  function bar() {
    var n = document.createElement('div');
    n.setAttribute('data-test', 'dev-reload-bar');
    n.textContent = 'New version ready.';
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Reload now';
    b.style.cssText = 'margin-left:.75rem;font:inherit;font-weight:inherit;padding:.2rem .6rem;'
      + 'border-radius:.4rem;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer';
    b.addEventListener('click', function () { window.location.reload(); });
    n.appendChild(b);
    n.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;'
      + 'align-items:center;justify-content:center;padding:.5rem;font:700 .95rem/1.3 system-ui,sans-serif;'
      + 'color:#fff;background:#0b5cad';
    document.body.appendChild(n);
  }
  function reloadNow() {
    if (waiting) return;
    waiting = true;
    if (typing()) { bar(); return; }               // someone is mid-sentence: their call, not ours
    try { sessionStorage.setItem('nextbook-dev-y', String(window.scrollY || 0)); } catch (e) {}
    window.location.reload();
  }
  function restore() {
    var y = 0;
    try { y = Number(sessionStorage.getItem('nextbook-dev-y') || 0); } catch (e) {}
    if (y > 0 && !typing()) window.scrollTo(0, y);
  }
  function show(route) {
    // The app's own router, so a name that is not a screen lands on #find instead of breaking anything, and
    // going to the screen you are already on draws it again.
    if (!route) return false;
    try {
      if (window.Nextbook && Nextbook.shell && Nextbook.shell.go) Nextbook.shell.go(route);
      else window.location.hash = '#' + route;
    } catch (e) { window.location.hash = '#' + route; }
    return true;
  }
  function report(route) {
    // Only now may the server take the note out of .dev-go: a page that never drew it must not eat it.
    fetch('/__go-shown', { method: 'POST', cache: 'no-store', body: route })['catch'](function () {});
  }
  function tick() {
    fetch('/__dev', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) {
      if (t !== token && !document.hidden) reloadNow();
    })['catch'](function () {});                   // the laptop asleep, or the server stopped
    fetch('/__go', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (route) {
      if (!route) { shown = ''; return; }          // the note was drawn: the next one may repeat it
      if (route !== shown) { shown = route; if (show(route)) report(route); }
    })['catch'](function () {});
  }
  function loop() {
    // A tab nobody is looking at is still checked, just less often, and the chain always carries on.
    tick();
    setTimeout(loop, document.hidden ? 2000 : 1000);
  }
  window.addEventListener('load', function () {
    if (go) { show(go); report(go); } else restore();   // a screen to go to beats putting the old place back
    loop();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
})();
"""


# ---- the parts that serve and watch ---------------------------------------------------------------------

class Handler(http.server.SimpleHTTPRequestHandler):
    """The app's files, plus three routes: /__dev (the token), /__go (a pending screen) and /__go-shown (the
    page saying it drew that screen), and the page with the reload helper added. Every response says no-store,
    so the screen and the disk agree."""

    server_version = "NextbookDev"
    root = APP
    go_root = ROOT            # .dev-go sits beside app/, not inside it: the app folder is never written to
    reload = True
    workshop = False
    verbose = True
    token = ""
    lock = threading.Lock()

    def log_message(self, fmt, *args):
        if self.verbose:
            say("  " + (fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def translate_path(self, path):
        """SimpleHTTPRequestHandler's job, but refusing whatever is_public() says the page has no business
        having. A blocked path is sent to a file that does not exist, so the answer is an ordinary 404."""
        rel = urllib.parse.unquote(urllib.parse.urlparse(path).path)
        rel = posixpath.normpath(rel).lstrip("/")
        if rel in ("", "index.html"):
            return str(self.root / "index.html")
        blocked = str(self.root / ".not-served")
        if not is_public(rel, self.root):
            return blocked
        full = (self.root / rel).resolve()
        try:
            full.relative_to(self.root.resolve())   # no walking out of the folder with ..
        except ValueError:
            return blocked
        return str(full)

    def do_GET(self):
        if self.refuse_nul():
            return
        route = self.path.split("?")[0]
        if route in ("/__dev", "/__dev/"):
            return self.serve_token()
        if route in ("/__go", "/__go/"):
            return self.send_bytes(read_go(self.go_root).encode("utf-8"), "text/plain; charset=utf-8")
        if route in ("/", "/index.html"):
            return self.serve_page()
        if route == WORKSHOP_ROUTE and self.workshop:
            # The flag is a file the page already asks for, made up on the way out. Nothing is written into
            # app/, and no line is added to index.html for a script tag to be missed around.
            return self.send_bytes(WORKSHOP_JS.encode("utf-8"), "application/javascript; charset=utf-8")
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

    def do_HEAD(self):
        return self.do_GET()

    def refuse_nul(self):
        """A path with a NUL byte is not a path: 400 in one line, not a ValueError traceback."""
        if "\x00" in urllib.parse.unquote(self.path):
            self.send_error(400, "the request path holds a NUL byte")
            return True
        return False

    def copyfile(self, source, outputfile):
        """A HEAD request asks for the headers only, so a static file's body is never written."""
        if self.command == "HEAD":
            return
        http.server.SimpleHTTPRequestHandler.copyfile(self, source, outputfile)

    def do_POST(self):
        """The one write a page may ask for: 'I drew this screen', so the note may go."""
        route = self.path.split("?")[0]
        if route not in ("/__go-shown", "/__go-shown/"):
            return self.send_error(404)
        try:
            size = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            size = 0
        if size <= 0 or size > 200:
            return self.send_error(400)
        shown = go_route(self.rfile.read(size).decode("utf-8", "replace"))
        if not shown:
            return self.send_error(400)
        if clear_go(self.go_root, shown):
            say("  the tab drew #%s; the note is used" % shown)
        self.send_response(204)
        self.end_headers()

    def send_bytes(self, body, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def serve_token(self):
        """The token for right now. Reading it is also what notices a change."""
        token = token_for(self.root, watched_files(self.root))
        with self.lock:
            self.token = token
        self.send_bytes(token.encode("ascii"), "text/plain; charset=utf-8")

    def serve_page(self):
        try:
            html = (self.root / "index.html").read_text(encoding="utf-8")
        except OSError:
            self.send_error(500, "no index.html in this folder")
            return
        go = read_go(self.go_root) if self.reload else ""
        file_token = token_for(self.root, watched_files(self.root))
        with self.lock:
            self.token = file_token
        page = add_scripts(html, dev_script(file_token, go, self.reload))
        if page is None:
            self.send_error(500, "this page has no </head> for the dev script to go in")
            return
        self.send_bytes(page.encode("utf-8"), "text/html; charset=utf-8")


def say(text):
    sys.stderr.write(text if text.endswith("\n") else text + "\n")
    sys.stderr.flush()


def make_server(root=APP, port=8000, workshop=False, reload=True, verbose=True, go_root=None):
    """A server for one folder, bound to 127.0.0.1 and nothing else. Its settings live on its own handler class,
    so two servers in one process (a test, say) never share them."""
    root = Path(root).resolve()
    go_root = Path(go_root).resolve() if go_root else root.parent
    cls = type("NextbookDevHandler", (Handler,), {
        "root": root,
        "go_root": go_root,
        "workshop": bool(workshop),
        "reload": bool(reload),
        "verbose": bool(verbose),
        "token": token_for(root, watched_files(root)),
        "lock": threading.Lock(),
    })
    handler = functools.partial(cls, directory=str(root))
    return http.server.ThreadingHTTPServer((HOST, port), handler)


def intro(args, port):
    lines = ["", "  nextbook, from a folder.", ""]
    lines.append("      http://%s:%d/" % (HOST, port))
    lines += ["", "  Stop with Ctrl-C."]
    if args.workshop:
        lines.append("  Practice copy: the practice shelf is the only shelf, and the page asks the network for nothing.")
    else:
        lines.append("  Ordinary copy: it starts from the practice shelf too, and can switch to your own.")
    if args.reload:
        lines.append("  The page reloads itself when a file changes. If someone is typing, it waits for a click.")
        lines.append("  To send the tab to a screen, write its name in .dev-go:  echo shelf > .dev-go")
        lines.append("  (used once a page says it drew it, so writing the same word twice works twice)")
    else:
        lines.append("  Auto-reload is off. Reload the page by hand to see a change.")
    lines.append("  This computer only: it listens on 127.0.0.1, so nobody else on the network can open it.")
    lines += ["", ""]
    return "\n".join(lines)


PROBE_SCRIPT = "<script></script>"


def check_ready(port):
    """What --check can be sure of without serving: the page can be sent, and the port is free.

    Returns a list of plain sentences; empty means both hold. Nothing is written and nothing is bound
    for longer than the check."""
    problems = []
    try:
        page = (APP / "index.html").read_text(encoding="utf-8")
    except OSError as e:
        problems.append("cannot read app/index.html (%s)" % (e.strerror or e))
    else:
        if add_scripts(page, PROBE_SCRIPT) is None:
            problems.append("app/index.html has no </head>, so every page it sends would be a 500")
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind((HOST, port))
    except OSError as e:
        problems.append("cannot listen on %s:%d (%s)" % (HOST, port, e.strerror or e))
    finally:
        probe.close()
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description="Serve app/ with live reload, on this computer only.")
    ap.add_argument("--port", type=int, default=8000, help="port to listen on (default 8000; 0 picks a free one)")
    ap.add_argument("--host", default=HOST, help="only 127.0.0.1 is accepted")
    ap.add_argument("--workshop", action="store_true",
                    help="serve the copy whose flag makes the practice shelf the only shelf")
    ap.add_argument("--no-reload", dest="reload", action="store_false", default=True,
                    help="serve the files exactly as they are, with no reload helper")
    ap.add_argument("--quiet", action="store_true", help="do not log each request")
    ap.add_argument("--check", action="store_true",
                    help="check the page can be sent and the port is free, print what it watches, then stop")
    args = ap.parse_args(argv)

    if args.host != HOST:
        sys.exit("serve: this server listens on 127.0.0.1 only, so nobody else on the network can open it. "
                 "Drop --host, or pass 127.0.0.1. It will not bind %s." % args.host)
    if not 0 <= args.port <= 65535:
        sys.exit("serve: --port must be 0-65535, where 0 picks a free one; %d is not a port." % args.port)
    if not (APP / "index.html").is_file():
        sys.exit("serve: no app/index.html here. Run this from inside the nextbook folder.")

    files = watched_files(APP)
    if args.check:
        problems = check_ready(args.port)
        if problems:
            for problem in problems:
                say("serve: " + problem)
            sys.exit(1)
        say("app/index.html and %d more files, under %s" % (len(files) - 1, " ".join(SERVE_DIRS)))
        say("token now: %s" % token_for(APP, files))
        note = read_go(ROOT)
        say(" .dev-go: %s" % ("waiting to go to #" + note if note else "no note"))
        for rel in files:
            say("  %s" % rel)
        return

    try:
        httpd = make_server(APP, args.port, workshop=args.workshop, reload=args.reload, verbose=not args.quiet)
    except OSError as e:
        sys.exit("serve: cannot listen on %s:%d (%s). Try another --port." % (HOST, args.port, e.strerror or e))
    sys.stderr.write(intro(args, httpd.server_address[1]) + "\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        say("\n  stopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
