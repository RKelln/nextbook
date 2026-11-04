'use strict';
// T8.9d: the helper's note, brought into the page once, on the shelf screen, through a fake
// DOM (tests/fakedom.js). The page is built twice on one storage to stand in for a reload: a
// reload is a fresh page, and that is the only honest way to test "does nothing at all".
//
//   N1  a valid note is applied once, and the note says how many came in
//   N2  reloading the same note writes nothing and says nothing; a new note applies again
//   N3  a record two days ahead is refused and named, one an hour ahead is taken
//   N4  a bad schema changes nothing and says so once
//   N5  one Undo puts the shelf back exactly
//   N6  the practice shelf takes it, and so does a workshop copy
//
// Objects come from a vm realm, so compare after a JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./_load.js');
const { createDocument, byTest, withPrefix } = require('./fakedom.js');

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const SLICE = read('data/slice.json');
const PRACTICE = read('data/practice.json');

const CORE = [
  'app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
  'app/core/links.js', 'app/core/contract.js', 'app/core/seam.js', 'app/core/store.js',
  'app/core/merge.js', 'app/core/import.js', 'app/core/inbox.js',
];

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const SOON = iso(NOW + 3600 * 1000);            // an hour ahead: the day's slack
const LATER = iso(NOW + 2 * 24 * 3600 * 1000);  // two days ahead: a mistake, not news

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    raw(key) { return map.get(key); },
  };
}

const PIRANESI = {
  key: 't:piranesi|susanna clarke', title: 'Piranesi', author: 'Susanna Clarke',
  state: 'want', rating: null, updated: '2026-01-01T00:00:00Z',
};
const DISPOSSESSED = {
  key: 't:dispossessed|ursula k le guin', title: 'The Dispossessed',
  author: 'Ursula K. Le Guin', state: 'want', rating: 'liked', updated: '2026-01-01T00:00:00Z',
};
const OWN = [PIRANESI, DISPOSSESSED];

const STATION = {
  key: 'w:pack:station-eleven', title: 'Station Eleven', author: 'Emily St. John Mandel',
  state: 'want', rating: null, updated: SOON,
};
const KINDRED = {
  key: 't:kindred|octavia e butler', title: 'Kindred', author: 'Octavia E. Butler',
  state: 'want', rating: null, updated: SOON,
};
const LEFT_HAND = {
  key: 't:left hand of darkness|ursula k le guin', title: 'The Left Hand of Darkness',
  author: 'Ursula K. Le Guin', state: 'read', rating: 'loved', updated: SOON,
};
const ATUAN = {
  key: 't:tombs of atuan|ursula k le guin', title: 'The Tombs of Atuan',
  author: 'Ursula K. Le Guin', state: 'reading', rating: null, updated: SOON,
};

// Piranesi changes at the helper; three books are new. One note, four changes.
const FOUR = [
  Object.assign({}, PIRANESI, { state: 'read', rating: 'liked', updated: SOON }),
  STATION, KINDRED, LEFT_HAND,
];

function note(records, id) {
  return {
    schema: 'nextbook/inbox-1',
    id: id || 'a1b2c3d4e5f60718',
    records: plain(records),
    source: 'ai',
    updated: iso(NOW),
  };
}

// One page, booted. `inbox` goes in before the shell loads, because boot is what reads it.
function page(opts) {
  const options = opts || {};
  const doc = createDocument();
  const app = doc.createElement('main');
  app.setAttribute('id', 'app');
  doc.body.appendChild(app);

  const storage = options.storage || memoryStorage();
  const window = {
    console,
    document: doc,
    location: { hash: options.hash || '#shelf' },
    addEventListener() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    localStorage: storage,
  };
  window.window = window;

  const ctx = vm.createContext(window);
  const run = (rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  CORE.forEach(run);

  const nb = window.Nextbook;
  nb.data.put('slice', SLICE);
  nb.data.put('tags', { schema: 'nextbook/tags-1', vocab: {}, works: {} });
  nb.data.put('practice', PRACTICE);
  if (options.workshop) nb.data.put('workshop', { workshop: true });
  if (options.inbox) nb.data.put('inbox', plain(options.inbox));
  if (options.seed) options.seed(nb.store.open(storage));

  run('app/core/shell.js');
  return { nb, doc, app, storage };
}

function ownPage(opts) {
  const options = Object.assign({}, opts || {});
  const reseed = options.reseed !== false;
  delete options.reseed;
  if (reseed) {
    options.seed = (store) => {
      store.use('own');
      store.replace(OWN);
    };
  }
  return page(options);
}

const said = (doc) => {
  const el = byTest(doc, 'inbox-said');
  return el ? el.textContent : '';
};

test('N1: a valid note is applied once, and the note says how many came in', () => {
  const { nb, doc, storage } = ownPage({ inbox: note(FOUR) });

  assert.strictEqual(said(doc), 'Brought in 4 changes from your helper.');
  assert.strictEqual(said(doc), nb.t('inboxNote', { n: 4 }));
  assert.strictEqual(byTest(doc, 'inbox-kept'), null, 'every one of the four landed');

  const shelf = plain(nb.store.open(storage).shelf());
  assert.strictEqual(shelf.length, 5, 'two from before, three new, one changed');
  const piranesi = shelf.filter((e) => e.key === PIRANESI.key)[0];
  assert.strictEqual(piranesi.state, 'read', 'the newer entry from the helper won');
  assert.strictEqual(piranesi.rating, 'liked');
  ['Station Eleven', 'Kindred', 'The Left Hand of Darkness'].forEach((title) => {
    assert.strictEqual(shelf.filter((e) => e.title === title).length, 1, title + ' is on the shelf once');
  });

  // The note and its one Undo are drawn on the shelf screen, before the shelf itself.
  assert.ok(byTest(doc, 'inbox-note'));
  assert.ok(byTest(doc, 'inbox-undo'), 'one Undo for the whole note');
  assert.ok(doc.body.textContent.indexOf(nb.t('shelfCount', { n: 5 })) !== -1, 'the count line agrees');

  const applied = JSON.parse(storage.raw('nextbook-inbox-applied-v1'));
  assert.deepStrictEqual(applied, ['a1b2c3d4e5f60718'], 'the note\'s name is kept, newest last');
});

test('N2: a reload with the same note writes nothing and says nothing; a new one applies', () => {
  const storage = memoryStorage();
  const first = ownPage({ storage, inbox: note(FOUR) });
  const shelfAfter = storage.raw('nextbook-own-v1');
  const appliedAfter = storage.raw('nextbook-inbox-applied-v1');

  // The same note, a fresh page: no note on the screen, and not one byte written.
  const second = ownPage({ storage, inbox: note(FOUR), reseed: false });
  assert.strictEqual(byTest(second.doc, 'inbox-note'), null, 'a reload says nothing');
  assert.strictEqual(storage.raw('nextbook-own-v1'), shelfAfter, 'the shelf was not written');
  assert.strictEqual(storage.raw('nextbook-inbox-applied-v1'), appliedAfter, 'and the list was not either');
  assert.strictEqual(plain(second.nb.store.open(storage).shelf()).length, 5);

  // A second render of the page already up changes nothing either.
  second.nb.shell.render();
  assert.strictEqual(storage.raw('nextbook-own-v1'), shelfAfter);

  // A new note, with a new name, applies again.
  const third = ownPage({ storage, inbox: note([ATUAN], 'ffffffffffffffff'), reseed: false });
  assert.strictEqual(said(third.doc), 'Brought in 1 change from your helper.');
  assert.strictEqual(plain(third.nb.store.open(storage).shelf()).length, 6);
  assert.deepStrictEqual(JSON.parse(storage.raw('nextbook-inbox-applied-v1')),
    ['a1b2c3d4e5f60718', 'ffffffffffffffff'], 'newest last');
  assert.ok(first.doc.body.textContent.indexOf(first.nb.t('inboxNote', { n: 4 })) !== -1);
});

test('N3: a record two days ahead is refused and named, one an hour ahead is taken', () => {
  const soon = Object.assign({}, STATION, { updated: SOON });
  const future = Object.assign({}, KINDRED, { updated: LATER });
  const { nb, doc, storage } = ownPage({ inbox: note([soon, future]) });

  assert.strictEqual(said(doc), 'Brought in 1 change from your helper.');
  const refused = byTest(doc, 'inbox-refused-1');
  assert.ok(refused, 'the refusal is drawn under the note');
  assert.strictEqual(refused.textContent,
    '"Kindred" says it was changed after today, so it was left out.');
  assert.strictEqual(withPrefix(doc, 'inbox-refused-').length, 1, 'one sentence, once');

  const shelf = plain(nb.store.open(storage).shelf());
  assert.ok(shelf.filter((e) => e.title === 'Station Eleven').length === 1, 'the hour ahead came in');
  assert.strictEqual(shelf.filter((e) => e.title === 'Kindred').length, 0, 'the future one did not');
});

test('N4: a bad schema changes nothing and says so once', () => {
  const doc = Object.assign(note(FOUR), { schema: 'nextbook/inbox-9' });
  const { nb, doc: dom, storage } = ownPage({ inbox: doc });
  const rawShelf = storage.raw('nextbook-own-v1');

  assert.strictEqual(said(dom),
    'That note was saved by a different version of the app, so nothing was brought in.');
  assert.strictEqual(withPrefix(dom, 'inbox-said').length, 1, 'said once');
  assert.strictEqual(storage.raw('nextbook-own-v1'), rawShelf, 'not one byte written');
  assert.strictEqual(storage.raw('nextbook-inbox-applied-v1'), undefined, 'and not marked as read');
  assert.strictEqual(byTest(dom, 'inbox-undo'), null, 'there is nothing to undo');
  assert.strictEqual(plain(nb.store.open(storage).shelf()).length, 2);
});

test('N5: one Undo puts the shelf back exactly', () => {
  const { nb, doc, storage } = ownPage({ inbox: note(FOUR) });
  const store = nb.store.open(storage);
  const before = plain(OWN);
  assert.strictEqual(plain(store.shelf()).length, 5, 'the note was applied');

  byTest(doc, 'inbox-undo').click();

  assert.deepStrictEqual(plain(nb.store.open(storage).shelf()), before, 'exactly the shelf from before');
  assert.deepStrictEqual(plain(store.shelf()), before);
  assert.strictEqual(byTest(doc, 'inbox-note'), null, 'the note is put away with it');
  assert.strictEqual(byTest(doc, 'inbox-undo'), null, 'and there is no second Undo');
  assert.ok(doc.body.textContent.indexOf(nb.t('inboxUndone')) !== -1, 'the page says it was undone');

  // Reloading after an Undo still does nothing: the note stays read, as the person asked.
  const again = ownPage({ storage, inbox: note(FOUR), reseed: false });
  assert.strictEqual(byTest(again.doc, 'inbox-note'), null);
  assert.deepStrictEqual(plain(again.nb.store.open(storage).shelf()), before);
});

test('N6: the practice shelf takes it, and so does a workshop copy', () => {
  const practice = page({ inbox: note([STATION]) });
  assert.strictEqual(said(practice.doc), 'Brought in 1 change from your helper.');
  assert.ok(plain(practice.nb.store.open(practice.storage).shelf())
    .some((e) => e.title === 'Station Eleven'), 'the practice shelf took the book');
  assert.ok(practice.storage.raw('nextbook-practice-v1') !== undefined);

  const workshop = page({ workshop: true, inbox: note([LEFT_HAND], '0123456789abcdef') });
  assert.strictEqual(said(workshop.doc), 'Brought in 1 change from your helper.');
  assert.ok(plain(workshop.nb.store.open(workshop.storage).shelf())
    .some((e) => e.title === 'The Left Hand of Darkness'), 'a workshop shelf is made up, so it may take it');
  assert.strictEqual(workshop.storage.raw('nextbook-own-v1'), undefined, 'nothing on the own shelf');
});
