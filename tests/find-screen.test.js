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
