# The mode menu

A mode is a pair: what goes in, and what shape comes out. Every mode ends the same way: **up to six books, a reason
for each, and a link to the library's page.** Only the middle changes.

Nothing here is ranked. Show the menu in a shuffled order and mark none of them as the intended one. Any of them is a
complete answer, and so is "my own idea".

| Brief | In one line | Size | Needs from the data |
|---|---|---|---|
| [survey](survey.md) | one book from each part of the library your shelf never visits | S | call numbers (sections) |
| [blind-date](blind-date.md) | three parts of the library you never go to, one book each, no scores | S | sections, `ctx.random()` |
| [time-box](time-box.md) | something you can finish, or listen to, on the commute | S | formats, pace words (few books) |
| [challenge](challenge.md) | same subject, from the other side: books that would argue with you | M | subjects, fiction/non-fiction, moods (few books) |
| [journey](journey.md) | a path from a book you loved to one you have been avoiding | M | subjects |
| [ladder](ladder.md) | from beginner to deep on one subject | M | subjects, audience |
| [swap](swap.md) | two shelves: what each person should read from the other's | M | a second shelf file |
| [club-season](club-season.md) | six weeks of books for a group | L | several shelf files |
| [event-hook](event-hook.md) | a library event becomes the seed | M | subjects, the model box (optional) |
| [news-diet](news-diet.md) | headlines become books | M | subjects, the model box (optional) |

Size is a guess at the build time for a beginner with an agent: S fits the 26-minute build, M fits build plus the
test-and-fix block, L needs the grow block too.

Each brief has the same parts: what it is, the rule, done when, the logic to write and check, what usually goes
wrong, what is out of scope, and ideas for a second step (the workshop's "grow" block: a second step of the same
mode, not a second mode).

The contract every mode follows is `docs/CONTRACT.md`. The worked example is `more-by`, which is not on this menu on
purpose: an example of a mode someone had been asked to build would hand them the answer.

## Your own idea

Anything else that produces up to six books with reasons and a link out. Ask what the output should look like first,
then find the rule. If the rule needs data the list does not have (length, difficulty, a mood on most books), say so
before building: a missing field is cheaper to find in the plan than after the code exists. `docs/DATA.md` lists what
the library really gives.
