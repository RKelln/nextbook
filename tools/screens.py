# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright==1.60.0"]
# ///
"""Screenshot every screen of nextbook, for design work.  Run: uv run tools/screens.py [options]

A dev tool, never shipped and never needed to run the app. It is the one script here that is not standard library:
uv reads the dependency from the header above, so nothing is installed into the repo. First time on a machine:
`uv run --with playwright==1.60.0 playwright install chromium`.

Takes a full-page picture of each shot at each size, in light and dark, on a fresh practice shelf, plus a few states
that only show up after a tap (the own shelf empty, a book set to reading). Writes the pictures and an index.html
contact sheet that shows them side by side, and prints one line per picture with any problem it found: sideways
scroll, a page error, or text that leaked out of an element ("null", "undefined", "[object Object]", "NaN").

Options:
  --out DIR          where to write (default screens/, which git ignores)
  --sizes LIST       any of small,phone,tablet,desk,wide (default phone,tablet,desk,wide). small is 320 wide, the
                    narrowest we support; wide is 1680, where a layout either uses the room or wastes it.
  --schemes LIST     light,dark (default light,dark)
  --only LIST        only these shots, by name (see SHOTS below), e.g. --only shelf,find
  --app PATH         the page to open (default app/index.html; try dist/demo.html after `tools/build.py --demo`
                    to see the reference modes too)
  --viewport         also save what fits on the first screen, without scrolling (named *-top.png)
  --route NAME=HASH  add a shot of any route, e.g. --route events=events (may be given more than once)
  --js NAME=CODE     add a shot that runs CODE after the page is ready, e.g. --js pick=... (may repeat)

A new screen in the nav needs nothing: every tab gets a shot named after its route, unless SHOTS already covers it.

A full-page picture is not quite what a person sees: things that are fixed or sticky are drawn where they are, not
where they sit once you scroll. FULLPAGE_CSS fixes that for the picture only (the phone tab bar is moved to the end
of the page). --viewport pictures need no fixing: they are one screen, so nothing has moved.
"""

import argparse
import html
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SIZES = {"small": (320, 640), "phone": (390, 844), "tablet": (820, 1180), "desk": (1280, 900),
         "wide": (1680, 1050)}
# For full-page pictures only. Keep the marker substring: `shoot` finds this <style> again by it.
MARK = "/* nb-screens-fullpage */"
FULLPAGE_CSS = MARK + (
    " @media (max-width: 47.99rem) { body { position: relative; } .nb-nav { position: absolute !important; } }"
)
LEAKS = ["null", "undefined", "[object Object]", "NaN"]
READY = "window.Nextbook && Nextbook.shell && Nextbook.shell.ready === true"

# Taps used by more than one shot.
OWN = "document.querySelector('[data-test=shelf-use-own]').click()"
FIRST_READING = "document.querySelector('[data-test=shelf-state-1] input[value=reading]').click()"
FIRST_WANT = "document.querySelector('[data-test=shelf-state-1] input[value=want]').click()"

# name: (hash, JS to run once the page is ready, or None).
SHOTS = {
    "find": ("find", None),
    "shelf": ("shelf", None),
    "shelf-own-empty": ("shelf", OWN),
    # The way back from the library: the import panel open on the own shelf, steps and drop box.
    "shelf-own-import": ("shelf", OWN + "; document.querySelector('[data-test=fold-library]').open = true"),
    "shelf-reading": ("shelf", FIRST_READING),
    "shelf-want": ("shelf", FIRST_WANT),
    "shelf-filter": ("shelf", "document.querySelector('[data-test=shelf-filter-read]').click()"),
    "shelf-toast": ("shelf", "document.querySelector('[data-test=shelf-remove-2]').click()"),
    "find-own-empty": ("shelf", OWN + "; location.hash = '#find'"),
    "selftest": ("selftest", None),
}


def check_page(page, width):
    found = []
    sw = page.evaluate("document.documentElement.scrollWidth")
    if sw > width:
        found.append("sideways scroll (%d > %d)" % (sw, width))
    text = page.evaluate("(document.getElementById('app') || document.body).innerText")
    for word in LEAKS:
        if any(line.strip() == word or (" " + word + " ") in (" " + line + " ") for line in text.split("\n")):
            found.append("text says %r" % word)
    return found


def shoot(page, out, name, viewport):
    page.add_style_tag(content=FULLPAGE_CSS)
    page.screenshot(path=str(out / (name + ".png")), full_page=True)
    if viewport:
        page.evaluate("document.querySelectorAll('style').forEach((s) => {"
                      " if (s.textContent.includes(%r)) s.remove(); })" % MARK)
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(out / (name + "-top.png")))


def nav_routes(browser, app):
    """The routes in the app's nav, in order, read from the nav buttons' data-test (nav-<route>)."""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(app + "#find")
    page.wait_for_function(READY)
    ids = page.evaluate("[...document.querySelectorAll('[data-test^=nav-]')].map((b) => b.dataset.test.slice(4))")
    ctx.close()
    return ids


def run(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    app = (ROOT / args.app).resolve().as_uri()
    rows, problems = [], 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        shots = dict(SHOTS)
        covered = {v[0] for v in SHOTS.values()}
        for route in nav_routes(browser, app):
            if route not in covered and route not in shots:
                shots[route] = (route, None)
        for name, hash_ in args.route:
            shots[name] = (hash_.lstrip("#"), None)
        for name, js in args.js:
            shots[name] = ("find", js)
        bad = [n for n in args.only if n not in shots]
        if bad:
            sys.exit("Unknown shot: %s. Shots: %s" % (", ".join(bad), ", ".join(shots)))
        names = [n for n in shots if not args.only or n in args.only]
        for scheme in args.schemes:
            for size in args.sizes:
                w, hgt = SIZES[size]
                for name in names:
                    hash_, js = shots[name]
                    # A fresh context per shot: empty storage, so every shot starts on the practice shelf.
                    ctx = browser.new_context(viewport={"width": w, "height": hgt}, color_scheme=scheme)
                    page = ctx.new_page()
                    errors = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    page.goto(app + "#" + hash_)
                    page.wait_for_function(READY)
                    if js:
                        try:
                            page.evaluate("() => { " + js + " }")
                        except Exception as e:  # a shot whose tap no longer exists says so, and the run goes on
                            errors.append("shot script: " + str(e).split("\n")[0])
                    page.wait_for_timeout(250)
                    file = "%s-%s-%s" % (scheme, size, name)
                    shoot(page, out, file, args.viewport)
                    found = check_page(page, w) + ["page error: " + e for e in errors]
                    problems += len(found)
                    rows.append((scheme, size, name, file, found))
                    print("%-36s %s" % (file, "; ".join(found) or "ok"))
                    ctx.close()
        browser.close()
    write_index(out, rows)
    print("\n%d pictures, %d problems. Open %s" % (len(rows), problems, (out / "index.html").resolve()))
    return 1 if problems else 0


def write_index(out, rows):
    by_name = {}
    for scheme, size, name, file, found in rows:
        by_name.setdefault(name, []).append((scheme, size, file, found))
    parts = ["<!doctype html><meta charset=utf-8><title>nextbook screens</title><style>",
             "body{font:14px system-ui;margin:1rem;background:#eee}h2{margin:2rem 0 .5rem}",
             ".row{display:flex;gap:1rem;align-items:flex-start;overflow-x:auto;padding-bottom:1rem}",
             "figure{margin:0;flex:none}figcaption{font-weight:600}.bad{color:#a4262c}",
             "img{display:block;border:1px solid #999;background:#fff}",
             ".small img,.phone img{width:300px}.tablet img{width:420px}.desk img{width:640px}.wide img{width:840px}",
             "</style><h1>nextbook screens</h1>"]
    for name, shots in by_name.items():
        parts.append("<h2>%s</h2><div class=row>" % html.escape(name))
        for scheme, size, file, found in shots:
            note = "".join("<div class=bad>%s</div>" % html.escape(f) for f in found)
            parts.append("<figure class=%s><figcaption>%s %s</figcaption>%s<a href='%s.png'>"
                         "<img src='%s.png' loading=lazy></a></figure>" % (size, scheme, size, note, file, file))
        parts.append("</div>")
    (out / "index.html").write_text("".join(parts), encoding="utf-8")


def pairs(items, flag):
    got = [r.split("=", 1) for r in items]
    if any(len(r) != 2 or not r[0] or not r[1] for r in got):
        sys.exit("%s needs NAME=VALUE" % flag)
    return got


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(ROOT / "screens"))
    ap.add_argument("--sizes", default="phone,tablet,desk,wide")
    ap.add_argument("--schemes", default="light,dark")
    ap.add_argument("--only", default="")
    ap.add_argument("--app", default="app/index.html")
    ap.add_argument("--viewport", action="store_true")
    ap.add_argument("--route", action="append", default=[])
    ap.add_argument("--js", action="append", default=[])
    args = ap.parse_args()
    args.sizes = [s for s in args.sizes.split(",") if s]
    args.schemes = [s for s in args.schemes.split(",") if s]
    args.only = [s for s in args.only.split(",") if s]
    bad = [s for s in args.sizes if s not in SIZES]
    if bad:
        sys.exit("Unknown size: %s. Sizes: %s" % (", ".join(bad), ", ".join(SIZES)))
    args.route = pairs(args.route, "--route")
    args.js = pairs(args.js, "--js")
    sys.exit(run(args))


if __name__ == "__main__":
    main()
