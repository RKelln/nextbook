'use strict';
// T8.8c: bringing the library's shelf in, on the shelf screen, driven through a fake DOM
// (tests/fakedom.js). The pages are the real saved fixtures in tests/fixtures/tpl, read as
// text; the file input is driven through a small fake FileReader so the wiring is exercised,
// not only the handler.
//
//   L1  an ordinary copy draws the block: a labelled multi-file input, the two sentences
//   L2  two pages are read, combined, merged and written once, with the report in words
//   L3  one page alone leaves the shelf incomplete, and nothing is marked gone
//   L4  one bad file among two good ones is named, and the good ones still count
//   L5  one Undo puts the shelf back exactly, and says so
//   L6  "Use the library's" copies the library's answer for that book
//   L7  "Leave it" writes the ignore snapshot, and a new import does not list it again
//   L8  "Keep mine" dismisses the row, and changes nothing
//   L9  the last-brought-in date comes from library.seen
//   L10 a gone book shows the quiet note and is still on the shelf
//   L11 nothing is written when no file could be read
//   L12 the practice shelf and a workshop copy draw the sentence and no input
//
// Objects come from a vm realm, so compare after a JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load, root } = require('./_load.js');
const { createDocument, all, byTest, withPrefix } = require('./fakedom.js');

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const SLICE = read('data/slice.json');
const PRACTICE = read('data/practice.json');
const pageOne = fs.readFileSync(path.join(root, 'tests/fixtures/tpl/shelf-page.html'), 'utf8');
const pageTwo = fs.readFileSync(path.join(root, 'tests/fixtures/tpl/shelf-page-2.html'), 'utf8');

// The reader tells us the real keys the fixtures produce, so the seeded shelf and the import
// meet on the same books.
const reader = load(['app/core/base.js', 'app/core/library-shelf.js', 'app/core/merge.js']);
const NOW = '2026-11-03T16:44:00Z';
const one = plain(reader.libraryShelf.read(pageOne, { now: NOW }));
const two = plain(reader.libraryShelf.read(pageTwo, { now: NOW }));
const fromPage = (out, title) => out.entries.filter((e) => e.title === title)[0];

const PIRANESI = fromPage(one, 'Piranesi');
const BRAIDING = fromPage(one, 'Braiding Sweetgrass');
const DISPOSSESSED = fromPage(two, 'The Dispossessed');
const TOMBS_KEY = 't:the tombs of atuan|ursula k. le guin';

const CORE = [
  'app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
  'app/core/links.js', 'app/core/contract.js', 'app/core/seam.js', 'app/core/store.js',
  'app/core/merge.js', 'app/core/import.js', 'app/core/library-shelf.js',
];

function memoryStorage() {
  const map = new Map();
  const writes = [];
  return {
    writes,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); writes.push(String(key)); },
    removeItem(key) { map.delete(key); },
    raw(key) { return map.get(key); },
  };
}

// A browser's FileReader, near enough: readAsText hands back the text the fake file carries and
// calls onload. One instance per file, as core/shell.js makes it.
function FakeFileReader() { this.result = ''; this.onload = null; this.onerror = null; }
FakeFileReader.prototype.readAsText = function (file) {
  if (!file || typeof file.text !== 'string') { if (this.onerror) this.onerror(); return; }
  this.result = file.text;
  if (this.onload) this.onload();
};

// Four books here. Three of them are also on the saved shelf pages, and each disagrees with
// the library in a different way, so every branch of the merge is visible on the screen.
function seededShelf() {
  return [
    {
      key: PIRANESI.key, title: PIRANESI.title, author: PIRANESI.author,
      state: 'read', rating: 'loved', updated: '2026-01-01T00:00:00Z',
      library: { shelf: 'for_later', rating10: 7, seen: '2026-01-05T12:00:00' },
    },
    {
      key: TOMBS_KEY, title: 'The Tombs of Atuan', author: 'Ursula K. Le Guin',
      state: 'read', rating: 'ok', updated: '2026-01-01T00:00:00Z',
      library: { shelf: 'for_later', rating10: 6, seen: '2026-01-05T12:00:00' },
    },
    {
      key: BRAIDING.key, title: BRAIDING.title, author: BRAIDING.author,
      state: 'want', rating: null, updated: '2026-01-01T00:00:00Z',
      library: { shelf: 'for_later', rating10: 0, seen: '2026-01-05T12:00:00' },
    },
    {
      key: DISPOSSESSED.key, title: DISPOSSESSED.title, author: DISPOSSESSED.author,
      state: 'reading', rating: 'ok', updated: '2026-01-01T00:00:00Z',
      library: { shelf: 'completed', rating10: 8, seen: '2026-01-05T12:00:00' },
    },
  ];
}

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
    // kept, so a test can fire the window's focus as a person coming back to the tab would
    __on: {},
    addEventListener(name, fn) { (window.__on[name] = window.__on[name] || []).push(fn); },
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
  nb.data.put('slice', options.slice || SLICE);
  nb.data.put('tags', { schema: 'nextbook/tags-1', vocab: {}, works: {} });
  nb.data.put('practice', PRACTICE);
  if (options.workshop) nb.data.put('workshop', { workshop: true });
  if (options.seed) options.seed(nb.store.open(storage));

  run('app/core/shell.js');
  const fire = (name) => (window.__on[name] || []).forEach((fn) => fn({ type: name }));
  return { nb, doc, app, storage, fire };
}

// Someone's own shelf in use, with the four books from above on it.
function ownShelf(opts) {
  const options = Object.assign({}, opts || {});
  options.seed = (store) => {
    store.use('own');
    store.replace(options.entries || seededShelf());
    if (options.afterSeed) options.afterSeed(store);
  };
  return openShelf(options);
}

const said = (doc) => {
  const el = byTest(doc, 'lib-said');
  return el ? el.textContent : '';
};
const lastLine = (doc) => {
  const el = byTest(doc, 'lib-last');
  return el ? el.textContent : '';
};
const rows = (doc, prefix) => withPrefix(doc, prefix);

function chooseFiles(doc, files) {
  const input = byTest(doc, 'shelf-library-file');
  input.files = files;
  input.dispatch('change', { type: 'change', target: input });
  return input;
}

const pages = [
  { name: 'shelf-page.html', text: pageOne },
  { name: 'shelf-page-2.html', text: pageTwo },
];

// ---- the block ---------------------------------------------------------------------------------

test('L1: an ordinary copy draws the block, with a labelled multi-file picker', () => {
  const { nb, doc } = ownShelf();

  assert.ok(byTest(doc, 'shelf-library'), 'the block is on the shelf screen');
  assert.strictEqual(byTest(doc, 'shelf-library').getAttribute('tabindex'), '-1',
    'the block can take the cursor back after a report');
  assert.ok(doc.body.textContent.indexOf(nb.t('libHeading')) !== -1, 'its heading is there');
  assert.ok(doc.body.textContent.indexOf(nb.t('libHelp')) !== -1, 'the sentence about saving the pages');
  assert.ok(doc.body.textContent.indexOf(nb.t('libPrivacy')) !== -1, 'the sentence about deleting the files');
  assert.strictEqual(byTest(doc, 'lib-off'), null, 'nothing is switched off on this shelf');

  const input = byTest(doc, 'shelf-library-file');
  assert.ok(input, 'the picker is drawn');
  assert.strictEqual(input.getAttribute('type'), 'file');
  assert.strictEqual(input.getAttribute('accept'), '.html,.htm,text/html,.json,application/json');
  assert.strictEqual(input.getAttribute('multiple'), '', 'several saved pages can be chosen at once');
  assert.strictEqual(input.getAttribute('aria-label'), nb.t('libChoose'));
  assert.ok(input.parentNode.tagName === 'LABEL' || input.parentNode.parentNode.tagName === 'LABEL',
    'the label wraps it');
});

test('L2: two pages are read, combined, merged and written once, and reported in words', () => {
  const { nb, doc, storage } = ownShelf();
  const before = plain(nb.store.open(storage).shelf());
  assert.strictEqual(before.length, 4);
  storage.writes.length = 0;

  chooseFiles(doc, pages);

  assert.strictEqual(said(doc),
    "Added 1 book. Updated 1 that changed at the library. 2 are different here. " +
    "1 is no longer on your library shelf.");
  assert.strictEqual(said(doc), nb.t('listAddedOne') + ' ' + nb.t('listUpdatedOne') + ' ' +
    nb.t('listKept', { n: 2 }) + ' ' + nb.t('listGoneOne'));

  // The unfinished shelf is named, and nothing was taken off it.
  assert.strictEqual(byTest(doc, 'lib-refused-1').textContent,
    'Your In Progress shelf was not fully saved, so nothing was taken off it.');

  // The whole import is one write to the shelf in use.
  const ownWrites = storage.writes.filter((key) => key === 'nextbook-own-v1');
  assert.strictEqual(ownWrites.length, 1, 'written once: ' + JSON.stringify(storage.writes));

  const after = plain(nb.store.open(storage).shelf());
  assert.strictEqual(after.length, 5, 'the four books here and the one new one');
  const titles = after.map((e) => e.title);
  assert.ok(titles.indexOf('The Left Hand of Darkness') !== -1, 'the new book came in');
  const braiding = after.filter((e) => e.title === BRAIDING.title)[0];
  assert.strictEqual(braiding.state, 'read', 'the library moved, so it was followed');
  assert.strictEqual(braiding.rating, 'loved');
  const piranesi = after.filter((e) => e.title === 'Piranesi')[0];
  assert.strictEqual(piranesi.state, 'read', 'what is here was kept');
  assert.strictEqual(piranesi.library.rating10, 7, 'and its memory is the library\'s latest word');

  // One Undo for the whole import.
  assert.ok(byTest(doc, 'shelf-library-undo'));
  assert.strictEqual(doc.activeElement.getAttribute('data-test'), 'shelf-library',
    'the cursor comes back to the block');
});

// ---- the three panels --------------------------------------------------------------------------

test('L3: one page alone leaves the shelf incomplete, and no book is marked gone', () => {
  // The same shelf as L2, without the book whose memory sits on a finished shelf: with one
  // page, every shelf a book came from is unfinished, so absence means nothing.
  const entries = seededShelf().filter((e) => e.title !== DISPOSSESSED.title);
  const { nb, doc, storage } = ownShelf({ entries });

  chooseFiles(doc, [pages[0]]);

  const after = plain(nb.store.open(storage).shelf());
  assert.strictEqual(after.length, 4, 'the new book came in');
  const tombs = after.filter((e) => e.title === 'The Tombs of Atuan')[0];
  assert.ok(tombs, 'a book the library did not bring is still here');
  assert.notStrictEqual(tombs.library.gone, true, 'a partial shelf is not a removal');
  assert.strictEqual(withPrefix(doc, 'lib-tidy-gone-').length, 0, 'no gone row is drawn');
  assert.strictEqual(withPrefix(doc, 'shelf-gone-').length, 0, 'and no book carries the note');

  // For Later and In Progress are both unfinished, so both are named.
  assert.strictEqual(byTest(doc, 'lib-refused-1').textContent,
    'Your For Later shelf was not fully saved, so nothing was taken off it.');
  assert.strictEqual(byTest(doc, 'lib-refused-2').textContent,
    'Your In Progress shelf was not fully saved, so nothing was taken off it.');
});

test('L4: one bad file among two good ones is named, and the good ones still count', () => {
  const { nb, doc } = ownShelf();

  chooseFiles(doc, [
    pages[0],
    { name: 'notes.txt', text: 'just some notes, not a saved page' },
    pages[1],
  ]);

  const error = byTest(doc, 'lib-file-error-1');
  assert.ok(error, 'the bad file gets a sentence of its own');
  assert.ok(error.textContent.indexOf('notes.txt') === 0,
    'it is named first, got: ' + error.textContent);
  assert.ok(error.textContent.indexOf('does not look like a page saved from the library') !== -1);
  assert.strictEqual(error.textContent, nb.t('libFileBad', {
    name: 'notes.txt', error: nb.t('libraryShelfNotPage'),
  }));

  // Both good pages still counted: the same five books as L2.
  assert.strictEqual(said(doc), nb.t('listAddedOne') + ' ' + nb.t('listUpdatedOne') + ' ' +
    nb.t('listKept', { n: 2 }) + ' ' + nb.t('listGoneOne'));
});

test('L5: one Undo puts the shelf back exactly, and says so', () => {
  const { nb, doc, storage } = ownShelf();
  const store = nb.store.open(storage);
  const before = plain(store.shelf());

  chooseFiles(doc, pages);
  assert.notStrictEqual(plain(store.shelf()).length, before.length, 'the import changed the shelf');

  byTest(doc, 'shelf-library-undo').click();

  assert.deepStrictEqual(plain(nb.store.open(storage).shelf()), before, 'exactly the shelf from before');
  assert.ok(doc.body.textContent.indexOf(nb.t('libUndone')) !== -1, 'the page says it was undone');
  assert.strictEqual(byTest(doc, 'lib-report'), null, 'the report is put away with it');
  assert.strictEqual(byTest(doc, 'shelf-library-undo'), null, 'and there is no second Undo');

  const keys = ['nextbook-own-v1', 'nextbook-practice-v1', 'nextbook-others-v1'];
  keys.forEach((key) => {
    const raw = storage.raw(key);
    if (raw) assert.strictEqual(raw.indexOf('libUndo'), -1, key + ' carries no undo');
  });
});

test('L6: "Use the library\'s" copies the library\'s shelf and rating into the book', () => {
  const { nb, doc, storage } = ownShelf();
  chooseFiles(doc, pages);

  const before = plain(nb.store.open(storage).shelf().filter((e) => e.title === 'Piranesi')[0]);
  const tidy = byTest(doc, 'lib-tidy-row-1');
  assert.ok(tidy.textContent.indexOf('Piranesi') !== -1, 'the first tidy row is Piranesi');

  byTest(doc, 'lib-tidy-use-1').click();

  const after = plain(nb.store.open(storage).shelf().filter((e) => e.title === 'Piranesi')[0]);
  assert.strictEqual(after.state, 'want', 'the library has it For Later');
  assert.strictEqual(after.rating, 'liked', 'and at seven out of ten');
  assert.deepStrictEqual(after.library, before.library, 'the memory of the library is kept');
  assert.ok(doc.body.textContent.indexOf(nb.t('libUsed', { title: 'Piranesi' })) !== -1);
  assert.strictEqual(withPrefix(doc, 'lib-tidy-row-').length, 1, 'the row is put away');
  assert.ok(doc.body.textContent.indexOf(nb.t('listTidy', { n: 1 })) !== -1, 'and the heading counts the one left');
});

test('L7: "Leave it" writes the ignore snapshot, and a new import does not list it again', () => {
  const { nb, doc, storage } = ownShelf();
  chooseFiles(doc, pages);

  const tombsRow = byTest(doc, 'lib-tidy-row-2');
  assert.ok(tombsRow.textContent.indexOf('The Tombs of Atuan') !== -1, 'the second tidy row is the gone book');
  assert.strictEqual(byTest(doc, 'lib-tidy-use-2'), null, 'a gone book offers no "Use the library\'s"');
  assert.ok(byTest(doc, 'lib-tidy-open-2'), 'but it offers the library page');
  assert.ok(byTest(doc, 'lib-tidy-leave-2'), 'and Leave it');

  byTest(doc, 'lib-tidy-leave-2').click();

  const tombs = plain(nb.store.open(storage).shelf().filter((e) => e.title === 'The Tombs of Atuan')[0]);
  assert.ok(tombs, 'the book is still on the shelf');
  assert.deepStrictEqual(tombs.library.ignore.here, { state: 'read', rating: 'ok' });
  assert.match(tombs.library.ignore.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(doc.body.textContent.indexOf(nb.t('libLeft', { title: 'The Tombs of Atuan' })) !== -1);

  nb.shell.render();
  assert.strictEqual(withPrefix(doc, 'lib-tidy-row-').length, 1, 'the row is gone after a re-render');

  // The next import: the merge sees the stamp and leaves the book alone, so the person is not
  // asked again. merge.js owns that rule; the screen only reports what it decided.
  const report = nb.shell.importLibraryShelf(pages);
  assert.strictEqual(report.counts.ignored, 1, 'the merge remembered the answer');
  assert.ok(said(doc).indexOf(nb.t('listIgnoredOne')) !== -1);
  assert.ok(report.tidy.every((row) => row.title !== 'The Tombs of Atuan'), 'and it is not listed');
});

test('L8: "Keep mine" dismisses the row for this visit, and changes nothing', () => {
  const { nb, doc, storage } = ownShelf();
  chooseFiles(doc, pages);

  const before = plain(nb.store.open(storage).shelf().filter((e) => e.title === DISPOSSESSED.title)[0]);
  const row = byTest(doc, 'lib-choose-row-1');
  assert.ok(row, 'the disagreement is in "Which is right?"');
  assert.ok(row.textContent.indexOf('Here: reading, ok. At the library: For Later.') !== -1,
    'with both sides, got: ' + row.textContent);

  byTest(doc, 'lib-choose-keep-1').click();

  const after = plain(nb.store.open(storage).shelf().filter((e) => e.title === DISPOSSESSED.title)[0]);
  assert.deepStrictEqual(after, before, 'nothing about the book changed');
  assert.strictEqual(byTest(doc, 'lib-choose-row-1'), null, 'the row is dismissed');
  assert.ok(doc.body.textContent.indexOf(nb.t('libKeptMine', { title: DISPOSSESSED.title })) !== -1);
});

// ---- the date and the gone note ----------------------------------------------------------------

test('L9: the last-brought-in date is the newest library.seen, and nothing when there is none', () => {
  const { nb, doc } = ownShelf();
  assert.strictEqual(lastLine(doc),
    'Last brought in from the library: January 5, 2026');
  assert.strictEqual(lastLine(doc), nb.t('libLastSeen', { date: 'January 5, 2026' }));

  // A shelf with no library memory says nothing at all.
  const plainShelf = [{
    key: 't:a book|someone', title: 'A Book', author: 'Someone',
    state: 'want', rating: null, updated: '2026-01-01T00:00:00Z',
  }];
  const other = ownShelf({ entries: plainShelf });
  assert.strictEqual(lastLine(other.doc), '', 'no line when no book came from the library');
});

test('L10: a gone book shows the quiet note, and is still on the shelf', () => {
  const { nb, doc, storage } = ownShelf();
  chooseFiles(doc, pages);

  const after = plain(nb.store.open(storage).shelf());
  const tombs = after.filter((e) => e.title === 'The Tombs of Atuan')[0];
  assert.ok(tombs, 'it was not removed');
  assert.strictEqual(tombs.library.gone, true, 'it is marked');

  const note = byTest(doc, 'shelf-gone-2');
  assert.ok(note, 'the shelf row carries the note');
  assert.strictEqual(note.textContent, 'The library does not have this on your shelf now.');
  assert.ok(doc.body.textContent.indexOf('5 books on this shelf.') !== -1, 'and the shelf still has five books');
  assert.ok(doc.body.textContent.indexOf('The Tombs of Atuan') !== -1);
});

// ---- nothing read ------------------------------------------------------------------------------

test('L11: nothing is written when no file could be read', () => {
  const { nb, doc, storage } = ownShelf();
  const store = nb.store.open(storage);
  const rawBefore = storage.raw('nextbook-own-v1');
  const before = plain(store.shelf());
  storage.writes.length = 0;

  chooseFiles(doc, [
    { name: 'one.txt', text: 'no' },
    { name: 'two.json', text: '{"works": []}' },
  ]);

  assert.strictEqual(said(doc), '', 'the two file sentences are the report');
  assert.strictEqual(byTest(doc, 'lib-file-error-1').textContent, nb.t('libFileBad', {
    name: 'one.txt', error: nb.t('libraryShelfNotPage'),
  }));
  assert.ok(byTest(doc, 'lib-file-error-2'));
  assert.strictEqual(storage.raw('nextbook-own-v1'), rawBefore, 'not a byte was written');
  assert.deepStrictEqual(plain(store.shelf()), before);
  assert.strictEqual(byTest(doc, 'shelf-library-undo'), null, 'there is nothing to undo');
  assert.strictEqual(storage.writes.length, 0, 'no write at all: ' + JSON.stringify(storage.writes));
});

// ---- off on the practice shelf and in a workshop copy -------------------------------------------

test('L12: the practice shelf and a workshop copy draw the sentence and no input', () => {
  const practice = openShelf();
  assert.strictEqual(byTest(practice.doc, 'shelf-library-file'), null, 'no picker on the practice shelf');
  const off = byTest(practice.doc, 'lib-off');
  assert.ok(off, 'the block says why');
  assert.strictEqual(off.textContent, practice.nb.t('libOff'));
  assert.ok(off.textContent.indexOf('Do this at home, on your own shelf') !== -1,
    'and says where to do it');
  assert.ok(practice.doc.body.textContent.indexOf(practice.nb.t('libHeading')) !== -1,
    'the block itself is still there');

  const workshop = openShelf({ workshop: true });
  assert.strictEqual(byTest(workshop.doc, 'shelf-library-file'), null, 'no picker in a workshop copy');
  assert.strictEqual(byTest(workshop.doc, 'lib-off').textContent, workshop.nb.t('libOff'));
});

// ---- the link ----------------------------------------------------------------------------------

test('L13: a tidy row opens the record page for a work, and a catalogue search otherwise', () => {
  const slice = plain(SLICE);
  slice.library.recordUrl = 'https://example.invalid/record/{id}';
  const { nb, doc } = ownShelf({ slice });
  chooseFiles(doc, pages);

  // Piranesi is a work in the slice, so the library's record page is used.
  const record = byTest(doc, 'lib-tidy-open-1');
  assert.ok(record, 'the tidy row opens the library page');
  assert.strictEqual(record.getAttribute('href'),
    'https://example.invalid/record/' + encodeURIComponent('piranesi'),
    'the record page for the work: ' + record.getAttribute('href'));
  assert.strictEqual(record.getAttribute('target'), '_blank');
  assert.strictEqual(record.textContent, nb.t('libOpen'));

  // The gone book is not in the slice and carries no record id, so its link searches by title
  // and author, as the rest of the screen does for a typed book.
  const search = byTest(doc, 'lib-tidy-open-2');
  assert.ok(search, 'the gone row still offers a link');
  assert.ok(/\/search\?/.test(search.getAttribute('href')), 'it is the catalogue search: ' + search.getAttribute('href'));
  assert.ok(search.getAttribute('href').indexOf('Tombs') !== -1, 'for the right book');
});

// The round trip: open a shelf at the library, save it, bring it in. Make each step short.
test('the steps open each library shelf through its sign-in, and the box takes a drop', () => {
  const { nb, doc } = ownShelf();
  assert.ok(byTest(doc, 'lib-steps'), 'the steps are drawn');
  const lib = SLICE.library;
  [['forLater', 'for_later'], ['inProgress', 'in_progress'], ['completed', 'completed']].forEach(([page, path]) => {
    const link = byTest(doc, 'lib-open-' + page);
    assert.ok(link, 'a link to the ' + page + ' shelf');
    assert.strictEqual(link.getAttribute('href'),
      lib.account.signIn.replace('{path}', encodeURIComponent('/collection/show/my/library/' + path)));
    assert.strictEqual(link.getAttribute('target'), '_blank');
  });
  assert.ok(doc.body.textContent.indexOf(nb.t('libStepSave')) !== -1, 'how to save the page');
  const drop = byTest(doc, 'lib-drop');
  assert.ok(drop && drop.getAttribute('class').indexOf('nb-drop') !== -1, 'the picker is a box a file can be dropped on');
  assert.strictEqual(byTest(doc, 'shelf-library-file').parentNode, drop);
});

test('back from the library: one note on how to bring a change in, and the panel opens', () => {
  const { nb, doc, fire } = ownShelf();
  const status = () => all(doc, '[role]').filter((el) => el.getAttribute('role') === 'status')
    .map((el) => el.textContent).join(' ');
  fire('focus');
  assert.strictEqual(status(), '', 'a focus with no trip to the library says nothing');

  byTest(doc, 'lib-open-completed').click();
  fire('focus');
  assert.strictEqual(status(), nb.t('libBackHere'));
  assert.strictEqual(byTest(doc, 'fold-library').hasAttribute('open'), true, 'and the way to bring it in is open');

  byTest(doc, 'message-close').click();
  fire('focus');
  assert.strictEqual(status(), '', 'said once per trip, not on every focus');
});

test('back from the library on the practice shelf says nothing, because it cannot bring anything in', () => {
  const { doc, fire } = openShelf({});
  const link = byTest(doc, 'shelf-account-holds');
  assert.ok(link, 'the account links are there on practice too');
  link.click();
  fire('focus');
  assert.strictEqual(all(doc, '[role]').filter((el) => el.getAttribute('role') === 'status').length, 0);
});


// ---- D43: the holds list comes back the same way ------------------------------------------------
const holdsPage = fs.readFileSync(path.join(root, 'tests/fixtures/tpl/holds-page.html'), 'utf8');
function holdShelf() {
  return [
    { key: PIRANESI.key, title: PIRANESI.title, author: PIRANESI.author, state: 'want', rating: null,
      updated: '2026-01-01T00:00:00Z' },
    { key: TOMBS_KEY, title: 'The Tombs of Atuan', author: 'Ursula K. Le Guin', state: 'hold', rating: null,
      updated: '2026-01-01T00:00:00Z' },
  ];
}

test('H1: the steps open the On Hold page too', () => {
  const { nb, doc } = ownShelf();
  const link = byTest(doc, 'lib-open-holds');
  assert.ok(link, 'the holds link is in the steps');
  assert.strictEqual(link.textContent, nb.t('accountOnHold'));
  assert.ok(/\/user\/login\?destination=%2Fholds$/.test(link.getAttribute('href')), link.getAttribute('href'));
});

test('H2: a saved On Hold page sets holds, takes off the one that is gone, and says both', () => {
  const { nb, doc, storage } = ownShelf({ entries: holdShelf() });
  chooseFiles(doc, [{ name: 'On Hold.html', text: holdsPage }]);
  const shelf = plain(nb.store.open(storage).shelf());
  const stateOfKey = (key) => shelf.filter((e) => e.key === key)[0].state;
  assert.strictEqual(stateOfKey(PIRANESI.key), 'hold', 'want, and on the list: on hold');
  assert.strictEqual(stateOfKey(TOMBS_KEY), 'want', 'on hold here, not on the whole list: back to want');
  assert.strictEqual(shelf.filter((e) => e.title === 'The Dispossessed')[0].state, 'hold', 'new, and on hold');
  assert.strictEqual(shelf.length, 3);
  assert.ok(said(doc).indexOf(nb.t('libHeld', { n: 2 })) !== -1, said(doc));
  assert.ok(said(doc).indexOf(nb.t('libUnheldOne')) !== -1, said(doc));
  assert.ok(byTest(doc, 'lib-unheld-1'), 'the gone hold is named');
  assert.ok(byTest(doc, 'lib-unheld-1').textContent.indexOf('The Tombs of Atuan') !== -1);
  assert.strictEqual(byTest(doc, 'lib-unheld-2'), null, 'and only that one');
  assert.strictEqual(byTest(doc, 'lib-refused-1'), null, 'a whole list: nothing refused');
  assert.ok(byTest(doc, 'shelf-library-undo'), 'one Undo for the whole import');
});

test('H3: "I picked it up" sets the book to Reading and puts the row away', () => {
  const { nb, doc, storage } = ownShelf({ entries: holdShelf() });
  chooseFiles(doc, [{ name: 'On Hold.html', text: holdsPage }]);
  byTest(doc, 'lib-unheld-reading-1').dispatch('click', { type: 'click' });
  const tombs = plain(nb.store.open(storage).shelf()).filter((e) => e.key === TOMBS_KEY)[0];
  assert.strictEqual(tombs.state, 'reading');
  assert.strictEqual(byTest(doc, 'lib-unheld-1'), null, 'the row is answered');
});

test('H4: Undo puts every hold back as it was', () => {
  const { nb, doc, storage } = ownShelf({ entries: holdShelf() });
  const before = plain(nb.store.open(storage).shelf());
  chooseFiles(doc, [{ name: 'On Hold.html', text: holdsPage }]);
  byTest(doc, 'shelf-library-undo').dispatch('click', { type: 'click' });
  assert.deepStrictEqual(plain(nb.store.open(storage).shelf()), before);
});

test('H5: the On Hold page beside a For Later page never marks For Later books gone', () => {
  // The bug D43 fixed: the holds page's "1 to 2 of 2 items" was read as For Later's count.
  const { nb, doc, storage } = ownShelf();
  chooseFiles(doc, [{ name: 'On Hold.html', text: holdsPage }]);
  const shelf = plain(nb.store.open(storage).shelf());
  assert.ok(shelf.every((e) => !(e.library && e.library.gone)), 'nothing is marked gone');
  assert.strictEqual(byTest(doc, 'lib-tidy'), null, 'and nothing is listed to tidy');
});
