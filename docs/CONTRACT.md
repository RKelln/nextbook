# The mode contract

This file is all you need to write a nextbook mode. A mode is one file that looks at a person's shelf, chooses up to
six books from the library's list, and says why for each one. The app checks every answer before showing it, and the
check catches the common ways a mode breaks the page. It is a safety net, not a wall: a file written to get around
it can, so follow the rules rather than testing them.

## 1. What a mode is

Every mode ends the same way: **up to six books, a reason for each, and a link to the library's page.** The mode
decides the middle: which six, in what order, and why. The app does everything else. It draws the cards, builds the
links, offers the model box, and checks your answer before showing it.

A mode **does not draw anything and does not save anything**. It is a function from the shelf to a short list.

## 2. The file

`app/modes/<id>.js`. The id is lower case letters and hyphens and matches the file name. Add the id to
`Nextbook.modes` in `app/modes/list.js`. That list is the only place the app learns about modes: the menu of ideas
lives in `docs/modes/`, for people and their agents, not in the app.

**Missing is fine.** If a listed mode's file is missing or throws while loading, the app shows a card with its id and
"This one did not load. Ask your helper to run the check." Everything else keeps working. Registering the same id
twice replaces the first and logs a warning.

```js
// app/modes/more-by.js: the example. It is not on the menu, on purpose.
Nextbook.mode({
  id: 'more-by',
  name: 'More by them',
  purpose: 'Other books by authors you rated well.',
  shape: 'list',
  inputs: [],
  strings: {
    noAuthors: 'Rate a book "loved" or "liked" first. This finds more by those authors.',
    nothingMore: 'The library list has nothing else by the authors you rated well.',
    fewBooks: 'The library list has {n} more by the authors you rated well.',
    why: 'You rated {author} well. You gave {book} a "{rating}".'
  },
  logic: {
    // Pure: the same input always gives the same output. No ctx, no dates, no random.
    likedAuthors(entries) {
      const out = {};
      for (const e of entries) {
        if (!e.work || (e.rating !== 'loved' && e.rating !== 'liked')) continue;
        const key = e.work.authorKey;
        if (!out[key] || e.rating === 'loved') out[key] = e;
      }
      return out;
    }
  },
  choose(ctx) {
    const liked = this.logic.likedAuthors(ctx.shelf);
    if (!Object.keys(liked).length) return { picks: [], note: ctx.t('noAuthors') };
    const picks = ctx.works
      .filter(w => liked[w.authorKey] && !ctx.onShelf(w.id))
      .sort((a, b) => (b.year || 0) - (a.year || 0) || (a.id < b.id ? -1 : 1))
      .slice(0, 6)
      .map(w => {
        const e = liked[w.authorKey];
        return { id: w.id, why: ctx.t('why', { author: w.author, book: e.title, rating: e.rating }) };
      });
    return picks.length
      ? (picks.length < 6 ? { picks, note: ctx.t('fewBooks', { n: picks.length }) } : { picks })
      : { picks: [], note: ctx.t('nothingMore') };
  }
});
```

Keep the order of the keys: `id`, `name`, `purpose`, `shape`, `inputs`, `strings`, `logic`, `choose`. One optional
key goes after `shape`: `allowShelf: true`, for a mode whose picks may already be on the shelf (journey's goal, swap's
"for them").

The app calls `mode.choose(ctx, input)`, so inside `choose`, `this.logic` is your `logic`. Use method syntax
(`choose(ctx) { ... }`), not an arrow function, or `this` is lost.

The file does nothing when it loads except call `Nextbook.mode`. That is what lets the checks load it with no page.

## 3. What `choose` returns

```js
{ picks: [ { id, why, group?, step? } ], note? }
```

| Key | Rule |
|---|---|
| `picks` | at most six. Each `id` is a work id from `ctx.works`. No repeats. |
| `why` | one sentence, at most 200 characters, that **names its evidence**: a subject, a book, an author, a part of the library, or the rule. "Similar to your taste" is not a reason. |
| `group` | optional words to group cards under ("For you", "For your neighbour"). Swap uses it. |
| `step` | optional words for a step in a path ("Week 1", "Step 3: the stretch"). Without one, the app writes "Step 1", "Step 2", and so on. |
| `note` | a plain sentence shown above the cards: what the mode skipped, or why it found nothing. **Required when `picks` is empty.** |

The app checks the answer before showing it. It **drops and names** any pick whose id is not in the list, any pick
with no `why`, any repeat, any seventh pick, and any book already on the shelf (unless the mode sets
`allowShelf: true`). An empty list with no `note` shows "This mode found nothing and did not say why." That is a
failed check, not a result.

`shape: 'list'` draws cards in a grid. `shape: 'path'` draws them in order with the `step` words and an arrow between
them, for journeys, ladders and seasons.

## 4. What `ctx` gives a mode

`ctx` is the only thing a mode talks to. It has no page and no storage in it, on purpose.

| `ctx.` | What it is |
|---|---|
| `works` | every work in the library list: `{id, title, author, authorKey, year, formats, contentType, audience, callNumber, series, facets}`, plus any books the person's helper found on request, which also carry `found: {query}` |
| `work(id)` | one work, or `null` |
| `shelf` | the shelf entries: `{key, title, author, state, rating, work}`. `state` is `want`, `hold` (on hold at the library), `reading`, `read` or `stopped`. `work` is `null` for a book typed in that the list does not have |
| `onShelf(id)` | whether a work is on the shelf |
| `profile(entries?)` | what the shelf adds up to: `{weights: {facet: n}, authors: {authorKey: n}, evidence: {facet: [entry...]}, rated}`. Uses `ctx.shelf` when called with nothing |
| `score(work, profile)` | `{score, parts: [{facet, label, weight}]}`. The core's rule: shared subjects, weighted, plus the author |
| `similar(a, b)` | `{score, shared: [facet...]}` between two works |
| `reason(parts, opts?)` | the core's sentence for the strongest parts: "Matches books about wizards and science fiction on your shelf." |
| `facetsOf(work, kind?)` | a work's facets, all or one kind: `topic`, `genre`, `bisac`, `section`, `series`, `mood`, `pace` |
| `labelOf(facet)` | the words for a facet: `topic:wizards` gives "wizards" |
| `facets` | every facet in the list: `{facet: {label, kind, works}}` |
| `tagsOf(work)` | our own words for a work, `{mood, pace, note}`, or `null`. Most works have none: say how many you skipped |
| `sections()` | the parts of the library: `[{facet, label, works: [...]}]`, from the call numbers |
| `others` | friends' shelves, added on the shelf screen with "Add a friend's shelf" (an exported file and a name): `[{name, entries}]`, each entry shaped like `shelf`. Empty until someone adds one: say how in `note` |
| `events` | the library's events from the snapshot, `[{id, title, start, end, branch, categories, summary, url}]`, or `[]`. `eventsFetched` is its date |
| `random()` | a number from 0 to 1. The same sequence every time, even after a reload, until the person presses "Shuffle" (the app keeps the seed for each mode). Never use `Math.random` |
| `t(key, vars)` | this mode's strings, then the app's. `{name}` is filled from `vars` |

### Inputs

A mode that needs something from the person lists it in `inputs`, and the app draws the control above the results:

| `kind` | The control | `choose` receives |
|---|---|---|
| `shelf-book` | pick a book from the shelf | its entry |
| `book` | search the library list | a work |
| `facet` | pick a subject from the list | a facet key |
| `facets` | pick up to four subjects, by hand or "from some words" through the model box (section 9) | a list of facet keys |
| `text` | a short text box | the text |
| `number` | a number, with `min`, `max`, `default` | the number |
| `choice` | buttons, from `options: [{value, label}]`, with `default` | the chosen `value` |
| `event` | pick one of the library's events from the snapshot, by day and title | the event object: `{id, title, start, end, branch, virtual, categories, summary, url}` |

```js
inputs: [{ id: 'from', kind: 'shelf-book', label: 'Start from a book you loved' }],
choose(ctx, input) { const start = input.from; /* ... */ }
```

An `event` input is always one of the library's events as the snapshot holds them, never a title
typed into a box and never a model's words. The app groups the picker by day. In a copy with no
event snapshot the control says so and `choose` is not called.

An input is **required** unless its spec says `optional: true`. On an optional input the person may
leave the control empty, and `choose` receives `null` for it: the key is in the input, holding `null`,
never missing, so `input.subject === null` means "they chose no subject" and a mode can treat that as
"no filter". The empty choice can say its own words with `any`; without one it reads "Any subject" for
a subject, "Anything" for text, "No book" for a book, and "Any" for the other kinds.

```js
inputs: [{ id: 'subject', kind: 'facet', label: 'A subject', optional: true, any: 'Any subject' }],
choose(ctx, input) {
  const subject = input.subject;   // a facet key, or null for any subject
  // ...
}
```

Until every required input has a value, `choose` is not called and the app asks for it. A required
input left empty, and an optional input the page never offered (an `event` input in a copy with no
snapshot, a `shelf-book` input on an empty shelf), are both missing.

## 5. The rules, word for word

1. **Talk to the app only through `ctx`.** No globals of your own, no other mode's code.
2. **Never use** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.`, `window.`, `eval(`, `new Function`,
   `fetch(`, `XMLHttpRequest`, `import(`, `localStorage`, `Math.random(`, `new Date`, `Date.now(`, `setTimeout(` or
   `setInterval(`. The check reads every function in the mode as code, with comments and the words inside quotes
   left out, so a sentence like "The library could not fetch this." is fine. A failure names the word, where it is, and
   what to use instead.
   **The check is a lint, not a wall.** It reads names as they are written, so a name built from pieces
   (`'fe' + 'tch'`), a name inside a template interpolation, or a call written `fetch?.(` is not seen. It is there to
   catch the accident, not to defend against a file written to get around it. Follow the rules rather than testing
   them: in a workshop, the check is what tells a beginner the page went blank for a reason.
3. **Pure helpers go in `logic`**, and the check file tests them.
4. **Words people see go in `strings`.** About grade 6. Short sentences.
5. **Nothing invented.** Every pick is a work in `ctx.works`. No titles, authors, years or links of your own.
6. **Say what you did.** If the rule skipped books, or found fewer than six, say so in `note`. Six weak picks are worse
   than three good ones and an honest sentence.
7. **The same shelf gives the same six.** Break ties by `id`. Randomness only through `ctx.random()`.
8. **One file and its check.** `app/modes/<id>.js` and `app/modes/<id>.check.js`, plus one line in
   `app/modes/list.js` (without it the app does not show the mode, and the check warns you) and your plan in words in
   `app/PLAN.md`. Nothing else changes.

## 6. The check file

`app/modes/<id>.check.js` tests the `logic` with tiny made-up inputs. It is the same shape as Search Desk's checks:

```js
Nextbook.check('more-by', (t, mode) => {
  const L = mode.logic;
  const e = L.likedAuthors([
    { title: 'A', rating: 'liked', work: { authorKey: 'x' } },
    { title: 'B', rating: 'loved', work: { authorKey: 'x' } }]);
  t.eq(e.x.title, 'B', 'keeps the loved book when an author has two');
  t.eq(L.likedAuthors([{ title: 'C', rating: 'loved', work: null }]), {}, 'ignores books typed in');
  t.ok(mode.strings.noAuthors, 'has the sentence for an empty shelf');
});
```

`t.ok(value, message)` passes when the value is true. `t.eq(actual, expected, message)` compares plain data deeply
and, on a failure, prints what it got and what it wanted. Write the message as what should be true.

### The standard shelves

Every mode is also run, with no check file needed, against these shelves built from the practice data:

1. an empty shelf;
2. one book, rated loved;
3. every book rated "not for me";
4. only books typed in, none of them in the list;
5. the practice shelf;
6. the practice shelf again, which must give the same answer as 5;
7. the practice shelf with one friend's shelf added (a copy of the practice shelf with every rating flipped);
8. the practice shelf with one optional input left empty (`null`) and every other input at its default,
   once for each optional input the mode lists.

For each one the mode must not crash, and its answer must pass the checks in section 3. A mode that needs inputs gets
a sensible default for each (the first loved book, the first work not on the shelf, the most common subject, a short
sample text, the number's `default`, the first event in the snapshot or a two-event sample when the snapshot has
none).

Run 8 is there because the other seven only ever hand a mode a real value. A mode that crashes on `null`, or treats it
as a subject, fails this run, and the failure names the input and says the mode must work with it empty. That is the
point of `optional: true`: a filter can be left off, so the mode has to work without it.

## 7. Running the checks

- With Node: `node tools/check-mode.js <id>`. About a second. Run it after every change.
- On a Mac with no Node: `bash tools/check.sh <id>`. The same checks, through the Mac's own JavaScript.
- In the browser: open the app, go to `#selftest`, press Run. The same checks again, with no tools at all.

If a check fails, fix the mode. Do not change the check to make it pass, unless the behaviour itself was meant to
change.

## 8. What the app adds around every mode

So a mode does not have to:

- **The cards.** Title, author, year, the formats in words ("book, audiobook"), the reason, our own note if the book
  has one, and the link to the library's page.
- **Two buttons on each card:** "Want to read" (adds it to the shelf as want) and "Read it" (adds it as read, ready to
  rate). The mode runs again after either, so the six move.
- **Remembered inputs.** The last values of a mode's inputs are kept in this browser, so a person who picked a subject
  yesterday finds it picked today.
- **The model box,** under every result (section 9).
- **"Books for this event"** on `#events`. When the mode with the id `event-hook` is loaded, the button opens it on
  `#find` with that event chosen in its `event` input, ready to pick books for it. A mode with only a `text` input
  gets the event's title in that box instead, and the page says which path it took.

## 9. When a model is involved

The app already has the model box: it writes a prompt with your candidates and asks a chat to argue for two of them,
then reads the answer back and checks every id. A mode does not need to do anything for that to work.

The prompt keeps each candidate's id, title, author, year and subjects, because that is what lets a chat curate the
list rather than only restate the subject words. But **a candidate that is already on the person's shelf never goes
in**: it is dropped by work id, `groupKey`, `recordId` or normalised title, so a book typed in that never matched the
slice is caught too. Under the copy box the page says so in words, for example "The chat sees five of the six. One is
already on your shelf, so it stays out of this box." When nothing is dropped, it says nothing. A mode with
`allowShelf: true` has no box at all, because a mixed prompt would say which candidate came from the shelf.

A mode whose seed is some words (event hook, news diet) asks for a `facets` input. The control lets the person pick
subjects by hand, or press "From some words": paste the event text, copy the prompt the app writes into any chat,
paste the answer back, and the app keeps only subjects that exist in the list and names the ones it dropped. Either
way the mode receives facet keys, never the model's words. A model never chooses a book that is not in your six, and never supplies a title, an author,
a date or a link.
