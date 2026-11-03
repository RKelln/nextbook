#!/usr/bin/env python3
"""Write `app/data/<name>.js` from `data/<name>.json`, safely.

Ported from kit/seed_src/app/build_app.py (MIT, same author), its `safe()`.

The app loads its data as classic scripts so the folder works from `file://`:
each file is one call, `Nextbook.data.put('<name>', <json>);`. The JSON is
embedded beside live script text, so `<`, `>` and `&` can never travel as
themselves: a title holding `</script>` would otherwise end the script element
and the rest of the data would become markup. Each of the three is written as
the six-character JSON escape `\\u003c`, `\\u003e`, `\\u0026` (backslash, `u`,
four hex digits); JSON readers and JavaScript both give the original character
back, and no character in the file can end the element.

U+2028 and U+2029 (the line and paragraph separators) are written the same way.
They are legal inside a JSON string, but before ES2019 a raw one was a line
terminator in a JavaScript string literal and the script would not parse.

    python3 tools/gen_data.py            # write the files
    python3 tools/gen_data.py --check    # exit 1 if any file is missing or old

Only the five names in `NAMES` are ever written, and only when their JSON
exists: `found` and `events` are absent until a person finds books or the
events snapshot is built, and that is not an error.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
NAMES = ("slice", "tags", "practice", "found", "events")

# Built from pieces on purpose. Some edit tools turn a written backslash-u003c
# into a literal "<" on the way to disk (AGENTS.md rule 7), and a literal would
# defeat the whole point of this file. Each value is six characters.
JSON_OUT_ESCAPES = {
    "<": "\\" + "u003c",
    ">": "\\" + "u003e",
    "&": "\\" + "u0026",
    # Legal JSON, but a raw line terminator in JavaScript before ES2019.
    "\u2028": "\\" + "u2028",
    "\u2029": "\\" + "u2029",
}


def js_text(name: str, value) -> str:
    """The whole body of `app/data/<name>.js` for one JSON value."""
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    for char, escape in JSON_OUT_ESCAPES.items():
        text = text.replace(char, escape)
    return "Nextbook.data.put('" + name + "', " + text + ");\n"


def read_json(path: Path):
    """The JSON at `path`, with a plain error that names the file."""
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except ValueError as err:
        raise ValueError(f"{path} is not valid JSON: {err}") from err


def plan(data_dir, out_dir, names=NAMES):
    """`[(name, target, text_or_None)]` for every name, in `NAMES` order."""
    data_dir = Path(data_dir)
    out_dir = Path(out_dir)
    steps = []
    for name in names:
        source = data_dir / f"{name}.json"
        target = out_dir / f"{name}.js"
        text = js_text(name, read_json(source)) if source.is_file() else None
        steps.append((name, target, text))
    return steps


def build(data_dir, out_dir, names=NAMES) -> dict:
    """Write what is missing or old, remove what has no JSON left."""
    report = {"written": [], "unchanged": [], "removed": [], "skipped": []}
    for name, target, text in plan(data_dir, out_dir, names):
        if text is None:
            report["skipped"].append(name)
            if target.exists():
                target.unlink()
                report["removed"].append(name)
            continue
        if target.is_file() and target.read_text(encoding="utf-8", errors="replace") == text:
            report["unchanged"].append(name)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        report["written"].append(name)
    return report


def _show(path) -> str:
    """A path as the person sees it: relative to the repo when it is inside it."""
    try:
        return str(Path(path).resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def check(data_dir, out_dir, names=NAMES) -> list:
    """Every file that is missing, old, or there without a JSON behind it."""
    problems = []
    for name, target, text in plan(data_dir, out_dir, names):
        if text is None:
            if target.exists():
                problems.append(
                    f"{_show(target)}: there is no data/{name}.json, so this file should not exist")
            continue
        if not target.is_file():
            problems.append(f"{_show(target)}: missing (run python3 tools/gen_data.py)")
            continue
        if target.read_text(encoding="utf-8", errors="replace") != text:
            problems.append(
                f"{_show(target)}: old (data/{name}.json changed since it was written)")
    return problems


def _parse(argv):
    parser = argparse.ArgumentParser(
        description="Write app/data/*.js from data/*.json, with safe escapes.")
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if a generated file is missing or old")
    parser.add_argument("--data-dir", default=str(REPO_ROOT / "data"),
                        help="where the JSON lives (default: data/)")
    parser.add_argument("--out-dir", default=str(REPO_ROOT / "app" / "data"),
                        help="where the .js files go (default: app/data/)")
    return parser.parse_args(argv)


def _check_and_report(args) -> int:
    problems = check(args.data_dir, args.out_dir)
    if problems:
        for problem in problems:
            print("stale: " + problem)
        print("app/data is stale; run python3 tools/gen_data.py")
        return 1
    count = sum(1 for _, _, text in plan(args.data_dir, args.out_dir) if text is not None)
    print(f"app/data is up to date ({count} files).")
    return 0


def _build_and_report(args) -> int:
    report = build(args.data_dir, args.out_dir)
    out_dir = Path(args.out_dir)
    for name in report["written"]:
        print(f"wrote {_show(out_dir / (name + '.js'))}")
    for name in report["unchanged"]:
        print(f"unchanged {_show(out_dir / (name + '.js'))}")
    for name in report["removed"]:
        print(f"removed {_show(out_dir / (name + '.js'))} (no data/{name}.json)")
    for name in report["skipped"]:
        print(f"no data/{name}.json: skipped {_show(out_dir / (name + '.js'))}")
    return 0


def main(argv=None) -> int:
    args = _parse(argv)
    try:
        if args.check:
            return _check_and_report(args)
        return _build_and_report(args)
    except (OSError, ValueError) as err:
        print(f"gen_data: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
