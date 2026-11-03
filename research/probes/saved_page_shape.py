#!/usr/bin/env python3
"""What a catalogue page you saved yourself carries, as shapes only.

    python3 saved_page_shape.py ~/Desktop/completed.html [more.html ...]

For T8.7 / D20: does a signed-in page (a shelf, a search while signed in) carry
the person's own shelf in its embedded JSON, with record ids, dates and ratings?

It reads a local file and makes no network request. It prints key names, value
TYPES and counts, never values: no titles, no names, no ids, no card numbers.
The one exception is any key whose name contains "rating", "status" or "shelf"
when its value is a short code or a small number (1-5, "COMPLETED"), because
that is the thing being measured and it identifies nobody. Read the output
before you paste it anywhere anyway.

Save the page in the browser with Cmd-S / Ctrl-S. Keep the saved files outside
this repo, and delete them when done: a signed-in page is personal data.
"""
import json
import re
import sys
from collections import Counter

PERSONAL = ("shelves", "borrowingHistory", "checkouts", "holds", "users", "accounts",
            "ugc", "listItems", "lists", "cards", "fines", "messages", "followedUsers")
SHOWABLE_KEY = re.compile(r"rating|status|shelf|type|format", re.I)
SHOWABLE_VAL = re.compile(r"^[A-Z_]{2,30}$")


def blob_of(html):
    found = None
    for m in re.finditer(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', html, re.S):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        if isinstance(d, dict) and "entities" in d:
            found = d
    return found


def shape(value, key="", depth=0, max_depth=4):
    """A redacted outline of a value: types for leaves, structure for containers."""
    if isinstance(value, dict):
        if depth >= max_depth:
            return f"{{{len(value)} keys}}"
        return {k: shape(v, k, depth + 1, max_depth) for k, v in list(value.items())[:40]}
    if isinstance(value, list):
        if not value:
            return "[]"
        return [f"{len(value)} items, first:", shape(value[0], key, depth + 1, max_depth)]
    if isinstance(value, bool) or value is None:
        return repr(value)
    if SHOWABLE_KEY.search(key):
        if isinstance(value, (int, float)) and 0 <= value <= 10:
            return f"number {value}"
        if isinstance(value, str) and SHOWABLE_VAL.match(value):
            return f"code {value}"
    if isinstance(value, str):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", value):
            return "date string"
        if re.fullmatch(r"S\d+C\d+", value):
            return "record id"
        return f"string ({len(value)} chars)"
    return type(value).__name__


def report(path):
    import os
    if not os.path.isfile(path):
        print(f"== {path}: no such file. Check where the browser saved it.")
        return
    with open(path, encoding="utf-8", errors="replace") as f:
        html = f.read()
    blob = blob_of(html)
    print(f"== {path}: {len(html) // 1024} KB")
    if not blob:
        print("   no entities JSON block found. Try saving as 'Webpage, HTML only'.")
        return
    print("   top-level keys:", sorted(blob.keys()))
    ents = blob.get("entities") or {}
    filled = {k: len(v) for k, v in ents.items() if isinstance(v, (dict, list)) and v}
    print("   non-empty entities (count):", filled)
    for name in PERSONAL:
        v = ents.get(name)
        if not v:
            continue
        first = next(iter(v.values())) if isinstance(v, dict) else v[0]
        print(f"\n   -- {name}: {len(v)} entries; the first one's shape:")
        print("   " + json.dumps(shape(first), indent=2).replace("\n", "\n   "))
    # Ratings and shelf codes across every entity, as counts only.
    codes = Counter()

    def walk(x, k=""):
        if isinstance(x, dict):
            for kk, vv in x.items():
                walk(vv, kk)
        elif isinstance(x, list):
            for vv in x:
                walk(vv, k)
        elif SHOWABLE_KEY.search(k) and (isinstance(x, (int, float)) and not isinstance(x, bool) and 0 <= x <= 10
                                         or isinstance(x, str) and SHOWABLE_VAL.match(x)):
            codes[f"{k}={x}"] += 1
    for name in PERSONAL:
        walk(ents.get(name) or {})
    if codes:
        print("\n   codes and small numbers in personal entities:", dict(codes.most_common(30)))
    for name in ("shelves", "borrowing", "user", "auth", "ugc", "lists"):
        v = blob.get(name)
        if v:
            print(f"\n   -- top-level {name}, shape:")
            print("   " + json.dumps(shape(v, max_depth=3), indent=2).replace("\n", "\n   "))
    bibs = ents.get("bibs") or {}
    print(f"\n   bibs on the page: {len(bibs)}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    for p in sys.argv[1:]:
        report(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
