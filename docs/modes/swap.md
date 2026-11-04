# Swap  (id: swap, shape: list, size: M)

**In plain words:** two shelves, and what each person should read from the other's.

**Why someone wants it:** people already lend each other books. Two exported files make that a game a group can
play: trade files, run the swap.

## The rule

1. Needs one imported shelf in `ctx.others` (the app's "Add a friend's shelf" button reads an exported file). Set
   `allowShelf: true`, because "for them" picks are on your shelf.
2. **For you:** works the other person rated loved or liked, that are in the list and not on your shelf, scored against
   your profile. Top three.
3. **For them:** the same the other way round. Top three.
4. Group with `group: 'For you'` and `group: 'For <name>'`.
5. Reason: "Your friend loved it, and it matches books about cities on your shelf."

## Done when

- [ ] `node tools/check-mode.js swap` passes, including the standard shelves (with no other shelf it must say how to add
      one).
- [ ] No pick is a book the reader already has on their own shelf.
- [ ] If the two shelves are the same, it says so.
- [ ] Ties go to the book the other person rated "loved".

## Logic to write and check

- `candidatesFrom(theirs, mine)`: their loved and liked works that are not on mine.
- `bestFor(profile, candidates, score, n)`.

## Usually goes wrong

Both lists collapse to the same book, or a typed book with no `work` breaks the score. Skip entries with no work and
say how many.

**Out of scope:** more than two shelves (that is club season); sending files over the network.

**Ideas for after:** one "wild card" each way that does not match at all; the model box arguing for one book each
way.
