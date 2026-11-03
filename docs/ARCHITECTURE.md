# Architecture

Thin on purpose. The app decides and routes; the library owns the record. Rewritten 2026-11-03 from the first draft:
same thesis, now with the shapes pinned down so a task can be built without making a design call.

## The picture

```
 build time (a developer's machine, network on)          run time (anyone's browser, network off)

 adapters/bibliocommons/ ─fetch search pages─▶ .cache/          app/index.html
      │            (robots.txt; paced, cached)             ├─ core/      the foundation
      ▼                                                    ├─ modes/     one file each: choose six, say why
 data/slice.json  ◀── normalise, dedupe, drop blurbs       ├─ data/      slice, tags, practice (generated .js)
 data/tags.json   ◀── our own words, by hand               └─ localStorage: two shelves, never mixed
 data/practice.json                                                │
      │                                                            ▼
      └── tools/gen_data.py ──▶ app/data/*.js          a link out to the library's own page for the book
```

Nothing at run time talks to the library. It cannot: the catalogue sends no CORS header (measured, `RESEARCH.md`).

## The data files

Canonical JSON in `data/` (`slice`, `tags`, `practice`, and when present `found` and `events`), validated by
`data/*.schema.json`, and turned into
`app/data/<name>.js` (`Nextbook.data.put('<name>', {...})`) by `tools/gen_data.py` so the folder works from
`file://`. `tools/build.py` inlines them as `<script type="application/json" id="nb-<name>">` blocks instead.
`Nextbook.data.get(name)` reads whichever is present, inside `try`/`catch`, and returns `null` on failure; the shell
then shows a plain sentence ("The book list did not load. The rest of the app still works.").

### `slice.json`, the starting list

**For now (D28) it is made from the W13 pack** by `adapters/pack/pack_to_slice.py`: 30 real books with our own facets,
search links instead of record links (`library.recordUrl` is `null`), `section:` and `contentType` derived from the
pack's genres through one table, and `formats: []`. Every mode on the menu runs on it. Real catalogue records join it
when a person's helper finds books (`found.json`, below), and a found record of a pack book enriches that book (its
record id, call number, formats, subjects) instead of adding a second copy.

**Later (T8.11)** a batch slice from catalogue search pages has the same shape, built by
`adapters/bibliocommons/build_slice.py`. The example below is that shape. Never edited by hand, either way.

```json
{
  "schema": "nextbook/slice-1",
  "library": {
    "name": "Toronto Public Library",
    "recordUrl": "https://tpl.bibliocommons.com/v2/record/{id}",
    "searchUrl": "https://tpl.bibliocommons.com/v2/search?searchType=keyword&query={q}",
    "idPattern": "^S\\d+C\\d+$"
  },
  "fetched": "2026-11-10",
  "sources": [{ "url": "https://tpl.bibliocommons.com/v2/search?...", "fetched": "2026-11-10", "bibs": 63, "works": 20 }],
  "facets": {
    "topic:wizards":        { "label": "wizards",                 "kind": "topic",   "works": 7 },
    "bisac:science-fiction":{ "label": "science fiction",         "kind": "bisac",   "works": 31 },
    "section:500":          { "label": "the science shelves (500s)", "kind": "section", "works": 12 }
  },
  "works": [
    {
      "id": "S234C4805630",
      "groupKey": "turbulent_sun_...",
      "title": "The Turbulent Sun",
      "subtitle": "A Natural History of Our Cosmic Origins and Future",
      "author": "Leon Golub",
      "authorKey": "golub, l",
      "year": 2026,
      "formats": ["BK"],
      "contentType": "NONFICTION",
      "audience": "ADULT",
      "language": "eng",
      "callNumber": "523.58 GOL",
      "series": [],
      "facets": ["topic:heliosphere-astrophysics", "topic:solar-activity", "topic:sun", "section:500", "genre:history"]
    }
  ]
}
```

- **One entry per work** (`groupKey`). `id` is the record of the preferred manifestation: `BK`, then `LPRINT`, then
  `EBOOK`, then `EAUDIOBOOK`, then anything. `formats` lists every format seen for the work.
- **`facets` is a dictionary** of every facet that survived, with a display `label` (used in reason sentences) and how
  many works carry it. A facet carried by only one work cannot match anything and is dropped at build time.
- **`sources` says where the works came from.** A catalogue search gives `{url, fetched, bibs, works}` with a URL; the
  pack gives `{kind, name, version, fetched, books, works}`, because it has no URL (D28). The app never reads it; it is
  there so a slice can say how old it is and what it was built from.
- **The URL templates live in the slice**, not in the app. That is what keeps the app library-generic (D10). The app
  never contains `bibliocommons`.
- **No `description`, no `jacket`, no `rating`.** The build fails if any appears.

How raw subject headings become facets is specified in `DATA.md`, "From headings to facets".

### `tags.json`, our own words

Hand-written, keyed by `groupKey`. This is where the things the catalogue does not carry live: mood, pace, and a
one-line note in our own words. Seeded from the W13 reading pack (30 books with mood, pace and a note, written for the
workshop rather than copied from a publisher).

```json
{
  "schema": "nextbook/tags-1",
  "vocab": { "mood": ["quiet","dark","hopeful","funny","tense","warm","strange","sad"], "pace": ["slow","steady","fast"] },
  "works": {
    "dispossessed_...": { "mood": ["quiet","strange"], "pace": "slow",
                          "note": "Two worlds, one that owns things and one that does not, and a physicist stuck between them." }
  }
}
```

At load, tags become facets on the work (`mood:quiet`, `pace:slow`) with labels "quiet books", "a slow pace". Modes that
need mood or pace (challenge, time-box) work only on tagged works and must say how many untagged works they skipped.

### `found.json`, books found on request (D26)

The slice is what the app knows before anyone asks. `found.json` is what a person's agent fetched because they asked:
"find me books about birds", "find this book I typed". `tools/find.py` runs one catalogue search through the adapter
(paced as on demand, `DATA.md`), normalises the records with the same rules as the slice, and merges them in:

```json
{ "schema": "nextbook/found-1", "searches": [{ "query": "birds toronto", "fetched": "2026-11-07T11:40:00Z", "works": 18 }],
  "facets": { "topic:birds": { "label": "birds", "kind": "topic", "works": 9 } },
  "works": [ { "...same shape as a slice work...": "", "found": { "query": "birds toronto" } } ] }
```

At load, found works join the pool (`ctx.works`) beside the slice, each marked with `found`, and their facets join the
dictionary. Singletons are kept here: a found book is there because of this person. A work already in the slice is not
duplicated. The shelf screen says "Your helper found 18 books for 'birds toronto'" with a Clear button, and typed books
whose title and author now match a found work are linked to it, so they gain subjects.

This is the workshop's route to real, context-driven requests: the person asks in words, the agent fetches, the page
reloads. It needs an agent with a terminal, so the hosted copy does not have it; the hosted copy's future route is the
Open Library lookup (`BUILD.md` T8.10).

### `practice.json`, the practice shelf

A list of shelf entries (shape below) pointing at slice works, with states and ratings already set, so the app has
something to show in its first second. Twelve of the W13 pack's books.

### `events.json`, the events snapshot (last in priority, D30)

A dated snapshot of one branch's events from the library's feed, made ahead by `adapters/bibliocommons/events.py`
(the feed has no CORS either): `{fetched, branch, window, source, events: [{id, title, start, end, branch, virtual,
categories, summary, url}]}`. `summary` is the library's own event text, at most 300 characters, shown with a link to
the event page. The app always shows the snapshot's date and never calls it live.

## The shelf

Kept in `localStorage`. Three keys, never mixed:

- `nextbook-own-v1`, the person's own shelf.
- `nextbook-practice-v1`, the practice shelf: filled from `practice.json` on first use, with a banner that says it is
  practice, a switch to the own shelf, and a reset that refills it. Reset never touches the other keys.
- `nextbook-others-v1`, friends' shelves: each an exported shelf file added with "Add a friend's shelf" and a name.
  Never merged into the person's own; swap and club season read them as `ctx.others`.

**In a workshop copy** (`app/data/workshop.js` sets the flag) the practice shelf is the only shelf: the switch is
replaced by "On this computer, use the practice shelf. Your own books go in at home, on your own computer.", and the
library import is off. The app says this itself, so the rule does not depend on the agent's brief.

**When storage fails** (some browsers on `file://`, private windows), the store keeps the shelf in memory and the page
says "This browser is not saving. Export before you close it." It never shows a blank page.

Each mode's last inputs and its shuffle seed are kept too, so blind date shows the same three after a reload until
"Shuffle".

```json
{
  "schema": "nextbook/shelf-1",
  "exported": "2026-11-10T14:03:00Z",
  "entries": [
    { "key": "w:dispossessed_...", "id": "S1234C567", "groupKey": "dispossessed_...",
      "title": "The Dispossessed", "author": "Ursula K. Le Guin",
      "state": "read", "rating": "loved", "updated": "2026-11-10T14:00:00Z" }
  ]
}
```

- `state` is one of `want`, `reading`, `read`, `stopped`. `rating` is `loved`, `liked`, `ok`, `not-for-me` or `null`.
- Optional `from` says where an entry came from when it was imported (`tpl-shelf`, `goodreads`, ...), and optional
  `stars` keeps a 1 to 5 rating exactly as the other system gave it. Neither changes the weights; they keep an import
  honest and reversible. Unknown keys on an entry are kept and exported untouched.

### Lining up with the library's own shelves

BiblioCommons (TPL's catalogue, and many other libraries') already keeps shelves for a signed-in person, so ours must
line up with theirs without a lookup table nobody wrote down:

| Library shelf | Our `state` | Library stars | Our `rating` |
|---|---|---|---|
| For Later | `want` | 5 | `loved` |
| In Progress | `reading` | 4 | `liked` |
| Completed | `read` | 3 | `ok` |
| (none) | `stopped` | 1 or 2 | `not-for-me` |

Measured on a saved shelf page (`DATA.md`): the codes are `for_later`, `in_progress`, `completed`, and `rating` is out of
10 (stars times two; `0` is unrated), so `stars = rating / 2` and half stars round down.

Entries from the slice are keyed by the library's own `groupKey` and record id, so a shelf brought in from the library
lands on the same works with no fuzzy matching. Bringing it in is a later task (D20); the shapes are fixed now so it
needs no migration.
- `key` is `w:<groupKey>` for a book from the slice, and `t:<normalised title>|<normalised author>` for a book typed in.
  A typed book that matches a slice work (same normalised title and author) is linked to it on entry.
- A typed book with no match keeps `id` and `groupKey` null. It has no facets, so it does not move the profile, and it
  still gets a link: the library's search page for its title and author.
- **Two addresses are two shelves.** `localStorage` belongs to the page's address, so the folder opened as a file, the
  same folder served by `tools/serve.py`, and the one-file take-home each have their own shelves. Move a shelf between
  them with export and import, and say so wherever the app is handed over (a Search Desk lesson).
- **Export** writes this shape to `nextbook-shelf-<date>.json`. **Import** merges by `key`; on a clash, the newer
  `updated` wins, and the app says how many it added, changed and kept.

### Weights

| Entry | Weight |
|---|---|
| rating `loved` | 3 |
| rating `liked` | 2 |
| rating `ok`, or state `read` with no rating | 1 |
| state `reading` | 0.5 |
| state `stopped` with no rating | -1 |
| rating `not-for-me` (any state) | -2 |
| state `want` | 0 (it is a wish, not evidence; modes may use it as a target) |

## The scoring core (`core/score.js`, pure)

No embeddings (D5). Everything here is a plain function with a unit test.

- `profile(entries)` returns `{ weights: {facet: number}, authors: {authorKey: number}, evidence: {facet: [entry...]}, rated: n }`.
  Each entry adds its weight to every facet of its work, and to its author. `evidence` remembers which shelf entries
  produced each facet, so a reason can name a book.
- `score(work, profile)` returns `{ score, parts: [{facet, label, weight}] }`. The facet part is the sum of
  `profile.weights[f] * kindWeight(f)` over the work's facets, divided by `sqrt(number of facets)` so a heavily
  catalogued work does not win on label count (the first draft divided by the count, which punished well-catalogued
  books too hard). The author part is `2 * profile.authors[authorKey]`, as its own entry in `parts`. Negative parts
  are kept: they explain a low score.
- `kindWeight`: `topic` 1, `genre` 1, `bisac` 0.75, `series` 1.5, `mood` 1, `pace` 0.5, `section` 0.5,
  `audience` 0. One table in one place, so a participant can change it and see what moves.
- `similar(a, b)` returns `{ score, shared: [facet...] }` between two works: the same weighted overlap, symmetric. Used
  by walks (journey, ladder).
- `sections(works)` groups works by their `section:` facet (Dewey hundreds, or the fiction shelf words). Survey and
  blind date use it, because "a part of the library you never visit" is literally a shelf.

Ties break by `id`, so the same shelf always gives the same six.

## Reasons (`core/reason.js`, pure)

`reason(parts, opts)` turns the two strongest positive parts into one sentence:

- author: "You rated Ursula K. Le Guin well already."
- two facets: "Matches books about wizards and science fiction on your shelf."
- one facet with evidence: "Shares the Earthsea series with A Wizard of Earthsea, which you loved."
- negative evidence, when a mode asks for it: "Not much like your shelf, which is the point: you have no history."

Modes may write their own sentence, but it must name evidence (a facet label, a book, an author or a rule). The
contract check rejects an empty `why` and the stock phrase "a small match". A reason is at most 200 characters.

## Modes (`app/modes/`, the participants' slot)

A mode is one file that registers one object. The full contract, with an example, is `docs/CONTRACT.md`; the shape:

```js
Nextbook.mode({
  id: 'more-by', name: 'More by them', purpose: 'Other books by authors you rated well.',
  shape: 'list',                 // 'list' or 'path'
  allowShelf: false,             // optional: true when picks may already be on the shelf
  inputs: [],                    // optional: [{id:'seed', kind:'book'|'shelf-book'|'facet'|'text'|'number', label}]
  strings: { ... },
  logic: { ... },                // pure helpers, tested by the mode's check file
  choose(ctx, input) { return { picks: [{ id, why, group?, step? }], note? }; }
});
```

A mode **does not draw anything**. The shell draws every result the same way: six cards (or an ordered path), the
reason on each, the library link, the model box. That keeps a beginner's file small, makes every mode comparable at
show-and-tell, and lets the shell enforce the rules instead of trusting each mode:

- every `id` must exist in the slice; unknown ids are dropped and named on screen;
- every pick needs a `why`; a pick without one is dropped and named;
- at most six picks, list or path, no repeats, nothing already on the shelf unless the mode says `allowShelf`;
- no picks and no `note` is an error the person sees: "This mode found nothing and did not say why."

`ctx` is the only thing a mode touches: the slice, the shelf, the profile, `score`, `similar`, `reason`, `sections`,
`labelOf`, `tagsOf`, a seeded `random()` (so blind date is repeatable in a test), other imported shelves (swap, club),
and `t()` for strings. It has no DOM and no storage.

`app/modes/list.js` lists the modes to load, and nothing else. The menu of ideas is `docs/modes/`, read by people
and their agents; the app never shows modes that are not built. A listed mode whose file is missing or throws shows a
card saying it did not load, and the rest of the app carries on (Search Desk's "missing is fine").

Around every result the shell adds what no mode should rewrite: the cards and links, "Want to read" and "Read it"
buttons on each card (the mode runs again after either), the mode's last inputs remembered in this browser, and the
model box. `CONTRACT.md` section 8.

The contract code is ported from Search Desk's `core/contract.js`: the banned-word scan runs over every function of
the registered mode (`fn.toString()`, comments stripped), which works in a page with no file access, and
`Nextbook.check(id, (t, mode) => ...)` with `t.ok` and `t.eq` is the same check API. The command-line runner is
ported from `checks/run.js` and `checks/check.sh`, so it runs under Node and under `osascript` on a Mac with no
Node.

## Bringing in the library's shelf: one-way sync (later, D20, D23, D25)

The library's shelves flow **into** the app, as often as the person likes; nothing flows back. Where the two disagree
because of something the person did here, the app lists it so they can fix it at the library with one click, which is
the only way anything changes there.

### The memory that makes it smart

Every entry that came from the library keeps what the library said **the last time it was brought in**:

```json
"library": { "itemId": 2997315199, "id": "S234C4805630", "shelf": "completed", "rating10": 8,
             "dateAdded": "2026-04-07", "seen": "2026-11-03T16:44:00Z", "ignore": null }
```

On the next import each book has three values: **B**, the library's last time (`library`); **L**, the library now;
**A**, the app now. States and ratings compare through the table in "Lining up with the library's own shelves", with
ratings compared in buckets (5 = loved, 4 = liked, 3 = ok, 1 to 2 = not-for-me), so 9/10 and "loved" agree.

| What happened | Rule | The person sees |
|---|---|---|
| New at the library, not here | add it, `from: library-shelf` | counted in "Added" |
| Changed at the library, not here (`L ≠ B`, `A = B`) | follow the library, quietly | counted in "Updated from the library" |
| Changed here, not at the library (`L = B`, `A ≠ B`) | keep ours | listed in **Tidy up at the library** |
| Changed in both, differently (`L ≠ B`, `A ≠ B`, `A ≠ L`) | keep ours for now | listed in **Which is right?**, with both sides |
| Changed in both, the same way (`A = L`) | nothing to do | nothing |
| Gone from the library shelf | keep it, mark it | listed only if the import was complete (below), as "No longer on your library shelf" |
| On the app's shelf, never at the library | nothing to do | optionally listed under "Not at the library yet" |
| First import, and the book is already here from the slice | treat ours as A with no B | same as "changed in both" when they disagree |

The memory B is updated to L on every import, whatever the person decides, so a difference is asked about once.

### What the person sees

- **One button on the shelf screen:** "Bring in my library shelf". It says plainly: save your shelf pages from the
  library's site, choose the files, delete them afterwards. The import reads the shelf and the book records and
  nothing else in the file.
- **A report in words, with one Undo for the whole import** (a Search Desk lesson: every bulk change can be undone):
  "Added 12. Updated 3 that changed at the library. 2 are different here. 1 needs you to choose."
- **"Tidy up at the library (N)"** on the shelf screen: each book with "Here: read, loved. At the library: For Later."
  and three choices: **Open at the library** (the record page, where the shelf buttons are), **Use the library's**
  (copy L into the app), **Leave it** (remembered in `ignore` until either side changes again, so the list never nags).
- **"Which is right? (N)"**: the same row with both sides, and "Keep mine" or "Use the library's".
- **"Last brought in from the library: Nov 3"** next to the button. It is a snapshot, and the page never pretends
  otherwise.

### The edges

- **Partial files.** A saved page holds 25 books; the page also carries each shelf's total. The reader adds up what
  it got, and if a shelf is incomplete it says "You brought in 25 of 112 Completed books. Save the other pages too."
  **Nothing is treated as removed from an incomplete shelf.**
- **Editions.** Match on `groupKey`, not on record id: the library shelf may hold the e-book and the app the paper
  copy. Two editions of one work on the library shelf become one entry with the furthest-along state.
- **"Stopped".** The library has no such shelf. An app `stopped` against a library `in_progress` is listed under
  tidy-up as information ("The library still has this as In Progress"), and "Leave it" is a fine answer.
- **Ratings in half stars.** `rating10` is kept exactly; only the bucket is compared.
- **The practice shelf never takes a real import,** and the import is switched off in a workshop copy: a shared
  library computer is not the place for anyone's reading history. It says so in a sentence.
- **Other platforms** produce the same thing, `{entries, works, complete: {shelf: true|false}}`, from their own reader
  in their own adapter. Goodreads and StoryGraph CSVs go through the same merge, with their own codes in `from`.

## The model seam (`core/seam.js`)

Optional everywhere. The app is complete with the box never touched. No keys and no API calls: the route is copy a
prompt, paste it into any chat, paste the answer back. Two jobs, one guard.

1. **Argue between finalists.** `finalistsPrompt(result, profile)` writes the candidates as lines of
   `id | title | author | year | facet labels | facts`, where `facts` is `factsClause()`: the same evidence as the
   reason, in words that name no shelf book. **Never `reason()`**, which may name one ("Shares the Earthsea series
   with A Wizard of Earthsea, which you loved"): the reason is for the person's eyes. Plus the profile's top five
   facet labels. It asks for exactly two lines back, `<id>: <one sentence>`, and ends "Answer with two lines. Do not
   change any files.", because the prompt may be pasted into an agent's tab rather than a chat. **No title from the
   shelf is ever in a prompt**, so the room's "do not type your reading history into an AI" and the app tell the same
   truth.
2. **Text to facets.** `labelsPrompt(text, facetLabels)` asks a model to choose up to four labels **from the slice's
   own facet list** for a piece of text (an event, a headline, a wish). Event hook and news diet use it.

`parseFinalists(answer, result, idPattern)` and `parseLabels(answer, facets)` keep what matches and return
`{ kept, dropped, reason }`. Anything that looks like an id but is not one of the six is dropped and named. An answer
with nothing valid says so. Titles, authors, years and links in the answer are ignored: the card shows the slice's.

## Links (`core/links.js`, pure)

- A work in the slice: `library.recordUrl` with `{id}`. That page holds availability, formats, the hold button, and
  the library's own suggestions, and the app says so once, near the results.
- A typed book: `library.searchUrl` with `{q}` = title and author, URL-encoded.
- A pack work (`library.recordUrl` is `null`): the search URL, as for a typed book, until a find enriches it with a
  `recordId`, and then the record URL.

Never stored; always derived.

## The shell (`core/shell.js`)

Three screens behind the address hash, so a link or a reload lands in the same place:

- `#shelf`: the practice banner and switch, add a book (search the slice by title or author first, type it in
  second), the list with state and rating controls, export and import.
- `#find` (the default): the loaded modes as cards, the chosen mode's inputs, its result, the model box.
- `#selftest`: runs every loaded mode's checks and the standard shelves in the browser, and lists data load status.
- `#events` (when the snapshot is there): the branch's events with the snapshot's date.

## Packing

- `tools/build.py` writes `dist/nextbook.html`: one file, every script and style inlined, data in JSON blocks, no
  network request of any kind.
- `tools/build.py --starter` writes `dist/starter/`, the workshop folder: the app with only the example mode listed
  and the workshop flag set, no found books, the contract, the mode briefs, and the tools a participant needs (check,
  build, serve, find). The exact list is `BUILD.md` T5.2, and what the kit may rely on is `BUILD.md`, "What the
  starter guarantees the kit". The session's own brief is added by the workshop kit, not by this repo.
- `tools/build.py --demo` writes `dist/demo.html` with the reference modes loaded, for the projector.

## Hosted copy (later)

The same single file on a static host. The only runtime network call ever permitted is an optional Open Library
lookup for a typed book outside the slice (CORS `*`, measured), off by default, and the app says what it will send
before it sends it. Not in the first release.

## What the thin build deliberately lacks

Covers, blurbs, availability counts and live search. Each is on the library's page, one click away, and each is a
copyright or a scraping problem we do not need to have.
