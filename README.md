# nextbook

A small app that helps one person decide what to read next from their **public library's catalogue**, then sends them
to the library's own page to borrow it.

It runs from a folder in a browser. No install, no server, no account, no network, no tracking. A person's reading
history stays in their browser, and the app says so.

Built as the starter for a workshop session at Toronto Public Library's AI residency — the [residency
page](https://www.ryankelln.com/tpl_2026/) describes it. Nothing here needs that workshop: the app, the mode contract
and the tools work on their own, for anyone with a library card and a browser.

## Open it

| What you want | What to open |
|---|---|
| The app | `app/index.html` — double-click it. That is the whole install. |
| Proof it works | `app/index.html#selftest` — runs the checks in the page and names what failed |
| Live reload while editing | `python3 tools/serve.py` — prints a local address and refreshes on save |
| One file to carry or host | `python3 tools/build.py` → `dist/nextbook.html` |
| A demo with four finished modes | `python3 tools/build.py --demo` → `dist/demo.html` |
| A folder to hand out | `python3 tools/build.py --starter` → `dist/starter/` |

Nothing is needed to use the app. Node 18 or newer runs the mode checks, Python 3.9 or newer builds the one file,
and neither is required to read a book list.

`dist/` is not in the repository: the build writes it. Everything the app needs at runtime is in `app/`.

## The shape in five lines

1. The person keeps a shelf: what they have read, are reading, want, and how they rated it.
2. A **mode** narrows the list to at most six candidates with a cheap, explainable rule, and says why for each.
3. Optionally, a model argues for the picks, one sentence each, using only the candidates it was given. The answer is
   checked against the list; anything invented is dropped and named.
4. The person decides.
5. Every candidate links out to the library's own page for that book: its record page once the catalogue has matched
   the title, and its search page until then. Availability, formats, the hold button and the library's read-alike
   suggestions live on the record page.

The app is a decision layer and a router. It is not a catalogue, not a recommender service, and not a reading tracker
in the cloud.

## Write a mode

A mode is one file that chooses up to six books and says why. `app/modes/more-by.js` is the worked example; the rules
are in `docs/CONTRACT.md`; `docs/modes/` holds ten more as briefs you can build. After every change:

```sh
node tools/check-mode.js more-by        # or --all; on macOS, bash tools/check.sh more-by when there is no Node
```

Only have a chat window? `python3 tools/packets.py` writes one self-contained packet per brief into `dist/packets/`:
the job, the brief, the rules, the worked example, and what to do with the answer.

The check runs the mode against seven standard shelves and fails a mode that picks nothing, picks without order, says
nothing at all about a pick, or reaches for the network, a clock or the DOM.

## What is in the tree

| Path | What it holds |
|---|---|
| `app/` | the app. `core/` is the foundation (shelf, data, scoring, reasons, links, contract, model seam, shell); `modes/` is where one file per mode goes |
| `data/` | the data: `slice.json` (works), `tags.json` (facets and a note in our own words), `practice.json`, `events.json`, and their schemas |
| `adapters/` | the only code that knows the library's platform, plus the pack converter. Which library is one file, `adapters/bibliocommons/libraries/` |
| `tools/` | `build.py` (one file, demo, starter), `serve.py`, `find.py`, `check-mode.js` + `check.sh`, `gen_data.py` |
| `tests/` | Node tests for the core, Python tests for the adapters, and `DATA-TEST.md` (the `data-test` names) |
| `reference/modes/` | three finished modes with their checks, for a projector or a reading |
| `docs/` | design, architecture, data, contract, decisions, the build plan, the mode briefs |
| `research/probes/` | the throwaway scripts that produced the measurements. Not the product |

## Bring your own books

The app starts from a snapshot, not a live catalogue: `data/slice.json` is 30 real Toronto Public Library works,
`data/tags.json` is our own facet words for them. Two ways to make it yours:

- **A pack you write** (books, genres, themes, mood, pace) → `adapters/pack/pack_to_slice.py`. The pack that made
  this repo's data is `data/pack/books.json`; put yours there, or point `NEXTBOOK_PACK` at it, and run the converter.
  `python3 tools/gen_data.py` then regenerates `app/data/*.js`.
The thirty books that ship were hand-tagged from a reading pack, so their cards open the catalogue's search for the
title. The catalogue's own record pages arrive through the adapter below, or through `tools/find.py` when a person
asks for a search.

- **The catalogue itself** → `adapters/bibliocommons/` fetches a search a person asked for, at a person's pace,
  honouring `robots.txt`, and caches by record id. `tools/find.py "birds toronto"` is the whole loop. A different
  BiblioCommons library is one file in `adapters/bibliocommons/libraries/`.

Never a crawl. The app asks for what a person asked for, keeps what came back, and says where it came from.

## Boundaries that are not negotiable

- **No tracking, no accounts, no server-side shelf.** A person's reading history stays in their browser. Export is a
  file they hold.
- **A book on the person's shelf never goes into a model prompt.** Candidate titles are public catalogue data; a shelf
  title is the reading list. The prompt leaves shelf books out and says how many.
- **No ingestion of NoveList.** The library's "You may also like" is licensed editorial content. Link to it, never copy
  it.
- **No bulk mirror of the catalogue.** Query and cache what a person looked at. Never crawl every record so we own a
  copy.
- **No publisher blurbs in our own pages.** Our words, the library's page, the library's blurb.
- **No model in the search path.** Models argue between finalists; arithmetic narrows the field.

These come from the app's job, not from taste. `docs/DECISIONS.md` records what each one cost.

## Status

The foundation is built and checked: 259 Node tests, 335 Python tests, the three reference modes and the example mode
passing, and a one-file build with no network requests. A reading list can be imported from Goodreads or StoryGraph,
merged with the library's shelves, and matched to the catalogue a book at a time. The ten mode briefs in `docs/modes/` are deliberately
unbuilt — that is the work the app leaves to its reader. `docs/BUILD.md` is the plan and the record of how it was made.

The catalogue measurements in `docs/DATA.md` and `docs/RESEARCH.md` carry the URL and the date they were taken, so
they can be re-checked rather than believed. The fallback-sources table is a survey, not a measurement.

## Licence

MIT. See `LICENSE`. Ported patterns from [searchdesk](https://github.com/RKelln/searchdesk) are the same author and the
same licence; each ported file says so at the top. Book metadata belongs to the library catalogue; the facet words and
notes in `data/tags.json` are ours.
