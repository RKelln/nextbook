# The mode menu

A mode is a pair: what goes in, and what shape comes out. Every mode ends the same way: **up to six books, a reason
for each, and a link to the library's page.** Only the middle changes.

Nothing here is ranked. Show the menu in a shuffled order and mark none of them as the intended one. Any of them is a
complete answer, and so is "my own idea". The size column is not a ranking either: an S brief is not a better answer
than an M one, and a small brief is not a warm-up for a large one.

| Brief | In one line | Size | What the build needs | In the block? |
|---|---|---|---|---|
| [survey](survey.md) | one book from each part of the library your shelf never visits | S | sections (call numbers); one judgement: which parts are unvisited, then the best door into each | yes |
| [blind-date](blind-date.md) | three parts of the library you never go to, one book each, no scores | S | sections, `ctx.random()`; the same unvisited parts, then random picks | yes |
| [time-box](time-box.md) | something you can finish, or listen to, on the commute | S | formats (the library's records carry them; the starting pack does not), pace words (hand tags, starting pack only); one filter, and a note that says what it kept | yes |
| [challenge](challenge.md) | same subject, from the other side: books that would argue with you | M | subjects, fiction/non-fiction, moods; two kinds of "other side", up to three of each | yes |
| [journey](journey.md) | a path from a book you loved to one you have been avoiding | M | subjects; a walk that must move toward the goal, and a real shared facet at each step | yes |
| [ladder](ladder.md) | from beginner to deep on one subject | S | subjects, audience; one order (audience, then how many subjects), spread across it | yes |
| [swap](swap.md) | two shelves: what each person should read from the other's | M | a second shelf file; two lists, one each way | with a friend's shelf added first |
| [club-season](club-season.md) | six weeks of books for a group | M | a friend's shelf; the group's floor, then a chain of weeks | with a friend's shelf added first |
| [event-hook](event-hook.md) | a library event becomes the seed | S | subjects; a profile from the event's subjects, the shelf at half weight | yes: the event's own text, or its subjects picked by hand |
| [news-diet](news-diet.md) | headlines become books | S | subjects; the same, plus a point for non-fiction and a warning in the note | yes |
| [hold-next](hold-next.md) | from your want-to-read books, the ones to put on hold now, one click from Place hold | S | your shelf's "want" books, `allowShelf`; one ranking against the rest of the shelf, and a note that says how to hold | yes |

## What the sizes mean

A workshop gives the build about half an hour. A size says how much of that block the brief asks for; it does not say the
build takes a fixed number of minutes, because no beginner has tried one yet.

- **S — one judgement.** The rule answers one question: which books, or in what order. Two or three small helpers, at
  most one input, nothing to set up.
- **M — two or three rules of the same kind, or one rule plus something to set up.** Each rule filters or scores and
  can be checked on its own (two kinds of "other side"; a group's floor, then a chain of weeks), or one rule needs
  something the workshop must have ready. Without the setup, the build is still the size of the reference builds below.
  With it, the setup has to happen before the block starts.
- **L — more than that.** More than three rules, a helper that changes the data every rule sees (club season's fold,
  which built a fourth profile out of the members'), or a design call the brief does not make. Does not fit the
  block: build it at home, or cut it until it is M. There is no L on the menu now: club season was the one as written,
  and its fold and second sort key went when the menu was re-timed.

## What the sizes rest on

Three reference builds, all by an agent, all in `reference/modes/`. Survey has 68 assertions, and its build did not record a
time. Journey has 69, and took about four minutes from the first line to a green check, or about twenty by that
build's own count when the twelve minutes of shared reading is charged to it. Challenge has 75, and took about four
minutes plus two lost to a `ctx` helper that was missing from the app and has since been added. Challenge is the
heaviest of the three built, and it fitted a half-hour block even with the shared reading charged.

**A beginner's time has not been measured.** The first-timer check, on a clean machine, is the first beginner to
build one of these, and it builds survey from its brief there. Until it runs, the times above are an agent's, the beginner's are unknown, and
"in the block" means the build is no larger than the measured ones and needs nothing set up. It is not a promise that
a beginner finishes. The sizes are re-checked after the first-timer check: if a beginner cannot get through an S brief in the block, the
sizes come down; the block does not go up.

Each brief has the same parts: what it is, the rule, done when, the logic to write and check, what usually goes
wrong, what is out of scope, and ideas for a second step (the workshop's "grow" block: a second step of the same
mode, not a second mode). A filter added as a second step can be optional: give the input `optional: true` and the
check runs the mode with it empty, so the mode must work with no filter as well as with one. The size in a brief's
title line is the same as its row above; if the two ever disagree, the row was set later.

The contract every mode follows is `docs/CONTRACT.md`. The worked example is `more-by`, which is not on this menu on
purpose: an example of a mode someone had been asked to build would hand them the answer.

## Your own idea

Anything else that produces up to six books with reasons and a link out. Ask what the output should look like first,
then find the rule. If the rule needs data the list does not have (length, difficulty, a mood on most books), say so
before building: a missing field is cheaper to find in the plan than after the code exists. `docs/DATA.md` lists what
the library really gives. If your idea needs a helper that changes the data every rule sees, or a design call the
brief does not make, it is an L: build it at home, or take that helper out until it fits the block.
