# Event hook  (id: event-hook, shape: list, size: M)

**In plain words:** an event at the library becomes the seed: books to read before the talk, or after it.

**Why someone wants it:** an event is a reason to read something this month, and the library is already running it.

## The rule

1. Input: `about` (`facets`). The person picks the event's subjects by hand, or pastes the event's text and uses
   "From some words" (the app's model box turns words into subjects **from the list** and drops anything else).
2. Build a profile from the chosen facets (weight 3 each), plus the shelf's own profile at half weight, so the shelf
   breaks ties but does not take over.
3. Score every work, take the top six.
4. Reasons name the event's subject first: "Fits the talk's subjects: birds and city parks. You also liked nature
   books."

## Done when

- [ ] `node tools/check-mode.js event-hook` passes, including the standard shelves.
- [ ] It works with the model box never touched (subjects picked by hand).
- [ ] Subjects the model offered that are not in the list are named as dropped, and the mode never sees them.
- [ ] A subject the list cannot match says so: "Nothing in the list is about origami yet."

## Logic to write and check

- `seedProfile(facets, shelfProfile, weight)`.
- `aboutLine(facets, labelOf)`: "birds and city parks".

## Usually goes wrong

The event text is a schedule, not a subject ("Tuesday, 2pm, room 3"). If no subject fits, say so and let the person
pick by hand.

**Out of scope:** fetching events (the catalogue's feed has no CORS; a dated events snapshot is a later task in
`docs/BUILD.md`).

**Ideas for after:** once the events snapshot lands, a "Books for this event" button on each event; a "before" list
and an "after" list.
