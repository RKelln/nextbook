---
name: check
description: Run one mode's check and say what failed, then fix the mode until it passes. Use when a person asks to check, test or fix a mode in app/modes/.
---

Run the check for the mode the person names (written `<id>` below) and tell the person what it says. Work through these steps in order.

1. Run this command from the project folder:
   `bash tools/check.sh <id>`
   It uses Node when Node is installed, and a Mac's own JavaScript when it is not; the lines are the same either way,
   so do not mention which one ran. Where there is no `bash` (Windows), run `node tools/check-mode.js <id>` instead.
2. If it stops with "This needs Node", or `node` is not found: say the check cannot run without Node, offer to help
   install it (nodejs.org) and wait for a yes.
3. Read the last line.
   - `OK <id>: N passed, 0 failed` — the check passed. Tell the person, in one sentence, what passed, and paste that
     line. Stop here.
   - Anything else — go on to step 4.
4. Find the first line that starts with `FAIL`. That one line is one thing to fix: it names the rule, and when a
   value was wrong it ends with `(got ..., wanted ...)`, which says what the mode actually returned. If the line
   starts `FAIL The scan` or `FAIL The file scan`, a banned word has to come out of `app/modes/<id>.js`, and the
   line names it.
5. Fix `app/modes/<id>.js` so that rule is true. If the check file itself asserts something `docs/CONTRACT.md`
   does not say, fix `app/modes/<id>.check.js`; otherwise leave the check alone.
6. Run step 1 again. Repeat steps 3 to 5 for each remaining `FAIL`, one at a time.
7. Never do any of these to make a check pass: delete a `t.ok` or `t.eq`, loosen an expected value, skip the
   standard shelves, or edit `tools/check-mode.js`, `tools/check.sh` or `docs/CONTRACT.md`. A check changed to
   pass is a bug you have hidden.
8. If the same `FAIL` line is still there after three rounds, stop. Paste that line and the last line to the person, and say in
   one sentence what you tried. Do not keep guessing.
9. When it passes, tell the person in plain words: what failed, what you changed, and the last line of the check.
