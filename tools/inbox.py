#!/usr/bin/env python3
"""Write the page's inbox: one file a helper hands the app, read once at load (D36).

    python3 tools/inbox.py --file records.json
    python3 tools/inbox.py --add "The Left Hand of Darkness" --author "Ursula K. Le Guin"
    python3 tools/inbox.py --add "Piranesi" --author "Susanna Clarke" --state read --rating loved
    python3 tools/inbox.py --add "Piranesi" --id 234C1129065

The page loads `app/data/inbox.js` like any other data file:

    Nextbook.data.put('inbox', {"schema":"nextbook/inbox-1","id":"...","records":[...],
                                "source":"ai","updated":"..."});

On the next load the page reads it once, brings the books in through the shelf's own
newer-wins rule, says how many came in, offers one Undo, and remembers the note's `id` so a
reload does nothing. `--file` takes a JSON list of records; `--add` makes one record.

Each record is a whole shelf entry and needs a key:

    t:<title>|<author>   when there is no record id
    w:<groupKey>         when the record carries the catalogue's group key
    w:<id>               when it carries only a record id

A title with no id is looked up in `data/slice.json` first, the same way the page's
import does it: a book the app already carries becomes that work, so a helper saying
"I read Piranesi" updates the Piranesi on the shelf instead of inventing a twin.
Nothing leaves this machine to do that.

`updated` is set to the moment the file is written, so the page takes the change; a file
sitting on disk for a week is not a stale change. The note is dated with **this computer's own
clock and time zone**, an ISO 8601 time with its offset, because it is this machine's message
and not a library record: the library's time-zone rule (DATA.md) does not apply here.

The JSON is written with `gen_data.js_text`, the same wrapper and the same escapes as every
other data file, so a title holding `<`, `>` or `&` cannot end the script element. Standard
library only; nothing here reaches the network and nothing here opens the page.
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import secrets
import sys
import unicodedata
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
REPO_ROOT = TOOLS.parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import gen_data  # noqa: E402  the one `Nextbook.data.put` wrapper, and its escapes

SCHEMA = "nextbook/inbox-1"
SOURCE = "ai"
NAME = "inbox"
OUT_DIR = REPO_ROOT / "app" / "data"

STATES = ("want", "reading", "read", "stopped")
RATINGS = ("loved", "liked", "ok", "not-for-me")

_APOSTROPHES = re.compile(r"['\u2018\u2019\u02bc`]")
_NOT_WORD = re.compile(r"[^a-z0-9]+")
_LEADING_ARTICLE = re.compile(r"^(the|a|an) ")


class InboxError(ValueError):
    """The file was not written; the message is one plain sentence."""


def now_iso() -> str:
    """The real time on this machine, with its offset: 2026-11-03T14:05:00-05:00."""
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


# --- the key, spelled the way the app spells it ---------------------------------------------

def norm_text(text) -> str:
    """The core's `norm()` (app/core/base.js): case, accents, punctuation, a leading article."""
    if text is None:
        return ""
    value = unicodedata.normalize("NFD", str(text))
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = _APOSTROPHES.sub("", value.casefold())
    value = _NOT_WORD.sub(" ", value).strip()
    return _LEADING_ARTICLE.sub("", value)


SLICE_PATH = REPO_ROOT / "data" / "slice.json"


def works_by_title(slice_path=None) -> dict:
    """The slice's works, grouped by the way their titles are spelled. Read-only, local."""
    path = Path(slice_path or SLICE_PATH)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    index = {}
    for work in payload.get("works") or []:
        if not isinstance(work, dict):
            continue
        name = norm_text(work.get("title"))
        if name:
            index.setdefault(name, []).append(work)
    return index


def match_work(title, author, index: dict):
    """The work this title and author already are, or None. Mirrors `pool.match`."""
    candidates = index.get(norm_text(title)) or []
    if not candidates:
        return None
    if not norm_text(author):
        return candidates[0] if len(candidates) == 1 else None
    spoken = norm_text(author)
    for work in candidates:
        if norm_text(work.get("author")) == spoken:
            return work
        family = str(work.get("authorKey") or "").split(",")[0].strip()
        if family and family in spoken:
            return work
    return None


def key_for(record: dict) -> str:
    """The entry's key: one it already carries, else the work's, else title and author."""
    key = record.get("key")
    if isinstance(key, str) and key:
        return key
    group = record.get("groupKey")
    if isinstance(group, str) and group:
        return "w:" + group
    ident = record.get("id")
    if isinstance(ident, (str, int)) and str(ident):
        return "w:" + str(ident)
    title = norm_text(record.get("title"))
    if not title:
        return ""
    return "t:" + title + "|" + norm_text(record.get("author"))


# --- the file ------------------------------------------------------------------------------

def build(records, now: "str | None" = None, slice_path=None) -> dict:
    """The inbox document for a list of records, ready to be written."""
    if not isinstance(records, list):
        raise InboxError("That file is not a list of books, so nothing was written.")
    stamp = now or now_iso()
    works = None
    matched = 0
    entries = []
    for index, record in enumerate(records, start=1):
        if not isinstance(record, dict):
            raise InboxError(
                f"Record {index} in that file is not a book, so nothing was written.")
        entry = dict(record)
        # A title the app already carries becomes that work, so the note lands on the book
        # that is already there instead of beside it.
        if not entry.get("key") and not entry.get("groupKey") and not entry.get("id"):
            if works is None:
                works = works_by_title(slice_path)
            work = match_work(entry.get("title"), entry.get("author"), works)
            if work:
                entry["id"] = work.get("id")
                entry["groupKey"] = work.get("groupKey")
                if not entry.get("title"):
                    entry["title"] = work.get("title")
                if not entry.get("author"):
                    entry["author"] = work.get("author")
                matched += 1
        key = key_for(entry)
        if not key:
            raise InboxError(
                f"Record {index} in that file has no title and no record id, so it has no "
                "key and nothing was written.")
        entry["key"] = key
        # The moment it is written, so the page takes it. A record the person edited later than
        # this still wins at the page, which is the store's rule and not this file's.
        entry["updated"] = stamp
        ordered = {"key": entry.pop("key")}
        ordered.update(entry)
        entries.append(ordered)
    return {
        "schema": SCHEMA,
        "id": secrets.token_hex(8),
        "records": entries,
        "source": SOURCE,
        "updated": stamp,
        # How many records landed on a work the app already had. The page ignores it.
        "matched": matched,
    }


def write_inbox(records, out_dir=None, now: "str | None" = None, slice_path=None):
    """Write `app/data/inbox.js`; returns (path, the document written)."""
    doc = build(records, now=now, slice_path=slice_path)
    target = Path(out_dir or OUT_DIR) / (NAME + ".js")
    target.parent.mkdir(parents=True, exist_ok=True)
    text = gen_data.js_text(NAME, doc)
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return target, doc


def record_for(title, author="", state="want", rating=None, work_id=None) -> dict:
    """One shelf entry, from what a helper typed or was handed."""
    record = {
        "title": str(title or "").strip(),
        "author": str(author or "").strip(),
        "state": state,
        "rating": rating,
    }
    if work_id:
        record["id"] = str(work_id)
    return record


# --- the command ---------------------------------------------------------------------------

def _shown(path: Path) -> str:
    """A path as the person sees it: relative to the repo when it is inside it."""
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _read_records(path: Path) -> list:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        raise InboxError(f"{path} could not be read: {err.strerror or err}") from err
    try:
        value = json.loads(text)
    except ValueError:
        raise InboxError(f"{path} is not valid JSON, so nothing was written.") from None
    if not isinstance(value, list):
        raise InboxError("That file is not a list of books, so nothing was written.")
    return value


def _parse(argv):
    parser = argparse.ArgumentParser(
        prog="python3 tools/inbox.py",
        description="Write app/data/inbox.js, the note the page reads once and brings books in from.",
        epilog=("The note is dated with this computer's own clock and time zone, an ISO 8601 "
                "time with its offset. The library's time zone rule does not apply: this is "
                "your machine's message, not a catalogue record."))
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file", metavar="FILE",
                       help="a JSON list of shelf entries to hand the page")
    group.add_argument("--add", metavar="TITLE",
                       help="add one book by its title; use with --author and the rest")
    parser.add_argument("--author", default="",
                        help="with --add, the book's author")
    parser.add_argument("--state", default="want", choices=STATES,
                        help="with --add, want, reading, read or stopped (default: want)")
    parser.add_argument("--rating", default=None, choices=RATINGS,
                        help="with --add, loved, liked, ok or not-for-me (default: none)")
    parser.add_argument("--id", dest="work_id", default=None, metavar="WORKID",
                        help="with --add, the work's record id, so the key is w:<id>")
    parser.add_argument("--out-dir", default=str(OUT_DIR),
                        help="where inbox.js goes (default: app/data/)")
    return parser, parser.parse_args(argv)


def main(argv=None) -> int:
    parser, args = _parse(argv)
    if args.file and (args.author or args.work_id or args.state != "want" or args.rating):
        parser.error("--author, --state, --rating and --id go with --add, not --file")
    try:
        if args.file:
            records = _read_records(Path(args.file))
        else:
            records = [record_for(args.add, author=args.author, state=args.state,
                                  rating=args.rating, work_id=args.work_id)]
        target, doc = write_inbox(records, out_dir=args.out_dir)
    except (OSError, ValueError, InboxError) as err:
        print(f"inbox: {err}", file=sys.stderr)
        return 2
    count = len(doc["records"])
    print(f"Wrote {_shown(target)} with " + (f"{count} change." if count == 1 else f"{count} changes."))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
