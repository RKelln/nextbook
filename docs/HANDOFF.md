# Handoff: getting the design to locked

**For:** the next design pass on nextbook.
**From:** a design review, 2026-11-03, after reading `DESIGN.md`, `ARCHITECTURE.md`, `CONTRACT.md`, `DATA.md`,
`BUILD.md`, `DECISIONS.md`, the ten mode briefs, the W13 event file, and the current W13 pack and kit.
**Status:** interim. Fold what survives into `DECISIONS.md` and the other docs, then delete this file.

`robots.txt` was re-checked today: `Crawl-delay: 120`, `/v2/search` allowed. Every Search Desk file the plan says to
port exists, including `core/contract.js`, `checks/run.js`, `checks/check.sh`, `tools/build.py`, `tools/serve.py` and
`tests/unit/_load.js`. The residency kit's `seed_src/app/discovery.js` and `build_app.py` exist too, but in the
residency repo, not in Search Desk.

## What changed since these docs were written

1. **Hermes builds this, continuously, as soon as the design is locked.** The dated lane table in `BUILD.md` is a
   calendar for five hand-run evening sessions. Most of it is now noise; the dependency order underneath it is not.
2. **A Mac mini is available for the human checks now.** The "no workshop Mac until Friday" risk is gone. So is the
   reason to leave `T7.1`/`T7.2` at the end of the plan. Test in a fresh standard (non-admin) user: the Mini's own
   account has developer tools and a newer Python, so it does not show what a workshop account sees.
3. **Everything under the residency repo is a placeholder from before this design** — the 119 KB starter, the kit, the
   event file, and probably the 30-book pack. Do not design around it and do not treat its contents as requirements.
   One question below asks which part of the pack still matters.
4. The architecture is not in question. `D13`, `D14`, `D19`, `D21`, `D26` and `D27` are working calls; the shell draws
   and checks, the mode chooses, the practice shelf is prebuilt, the batch crawls at the house pace and a person's
   search does not. The issues below are holes in the spec, not reasons to reopen the shape.

## The test this design set for itself

`ARCHITECTURE.md` opens by saying the shapes are pinned "so a task can be built without making a design call". That is
the bar for locked. The items in the next section are the places where a builder would still stop and ask.

---

## P0 — settle these before the build starts

### 1. The model prompt and the reason sentence disagree about the shelf

`ARCHITECTURE.md`, "The model seam", builds the finalists prompt from `id | title | author | year | facet labels |
the rule's reason`. The reason is allowed to name a shelf book: *"Shares the Earthsea series with A Wizard of
Earthsea, which you loved."* AGENTS.md rule 1 says the prompt carries "the six candidates and facet words, never the
shelf's titles", and `T2.7`'s done-when is "the prompt holds the six ids and no shelf title". As written, that test
fails on the design's own example reason.

This is not only a rule breach. The room's welcome copy will tell people not to type the books they have read into
Claude, and the model box will then ask them to paste a list that includes one. The copy and the app have to be able
to tell the same truth.

**Fix:** the prompt carries ids, the six candidates' own title/author/year, facet labels, and a short clause built
from facets or the author — never `reason()`. The reason stays for the person's eyes. Add a test whose input reason
names a shelf book and whose assertion is that the title is absent from the prompt.

**Also:** the prompt will be pasted into an agentic Code tab, not a chat. End both prompts with one line: "Answer with
two lines. Do not change any files."

### 2. `ctx.others` has a contract entry and no producer

`CONTRACT.md` section 4 promises `others`; `makeCtx(slice, shelf, others, seed)` takes it; swap and club-season are
written against it. Nothing else in the repo produces it: no storage key, no screen task, no standard shelf. The only
import on the shelf screen merges into the person's own shelf, so a participant trying to trade files with a neighbour
will overwrite their own shelf with the neighbour's — the most likely failure in the room and the hardest to explain.

This is also the best social beat in the session: two people export, trade, and each gets three for the other.

**Fix:** a storage key (`nextbook-others-v1`); a shelf-screen button, "Add a friend's shelf", that *appends* an
imported export to `others` and never merges into own; a name per shelf for `group`/reason sentences; a store task and
a screen task; a seventh standard shelf that includes one other shelf; a sentence for "no friend's shelf yet".

### 3. The fallback slice cannot run four of the ten briefs

`T1.0` builds `slice.json` from the pack's `genre`, `themes` and `audience` only. I checked the pack: every book has
those, plus `mood`, `pace`, `note` — and no `callNumber`, `contentType` or `formats`. So on the fallback:

- survey and blind-date get no `section:` facets, so `ctx.sections()` is empty and they return nothing. Survey is the
  recommended facilitator demo (`T6.1`, "build it first").
- challenge needs `contentType` fiction/non-fiction, which is undefined.
- time-box "listen" filters on `EAUDIOBOOK`, which is undefined.
- ladder orders by audience, and the pack is 28 adult / 2 either.

The cut list says "the design holds" if the real slice misses its numbers. It does not hold for structural modes.

**Fix, two parts.** T1.0 synthesises `section:` from the pack's genre (the same kind of shelf word the real slice
derives from `SCIENCE FICTION LEG`), infers `contentType` from genre, and writes `formats: []` explicitly so time-box
can say "no audiobook copies in this list" instead of returning nothing silently.

Then demote the fallback's role. With Hermes building immediately, the real slice is hours away, not days. The fallback
is a fixture that lets core work start, not Saturday's shipping data. Make gate 1 a question of *shape* — does the real
slice have sections and `contentType` populated? — not count. A 250-work real slice supports all ten modes; a 400-work
fallback supports six. Prefer thin real data, and fall back only if the fetch itself fails.

### 4. Is the pack still the source for mood, pace and the practice shelf?

`T1.0` and `T1.6` both build on `seed_src/pack/books.json`: the notes become `tags.json`, and twelve matched books
become `practice.json`. If the pack is placeholder, those two tasks are built on sand, and the only source of mood and
pace words goes with them.

**Ryan's call:** keep the 30 books and their hand-written notes as the source, keep the notes but replace the books, or
replace both. If both, say where `mood`, `pace` and `note` come from, because no catalogue field carries them and `D15`
forbids inventing them.

### 5. Events: in or out for Nov 7

`T8.1` puts the events snapshot in P1. The event-hook brief says fetching events is out of scope and that its seed is a
`facets` input, filled by hand or through the model box. Because a mode can only read what `ctx` gives it, there is no
cheap middle: either `ctx.events` ships before Saturday, or event-hook has no in-app seed and the person brings their
own event text.

**Ryan's call:** build the snapshot and `ctx.events` now, or drop it and accept that event-hook is a brief the room can
build but not seed from the app. If it is dropped, say so on the projected menu card rather than letting someone
discover it in the build block.

### 6. The check is a lint, not a sandbox, and it will fail plain English

`CONTRACT.md` says a mode "cannot break the rest of the app". The scan over `fn.toString()` cannot stop
`window['fe'+'tch']`, a long loop, or a global assigned inside an immediately-invoked function. Say "the check catches
the common ways a mode breaks the page", and keep the state-that-does-not-lie rule intact in the copy.

The scan also counts banned words inside quotes. A beginner's note reading "The library could not fetch this." or "This
record's document" fails with no guidance. Either match call-shaped tokens (`fetch\s*\(`, `document\.`, `new Date`) or
make the failure name the word, the string and a rephrase. Expect two or three of ten people to hit this.

### 7. What runs the check, and on which machine

**Decided:** `check.sh` is not a cut item. Both routes stay — `node tools/check-mode.js <id>` when Node is reachable,
`bash tools/check.sh <id>` through `osascript` always. The ported `check.sh` must stay bash 3.2-safe (no associative
arrays, no `${var,,}`, `sed -i ''`, no `grep -P`, no `timeout`, `shasum -a 256`); Search Desk's already is.

What is actually known about the room's machines, from `mac_workshop_machines.md` in the residency repo: Python 3.14,
**Node**, git, Claude Code and Chrome are in the frozen image (marked confirmed with TPL), but *where `node` sits on
the PATH is listed as untested*, and Terminal access itself is unconfirmed. The W04 Search Desk brief is written to
survive Node's absence — "`node` may be" — and routes to `check.sh` and `#selftest`. So the Search Desk session working
does not prove Node is on the PATH.

The decisive test is small, and it belongs in `T7.1` on the Mac mini **in a fresh standard (non-admin) user**, because
the Mini's own account has the developer tools and a newer Python and is not a workshop machine:

- `node -v` in a new Terminal, with nothing exported by hand.
- `bash tools/check.sh more-by` in the same Terminal.
- `#selftest` in Chrome from `file://`.

Record all three on the baseline line, and keep `check.sh` regardless.

One related uncertainty: the shared-computer notice lives in `.claude/settings.json` as `companyAnnouncements`, and
whether the Code tab renders it is undocumented and was not confirmed on the machines. Do not rely on it for the
practice-shelf rule; put that sentence in the app's own copy too.

---

## P1 — the builder will implement these wrong as written

Doc bugs first, because they cost a build task each:

- **`T1.7` lost its escape sequences.** The line reads "escaped as `<` and so on", which is a no-op. It meant
  `\u003c`, `\u003e`, `\u0026`. Keep the `</script>` test; it is the one that proves it.
- **`T1.0` needs the schema `T1.4` writes.** Give `data/slice.schema.json` an owner: `T0.1` or `T1.0`.
- **`T2.3` and `T1.7` point at the wrong repo.** `seed_src/app/discovery.js` and `build_app.py` are under
  `~/Documents/work/tpl/applied_ai_2026/events/W13-personal-library-app/`, not Search Desk. Every other "Port:" line
  is relative to `~/Documents/Projects/searchdesk/`, so an agent will look in the wrong place.
- **"Six" vs "up to six".** `DESIGN.md` and `README.md` promise six; the contract says up to six; the session says a
  mode that narrows to four and says why has passed. Use "up to six" in the product docs.
- **`data/found.json` holds the person's words.** It is not in `.gitignore`, it is not excluded in `T5.2`'s starter
  contents, and a real query committed upstream puts a personal request in a public repo. Ignore it in the tool repo
  and strip `found.json`/`found.js` from `--starter` explicitly.
- **The typed-book link has no task.** `ARCHITECTURE.md` says a typed book that matches a slice work is linked on
  entry, so it gains facets and moves the profile. `T3.1` only says "add a typed one". Give it a test: type a book that
  is in the slice, and check the entry carries `groupKey` and counts.
- **`ctx.random()` has no seed lifetime.** "The same sequence until Shuffle" needs a seed stored per mode; otherwise
  blind date reshuffles on reload and standard shelves 5 and 6 disagree.
- **`shape: 'path'` with no `step`** renders as what? A default label, or make `step` required for path mode in
  validation. One line.
- **No localStorage failure path.** T2.8 takes storage as a parameter, but no click test disables it. On `file://`
  some browsers throw; the take-home may be opened at home in Safari. Add a click that expects a sentence, not a blank
  page.
- **A built but unlisted mode is invisible.** `#selftest` and the shell only know `list.js`. A beginner who forgets the
  line sees a passing check and no card. `check-mode.js` should warn: "this mode is not in `list.js`; the app will not
  show it."
- **`app/PLAN.md` has no home.** The session's plan step writes it; the starter has no slot and `/new-mode` does not
  create one. Put it in the contract's file list and the command.
- **`serve.py` should bind 127.0.0.1**, and **`find.py` should print the query it is about to send** before sending
  it. Ten people with a network exception need the blast radius visible.
- **The slice's licence claim is doing more work than it can.** `DATA.md` cites the City of Toronto Open Government
  Licence, but Z39.50 is a protocol and the OGL covers datasets on the city's open data portal, not obviously a
  BiblioCommons catalogue. The facts are almost certainly fine to keep; a public repo carrying 400–600 TPL records
  still deserves a decision entry, and MIT over the repo does not grant the data.
- **If events return, the snapshot's `description` field trips rule 4** as written ("no field named `description` in any
  file that ships"). Rename it to `summary`, or narrow the rule to publisher blurbs.

---

## P2 — rewrite the plan for a continuous build

- **Replace the dated table with a dependency order.** The only wall-clock task is the batch fetch: 44 queries at
  120 s is about 90 minutes, and it needs only `fetch.py` and `libraries/tpl.json`. Start it before `T1.2` writes the
  fixture, not after. Then normalise and build from the cache while it runs.
- **Keep the lane ownership table** (it prevents file collisions between parallel workers) and delete the evening
  cadence, the worktree ceremony and "one task per session" — or say plainly which parts still apply to a continuous
  builder. The rules worth keeping are: one task per commit, checks pasted, no design calls, a finding goes under
  "Found while working".
- **Move the human checks to the front.** `T7.1` and `T7.2` run on the Mac mini as soon as `dist/starter` opens, not
  on the last afternoon, and in a standard user. Every finding is a task before more features land.
- **Turn the cut list into a priority order** and split the two items that bundle divisible things: `T5.5` carries both
  `/new-mode` and `check.sh`, and `T3.3` carries both the finalists box and "from some words". As written, the cut
  order takes the wrong half.
- **Write the starter's interface to the kit.** What `dist/starter/` guarantees: `app/index.html` opens in Chrome from
  `file://`; data is generated, never hand-edited; the check command works; a one-file take-home can be built; nothing
  at runtime touches the network; the practice shelf is the default. The kit is rebuilt after the lock and can rely on
  those, not on the placeholder installer.
- **Re-time the menu after `T6.x` and `T7.1`.** Seven of ten briefs are M or L, and the README defines M as "build plus
  the test-and-fix block" against a protected 26-minute build. Either the reference builds prove M fits the build
  block, or the projected cards say what M really costs.

---

## Definition of locked

- Every task names its inputs, its files, its check, and no design call remains.
- Each promise in "What the app adds around every mode" and "What `choose` returns" is backed by a test in `T2.6`
  or `T4.2`.
- The five P0 items above are decided and recorded in `DECISIONS.md` with a date.
- The starter's interface to the kit is written down.
- No doc says "six" where the contract says "up to six"; no doc cites a licence it has not verified; no doc names a
  path in the wrong repo.
- A fresh builder can read `AGENTS.md`, then `BUILD.md`, and start lane A without asking a question.

## Questions for Ryan

1. The pack: keep the 30 books and their notes, keep the notes and replace the books, or replace both? If both, where
   do `mood`, `pace` and `note` come from?
2. Events for Nov 7: build the snapshot and `ctx.events`, or drop events and let event-hook work only from text the
   person brings?
3. The slice in the public repo: verify the licence basis with TPL first, or keep the slice out of the repository and
   ship it only inside `dist/`?
4. Confirm the room's shelf is the practice shelf, so the welcome copy and the "one reader" step never invite a real
   reading history into the session. Deep Freeze wipes local storage at reboot, so the machines are fine afterwards;
   the take-home copy is the one that persists, and its copy has to be true too.
