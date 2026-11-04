# Club season  (id: club-season, shape: path, size: M)

**In plain words:** six books, six weeks, for a group, with a line for each week.

**Why someone wants it:** a book club needs a sequence, not a list, and a group's taste is not one person's.

*Cut when the menu was re-timed:* the folded group profile and the "raise the lowest member score" preference are gone. The fold was a
third mechanism sitting under every week's choice, and the preference was a second sort key. The group's floor and
the chain of weeks are what the block has room for.

## The rule

1. Members: your shelf plus every shelf in `ctx.others`. With none, say how to add one (the shelf screen's "Add a
   friend's shelf" reads an exported file). Keep each member's profile; do not add them into one.
2. **Week 1** is the work with the best *lowest* score across members: the one nobody minds.
3. Each next week is the work most `similar` to the week before, among works no member has on their shelf. Ties go to
   the higher lowest score.
4. **Week 6** is the stretch: the best work for the group that at least one member's profile scores below zero. Say
   so.
5. Reasons per week: "Week 3. Shares books about families with week 2, and it is the best fit for Sam."

## Done when

- [ ] `node tools/check-mode.js club-season` passes, including the standard shelves (with no other shelf it must say
      how to add one).
- [ ] No week is a book on any member's shelf, and week 6's reason says it is the stretch and for whom.
- [ ] With fewer than six possible books, it says how many weeks it could fill.

## Logic to write and check

- `worstScore(work, profiles, score)`: the lowest score across the members, tested with two tiny profiles.
- `season(start, works, profiles, similar, score, weeks)`: the weeks in order, or fewer.

## Usually goes wrong

It becomes six safe picks. Week 6 is there to stop that. It can also lean toward the member with the biggest shelf;
the lowest-score rule in week 1 is the counterweight.

**Out of scope:** dates, meeting places, who brings snacks; adding the members' profiles into one.

**Ideas for after:** fold the members' profiles into one, as a second step; pairs swap instead of everyone reading
the same; one week chosen by each member's own favourite subject; a printable season card.
