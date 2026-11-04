#!/usr/bin/env python3
"""One branch's events from the library's feed, as a dated snapshot.

    python3 adapters/bibliocommons/events.py --branch CL --days 21

Writes `data/events.json`:

    {fetched, branch, window, source,
     events: [{id, title, start, end, branch, virtual, categories, summary, url}]}

The feed has no CORS header, so a page opened from a folder cannot read it. The
snapshot is made ahead, by this command, and the app says which day it is from.

`summary` is the library's own event text with the markup stripped, at most 300
characters. It is not a publisher blurb (AGENTS.md rule 4), and there is no
field named `description` anywhere in the snapshot.

Everything that touches the network goes through `fetch.Fetcher`: the same
user agent, the same allow-list (the gateway carries the feed and nothing else),
batch pacing, and the URL cache, so a second run in the same day makes no
request at all.

Traps this file is built around (docs/RESEARCH.md, "TPL events feed"):

- the date filter is mandatory; without it the feed carries past events;
- the feed answers 200 with an empty body past the last page;
- virtual events carry no location, so every location read is guarded;
- a wrong branch code answers 200 with zero events, silently — so a run that
  finds nothing says so and writes no file, rather than replacing the snapshot
  with an empty one;
- a misspelled parameter is ignored, so an answer whose locations do not match
  the requested code is refused instead of trusted.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SUMMARY_LIMIT = 300
MAX_PAGES = 5
PAGE_SIZE = 25  # what the feed puts on a page; a full last page means more follow
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
DEFAULT_OUT = REPO_ROOT / "data" / "events.json"

from adapters.bibliocommons import fetch  # noqa: E402  (after the path shim)

_TAG = re.compile(r"<[^>]*>")
_SPACE = re.compile(r"\s+")
# Zero-width marks travel in the catalogue's category names; they are not words.
_ZERO_WIDTH = re.compile(r"[\u200b-\u200f\u202a-\u202e\ufeff]")


def _plain(text: str) -> str:
    """Text without zero-width or bidi marks, trimmed."""
    return _ZERO_WIDTH.sub("", text or "").strip()


def _local(tag: str) -> str:
    """The element's name with any namespace removed."""
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _child(element, name):
    """The first child called `name`, whatever namespace it carries."""
    for child in element:
        if _local(child.tag) == name:
            return child
    return None


def _text(element, name: str = "") -> str:
    """The stripped text of a child, or of the element itself when no name."""
    node = _child(element, name) if name else element
    if node is None or node.text is None:
        return ""
    return node.text.strip()


def clean_summary(text: str, limit: int = SUMMARY_LIMIT) -> str:
    """The library's own words, as plain text, at most `limit` characters.

    Entities are decoded before and after the tags are stripped, because a feed
    can double-encode its markup; any angle bracket left over is dropped, so the
    result can never read as markup to a test or a person.
    """
    text = text or ""
    for _ in range(2):
        text = html.unescape(text)
        text = _TAG.sub(" ", text)
    text = text.replace("<", " ").replace(">", " ")
    text = _SPACE.sub(" ", text).strip()
    # A tag between a word and its comma leaves a space before punctuation.
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    if len(text) <= limit:
        return text
    cut = text[: limit - 4]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    cut = cut.rstrip(" ,;:.!?-")
    return cut + " ..."


def parse_local(text: str):
    """A feed date as a `datetime`, or None.

    The feed's `*_date_local` fields are already the branch's wall clock. A
    value that carries an offset is moved to this machine's local zone; a value
    without one is kept exactly as written, never read as UTC.
    """
    text = (text or "").strip()
    if not text:
        return None
    try:
        value = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if value.tzinfo is not None:
        value = value.astimezone()
    return value


def local_iso(value) -> str:
    """A datetime as ISO 8601: local time, with its offset when it has one."""
    if value is None:
        return ""
    return value.isoformat(timespec="seconds")


def parse_page(text: str) -> list[dict]:
    """The items on one feed page, cancelled ones included.

    Nothing is dropped here, so a test can see what the feed said before the
    snapshot's rules apply.
    """
    text = (text or "").strip()
    if not text:
        return []  # past the last page the feed answers 200 with an empty body
    # The body is the library's XML over TLS. ElementTree resolves no external
    # entities, and a feed never carries a DTD, so one is refused rather than
    # parsed: that closes the entity-expansion door without a new dependency.
    if "<!DOCTYPE" in text or "<!ENTITY" in text:
        raise ValueError("the events feed carried a DTD; refusing to parse it")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValueError(f"the events feed did not parse as XML: {exc}") from exc

    records = []
    for item in root.iter():
        if _local(item.tag) != "item":
            continue
        location = _child(item, "location")
        link = _text(item, "link")
        records.append({
            "id": event_id(link, _text(item, "guid")),
            "title": _plain(_text(item, "title")),
            "start": local_iso(parse_local(_text(item, "start_date_local"))),
            "end": local_iso(parse_local(_text(item, "end_date_local"))),
            "branch_code": _plain(_text(location, "id")) if location is not None else "",
            "branch": _plain(_text(location, "name")) if location is not None else "",
            "virtual": _text(item, "is_virtual").lower() == "true",
            "categories": [_plain(c.text) for c in item
                           if _local(c.tag) == "category" and c.text and _plain(c.text)],
            "summary": clean_summary(_text(item, "description")),
            "url": link,
            "cancelled": _text(item, "is_cancelled").lower() == "true",
        })
    return records


def event_id(link: str, guid: str) -> str:
    """A short, stable id: the last part of the event's own URL."""
    for value in (link, guid):
        value = (value or "").strip().rstrip("/")
        if value:
            return value.rsplit("/", 1)[-1]
    return ""


def build_events(records, branch: str) -> list[dict]:
    """The snapshot's events: cancelled dropped, duplicates removed, sorted.

    Every event has exactly the nine fields the snapshot promises, in that
    order, and no `description` key.
    """
    wanted = (branch or "").strip().lower()
    seen = set()
    events = []
    for record in records:
        if record.get("cancelled"):
            continue
        if wanted and record.get("branch_code", "").strip().lower() not in ("", wanted):
            continue  # a row for another branch: the filter was not applied
        key = record.get("id") or (record.get("title", "") + record.get("start", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        events.append({
            "id": record["id"],
            "title": record["title"],
            "start": record["start"],
            "end": record["end"],
            "branch": record["branch"],
            "virtual": bool(record["virtual"]),
            "categories": list(record["categories"]),
            "summary": clean_summary(record["summary"]),
            "url": record["url"],
        })
    events.sort(key=lambda event: (event["start"] or "9999", event["title"]))
    return events


def snapshot(events, branch: str, start: dt.date, end: dt.date, now=None) -> dict:
    """The whole file, with exactly the five top-level keys the app reads.

    `source` names the feed without a scheme on purpose: the gateway is the
    platform's host and this repo's one-file build allows no address outside the
    library's own, so the snapshot records where it came from as text and links
    nothing to it.
    """
    now = now or dt.datetime.now().astimezone()
    feed = fetch.events_url(branch, start.isoformat(), end.isoformat())
    return {
        "fetched": now.isoformat(timespec="seconds"),
        "branch": branch,
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "source": feed.split("://", 1)[-1],
        "events": events,
    }


def collect(fetcher, branch: str, start: dt.date, end: dt.date, log=None) -> list[dict]:
    """Every page of the window, through the shared fetcher, batch-paced.

    The feed carries 25 items a page, oldest first, and says nothing about the
    next page, so paging stops on the first empty answer (a 200 with an empty
    body, past the last page). The cap is a brake on a filter that was ignored,
    and it is said out loud rather than truncating the window in silence.
    """
    log = log or (lambda message: print(message, file=sys.stderr))
    records, page = [], 1
    truncated = False
    while page <= MAX_PAGES:
        body = fetcher.get(fetch.events_url(branch, start.isoformat(),
                                            end.isoformat(), page), "batch")
        page_records = parse_page(body)
        if not page_records:
            break
        records.extend(page_records)
        truncated = page == MAX_PAGES and len(page_records) >= PAGE_SIZE
        page += 1
    if truncated:
        log(f"Stopped after {MAX_PAGES} pages: later events in this window were "
            "not read. Narrow the window, or raise MAX_PAGES with a reason.")
    return build_events(records, branch)


def write_snapshot(path: Path, snap: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(snap, handle, ensure_ascii=False, indent=1)
        handle.write("\n")


def main(argv=None, fetcher=None) -> int:
    parser = argparse.ArgumentParser(
        description="Write a dated snapshot of one branch's library events.")
    parser.add_argument("--branch", default="CL",
                        help="BiblioCommons branch code (CL is North York Central)")
    parser.add_argument("--days", type=int, default=21,
                        help="how many days ahead to cover (default 21)")
    parser.add_argument("--out", default=str(DEFAULT_OUT),
                        help="where to write the snapshot (default data/events.json)")
    args = parser.parse_args(argv)
    if args.days < 1:
        parser.error("--days must be at least 1")

    start = dt.date.today()
    end = start + dt.timedelta(days=args.days)
    fetcher = fetcher or fetch.Fetcher()
    try:
        events = collect(fetcher, args.branch, start, end)
    except (fetch.FetchError, ValueError) as exc:
        print(f"No snapshot written: {exc}", file=sys.stderr)
        return 1

    if not events:
        print(f"No events found for branch {args.branch!r} between {start} "
              f"and {end}. The branch code may be wrong — the feed answers an "
              "unknown code with an empty page, not an error. Nothing was written.",
              file=sys.stderr)
        return 2

    snap = snapshot(events, args.branch, start, end)
    out = Path(args.out)
    write_snapshot(out, snap)
    names = sorted({event["branch"] for event in events if event["branch"]})
    print(f"{len(events)} events, {start} to {end}, branch {args.branch}"
          f"{' (' + ', '.join(names) + ')' if names else ''} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
