# Build plan

Written 2026-11-03 for implementing agents (Sonnet, Haiku or similar) working **one task per session**. Each task
says what to read, what to make, and a check that can fail. Do not start a task before the ones it depends on are
ticked. The design is `ARCHITECTURE.md`; the data is `DATA.md`; the mode contract is `CONTRACT.md`.

**Target:** a starter folder for the second W13 run (Thu Nov 26), cut by **Fri Nov 20** so it can be clicked through
on a workshop MacBook. The first run (Sat Nov 7) uses the residency repo's existing starter; nothing here is needed
for it. P0 is the Nov 20 cut; P1 is after.

## How to work (read before any task)

1. Read `AGENTS.md`, then the "Read first" list of your task. Nothing else large.
2. One task. If you find something else that needs doing, add it under "Found while working" at the bottom.
3. Pure functions get a unit test in the same commit. Node: `tests/<name>.test.js`, run with `node --test tests/`.
   Python: `tests/test_<name>.py`, run with `python3 -m unittest discover -s tests -p 'test_*.py'`.
4. Every task ends by running its "Done when" checks and pasting the summary lines into your report.
5. Commit per task: `T<id>: <what, and why>`, ticking the box here in the same commit. Do not push.
6. A design call the docs do not make is not yours: write it under "Open questions" and stop.

Size: **S** is under an hour of agent work, **M** is a session, **L** is split it if you can.

---

## Phase 0: ground

- [ ] **T0.1 Scaffold** (P0, S). Read first: `ARCHITECTURE.md` "The picture" and "Packing".
  Make the tree in `AGENTS.md` with stubs: `app/index.html` loading, in this order, `core/base.js`, `core/slice.js`,
  `core/score.js`, `core/reason.js`, `core/links.js`, `core/contract.js`, `core/seam.js`, `core/store.js`,
  `data/slice.js`, `data/tags.js`, `data/practice.js`, `modes/list.js`, then a loader that adds a `<script>` per id in
  `Nextbook.modes` (and its `.check.js`), then `core/shell.js`. `app/nextbook.css` empty. `tests/_load.js`: builds a
  fake `window`, runs named `app/` files in a Node `vm` context, returns `window.Nextbook`. One trivial test in
  `tests/scaffold.test.js`.
  *Done when:* `node --test tests/` passes 1 test; `app/index.html` opens from `file://` with no console errors and
  shows "nextbook" and nothing else.

## Phase 1: the adapter and the data

All Python, standard library only, in `adapters/tpl/`. Every network call goes through `fetch.py`.

- [ ] **T1.1 The polite fetcher** (P0, M). Read first: `DATA.md` "The rules of the house" and "The four surfaces".
  `adapters/tpl/fetch.py`: `get(url) -> str`. Reads `robots.txt` once per run and refuses (raises) any path that is
  not under `/v2/search` or `/v2/browse/titles/new`, or that `robots.txt` disallows; waits the `Crawl-delay` (at
  least 120 s) between real requests; sends `User-Agent: nextbook-slice/1.0 (small catalogue slice, one request per crawl-delay)` (no personal
  email in it);
  caches the body in `.cache/tpl/<sha1 of url>.html` and never refetches a cached URL unless `--refresh`. A cache hit
  makes no request and does not wait. `--dry-run` prints the URLs it would fetch and the time it would take.
  *Done when:* tests (with `urllib.request.urlopen` replaced by a fake) show: a disallowed path raises; a
  `/v2/record/...` path raises; two uncached gets sleep the delay between them (fake the clock); a cached get makes no
  call; the robots parser reads the real file's text saved as `tests/fixtures/tpl/robots.txt`.

- [ ] **T1.2 Parse a page, and the fixtures** (P0, S). Read first: `DATA.md` "The record, field by field".
  `adapters/tpl/parse.py`: `briefs(html) -> list[dict]`, the `briefInfo` of every bib in the entities block, with
  `description`, `jacket` and `rating` **removed** at this point so they never travel further. Fetch one real page
  (`le guin`) through `fetch.py`, and write `tests/fixtures/tpl/briefs-le-guin.json` from `briefs()`.
  *Done when:* the fixture has 63 entries and 20 distinct `groupKey`s (or the live numbers, recorded in `RESEARCH.md`
  if they moved); `grep -c description tests/fixtures/tpl/*.json` prints 0 for every file; a test parses a tiny
  hand-made HTML string with one entities block.

- [ ] **T1.3 The normaliser** (P0, M). Read first: `DATA.md` "From headings to facets" (all of it).
  `adapters/tpl/normalise.py` and `adapters/tpl/config.json` (form subdivisions, genre words, the Dewey hundreds
  labels, the fiction shelf words). One pure function per rule 1 to 7, plus `facets_for(brief) -> set`, plus
  `slug()`, `author_display("Le Guin, Ursula K., 1929-2018") -> "Ursula K. Le Guin"`, `author_key()`.
  *Done when:* one test per rule, using headings copied from the fixture ("Wizards Juvenile fiction." gives
  `topic:wizards`; "FICTION / Science Fiction / Action & Adventure bisacsh" gives `bisac:science-fiction`;
  "SCIENCE FICTION LEG" gives `section:science-fiction`; "813.54 L2453.109" gives `section:800`; "Kimmerer, Robin
  Wall, 1953-" gives nothing; a ` fast` heading gives nothing; `Fiction` alone gives nothing); and running
  `facets_for` over the whole fixture prints a table a person can eyeball.

- [ ] **T1.4 The slice builder** (P0, M). Read first: `ARCHITECTURE.md` "`slice.json`", `DATA.md` rules 8 and 9.
  `adapters/tpl/build_slice.py --queries adapters/tpl/queries.json --out data/slice.json`. Fetch each query's page 1
  (and page 2 if the query says so) via `fetch.py`; keep `BK`, `LPRINT`, `EBOOK`, `EAUDIOBOOK`; merge bibs by
  `groupKey` (rule 8); choose the record id by format preference; drop singleton facets (rule 9); build the `facets`
  dictionary with labels and counts; write `library`, `fetched`, `sources`. Write `data/slice.schema.json` and
  validate against it (a small hand-written validator: required keys and types, no `description`, `jacket` or
  `rating` anywhere). Print the report from `DATA.md`.
  `adapters/tpl/queries.json` starts with: one query per book in the W13 pack (`"<title> <author>"`, from
  `~/Documents/work/tpl/applied_ai_2026/events/W13-personal-library-app/seed_src/pack/books.json`), plus broad subject
  searches that reach parts of the library the pack does not: `canadian history`, `cooking`, `gardening`, `poetry`,
  `graphic novels`, `climate change`, `toronto`, `mystery`, `memoir`, `astronomy`, `music`, `indigenous`, `romance`,
  `philosophy`. The `--dry-run` line says how long it will take.
  *Done when:* a run over the fixture alone (`--offline tests/fixtures/tpl/briefs-le-guin.json`) writes a valid slice
  of 20 works with no singleton facets; tests cover the merge, the format preference and the schema check;
  `grep -c '"description"' data/slice.json` prints 0.

- [ ] **T1.5 Build the real slice** (P0, S of attention, about 1.5 hours of waiting). Run `build_slice.py` for real, in
  the background, once. Commit `data/slice.json`. Copy the report into `RESEARCH.md` with the date. Spot-check three
  record ids by opening `library.recordUrl` in a browser: title and author match.
  *Done when:* the report shows at least 400 works, a median of at least 4 facets per work, at least 70 % of works
  with 3 or more facets, and at least 12 sections. If not, add queries and rerun (the cache keeps what is done), and
  write down what changed.

- [ ] **T1.6 Tags and the practice shelf from the W13 pack** (P0, S). Read first: `ARCHITECTURE.md` "`tags.json`"
  and "`practice.json`". `adapters/tpl/pack_to_data.py`: for each pack book, find its work in the slice by normalised
  title and author key; write its `mood`, `pace` and `note` into `data/tags.json` under the work's `groupKey`; write
  `data/practice.json` with about twelve of the matched books, with a spread of states and ratings (four loved, three
  liked, one ok, one not-for-me, one stopped, one reading, one want). Print the books that did not match.
  *Done when:* at least 25 of the 30 pack books match; the unmatched are listed in the commit message; the schema
  checks pass; the notes are the pack's words unchanged.

- [ ] **T1.7 Data for the browser** (P0, S). `tools/gen_data.py` writes `app/data/<name>.js` for each of `slice`,
  `tags`, `practice` as `Nextbook.data.put('<name>', <json>);`, with `<`, `>` and `&` escaped as `<` etc. so no
  text can end the script. `--check` exits non-zero if any generated file is out of date.
  *Done when:* `python3 tools/gen_data.py --check` passes after a run and fails after editing `data/tags.json`; a test
  shows a title containing `</script>` survives the round trip.

## Phase 2: the core (pure, tested in Node)

Every file is a classic script that adds to `window.Nextbook`. Nothing in this phase touches the page.

- [ ] **T2.1 Base** (P0, S). `core/base.js`: the `Nextbook` namespace; `h(tag, attrs, ...children)` that only ever
  sets text and attributes (copy the idea of `searchdesk/core/h.js`, write it fresh); `norm(text)` (lower case, strip
  accents and punctuation, collapse spaces, drop a leading "the"/"a"/"an"); `data.put(name, value)` and
  `data.get(name)` (from `put`, else a `#nb-<name>` JSON block parsed in `try`/`catch`, else `null`); a `strings`
  table and `t(key, vars)`.
  *Done when:* tests for `norm`, `t`, and `data.get` with a good block, a broken block (returns `null`, does not
  throw) and no block.

- [ ] **T2.2 Slice** (P0, S). `core/slice.js`: `load()` joins slice and tags (tags become `mood:`/`pace:` facets with
  labels), indexes by `id` and `groupKey`, `match(title, author)` for typed books, `sections()`, `labelOf()`. If the
  slice is missing, `load()` returns `{ok: false, message}` with a plain sentence.
  *Done when:* tests against a small fixture slice in `tests/fixtures/slice-small.json` (hand-made from ten real
  works of `data/slice.json`).

- [ ] **T2.3 Scoring** (P0, M). Read first: `ARCHITECTURE.md` "Weights" and "The scoring core".
  `core/score.js`: `weightOf(entry)`, `profile(entries)`, `score(work, profile)`, `similar(a, b)`, the `kindWeight`
  table.
  *Done when:* tests show: a loved book's facets weigh 3; not-for-me is negative; want is 0; a typed book adds
  nothing; a work with more facets does not win on count alone; ties keep `id` order; `similar` is symmetric.

- [ ] **T2.4 Reasons** (P0, S). Read first: `ARCHITECTURE.md` "Reasons". `core/reason.js`: `reason(parts, opts)`, and
  `isReason(text)` (non-empty, at most 200 characters, not a stock phrase) which the contract uses.
  *Done when:* tests for each sentence shape in `ARCHITECTURE.md`, and `isReason` rejects `""`, `"A small match."`
  and a 201-character string.

- [ ] **T2.5 Links** (P0, S). `core/links.js`: `linkFor(entryOrWork, library)`. Record URL for a work, search URL for a
  typed book, `{q}` encoded with `encodeURIComponent` and spaces as `+`.
  *Done when:* tests for both, including a title with `&` and `#`; `grep -r bibliocommons app/` finds nothing outside
  `app/data/`.

- [ ] **T2.6 The contract** (P0, M). Read first: `CONTRACT.md` (all of it). `core/contract.js`: `Nextbook.mode(def)`
  (register, warn and replace on a repeat id); `validate(result, ctx, def)` returning `{picks, dropped: [{id, why}],
  error}`; `scan(source)` for the banned words in `CONTRACT.md` section 5; `makeCtx(slice, shelf, others, seed)`; the
  six standard shelves; `Nextbook.check(id, cases)` and `runChecks(id)` returning `{passed, failed: [{name,
  message}]}`; a seeded `random()` (mulberry32 or similar).
  *Done when:* tests show an unknown id is dropped and named, a missing `why` is dropped, a seventh pick is dropped, a
  shelf book is dropped unless `allowShelf`, an empty result with no note is an error, `scan` catches each banned word
  and does not flag `Nextbook.`, and the same seed gives the same sequence.

- [ ] **T2.7 The model seam** (P0, M). Read first: `ARCHITECTURE.md` "The model seam". `core/seam.js`:
  `finalistsPrompt(result, profile, works)`, `parseFinalists(answer, result, idPattern)`, `labelsPrompt(text,
  facets)`, `parseLabels(answer, facets)`.
  *Done when:* tests: the prompt contains the six ids and no shelf title; an answer with one good id and one invented
  id keeps one and names the other; an answer in a code block, in JSON, or with bullets still parses; an answer with
  no valid id says so; a title in the answer is ignored; `parseLabels` keeps only labels in the list, matching on
  `norm()`.

- [ ] **T2.8 The store** (P0, M). Read first: `ARCHITECTURE.md` "The shelf". `core/store.js`, with storage passed in
  (so tests use a plain object): two shelves, `add`, `update`, `remove`, `practiceReset()`, `exportShelf()`,
  `importShelf(text)` with the merge rule and a `{added, changed, kept, skipped}` report. A shelf file from the W13
  starter is out of scope; a file that is not a shelf is refused with a sentence.
  *Done when:* tests: practice reset leaves the own shelf untouched; export then import round-trips; newer `updated`
  wins; a broken file is refused, not thrown.

## Phase 3: the shell (the page)

Verified by opening the page. Each task lists what to click. Keep all words in the strings table, about grade 6.

- [ ] **T3.1 The shelf screen** (P0, M). `core/shell.js` and `nextbook.css`: the hash router (`#find` default,
  `#shelf`, `#selftest`), the practice banner ("Practice shelf. Try anything. Reset puts it back.") with the switch
  and the reset (which asks first), "Add a book" that searches the slice by title or author as you type and offers
  "Not in the list? Add it by name", the list with state and rating controls, remove, export and import.
  *Click:* add a book from the list; add a typed one; rate; reload (kept); switch to own (empty), add one, switch back,
  reset practice, switch to own (still there); export, clear, import (back); break `app/data/slice.js` on purpose
  (sentence, not a blank page).

- [ ] **T3.2 The find screen** (P0, M). Mode cards from `Nextbook.modes` and stub cards from `Nextbook.planned`; the
  chosen mode's inputs (every kind in `CONTRACT.md` section 4); the result drawn as cards (list) or an ordered path,
  with title, author, year, formats in words ("book, audiobook"), the reason, our note if the work has one, and the
  library link; the dropped-picks notice; the note; a "Shuffle" button that changes the seed; one line under the
  results: "Holds, copies and the library's own suggestions are on the library's page."
  *Click:* with the example mode, the practice shelf gives picks with reasons; the own empty shelf shows the mode's
  note; a typed book's link opens the library's search.

- [ ] **T3.3 The model box** (P0, S). Under any result: "Want a second opinion? Copy this into any AI chat." Copy
  button, paste box, and the checked answer shown as two highlighted cards with the model's sentence marked as the
  model's. The same box, in "From some words" mode, for `facets` inputs.
  *Click:* paste an answer with an invented id (named as dropped); paste nonsense (says so); never touch it (the app
  is complete).

- [ ] **T3.4 The self-test screen** (P0, S). `#selftest`: data load status with counts and the slice's `fetched` date;
  a Run button that runs `runChecks` for every loaded mode and prints passes and failures in plain words.
  *Click:* all green with the example mode; break the example's check on purpose and see it fail by name.

- [ ] **T3.5 Words, keyboard and phone** (P0, S). Every control reachable by keyboard with a visible focus; the page at
  360 px wide has no sideways scroll; dark mode via `prefers-color-scheme`; every string read once for grade 6 and for
  claims the app cannot make ("recommends", "knows you", "learns").
  *Done when:* the commit message lists what changed, and says it was checked at 360 px and 1280 px in light and dark.

## Phase 4: the example and the checks

- [ ] **T4.1 The example mode** (P0, S). Copy `more-by` from `CONTRACT.md` into `app/modes/more-by.js` with its check
  file, and list it in `app/modes/list.js` with every menu brief in `Nextbook.planned` (id, name, purpose from
  `docs/modes/`).
  *Done when:* the example passes in the browser self-test.

- [ ] **T4.2 The command-line check** (P0, S). `tools/check-mode.js <id>|--all`: loads core and the mode in a `vm` via
  `tests/_load.js`, runs `scan`, the mode's checks and the standard shelves against the real `data/` files, prints one
  line per check and a summary.
  *Done when:* `node tools/check-mode.js more-by` passes; a copy of the example with `innerHTML` in it fails by name;
  a copy that returns no picks and no note fails by name.

## Phase 5: packing

- [ ] **T5.1 One file** (P0, M). `tools/build.py`: reads `app/index.html`, inlines every local script and stylesheet
  in order, replaces the data scripts with `<script type="application/json" id="nb-<name>">` blocks (escaped as in
  T1.7), and writes `dist/nextbook.html`. Fails if any `src` or `href` points off the folder.
  *Done when:* the file opens from `file://` with the network off and passes `#selftest`; a test asserts the output
  contains no `http` other than inside the data block's `library` URL templates and the slice's `sources`.

- [ ] **T5.2 The starter folder** (P0, S). `tools/build.py --starter` writes `dist/starter/`: `app/` (only the example
  mode loaded), `docs/CONTRACT.md`, `docs/modes/`, `tools/check-mode.js`, `tools/gen_data.py`, `tests/_load.js`,
  `data/`, `LICENSE`, and a short `README.md` for that folder. Not `reference/`, `adapters/`, `research/`, other tests,
  or `docs/BUILD.md`.
  *Done when:* in the starter folder, `node tools/check-mode.js --all` passes and the page opens; `grep -r
  reference dist/starter` finds nothing.

- [ ] **T5.3 The demo file** (P0, S). `tools/build.py --demo` writes `dist/demo.html`: the one-file build with the
  modes in `reference/modes/` loaded too. For the projector and the connection-drop fallback, never for the room.
  *Done when:* the demo shows the reference modes and passes `#selftest`.

## Phase 6: reference modes (demos, not starter content)

Built to their briefs, in `reference/modes/`, with check files. They prove the contract can carry each mechanism and
give the facilitator a finished example. Each must be buildable inside the session's 26 minutes by someone who knows
the contract, so keep them that small; if one is not, the brief is too big, and that is worth saying.

- [ ] **T6.1 Survey** (P0, S). `docs/modes/survey.md`.
- [ ] **T6.2 Journey** (P0, M). `docs/modes/journey.md`.
- [ ] **T6.3 Challenge** (P0, M). `docs/modes/challenge.md`.

*Done when (each):* `node tools/check-mode.js` passes for it (point it at `reference/modes/` with `--dir`), and a
human reads the six reasons on the practice shelf and finds each one true.

## Phase 7: the human checks

- [ ] **T7.1 Ryan's walk-through** (P0). Ryan opens `dist/starter/app/index.html` on a workshop MacBook, rates three
  books, gets six from the example mode, clicks out to the library, builds one mode from a brief with the agent, and
  says what was wrong. Fixes become tasks below.
- [ ] **T7.2 A first-timer** (P0). Someone who has never seen the app opens it, rates three books, gets six and clicks
  out without help.

---

## P1, after the Nov 20 cut

- [ ] **T8.1 Events snapshot.** Port the residency kit's `fetch_events.py` (Ryan's; reuse is fine, say where it came
  from) to `adapters/tpl/events.py`, write `data/events.json` with a `fetched` date, an `#events` screen, and
  `ctx.events` for modes. Event hook gains a "Books for this event" button.
- [ ] **T8.2 Hosted copy.** `dist/nextbook.html` on a static host, checked in the browser's network panel for zero
  requests beyond the file.
- [ ] **T8.3 Open Library fallback.** Off by default; says what it will send; caches in the browser; maps Open Library
  subjects to slice facets by `norm()` match only.
- [ ] **T8.4 Browser tests.** Playwright, development only, for the shelf and find screens.
- [ ] **T8.5 Refresh the slice.** Rerun T1.5 with `--refresh`, diff the report, note what moved.

## Open questions

Write here; do not guess. Each one is Ryan's to answer.

1. Product name and domain (D11).
2. Whether the starter for W13.2 is `dist/starter/` as is, or the kit wraps it with its own brief (recommended: the kit
   adds its `AGENTS.md` and session files on top, and this repo never holds them).

## Found while working

(nothing yet)
