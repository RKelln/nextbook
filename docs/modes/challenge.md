# Challenge  (id: challenge, shape: list, size: M)

**In plain words:** books on the subjects you read, from the other side: books that would argue with you.

**Why someone wants it:** a recommender gives more of the same. This one inverts on purpose, which a licensed
service structurally will not do.

## The rule

Two kinds of "other side", both from real data:

1. **The other shelf.** Take the profile's three strongest `topic:` facets. For each, find works with that topic whose
   `contentType` is the one the shelf reads least (a novel reader gets non-fiction on the same subject, and the
   reverse). Reason: "You read novels about survival. This is non-fiction about survival."
2. **The other mood.** Among works we tagged, find ones that share a topic with the shelf but have none of the shelf's
   two most common moods. Reason: "You liked hopeful books about survival. This one is survival without the hope."

Take up to three of each kind, best score first. If one kind finds nothing, fill from the other, and say which.

## Done when

- [ ] `node tools/check-mode.js challenge` passes, including the standard shelves.
- [ ] Every reason names the shared subject and what is different.
- [ ] The note says how many works were skipped for having no mood words.
- [ ] A shelf with nothing rated says it needs a rated book first.
- [ ] No reason is rude about the person's taste.

## Logic to write and check

- `leastRead(shelf)`: `FICTION` or `NONFICTION`, ties to `NONFICTION`.
- `topTopics(profile, n)`: the n strongest `topic:` facets with a positive weight.
- `topMoods(shelf, tagsOf, n)`.
- `opposite(work, topic, otherType)`: true when the work has the topic and the other content type.

## Usually goes wrong

It turns into contrarianism, or it argues with books the person rated "not for me". Only use positive evidence, keep
the reasons civil, and keep to subjects the person chose.

**Out of scope:** political or moral stance labels; anything the catalogue does not say.

**Ideas for after:** a "stance" word in `data/tags.json`, hand-applied and honestly imperfect; the model box arguing
which of the six would argue hardest.
