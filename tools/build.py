#!/usr/bin/env python3
"""Pack nextbook: one file, the workshop folder, or the projector file.

    python3 tools/build.py            dist/nextbook.html   one file, to carry or host
    python3 tools/build.py --demo     dist/demo.html       the same, with the finished demo modes
    python3 tools/build.py --starter  dist/starter/        the folder a participant works in

Ported from searchdesk/tools/build.py (MIT, same author): `app/index.html` is the template and
the boot order, its `inline()` and escaping are kept, and any `src`, `href`, `action` or
`formaction` that points off the folder stops the build instead of shipping a page that cannot load.

How the one file is made
  Every `<script src>` and stylesheet in `app/index.html` is read, in order, and put inline. The
  data scripts become `<script type="application/json" id="nb-<name>">` blocks, which is what
  `Nextbook.data.get` already reads, so the page has no file to fetch. A mode is loaded by the
  shell at run time from `modes/<id>.js`; in one file those files are inline too, and a short
  shim keeps the shell from asking the folder for them (see `modes_shim`).
  `data/workshop.js` is never packed: it is the flag a workshop *folder* carries so the practice
  shelf is the only shelf on a shared machine, and a take-home file is the person's own copy.
  `data/inbox.js` is never packed either: it is one machine's message from a helper, not data
  for the copy it is built in. `data/distance.js` is never packed: travel times from one start
  point show where that point is, and people share the one file.

Nothing here fetches anything and nothing here runs the app: it only reads files and writes
`dist/`, which git ignores. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
DIST = ROOT / "dist"

EXAMPLE_MODE = "more-by"            # T4.1: the one mode the workshop folder ships
WORKSHOP_DATA = "data/workshop.js"  # the folder's workshop flag; never packed (see above)
INBOX_DATA = "data/inbox.js"        # one machine's message from a helper; never packed
DISTANCE_DATA = "data/distance.js"  # one person's travel times from one start point; never packed
# Files in data/ that belong to one person's machine and are never copied into the starter either.
PERSONAL_DATA = ("distance-map.json", "distance-transit-cache.json", "found.json")
# Built from two pieces on purpose: this file is copied into dist/starter/, and the starter must
# not name, or hold, the folder of finished demo modes (BUILD.md T5.2's grep).
DEMO_MODES = ROOT / ("re" "ference") / "modes"

ID_RE = re.compile(r"^[a-z][a-z0-9-]*$")
# Tags are read tolerantly: attributes in any order, single or double quotes, or none at all. A tag
# written `<script defer src='core/base.js'>` is the same tag as `<script src="core/base.js">`, and
# it must not slip past the packer just because it is spelled differently.
TAG_RE = re.compile(r"<(/?)([a-zA-Z][^\s/>]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*)>", re.S)
ATTR_RE = re.compile(r"""([^\s=/>\"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>\"']+)))?""")
RAW_TEXT = ("script", "style")            # their contents are text, never tags
REF_ATTRS = ("src", "href", "action", "formaction")
CLOSE_SCRIPT = re.compile(r"</script\s*>", re.I)
PUT_RE = re.compile(r"^\s*Nextbook\.data\.put\(\s*(['\"])([A-Za-z0-9_-]+)\1\s*,\s*(.*)\);\s*$", re.S)
BLOCK_RE = re.compile(r'<script type="application/json" id="nb-[A-Za-z0-9_-]+">.*?</script>', re.S)


class BuildError(ValueError):
    """A build that cannot produce an honest file. `main` says it in one plain line."""


# ---- pure parts -------------------------------------------------------------------------------

def normalise(text):
    """LF newlines, so a build on a Mac and on Linux is the same text."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def strip_comments(html):
    """The template without its comments, so a commented-out tag is never carried."""
    return re.sub(r"<!--.*?-->", "", html, flags=re.S)


def read_tags(html):
    """(name, attributes, start, end) for every tag, in order.

    Attributes are read tolerantly: any order, single or double quotes, or no quotes, and a tag is
    named whether it closes or not. A script's or style's contents are skipped, because they are
    text and a `<` in a comparison inside one is not a tag.
    """
    out, pos = [], 0
    while True:
        m = TAG_RE.search(html, pos)
        if not m:
            break
        name = m.group(2).lower()
        attrs = {}
        for a in ATTR_RE.finditer(m.group(3)):
            value = a.group(2)
            if value is None:
                value = a.group(3)
            if value is None:
                value = a.group(4)
            attrs.setdefault(a.group(1).lower(), "" if value is None else value)
        out.append((name, attrs, m.start(), m.end()))
        pos = m.end()
        if not m.group(1) and name in RAW_TEXT:
            close = re.compile(r"</" + name + r"\s*>", re.I).search(html, pos)
            if close:
                pos = close.end()
    return out


def parse_boot_order(html):
    """The files index.html loads, in order: {'styles': [...], 'scripts': [...]}.

    The same tolerant reader the inliner uses, so a tag it can inline is a tag this can see."""
    styles, scripts = [], []
    for name, attrs, _, _ in read_tags(strip_comments(html)):
        if name == "link" and "stylesheet" in attrs.get("rel", "").lower().split():
            if attrs.get("href"):
                styles.append(attrs["href"])
        elif name == "script" and attrs.get("src"):
            scripts.append(attrs["src"])
    return {"styles": styles, "scripts": scripts}


def check_local(ref, base, tag):
    """The file a src or href names, or a BuildError when it points off the folder."""
    if re.match(r"^[a-z][a-z0-9+.-]*:", ref, re.I) or ref.startswith("//"):
        raise BuildError("%s points off the folder: %s (a packed page may not fetch)" % (tag, ref))
    if ref.startswith("/"):
        raise BuildError("%s points off the folder: %s (the page must work from its own folder)" % (tag, ref))
    path = (base / ref).resolve()
    try:
        path.relative_to(base.resolve())
    except ValueError:
        raise BuildError("%s points off the folder: %s" % (tag, ref))
    return path


def check_refs(html, base=None):
    """Every src, href, action and formaction names a file in the folder, or is a #fragment.

    The inliner only knows scripts and stylesheets. A page that sends the browser to a CDN for an
    image, a frame or a form is just as broken off the folder as one that loads a script there, so
    every address on the page is checked, whatever tag it is written on.
    """
    base = Path(base) if base is not None else APP
    for name, attrs, _, _ in read_tags(html):
        for attr in REF_ATTRS:
            value = attrs.get(attr, "").strip()
            if not value or value.startswith("#"):
                continue                      # an empty attribute, or a link within the page
            check_local(value, base, "<%s> %s" % (name, attr))


def check_no_refs_left(html):
    """After inlining, no tag may still name a file: the one file has no folder beside it."""
    left = []
    for name, attrs, _, _ in read_tags(html):
        for attr in ("src", "href"):
            value = attrs.get(attr, "").strip()
            if value and not value.startswith("#"):
                left.append('<%s> %s="%s"' % (name, attr, value))
    if left:
        raise BuildError("the one file would still ask its folder for: " + ", ".join(left))


def inline_tags(html, style_for, script_for):
    """One pass: a stylesheet becomes <style>, a script with a src becomes an inline script.

    It reads every tag the way the checks do, so a spelling the old regexes did not know is inlined
    rather than left in the page to be fetched."""
    out, pos = [], 0
    for name, attrs, start, end in read_tags(html):
        if name == "link" and "stylesheet" in attrs.get("rel", "").lower().split() and attrs.get("href"):
            out.append(html[pos:start])
            out.append(style_for(attrs["href"]))
            pos = end
        elif name == "script" and attrs.get("src"):
            close = CLOSE_SCRIPT.search(html, end)
            if not close:
                raise BuildError('<script src="%s"> has no closing tag' % attrs["src"])
            out.append(html[pos:start])
            out.append(script_for(attrs["src"]))
            pos = close.end()
    out.append(html[pos:])
    return "".join(out)


def safe_inline_script(code):
    """Make code safe between <script> tags without changing what it means."""
    code = re.sub(r"</(script)", lambda m: "<\\/" + m.group(1), code, flags=re.I)
    return code.replace("<!--", "<\\!--")


def data_put(text, path):
    """('name', json text) from `Nextbook.data.put('<name>', <json>);`, or a BuildError."""
    m = PUT_RE.match(text)
    if not m:
        raise BuildError(path + " is not the one call Nextbook.data.put('<name>', <json>);")
    name, body = m.group(2), m.group(3)
    try:
        json.loads(body)
    except ValueError as e:
        raise BuildError(path + " does not hold usable JSON: " + str(e))
    return name, body


def json_block(name, body):
    """The data, as the block Nextbook.data.get reads. gen_data.py already escaped <, > and &."""
    if re.search(r"</script", body, re.I):
        raise BuildError("data/" + name + ".js holds a literal </script; regenerate it with gen_data.py")
    return '<script type="application/json" id="nb-' + name + '">\n' + body + "\n</script>"


def parse_mode_ids(list_js):
    """The ids in `Nextbook.modes = [...]`, in order."""
    m = re.search(r"Nextbook\.modes\s*=\s*\[(.*?)\]", re.sub(r"//[^\n]*", "", list_js), re.S)
    if not m:
        raise BuildError("app/modes/list.js has no Nextbook.modes list")
    return re.findall(r"""['"]([^'"]+)['"]""", m.group(1))


def js_string_list(ids):
    return "[" + ", ".join(json.dumps(i) for i in ids) + "]"


def modes_shim(ids):
    """Runs after list.js. In one file every mode and its check is inline, so the shell must not
    ask the folder for `modes/<id>.check.js` and log a missing file. The list is held, not lost:
    `modes_restore` hands it back once the shell has booted."""
    return (
        "(function (window) {\n"
        "  var Nextbook = window.Nextbook;\n"
        "  // The modes below are already here; hold the list until the shell has booted.\n"
        "  window.__nbPackedModes = " + js_string_list(ids) + ";\n"
        "  Nextbook.modes = [];\n"
        "})(window);\n"
    )


def modes_restore():
    """Runs after the shell. `boot` waits for DOMContentLoaded, and its listener is registered
    first, so this one runs after the shell has drawn once with no list."""
    return (
        "(function (window) {\n"
        "  function restore() {\n"
        "    var Nextbook = window.Nextbook;\n"
        "    Nextbook.modes = window.__nbPackedModes || [];\n"
        "    delete window.__nbPackedModes;\n"
        "    if (Nextbook.shell && typeof Nextbook.shell.render === 'function') Nextbook.shell.render();\n"
        "  }\n"
        "  if (window.document.readyState === 'loading') window.addEventListener('DOMContentLoaded', restore);\n"
        "  else restore();\n"
        "})(window);\n"
    )


def mode_paths(mode_id, app_modes, demo_modes=None):
    """(mode file, check file) for an id, or a BuildError naming what is missing."""
    if not ID_RE.match(mode_id):
        raise BuildError("the mode list names %r, which is not a usable id" % (mode_id,))
    for base in ([app_modes] + ([demo_modes] if demo_modes else [])):
        js = base / (mode_id + ".js")
        if js.is_file():
            check = base / (mode_id + ".check.js")
            if not check.is_file():
                raise BuildError("modes/" + mode_id + ".check.js is missing, so the mode has no checks")
            return js, check
    raise BuildError("the mode list names '" + mode_id + "', which is in no modes folder")


def demo_mode_ids(demo_modes):
    """Every finished demo mode in the folder, in name order. A copy without the folder has none."""
    if not demo_modes.is_dir():
        return []
    ids = []
    for path in sorted(demo_modes.glob("*.js")):
        if path.name.endswith(".check.js"):
            continue
        ids.append(path.stem)
    return ids


def assemble(template, read, demo_modes=None):
    """The page text. `read(path)` reads an absolute Path. `demo_modes` is a folder to take
    finished demo modes from, or None for the plain one file. Returns (html, info)."""
    clean = normalise(strip_comments(template))
    check_refs(clean)
    scripts, blocks, notes = [], [], []
    listed = parse_mode_ids(read(APP / "modes" / "list.js"))
    extra = [i for i in demo_mode_ids(demo_modes) if i not in listed] if demo_modes else []

    def inline(code):
        code = safe_inline_script(normalise(code))
        if not code.endswith("\n"):
            code += "\n"
        scripts.append(code)
        return "<script>" + code + "</script>"

    def style_tag(ref):
        css = normalise(read(check_local(ref, APP, "<link> href")))
        if re.search(r"</style", css, re.I):
            raise BuildError(ref + " contains </style")
        return "<style>\n" + css + ("" if css.endswith("\n") else "\n") + "</style>"

    def script_tag(src):
        if src == WORKSHOP_DATA:
            notes.append("data/workshop.js is the workshop folder's flag, so it is not packed")
            return ""
        if src == INBOX_DATA:
            notes.append("data/inbox.js is one machine's message from a helper, so it is not packed")
            return ""
        if src == DISTANCE_DATA:
            notes.append("data/distance.js is one person's travel times, so it is not packed")
            return ""
        path = check_local(src, APP, "<script> src")
        if src.startswith("data/") and src.endswith(".js"):
            if not path.is_file():
                notes.append("no " + src + " in this folder, so the page has none")
                return ""
            name, body = data_put(path.read_text(encoding="utf-8"), src)
            if name != path.stem:
                raise BuildError(src + " holds the name '" + name + "'; it must be '" + path.stem + "'")
            blocks.append(name)
            return json_block(name, body)
        if not path.is_file():
            raise BuildError("app/index.html loads " + src + ", which is not in app/")
        text = path.read_text(encoding="utf-8")

        if src == "modes/list.js":
            ids = listed + extra
            out = [inline(text)]
            if ids:
                out.append(inline(modes_shim(ids)))
            for mode_id in ids:
                js, check = mode_paths(mode_id, APP / "modes", demo_modes)
                out.append(inline(js.read_text(encoding="utf-8")))
                out.append(inline(check.read_text(encoding="utf-8")))
            return "\n".join(out)

        if src == "core/shell.js":
            if listed or extra:
                return inline(text) + "\n" + inline(modes_restore())
            return inline(text)

        return inline(text)

    # Tidy the template only. A script is never touched again after it is inlined.
    clean = re.sub(r"\n[ \t]*\n+", "\n", clean)
    body = inline_tags(clean, style_tag, script_tag)
    # Every tag was read the same way, so this can only fail if the inliner missed one: say which.
    check_no_refs_left(body)
    marker = "<!-- nextbook, one file. Built by tools/build.py: edit app/, never this file. -->"
    if "<meta charset" not in body:
        raise BuildError("app/index.html needs a <meta charset> in its head")
    body = re.sub(r"(<meta charset[^>]*>\s*)", lambda m: m.group(1) + marker + "\n", body, count=1)
    info = {"scripts": len(scripts), "blocks": blocks, "notes": notes,
            "modes": listed + extra}
    return body, info


# ---- the parts that touch the disk ------------------------------------------------------------

def read(path):
    """A file's text, given its absolute Path."""
    return Path(path).read_text(encoding="utf-8")


def reset_dist():
    """Empty dist/, for `--clean` only.

    A file left there by hand would otherwise sit beside the build for ever and could be shipped as
    part of it. Only a folder named `dist` is ever cleared, and nothing outside it is touched."""
    if DIST.name != "dist" or DIST == ROOT:
        raise BuildError("refusing to clear " + str(DIST))
    if DIST.is_dir():
        shutil.rmtree(DIST)
    elif DIST.exists():
        raise BuildError(str(DIST) + " is a file, not the folder this build writes")
    DIST.mkdir(parents=True)


def clear_output(path):
    """Remove one generated artifact, and nothing else.

    Each build replaces what it writes: making the starter must not delete the one file made a
    minute earlier, because the kit needs both. Only a real path inside dist/ is ever removed."""
    if DIST.name != "dist" or DIST == ROOT:
        raise BuildError("refusing to clear " + str(DIST))
    target = Path(path)
    if target != DIST and DIST not in target.parents:
        raise BuildError("refusing to clear " + str(target))
    if target == DIST:
        reset_dist()
        return
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()
    DIST.mkdir(parents=True, exist_ok=True)


def strays(produced):
    """Files in dist/ that this build did not write and that are not its siblings' outputs.

    The three builds (one file, demo, starter) are meant to sit beside each other: the kit needs
    the folder and a presenter's laptop needs the demo. Anything else is a leftover worth naming."""
    if not DIST.is_dir():
        return []
    keep = {Path(p) for p in produced} | {DIST / "nextbook.html", DIST / "demo.html", DIST / "starter"}
    out = []
    for item in sorted(DIST.iterdir()):
        if item in keep:
            continue
        out.append(item)
    return out


def warn_strays(produced):
    for item in strays(produced):
        print("note: %s is in dist/ and this build did not write it; "
              "run --clean if it should not ship" % item)


def build_page(demo_modes=None):
    """(html, info) for the one file, made in memory. No dist/ is written."""
    template = read(APP / "index.html")
    return assemble(template, read, demo_modes)


def write_page(name, demo_modes=None):
    html, info = build_page(demo_modes)          # a failed build leaves dist/ as it was
    out = DIST / name
    clear_output(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_lf(out, html)
    info["out"] = out
    info["bytes"] = len(html.encode("utf-8"))
    warn_strays([out])
    return info


def say(info):
    for note in info["notes"]:
        print("note: " + note)
    print("built %s  %d bytes  %d inline scripts  %d JSON blocks  modes: %s" % (
        info["out"], info["bytes"], info["scripts"], len(info["blocks"]),
        ", ".join(info["modes"]) or "(none)"))


# ---- the starter folder -----------------------------------------------------------------------

PLAN_MD = """# The plan for this mode

Write this before the code, in your own words. It is for you and the next person.

## The mode in a sentence

## The output

## The rule

## Two ways to test it

## Still broken
"""

README_MD = """# nextbook: the workshop folder

nextbook helps one person decide what to read next from their public library's catalogue, then
links them to the library's page for the book. It needs no install, no server and no network.

## Open it

1. Open `app/index.html` in Chrome. That is the whole app.
2. The practice shelf is the only shelf in this copy. Reset puts it back.
3. `app/index.html#selftest` runs the app's own checks in the browser.

## Make a way of choosing books

The briefs are in `docs/modes/`, one page each. The rules are in `docs/CONTRACT.md`.
A mode is `app/modes/<id>.js`, its check `app/modes/<id>.check.js`, one line in
`app/modes/list.js`, and your plan in words in `app/PLAN.md`.

## Checks

    node tools/check-mode.js <id>      one mode
    node tools/check-mode.js --all     every mode the app lists
    bash tools/check.sh <id>           the same, on a Mac with no Node

## A one-file copy to take home

    python3 tools/build.py             dist/nextbook.html

## Finding books

    python3 tools/find.py "birds toronto"

It shows the search it is about to send before it sends it, then adds the books to the list.
It contacts the library only when you ask. The optional agent connection below uses localhost.

## Optional agent access

Use `/use-nextbook`, or read `.claude/skills/use-nextbook/SKILL.md`. Before reading or writing, the
agent warns that the book titles and details it handles become part of the AI conversation.

    python3 tools/serve.py --workshop --mirror
    python3 tools/read-shelf.py --find "Piranesi"

Open the printed address and keep one app tab open. The active practice shelf is copied to
`nextbook-live.json`; no export is needed. The agent writes changes with `tools/inbox.py`, and the
app applies them on reload with Undo. Sharing is off by default and the one-file app has no mirror.
A different port or a file opened directly has separate browser storage.

Stop the server to stop updates. The last snapshot remains until you delete `nextbook-live.json`.
Do not include it, inbox data, or temporary shelf files when sharing your project folder.

## Licence

MIT. See `LICENSE`.
"""

STARTER_FILES = (
    "app/index.html",
    "app/nextbook.css",
    "docs/CONTRACT.md",
    "tools/check-mode.js",
    "tools/check.sh",
    "tools/coverage.py",
    "tools/gen_data.py",
    "tools/find.py",
    "tools/inbox.py",
    "tools/read-shelf.py",
    "adapters/__init__.py",
    "adapters/bibliocommons/__init__.py",
    "adapters/bibliocommons/config.json",
    "adapters/bibliocommons/fetch.py",
    "adapters/bibliocommons/libraries/tpl.json",
    "adapters/bibliocommons/normalise.py",
    "adapters/bibliocommons/parse.py",
    "LICENSE",
)


def write_lf(path, text):
    """Write text with LF line ends. Path.write_text(newline=) needs Python 3.10; the Mini has 3.9."""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def copy_into(out, rel, target=None):
    source = ROOT / rel
    if not source.is_file():
        raise BuildError("the starter needs " + rel + ", which is not in this folder")
    dest = out / (target or rel)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, dest)
    return dest


def starter_list_js():
    """app/modes/list.js with only the example mode listed: the participant's work is theirs."""
    text = read(APP / "modes" / "list.js")
    if not ID_RE.match(EXAMPLE_MODE):
        raise BuildError("EXAMPLE_MODE is not a usable id")
    if not (APP / "modes" / (EXAMPLE_MODE + ".js")).is_file():
        raise BuildError("app/modes/" + EXAMPLE_MODE + ".js is the example mode and is not here")
    new, n = re.subn(r"Nextbook\.modes\s*=\s*\[[^\]]*\]",
                     "Nextbook.modes = ['" + EXAMPLE_MODE + "']", text, count=1)
    if n != 1:
        raise BuildError("app/modes/list.js has no Nextbook.modes list to narrow")
    return new


def build_starter():
    out = DIST / "starter"
    if out.name != "starter" or out.parent != DIST:
        raise BuildError("refusing to clear " + str(out))
    clear_output(out)              # the folder is generated: nothing hand-placed inside it survives
    out.mkdir()

    for rel in STARTER_FILES:
        copy_into(out, rel)
    for js in sorted((APP / "core").glob("*.js")):
        copy_into(out, str(js.relative_to(ROOT)))

    # The app: every core file, the example mode only, the data the folder ships.
    copy_into(out, "app/modes/%s.js" % EXAMPLE_MODE)
    copy_into(out, "app/modes/%s.check.js" % EXAMPLE_MODE)
    write_lf(out / "app/modes/list.js", starter_list_js())
    for name in ("slice", "tags", "practice", "events"):
        src = APP / "data" / (name + ".js")
        if src.is_file():
            copy_into(out, str(src.relative_to(ROOT)))
    write_lf(out / "app/data/workshop.js", "Nextbook.data.put('workshop', {\"workshop\":true});\n")
    write_lf(out / "app/PLAN.md", PLAN_MD)

    # The canonical data and its schemas, and the briefs.
    for path in sorted((ROOT / "data").glob("*.json")):
        if path.name in PERSONAL_DATA:
            continue
        copy_into(out, str(path.relative_to(ROOT)))
    for path in sorted((ROOT / "docs" / "modes").glob("*.md")):
        copy_into(out, str(path.relative_to(ROOT)))

    # The build makes its own copy, so a participant can make a take-home from here.
    copy_into(out, "tools/build.py")
    notes = []
    if (ROOT / "tools" / "serve.py").is_file():
        copy_into(out, "tools/serve.py")
    else:
        notes.append("tools/serve.py is not here yet, so the starter does not carry it")
    if (ROOT / ".claude" / "commands").is_dir():
        for path in sorted((ROOT / ".claude" / "commands").glob("*.md")):
            copy_into(out, str(path.relative_to(ROOT)))
    else:
        notes.append(".claude/commands/ is not here yet, so the starter does not carry it")

    for path in sorted((ROOT / ".claude" / "skills").glob("*/SKILL.md")):
        copy_into(out, str(path.relative_to(ROOT)))
    write_lf(out / "README.md", README_MD)

    files = sorted(p for p in out.rglob("*") if p.is_file())
    for note in notes:
        print("note: " + note)
    print("built %s/  %d files  modes: %s  workshop flag: app/data/workshop.js" % (
        out, len(files), EXAMPLE_MODE))
    return out


# ---- command line -----------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description="Pack nextbook into one file, or make the workshop folder.")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--starter", action="store_true", help="write dist/starter/, the workshop folder")
    group.add_argument("--demo", action="store_true", help="write dist/demo.html, with the demo modes")
    group.add_argument("--clean", action="store_true", help="empty dist/, which is generated and gitignored")
    args = ap.parse_args(argv)
    try:
        if args.clean:
            reset_dist()
            print("cleaned " + str(DIST))
            return
        if args.starter:
            build_starter()
            return
        if args.demo:
            say(write_page("demo.html", DEMO_MODES))
            return
        say(write_page("nextbook.html"))
    except BuildError as e:
        sys.exit("build: " + str(e))


if __name__ == "__main__":
    main()
