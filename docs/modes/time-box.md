# Time-box  (id: time-box, shape: list, size: S)

**In plain words:** something you can finish, or listen to, on the commute.

**Why someone wants it:** the question is often not "what is good" but "what fits this week". A licensed recommender
cannot take that constraint.

## The rule

1. Input: `how`, a `choice` of `listen` or `read`, default `read`.
2. **Listen:** keep works whose `formats` include `EAUDIOBOOK`. The library's own records carry this field; the
   starting pack's hand-made books do not. Check with `python3 tools/coverage.py` how many books have it. If none, say
   so in a sentence ("None of these books are marked as audiobooks yet"), not an empty panel.
3. **Read:** keep works whose tags say `pace: fast`. Only the starting pack's books have a pace, because we tagged them by hand. Library records have none, so this keeps few.
4. Score what is left against the shelf and take the top six.
5. The note says what was dropped and why: "Kept 41 of 612 books: the ones the library has as an audiobook."

## Done when

- [ ] `node tools/check-mode.js time-box` passes, including the standard shelves.
- [ ] The note always says how many books were kept and the rule that kept them.
- [ ] "Read" with no fast-paced books on the list says so plainly, not an empty panel.
- [ ] Reasons name the fit and the match: "An audiobook, and it matches mysteries on your shelf."

## Logic to write and check

- `fits(work, how, tags)`: true or false, with a test for each branch.
- `keptLine(kept, total, how)`: the note sentence.

## Usually goes wrong

The filter empties the list, and the person sees nothing. Show what was dropped. Do not pretend to know length: the
catalogue gives no page count or running time here, and inventing one breaks the rules.

**Out of scope:** page counts, running times, reading speed.

**Ideas for after:** add `pace` words to more books in `data/tags.json` by hand (then `python3 tools/gen_data.py`);
a "short" tag for books under about 200 pages, written by a person who checked.
