#!/usr/bin/env python3
"""Which briefInfo fields are filled on one catalogue search page.

    python3 search_fields.py "le guin"

One request. Reports how many bibs carry each field the slice builder reads, the
formats seen, a sample of call numbers and series, and the most common subject
headings, so the facet rules in docs/DATA.md can be checked against what the
page actually carries. This is how we learned that the slice can be built from
search pages alone (call numbers and BISAC terms arrive there too). Writes
nothing, never prints a description.
"""
import collections
import json
import re
import sys
import urllib.parse
import urllib.request

UA = "nextbook-probe/1.0 (catalogue research)"
FIELDS = ["groupKey", "authors", "format", "contentType", "audiences", "publicationDate",
          "subjectHeadings", "genreForm", "callNumber", "series"]


def main() -> int:
    query = " ".join(sys.argv[1:]) or "le guin"
    url = ("https://tpl.bibliocommons.com/v2/search"
           f"?searchType=keyword&query={urllib.parse.quote(query)}&page=1")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        html = r.read().decode("utf-8", "replace")

    blob = None
    for m in re.finditer(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', html, re.S):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        if isinstance(d, dict) and "entities" in d:
            blob = d
    if not blob:
        print("FAIL: no entities JSON block. The payload moved.")
        return 1

    briefs = [(v or {}).get("briefInfo") or {} for v in ((blob["entities"].get("bibs")) or {}).values()]
    filled = {f: sum(1 for b in briefs if b.get(f)) for f in FIELDS}
    works = {b.get("groupKey") for b in briefs if b.get("groupKey")}
    print(f"{url}\n{len(html) // 1024} KB, {len(briefs)} bibs, {len(works)} works")
    print("filled: " + ", ".join(f"{f} {n}" for f, n in filled.items()))
    print("formats:", dict(collections.Counter(b.get("format") for b in briefs)))
    for b in briefs[:8]:
        series = [s.get("name", "").strip() for s in b.get("series") or []]
        print(f"  - {b.get('title')} | {b.get('format')} | {b.get('callNumber')} | {series}")
    headings = collections.Counter(h for b in briefs for h in b.get("subjectHeadings") or [])
    print(f"distinct headings: {len(headings)}, of them BISAC: "
          f"{sum(1 for h in headings if h.endswith('bisacsh'))}")
    print("most common:", headings.most_common(15))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
