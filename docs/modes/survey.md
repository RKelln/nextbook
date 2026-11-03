# Survey  (id: survey, shape: list, size: S)

**In plain words:** one book from each part of the library your shelf never visits.

**Why someone wants it:** a shelf drifts toward one corner. This widens it on purpose, and it says so. It is
coverage, not matching.

## The rule

1. Count the shelf's books in each part of the library (`ctx.sections()`; a shelf book counts in a section when its
   work has that `section:` facet). Books typed in that are not in the list count nowhere.
2. The parts with zero shelf books are the unvisited ones. Order them by how many works they hold, biggest first, then
   by facet key.
3. From each of the first six unvisited parts, take the work with the best `ctx.score` against the shelf's profile:
   the friendliest door into a room the person never enters. Ties go to the lower `id`.
4. If fewer than six parts are unvisited, fill up from the parts the shelf visits least, and say so in `note`.

## Done when

- [ ] `node tools/check-mode.js survey` passes, including the standard shelves.
- [ ] Every pick comes from a different part of the library.
- [ ] Each reason names the part and, when there is one, the bridge: "You have nothing from the science shelves
      (500s). This one shares books about the sun with your shelf." With no bridge: "You have nothing from the science
      shelves (500s). Nothing on your shelf points here, which is the point."
- [ ] An empty shelf still gives six, with the note "Your shelf is empty, so every part of the library is new."
- [ ] A shelf that visits every part says so in `note` and picks from the least visited.

## Logic to write and check

- `visitCounts(shelf, sections)`: `{sectionFacet: count}`, typed books ignored.
- `unvisited(counts, sections)`: section facets with count 0, biggest first, ties by key.
- `bestIn(section, ctx, profile)`: the top-scoring work not on the shelf.

## Usually goes wrong

It suggests things the person will not enjoy. Do not hide that: the reason says this is widening, not matching. Works
with no call number (most e-books) have no section and never appear; say how many were left out.

**Out of scope:** weighting sections by how "important" they are; a model choosing sections.

**Ideas for after:** let the person pin one part as "never show me this"; show the shelf's own spread as a line of
counts above the six; add the model box's two-of-six argument.
