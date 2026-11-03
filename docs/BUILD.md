# Build plan

Written 2026-11-03 for implementing agents (Sonnet, Haiku or similar) working **one task per session**. Each task
says what to read, what to make, what to port from Search Desk, and a check that can fail. The design is
`ARCHITECTURE.md`; the data is `DATA.md`; the mode contract is `CONTRACT.md`.

**Target: the W13 starter, in the room on Sat Nov 7, 11:00.** The kit is published Fri Nov 6 evening, so the build is
done **Fri Nov 6, noon**, with the afternoon for the Mac walk-through and fixes. If gate 2 fails, Saturday runs on the
residency starter that already exists, and this repo becomes the Nov 26 starter instead; nobody is stranded.

## How to work (read before any task)

1. Read `AGENTS.md`, then the "Read first" list of your task. Nothing else large.
2. One task. Anything else you find goes under "Found while working", in your lane's part.
3. Pure functions get a unit test in the same commit. Node: `tests/<name>.test.js`, run with
   `node --test tests/*.test.js`. Python: `tests/test_<name>.py`, run with
   `python3 -m unittest discover -s tests -p 'test_*.py'`.
4. **Port, don't reinvent.** Where a task names a Search Desk file (`~/Documents/Projects/searchdesk/`), read it,
   keep what applies, rename `Desk` to `Nextbook`, drop what does not apply, and put one line at the top:
   `// Ported from searchdesk/<path> (MIT, same author).` Do not copy its features, only the named file.
5. End by running the task's "Done when" checks and pasting the summary lines into your report.
6. Commit per task: `T<id>: <what, and why>`, ticking the box here in the same commit. Do not push.
7. A design call the docs do not make is not yours: write it under "Open questions" and stop.

Size: **S** under an hour of agent work, **M** a session. Model: **H** is fine for Haiku-class, **S** wants
Sonnet-class (judgement on messy data or on the page's behaviour).

## Lanes

Five lanes own separate files, so several agents can work at once without touching each other's work. Run each lane
in its own worktree (`git worktree add ../nextbook-<lane> -b lane-<lane>`), and after each task rebase onto `master`
and fast-forward `master` to it. A task that needs another lane's file waits for that task's tick.

| Lane | Owns |
|---|---|
| **A, data** (Python) | `adapters/`, `data/*.json`, `data/*.schema.json`, `tools/gen_data.py`, `app/data/`, `tests/test_*.py`, `tests/fixtures/tpl/` |
| **B, core** (pure JS) | `app/core/` except `shell.js`; `tests/*.test.js`; `tests/_load.js`; `tests/fixtures/slice-small.json` |
| **C, page** | `app/index.html`, `app/core/shell.js`, `app/nextbook.css` |
| **D, tools** | `tools/` except `gen_data.py`; `.claude/commands/` |
| **E, modes** | `app/modes/`, `reference/modes/` |

## Timeline and gates

| When | Lane A | Lane B | Lane C | Lane D | Lane E |
|---|---|---|---|---|---|
| **Tue Nov 3, evening** | T0.1, then T1.0, T1.1, T1.2, **start the fetch (T1.5a)** | T2.1, T2.2, T2.3 | | | |
| **Wed Nov 4** | T1.3, T1.4, T1.5b, T1.6, T1.7 | T2.4, T2.5, T2.6, T2.7, T2.8 | T3.1 | T4.2 | |
| **Wed 18:00, gate 1** | the slice report meets T1.5b's numbers, or Saturday uses the fallback slice (D18) | | | | |
| **Thu Nov 5** | (fixes) | (fixes) | T3.2, T3.3, T3.4 | T5.1, T5.2, T5.3, T5.4, T5.5 | T4.1, then T6.1, T6.2, T6.3 |
| **Thu 18:00, gate 2** | `dist/starter/` opens, the example mode gives six with reasons, `#selftest` is green, two reference modes pass. Else Saturday runs on the residency starter. | | | | |
| **Fri Nov 6, morning** | | | T3.5 | | |
| **Fri Nov 6, afternoon** | K1–K5 (the kit, in the residency repo), T7.1 Ryan on a workshop Mac, T7.2 a first-timer, fixes, publish | | | | |

### If it slips, cut in this order

1. T5.4 live reload (the kit's `show.sh` opens the file; people press Cmd-R).
2. T5.5 `check.sh` (Node is in the workshop Mac image; `#selftest` covers the rest).
3. The "from some words" half of the model box (T3.3); event hook and news diet still work with subjects picked by
   hand.
4. T6.3, then T6.2 (keep survey: it is the facilitator's demo).
5. The real slice (T1.5): ship the fallback slice from the W13 pack (D18). The design holds; links become search
   links.

**Never cut:** the result check in T2.6 (ids exist, a reason on every pick, an empty result says why), the standard
shelves, the practice shelf's reset, the offline property, or "the shelf's titles never go in a prompt".

---

## Phase 0: ground

- [ ] **T0.1 Scaffold** (A, S, H). Read first: `AGENTS.md`, `ARCHITECTURE.md` "The picture". Port:
  `searchdesk/tests/unit/_load.js` as `tests/_load.js`.
  Make the tree in `AGENTS.md` with stub files. `app/index.html` loads, in order: `core/base.js`, `core/slice.js`,
  `core/score.js`, `core/reason.js`, `core/links.js`, `core/contract.js`, `core/seam.js`, `core/store.js`,
  `data/slice.js`, `data/tags.js`, `data/practice.js`, `modes/list.js`, `core/shell.js`. The shell loads each mode
  in `Nextbook.modes` (and its `.check.js`) with a `<script>` tag, as `searchdesk/core/desk.js` does around line 677.
  `app/nextbook.css` empty. One trivial test in `tests/scaffold.test.js`.
  *Done when:* `node --test tests/*.test.js` passes 1 test; `app/index.html` opens from `file://` with no console
  errors and shows "nextbook".

## Phase 1: data (lane A)

All Python, standard library only. Every network call goes through `adapters/tpl/fetch.py`.

- [ ] **T1.0 The fallback slice, first** (A, S, H). Read first: `ARCHITECTURE.md` "The data files", decision D18.
  `adapters/pack/pack_to_slice.py`: reads the W13 pack
  (`~/Documents/work/tpl/applied_ai_2026/events/W13-personal-library-app/seed_src/pack/books.json`) and writes
  `data/slice.json` in the slice schema: `id` is the pack id, `groupKey` is `pack:<id>`, facets come from the pack's
  `genre` (`genre:`), `themes` (`topic:`) and `audience`; `library.recordUrl` is `null`; `searchUrl` as in
  `ARCHITECTURE.md`; `idPattern` `^[a-z0-9-]+$`. Also writes `data/tags.json` (mood, pace, note) and
  `data/practice.json` (as T1.6). This gives lanes B, C and E real data on day one, and it is Saturday's safety net.
  *Done when:* the three files exist, every work has at least two facets, and the facets dictionary has labels.

- [ ] **T1.1 The polite fetcher** (A, M, S). Read first: `DATA.md` "The rules of the house" and "The four surfaces".
  `adapters/tpl/fetch.py`: `get(url) -> str`. Reads `robots.txt` once per run and refuses (raises) any path that is
  not under `/v2/search` or `/v2/browse/titles/new`, or that `robots.txt` disallows; waits the `Crawl-delay` (at
  least 120 s) between real requests; sends `User-Agent: nextbook-slice/1.0 (small catalogue slice, one request per
  crawl-delay)`; caches the body in `.cache/tpl/<sha1 of url>.html`; never refetches a cached URL unless `--refresh`.
  A cache hit makes no request and does not wait. `--dry-run` prints the URLs and the time it would take.
  *Done when:* tests (with `urllib.request.urlopen` replaced by a fake and the clock faked) show: a disallowed path
  raises; a `/v2/record/...` path raises; two uncached gets wait the delay; a cached get makes no call; the robots
  parser reads the real text saved as `tests/fixtures/tpl/robots.txt`.

- [ ] **T1.2 Parse a page, and the fixtures** (A, S, H). Read first: `DATA.md` "The record, field by field".
  `adapters/tpl/parse.py`: `briefs(html) -> list[dict]`, the `briefInfo` of every bib, with `description`, `jacket`
  and `rating` **removed** here so they never travel further. Fetch one real page (`le guin`) through `fetch.py` and
  write `tests/fixtures/tpl/briefs-le-guin.json`.
  *Done when:* the fixture has 63 entries and 20 `groupKey`s (or the live numbers, corrected in `RESEARCH.md`);
  `grep -c description tests/fixtures/tpl/*.json` prints 0 for each file; a test parses a tiny hand-made page.

- [ ] **T1.5a Start the real fetch, tonight** (A, S, H). Write `adapters/tpl/queries.json`: one query per pack book
  (`"<title> <author>"`), plus `canadian history`, `cooking`, `gardening`, `poetry`, `graphic novels`,
  `climate change`, `toronto`, `mystery`, `memoir`, `astronomy`, `music`, `indigenous`, `romance`, `philosophy`.
  `adapters/tpl/fetch_all.py --queries adapters/tpl/queries.json` fetches page 1 of each into the cache, nothing
  else. Run it in the background (about 90 minutes). It parses nothing, so the normaliser can be written while it
  runs, and re-run on the cache as often as needed with no network.
  *Done when:* the cache holds one page per query, and the run's log lists each URL with its size.

- [ ] **T1.3 The normaliser** (A, M, S). Read first: `DATA.md` "From headings to facets", all of it.
  `adapters/tpl/normalise.py` and `adapters/tpl/config.json` (form subdivisions, genre words, Dewey hundreds labels,
  fiction shelf words). One pure function per rule 1 to 7, plus `facets_for(brief) -> set`, `slug()`,
  `author_display("Le Guin, Ursula K., 1929-2018") -> "Ursula K. Le Guin"`, `author_key()`.
  *Done when:* one test per rule, from headings in the fixture ("Wizards Juvenile fiction." gives `topic:wizards`;
  "FICTION / Science Fiction / Action & Adventure bisacsh" gives `bisac:science-fiction`; "SCIENCE FICTION LEG" gives
  `section:science-fiction`; "813.54 L2453.109" gives `section:800`; "Kimmerer, Robin Wall, 1953-" gives nothing; a
  ` fast` heading gives nothing; `Fiction` alone gives nothing); and `facets_for` over the fixture prints a table a
  person can read.

- [ ] **T1.4 The slice builder** (A, M, S). Read first: `ARCHITECTURE.md` "`slice.json`", `DATA.md` rules 8 and 9.
  `adapters/tpl/build_slice.py --queries adapters/tpl/queries.json --out data/slice.json`, reading **only the cache**
  (`--offline <fixture.json>` for tests). Keep `BK`, `LPRINT`, `EBOOK`, `EAUDIOBOOK`; merge bibs by `groupKey`;
  choose the record id by format preference; drop singleton facets; build the `facets` dictionary; write `library`,
  `fetched`, `sources`. `data/slice.schema.json` and a small hand-written validator (required keys and types; no
  `description`, `jacket` or `rating` anywhere). Print the report from `DATA.md`.
  *Done when:* `--offline` on the fixture writes a valid slice of 20 works with no singleton facets; tests cover the
  merge, the format preference and the validator; `grep -c '"description"' data/slice.json` prints 0.

- [ ] **T1.5b Build the real slice** (A, S, H). Run `build_slice.py` on the cache. Commit `data/slice.json`. Copy the
  report into `RESEARCH.md` with the date. Spot-check three ids by opening `library.recordUrl` in a browser.
  *Done when:* at least 400 works, a median of at least 4 facets per work, at least 70 % of works with 3 or more
  facets, at least 12 sections. If not, add queries, fetch only the new ones, rebuild, and write down what changed.
  **Gate 1** is this task: if it is not done by Wed 18:00, the fallback slice is Saturday's, and this lands later.

- [ ] **T1.6 Tags and the practice shelf, on the real slice** (A, S, H). Read first: `ARCHITECTURE.md` "`tags.json`"
  and "`practice.json`". `adapters/tpl/pack_to_data.py`: match each pack book to a slice work by normalised title
  and author key; write `mood`, `pace` and `note` into `data/tags.json` under the work's `groupKey`; write
  `data/practice.json` with about twelve matched books (four loved, three liked, one ok, one not-for-me, one stopped,
  one reading, one want). Print the books that did not match.
  *Done when:* at least 25 of the 30 match; the unmatched are named in the commit message; the notes are the pack's
  words unchanged.

- [ ] **T1.7 Data for the browser** (A, S, H). `tools/gen_data.py` writes `app/data/<name>.js` for `slice`, `tags`
  and `practice` as `Nextbook.data.put('<name>', <json>);`, with `<`, `>` and `&` escaped as `<` and so on, so
  no text can end the script (the residency kit's `build_app.py` `safe()` does exactly this). `--check` exits
  non-zero if a generated file is stale. Run it after T1.0 too.
  *Done when:* `--check` passes after a run and fails after editing `data/tags.json`; a test shows a title
  containing `</script>` survives.

## Phase 2: the core (lane B, pure, tested in Node)

Classic scripts that add to `window.Nextbook`. Nothing here touches the page. Until T1.7 lands, test against
`tests/fixtures/slice-small.json` (ten works copied from the fallback slice).

- [ ] **T2.1 Base** (B, S, H). Port: `searchdesk/core/h.js` and `searchdesk/core/strings.js`.
  `core/base.js`: the `Nextbook` namespace; `h(tag, attrs, ...children)` (text and attributes only, the link rules
  kept); `norm(text)` (lower case, strip accents and punctuation, collapse spaces, drop a leading the/a/an);
  `data.put(name, value)` and `data.get(name)` (from `put`, else a `#nb-<name>` JSON block parsed in `try`/`catch`,
  else `null`); the core `strings` table and `t(key, vars)`.
  *Done when:* tests for `h` (text-only children, `javascript:` links dropped), `norm`, `t`, and `data.get` with a
  good block, a broken block (`null`, no throw) and no block.

- [ ] **T2.2 Slice** (B, S, H). `core/slice.js`: `load()` joins slice and tags (tags become `mood:`/`pace:` facets
  with labels "quiet books", "a slow pace"), indexes by `id` and `groupKey`; `match(title, author)` for typed books;
  `search(text)` over title and author for the add box; `sections()`; `labelOf()`. A missing slice gives
  `{ok: false, message}` with a plain sentence.
  *Done when:* tests on `slice-small.json`.

- [ ] **T2.3 Scoring** (B, M, S). Read first: `ARCHITECTURE.md` "Weights" and "The scoring core". Reuse the shape of
  `profile`/`scoreAgainst` in the residency kit's `seed_src/app/discovery.js`, with the changes the architecture
  names (square-root normalisation, parts kept, kind weights). `core/score.js`: `weightOf(entry)`,
  `profile(entries)`, `score(work, profile)`, `similar(a, b)`, `kindWeight`.
  *Done when:* tests: loved weighs 3; not-for-me is negative; want is 0; a typed book adds nothing; more facets do not
  win on count alone; ties keep `id` order; `similar` is symmetric.

- [ ] **T2.4 Reasons** (B, S, H). Read first: `ARCHITECTURE.md` "Reasons". `core/reason.js`: `reason(parts, opts)`,
  `isReason(text)`.
  *Done when:* a test per sentence shape in `ARCHITECTURE.md`; `isReason` rejects `""`, `"A small match."` and 201
  characters.

- [ ] **T2.5 Links** (B, S, H). `core/links.js`: `linkFor(entryOrWork, library)`: record URL for a work when
  `recordUrl` is set, otherwise the search URL with title and author (`encodeURIComponent`, spaces as `+`).
  *Done when:* tests for a work, a typed book, a fallback-slice work, and a title with `&` and `#`;
  `grep -r bibliocommons app/core app/modes` finds nothing.

- [ ] **T2.6 The contract** (B, M, S). Read first: `CONTRACT.md`, all of it. Port: `searchdesk/core/contract.js`
  (the scan, `strip`, `scanFeature`, `same`, `runCheck`, `check`), with the banned list from `CONTRACT.md` section 5.
  Add: `Nextbook.mode(def)` (register; a repeat id warns and replaces); `validate(result, ctx, def)` returning
  `{picks, dropped: [{id, why}], error}`; `makeCtx(slice, shelf, others, seed)` with everything in `CONTRACT.md`
  section 4; a seeded `random()` (mulberry32); the six standard shelves; `runModeChecks(id)` that runs the scan, the
  mode's check and the standard shelves, with defaults for every input kind.
  *Done when:* tests: an unknown id is dropped and named; a missing `why` is dropped; a seventh pick is dropped; a
  shelf book is dropped unless `allowShelf`; an empty result with no note is an error; the scan catches every banned
  word inside a function and ignores it in a comment; the same seed gives the same sequence.

- [ ] **T2.7 The model seam** (B, M, S). Read first: `ARCHITECTURE.md` "The model seam". Port the tolerant parsing
  ideas (code fences, bullets, JSON or lines) from `searchdesk/core/reply.js`; not its recipes. `core/seam.js`:
  `finalistsPrompt(result, profile, works)`, `parseFinalists(answer, result, idPattern)`, `labelsPrompt(text,
  facets)`, `parseLabels(answer, facets)`.
  *Done when:* tests: the prompt holds the six ids and no shelf title; one good id plus one invented keeps one and
  names the other; a fenced, JSON or bulleted answer parses; no valid id says so; a title in the answer is ignored;
  `parseLabels` keeps only labels in the list, matched by `norm()`.

- [ ] **T2.8 The store** (B, M, S). Read first: `ARCHITECTURE.md` "The shelf". Port the merge rule and its report
  from `searchdesk/core/merge.js` (newer `updated` wins; on a tie, the one here stays). `core/store.js`, with storage
  passed in (tests use a plain object): two shelves; `add`, `update`, `remove`; `practiceReset()`; `exportShelf()`;
  `importShelf(text)` with a `{added, changed, kept, skipped}` report; remembered inputs per mode. A file that is not
  a shelf is refused with a sentence.
  *Done when:* tests: practice reset leaves the own shelf untouched; export then import round-trips; newer wins; a tie
  keeps ours; a broken file is refused, not thrown.

## Phase 3: the page (lane C)

Checked by opening the page. Each task says what to click. All words go in the strings table, about grade 6. Put a
`data-test` name on every control a later browser test would press, and list them in `tests/DATA-TEST.md`.

- [ ] **T3.1 The shelf screen** (C, M, S). Needs T2.1, T2.2, T2.8 (stub them if they are not ticked yet).
  `core/shell.js` and `nextbook.css`: the hash router (`#find` default, `#shelf`, `#selftest`); the practice banner
  ("Practice shelf. Try anything. Reset puts it back.") with the switch and a reset that asks first; "Add a book"
  that searches the slice by title or author as you type, with "Not in the list? Add it by name"; the list with state
  and rating controls; remove; export and import with the report in words.
  *Click:* add from the list; add a typed one; rate; reload (kept); switch to own (empty), add one, switch back, reset
  practice, switch to own (still there); export, clear, import (back); break `app/data/slice.js` on purpose (a
  sentence, not a blank page).

- [ ] **T3.2 The find screen** (C, M, S). Needs T2.6. Mode cards from `Nextbook.modes` only; a card for a mode that
  did not load; the chosen mode's inputs (every kind in `CONTRACT.md` section 4), remembered; the result as cards
  (`list`) or an ordered path (`path`, with `step` words), grouped by `group` when present; on each card the title,
  author, year, formats in words, the reason, our note if any, the library link, "Want to read" and "Read it"; the
  dropped-picks notice; the note; "Shuffle"; and one line under the results: "Holds, copies and the library's own
  suggestions are on the library's page." The slice's `fetched` date in the footer.
  *Click:* with the example mode, the practice shelf gives picks with reasons; "Want to read" moves the six; the own
  empty shelf shows the mode's note; a typed book's link opens the library's search.

- [ ] **T3.3 The model box** (C, S, S). Needs T2.7. Under any result: "Want a second opinion? Copy this into any AI
  chat." A copy button, a paste box, and the checked answer as two highlighted cards with the model's sentence marked
  as the model's. The same box as "From some words" inside a `facets` input.
  *Click:* paste an answer with an invented id (named as dropped); paste nonsense (says so); never touch it (the app
  is complete).

- [ ] **T3.4 The self-test screen** (C, S, H). Port the screen's shape from `searchdesk/core/selftest.js`. `#selftest`:
  data status with counts and the slice's `fetched` date; a Run button that calls `runModeChecks` for every loaded
  mode and prints passes and failures in plain words.
  *Click:* green with the example mode; break its check on purpose and see it fail by name.

- [ ] **T3.5 Words, keyboard and phone** (C, S, S). Every control reachable by keyboard with a visible focus; no
  sideways scroll at 360 px; dark mode via `prefers-color-scheme`; every string read once for grade 6 and for claims
  the app cannot make ("recommends", "knows you", "learns").
  *Done when:* the commit message lists what changed and says it was checked at 360 px and 1280 px, light and dark.

## Phase 4: the example and the checks

- [ ] **T4.1 The example mode** (E, S, H). Needs T2.6. Copy `more-by` from `CONTRACT.md` into
  `app/modes/more-by.js`, its check into `app/modes/more-by.check.js`, and list it in `app/modes/list.js`.
  *Done when:* `node tools/check-mode.js more-by` passes (once T4.2 lands) and `#selftest` is green.

- [ ] **T4.2 The command-line check** (D, S, S). Needs T2.6. Port: `searchdesk/checks/run.js` as
  `tools/check-mode.js` (keep its Node-or-osascript host split), loading the pure core files, the mode, its check,
  and the real `app/data/` files, then `runModeChecks`. `--all` runs every id in `app/modes/list.js`; `--dir` points
  at `reference/modes/`. It also scans the whole mode file's source, not only its functions.
  *Done when:* `more-by` passes; a copy with `innerHTML` fails by name; a copy that returns no picks and no note fails
  by name; exit codes 0, 1 and 2 as in Search Desk.

## Phase 5: packing and the workshop tools (lane D)

- [ ] **T5.1 One file** (D, M, S). Port: `searchdesk/tools/build.py` (its `inline()` and escaping). `tools/build.py`:
  reads `app/index.html`, inlines every local script and stylesheet in order, turns the data scripts into
  `<script type="application/json" id="nb-<name>">` blocks, writes `dist/nextbook.html`. Fails if a `src` or `href`
  points off the folder.
  *Done when:* the file opens from `file://` with the network off and passes `#selftest`; a test asserts the output
  holds no `http` outside the slice's `library` templates and `sources`.

- [ ] **T5.2 The starter folder** (D, S, H). `tools/build.py --starter` writes `dist/starter/`: `app/` (only the
  example mode listed), `docs/CONTRACT.md`, `docs/modes/`, `tools/check-mode.js`, `tools/check.sh`, `tools/build.py`
  (so a participant can make their own one-file take-home), `tools/serve.py`, `.claude/commands/`, `LICENSE`, and a
  short `README.md`. Not `reference/`, `adapters/`, `research/`, `tests/` or `docs/BUILD.md`.
  *Done when:* inside `dist/starter/`, `node tools/check-mode.js --all` passes, `python3 tools/build.py` makes a
  working one-file copy, and `grep -rl reference dist/starter` finds nothing.

- [ ] **T5.3 The demo file** (D, S, H). `tools/build.py --demo` writes `dist/demo.html`: the one file with the
  reference modes loaded too. For the projector and the connection-drop fallback.
  *Done when:* the reference modes show and `#selftest` is green.

- [ ] **T5.4 Live reload** (D, M, S). Port: `searchdesk/tools/serve.py`, only its serving, reload and `.dev-go`
  parts, not the mirror or the inbox. Fix two bugs Search Desk recorded while porting: inject the workshop line
  inside a `<script>` tag, and keep a `.dev-go` note until a page reports it was shown, not until the first request.
  *Done when:* saving `app/modes/more-by.js` reloads an open tab; writing `find` to `.dev-go` moves it to `#find`.

- [ ] **T5.5 Commands and the no-Node check** (D, S, H). Port: `searchdesk/checks/check.sh` as `tools/check.sh`, and
  `searchdesk/tools/commands/new-feature.md` and `check.md` as `tools/commands/new-mode.md` and `check.md`, copied
  into `.claude/commands/`. The new-mode command reads `AGENTS.md`, `docs/CONTRACT.md` and the chosen brief in
  `docs/modes/`, builds `app/modes/<id>.js` and its check, and ends with the check run, in plain words.
  *Done when:* `bash tools/check.sh more-by` passes on a Mac (or is marked untested on Linux under "Found while
  working"), and `/new-mode` in the Code tab starts from the contract.

## Phase 6: reference modes (lane E, never in the starter)

Built to their briefs in `reference/modes/`, with checks. They prove the contract carries each mechanism and give the
facilitator a demo. Each must be buildable in the session's 26 minutes by someone who knows the contract; if one is
not, the brief is too big, and say so.

- [ ] **T6.1 Survey** (E, S, S). `docs/modes/survey.md`. The facilitator's demo: build it first.
- [ ] **T6.2 Journey** (E, M, S). `docs/modes/journey.md`.
- [ ] **T6.3 Challenge** (E, M, S). `docs/modes/challenge.md`.

*Done when (each):* `node tools/check-mode.js --dir reference/modes <id>` passes, and a person reads the six reasons
on the practice shelf and finds each one true.

## Phase 7: the human checks (Fri Nov 6, afternoon)

- [ ] **T7.1 Ryan on a workshop Mac.** Open the starter as the kit installs it, rate three books, get six from the
  example mode, click out to the library (this is also the first check of the catalogue link in a real browser on
  that machine), build survey from its brief with the agent in the Code tab, check the take-home build. Fixes become
  tasks under "Found while working".
- [ ] **T7.2 A first-timer.** Someone who has never seen the app opens it, rates three books, gets six and clicks out
  without help.

## The kit (residency repo, not this repo)

Listed here so the order is visible. The work and its words live in
`~/Documents/work/tpl/applied_ai_2026/events/W13-personal-library-app/`; this repo never holds them.

- [ ] **K1** `assemble.py` takes the app from `nextbook/dist/starter/` instead of `seed_src/assets/app/`.
- [ ] **K2** The kit's `AGENTS.md`: "Where things go" and "The data" rewritten for the new layout (a mode is
  `app/modes/<id>.js` plus its check, the contract is `docs/CONTRACT.md`, the menu is `docs/modes/`, run the check
  after every change). The loop, the tone and the "what not to do" sections stay.
- [ ] **K3** `menu.md` replaced by `docs/modes/README.md` from the starter; the projected menu is that list, shuffled.
- [ ] **K4** `show.sh` runs `python3 tools/serve.py --workshop` if T5.4 landed, else opens the file as now.
  `check_set.py` checks the new paths. Ryan's laptop gets `dist/demo.html`.
- [ ] **K5** Publish the set (`publish_payload.py --push`). **Needs Ryan's go.**

---

## P1, after Saturday

- [ ] **T8.1 Events snapshot.** Port the kit's `fetch_events.py` to `adapters/tpl/events.py`, write
  `data/events.json` with a `fetched` date, an `#events` screen, `ctx.events` for modes, and a "Books for this event"
  button for event hook.
- [ ] **T8.2 Hosted copy.** `dist/nextbook.html` on a static host, with zero requests beyond the file.
- [ ] **T8.3 Open Library fallback.** Off by default; says what it will send; caches in the browser.
- [ ] **T8.4 Browser tests.** Playwright, development only, using the `data-test` names.
- [ ] **T8.5 Paste packets.** Search Desk's `kit.py` idea: each mode brief as one text a browser chat can take, for a
  machine with no agent.
- [ ] **T8.6 Refresh the slice.** Rerun T1.5 with `--refresh`, diff the report, note what moved.

## Open questions

Write here; do not guess. Each one is Ryan's to answer.

1. Product name and domain (D11).

## Found while working

### Lane A
### Lane B
### Lane C
### Lane D
### Lane E
### The walk-through
