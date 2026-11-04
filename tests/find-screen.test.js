'use strict';
// T3.2/T3.3a: the find screen, driven through a fake DOM (tests/fakedom.js). These are the
// page-level defects an independent review found by hand:
//
//   F1  the model box offered a prompt for a mode with allowShelf, and a prompt built from
//       the picks can carry a book from the person's shelf (AGENTS.md rule 1)
//   F3  the "Paste the answer first." note stayed after a good answer, and an empty submit
//       left the last cards up
//   F4  the box was drawn only when there was a pick, though T3.3a says "under any result"
//   F6  a stored number outside min/max reached choose unclamped
//   F8  the chosen mode was not remembered on reload, though its inputs and seed were
//
// The window's setTimeout does nothing: the page lists modes that are already registered, and
// the harness does not need the second render a mode file's load would bring. Objects come
// from a vm realm, so compare after a JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./_load.js');
const { createDocument, all, byTest, withPrefix } = require('./fakedom.js');

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const SLICE = read('data/slice.json');
const PRACTICE = read('data/practice.json');
const SHELF_FIRST = PRACTICE.entries[0];   // The Dispossessed, on the practice shelf
const SHELF_TITLE = SHELF_FIRST.title;

const CORE = [
  'app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
  'app/core/links.js', 'app/core/contract.js', 'app/core/seam.js', 'app/core/store.js',
];

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    raw(key) { return map.get(key); },
  };
}

// A mode whose picks may be on the shelf (CONTRACT.md section 2), and one whose picks may not.
function shelfMode() {
  return {
    id: 'shelf-pick',
    name: 'From the shelf',
    purpose: 'Picks a book that is already on the shelf.',
    shape: 'list',
    allowShelf: true,
    inputs: [],
    strings: {},
    choose(ctx) {
      const e = ctx.shelf[0];
      if (!e || !e.work) return { picks: [], note: 'Nothing on the shelf to try yet.' };
      return { picks: [{ id: e.work.id, why: 'It is already on your shelf, and it still fits.' }] };
    },
  };
}

function plainMode(id) {
  return {
    id,
    name: 'From the list',
    purpose: 'Picks a book from the list.',
    shape: 'list',
    inputs: [],
    strings: {},
    choose(ctx) {
      const w = ctx.works.find((x) => !ctx.onShelf(x.id));
      if (!w) return { picks: [], note: 'Nothing in the list fits yet.' };
      return { picks: [{ id: w.id, why: 'It is the first book in the list that is not on your shelf.' }] };
    },
  };
}

function emptyMode() {
  return {
    id: 'empty-pick',
    name: 'Nothing today',
    purpose: 'Finds nothing on purpose.',
    shape: 'list',
    inputs: [],
    strings: {},
    choose() { return { picks: [], note: 'Nothing fits this shelf today.' }; },
  };
}

function numberMode() {
  return {
    id: 'number-pick',
    name: 'A number',
    purpose: 'Asks for a number, to test the range.',
    shape: 'list',
    inputs: [{ id: 'n', kind: 'number', min: 1, max: 5, default: 99, label: 'How many' }],
    strings: {},
    choose(ctx, input) {
      const w = ctx.works.find((x) => !ctx.onShelf(x.id));
      if (!w) return { picks: [], note: 'Nothing in the list fits yet.' };
      return { picks: [{ id: w.id, why: 'Number ' + input.n + ' was asked for.' }] };
    },
  };
}

// D34: two candidates, one of which has the same title as a typed shelf book.
function shelfTitleMode() {
  return {
    id: 'shelf-title',
    name: 'Two books',
    purpose: 'Picks two books from the list.',
    shape: 'list',
    inputs: [],
    strings: {},
    choose() {
      return { picks: [
        { id: 'left-hand', why: 'It is the first book in the list that is not on your shelf.' },
        { id: 'oryx', why: 'It is the second book in the list that is not on your shelf.' },
      ] };
    },
  };
}

// The practice shelf, but with one book typed in that never matched the slice.
const TYPED_PRACTICE = {
  schema: 'nextbook/practice-1',
  entries: [{
    key: 't:the left hand of darkness|ursula k. le guin', title: 'THE LEFT HAND of Darkness',
    author: 'Ursula K. Le Guin', state: 'read', rating: 'loved',
  }],
};

// An event input (D35): the mode records what choose was given, so the test can see the
// object itself and not only the words on the page.
let lastEvent = null;
function eventMode() {
  return {
    id: 'event-pick',
    name: 'Something at the library',
    purpose: 'Picks a book for an event.',
    shape: 'list',
    inputs: [{ id: 'event', kind: 'event', label: 'Which event' }],
    strings: {},
    choose(ctx, input) {
      lastEvent = input && input.event ? input.event : null;
      const w = ctx.works.find((x) => !ctx.onShelf(x.id));
      if (!w) return { picks: [], note: 'Nothing in the list fits yet.' };
      return { picks: [{ id: w.id, why: 'It is for ' + (input.event ? input.event.title : 'no event') + '.' }] };
    },
  };
}

const EVENTS = {
  fetched: '2026-11-03T19:49:50-05:00',
  branch: 'CL',
  window: { start: '2026-11-03', end: '2026-11-24' },
  source: 'example',
  events: [
    {
      id: 'e2', title: 'Evening Talk', start: '2026-11-04T18:30:00', end: '2026-11-04T19:30:00',
      branch: 'North York Central Library', virtual: true, categories: ['Talks'], summary: 'An author speaks.',
      url: 'https://example.test/events/e2',
    },
    {
      id: 'e1', title: 'Introduction to Serger Sewing', start: '2026-11-03T18:00:00',
      end: '2026-11-03T20:00:00', branch: 'North York Central Library', virtual: false,
      categories: [], summary: 'Learn the basics.', url: 'https://example.test/events/e1',
    },
  ],
};

// Load core through store.js, put the data in, register the modes, then load the shell, which
// boots on load because the fake document is already complete.
function openFind(opts) {
  const options = opts || {};
  const doc = createDocument();
  const app = doc.createElement('main');
  app.setAttribute('id', 'app');
  doc.body.appendChild(app);

  const window = {
    console,
    document: doc,
    location: { hash: options.hash || '#find' },
    addEventListener() {},
    setTimeout() { return 0; },
    clearTimeout() {},
  };
  if (options.storage) window.localStorage = options.storage;
  window.window = window;

  const ctx = vm.createContext(window);
  const run = (rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  CORE.forEach(run);

  const nb = window.Nextbook;
  nb.data.put('slice', options.slice || SLICE);
  nb.data.put('tags', { schema: 'nextbook/tags-1', vocab: {}, works: {} });
  nb.data.put('practice', options.practice || PRACTICE);
  if (options.events) nb.data.put('events', options.events);

  const defs = options.defs || [];
  defs.forEach((def) => nb.mode(def));
  nb.modes = defs.map((def) => def.id);

  if (options.seedStore) options.seedStore(nb.store.open(options.storage));

  run('app/core/shell.js');
  return { nb, doc, app };
}

const textareas = (doc) => all(doc, 'textarea');

test('F1: a mode that may pick a shelf book never gets a prompt, and a plain mode still does', () => {
  const { nb, doc } = openFind({ defs: [shelfMode(), plainMode('plain-pick')] });

  // The chosen mode is the first one, and it picked a book that is on the shelf.
  const chosen = nb.t('modeShowing');
  assert.ok(doc.body.textContent.indexOf(chosen) !== -1, 'the first mode is the one showing');
  const pick = byTest(doc, 'pick-1');
  assert.ok(pick, 'the mode produced a card');
  assert.strictEqual(pick.getAttribute('data-pick'), SHELF_FIRST.id, 'the pick is the shelf book');
  assert.ok(pick.textContent.indexOf(SHELF_TITLE) !== -1, 'and the card names it, as the card may');

  // ...and the model box is closed, with no prompt and no copy button anywhere.
  assert.ok(byTest(doc, 'model-box'), 'the box is under the result');
  assert.ok(!byTest(doc, 'model-prompt'), 'no prompt is drawn');
  assert.ok(!byTest(doc, 'model-copy'), 'no copy button is drawn');
  assert.ok(!byTest(doc, 'model-answer'), 'and no answer box to feed a prompt');
  const closed = byTest(doc, 'model-closed');
  assert.ok(closed, 'the sentence that says why is there');
  assert.strictEqual(closed.textContent, nb.t('modelShelfClosed'));
  const typed = textareas(doc).map((el) => el.textContent + el.value).join('\n');
  assert.strictEqual(typed.indexOf(SHELF_TITLE), -1, 'no textarea on the page holds the shelf title');
  assert.strictEqual(doc.body.textContent.indexOf('- ' + SHELF_FIRST.id + ' |'), -1, 'no prompt line at all');

  // A mode that cannot pick a shelf book keeps its prompt, built from the list's own words.
  byTest(doc, 'mode-pick-plain-pick').click();
  const prompt = byTest(doc, 'model-prompt');
  assert.ok(prompt, 'the plain mode has a prompt');
  assert.ok(byTest(doc, 'model-copy'), 'and a copy button');
  assert.ok(byTest(doc, 'model-answer'), 'and an answer box');
  assert.ok(prompt.textContent.indexOf(SHELF_TITLE) === -1, 'the shelf title is not in it');
  assert.ok(doc.body.textContent.indexOf(nb.t('modelShelfClosed')) === -1, 'the closed sentence is gone');
});

test('F4: the box is under a result with no picks, saying there is nothing to argue about', () => {
  const { nb, doc } = openFind({ defs: [emptyMode()] });
  assert.ok(byTest(doc, 'find-result'), 'the result is drawn');
  assert.ok(!byTest(doc, 'pick-list'), 'with no books in it');
  const box = byTest(doc, 'model-box');
  assert.ok(box, 'T3.3a: the box is under any result');
  assert.ok(!byTest(doc, 'model-prompt'), 'a prompt would ask a chat about nothing');
  assert.strictEqual(byTest(doc, 'model-closed').textContent, nb.t('modelNothing'));
});

test('F3: a good answer clears the note, an empty submit clears the cards', () => {
  const { nb, doc } = openFind({ defs: [plainMode('plain-pick')] });
  const id = byTest(doc, 'pick-1').getAttribute('data-pick');
  const status = () => all(doc, '[role]').filter((el) => el.getAttribute('role') === 'status')
    .map((el) => el.textContent).join(' ');

  // A read starts clean: the note goes, and the answer's cards appear.
  let answer = byTest(doc, 'model-answer');
  answer.value = id + ': It is short and strange.';
  byTest(doc, 'model-check').click();
  assert.ok(byTest(doc, 'model-card-1'), 'the answer was read');
  assert.strictEqual(status().indexOf(nb.t('modelNeedAnswer')), -1, 'no stale "paste the answer first"');

  // An empty submit clears the cards and says what is missing.
  answer = byTest(doc, 'model-answer');
  answer.value = '';
  byTest(doc, 'model-check').click();
  assert.ok(!byTest(doc, 'model-card-1'), 'the last cards are put away');
  assert.ok(status().indexOf(nb.t('modelNeedAnswer')) !== -1, 'and the page asks for the answer');

  // A good answer after the note clears the note again.
  answer = byTest(doc, 'model-answer');
  answer.value = id + ': A second read of the same book.';
  byTest(doc, 'model-check').click();
  assert.ok(byTest(doc, 'model-card-1'), 'the second answer was read');
  assert.strictEqual(status().indexOf(nb.t('modelNeedAnswer')), -1, 'and the note is gone');
});

test('F6: a stored or default number outside min/max is clamped before choose', () => {
  const storage = memoryStorage();
  const { nb, doc } = openFind({
    defs: [numberMode()],
    storage,
    seedStore(store) { store.setInputs('number-pick', { n: 99 }); },
  });
  assert.strictEqual(byTest(doc, 'input-n').getAttribute('value'), '5', 'the box shows the top of the range, not 99');
  assert.ok(byTest(doc, 'pick-1').textContent.indexOf('Number 5 was asked for.') !== -1,
    'and choose was given the clamped number');
  assert.strictEqual(nb.store.open(storage).inputs('number-pick').n, 99, 'the stored value itself is untouched');
});

test('F6: a default outside min/max is clamped too', () => {
  const { doc } = openFind({ defs: [numberMode()] });
  assert.strictEqual(byTest(doc, 'input-n').getAttribute('value'), '5', 'a default of 99 shows as 5');
  assert.ok(byTest(doc, 'pick-1').textContent.indexOf('Number 5 was asked for.') !== -1);
});

test('F8: the mode chosen last is the one #find opens on after a reload', () => {
  const storage = memoryStorage();
  const first = openFind({ defs: [plainMode('alpha'), plainMode('beta')], storage });
  assert.ok(byTest(first.doc, 'mode-current-alpha'), 'the first visit opens on the first mode');

  byTest(first.doc, 'mode-pick-beta').click();
  assert.ok(byTest(first.doc, 'mode-current-beta'), 'the second mode is showing');
  assert.strictEqual(storage.raw('nextbook-mode-last-v1'), '"beta"', 'the choice is written down');

  const second = openFind({ defs: [plainMode('alpha'), plainMode('beta')], storage });
  assert.ok(byTest(second.doc, 'mode-current-beta'), 'a reload opens on the mode chosen last');
  assert.ok(!byTest(second.doc, 'mode-current-alpha'), 'the earlier mode is not showing');
  assert.strictEqual(plain(second.nb.store.open(storage).lastMode()), 'beta');
});

test('F8: a remembered mode that is no longer listed falls back to the first', () => {
  const storage = memoryStorage();
  storage.setItem('nextbook-mode-last-v1', '"gone"');
  const { doc } = openFind({ defs: [plainMode('alpha'), plainMode('beta')], storage });
  assert.ok(byTest(doc, 'mode-current-alpha'), 'the first listed mode is shown instead');
});

// ---- D34: the prompt keeps titles, but not a work on the shelf -------------------------------

test('D34: a candidate the person has typed in stays out of the prompt, and the page says how many', () => {
  const { nb, doc } = openFind({ defs: [shelfTitleMode()], practice: TYPED_PRACTICE });

  const prompt = byTest(doc, 'model-prompt');
  assert.ok(prompt, 'the box still offers a prompt');
  assert.strictEqual(prompt.textContent.indexOf('The Left Hand of Darkness'), -1,
    'the typed shelf title is not in the prompt');
  assert.strictEqual(prompt.textContent.indexOf('left-hand'), -1, 'nor its id');
  assert.ok(prompt.textContent.indexOf('oryx') !== -1, 'the other candidate keeps its title');
  assert.ok(prompt.textContent.indexOf('Oryx and Crake') !== -1);

  const said = byTest(doc, 'model-excluded');
  assert.ok(said, 'the page says what was left out');
  assert.strictEqual(said.textContent,
    'The chat sees one of the two. One is already on your shelf, so it stays out of this box.');
  assert.strictEqual(said.textContent, nb.t('modelExcludedOne', { seen: 'one', total: 'two' }));

  // The card still names the book: only the prompt may not carry it.
  assert.ok(byTest(doc, 'pick-1').textContent.indexOf('The Left Hand of Darkness') !== -1);
});

test('D34: with nothing left out there is no sentence, and the prompt is the usual one', () => {
  const { nb, doc } = openFind({ defs: [plainMode('plain-pick')] });
  assert.ok(byTest(doc, 'model-prompt'), 'a prompt is drawn');
  assert.strictEqual(byTest(doc, 'model-excluded'), null, 'and no sentence about leaving books out');
  assert.strictEqual(doc.body.textContent.indexOf(nb.t('modelExcludedOne', { seen: 'one', total: 'two' })), -1);
});

// ---- D35: an `event` input -------------------------------------------------------------------

test('D35: an event input is a picker of the snapshot, and choose receives the event object', () => {
  lastEvent = null;
  const { nb, doc } = openFind({ defs: [eventMode()], events: EVENTS });

  const picker = byTest(doc, 'input-event');
  assert.ok(picker, 'the control is drawn');
  assert.strictEqual(picker.tagName, 'SELECT');
  assert.strictEqual(picker.getAttribute('aria-label'), 'Which event');

  // Grouped by day, in the snapshot's own order: the 3rd, then the 4th.
  const labels = picker.options.map((o) => o.textContent);
  assert.deepStrictEqual(plain(labels), [
    'Choose one',
    'Tuesday, November 3: Introduction to Serger Sewing',
    'Wednesday, November 4: Evening Talk',
  ]);
  assert.ok(byTest(doc, 'find-needs-input'), 'nothing is chosen yet, so choose is not called');
  assert.strictEqual(lastEvent, null);

  // Choosing one runs the mode again with the event itself.
  picker.value = 'e1';
  picker.dispatch('change', { type: 'change', target: picker });

  assert.deepStrictEqual(plain(lastEvent), EVENTS.events[1], 'choose got the whole event object');
  assert.ok(byTest(doc, 'pick-1').textContent.indexOf('It is for Introduction to Serger Sewing.') !== -1,
    'and used it');
  assert.strictEqual(byTest(doc, 'input-event').value, 'e1', 'the choice is remembered, as every input is');
});

test('D35: with no snapshot the page says so, and choose is not called', () => {
  lastEvent = null;
  const { nb, doc } = openFind({ defs: [eventMode()] });

  assert.strictEqual(byTest(doc, 'input-event'), null, 'there is nothing to pick from');
  const said = withPrefix(doc, 'input-event-').concat(all(doc, '.nb-note'))
    .map((el) => el.textContent).join(' ');
  assert.ok(said.indexOf(nb.t('inputNoEvents')) !== -1, 'a sentence says why, got: ' + said);
  assert.strictEqual(lastEvent, null, 'choose was not called');
  assert.strictEqual(byTest(doc, 'pick-1'), null);
});
