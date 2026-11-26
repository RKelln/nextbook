---
name: new-mode
description: Build one mode from a brief in docs/modes/: plan, code, check file, and the check run. Use when a person asks for a mode to be written.
---

Build one mode for this app. The words you were given are the mode's id or the brief's name. Work in this folder and nowhere else.

1. Read these three, in this order, before you write anything:
   - `AGENTS.md`
   - `docs/CONTRACT.md`
   - the one brief in `docs/modes/` whose name matches the words you were given. For "ladder" that is
     `docs/modes/ladder.md`. Run `ls docs/modes` if the name is not obvious, then read that one file only.
   Then run `python3 tools/coverage.py`. It says how many books carry each thing a mode can lean on. Some
   come from the library's own records (sections, subjects, formats, audience); mood, pace and notes are our own
   hand tags and exist only for the starting pack. If the brief needs a field few books have, say the number in
   `app/PLAN.md` and in the mode's `note`; do not promise a mode the data cannot fill.
2. The id is the brief's file name without `.md`: lowercase letters and hyphens (the brief's first line says it too).
3. Write `app/PLAN.md` before any code. If it is already there, replace it: it is the plan for one mode at a time.
   Use exactly these headings, in this order, one or two short lines under each, taken from the brief:
   ```
   # Plan: <id>
   ## The mode in a sentence
   ## The output
   ## The rule
   ## Two ways to test it
   ## Still broken
   ```
4. Open `app/modes/more-by.js` and copy its shape. Write `app/modes/<id>.js` with its keys in this order:
   `id`, `name`, `purpose`, `shape`, `inputs`, `strings`, `logic`, `choose`. Put `allowShelf: true` after
   `shape` only when the brief asks for it.
   - `choose(ctx)` is written as a method, not an arrow function, or `this.logic` is lost.
   - Each pick is `{ id, why }`. `why` is one sentence that names its evidence: a subject, a book, an author,
     or the rule. Never "similar to your taste".
   - At most six picks, no repeats, and no pick that is already on the shelf unless the brief asks for it.
   - Fewer than six picks needs a `note`; no picks at all always needs a `note`.
   - The app's words go in `strings`, with `{name}` holes for values. Do not build a sentence in `why` by hand.
   - **A mode that asks a chat** (the brief `ask-a-chat.md`, or an idea that needs judgement a rule cannot make)
     returns `{ picks: [], ask: { question, books } }` instead: up to forty ids, none on the shelf, and a question
     that names no book or author from the shelf. The app writes the prompt and reads the answer
     (`docs/CONTRACT.md` section 9). Test the rule that picks the forty, not the chat.
   - Use only what `ctx` gives: `ctx.works`, `ctx.shelf`, `ctx.onShelf`, `ctx.profile`, `ctx.score`,
     `ctx.similar`, `ctx.reason`, `ctx.t`, `ctx.labelOf`, `ctx.tagsOf`. No `document`, `window`, `fetch`,
     `localStorage`, `Date`, `Math.random` or timers; the check fails the file if one appears.
5. Write `app/modes/<id>.check.js` by copying `app/modes/more-by.check.js`: `Nextbook.check('<id>', (t, mode) => { ... })`.
   Test every function in `logic` with tiny made-up objects, and test `choose` once with a made-up
   `ctx` of `{ shelf, works, onShelf, t }`. Write each message as what should be true.
6. Add the id to the one line in `app/modes/list.js`, keeping the modes already there:
   `Nextbook.modes = ['more-by', '<id>'];`
7. Run the check now:
   `bash tools/check.sh <id>`
   It uses Node if it is installed and a Mac's own JavaScript if not, with the same lines; do not mention which ran.
   Without `bash` (Windows), run `node tools/check-mode.js <id>`. If it says Node is needed, say the check cannot run
   without Node, offer to help install it (nodejs.org) and wait for a yes.
8. If a line starts with `FAIL`, fix `app/modes/<id>.js`, then run step 7 again. Fix the mode, not the check,
   unless the check asserts something the brief does not say. Never edit `tools/check-mode.js`,
   `tools/check.sh` or `docs/CONTRACT.md`.
9. Finish by telling the person in plain words what the mode picks and why, then paste the last line of the check:
   `OK <id>: N passed, 0 failed`. If it does not end that way, say what still fails instead.
10. If the mode has few books to pick from (`python3 tools/coverage.py` shows few for what the rule needs, or the
    person sees fewer than six picks or the "nothing found" note), say the number and offer one `/find-books` search
    in short, plain words that fit the gap (the `find-books` skill). Run it on a yes, then ask them to look at the
    mode again. Offer more books before loosening the rule, and loosen it only if they ask.
