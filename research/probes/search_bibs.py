#!/usr/bin/env python3
"""Count what one catalogue search page carries.

    python3 search_bibs.py "le guin"

One request, then a report: how many bibs came back, how many carry subject
headings, how many carry a description, and the first few of each. This is how
we learned that a search page is a usable batch source rather than a list of
links. Writes nothing.
"""
import json
import re
import sys
import urllib.parse
import urllib.request

UA = "nextbook-probe/1.0 (catalogue research)"


def main() -> int:
    query = " ".join(sys.argv[1:]) or "le guin"
    url = ("https://tpl.bibliocommons.com/v2/search"
           f"?searchType=keyword&query={urllib.parse.quote(query)}&page=1")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
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
        print("FAIL: no entities JSON block. The payload moved; use the browser to look.")
        return 1

    bibs = (blob.get("entities") or {}).get("bibs") or {}
    briefs = [(k, (v or {}).get("briefInfo") or {}) for k, v in bibs.items()]
    with_subjects = sum(1 for _, b in briefs if b.get("subjectHeadings"))
    with_desc = sum(1 for _, b in briefs if b.get("description"))
    groups = {b.get("groupKey") for _, b in briefs if b.get("groupKey")}

    print(f"{url}\n{len(html) // 1024} KB")
    print(f"  {len(briefs)} bibs, {with_subjects} with subject headings, "
          f"{with_desc} with a description, {len(groups)} distinct groupKeys")
    for _, b in briefs[:5]:
        print(f"  - {b.get('title')} | {b.get('genreForm')} | "
              f"{(b.get('subjectHeadings') or [])[:2]}")
    if len(groups) < len(briefs):
        print("  NOTE: fewer groupKeys than bibs, so this page holds duplicate editions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
