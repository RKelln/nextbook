# Club season  (id: club-season, shape: path, size: L)

**In plain words:** six books, six weeks, for a group, with a line for each week.

**Why someone wants it:** a book club needs a sequence, not a list, and a group's taste is not one person's.

## The rule

1. Members: your shelf plus every shelf in `ctx.others` (at least one; people add them on the shelf screen with
   "Add a friend's shelf").
2. Fold the members' profiles into one by adding them. Keep each member's profile too.
3. **Week 1** is the work with the best *lowest* score across members: the one nobody minds.
4. Each next week is the work most `similar` to the week before, among works no member has on their shelf, preferring
   ones that raise the lowest member score.
5. **Week 6** is the stretch: the best-scoring work for the group that at least one member's profile scores below zero.
   Say so.
6. Reasons per week: "Week 3. Shares books about families with week 2, and it is the best fit for Sam."

## Done when

- [ ] `node tools/check-mode.js club-season` passes, including the standard shelves (with no other shelf it must say how
      to add one).
- [ ] No week is a book on any member's shelf.
- [ ] Week 6's reason says it is the stretch, and for whom.
- [ ] With fewer than six possible books, it says how many weeks it could fill.

## Logic to write and check

- `fold(profiles)`: one profile from several, tested with two tiny profiles.
- `worstScore(work, profiles, score)`.
- `season(start, works, profiles, similar, score, weeks)`.

## Usually goes wrong

It becomes six safe picks. Week 6 is there to stop that. It can also lean toward the member with the biggest shelf;
the lowest-score rule in week 1 is the counterweight.

**Out of scope:** dates, meeting places, who brings snacks.

**Ideas for after:** pairs swap instead of everyone reading the same; one week chosen by each member's own favourite
subject; a printable season card.
