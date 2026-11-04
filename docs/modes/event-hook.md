# Event hook  (id: event-hook, shape: list, size: S)

**In plain words:** an event at the library becomes the seed: books to read before the talk, or after it.

**Why someone wants it:** an event is a reason to read something this month, and the library is already running it.

## The rule

1. Inputs: `about` (`facets`), and `event` (`event`) when the app has the events snapshot. With an `event` input the
   events screen's "Books for this event" button hands the window over by itself: the event's `title`, `categories` and
   `summary` are the words to start from, and `ctx.events` holds the branch's events for a date check. Without that
   input the person picks the event's subjects by hand, or uses "From some words" on the event's text (the app's model
   box turns words into subjects **from the list** and names the ones it drops, so the mode only ever receives facet
   keys), or pastes the text from the library's event page. A mode that lists both inputs must work with only `about`.
2. Build a profile from the chosen facets (weight 3 each), plus the shelf's own profile at half weight, so the shelf
   breaks ties but does not take over.
3. Score every work, take the top six.
4. Reasons name the event's subject first: "Fits the talk's subjects: birds and city parks. You also liked nature
   books."

## Done when

- [ ] `node tools/check-mode.js event-hook` passes, including the standard shelves.
- [ ] It works with the model box never touched (subjects picked by hand).
- [ ] A subject the list cannot match says so: "Nothing in the list is about origami yet."

## Logic to write and check

- `seedProfile(facets, shelfProfile, weight)`.
- `aboutLine(facets, labelOf)`: "birds and city parks".

## Usually goes wrong

The event text is a schedule, not a subject ("Tuesday, 2pm, room 3"). If no subject fits, say so and let the person
pick by hand.

**Out of scope:** fetching events from inside the mode (the snapshot is made ahead, with its date, by the app's
tools).

**Ideas for after:** a "before" list and an "after" list, chosen by the event's date; a walk from the event to the
library's own reading list for it.
