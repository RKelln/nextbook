# News diet  (id: news-diet, shape: list, size: S)

**In plain words:** paste some headlines; get books that go deeper than the news.

**Why someone wants it:** a headline is a reason to care about a subject for a week. A book is how to understand it.

## The rule

The same machinery as event hook, with headlines as the words:

1. Input: `about` (`facets`), chosen by hand or "From some words" with pasted headlines.
2. Profile from the facets at weight 3, the shelf at half weight. Prefer `NONFICTION` works: add 1 to their score.
3. Top six.
4. The note always carries the honest warning: "Turning headlines into subjects is where AI is weakest. Check the
   subjects above before trusting the books."

## Done when

- [ ] `node tools/check-mode.js news-diet` passes, including the standard shelves.
- [ ] The note always carries the warning, whichever way the subjects were chosen.
- [ ] Reasons name the subject from the headlines: "Goes deeper on housing and cities."
- [ ] Works with the model box never touched.

## Logic to write and check

- the same helpers as event hook (copy the idea, write your own file: one mode, one file).
- `nonfictionBonus(work)`.

## Usually goes wrong

A headline maps to a subject that is not what it means ("Bears win" to `topic:bears`). The person sees the subjects
before the books, and the warning says why.

**Out of scope:** fetching news; storing headlines.

**Ideas for after:** fiction that goes with the subject, as a second group; show which headline led to which subject.
