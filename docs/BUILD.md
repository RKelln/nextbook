# Build plan

For a builder — a person, or an agent working one task at a time. Each task says what to read, what to make,
what to port, and a check that can fail. The design is `ARCHITECTURE.md`; the data is `DATA.md`; the mode contract is
`CONTRACT.md`. Rewritten 2026-11-03 after the design review: a dependency order instead of a calendar, the human
checks at the front, and a priority order instead of a cut list.

**Target:** a starter a beginner can open on a shared library machine with nothing installed, and a contract they
can build against. There is no fallback to an earlier starter (D21). If time runs short, stop at a line in the
priority order and say what was left.

**Where it lives:** `github.com/RKelln/nextbook` (branch `main`), published at `nextbook.ryankelln.com` (D22).

**What the app starts with (D28):** the reading pack, turned into the slice by T1.0. There is no batch catalogue
slice for now. Real catalogue records arrive when a person asks their agent to find books (T1.8).

## How to work

1. Read `AGENTS.md`, then the "Read first" list of the task. Nothing else large.
2. One task per commit: `T<id>: <what, and why>`, with its box ticked in the same commit. Do not push.
3. Pure functions get a unit test in the same commit. Node: `tests/<name>.test.js`, run with
   `node --test tests/*.test.js`. Python: `tests/test_<name>.py`, run with
   `python3 -m unittest discover -s tests -p 'test_*.py'`.
4. **Port, don't reinvent.** "Port:" names a file and the public repo it is in; `searchdesk/...` is
   [github.com/RKelln/searchdesk](https://github.com/RKelln/searchdesk). Read the file, keep what applies, rename
   `Desk` to `Nextbook`, and put one line at the top: `// Ported from <repo>/<path> (MIT, same author).` Port the
   named file only, never its features. Where a file named here is not public, take the pattern and say so in the
   file's header; never make a reader of this repo depend on something they cannot see.
5. Run the task's "Done when" checks and paste the summary lines in the commit body.
6. A design call the docs do not make is not yours: write it under "Open questions" and stop that task.
7. Anything else you notice goes under "Found while working", in its lane's part.

Size: **S** under an hour, **M** a few hours. Model: **H** is fine for Haiku-class, **S** wants Sonnet-class.

## Lanes

Lanes own separate files, so parallel workers never collide. A task that needs another lane's file waits for that
task's tick. With one worker, ignore the lanes and follow the order below.

| Lane | Owns |
|---|---|
| **A, data** (Python) | `adapters/`, `data/*.json`, `data/*.schema.json`, `tools/gen_data.py`, `tools/find.py`, `app/data/`, `tests/test_*.py`, `tests/fixtures/tpl/` |
| **B, core** (pure JS) | `app/core/` except `shell.js`; `tests/*.test.js`; `tests/_load.js`; `tests/fixtures/*.json` |
| **C, page** | `app/index.html`, `app/core/shell.js`, `app/nextbook.css` |
| **D, tools** | `tools/` except `gen_data.py` and `find.py`; `tools/commands/`; `.claude/commands/`; `.github/` |
| **E, modes** | `app/modes/`, `reference/modes/` |

A kickoff for a worker:

> You are building nextbook, lane **<A–E>**. Read `AGENTS.md`, then "How to work" and "Lanes" in `docs/BUILD.md`.
> Do the next unticked task in the order below whose dependencies are ticked, and nothing else. Touch only your
> lane's files. Run its "Done when" checks, paste the summary lines in the commit body, tick its box, commit. Do not
> push. If the docs do not decide something, write it under "Open questions" and move to another task.

## Order of work

Dependencies, not dates. Anything on the same line can run in parallel.

1. **T0.1** (the scaffold everything builds on).
2. **T1.0**, **T1.1**, **T2.1**.
3. **T1.2**, **T1.3**, **T1.7**, **T2.2**, **T2.3**, **T2.4**, **T2.5**.
4. **T1.8**, **T2.6**, **T2.7**, **T2.8**, **T3.1**.
5. **T4.1**, **T4.2**, **T3.2**, **T3.3a**, **T3.4**, **T5.1**, **T5.2**, **T5.5a**.
6. **T7.1 on a clean machine, as soon as `dist/starter/` opens.** Every finding becomes a task before more features land.
7. **T6.1**, **T5.5b**, **T5.3**, **T3.3b**, **T5.4**, **T6.2**, **T6.3**, **T6.4**, **T3.5**, **T7.2**.
8. **T1.9**, **T2.9**, **T3.6** (events, last).
9. **T5.6** (the hosted copy), then the stretch, **T8.8**.
10. **T7.1 again** on the built starter, before it is handed to anyone.

## Priority order

If time runs out, everything above a line ships and everything below it waits. Never below the line: the result check
in T2.6, the standard shelves, the practice shelf and its reset, practice-only in the workshop copy, the offline
property, `check.sh`, and "the shelf's titles never go in a prompt".

1. The foundation: T0.1, T1.0, T1.7, T2.1 to T2.8, T3.1, T3.2, T3.4, T4.1, T4.2, T5.1, T5.2, T5.5a.
2. The human check, T7.1, and its fixes.
3. Survey as the facilitator's demo: T6.1, T5.3.
4. The commands for the Code tab: T5.5b.
5. Find on request: T1.2, T1.3, T1.1, T1.8.
6. The model box, finalists half: T3.3a.
7. Live reload: T5.4.
8. The model box, "from some words" half: T3.3b.
9. More reference modes and the menu timings: T6.2, T6.3, T6.4.
10. Words, keyboard, phone: T3.5. A first-timer: T7.2.
11. Events: T1.9, T2.9, T3.6.
12. The hosted copy: T5.6.
13. Stretch: the library shelf sync, T8.8.

## What the starter guarantees

Anything built on the starter — a workshop kit, another app — may rely on these, and nothing else:

- `app/index.html` opens in Chrome from `file://` with nothing installed, and works with the network off.
- The practice shelf is the default and the only shelf in a workshop copy; reset puts it back.
- `node tools/check-mode.js <id>` and `bash tools/check.sh <id>` run a mode's checks; `#selftest` does the same in
  the browser.
- A mode is `app/modes/<id>.js`, its check, one line in `app/modes/list.js`, and the person's plan in `app/PLAN.md`.
- `python3 tools/find.py "<words>"` is the only thing that reaches the network, and only when a person asks. It
  prints what it is about to send before it sends it.
- `python3 tools/build.py` makes a one-file take-home copy.
- Data in `app/data/` is generated, never hand-edited.
- `/new-mode`, `/check` and `/find-books` exist in `.claude/commands/`.

---

## Phase 0: ground

- [x] **T0.1 Scaffold** (A, S, H). Read first: `AGENTS.md`, `ARCHITECTURE.md` "The picture". Port:
  `searchdesk/tests/unit/_load.js` as `tests/_load.js`.
  Make the tree in `AGENTS.md` with stub files. `app/index.html` loads, in order: `core/base.js`, `core/slice.js`,
  `core/score.js`, `core/reason.js`, `core/links.js`, `core/contract.js`, `core/seam.js`, `core/store.js`,
  `data/slice.js`, `data/tags.js`, `data/practice.js`, `data/found.js`, `data/events.js`, `modes/list.js`,
  `core/shell.js`. A data file that is missing is fine (the page says what it lacks). The shell loads each mode in
  `Nextbook.modes` (and its `.check.js`) with a `<script>` tag, as `searchdesk/core/desk.js` does around line 677.
  `app/nextbook.css` empty. `.gitignore` gains `data/found.json` and `app/data/found.js` (a person's own searches).
  One trivial test in `tests/scaffold.test.js`.
  *Done when:* `node --test tests/*.test.js` passes 1 test; `app/index.html` opens from `file://` with no console
  errors and shows "nextbook".

## Phase 1: data (lane A)

Python, standard library only. Every network call goes through `adapters/bibliocommons/fetch.py`.

- [x] **T1.0 The starting list, from the pack** (A, M, S). Read first: `ARCHITECTURE.md` "The data files", D28,
  D29. The pack's data is the source: books, genres, themes, mood, pace and a note per book, not its code.
  `adapters/pack/pack_to_slice.py` and `adapters/pack/config.json` write `data/slice.json`, `data/tags.json`,
  `data/practice.json`, and their schemas (`data/*.schema.json`, with a small hand-written validator in
  `adapters/validate.py`: required keys and types; no `description`, `jacket` or `rating` in any book).
  - Works: `id` is the pack id, `groupKey` is `pack:<id>`, `library.recordUrl` is `null`, `searchUrl` and the rest of
    `library` as in `ARCHITECTURE.md`, `idPattern` `^[a-z0-9-]+$`.
  - Facets: `genre:` from the pack's genres, `topic:` from its themes, and **`section:` from its genre**, through a
    table in `config.json` that maps each genre to a shelf the library really has (for example `speculative` to
    `section:science-fiction`, "the science fiction shelves"; `history` to `section:900`, "the history shelves
    (900s)"; `nature` to `section:500`). Several genres may share a section.
  - `contentType` from genre through the same table (`literary`, `speculative`, `fantasy`, `mystery`, `horror`,
    `romance` are `FICTION`; `history`, `true`, `nature`, `ideas` are `NONFICTION`). `audience` from the pack
    (`either` becomes `ADULT`). `formats: []`, written out, so time-box can say "no audiobook copies in this list".
  - `tags.json`: the pack's `mood`, `pace` and `note`, unchanged, keyed by `groupKey`.
  - `practice.json`: thirteen pack books with a spread (four loved, three liked, one ok, one not-for-me, one stopped,
    one reading, one want, and one on hold, added by D42 so every standard shelf carries a hold).
  *Done when:* the validator passes all three files; every work has at least three facets including a `section:`;
  `sections()` would give at least six sections (print them); the notes are the pack's words unchanged.

- [x] **T1.1 The polite fetcher** (A, M, S). Read first: `DATA.md` "The rules of the house" and "Pacing".
  `adapters/bibliocommons/fetch.py`: `get(url, kind)` with `kind` `on-demand` or `batch`, the host built from
  `adapters/bibliocommons/libraries/tpl.json` (`subdomain`, `name`). Reads `robots.txt` once per run; refuses any
  path not under `/v2/search` or `/v2/browse/titles/new`, or that `robots.txt` disallows; paces by kind (`batch`
  waits the `Crawl-delay`, at least 120 s; `on-demand` waits at least 5 s and refuses a fourth page in one command);
  sends `User-Agent: nextbook/1.0 (+https://github.com/RKelln/nextbook)`; caches bodies in
  `.cache/tpl/<sha1 of url>.html`; a cache hit makes no request and does not wait.
  *Done when:* tests with `urlopen` and the clock faked: a disallowed path raises; a `/v2/record/...` path raises;
  two uncached batch gets wait the delay; on-demand waits 5 s and refuses a fourth page; a cached get makes no call;
  the robots parser reads the real text saved as `tests/fixtures/tpl/robots.txt`.

- [x] **T1.2 Parse a page, and the fixtures** (A, S, H). Read first: `DATA.md` "The record, field by field".
  `adapters/bibliocommons/parse.py`: `briefs(html) -> list[dict]`, the `briefInfo` of every bib, with
  `description`, `jacket` and `rating` **removed** here so they never travel further. Fetch one real page
  (`le guin`) on demand and write `tests/fixtures/tpl/briefs-le-guin.json`.
  *Done when:* the fixture has 63 entries and 20 `groupKey`s (or the live numbers, corrected in `RESEARCH.md`);
  `grep -c description tests/fixtures/tpl/*.json` prints 0 for each file; a test parses a tiny hand-made page.

- [x] **T1.3 The normaliser** (A, M, S). Read first: `DATA.md` "From headings to facets", all of it.
  `adapters/bibliocommons/normalise.py` and `adapters/bibliocommons/config.json` (form subdivisions, genre words,
  Dewey hundreds labels, fiction shelf words). One pure function per rule 1 to 8, plus `facets_for(brief) -> set`,
  `work_from(briefs) -> work` (rule 8's merge, the format preference for the record id), `slug()`,
  `author_display("Le Guin, Ursula K., 1929-2018") -> "Ursula K. Le Guin"`, `author_key()`. Section labels use the
  same words as `adapters/pack/config.json`, so a found book and a pack book on the same shelf share a section.
  *Done when:* one test per rule, from headings in the fixture ("Wizards Juvenile fiction." gives `topic:wizards`;
  "FICTION / Science Fiction / Action & Adventure bisacsh" gives `bisac:science-fiction`; "SCIENCE FICTION LEG" gives
  `section:science-fiction`; "813.54 L2453.109" gives `section:800`; "Kimmerer, Robin Wall, 1953-" gives nothing; a
  ` fast` heading gives nothing; `Fiction` alone gives nothing); `work_from` over the fixture gives 20 works.

- [x] **T1.7 Data for the browser** (A, S, H). Port: the `safe()` pattern from an earlier single-file shelf app — an element builder that never takes HTML.
  `tools/gen_data.py` writes `app/data/<name>.js` for `slice`, `tags`, `practice`, `found` and `events` (each only if
  its JSON exists) as `Nextbook.data.put('<name>', <json>);`, with every `<`, `>` and `&` written as the JSON
  escapes `\u003c`, `\u003e` and `\u0026` (six characters each: backslash, u, four hex digits), so no text can end
  the script. `--check` exits non-zero if
  a generated file is stale.
  *Done when:* `--check` passes after a run and fails after editing `data/tags.json`; a test shows a title containing
  `</script>` survives the round trip; the generated file contains no literal `<`.

- [x] **T1.8 Find on request** (A, M, S). Read first: `ARCHITECTURE.md` "`found.json`", `DATA.md` "Pacing". Needs
  T1.1 to T1.3 and T1.7. `tools/find.py "<words>"` and `tools/find.py --title "<t>" --author "<a>"`: **first prints
  the exact search it is about to send and the address**, then one on-demand search (up to 3 pages with `--pages`),
  parsed and normalised by the adapter, merged into `data/found.json` (no duplicates of earlier finds; no
  `description` anywhere), then `gen_data.py` for `found`. It prints, in plain words, how many books it added, how
  many were already known, and the three strongest subjects among them. `--clear` empties the file.
  *Done when:* tests with the fetcher faked: the query line is printed before the fake is called; a search adds works
  with facets; running it twice adds nothing; `grep -c description data/found.json` prints 0; `git check-ignore
  data/found.json` succeeds.

- [x] **T1.9 Events snapshot** (A, M, S). Last in priority. Read first: `RESEARCH.md` "TPL events feed", D30. Port:
  the pattern from an events finder built for a town hall: its feed reader, its traps, and the "ids only, checked
  against the list" guard (`RESEARCH.md` "TPL events feed" has the traps and the URLs).
  `adapters/bibliocommons/events.py --branch CL --days 21` writes `data/events.json`:
  `{fetched, branch, window, source, events: [{id, title, start, end, branch, virtual, categories, summary, url}]}`.
  `summary` is the library's own event text, tags stripped, at most 300 characters; there is no field named
  `description`. Batch pacing, cached.
  *Done when:* tests on a saved feed page: dates in local time, cancelled events dropped, a wrong branch code says it
  found nothing rather than writing an empty snapshot.

## Phase 2: the core (lane B, pure, tested in Node)

Classic scripts that add to `window.Nextbook`. Nothing here touches the page. Until T1.7 lands, test against
`tests/fixtures/slice-small.json` (ten works copied from T1.0's output, or hand-made in its shape).

- [x] **T2.1 Base** (B, S, H). Port: `searchdesk/core/h.js`, `searchdesk/core/strings.js`.
  `core/base.js`: the `Nextbook` namespace; `h(tag, attrs, ...children)` (text and attributes only, the link rules
  kept); `norm(text)` (lower case, strip accents and punctuation, collapse spaces, drop a leading the/a/an);
  `data.put(name, value)` and `data.get(name)` (from `put`, else a `#nb-<name>` JSON block parsed in `try`/`catch`,
  else `null`); the core `strings` table and `t(key, vars)`; `workshop()`, true when `data.get('workshop')` is set.
  *Done when:* tests for `h` (text-only children, `javascript:` links dropped), `norm`, `t`, and `data.get` with a
  good block, a broken block (`null`, no throw) and no block.

- [x] **T2.2 The pool** (B, M, S). Read first: `ARCHITECTURE.md` "The data files". `core/slice.js`: `load()` joins
  slice, tags and found:
  - tags become `mood:`/`pace:` facets with labels ("quiet books", "a slow pace");
  - **a found work that matches a slice work** (same `norm(title)` and `authorKey`) enriches it rather than
    duplicating it: facets are joined, and `recordId`, `formats`, `callNumber` and `contentType` are taken from the
    record; a found work with no match joins the pool marked `found`;
  - indexes by `id` and `groupKey`; `match(title, author)` for typed books; `search(text)` for the add box;
    `sections()`; `labelOf()`. A missing slice gives `{ok: false, message}` with a plain sentence.
  *Done when:* tests: a `found` fixture adds two new works and enriches one existing work; **a typed book whose title
  and author match a work gets that work's `groupKey` and moves the profile**; `sections()` on the pack gives
  sections.

- [x] **T2.3 Scoring** (B, M, S). Read first: `ARCHITECTURE.md` "Weights" and "The scoring core". Port the shape of
  the `profile`/`scoreAgainst` shape from an earlier single-file shelf app, with the changes the architecture names
  (square-root normalisation, parts kept, kind weights). `core/score.js`: `weightOf(entry)`, `profile(entries)`,
  `score(work, profile)`, `similar(a, b)`, `kindWeight`.
  *Done when:* tests: loved weighs 3; not-for-me is negative; want is 0; a typed book with no match adds nothing; more
  facets do not win on count alone; ties keep `id` order; `similar` is symmetric.

- [x] **T2.4 Reasons** (B, S, H). Read first: `ARCHITECTURE.md` "Reasons". `core/reason.js`: `reason(parts, opts)`,
  `isReason(text)`, and `factsClause(parts)`, the same evidence in words that name **no shelf book** ("matches books
  about wizards and science fiction"), for prompts.
  *Done when:* a test per sentence shape in `ARCHITECTURE.md`; `isReason` rejects `""`, `"A small match."` and 201
  characters; `factsClause` on parts whose evidence is a shelf book contains no shelf title.

- [x] **T2.5 Links** (B, S, H). `core/links.js`: `linkFor(entryOrWork, library)`: the record URL when the work has a
  `recordId` (or an `id` and `library.recordUrl` is set), otherwise the search URL with title and author
  (`encodeURIComponent`, spaces as `+`).
  *Done when:* tests for a pack work, a pack work enriched by a find, a found work, a typed book, and a title with
  `&` and `#`; `grep -rn 'bibliocommons.com' app/core app/modes` finds nothing (naming the platform in a comment is fine).

- [x] **T2.6 The contract** (B, M, S). Read first: `CONTRACT.md`, all of it. Port: `searchdesk/core/contract.js` (the
  scan, `strip`, `scanFeature`, `same`, `runCheck`, `check`), changed as `CONTRACT.md` section 5 says: comments **and
  the contents of quoted strings** are stripped before matching, and the banned list matches call-shaped tokens
  (`fetch(`, `document.`, `window.`, `localStorage`, `Math.random(`, `new Date`, `Date.now(`, `setTimeout(`,
  `setInterval(`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval(`, `new Function`, `XMLHttpRequest`,
  `import(`). A failure names the word, the function and the line, and says what to do instead.
  Add: `Nextbook.mode(def)` (register; a repeat id warns and replaces); `validate(result, ctx, def)` returning
  `{picks, dropped: [{id, why}], error}` (a `path` pick with no `step` gets "Step 1", "Step 2", ...);
  `makeCtx({pool, shelf, others, events, seed})` with everything in `CONTRACT.md` section 4; a seeded `random()`
  (mulberry32); the **seven** standard shelves; `runModeChecks(id)` that runs the scan, the mode's check and the
  standard shelves, with defaults for every input kind, and the same seed for shelves 5 and 6.
  *Done when:* tests: an unknown id is dropped and named; a missing `why` is dropped; a seventh pick is dropped; a
  shelf book is dropped unless `allowShelf`; an empty result with no note is an error; a path with no steps gets
  labels; the scan catches each banned token in code, **ignores "could not fetch" inside a string** and ignores a
  comment; the same seed gives the same sequence.

- [x] **T2.7 The model seam** (B, M, S). Read first: `ARCHITECTURE.md` "The model seam". Port the tolerant parsing
  (code fences, bullets, JSON or lines) from `searchdesk/core/reply.js`; not its recipes. `core/seam.js`:
  `finalistsPrompt(result, profile, pool)`, `parseFinalists(answer, result, idPattern)`, `labelsPrompt(text,
  facets)`, `parseLabels(answer, facets)`. The finalists prompt is built from each candidate's own id, title, author,
  year and facet labels, plus `factsClause()`, **never from `reason()`**, and the profile's top five facet labels.
  The finalists prompt ends with one line per candidate — "Answer with two lines. Do not change any files." for two,
  "one line" for one — and the labels prompt ends "Answer with up to four lines. Do not change any files."
  *Done when:* tests: **a result whose reason names a shelf book gives a prompt without that title**; the last line is
  as above; one good id plus one invented keeps one and names the other; a fenced, JSON or bulleted answer parses; no
  valid id says so; a title in the answer is ignored; `parseLabels` keeps only labels in the list, by `norm()`.

- [x] **T2.8 The store** (B, M, S). Read first: `ARCHITECTURE.md` "The shelf". Port the merge rule and its report
  from `searchdesk/core/merge.js` (newer `updated` wins; a tie keeps ours). `core/store.js`, storage passed in (tests
  use a plain object):
  - the own shelf (`nextbook-own-v1`), the practice shelf (`nextbook-practice-v1`), `practiceReset()`;
  - **friends' shelves** (`nextbook-others-v1`): `addOther(text, name)` appends an exported shelf under a name and
    never merges it into the person's own; `removeOther(name)`; a second file with the same name replaces the first;
  - `exportShelf()`; `importShelf(text)` into the shelf in use, with a `{added, changed, kept, skipped}` report;
  - per mode: the last inputs and the shuffle seed (so blind date survives a reload and changes only on "Shuffle");
  - **storage that throws or is missing** (some browsers on `file://`, private windows): fall back to memory and set
    `persistent: false`, so the page can say "This browser is not saving. Export before you close it."
  *Done when:* tests: practice reset leaves the own shelf and friends' shelves untouched; a friend's file never
  changes the own shelf; export then import round-trips; newer wins; a tie keeps ours; a broken file is refused, not
  thrown; unknown keys on an entry survive; a storage object that throws on every call still works, in memory.

- [x] **T2.9 Events in the core** (B, S, H). Last in priority; needs T1.9. `ctx.events` (the snapshot's events, or
  `[]`) and `ctx.eventsFetched` (its date). The event-hook mode reads them.
  *Done when:* tests with a two-event fixture.

## Phase 3: the page (lane C)

Checked by opening the page. Each task says what to click. All words go in the strings table, about grade 6. Put a
`data-test` name on every control a later browser test would press, and list them in `tests/DATA-TEST.md`.

- [x] **T3.1 The shelf screen** (C, M, S). Needs T2.1, T2.2, T2.8. `core/shell.js` and `nextbook.css`: the hash
  router (`#find` default, `#shelf`, `#selftest`); the practice banner ("Practice shelf. Try anything. Reset puts it
  back.") with a reset that asks first; the switch to the own shelf, **except in a workshop copy**, where it says
  "On this computer, use the practice shelf. Your own books go in at home, on your own computer."; "Add a book" that
  searches the list by title or author as you type, with "Not in the list? Add it by name"; the list with state and
  rating controls; remove; export and import with the report in words; **"Add a friend's shelf"** (choose their
  exported file, give it a name; listed with remove) kept apart from import; the not-saving sentence when the store
  says `persistent: false`; "Your helper found N books for '<words>'" with Clear, when there are found books.
  *Click:* add from the list; type a book that **is** in the list (it links, and shows its subjects); type one that is
  not; rate; reload (kept); reset practice (the own shelf and friends untouched); export, clear, import (back); add the
  export as a friend's shelf (the own shelf unchanged); block storage in the browser (the sentence, not a blank page);
  break `app/data/slice.js` on purpose (a sentence, not a blank page); the same page with `workshop` data set (no own
  shelf, the sentence instead).

- [x] **T3.2 The find screen** (C, M, S). Needs T2.6. Mode cards from `Nextbook.modes` only; a card for a mode that
  did not load; the chosen mode's inputs (every kind in `CONTRACT.md` section 4), remembered; the result as cards
  (`list`) or an ordered path (`path`, with `step` words), grouped by `group` when present; on each card the title,
  author, year, formats in words, the reason, our note if any, "found for '<words>'" if it was found, the library
  link, "Want to read" and "Read it"; the dropped-picks notice; the note; "Shuffle"; and one line under the results:
  "Holds, copies, your library shelves and the library's own suggestions are on the library's page."
  *Click:* with the example mode, the practice shelf gives picks with reasons; "Want to read" moves the six; an empty
  shelf shows the mode's note; a typed book's link opens the library's search.

- [x] **T3.3a The model box: second opinion** (C, S, S). Needs T2.7. Under any result: "Want a second opinion? Copy
  this into any AI chat." Copy, paste box, and the checked answer as two highlighted cards, the model's sentence
  marked as the model's.
  *Click:* paste an answer with an invented id (named as dropped); paste nonsense (says so); never touch it (the app is
  complete).

- [x] **T3.3b The model box: from some words** (C, S, S). The same box inside a `facets` input: paste words, copy
  the prompt, paste the answer, see the kept subjects and the dropped ones named.
  *Click:* an answer with one real subject and one invented keeps one and names the other.

- [x] **T3.4 The self-test screen** (C, S, H). Port the screen's shape from `searchdesk/core/selftest.js`.
  `#selftest`: data status with counts and dates; a Run button that calls `runModeChecks` for every loaded mode and
  prints passes and failures in plain words; whether the browser is saving.
  *Click:* green with the example mode; break its check on purpose and see it fail by name.

- [x] **T3.5 Words, keyboard and phone** (C, S, S). Every control reachable by keyboard with a visible focus; no
  sideways scroll at 360 px; dark mode via `prefers-color-scheme`; every string read once for grade 6 and for claims
  the app cannot make ("recommends", "knows you", "learns").
  *Done when:* the commit message lists what changed and says it was checked at 360 px and 1280 px, light and dark.

- [x] **T3.6 The events screen** (C, S, H). Last in priority; needs T2.9. `#events`: the snapshot's events with date,
  time, title, the summary, a link to the library's event page, and "Snapshot taken <date>. Check the library's page
  before you go."; a "Books for this event" button when the event-hook mode is loaded.

## Phase 4: the example and the checks

- [x] **T4.1 The example mode** (E, S, H). Needs T2.6. Copy `more-by` from `CONTRACT.md` into
  `app/modes/more-by.js`, its check into `app/modes/more-by.check.js`, and list it in `app/modes/list.js`.
  *Done when:* `node tools/check-mode.js more-by` passes and `#selftest` is green.

- [x] **T4.2 The command-line check** (D, S, S). Needs T2.6. Port: `searchdesk/checks/run.js` as
  `tools/check-mode.js`, keeping its Node-or-osascript host split, loading the pure core files, the mode, its check
  and the real `app/data/` files, then `runModeChecks`. The scan is the same as the browser's (functions, strings
  stripped), plus a failure for any code in the file outside the one `Nextbook.mode(...)` call. `--all` runs every id
  in `app/modes/list.js`; `--dir` points at `reference/modes/`. **A mode file that exists but is not in `list.js`
  gets a warning:** "This mode is not in app/modes/list.js, so the app will not show it."
  *Done when:* `more-by` passes; a copy with `innerHTML` in code fails by name; a copy with "could not fetch" in a
  string passes; a copy that returns no picks and no note fails by name; an unlisted copy warns; exit codes 0, 1 and 2
  as in Search Desk.

## Phase 5: packing and the workshop tools (lane D)

- [x] **T5.1 One file** (D, M, S). Port: `searchdesk/tools/build.py` (its `inline()` and escaping). `tools/build.py`:
  reads `app/index.html`, inlines every local script and stylesheet in order, turns the data scripts into
  `<script type="application/json" id="nb-<name>">` blocks, writes `dist/nextbook.html`. Includes `found` when the
  folder has one (a participant's take-home keeps what their helper found). Fails if a `src` or `href` points off the
  folder.
  *Done when:* the file opens from `file://` with the network off and passes `#selftest`; a test asserts the output
  holds no `http` outside the data's `library` templates and links.

- [x] **T5.2 The starter folder** (D, S, H). `tools/build.py --starter` writes `dist/starter/`: `app/` (only the
  example mode listed, `app/data/workshop.js` setting the workshop flag, **no `found.js`**), an empty `app/PLAN.md`
  with its headings (the mode in a sentence, the output, the rule, two ways to test it, still broken), `data/` (no
  `found.json`), `docs/CONTRACT.md`, `docs/modes/`, `tools/check-mode.js`, `tools/check.sh`, `tools/build.py`,
  `tools/serve.py`, `tools/gen_data.py`, `tools/find.py`, `adapters/bibliocommons/` (fetch, parse, normalise,
  `libraries/tpl.json`), `.claude/commands/`, `LICENSE`, and a short `README.md`. Not `reference/`, `research/`,
  `tests/`, `docs/BUILD.md` or `.cache/`.
  *Done when:* inside `dist/starter/`, `node tools/check-mode.js --all` and `bash tools/check.sh more-by` pass,
  `python3 tools/build.py` makes a working one-file copy, `grep -rl 'reference/' dist/starter/app` finds nothing, and
  `ls dist/starter/data/found.json` finds nothing.

- [x] **T5.3 The demo file** (D, S, H). `tools/build.py --demo` writes `dist/demo.html`: the one file with the
  reference modes loaded too. For a projector, and for a workshop if the network drops.
  *Done when:* the reference modes show and `#selftest` is green.

- [x] **T5.4 Live reload** (D, M, S). Port: `searchdesk/tools/serve.py`, only its serving, reload and `.dev-go`
  parts. **Binds `127.0.0.1` only.** Fix two bugs Search Desk recorded: inject the workshop line inside a `<script>`
  tag, and keep a `.dev-go` note until a page reports it was shown.
  *Done when:* saving `app/modes/more-by.js` reloads an open tab; writing `find` to `.dev-go` moves it to `#find`; the
  server is not reachable from another machine.

- [x] **T5.5a The no-Node check** (D, S, H). Never cut. Port: `searchdesk/checks/check.sh` as `tools/check.sh`,
  running `tools/check-mode.js` through `osascript -l JavaScript`. Bash 3.2 and BSD-safe: no associative arrays, no
  `${var,,}`, `sed -i ''`, no `grep -P`, no `timeout`, `shasum -a 256`.
  *Done when:* `bash tools/check.sh more-by` passes on a clean machine in a standard account (T7.1).

- [x] **T5.5b The commands** (D, S, H). Port: `searchdesk/tools/commands/new-feature.md` and `check.md` as
  `tools/commands/new-mode.md` and `check.md`, plus `find-books.md`, copied into `.claude/commands/`.
  - `new-mode` reads `AGENTS.md`, `docs/CONTRACT.md` and the chosen brief in `docs/modes/`; writes or updates
    `app/PLAN.md` first; builds `app/modes/<id>.js` and its check; adds the line to `list.js`; ends with the check run,
    in plain words.
  - `find-books` runs `python3 tools/find.py` with the person's words, shows them the search line before it runs, and
    then says what was added and that the page will show it.
  *Done when:* `/new-mode` in the Code tab starts from the contract and writes `app/PLAN.md`; `/find-books birds`
  adds books on a clean machine.

- [x] **T5.6 The hosted copy** (D, S, H). Port: `searchdesk/.github/workflows/pages.yml` (unit tests, mode checks,
  `python3 tools/build.py`, publish `dist/nextbook.html` as `index.html` with a `CNAME` of `nextbook.ryankelln.com`).
  The maintainer does the one-time steps: Pages source set to GitHub Actions, and the DNS record.
  *Done when:* a push to `main` publishes, and the network panel shows no request beyond the page itself.

## Phase 6: reference modes (lane E, never in the starter)

Built to their briefs in `reference/modes/`, with checks, on the pack data. They prove the contract carries each
mechanism, give the facilitator a demo, and time the briefs.

- [x] **T6.1 Survey** (E, S, S). `docs/modes/survey.md`. The facilitator's demo.
- [x] **T6.2 Journey** (E, M, S). `docs/modes/journey.md`.
- [x] **T6.3 Challenge** (E, M, S). `docs/modes/challenge.md`.

*Done when (each):* `node tools/check-mode.js --dir reference/modes <id>` passes, a person reads the six reasons on
the practice shelf and finds each one true, and the commit says how long the build took.

- [x] **T6.4 Re-time the menu** (E, S, S). From T6.1 to T6.3's times and T7.1's build, set each brief's size in
  `docs/modes/README.md` to what a beginner with an agent really needs, against a half-hour build block.
  A brief that does not fit is cut down (fewer done-when lines) or its card says so.

## Phase 7: the human checks (early, on a clean machine)

Run in a **fresh standard (non-admin) account** on a machine that is not the one you built on: a developer's own
account has tools and a newer Python, so it does not show what a library machine sees.

- [ ] **T7.1 The baseline** (a person, on a clean machine). As soon as `dist/starter/` opens, and again on a built
  starter before it is handed out. Record each line in `RESEARCH.md` with the date:
  - `node -v` in a new Terminal, nothing exported by hand;
  - `python3 --version`;
  - `bash tools/check.sh more-by`;
  - `app/index.html#selftest` in Chrome from `file://`;
  - a catalogue link from a card opens the right page;
  - `/new-mode` builds survey from its brief in the Code tab, and `/find-books birds` adds books;
  - `python3 tools/build.py` makes a take-home that opens.
  Every finding becomes a task under "Found while working" before more features land.
- [ ] **T7.2 A first-timer.** Someone who has never seen the app opens it, rates three books, gets up to six with
  reasons, and clicks out to the library without help.

## Stretch: the library shelf sync

After everything above. Not for a workshop (the import is off in a workshop copy); for anyone who takes the app home or
opens the hosted copy and already keeps shelves at the library. The hand-made test page follows the shape in
`DATA.md`, "A person's own shelf page", with a made-up user.

- [x] **T8.9d The inbox: an agent writes to the app (D36).** `app/data/inbox.js` (gitignored) holding
  `window.NEXTBOOK_INBOX = {schema: "nextbook/inbox-1", records, source: "ai", updated}`. On load the shell merges it
  once through the store's existing import, shows "Brought in 4 changes from your helper" with one Undo, and marks it
  applied in storage (keyed by the inbox's own `id`) so a reload does nothing. A record with an `updated` more than a
  day in the future is left out and named; an entry that is newer here wins, as the store's rule already says. Off in a
  workshop copy? No — the workshop's shelf is made up, and a helper writing to it is the demo. `find.py --from-shelf`
  gains `--write-inbox`, and `tools/inbox.py` is the general writer (one record, or a file), so an agent can add a
  book or set a state without a browser. Tests: applied once, Undo restores, a stale duplicate is kept-not-duplicated,
  a future date is refused, a bad schema changes nothing.

- [x] **T8.8 One-way sync from a saved library shelf.** Spec: `ARCHITECTURE.md`, "Bringing in the library's shelf".
  - [x] **T8.8a The reader** (B, S, S): `readLibraryShelf(html) -> {entries, works, complete}`, pure, taking
    `entities.shelves` and the matching `briefInfo` only (facets by the adapter's rules, ported to JS). A test asserts
    no key from `users`, `accounts` or `auth` comes out.
  - [x] **T8.8b The merge** (B, M, S): the three-way rule table, one test per row, plus partial files, editions and
    "stopped". Pure, in `core/merge.js` (named for what it does, since the readers call it too). `Nextbook.merge.plan(brought, ours, {now, practice})`, tests in `tests/merge.test.js` and an end-to-end script through the store.
  - [x] **T8.8e Read the shelf's own count (D39)** (B, S, S): the saved page says `1 to 2 of 2 items` in its header
    and footer even though the state carries no totals. Parse it from the page text, attribute it to the shelf its
    items name, mark the shelf complete when the range reaches the total, and cover `1..N` with ranges across saved
    pages when combining. A page with no such line, or a search page's `1 to 20 of 1,744 results`, leaves the shelf
    unknown. Tests: a whole shelf, a middle range, two pages with a gap, and the word `results` ignored.

  - [x] **T8.8c The screens** (C, M, S): the button, the report with one Undo, "Tidy up at the library", "Which is right?",
    "Leave it" remembered, the last-imported date, off on the practice shelf and in a workshop copy.

## What is not here

A workshop's own material — its brief, its session files, its kit — lives with the workshop and is not in this repo.
Nothing here needs it: a kit adds its own files on top of `dist/starter/` and relies only on "What the starter
guarantees", above. The original plan's rows K1 to K5 were that work, and they belong to the workshop's repo.

---

## Later

- [ ] **T8.11 The batch catalogue slice** (D28, deferred). The original slice builder: `fetch_all.py` over a query
  list at batch pace, `build_slice.py` from the cache, the report in `DATA.md`, real record ids and sections for a few
  hundred works. Needs a decision on whether a public repo carries it (`DATA.md`, "What we may and may not do").
  What it is for: a starting catalogue broad enough that a mode has something to choose from on a subject the pack
  does not carry. What it is **not** for: matching a person's imported books, which is T8.9c — a slice is built once
  from a fixed query list at the crawl delay, while a person's list is their own request and runs at a person's pace.
- [x] **T8.12 Your library account, one click away** (DESIGN.md "Holds"). Measured paths (`DATA.md`, "The library
  account's own pages") in the slice's `library` block: `account` (the sign-in template with `{path}`, and holds,
  For Later, checked out) and `recordIdUrl` (a real record id's page, so a found book links to its record and not a
  search). `core/links.js` gives `accountLink` and `holdLink`. The shelf's side column and the find screen show
  "At the library: Your holds · For Later · Checked out", each through `/user/login?destination=<path>`, with the
  sentence "You sign in there, not here: this page never sees your card or password." A pick, and a book to read on
  the shelf, that has a catalogue record gets "Sign in and hold", which lands on its own page, where Place hold is.
  A pack book has no record id, so it keeps its search link and no hold link. Never a link into the hold form, never
  a request to any of these pages, never a word about whether the person is signed in. Checked by hand
  (2026-11-04): a person already signed in goes straight through `/user/login?destination=` to the page, with no
  sign-in form, so "Sign in and hold" is right whether or not they are signed in.
- [x] **T8.13 The way back from the library** (D41). Steps with links to each library shelf, a drop box for the
  saved pages, and one note on coming back to the tab after a library link, on the own shelf only.
- [ ] **T8.10 Look further, with Open Library** (D26). For the hosted copy, where there is no agent: a "Look further"
  button under any result searches Open Library (CORS `*`, measured) by the profile's top subject words, never shelf
  titles; maps its subjects to ours by `norm()`; results join the pool as found works with library search links. Off
  by default; says what it will send before it sends it; caches in the browser.
- [ ] **T8.4 Browser tests.** Playwright, development only, using the `data-test` names.
- [x] **T8.5 Paste packets.** Search Desk's `kit.py` idea: each mode brief as one text a browser chat can take.
- [x] **T8.7 Measure a saved shelf page.** Done 2026-11-03; the answer is in `DATA.md`, "A person's own shelf page".
- [x] **T8.9 Import a Goodreads or StoryGraph export.** Matched by ISBN first, then by normalised title and author;
  unmatched rows become typed books with search links. Same merge as T8.8b.
  - [x] **T8.9a The readers** (B, M, S): `app/core/import.js`, pure: a CSV in, `{entries, works, complete, problems}` out,
    in the shape `Nextbook.merge.plan` takes. Quoted fields with commas, quotes and newlines; Goodreads wraps ISBNs as
    `="0439023483"`; StoryGraph's `did-not-finish` is our `stopped`; a star rating maps to our bucket and 0 is unrated.
    Every row that cannot be read is named, never dropped silently. Tests: one fixture per site, six rows each,
    including an unrated row, a did-not-finish row and a review with a newline in it.
  - [x] **T8.9b The screen** (C, M, S): one button on the shelf screen, the report in words with one Undo, "Not at the
    library yet" for the rows with no match, and the practice-shelf refusal it inherits from the merge. Off in a
    workshop copy, with a sentence saying why.
  - [x] **T8.9c Matching the imported books at the library** (A, M, S). **Not T8.11.** T8.11 builds breadth for the modes;
    this matches *a person's own list*, which is a different request with a different pace. Reuse `tools/find.py`:
    `--from-shelf` takes the imported rows with no record id, turns each into one keyword search (title and author, an
    ISBN when the file has one), and stops after a cap per run (40 books: about three and a half minutes at the
    on-demand pace of 5 s, `DATA.md` "Pacing"), writing back into the same cache by record id so a second run resumes.
    It prints the query before it sends it, names the titles it could not match, and never searches a title it already
    has a record for. A person asks for this; nothing runs it on a timer.

## Known limits, accepted

Found by the build's reviews, judged not worth a change now, and written down so nobody rediscovers them as a bug.

- The dev server's reload token is the files' mtime and size, so a rewrite that keeps both (rsync -t, cp -p) is
  invisible to an open tab. A false positive reloads; a false negative does not, and this is the false negative.
- A hidden tab keeps asking for the reload token every two seconds. It is loopback traffic from a dev tool; the poll
  stops when the tab closes.
- An events snapshot is labelled with its date, never blocked for age. A room that opens a copy months later sees the
  date, which is the promise `ARCHITECTURE.md` makes.
- The events feed's host is not asked for `robots.txt` on every run; the 404 is re-checked by hand (A lane, above).
- A saved shelf page's state carries no totals at all (measured 2026-11-04), so the count comes from the page's own
  words, `1 to 2 of 2 items` (D39). A page whose line is missing or not English's leaves that shelf **unknown**: the
  import says nothing about it and nothing is marked gone — the safe direction, and one the person can fix by saving
  the page that carries the line.
- No shipped work carries `series:` facets and every pack work is tagged, so journey's series sentence and
  challenge's "no mood words" count are exercised by their checks, not by the practice data.

## Open questions

- **Can holds come back in?** (2026-11-04, from D41.) Yes, since D43: a saved On Hold page goes in the same drop box,
  and the page with no holds was measured too (its words say so; its state was stale). Still open: a page of more
  than 25 holds, a status but `NOT_YET_AVAILABLE`, and Checked Out and Borrowing History (ARCHITECTURE, "Lining up
  with the library's own shelves"), not read yet.

- **Can a shelf page's state be stale too?** (2026-11-04, from D43.) A holds page saved after a change made on it
  kept the old state and showed the new words. A shelf page probably does the same: move a book on the For Later page,
  save without reloading, and the state still has it. The shelf reader trusts the state's items and uses the words
  only for the count (D39), so it would bring in the old shelf. Step 2 now says to reload first; a check like the
  holds reader's (a count line that disagrees with the state's items reads nothing) would catch some of it. Test by
  hand first: move one book, save without reloading, read the file for shape.

- **How much do you want to read it?** (2026-11-04, from D40.) The maintainer asked whether a book to read could say how
  much. It would be a new stored field (store, merge, export, the CSV and shelf readers, the contract's standard
  shelves), BiblioCommons' For Later has no such level to line up with (D20), and `score.js` gives every "want" no
  weight today. Two shapes: a plain "next up" flag a mode can read, or a weight that makes a keen want count as a
  little evidence. Not built until decided.

Write here; do not guess. Each one is the maintainer's to answer.

1. Product name (D11, D22). The domain is settled; `nextbook` is still a working name.
2. Answered 2026-11-03: `CONTRACT.md` section 4 gains an `event` input kind, and the events screen hands over the
   event itself (D35).
3. Answered 2026-11-03: titles stay in the finalists prompt because a chat needs them to curate, and any candidate
   that is on the person's shelf is dropped from the prompt by id, `groupKey`, `recordId` or normalised title (D34).

## Found while working

### Lane A

- `author_key` folds a trailing particle, because TPL files the same person twice: `Guin, Ursula K. Le` and
  `Le Guin, Ursula K., 1929-2018`. Without the fold, found Le Guin records did not enrich the pack's books; they
  duplicated them. Recorded in `RESEARCH.md` with the page and the date.
- The events feed is on another host, and that host's `robots.txt` answers 404 (2026-11-03). `DATA.md` now says the
  adapter does not ask for it and the check is by hand when the snapshot is rebuilt.
- A batch of 21 days at 25 events a page is five pages. A longer window cannot be covered, so the tool narrows or
  refuses it rather than writing a snapshot labelled with a window it did not read.
### Lane B

- `Nextbook.pool.load()` returned `{works, byId, byGroupKey, facets}` while `makeCtx` asks that object for `tagsOf`,
  `sections` and `labelOf`, so `ctx.tagsOf` was always `null` and CONTRACT.md section 4 was wrong on paper. The
  snapshot now carries the same functions the pool exposes.
- A real saved shelf page carries no shelf totals (2026-11-04), so "you saved part of it" would have been a claim
  the file cannot support — and the app would have said it on a shelf saved whole. The reader now reports those
  shelves as **unknown**, the merge stays quiet, and nothing is marked gone. A search page, which carries the same
  `entities` with results and no shelf, is refused by name instead of read as an empty shelf.
- An import row that could not be read left its shelf marked complete, so the merge could read an absent
  book as gone from the library. A dropped row now marks its shelf unfinished, and an unknown shelf word marks all
  three (D37's neighbour: a claim is only true if the data supports it).
- The check's scan is a lint, and `CONTRACT.md` section 5 now says so: a name built from pieces, a name inside a
  template interpolation and `fetch?.(` are not seen. The rule is for the accident, not for a file written around it.
### Lane C

- The shelf screen showed `Subjects: true`, because a pack genre word is also its facet label. `genre:true` now
  reads "true stories", `genre:ideas` "big ideas" and `genre:speculative` "speculative fiction"; the keys are
  unchanged. Found while clicking T3.1, fixed in the data (`adapters/pack/config.json`).
- A mode with `allowShelf` puts a shelf book into the finalists prompt; the box is closed for that shape (D33).
- The practice shelf visited every part of the library, so survey's demo could only ever show its fallback; see D33.
### Lane D

- Each build replaces only its own output (D33). Building the starter used to delete the one file and the demo.
- `--all` alone means the manifest and a missing manifest is a STOP; `--all --dir F` means every mode file in F.
  `--dir` must resolve inside the repo, and a mode id is checked on both paths.
- The dev server's page keeps the last `.dev-go` route it drew until `/__go` returns empty, which is what makes the
  same word work twice. The first version never reset it, so a second identical note was ignored for ever.
### Lane E

- survey's first build was a least-visited sampler, not a survey, because the practice shelf visited all six parts.
  With the 300s unvisited it opens on the widening pick, which is what the brief asked for.
- challenge found `ctx.tagsOf` broken and worked around it by reading the `mood:` facets; after the fix it reads our
  own words directly.
- journey can honestly be two steps: from The Dispossessed to Oryx and Crake, the goal's link beats every candidate
  at the second step, so the path stops. The brief wants a short path said plainly, not a long one invented.
### The walk-through

- [x] **T8.14 Opt-in agent shelf mirror (D44).** Port Search Desk's local mirror pattern, add a
  filtered reader and a read/write skill with the title-exposure notice. Pack the tools and skill in
  starters, never shelf data. Check default-off, request guards, snapshot validation, browser updates,
  and build exclusions.

- [x] **T8.14 documentation follow-up.** Align starter README, agent rules, design, and workshop
  integration guidance with opt-in sharing, title disclosure, separate origins, and snapshot cleanup.
