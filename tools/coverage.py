#!/usr/bin/env python3
"""What the data in this folder can actually tell a mode.

    python3 tools/coverage.py

Counts, from data/slice.json and (when there is one) data/found.json, how many works carry each thing a mode might
lean on. It reads two files and prints plain sentences. No network, no writing.

The point: some fields come from the library's own records (formats, call numbers, sections, audience, subjects)
and are there for any book that came from the catalogue. Others are our own hand-written tags (mood, pace and a one
line note) and exist only for the books in the starter pack. A mode that leans on a hand tag silently sees only those
books. Run this before you promise a mode that.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def read(name):
    path = DATA / name
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main() -> int:
    slice_doc = read("slice.json")
    if not slice_doc:
        print("No data/slice.json here.")
        return 1
    works = list(slice_doc.get("works") or [])
    found = read("found.json") or {}
    works += list(found.get("works") or [])
    tags = (read("tags.json") or {}).get("works") or {}

    def tagged(work, key):
        entry = tags.get(work.get("groupKey")) or {}
        return bool(entry.get(key))

    def has_facet(work, kind):
        return any(str(f).startswith(kind + ":") for f in work.get("facets") or [])

    total = len(works)
    rows = [
        ("a section (a part of the library)", sum(1 for w in works if has_facet(w, "section"))),
        ("a call number", sum(1 for w in works if w.get("callNumber"))),
        ("subjects or genres from the library", sum(1 for w in works if has_facet(w, "topic") or has_facet(w, "genre"))),
        ("formats", sum(1 for w in works if w.get("formats"))),
        ("an audiobook format", sum(1 for w in works if any("AUDIO" in str(f).upper() for f in w.get("formats") or []))),
        ("an audience (adult, teen, children)", sum(1 for w in works if w.get("audience"))),
        ("a series", sum(1 for w in works if w.get("series"))),
        ("our hand-written pace word", sum(1 for w in works if tagged(w, "pace"))),
        ("our hand-written mood words", sum(1 for w in works if tagged(w, "mood"))),
        ("our hand-written one-line note", sum(1 for w in works if tagged(w, "note"))),
    ]
    print(f"{total} books in the list ({len(slice_doc.get('works') or [])} starting pack, {len(found.get('works') or [])} from the library's catalogue).")
    for label, n in rows:
        print(f"  {n:>4} of {total} have {label}")
    sections = {}
    for w in works:
        for f in w.get("facets") or []:
            if str(f).startswith("section:"):
                sections[f] = sections.get(f, 0) + 1
    print(f"{len(sections)} parts of the library: " + ", ".join(f"{k[8:]} ({v})" for k, v in sorted(sections.items())))
    print("Hand-written tags (pace, mood, note) cover only the starting pack. A mode that needs them sees only those books, "
          "so say how many in the plan and in the mode's note.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
