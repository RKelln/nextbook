# Blind date  (id: blind-date, shape: list, size: S)

**In plain words:** three parts of the library your shelf never goes to, one book from each, with no scores at all.

**Why someone wants it:** the rule is the product. No matching, no "you might like", just a door opened at random,
honestly labelled. It is the opposite of a recommender, which is why it is worth having.

## The rule

1. Find the parts of the library with no shelf books (as in survey).
2. Choose three of them with `ctx.random()`.
3. In each, choose one work with `ctx.random()`, skipping works on the shelf.
4. The reason names only the rule and the part: "From the arts shelves (700s), where your shelf has never been."

A "Shuffle" button is the app's, not the mode's: it changes what `ctx.random()` returns. The same shuffle gives the
same three.

## Done when

- [ ] `node tools/check-mode.js blind-date` passes, including the standard shelves.
- [ ] Exactly three picks when at least three parts are unvisited, each from a different part.
- [ ] No reason mentions a match, a score or the person's taste.
- [ ] Running twice with the same `ctx.random()` gives the same three.
- [ ] With fewer than three unvisited parts, it picks what it can and says why in `note`.

## Logic to write and check

- `pickN(list, n, random)`: n different items from a list, using only the `random` function it is given.
- `unvisitedSections(shelf, sections)`.

## Usually goes wrong

Someone reaches for `Math.random()`, and then the check cannot repeat the result. Use `ctx.random()` only. It can
also land on a part of the library with odd records (a single-work section); prefer sections with at least three
works, and say so.

**Out of scope:** any scoring; any explanation beyond the rule.

**Ideas for after:** "one more date" that adds a fourth from a fourth part; let the person rule out a part ("not
cookbooks"); show the three parts' names before the books are revealed.
