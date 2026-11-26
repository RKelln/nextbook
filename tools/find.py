#!/usr/bin/env python3
"""Find books for a person, once, because they asked.

    python3 tools/find.py "birds toronto"
    python3 tools/find.py --title "The Left Hand of Darkness" --author "Le Guin"
    python3 tools/find.py --from-shelf my-shelf.json
    python3 tools/find.py "quiet sea stories" --suggest suggestions.txt
    python3 tools/find.py --clear

This is the one command in the repo that reaches the network without a build,
and it only ever does what a person asked for: one catalogue search, paced as
on demand (`docs/DATA.md`), at most three pages, never a record page.

It can also take a shelf file the app exported (`--from-shelf`). Then it asks
one search per book the person imported and has no library record for, prints
each query before it sends it, and stops after `--limit` books (40 by default).
A page already in the cache costs no request and no wait, and a title already
in `data/found.json` is skipped, so a second run carries on where the last one
stopped. Each book's page and merge are the same ones a single search uses:
`collect()` is that one loop.

With `--write-inbox`, the books this run matched are also written to
`app/data/inbox.js` (through `tools/inbox.py`, the one writer), each with its
new record id and the run's own time. The page reads that note once at load and
updates the shelf entry in place, so the person does not import their file
again to get the record ids.

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
import urllib.parse
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from adapters.bibliocommons import fetch, normalise, parse  # noqa: E402
import inbox as inbox_file  # noqa: E402  the one writer for the page's inbox

DATA_DIR = REPO_ROOT / "data"
OUT_DIR = REPO_ROOT / "app" / "data"
GEN_DATA = REPO_ROOT / "tools" / "gen_data.py"

FOUND_SCHEMA = "nextbook/found-1"
SHELF_SCHEMA = "nextbook/shelf-1"
DEFAULT_LIMIT = 40
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


# Titles the library has only on order have no call number and nobody has read them, so they are a poor
# thing to recommend. They are left out unless the person asks for them (`--include-on-order`).
INCLUDE_ON_ORDER = False


def is_on_order(work: dict) -> bool:
    return "ON ORDER" in " ".join(str(work.get("callNumber") or "").split()).upper()


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
        if is_on_order(work) and not INCLUDE_ON_ORDER:
            continue  # not on the shelves yet
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
        return "1 was already in the pile and now has its page at the library."
    return (f"{count} were already in the pile and now have their page at the "
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

def collect(doc: dict, known: set, query: str, pages: int, getter,
            slice_keys=None) -> dict:
    """Read up to `pages` pages of one search and merge them into `doc`.

    This is the one loop both ways of asking share: the single search and each
    book of a shelf run. `doc`, `known` and `slice_keys` are as in `merge()`.
    Nothing is printed here; the sentences are returned as `notes`, in order,
    so the caller can say them at its own pace.
    """
    seen: set = set()
    every_work = []
    labels_seen: dict = {}
    added = []
    already = 0
    linked = 0
    pages_read = 0
    notes = []
    fatal = False

    for page in range(1, pages + 1):
        address = fetch.search_url(query, page)
        try:
            html = getter(address, kind="on-demand")
        except fetch.FetchError as err:
            notes.append(f"The library would not give that page: {err}")
            fatal = isinstance(err, (fetch.RobotsRefused, fetch.DisallowedPath))
            break
        except (urllib.error.URLError, OSError) as err:
            notes.append(f"Could not reach the library: {err}")
            break
        try:
            briefs = parse.briefs(html)
        except parse.ParseError as err:
            notes.append(f"That page was not a catalogue search page: {err}")
            break
        pages_read += 1
        page_works = works_with_labels(briefs)
        if not page_works:
            notes.append(f"Page {page} had no books. Stopping there.")
            break

        # A book counted once: the catalogue can repeat one on a later page.
        fresh = []
        for work, labels in page_works:
            keys = identities(work)
            if keys and keys & seen:
                continue
            fresh.append((work, labels))
        if not fresh:
            notes.append(f"Page {page} was all books we already have. Stopping there.")
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
            notes.append(f"Page {page} was all books we already have. Stopping there.")
            break

    return {"added": added, "already": already, "linked": linked,
            "pages_read": pages_read, "works": every_work, "labels": labels_seen,
            "notes": notes, "fatal": fatal}


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

    outcome = collect(doc, known, query, pages, getter, slice_keys)
    for note in outcome["notes"]:
        say(note)
    added = outcome["added"]
    already = outcome["already"]
    linked = outcome["linked"]
    pages_read = outcome["pages_read"]
    every_work = outcome["works"]
    labels_seen = outcome["labels"]

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
                     + " already in the pile.")
        if linked:
            said += " " + _linked_clause(linked)
        say(said)
    else:
        say(f"Added no new books. {already} " + ("was" if already == 1 else "were")
            + " already in the pile.")

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


# --- a shelf file -----------------------------------------------------------

def read_shelf(path) -> list:
    """The entries of an exported shelf file, read the way the app reads one.

    A file that cannot be read is one plain sentence (FindError), never a
    traceback: this runs for a person, and a stack trace is not an answer.
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        raise FindError(f"{path} could not be read: {err.strerror or err}")
    try:
        doc = json.loads(text)
    except ValueError:
        raise FindError(f"{path} is not a shelf file: it is not JSON")
    if not isinstance(doc, dict) or not isinstance(doc.get("entries"), list):
        raise FindError(f"{path} is not a shelf file: it has no list of books")
    return [entry for entry in doc["entries"] if isinstance(entry, dict)]


def _wants_a_search(entry: dict) -> bool:
    """A book with no library record yet, and a title to ask about."""
    return not entry.get("id") and not entry.get("groupKey") and bool(_shelf_title(entry))


def _shelf_title(entry: dict) -> str:
    return str(entry.get("title") or "").strip()


def _record_search(doc: dict, outcome: dict, query: str, now, found_path: Path) -> None:
    """Add one line to the file's searches, then write the file."""
    doc["searches"].append({"query": query, "fetched": now or _now(),
                            "works": len(outcome["added"])})
    _refuse_forbidden(doc)
    _write_json(found_path, doc)


def from_shelf(path, limit: int = DEFAULT_LIMIT, *, data_dir=DATA_DIR,
               out_dir=OUT_DIR, getter=None, cached=None, begin_search=None,
               now=None, write_inbox: bool = False) -> dict:
    """Match the books a person imported, one search each, at their own pace.

    Only books with no record id and no group key are asked about: a book the
    library already gave us is never searched again. Each book becomes one
    keyword search of its title and author, read through `collect()` -- the
    same loop a single search uses -- so hits land in `data/found.json` and
    `app/data/found.js` exactly as a single search's do.

    With `write_inbox`, the books this run matched are also handed back to the
    page as `app/data/inbox.js` (tools/inbox.py is the one writer): each takes
    its new record id and the time of this run, so the shelf entry is the same
    book the library found without the person importing their file again.

    The cap counts requests, not cache reads: a page already in the cache is
    said as `cached`, costs no request and no wait, and does not use up a book
    of the limit. A title already in `found.json` is skipped, so a second run
    carries on where the first stopped instead of asking again.
    """
    if limit is None:
        limit = DEFAULT_LIMIT
    if int(limit) < 1:
        raise FindError("--limit must be 1 or more")
    limit = int(limit)

    entries = read_shelf(path)
    getter = getter or fetch.get
    # An injected getter has no cache and no page budget to speak of; only the
    # command's own fetcher is asked whether a page is already on disk.
    own_fetcher = getter is fetch.get
    if cached is None:
        cached = fetch.is_cached if own_fetcher else (lambda url: False)
    if begin_search is None:
        begin_search = fetch.begin_search if own_fetcher else (lambda: None)

    data_dir = Path(data_dir)
    out_dir = Path(out_dir)
    found_path = data_dir / "found.json"

    doc = load_found(found_path)
    slice_keys = slice_identities(read_json(data_dir / "slice.json", default={}))
    known: set = set()
    present: set = set()
    for work in doc.get("works") or []:
        known.update(identities(work))
        title = norm_title(work.get("title"))
        if title:
            present.add(title)

    candidates = []
    for entry in entries:
        if not _wants_a_search(entry):
            if not entry.get("id") and not entry.get("groupKey") and not _shelf_title(entry):
                key = str(entry.get("key") or "").strip()
                who = f'"{key}"' if key else "an entry with no key"
                say(f"Skipping {who}: it has no title to search for.")
            continue
        candidates.append(entry)

    waiting = [entry for entry in candidates if norm_title(_shelf_title(entry)) not in present]
    waiting_total = len(waiting)
    if not waiting_total:
        say("Nothing to search: every book on this shelf already has a record or a match.")
        return {"ok": False, "searched": 0, "found": 0, "nothing": 0, "left": 0}

    run_total = min(limit, waiting_total)
    searched = found = nothing = done = served = 0
    wrote = False
    matched: dict = {}
    for entry in waiting:
        if searched >= limit:
            break
        title = _shelf_title(entry)
        normal = norm_title(title)
        if normal in present:
            done += 1  # another book's search already brought this one back
            continue
        query = query_words(title=title, author=entry.get("author"))
        address = fetch.search_url(query, 1)
        hit = cached(address)
        if hit:
            say(f'Cached: "{query}"')
        else:
            searched += 1
            say(f'Searching {searched} of {run_total}: "{query}"')
        done += 1
        begin_search()
        outcome = collect(doc, known, query, 1, getter, slice_keys)
        served += outcome["pages_read"]
        for note in outcome["notes"]:
            say(note)
        if outcome["added"]:
            if not hit:
                found += 1
            wrote = True
            _record_search(doc, outcome, query, now, found_path)
            for work in outcome["added"]:
                found_title = norm_title(work.get("title"))
                if found_title:
                    present.add(found_title)
                    matched[found_title] = work
        elif not hit:
            nothing += 1
        if outcome["fatal"]:
            break

    if wrote:
        regenerate(data_dir, out_dir)

    handed = []
    note_line = ""
    if write_inbox:
        handed = _inbox_records(entries, matched)
        if handed:
            try:
                note_path, _note = inbox_file.write_inbox(handed, out_dir=out_dir, now=now)
            except (OSError, ValueError) as err:
                note_path = None
                say(f"The note for the page was not written: {err}")
            if note_path is not None:
                note_line = (f"Wrote {_shown(note_path)} for "
                             f"{_matched_books(len(handed))}.")

    left = max(0, waiting_total - done)
    say(f"Searched {searched}, found {found}, {nothing} had nothing, {left} to go. "
        f"Run it again for the next {limit}.")
    if note_line:
        say(note_line)
    return {"ok": served > 0, "searched": searched, "found": found,
            "nothing": nothing, "left": left, "matched": len(handed)}


def _shown(path) -> str:
    """A path as a command's line shows it: relative to the repo when it is inside it."""
    try:
        return str(Path(path).resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _matched_books(count: int) -> str:
    return f"{count} matched book" if count == 1 else f"{count} matched books"


def _inbox_records(entries, matched: dict) -> list:
    """The shelf entries this run matched, with the record the library gave them.

    The key an entry already carries is kept: the page merges on the key, so the book it
    imported is updated in place instead of arriving a second time under `w:`.
    """
    out = []
    seen: set = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        work = matched.get(norm_title(_shelf_title(entry)))
        if not isinstance(work, dict):
            continue
        if not (work.get("id") or work.get("groupKey")):
            continue
        key = str(entry.get("key") or "")
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        record = dict(entry)
        if work.get("id"):
            record["id"] = work["id"]
        if work.get("groupKey"):
            record["groupKey"] = work["groupKey"]
        out.append(record)
    return out


# --- suggested titles -------------------------------------------------------
#
# A person's words find books by keyword. An agent can also name titles it
# remembers that fit those words, and the catalogue checks each one: a title
# the library returns, with the same author, is added; anything else is said as
# not found. The agent's memory proposes, the catalogue decides. Only the one
# book that matches is kept from each search, never the rest of its page.

MAX_SUGGESTIONS = 10
_LIST_MARKER = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")
_SEPARATORS = (" | ", "|", "\t", " — ", " – ", " - ")


def parse_suggestions(text: str) -> list:
    """`[(title, author)]` from lines like `Circe | Madeline Miller`.

    The pipe is the format to write. A tab, an em or en dash, ` - ` or ` by `
    (the last one in the line) are read too, so a list in another shape still
    works. Blank lines and lines starting with `#` are skipped,
    and a leading `1.` or `-` is dropped. A line with no author is kept with an
    empty author: it is searched by title and matched by title alone.
    """
    found = []
    for raw in str(text or "").splitlines():
        line = _LIST_MARKER.sub("", raw).strip()
        if not line or line.startswith("#"):
            continue
        title, author = line, ""
        for separator in _SEPARATORS:
            if separator in line:
                title, author = line.split(separator, 1)
                break
        else:
            at = line.lower().rfind(" by ")
            if at > 0:
                title, author = line[:at], line[at + 4:]
        title = title.strip().strip('"“”*_').strip()
        author = author.strip().strip('"“”*_').strip()
        if title:
            found.append((title, author))
    return found


def _name_words(text) -> set:
    """The words of a name worth matching on: three letters or more."""
    return {word for word in norm_title(text).split() if len(word) >= 3}


def _main_title(text) -> str:
    """The title before any subtitle: `Circe: A Novel` -> `circe`."""
    return norm_title(re.split(r"[:;(]", str(text or ""), maxsplit=1)[0])


def is_suggested_book(work: dict, title: str, author: str) -> bool:
    """Whether a catalogue work is the book that was suggested.

    The main titles must be the same after normalising (case, accents,
    punctuation, a leading article, any subtitle). When an author was given,
    one of its longer words must be in the record's author: the catalogue
    files "Le Guin, Ursula K." and "Guin, Ursula K. Le" for the same person.
    """
    wanted = _main_title(title)
    if not wanted or _main_title(work.get("title")) != wanted:
        return False
    if not author:
        return True
    return bool(_name_words(author) & _name_words(work.get("author")))


def _book_line(title: str, author: str) -> str:
    return f'"{title}" by {author}' if author else f'"{title}"'


def suggest(suggestions, *, data_dir=DATA_DIR, out_dir=OUT_DIR, getter=None,
            cached=None, begin_search=None, now=None) -> dict:
    """Check each suggested title at the library: one search each, one book kept.

    `suggestions` is `[(title, author)]`, at most MAX_SUGGESTIONS of them (the
    rest are dropped, and that is said). A title already in the person's list
    costs no request. Each search is the catalogue's fielded search for that
    title and author (`fetch.book_search_url`), one page, paced like any search; from that page only the work that `is_suggested_book`
    accepts is merged, marked `"found": {"query": ..., "suggested": true}`.
    The first page that does not come back stops the run: a dead connection
    would otherwise cost a minute per title.
    """
    suggestions = [(t, a) for t, a in suggestions if str(t or "").strip()]
    if not suggestions:
        raise FindError("there are no suggested titles to check")
    if len(suggestions) > MAX_SUGGESTIONS:
        say(f"{len(suggestions)} suggestions given. Checking the first {MAX_SUGGESTIONS}.")
        suggestions = suggestions[:MAX_SUGGESTIONS]

    getter = getter or fetch.get
    own_fetcher = getter is fetch.get
    if cached is None:
        cached = fetch.is_cached if own_fetcher else (lambda url: False)
    if begin_search is None:
        begin_search = fetch.begin_search if own_fetcher else (lambda: None)

    data_dir = Path(data_dir)
    out_dir = Path(out_dir)
    found_path = data_dir / "found.json"
    doc = load_found(found_path)
    slice_doc = read_json(data_dir / "slice.json", default={})
    slice_keys = slice_identities(slice_doc)
    known: set = set()
    listed = []  # every work the person already has, to check a title against
    for work in doc.get("works") or []:
        known.update(identities(work))
        listed.append(work)
    for work in (slice_doc or {}).get("works") or []:
        if isinstance(work, dict):
            listed.append(work)

    total = len(suggestions)
    say(f"Checking {total} suggested title{'' if total == 1 else 's'} at the library, "
        "one search each, at least 5 seconds apart. Only a book with the same title "
        "and author is kept.")

    added_titles, already_titles, missing = [], [], []
    wrote = False
    stopped = False
    for number, (title, author) in enumerate(suggestions, start=1):
        line = _book_line(title, author)
        if any(is_suggested_book(work, title, author) for work in listed):
            say(f"{number} of {total}: {line}: already in the pile.")
            already_titles.append(line)
            continue
        address = fetch.book_search_url(title, author)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(address).query).get("query", [""])[0]
        say(f"{number} of {total}: {line}" + (" (cached)" if cached(address) else "")
            + f". Search sent: {query}")
        begin_search()
        try:
            html = getter(address, kind="on-demand")
            briefs = parse.briefs(html)
        except fetch.FetchError as err:
            say(f"The library would not give that page: {err}")
            stopped = True
            break
        except (urllib.error.URLError, OSError) as err:
            say(f"Could not reach the library: {err}")
            stopped = True
            break
        except parse.ParseError as err:
            say(f"   That page was not a catalogue search page: {err}")
            missing.append(line)
            continue

        match = next(((work, labels) for work, labels in works_with_labels(briefs)
                      if is_suggested_book(work, title, author)
                      and (INCLUDE_ON_ORDER or not is_on_order(work))), None)
        if match is None:
            say("   Not found: no book with that title and author came back.")
            missing.append(line)
            continue
        page_added, page_already, _linked = merge(doc, known, [match], query, set(),
                                                  slice_keys)
        if page_added:
            page_added[0]["found"]["suggested"] = True
            doc["searches"].append({"query": query, "fetched": now or _now(),
                                    "works": 1, "suggested": True})
            _refuse_forbidden(doc)
            _write_json(found_path, doc)
            wrote = True
            listed.append(page_added[0])
            work = page_added[0]
            say(f"   Found: {work.get('title')}"
                + (f", {work['author']}" if work.get("author") else "") + ". Added.")
            added_titles.append(line)
        else:
            say("   Found, and already in the pile.")
            already_titles.append(line)

    if wrote:
        regenerate(data_dir, out_dir)

    checked = len(added_titles) + len(already_titles) + len(missing)
    found_count = len(added_titles) + len(already_titles)
    said = f"Suggested titles found at the library: {found_count} of {checked}"
    if added_titles or already_titles:
        said += f" ({len(added_titles)} added, {len(already_titles)} already in the pile)"
    say(said + ".")
    if missing:
        say("Not found: " + "; ".join(missing) + ".")
        say("A title not found may be made up, remembered wrongly, or a book this "
            "library does not have.")
    if stopped:
        say(f"Stopped after {checked} of {total}: the library did not answer.")
    return {"ok": checked > 0,
            "added": len(added_titles), "already": len(already_titles),
            "missing": missing, "checked": checked, "stopped": stopped}


def read_suggestions(source) -> list:
    """The suggestion lines from a file, or from standard input for `-`."""
    if str(source) == "-":
        # Bytes, decoded here: a Mac shell with no UTF-8 locale would otherwise
        # fail on a dash in `Title — Author`.
        stream = getattr(sys.stdin, "buffer", None)
        raw = stream.read() if stream is not None else sys.stdin.read()
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        return parse_suggestions(raw)
    path = Path(source)
    try:
        return parse_suggestions(path.read_text(encoding="utf-8"))
    except OSError as err:
        raise FindError(f"{path} could not be read: {err.strerror or err}")


def _parse(argv):
    parser = argparse.ArgumentParser(
        prog="python3 tools/find.py",
        description="Fetch one library search a person asked for, and add its books to the app.")
    parser.add_argument("words", nargs="*", help='the words to search for, in quotes: "birds toronto"')
    parser.add_argument("--title", help="a title; with --author, find this book")
    parser.add_argument("--author", help="an author; with --title, find this book")
    parser.add_argument("--pages", type=int, default=None,
                        help=f"one to {fetch.MAX_ON_DEMAND_PAGES} pages (default 1)")
    parser.add_argument("--from-shelf", metavar="FILE",
                        help="match the books in an exported shelf file, one search each")
    parser.add_argument("--limit", type=int, default=None,
                        help=f"with --from-shelf, how many books to search (default {DEFAULT_LIMIT})")
    parser.add_argument("--write-inbox", action="store_true",
                        help=("with --from-shelf, also write app/data/inbox.js for the books "
                              "this run matched, so the page takes their new record ids "
                              "without another import"))
    parser.add_argument("--suggest", metavar="FILE",
                        help=("also check suggested titles, one 'Title | Author' per line "
                              f"(at most {MAX_SUGGESTIONS}; '-' reads them from standard "
                              "input): one search each, and only the matching book is kept"))
    parser.add_argument("--include-on-order", action="store_true",
                        help="also keep titles the library has only on order (left out by default)")
    parser.add_argument("--clear", action="store_true", help="empty data/found.json and stop")
    parser.add_argument("--data-dir", default=str(DATA_DIR),
                        help="where found.json lives (default: data/)")
    parser.add_argument("--out-dir", default=str(OUT_DIR),
                        help="where found.js goes (default: app/data/)")
    return parser, parser.parse_args(argv)


def main(argv=None) -> int:
    parser, args = _parse(argv)
    global INCLUDE_ON_ORDER
    INCLUDE_ON_ORDER = bool(args.include_on_order)
    if args.write_inbox and not args.from_shelf:
        parser.error("--write-inbox only works with --from-shelf")
    if args.clear:
        if args.words or args.title or args.author or args.from_shelf or args.write_inbox:
            parser.error("--clear takes no words, no --title, no --author and no --from-shelf")
        try:
            return clear(args.data_dir, args.out_dir)
        except (OSError, ValueError, FindError) as err:
            print(f"find: {err}", file=sys.stderr)
            return 2
    if args.from_shelf:
        for flag, given in (("--words", bool(args.words)),
                            ("--title", args.title is not None),
                            ("--author", args.author is not None),
                            ("--pages", args.pages is not None)):
            if given:
                parser.error(f"--from-shelf searches each book's title and author, so it "
                             f"cannot be used with {flag}")
        try:
            result = from_shelf(args.from_shelf,
                                limit=DEFAULT_LIMIT if args.limit is None else args.limit,
                                data_dir=args.data_dir, out_dir=args.out_dir,
                                write_inbox=args.write_inbox)
        except (OSError, ValueError, FindError) as err:
            print(f"find: {err}", file=sys.stderr)
            return 2
        return 0 if result["ok"] else 1
    if args.suggest and (args.title or args.author):
        parser.error("--suggest goes with a person's words, not with --title or --author")
    if args.limit is not None:
        parser.error("--limit only works with --from-shelf")
    if args.words and (args.title or args.author):
        parser.error('give words, or --title and --author, not both')
    if not args.words and not (args.title or args.author) and not args.suggest:
        parser.error('give some words, or --title and --author')
    pages = 1 if args.pages is None else args.pages
    if pages < 1:
        parser.error("--pages must be 1 or more")
    try:
        # Read the suggestions first: a bad file stops the command before any request.
        suggestions = read_suggestions(args.suggest) if args.suggest else None
        if args.suggest and not suggestions:
            raise FindError("there are no suggested titles to check")
        ok = True
        if args.words or args.title or args.author:
            result = run(words=" ".join(args.words) if args.words else None,
                         title=args.title, author=args.author, pages=pages,
                         data_dir=args.data_dir, out_dir=args.out_dir)
            ok = result["ok"]
        if suggestions:
            if args.words:
                say("")
            ok = suggest(suggestions, data_dir=args.data_dir,
                         out_dir=args.out_dir)["ok"] and ok
    except (OSError, ValueError, FindError) as err:
        print(f"find: {err}", file=sys.stderr)
        return 2
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
