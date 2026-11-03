# Journey  (id: journey, shape: path, size: M)

**In plain words:** a path from a book you loved to a book you have been avoiding, each step a neighbour of the last.

**Why someone wants it:** some books are hard to start cold. A path makes the last step feel close. It is a sequence,
which a list of "similar books" cannot be.

## The rule

1. Inputs: `from` (`shelf-book`, a book they loved) and `to` (`book`, the one they have been avoiding; often a book on
   the shelf as "want", so set `allowShelf: true`).
2. From the current book, choose the next as the unvisited work with the best `similar(current, w).score`, among works
   that are **at least as close to the goal** as the current book (`similar(w, to)`). That keeps the path moving.
3. Up to five steps, then the goal as the sixth. Stop early when the goal is the best next step.
4. Each step's reason names what it shares with the step before: "Shares books about islands and the sea with The
   Left Hand of Darkness."
5. If no work shares anything with the current book and moves toward the goal, stop and say where the path broke.

## Done when

- [ ] `node tools/check-mode.js journey` passes, including the standard shelves.
- [ ] The steps are in order, each with a `step` label ("Step 1", ..., "The goal").
- [ ] Every step shares at least one facet with the step before, and the reason names it.
- [ ] A broken path shows the steps it found and a note: "No book in the list links X to the next step."
- [ ] Choosing the same book for both ends says so instead of making a path.

## Logic to write and check

- `nextStep(current, goal, works, visited, similar)`: the next work or `null`.
- `walk(start, goal, works, similar, max)`: the list of steps.
- `stepReason(shared, prevTitle, labelOf)`.

## Usually goes wrong

The steps feel random, because the rule is greedy and the shared facet is something weak like an audience. Leave out
`audience` and `genre:fiction`-style facets when looking for a link, and show the link between steps, not only the
books.

**Out of scope:** the shortest path over the whole list; any model choosing steps.

**Ideas for after:** a direction instead of a goal ("older", "non-fiction"); cap how far each step can drift; the
model box arguing which step is the real turning point.
