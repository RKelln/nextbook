# AGENTS.md

Read this before changing anything. Then read `docs/BUILD.md`, which is the task list, and only the documents your
task names.

## What you are building

A small web app that helps one person decide what to read next from their public library's catalogue, then links them
to the library's own page for the book. It runs from a folder in a browser, with no install, no server and no network.

The app has a **finished foundation** (the shelf, the data, the scoring core, the reason sentences, the model seam, the
links) and a **slot for modes**. A mode is one file that chooses six books and says why. The repo ships one example
mode on purpose and leaves the menu of modes as written briefs in `docs/modes/`, so that workshop participants build
them. The menu is documentation for people and agents, not part of the app. Reference builds live in `reference/`.

## Rules that come from the project, not from taste

When two conflict, the earlier one wins.

1. **The person's shelf never leaves their browser.** No accounts, no server storage, no analytics, no telemetry. The
   model prompt carries the six candidates and facet words, never the shelf's titles.
2. **Never read NoveList with code.** The record page's "You may also like" is licensed to the library. Link to the
   record page; never fetch, parse, cache or copy the list. The catalogue's `robots.txt` disallows
   `/item/read_alike_list/` too.
3. **Never build a catalogue mirror.** Fetch search pages for a fixed list of queries, keep what comes back, cache by
   record id. Honour `robots.txt`, including its `Crawl-delay: 120`. Never crawl to own a copy.
4. **Never store publisher blurbs.** No field named `description` in any file that ships, fixtures included. The blurb
   is seen on the library's page only.
5. **A model only ever chooses among things that exist.** Its answer is checked against the shortlist (or the facet
   list) before display. Anything it invents is dropped and named. Titles, authors, dates and links never come from a
   model.
6. **Every suggestion carries a reason in words** that names the evidence. A pick with no sentence is a bug, and the
   contract check fails it.
7. **The app works offline from a folder**, and says in a plain sentence when it cannot do something.

## How the code is laid out

```
app/                    the app. Open app/index.html in a browser. Nothing to install.
  core/                 the foundation: shelf, data, scoring, reasons, links, contract, model seam, shell
  modes/                one file per mode, plus its check. list.js says which load. Nothing else.
  data/                 generated .js wrappers of data/*.json. Never edit by hand.
data/                   the canonical data: slice.json, tags.json, practice.json, and their schemas
adapters/bibliocommons/ the only code that knows the library's platform (BiblioCommons). Which library is one
                        file in libraries/ (tpl.json: subdomain, name, slice queries)
tools/                  build.py, serve.py, check-mode.js + check.sh (a mode's checks), gen_data.py
.claude/commands/       new-mode and check, for the Code tab (written once in tools/commands/)
tests/                  unit tests for core (Node) and the adapter (Python)
reference/modes/        finished demo modes. Never copied into the starter.
docs/                   design, data, contract, the build plan, the mode briefs
research/probes/        throwaway scripts that measured something. Never ship.
```

Classic scripts that attach to `window.Nextbook`, loaded in order by `<script src>` tags, so the folder works from
`file://`. No modules, no framework, no packages, no CDN, no TypeScript. Python is standard library only.

`tools/build.py` packs the folder into one HTML file (`dist/nextbook.html`) for carrying home or hosting, with the data
in `<script type="application/json">` blocks. Nothing needs it to **run**; it exists to **carry**.

## Commands

```sh
node --test tests/*.test.js              # core unit tests (Node 22 refuses a bare folder: keep the glob)
python3 -m unittest discover -s tests -p 'test_*.py'   # adapter tests
node tools/check-mode.js <id>            # one mode: its own checks plus the standard shelves
node tools/check-mode.js --all           # every loaded mode
bash tools/check.sh <id>                 # the same, on a Mac with no Node (osascript)
python3 tools/serve.py --workshop        # serve app/ with live reload, for a workshop or a demo
python3 tools/build.py                   # dist/nextbook.html, one file
python3 tools/build.py --starter         # dist/starter/, the workshop folder
```

In a browser, `app/index.html#selftest` runs the same mode checks with no tools at all.

Tests get objects from a `vm` realm, so compare them after a JSON round trip, not with `assert.deepStrictEqual`
against literals (a Search Desk lesson).

Run the checks for what you touched before you say a task is done, and paste the summary lines in your report.

## For a small or cheaper model

Most of this repo is built by models working one task at a time. These rules are for you.

1. Do **one task** from `docs/BUILD.md`. Read its "Read first" list and nothing else large. Do not work from memory of
   a document you did not open in this session.
2. Write the test with the code. Pure functions go in `core/` files as plain functions, tested in `tests/`.
3. Run the task's "Done when" checks. If a check fails, fix the code, not the check, unless the task says the
   behaviour changed.
4. If a document and the live catalogue disagree, the catalogue wins: correct the document line in place, and add a
   line to `docs/RESEARCH.md` with the URL and the date.
5. If the task is unclear or needs a decision the docs do not make, stop and write the question under "Open
   questions" at the bottom of `docs/BUILD.md`. Do not guess at a design call.
6. Never invent a catalogue field. `docs/DATA.md` lists what the library returns. Never invent a book in a fixture: use
   records from the slice or the adapter's fixtures.
7. Tick the task's box in `docs/BUILD.md` in the same commit as the work. Commit message: `T<id>: <what, and why>`.
   Small commits. Do not push.

## Words on the page

User-facing words are about grade 6: short sentences, no jargon. Say "the library's page", not "record". Say "saved in
this browser only", which is the truth about `localStorage`. Never say the app "knows you", "learns" or "recommends";
it has a list, a rule and a reason. All user-facing strings live in a `strings` table (core or the mode's own).

## Safe by construction

Text from the catalogue, a model, an imported file or a person is shown as text. Never use `innerHTML`,
`outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` anywhere in `app/`. Build elements with
`Nextbook.h()`. Modes have a longer banned list (no `document`, `window`, `fetch`, `localStorage`, `Math.random`,
`Date`, timers and more); the list is `docs/CONTRACT.md` section 5, and the check fails a mode that uses one.

## What not to do

- Do not add a dependency, a bundler, a framework or a network call to the app.
- Do not edit `app/data/*.js` by hand; regenerate it from `data/*.json` with `python3 tools/gen_data.py`.
- Do not put workshop arrangements (dates, rooms, people, the session plan) in this repo. `docs/W13.md` states the
  boundary.
- Do not build a mode from the menu (`docs/modes/`) into `app/modes/`. That is the participants' work. The briefs are
  the spec; the reference builds in `reference/modes/` are for the projector.
