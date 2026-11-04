'use strict';
// T8.9b: bringing a reading list in, on the shelf screen, driven through a fake DOM
// (tests/fakedom.js). No network, no real files: the CSV is a string, and the file input is
// driven through a small fake FileReader so the wiring is exercised, not only the handler.
//
//   I1  an ordinary copy draws the block: a labelled file input that takes a CSV
//   I2  a Goodreads file is detected by its header, written once, and reported in words
//   I3  one Undo puts the shelf back exactly, and says so
//   I4  a file that is neither site says what it found and changes nothing
//   I5  a row with no title is named
//   I6  a StoryGraph file is detected by "Read Status"
//   I7  a workshop copy draws the refusal and no input at all
//   I8  the practice shelf refuses, and does not write
//
// Objects come from a vm realm, so compare after a JSON round trip (AGENTS.md).
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

const CORE = [
  'app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
  'app/core/links.js', 'app/core/contract.js', 'app/core/seam.js', 'app/core/store.js',
  'app/core/merge.js', 'app/core/import.js',
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

// A browser's FileReader, near enough: readAsText hands back the text the fake file carries and
// calls onload, which is all core/shell.js's readChosen uses.
function FakeFileReader() { this.result = ''; this.onload = null; this.onerror = null; }
FakeFileReader.prototype.readAsText = function (file) {
  if (!file || typeof file.text !== 'string') { if (this.onerror) this.onerror(); return; }
  this.result = file.text;
  if (this.onload) this.onload();
};

// Two books here, one remembered from the library last time. The CSV below agrees with one,
// disagrees with the other, and brings two new ones.
const PIRANESI = {
  key: 't:piranesi|susanna clarke', title: 'Piranesi', author: 'Susanna Clarke',
  state: 'want', rating: null, updated: '2026-01-01T00:00:00Z',
  library: { shelf: 'for_later', rating10: 0, seen: '2026-01-01T00:00:00Z' },
};
const DISPOSSESSED = {
  key: 't:the dispossessed|ursula k. le guin', title: 'The Dispossessed',
  author: 'Ursula K. Le Guin', state: 'want', rating: 'liked', updated: '2026-01-01T00:00:00Z',
};
const OWN = [PIRANESI, DISPOSSESSED];

// A real Goodreads export header: "Exclusive Shelf" is what names the site. The last row has no
// title, so the reader must name it rather than drop it in silence.
const GOODREADS = [
  'Title,Author,ISBN,My Rating,Exclusive Shelf,Date Added',
  'Piranesi,Susanna Clarke,="9781635575637",4,read,2026-01-02',
  'The Dispossessed,Ursula K. Le Guin,="9780061054884",5,read,2025-12-01',
  'Station Eleven,Emily St. John Mandel,,0,to-read,2026-02-03',
  'Kindred,Octavia E. Butler,,4.5,currently-reading,2026-03-04',
  ',,,,read,2026-03-05',
  '',
].join('\r\n');

const STORYGRAPH = [
  'Title,Authors,Read Status,Star Rating,Date Added',
  'Piranesi,Susanna Clarke,did-not-finish,2,2026-01-02',
  '',
].join('\n');

function openShelf(opts) {
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
    FileReader: FakeFileReader,
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
  if (options.seed) options.seed(nb.store.open(storage));

  run('app/core/shell.js');
  return { nb, doc, app, storage };
}

// The shelf screen with someone's own shelf in use, and two books on it.
function ownShelf(opts) {
  const options = Object.assign({}, opts || {});
  options.seed = (store) => {
    store.use('own');
    store.replace(OWN);
    if (options.afterSeed) options.afterSeed(store);
  };
  return openShelf(options);
}

// The data-test names in the order they were drawn, for "before the input" checks.
function drawnOrder(doc) {
  return all(doc, '[data-test]').map((el) => el.getAttribute('data-test'));
}

const said = (doc) => {
  const el = byTest(doc, 'list-said');
  return el ? el.textContent : '';
};

test('I1: an ordinary copy draws the block, with a labelled file input for a CSV', () => {
  const { nb, doc } = ownShelf();

  assert.ok(byTest(doc, 'shelf-list-import'), 'the block is on the shelf screen');
  assert.strictEqual(byTest(doc, 'shelf-list-import').getAttribute('tabindex'), '-1',
    'the block can take the cursor back after a report');
  assert.ok(doc.body.textContent.indexOf(nb.t('listHeading')) !== -1, 'its heading is there');
  assert.ok(doc.body.textContent.indexOf(nb.t('listHelp')) !== -1, 'and the sentence about the file');

  const input = byTest(doc, 'shelf-list-file');
  assert.ok(input, 'the input is drawn');
  assert.strictEqual(input.getAttribute('type'), 'file');
  assert.strictEqual(input.getAttribute('accept'), '.csv,text/csv');
  assert.strictEqual(input.getAttribute('aria-label'), nb.t('listChoose'), 'it is labelled');
  assert.ok(input.parentNode.tagName === 'LABEL' || input.parentNode.parentNode.tagName === 'LABEL',
    'and the label wraps it, so the words are attached');

  // Own shelf: no refusal sentence.
  assert.strictEqual(byTest(doc, 'list-off'), null, 'nothing is switched off on this shelf');
});

test('I2: a Goodreads file is chosen, read, merged, written once and reported in words', () => {
  const { nb, doc, storage } = ownShelf();
  const store = nb.store.open(storage);
  const before = plain(store.shelf());

  // Through the real input, with a fake FileReader: this is the path a person takes.
  const input = byTest(doc, 'shelf-list-file');
  input.files = [{ name: 'goodreads_export.csv', text: GOODREADS }];
  input.dispatch('change', { type: 'change', target: input });

  assert.strictEqual(said(doc), 'Added 2 books. Updated 1 that changed at the library. 1 is different here.');
  assert.strictEqual(said(doc), nb.t('listAdded', { n: 2 }) + ' ' + nb.t('listUpdatedOne') + ' ' + nb.t('listKeptOne'));

  const after = plain(nb.store.open(storage).shelf());
  assert.strictEqual(after.length, before.length + 2, 'the two new books are on the shelf');
  const titles = after.map((e) => e.title);
  assert.ok(titles.indexOf('Station Eleven') !== -1 && titles.indexOf('Kindred') !== -1);
  assert.ok(JSON.stringify(after).indexOf('"from":"goodreads"') !== -1, 'they say where they came from');

  // The remembered book followed the library: read, four stars.
  const piranesi = after.filter((e) => e.title === 'Piranesi')[0];
  assert.strictEqual(piranesi.state, 'read');
  assert.strictEqual(piranesi.rating, 'liked');
  assert.strictEqual(piranesi.library.rating10, 8);

  // The disagreement is ours, and it is listed with both sides.
  const dispossessed = after.filter((e) => e.title === 'The Dispossessed')[0];
  assert.strictEqual(dispossessed.state, 'want', 'what is here was kept');
  const choose = byTest(doc, 'list-choose-row-1');
  assert.ok(choose, 'the book is in "Which is right?"');
  assert.ok(choose.textContent.indexOf('The Dispossessed') !== -1, 'named by its title');
  assert.ok(choose.textContent.indexOf('Here: want to read, liked. At the library: Completed.') !== -1,
    'with what is here and what the library says, got: ' + choose.textContent);
  assert.strictEqual(byTest(doc, 'list-tidy'), null, 'and there is nothing to tidy up');

  // A row for a book the app already carries becomes that work: Station Eleven is in the
  // slice, so it arrives with the work's id and is not "not at the library yet".
  const station = after.filter((e) => e.title === 'Station Eleven')[0];
  assert.ok(station.id, 'the slice work was found for Station Eleven');
  assert.strictEqual(station.groupKey, 'pack:station-eleven', 'and it is that work');
  assert.strictEqual(station.key, 'w:pack:station-eleven', 'keyed like every other work on the shelf');
  assert.strictEqual(after.filter((e) => e.title === 'Station Eleven').length, 1, 'no duplicate of it');

  // "Not at the library yet (1)": imported, not in the slice, with the search link.
  const missing = withPrefix(doc, 'list-not-yet-row-');
  assert.strictEqual(missing.length, 1);
  assert.ok(doc.body.textContent.indexOf(nb.t('listNotYet', { n: 1 })) !== -1);
  assert.ok(doc.body.textContent.indexOf(nb.t('listNotYetHelp')) !== -1);
  missing.forEach((li) => {
    const link = li.childNodes.filter((c) => c.tagName === 'A')[0];
    assert.ok(link, 'each has a link');
    assert.ok(/^https?:/.test(link.getAttribute('href')), 'and it is a catalogue search');
    assert.ok(link.getAttribute('href').indexOf('Kindred') !== -1,
      'by its own title: ' + link.getAttribute('href'));
  });

  // The row with no title is named, not dropped in silence.
  assert.ok(doc.body.textContent.indexOf('Row 6 has no title') !== -1,
    'the reader said which row it could not read');

  // One Undo for the whole import, and the cursor is back in the block.
  assert.ok(byTest(doc, 'shelf-list-undo'), 'one Undo');
  assert.strictEqual(doc.activeElement.getAttribute('data-test'), 'shelf-list-import',
    'focus comes back to the import block');
});

test('I3: one Undo puts the shelf back exactly, and says so', () => {
  const { nb, doc, storage } = ownShelf();
  const store = nb.store.open(storage);
  const before = plain(store.shelf());

  nb.shell.importReadingList(GOODREADS);
  assert.notStrictEqual(plain(store.shelf()).length, before.length, 'the import changed the shelf');

  byTest(doc, 'shelf-list-undo').click();

  assert.deepStrictEqual(plain(nb.store.open(storage).shelf()), before, 'exactly the shelf from before');
  assert.deepStrictEqual(plain(store.shelf()), before);
  assert.ok(doc.body.textContent.indexOf(nb.t('listUndone')) !== -1, 'the page says it was undone');
  assert.strictEqual(byTest(doc, 'list-report'), null, 'the report is put away with it');
  assert.strictEqual(byTest(doc, 'shelf-list-undo'), null, 'and there is no second Undo');

  // Nothing about the import is left in storage: only the shelf itself, as it was.
  const keys = ['nextbook-own-v1', 'nextbook-practice-v1', 'nextbook-others-v1'];
  keys.forEach((key) => {
    const raw = storage.raw(key);
    if (raw) assert.strictEqual(raw.indexOf('listUndo'), -1, key + ' carries no undo');
  });
});

test('I4: a file that is neither site says what it found, and changes nothing', () => {
  const { nb, doc, storage } = ownShelf();
  const store = nb.store.open(storage);
  const before = plain(store.shelf());
  const rawBefore = storage.raw('nextbook-own-v1');

  nb.shell.importReadingList('Title,Author,Rating\nA Book,Some Writer,4\n');

  assert.strictEqual(said(doc),
    'That file says Title, Author, Rating at the top. It is not a Goodreads or StoryGraph list, so nothing was changed.');
  assert.strictEqual(said(doc), nb.t('listBadHeader', { found: 'Title, Author, Rating' }));
  assert.deepStrictEqual(plain(store.shelf()), before, 'the shelf is untouched');
  assert.strictEqual(storage.raw('nextbook-own-v1'), rawBefore, 'and nothing was written');
  assert.strictEqual(byTest(doc, 'shelf-list-undo'), null, 'there is nothing to undo');
  assert.strictEqual(doc.activeElement.getAttribute('data-test'), 'shelf-list-import');
});

test('I5: a row with no title is named, and the rest of the file still comes in', () => {
  const { nb, doc, storage } = ownShelf();
  const csv = 'Title,Author,My Rating,Exclusive Shelf\n,Someone,4,read\nStation Eleven,Emily St. John Mandel,4,read\n';

  nb.shell.importReadingList(csv);

  assert.strictEqual(said(doc).indexOf('Added 1 book.'), 0, 'the good row came in');
  assert.ok(doc.body.textContent.indexOf('Row 2 has no title') !== -1,
    'the row with no title is named, by its line');
  assert.ok(byTest(doc, 'list-problem-1'), 'as a sentence of its own');
  assert.strictEqual(plain(nb.store.open(storage).shelf()).length, 3, 'the two books from before, and the one row');
});

test('I6: a StoryGraph file is detected by "Read Status"', () => {
  const { nb, doc, storage } = ownShelf();
  nb.shell.importReadingList(STORYGRAPH);

  const shelf = plain(nb.store.open(storage).shelf());
  const piranesi = shelf.filter((e) => e.title === 'Piranesi')[0];
  assert.strictEqual(piranesi.state, 'stopped', 'did not finish is the app\'s stopped');
  assert.strictEqual(piranesi.from, undefined, 'a book that was already here keeps no false from');
  assert.ok(said(doc).indexOf('Updated 1 that changed at the library.') !== -1, 'and it was followed');
});

test('I7: a workshop copy draws the refusal and no input at all', () => {
  const { nb, doc } = openShelf({ workshop: true });

  assert.strictEqual(byTest(doc, 'shelf-list-file'), null, 'there is no file input to pick');
  const off = byTest(doc, 'list-off');
  assert.ok(off, 'the block says why');
  assert.strictEqual(off.textContent, nb.t('listOff'));
  assert.ok(doc.body.textContent.indexOf(nb.t('listHeading')) !== -1, 'the block itself is still there');
});

test('I8: the practice shelf refuses the import, draws no file picker, and does not write', () => {
  const { nb, doc, storage } = openShelf();
  const practiceBefore = storage.raw('nextbook-practice-v1');
  assert.ok(practiceBefore, 'the practice shelf is seeded on first use');

  // No picker that can only refuse: the sentence says to use the own shelf instead.
  assert.ok(drawnOrder(doc).indexOf('list-off') !== -1, 'the sentence is drawn');
  assert.strictEqual(byTest(doc, 'shelf-list-file'), null, 'and there is no file input to press');

  const report = nb.shell.importReadingList(GOODREADS);

  assert.strictEqual(storage.raw('nextbook-practice-v1'), practiceBefore, 'not one byte was written');
  assert.strictEqual(storage.raw('nextbook-own-v1'), undefined, 'and nothing landed on the own shelf');
  assert.strictEqual(byTest(doc, 'list-refused-1').textContent, 'The practice shelf does not take a real import. Do this at home, on your own shelf.');
  assert.strictEqual(byTest(doc, 'shelf-list-undo'), null, 'there is nothing to undo');
  assert.ok(report && report.refusals.length === 1);
});
