#!/usr/bin/env python3
"""Find books for a person, once, because they asked.

    python3 tools/find.py "birds toronto"
    python3 tools/find.py --title "The Left Hand of Darkness" --author "Le Guin"
    python3 tools/find.py --clear

This is the one command in the repo that reaches the network without a build,
and it only ever does what a person asked for: one catalogue search, paced as
on demand (`docs/DATA.md`), at most three pages, never a record page.

It says what it is about to send, and the address, *before* it sends anything.
Then it reads the pages through `adapters/bibliocommons/` (parse and normalise,
the same rules the slice was built with), merges the works into
`data/found.json` without duplicating a book an earlier find already put there,
and marks each work with the words that found it:

    "found": {"query": "birds toronto"}

A record of a book that is already in `data/slice.json` is kept as well. It is
written to `data/found.json` like any other, but it does not become a second
copy on the shelf: at load the pool (app/core/slice.js) folds its record id,
call number, formats and subjects into the book already there. Those are
counted, and said, as books that were already in the person's list.

`data/found.json` is the person's own and is gitignored. No publisher blurb is
kept: `parse.briefs()` drops `description`, `jacket` and `rating` at the door,
and this file refuses to write a record that carries one anyway.

Finally it runs `tools/gen_data.py`, which writes `app/data/found.js` in the
safe form the page loads. The page then says "Your helper found N books".
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import subprocess
import sys
import unicodedata
import urllib.error
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from adapters.bibliocommons import fetch, normalise, parse  # noqa: E402

DATA_DIR = REPO_ROOT / "data"
OUT_DIR = REPO_ROOT / "app" / "data"
GEN_DATA = REPO_ROOT / "tools" / "gen_data.py"

FOUND_SCHEMA = "nextbook/found-1"
FORBIDDEN_FIELDS = ("description", "jacket", "rating")
SUBJECT_KINDS = ("topic", "genre", "bisac")


class FindError(Exception):
    """The find could not be finished; the file was not changed."""


# --- words ------------------------------------------------------------------

def say(text: str) -> None:
    """Print a line for the person, now, even if stdout is buffered."""
    print(text, flush=True)


_APOSTROPHES = re.compile(r"['\u2018\u2019\u02bc`]")
_NOT_WORD = re.compile(r"[^a-z0-9]+")
_LEADING_ARTICLE = re.compile(r"^(the|a|an) ")


def norm_title(text) -> str:
    """The core's `norm()` for titles: case, accents, punctuation, articles."""
    if text is None:
        return ""
    value = unicodedata.normalize("NFKD", str(text))
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = _APOSTROPHES.sub("", value.casefold())
    value = _NOT_WORD.sub(" ", value).strip()
    return _LEADING_ARTICLE.sub("", value)


def query_words(words=None, title=None, author=None) -> str:
    """The words actually sent to the catalogue, from either way of asking."""
    if words:
        return " ".join(str(words).split())
    return " ".join(part for part in ((title or "").strip(), (author or "").strip()) if part)


def _addresses(query: str, pages: int) -> list:
    return [fetch.search_url(query, page) for page in range(1, pages + 1)]


def print_search(query: str, pages: int, title=None, author=None) -> None:
    """Everything about the request, before the request."""
    wanted_title = (title or "").strip()
    wanted_author = (author or "").strip()
    if wanted_title and wanted_author:
        say(f'Search: title "{wanted_title}" by "{wanted_author}"')
        say(f"Words sent to the library: {query}")
    elif wanted_title:
        say(f'Search: title "{wanted_title}"')
        say(f"Words sent to the library: {query}")
    elif wanted_author:
        say(f'Search: author "{wanted_author}"')
        say(f"Words sent to the library: {query}")
    else:
        say(f'Search: "{query}"')
    addresses = _addresses(query, pages)
    if pages == 1:
        say(f"Address: {addresses[0]}")
        say("One page. Nothing else is fetched.")
    else:
        for page, address in enumerate(addresses, start=1):
            say(f"Address (page {page}): {address}")
        say(f"Up to {pages} pages, one at a time, at least 5 seconds apart. Nothing else is fetched.")


# --- the found file ---------------------------------------------------------

def empty_found() -> dict:
    return {"schema": FOUND_SCHEMA, "searches": [], "facets": {}, "works": []}


def read_json(path: Path, default=None):
    if not path.is_file():
        return default
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_found(path: Path) -> dict:
    """The found file, or an empty one. A broken file is refused, not written over."""
    doc = read_json(path)
    if doc is None:
        return empty_found()
    if not isinstance(doc, dict) or not isinstance(doc.get("works"), list):
        raise FindError(f"{path} is not a found file; move it aside and run this again")
    doc.setdefault("schema", FOUND_SCHEMA)
    doc.setdefault("searches", [])
    doc.setdefault("facets", {})
    return doc


def identities(work: dict) -> set:
    """Every name this work goes by, for "do we already have it?".

    The record id and the catalogue's group key are exact. A normalised title
    with its author key catches the same book filed under two spellings, which
    the catalogue does (`DATA.md`: one book can land in two groups).
    """
    keys = set()
    if work.get("id"):
        keys.add("id:" + str(work["id"]))
    if work.get("groupKey"):
        keys.add("group:" + str(work["groupKey"]))
    title = norm_title(work.get("title"))
    if title:
        keys.add("title:" + title + "|" + str(work.get("authorKey") or "").casefold())
    return keys


def slice_identities(slice_doc) -> set:
    """Every name the books already on the person's list go by."""
    keys = set()
    for work in (slice_doc or {}).get("works") or []:
        if isinstance(work, dict):
            keys.update(identities(work))
    return keys


def works_with_labels(briefs) -> list:
    """`[(work, {facet: label})]` for one page, merged by `groupKey`."""
    groups: dict = {}
    for brief in briefs or []:
        if not isinstance(brief, dict):
            continue
        key = brief.get("groupKey") or ("id:" + str(brief.get("id")))
        groups.setdefault(key, []).append(brief)

    found = []
    for group in groups.values():
        work = normalise.work_from(group)
        labels: dict = {}
        for brief in group:
            for key, label in normalise.labels_for(brief).items():
                labels.setdefault(key, label)
        found.append((work, labels))
    return found


def _facet_kind(key: str) -> str:
    return key.partition(":")[0]


def _facet_label(key: str) -> str:
    return key.partition(":")[2].replace("-", " ") or key


def _recount_facets(doc: dict) -> None:
    """Every facet's `works` is the number of works in this file that carry it."""
    counts = Counter()
    for work in doc["works"]:
        for key in work.get("facets") or []:
            counts[key] += 1
    facets = doc.get("facets") or {}
    for key, count in counts.items():
        old = facets.get(key)
        label = old.get("label") if isinstance(old, dict) else None
        kind = old.get("kind") if isinstance(old, dict) else None
        facets[key] = {"label": label or _facet_label(key),
                       "kind": kind or _facet_kind(key),
                       "works": count}
    for key in list(facets):
        if key not in counts:
            del facets[key]
    doc["facets"] = facets


def _refuse_forbidden(value, where="found") -> None:
    """No publisher blurb, cover or rating, anywhere, in any spelling of the key."""
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).casefold() in FORBIDDEN_FIELDS:
                raise FindError(f"{where} would carry a '{key}' field, so it was not written")
            _refuse_forbidden(child, where)
    elif isinstance(value, list):
        for child in value:
            _refuse_forbidden(child, where)


def merge(doc: dict, known: set, page_works, query: str, seen: set,
          slice_keys=None):
    """Add the works this file does not have yet.

    `doc` is changed in place; `known`, `seen` and the returned counts are for
    one command. A work is new only if none of its identities is in `known` or
    in this run's `seen` set. `slice_keys` are the identities of the books the
    person already had; a work that matches one of them is still written (the
    page needs its record to link to), and counted as `linked`.
    """
    slice_keys = slice_keys or set()
    added = []
    already = 0
    linked = 0
    for work, labels in page_works:
        keys = identities(work)
        if keys & seen:
            continue  # the same book again on a later page
        if not keys:
            continue  # no id, no title: nothing we could match or show
        seen.update(keys)
        if keys & known:
            already += 1
            continue
        entry = dict(work)
        entry["found"] = {"query": query}
        for key in entry.get("facets") or []:
            facets = doc.setdefault("facets", {})
            existing = facets.get(key)
            if not isinstance(existing, dict):
                facets[key] = {"label": labels.get(key) or _facet_label(key),
                               "kind": _facet_kind(key), "works": 0}
            elif not existing.get("label"):
                existing["label"] = labels.get(key) or _facet_label(key)
        doc.setdefault("works", []).append(entry)
        known.update(keys)
        added.append(entry)
        if keys & slice_keys:
            linked += 1

    _recount_facets(doc)
    return added, already, linked


def top_subjects(works, labels=None, limit: int = 3) -> list:
    """The strongest subject words across these works, count first.

    Facet keys are finer than words: one work can carry both
    `bisac:science-fiction` and `genre:science-fiction`. A book counts once for
    a word, so the counts are books, not facet entries.
    """
    labels = labels or {}
    counts = Counter()
    for work in works:
        words = set()
        for key in work.get("facets") or []:
            if _facet_kind(key) in SUBJECT_KINDS:
                words.add(labels.get(key) or _facet_label(key))
        counts.update(words)
    if not counts:
        return []
    # Tie-break on the word so the answer is the same every run.
    ranked = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[:limit]
    return list(ranked)


def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, indent=1) + "\n"
    path.write_text(text, encoding="utf-8")


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _books(count: int) -> str:
    return f"{count} book" if count == 1 else f"{count} books"


def _linked_clause(count: int) -> str:
    """The plain words for a book that was on the list and now has its record too."""
    if count == 1:
        return "1 was already in your list and now has its page at the library."
    return (f"{count} were already in your list and now have their page at the "
            "library.")


def regenerate(data_dir, out_dir) -> bool:
    """Run tools/gen_data.py, so the page gets app/data/found.js."""
    command = [sys.executable, str(GEN_DATA),
               "--data-dir", str(data_dir), "--out-dir", str(out_dir)]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        say("The page's data file was not written, so the page will not show these books yet.")
        if detail:
            say(detail)
        return False
    for line in (result.stdout + result.stderr).splitlines():
        if "found" in line:
            say(line)
    return True


# --- the command ------------------------------------------------------------

def run(*, words=None, title=None, author=None, pages: int = 1,
        data_dir=DATA_DIR, out_dir=OUT_DIR, getter=None, now=None) -> dict:
    """One search a person asked for. Returns what happened, for the caller."""
    getter = getter or fetch.get
    query = query_words(words, title, author)
    if not query:
        raise FindError("I need some words to search for")
    if pages > fetch.MAX_ON_DEMAND_PAGES:
        say(f"One command reads at most {fetch.MAX_ON_DEMAND_PAGES} pages. Using "
            f"{fetch.MAX_ON_DEMAND_PAGES}.")
        pages = fetch.MAX_ON_DEMAND_PAGES
    pages = max(1, int(pages))

    data_dir = Path(data_dir)
    out_dir = Path(out_dir)
    found_path = data_dir / "found.json"

    print_search(query, pages, title=title, author=author)

    doc = load_found(found_path)
    # Only earlier finds are "already known": a record of a book in the slice is
    # written too, so the pool can fold it into that book (app/core/slice.js).
    slice_keys = slice_identities(read_json(data_dir / "slice.json", default={}))
    known = set()
    for work in doc.get("works") or []:
        known.update(identities(work))

    seen: set = set()
    every_work = []
    labels_seen: dict = {}
    added = []
    already = 0
    linked = 0
    pages_read = 0

    for page in range(1, pages + 1):
        address = fetch.search_url(query, page)
        try:
            html = getter(address, kind="on-demand")
        except fetch.FetchError as err:
            say(f"The library would not give that page: {err}")
            break
        except (urllib.error.URLError, OSError) as err:
            say(f"Could not reach the library: {err}")
            break
        try:
            briefs = parse.briefs(html)
        except parse.ParseError as err:
            say(f"That page was not a catalogue search page: {err}")
            break
        pages_read += 1
        page_works = works_with_labels(briefs)
        if not page_works:
            say(f"Page {page} had no books. Stopping there.")
            break

        # A book counted once: the catalogue can repeat one on a later page.
        fresh = []
        for work, labels in page_works:
            keys = identities(work)
            if keys and keys & seen:
                continue
            fresh.append((work, labels))
        if not fresh:
            say(f"Page {page} was all books we already have. Stopping there.")
            break

        page_added, page_already, page_linked = merge(doc, known, fresh, query, seen,
                                                     slice_keys)
        added.extend(page_added)
        already += page_already
        linked += page_linked
        # Only the works that reached the file. merge() drops a brief with no
        # id, group key or title, and counting it here would inflate the
        # subject totals with a book the person never got.
        written: set = set()
        for entry in page_added:
            written.update(identities(entry))
        for work, labels in fresh:
            if not (identities(work) & written):
                continue
            every_work.append(work)
            for key, label in labels.items():
                labels_seen.setdefault(key, label)

        if not page_added and page_already:
            say(f"Page {page} was all books we already have. Stopping there.")
            break

    if added:
        timestamp = now or _now()
        doc["searches"].append({"query": query, "fetched": timestamp, "works": len(added)})
        _refuse_forbidden(doc)
        _write_json(found_path, doc)
        ok = regenerate(data_dir, out_dir)
    elif not pages_read:
        ok = False
    else:
        ok = True

    if not pages_read:
        say("No page came back, so nothing was added and nothing was changed.")
    elif added:
        said = f"Added {_books(len(added))}."
        if already:
            said += (f" {already} " + ("was" if already == 1 else "were")
                     + " already in the list.")
        if linked:
            said += " " + _linked_clause(linked)
        say(said)
    else:
        say(f"Added no new books. {already} " + ("was" if already == 1 else "were")
            + " already in the list.")

    subjects = top_subjects(every_work, labels_seen)
    if subjects:
        said = ", ".join(f"{label} ({count})" for label, count in subjects)
        say(f"Strongest subjects: {said}.")
    elif pages_read:
        say("No subjects came back with these books.")

    return {"query": query, "added": len(added), "known": already, "linked": linked,
            "subjects": subjects, "pages": pages_read, "ok": ok}


def clear(data_dir=DATA_DIR, out_dir=OUT_DIR) -> int:
    """Empty the found file (and the page's copy of it)."""
    found_path = Path(data_dir) / "found.json"
    if not found_path.exists():
        say("There are no found books to clear.")
        # The page can still be loading an older copy of a found.json that is
        # gone. Regenerate so app/data/found.js matches what is on disk; if
        # that cannot run, remove the page's copy by hand instead of leaving
        # books on a page that says there are none.
        if regenerate(data_dir, out_dir):
            return 0
        return 0 if _drop_page_copy(out_dir) else 1
    _write_json(found_path, empty_found())
    say("Cleared the found books. The page will show none.")
    return 0 if regenerate(data_dir, out_dir) else 1


def _drop_page_copy(out_dir) -> bool:
    """Remove `app/data/found.js`; true when it is gone afterwards."""
    target = Path(out_dir) / "found.js"
    try:
        target.unlink(missing_ok=True)
    except OSError:
        return False
    return not target.exists()


def _parse(argv):
    parser = argparse.ArgumentParser(
        prog="python3 tools/find.py",
        description="Fetch one library search a person asked for, and add its books to the app.")
    parser.add_argument("words", nargs="*", help='the words to search for, in quotes: "birds toronto"')
    parser.add_argument("--title", help="a title; with --author, find this book")
    parser.add_argument("--author", help="an author; with --title, find this book")
    parser.add_argument("--pages", type=int, default=1,
                        help=f"one to {fetch.MAX_ON_DEMAND_PAGES} pages (default 1)")
    parser.add_argument("--clear", action="store_true", help="empty data/found.json and stop")
    parser.add_argument("--data-dir", default=str(DATA_DIR),
                        help="where found.json lives (default: data/)")
    parser.add_argument("--out-dir", default=str(OUT_DIR),
                        help="where found.js goes (default: app/data/)")
    return parser, parser.parse_args(argv)


def main(argv=None) -> int:
    parser, args = _parse(argv)
    if args.clear:
        if args.words or args.title or args.author:
            parser.error("--clear takes no words")
        try:
            return clear(args.data_dir, args.out_dir)
        except (OSError, ValueError, FindError) as err:
            print(f"find: {err}", file=sys.stderr)
            return 2
    if args.words and (args.title or args.author):
        parser.error('give words, or --title and --author, not both')
    if not args.words and not (args.title or args.author):
        parser.error('give some words, or --title and --author')
    if args.pages < 1:
        parser.error("--pages must be 1 or more")
    try:
        result = run(words=" ".join(args.words) if args.words else None,
                     title=args.title, author=args.author, pages=args.pages,
                     data_dir=args.data_dir, out_dir=args.out_dir)
    except (OSError, ValueError, FindError) as err:
        print(f"find: {err}", file=sys.stderr)
        return 2
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
