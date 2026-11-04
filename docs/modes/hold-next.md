# Hold next  (id: hold-next, shape: list, size: S)

**In plain words:** from the books you want to read, the ones to put on hold now, each one click from the library's
Place hold button.

**Why someone wants it:** a want-to-read list grows faster than anyone reads it, and a hold takes weeks to come in.
The useful question is "which of these should I be in the queue for right now?". The library's own For Later shelf
keeps the list but cannot answer that, because it does not know what you loved.

## The rule

1. No input.
2. The candidates are the shelf's own books: entries with `state: 'want'` and a `work` (a book typed in that the
   list does not have has no id, so it cannot be a pick). A book with `state: 'hold'` is already in the queue: leave
   it out, and count it. Set `allowShelf: true`, or the app drops every pick for being on the shelf.
3. Score each one against the rest of the shelf with `ctx.score(work, ctx.profile())`. The profile already gives a
   "want" no weight, so the candidates do not vote for themselves. Ties break by `id`.
4. Take the top six. The `why` says what it matches: "On your list, and it matches mysteries and memory on your
   shelf."
5. The note says how to hold, and what it skipped: "Open a book and press Place hold on the library's page. You have
   1 book on hold already. 2 books on your list are not in the library list, so they are not here."
6. No want-to-read books at all: no picks, and a note that says how to get some ("Press Want to read on a book in
   another way of choosing, or on the shelf").

## Done when

- [ ] `node tools/check-mode.js hold-next` passes, including the standard shelves.
- [ ] Every pick is a "want" on the shelf, and nothing else is: never a book already on hold.
- [ ] A shelf with no "want" says so in the note, in words a person can act on.
- [ ] The note counts the books it skipped for not being in the list, when there are any.
- [ ] Reasons name the match: a subject, an author, or a book on the shelf.

## Logic to write and check

- `wanted(shelf)`: the "want" entries that have a work, how many did not, and how many are on hold. A test with a
  typed book and a held book in it.
- `rank(entries, profile, score)`: scored, sorted by score then `id`, at most six.
- `noteLine(skipped)`: the note sentence, with and without skipped books.

## Usually goes wrong

- Forgetting `allowShelf: true`: the check reports every pick dropped as "already on the shelf".
- Scoring with a profile that counts the wanted books themselves, so a book matches its own subjects. `ctx.profile()`
  gives a "want" no weight; a hand-made profile must do the same.
- Counting a held book as a candidate. The practice shelf has one on hold, so the standard shelves catch it.
- Promising more than a link can do. The app never places a hold and never knows how long the queue is. "On hold"
  is what the person told the app, not what the library says. Say "on the library's page", not "held".

**Out of scope:** placing the hold for the person, hold queues and wait times, availability, which branch to pick up
from, how many holds a card allows. All of that is on the library's page, behind the person's own sign-in. The
library's `robots.txt` disallows its hold path (`/holds/select_hold/`) and its availability path
(`/v2/availability/`), and the app never signs in to anything (`docs/DECISIONS.md`, D20).

**Ideas for after:** an optional `choice` input for format, so "listen" keeps only books the library has as an
`EAUDIOBOOK` (time-box's filter); `group` the six into "Hold now" (the top three) and "After those", so a person who
can only carry a few holds at once sees which come first; a note that names the strongest subject across all six
("Your list leans toward memory right now").
