# Build order

For the session that builds this repo out. Each step is small, ordered, and has a check that can fail. Do not start a
step before the one above it passes. Record in `docs/RESEARCH.md` anything you learn that contradicts a document.

## 1. Re-verify the data before trusting the design

Run both probes against the live catalogue. Confirm: the `entities.bibs.<id>.briefInfo` path still exists, subject
headings still arrive, `groupKey` is still there, and a search page still returns dozens of bibs.

**Passes when:** `record_fields.py` prints non-empty `subjectHeadings` and `groupKey`, and `search_bibs.py` reports more
than ten bibs. If either fails, stop and correct `docs/DATA.md` first.

## 2. The catalogue adapter and the slice builder

`adapters/tpl/build_slice.py`: fetch a set of records (a few hundred is plenty: start with 20 pages of new titles plus a
couple of curated subject searches), parse `briefInfo`, normalise the facets, dedupe on `groupKey`, strip and unescape
descriptions, and write `data/slice.json` with a `fetched` date, a source URL per record, and a count.

Keep raw payloads out of the repo. Be polite: one request at a time, a descriptive user agent, a delay between calls.

**Passes when:** `slice.json` validates against the schema you write alongside it, contains no field named
`description`, dedupes to one entry per `groupKey`, and a spot check of three records matches what a browser shows for
the same ids.

## 3. The app shell

`app/index.html`: the shelf, add by title and author, three states, ratings, `localStorage`, export and import, practice
mode with its banner, switch and reset. Open it from the folder with the network off.

**Passes when:** the shelf survives a reload; export then import round-trips; practice edits never appear on the own
shelf and resetting practice leaves the own shelf untouched; every failed data block shows a sentence, not a blank page.

## 4. The scoring core and one mode

Start with **survey** (one candidate from each part of the catalogue the shelf does not visit). It needs no stance tags
and it exercises coverage, facets and reasons. Then add **journey** (a greedy walk from a loved book toward a distant
one).

**Passes when:** a fixed test shelf produces the same shortlist twice; every candidate's reason names the facets that
produced it; an empty or unrated shelf explains why it cannot suggest anything instead of showing a list; and a book
outside the slice still gets a catalogue link.

## 5. The model seam

A prompt builder that writes out the six candidates with ids, and a paste-back box that reads the answer. Ids only.

**Passes when:** an answer containing an invented id displays the good picks and names the dropped one; an answer with
no valid ids says so; and the app is fully usable with the box never touched.

## 6. The route out

Every candidate links to `https://tpl.bibliocommons.com/v2/record/<id>`, and the app says plainly that availability,
formats and the hold button live there.

**Passes when:** a link opens the right record for three sampled ids, and this returns nothing:

```sh
grep -c "Provided by publisher" app/index.html data/slice.json
```

## 7. The hosted copy

Build the same file as `dist/index.html` for a static host. No accounts, no analytics, no server.

**Passes when:** the built page makes no network request except its own file (check the browser network panel), and the
optional one-title fallback lookup is off by default and says what it will send when it is on.

## 8. The take-home and the workshop handoff

Only after Ryan has seen the app. The workshop side lives in the residency repo; see `docs/W13.md`. What this repo owes
it: a starter the room can open, a practice shelf that clears in one click, and a one-page brief the agent in the room
can follow.

**Passes when:** a person who has never seen the app can open it, rate three books, get six suggestions and click out to
a record page without help.

## Order of work if time is short

1, 2, 3, 4 (survey only), 6, 5, 7, 8. Steps 1 and 6 are what make it true rather than clever.
