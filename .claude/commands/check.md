---
description: Run one mode's check and say what failed
argument-hint: <mode id>
---

Run the check for the mode $1 and tell me what it says. Work through these steps in order.

1. Run this command from the project folder:
   `node tools/check-mode.js $1`
2. If it says Node is missing or the command is not found, run `bash tools/check.sh $1` instead. Use the same
   steps below; the two commands print the same lines.
3. Read the last line.
   - `OK $1: N passed, 0 failed` — the check passed. Tell me, in one sentence, what passed, and paste that
     line. Stop here.
   - Anything else — go on to step 4.
4. Find the first line that starts with `FAIL`. That one line is one thing to fix: it names the rule, and when a
   value was wrong it ends with `(got ..., wanted ...)`, which says what the mode actually returned. If the line
   starts `FAIL The scan` or `FAIL The file scan`, a banned word has to come out of `app/modes/$1.js`, and the
   line names it.
5. Fix `app/modes/$1.js` so that rule is true. If the check file itself asserts something `docs/CONTRACT.md`
   does not say, fix `app/modes/$1.check.js`; otherwise leave the check alone.
6. Run step 1 again. Repeat steps 3 to 5 for each remaining `FAIL`, one at a time.
7. Never do any of these to make a check pass: delete a `t.ok` or `t.eq`, loosen an expected value, skip the
   standard shelves, or edit `tools/check-mode.js`, `tools/check.sh` or `docs/CONTRACT.md`. A check changed to
   pass is a bug you have hidden.
8. If the same `FAIL` line is still there after three rounds, stop. Paste that line and the last line, and say in
   one sentence what you tried. Do not keep guessing.
9. When it passes, tell me in plain words: what failed, what you changed, and the last line of the check.
