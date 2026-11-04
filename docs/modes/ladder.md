# Ladder  (id: ladder, shape: path, size: S)

**In plain words:** from beginner to deep on one subject, in order.

**Why someone wants it:** "I want to learn about the sea" needs a first book and a next book, not a pile.

## The rule

1. Input: `subject` (`facet`).
2. Keep works with that facet.
3. Order them by audience (`JUVENILE`, then `TEEN`, then `ADULT`), then from fewer subject headings to more (a book
   about many things is usually a wider, easier door than a book about one narrow thing), then by `id`.
4. Take up to six, spread across the order rather than the first six (first, last, and evenly between).
5. Each reason names its rung honestly: "A teen book about the sea: a gentle start." "An adult book about the sea and
   tides: deeper."

## Done when

- [ ] `node tools/check-mode.js ladder` passes, including the standard shelves.
- [ ] The note says the order is a rough guess from the audience and the subjects, not a difficulty score.
- [ ] A subject with one or two works says it is too thin for a ladder.
- [ ] Shelf books are skipped, and the note says how many.

## Logic to write and check

- `rungKey(work)`: the sort key, tested on three made-up works.
- `spread(list, n)`: n items spread across a list, keeping the first and the last.

## Usually goes wrong

The catalogue has no difficulty field, and it is tempting to pretend it does. Say what the order is made from.

**Out of scope:** reading levels; page counts.

**Ideas for after:** a `level` word (1 to 3) in `data/tags.json` for some books, written by a person; start the
ladder from the shelf's best match in that subject instead of the bottom.
