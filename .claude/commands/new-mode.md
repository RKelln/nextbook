---
description: Build a mode from a brief in this repo
argument-hint: <mode id or the brief's name>
---

Build one mode for this app. The words you were given are $ARGUMENTS. Work in this folder and nowhere else.

1. Read these three, in this order, before you write anything:
   - `AGENTS.md`
   - `docs/CONTRACT.md`
   - the one brief in `docs/modes/` whose name matches the words you were given. For "ladder" that is
     `docs/modes/ladder.md`. Run `ls docs/modes` if the name is not obvious, then read that one file only.
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
   - Use only what `ctx` gives: `ctx.works`, `ctx.shelf`, `ctx.onShelf`, `ctx.profile`, `ctx.score`,
     `ctx.similar`, `ctx.reason`, `ctx.t`, `ctx.labelOf`, `ctx.tagsOf`. No `document`, `window`, `fetch`,
     `localStorage`, `Date`, `Math.random` or timers; the check fails the file if one appears.
5. Write `app/modes/<id>.check.js` by copying `app/modes/more-by.check.js`: `Nextbook.check('<id>', (t, mode) => { ... })`.
   Test every function in `logic` with tiny made-up objects, and test `choose` once with a made-up
   `ctx` of `{ shelf, works, onShelf, t }`. Write each message as what should be true.
6. Add the id to the one line in `app/modes/list.js`, keeping the modes already there:
   `Nextbook.modes = ['more-by', '<id>'];`
7. Run the check now:
   `node tools/check-mode.js <id>`
   If the output says Node is missing or not found, run `bash tools/check.sh <id>` instead.
8. If a line starts with `FAIL`, fix `app/modes/<id>.js`, then run step 7 again. Fix the mode, not the check,
   unless the check asserts something the brief does not say. Never edit `tools/check-mode.js`,
   `tools/check.sh` or `docs/CONTRACT.md`.
9. Finish by telling me in plain words what the mode picks and why, then paste the last line of the check:
   `OK <id>: N passed, 0 failed`. If it does not end that way, say what still fails instead.
