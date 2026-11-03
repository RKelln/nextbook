"""Read a catalogue page and keep the brief of every book on it.

A search page carries one `<script type="application/json">` block whose
`entities.bibs` maps a record id to a `briefInfo`. That object is the book:
title, authors, groupKey, headings, call number, format. Three fields are the
library's or the publisher's and never travel further, so they are dropped here,
once, by name: `description` (the publisher's blurb), `jacket` (a licensed
cover) and `rating`.
"""
from __future__ import annotations

import json
import re

# Never kept, never written to a fixture (AGENTS.md rule 4, docs/DATA.md).
DROPPED_FIELDS = ("description", "jacket", "rating")

_SCRIPT = re.compile(r'<script[^>]*\btype="application/json"[^>]*>(.*?)</script>', re.S | re.I)


class ParseError(Exception):
    """The page is not the shape this adapter was built to read."""


def payloads(html: str):
    """Every JSON object in a `<script type="application/json">` block."""
    for match in _SCRIPT.finditer(html):
        text = match.group(1).strip()
        if not text:
            continue
        try:
            data = json.loads(text)
        except ValueError:
            continue
        if isinstance(data, dict):
            yield data


def briefs(html: str) -> list[dict]:
    """The `briefInfo` of every bib on the page, in page order, cleaned."""
    for data in payloads(html):
        entities = data.get("entities")
        if not isinstance(entities, dict):
            continue
        bibs = entities.get("bibs")
        if not isinstance(bibs, dict):
            continue
        found = []
        for bib in bibs.values():
            if not isinstance(bib, dict):
                continue
            brief = bib.get("briefInfo")
            if not isinstance(brief, dict):
                continue
            clean = {k: v for k, v in brief.items() if k not in DROPPED_FIELDS}
            found.append(clean)
        return found
    raise ParseError("no entities.bibs JSON block on this page; the payload moved")
