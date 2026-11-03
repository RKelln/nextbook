#!/usr/bin/env python3
"""Print what a TPL catalogue record page actually carries.

    python3 record_fields.py S234C4805630

Reads the embedded JSON block and reports the fields of the record at
entities.bibs.<id>.briefInfo, plus which of the fields docs/DATA.md names are
present. Writes nothing. This is the probe that produced the field table; run it
again before trusting that table.
"""
import json
import re
import sys
import urllib.request

UA = "nextbook-probe/1.0 (catalogue research)"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def blob_of(html: str):
    for m in re.finditer(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', html, re.S):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        if isinstance(d, dict) and "entities" in d:
            return d
    return None


def main() -> int:
    record_id = sys.argv[1] if len(sys.argv) > 1 else "S234C4805630"
    url = f"https://tpl.bibliocommons.com/v2/record/{record_id}"
    html = fetch(url)
    blob = blob_of(html)
    if not blob:
        print("FAIL: no entities JSON block on the page. The payload moved.")
        return 1
    bibs = (blob.get("entities") or {}).get("bibs") or {}
    print(f"{url}: {len(html) // 1024} KB, {len(bibs)} bib(s) in the payload")

    found = None
    for key, value in bibs.items():
        brief = (value or {}).get("briefInfo")
        if brief:
            found = brief
            print(f"record id in payload: {key}")
            break
    if not found:
        print("FAIL: no briefInfo under entities.bibs.<id>. Nothing to read.")
        return 1

    wanted = ["title", "subtitle", "authors", "isbns", "format", "superFormats",
              "contentType", "consumptionFormat", "audiences", "subjectHeadings",
              "compositeSubjectHeadings", "genreForm", "series", "primaryLanguage",
              "publicationDate", "callNumber", "jacket", "rating", "groupKey",
              "description"]
    print()
    for field in wanted:
        value = found.get(field, "<missing>")
        text = str(value)
        if len(text) > 160:
            text = text[:157] + "..."
        print(f"  {field:26} {text}")

    subjects = found.get("subjectHeadings") or []
    genres = found.get("genreForm") or []
    print(f"\n  subjects: {len(subjects)}   genreForm: {len(genres)}   "
          f"description chars: {len(str(found.get('description') or ''))}")
    if "&lt;" in str(found.get("description") or ""):
        print("  NOTE: description is HTML-escaped in this payload; unescape once.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
