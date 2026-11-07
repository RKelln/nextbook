'use strict';
// T3.1: the shelf screen, driven through a fake DOM (tests/fakedom.js). These are the page-level
// regressions an independent review found: a typed book with no link, a title-only add that
// copied a book already in the list, a workshop copy with no reset, a forgotten shelf, and the
// keyboard focus dropped after every change. Objects come from a vm realm, so compare after a
// JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./_load.js');
const { createDocument, all, byTest, withPrefix, submit } = require('./fakedom.js');

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const SLICE = read('data/slice.json');
const PRACTICE = read('data/practice.json');

const CORE = ['app/core/base.js', 'app/core/slice.js', 'app/core/links.js', 'app/core/store.js'];

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    has(key) { return map.has(key); },
    raw(key) { return map.get(key); },
  };
}

// Load core/base.js through core/store.js, put the data files in, then load the shell, which
// boots on load because the fake document is already complete.
function openPage(opts) {
  const options = opts || {};
  const doc = createDocument();
  const app = doc.createElement('main');
  app.setAttribute('id', 'app');
  doc.body.appendChild(app);

  const window = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc,
    location: { hash: options.hash || '#shelf' },
    __on: {},
    addEventListener(name, fn) { (window.__on[name] = window.__on[name] || []).push(fn); },
    confirm() { return true; },
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
  if (options.workshop) nb.data.put('workshop', { workshop: true });
  if (options.found) nb.data.put('found', options.found);
  run('app/core/shell.js');
  const fire = (name) => (window.__on[name] || []).forEach((fn) => fn({ type: name }));

  return { nb, doc, app, fire };
}

// Open "Not in the list? Add it by name", type a title and maybe an author, and press the button.
// The form stays open after an add, so a second call uses it as it is.
function addTyped(doc, title, author) {
  if (!byTest(doc, 'add-title')) {
    const opener = byTest(doc, 'add-by-name');
    assert.ok(opener, 'the page should offer "add it by name"');
    opener.click();
  }
  const titleInput = byTest(doc, 'add-title');
  const authorInput = byTest(doc, 'add-author');
  assert.ok(titleInput && authorInput, 'the by-name form should be open');
  titleInput.value = title;
  authorInput.value = author || '';
  submit(titleInput);
}

const rows = (doc) => all(doc, '[data-book]');
const keys = (doc) => rows(doc).map((el) => el.getAttribute('data-book'));
const statusText = (doc) => {
  const line = all(doc, '[role]').find((el) => el.getAttribute('role') === 'status');
  return line ? line.textContent : '';
};

test('P1: a typed book that is not in the list still links to the library search', () => {
  const { nb, doc } = openPage({});
  addTyped(doc, 'A Book Nobody Has', 'No Author At All');

  const key = keys(doc).find((k) => k.indexOf('t:') === 0);
  assert.ok(key, 'the typed book should be on the shelf under its own key');

  const links = withPrefix(doc, 'shelf-link-');
  const wanted = 'A+Book+Nobody+Has';
  const hrefs = links.map((a) => a.getAttribute('href'));
  assert.strictEqual(links.length, rows(doc).length, 'every row has a title link when the library has a search');
  assert.ok(hrefs.some((h) => h.indexOf(wanted) !== -1 && h.indexOf('No+Author+At+All') !== -1),
    'the typed row links to the search for its title and author, got ' + JSON.stringify(hrefs));
  assert.strictEqual(nb.linkFor({ title: 'A Book Nobody Has', author: 'No Author At All' }, SLICE.library),
    hrefs.find((h) => h.indexOf(wanted) !== -1), 'and it is exactly the link the page promises');
  assert.ok(doc.body.textContent.indexOf(nb.t('notInList')) !== -1, 'the row says it is not in the list');
});

test('P2: a title typed with no author joins the one list book of that title', () => {
  const { nb, doc } = openPage({});
  const practiceCount = PRACTICE.entries.length;

  addTyped(doc, 'Piranesi', '');
  assert.strictEqual(statusText(doc), nb.t('alreadyThere'),
    'Piranesi is in the list and on the practice shelf, so it is not added twice');
  assert.strictEqual(rows(doc).length, practiceCount, 'no second entry');
  assert.ok(!keys(doc).some((k) => k.indexOf('t:piranesi') === 0), 'and no typed copy');

  addTyped(doc, 'Beloved', '');
  assert.ok(keys(doc).includes('w:pack:beloved'), 'Beloved joins the list work, under the work key');
  assert.ok(!keys(doc).some((k) => k.indexOf('t:beloved') === 0), 'not as a typed book');
  assert.strictEqual(statusText(doc), nb.t('addedBook', { title: 'Beloved' }) + ' ' + nb.t('foundInList'),
    'the page says it was found in the list');
  const row = rows(doc).find((el) => el.getAttribute('data-book') === 'w:pack:beloved');
  assert.strictEqual(row.textContent.indexOf(nb.t('notInList')), -1, 'and it is not called "not in the list"');
  const link = withPrefix(row, 'shelf-link-')[0];
  assert.ok(link && link.getAttribute('href').indexOf('Beloved+Toni+Morrison') !== -1,
    'the list row links by its own title and author');
});

test('P2: when two books share the title, the typed book stays a typed book', () => {
  const slice = {
    schema: 'nextbook/slice-1',
    library: { name: 'Test Library', recordUrl: null, searchUrl: 'https://example.test/search?q={q}' },
    works: [
      { id: 'one', groupKey: 'pack:one', title: 'Same Title', author: 'Ana One', authorKey: 'one, a', facets: [] },
      { id: 'two', groupKey: 'pack:two', title: 'Same Title', author: 'Bo Two', authorKey: 'two, b', facets: [] },
    ],
  };
  const { nb, doc } = openPage({ slice, practice: { schema: 'nextbook/practice-1', entries: [] } });

  addTyped(doc, 'Same Title', '');
  const key = keys(doc)[0];
  assert.strictEqual(key, 't:same title|', 'a guess between two books is refused: it is kept as typed');
  assert.strictEqual(statusText(doc), nb.t('addedTyped', { title: 'Same Title' }));
});

test('P3: a workshop copy keeps the reset and replaces only the switch to the own shelf', () => {
  const nbData = { workshop: true };
  const { nb, doc } = openPage({ workshop: nbData.workshop });

  const banner = byTest(doc, 'practice-banner');
  assert.ok(banner, 'the practice banner is there');
  assert.ok(banner.textContent.indexOf(nb.t('practiceBanner')) !== -1, 'and it says the books are examples');
  assert.ok(byTest(doc, 'practice-reset'), 'so the reset button must be there too');
  assert.strictEqual(byTest(doc, 'shelf-use-own'), null, 'only the switch is replaced');
});

test('P4: the shelf in use is still in use after a reload of the page', () => {
  const storage = memoryStorage();
  const first = openPage({ storage });
  byTest(first.doc, 'shelf-use-own').click();
  assert.ok(first.doc.body.textContent.indexOf(first.nb.t('ownNow')) !== -1, 'the first page is on the own shelf');
  assert.strictEqual(storage.raw('nextbook-which-v1'), '"own"', 'and the choice is written down');

  const second = openPage({ storage });
  assert.strictEqual(second.nb.store.open(storage).which(), 'own');
  assert.ok(second.doc.body.textContent.indexOf(second.nb.t('shelfOwnHeading')) !== -1,
    'a reload opens on the shelf the person chose, not back on practice');
  assert.strictEqual(byTest(second.doc, 'shelf-use-own'), null, 'so the switch now offers practice');
});

test('P5: keyboard focus stays on the control after a state or rating change', () => {
  const { doc } = openPage({});

  const reading = byTest(doc, 'shelf-state-1-reading');
  assert.ok(reading, 'the first row has a state control with a Reading choice');
  reading.focus();
  assert.strictEqual(doc.activeElement, reading);
  reading.checked = true;
  reading.dispatch('change', { type: 'change', target: reading });

  const readingAgain = byTest(doc, 'shelf-state-1-reading');
  assert.notStrictEqual(readingAgain, reading, 'the screen was rebuilt');
  assert.strictEqual(doc.activeElement, readingAgain, 'but the keyboard is still on the state control');

  const liked = byTest(doc, 'shelf-rating-1-liked');
  liked.focus();
  liked.click();
  assert.strictEqual(doc.activeElement, byTest(doc, 'shelf-rating-1-liked'), 'and on the rating chip after a rating');
});

// The shelf's controls are one decision, not two: what a rating means follows the state.
// The page's own storage, opened again, is what the page wrote.
const firstEntry = (nb, storage) => nb.store.open(storage).shelf()[0];
const choose = (doc, value) => {
  const radio = byTest(doc, 'shelf-state-1-' + value);
  radio.checked = true;
  radio.dispatch('change', { type: 'change', target: radio });
};

test('P5b: the state is one radio group, and the chosen state is the checked one', () => {
  const storage = memoryStorage();
  const { nb, doc } = openPage({ storage });
  const stateOf = () => firstEntry(nb, storage).state;
  const group = byTest(doc, 'shelf-state-1');
  assert.strictEqual(group.tagName.toLowerCase(), 'fieldset', 'a fieldset, so the four choices are one group');
  const radios = all(doc, '[data-test]').filter((el) => /^shelf-state-1-/.test(el.getAttribute('data-test')));
  assert.deepStrictEqual(radios.map((r) => r.getAttribute('value')), ['want', 'hold', 'reading', 'read', 'stopped']);
  assert.ok(radios.every((r) => r.getAttribute('name') === radios[0].getAttribute('name')), 'one name, so one tab stop');
  const on = radios.filter((r) => r.hasAttribute('checked')).map((r) => r.getAttribute('value'));
  assert.deepStrictEqual(on, [stateOf()]);
});

test('P5c: a book to read has no rating to give; reading is rated so far; read is rated as it was', () => {
  const storage = memoryStorage();
  const { nb, doc } = openPage({ storage });
  const stateOf = () => firstEntry(nb, storage).state;
  const ratingOf = () => firstEntry(nb, storage).rating;
  // The practice shelf's first book is read and loved.
  assert.strictEqual(stateOf(), 'read');
  const label = () => byTest(doc, 'shelf-rating-1') && byTest(doc, 'shelf-rating-1').getAttribute('aria-label');
  assert.strictEqual(label(), nb.t('ratingHowWas'));

  choose(doc, 'reading');
  assert.strictEqual(label(), nb.t('ratingSoFar'), 'reading asks how it is so far');
  assert.strictEqual(ratingOf(), 'loved', 'and the rating is kept');

  // A rating on a "want" stays in sight while there is one, so nothing hidden still scores.
  choose(doc, 'want');
  assert.strictEqual(label(), nb.t('ratingLabel'));
  byTest(doc, 'shelf-rating-1-loved').click();
  assert.strictEqual(ratingOf(), null, 'pressing the chip that is on takes the rating off');
  assert.strictEqual(byTest(doc, 'shelf-rating-1'), null, 'and then a book to read shows no rating at all');

  choose(doc, 'read');
  assert.ok(byTest(doc, 'shelf-rating-1'), 'a read book asks again');
  const pressed = () => all(doc, '[data-test]')
    .filter((el) => /^shelf-rating-1-/.test(el.getAttribute('data-test')) && el.getAttribute('aria-pressed') === 'true')
    .map((el) => el.getAttribute('data-test'));
  assert.deepStrictEqual(pressed(), []);
  byTest(doc, 'shelf-rating-1-liked').click();
  assert.strictEqual(ratingOf(), 'liked');
  assert.deepStrictEqual(pressed(), ['shelf-rating-1-liked'], 'one chip is pressed, and it is the rating');
});

test('the shelf rows still show the books the practice data seeds', () => {
  const { doc } = openPage({});
  assert.deepStrictEqual(plain(keys(doc)), plain(PRACTICE.entries.map((e) => e.key)));
});

test('P5d: the filter shows one state of the shelf, says how many, and All brings the rest back', () => {
  const { doc } = openPage({});
  const total = rows(doc).length;
  const all12 = byTest(doc, 'shelf-filter-all');
  assert.ok(all12, 'the shelf has a filter');
  assert.strictEqual(all12.getAttribute('aria-pressed'), 'true', 'and starts on All');
  assert.ok(all12.textContent.indexOf(String(total)) !== -1, 'All says how many books there are');

  byTest(doc, 'shelf-filter-reading').click();
  const reading = rows(doc).length;
  assert.ok(reading > 0 && reading < total, 'Reading shows only the books being read');
  assert.ok(byTest(doc, 'shelf-filter-reading').textContent.indexOf(String(reading)) !== -1, 'with its own count');
  assert.strictEqual(byTest(doc, 'shelf-filter-stopped') !== null, true, 'a state with a book has a chip');

  byTest(doc, 'shelf-filter-all').click();
  assert.strictEqual(rows(doc).length, total);
});

// T8.12: the library account, one click away, and "Sign in and hold" on a book with a record.
const FOUND_BOOK = {
  id: 'S234C4827395', groupKey: 'turbulent_sun_test', title: 'The Turbulent Sun', author: 'Leon Golub',
  year: 2001, facets: [], found: { query: 'the sun' },
};
const withFoundWant = () => ({
  schema: PRACTICE.schema,
  entries: PRACTICE.entries.concat([{
    key: 'w:turbulent_sun_test', id: FOUND_BOOK.id, groupKey: FOUND_BOOK.groupKey, title: FOUND_BOOK.title,
    author: FOUND_BOOK.author, state: 'want', rating: null, updated: '2026-11-01T10:00:00Z',
  }]),
});

test('T8.12: the shelf and find screens offer the library account, signed in on the library\'s page', () => {
  const lib = SLICE.library;
  assert.ok(lib.account && lib.account.signIn, 'the slice names the library\'s sign-in page');
  for (const [hash, test] of [['#shelf', 'shelf-account'], ['#find', 'find-account']]) {
    const { nb, doc } = openPage({ hash });
    assert.ok(byTest(doc, test), test + ' is drawn');
    assert.strictEqual(byTest(doc, test + '-holds').getAttribute('href'),
      lib.account.signIn.replace('{path}', encodeURIComponent(lib.account.holds)));
    assert.ok(byTest(doc, test + '-forLater') && byTest(doc, test + '-checkedOut'));
    assert.strictEqual(byTest(doc, test + '-holds').getAttribute('target'), '_blank', 'it opens beside this page');
    assert.ok(doc.body.textContent.indexOf(nb.t('accountNote')) !== -1, 'and says this page never sees the card');
  }
  const bare = Object.assign({}, SLICE, { library: Object.assign({}, SLICE.library, { account: undefined }) });
  const { doc } = openPage({ slice: JSON.parse(JSON.stringify(bare)) });
  assert.strictEqual(byTest(doc, 'shelf-account'), null, 'a library with no sign-in page: no box at all');
});

test('T8.12: a book to read with a record offers Sign in and hold; a pack book has no record to hold', () => {
  const { doc } = openPage({ practice: withFoundWant(), found: { schema: 'nextbook/found-1', works: [FOUND_BOOK] } });
  const holds = all(doc, '[data-test]').filter((el) => /^shelf-hold-/.test(el.getAttribute('data-test')));
  assert.strictEqual(holds.length, 1, 'only the found book, which has a record, can be held from here');
  assert.ok(holds[0].getAttribute('href').endsWith(encodeURIComponent('/v2/record/' + FOUND_BOOK.id)),
    'signing in lands on the book\'s own page');
  const row = holds[0].parentNode.parentNode.parentNode;
  assert.strictEqual(row.getAttribute('data-book'), 'w:turbulent_sun_test');
});

// D42: "On hold" is a state of its own, and the page asks for it at the moment it happens.
// The found book's row, wherever it sits in the practice list.
const foundRow = (doc) => all(doc, '[data-book]').filter((el) => el.getAttribute('data-book') === 'w:turbulent_sun_test')[0];
const inFoundRow = (doc, prefix) => {
  const row = foundRow(doc);
  return row ? all(row, '[data-test]').filter((el) => el.getAttribute('data-test').indexOf(prefix) === 0)[0] || null : null;
};
const holdOf = (doc) => inFoundRow(doc, 'shelf-hold-');
const heldOf = (doc) => inFoundRow(doc, 'shelf-holds-');
const ratingOfFound = (doc) => all(foundRow(doc), '[data-test]')
  .filter((el) => /^shelf-rating-\d+$/.test(el.getAttribute('data-test')))[0] || null;

test('D42: back from Sign in and hold, one press says the hold went through', () => {
  const storage = memoryStorage();
  const { nb, doc, fire } = openPage({ storage, practice: withFoundWant(), found: { schema: 'nextbook/found-1', works: [FOUND_BOOK] } });
  holdOf(doc).click();
  fire('focus');
  assert.strictEqual(statusText(doc), nb.t('holdAsk', { title: FOUND_BOOK.title }));
  byTest(doc, 'message-hold-yes').click();
  const held = nb.store.open(storage).shelf().filter((e) => e.key === 'w:turbulent_sun_test')[0];
  assert.strictEqual(held.state, 'hold');
  assert.strictEqual(statusText(doc), nb.t('holdMarked', { title: FOUND_BOOK.title }));
  assert.strictEqual(byTest(doc, 'message-hold-yes'), null, 'the button goes with its question');

  // Now a held book: no rating to give, and its link is the person's holds.
  assert.strictEqual(holdOf(doc), null);
  assert.ok(heldOf(doc), 'a held book links to your holds');
  assert.strictEqual(ratingOfFound(doc), null, 'and asks for no rating');
});

test('D42: closing the question leaves the book as it was', () => {
  const storage = memoryStorage();
  const { nb, doc, fire } = openPage({ storage, practice: withFoundWant(), found: { schema: 'nextbook/found-1', works: [FOUND_BOOK] } });
  holdOf(doc).click();
  fire('focus');
  byTest(doc, 'message-close').click();
  const entry = nb.store.open(storage).shelf().filter((e) => e.key === 'w:turbulent_sun_test')[0];
  assert.strictEqual(entry.state, 'want');
  fire('focus');
  assert.strictEqual(statusText(doc), '', 'asked once per trip');
});

test('D42: the filter counts books on hold', () => {
  const storage = memoryStorage();
  const { doc } = openPage({ storage });
  const count = () => Number(all(byTest(doc, 'shelf-filter-hold'), '.nb-filter-count')[0].textContent);
  const before = count();
  assert.ok(before >= 1, 'the practice shelf has a book on hold');
  const radio = byTest(doc, 'shelf-state-1-hold');
  radio.checked = true;
  radio.dispatch('change', { type: 'change', target: radio });
  assert.strictEqual(count(), before + 1);
});



test('agent snapshot follows active shelf and cannot mutate it', () => {
  const {nb, doc} = openPage({storage: memoryStorage()});
  const first = nb.shell.shelfSnapshot();
  assert.strictEqual(first.which, 'practice');
  assert.ok(first.entries.length > 0);
  first.entries.length = 0;
  assert.ok(nb.shell.shelfSnapshot().entries.length > 0);
  byTest(doc, 'shelf-use-own').click();
  assert.strictEqual(nb.shell.shelfSnapshot().which, 'own');
  assert.strictEqual(nb.shell.shelfSnapshot().entries.length, 0);
  addTyped(doc, 'Piranesi', 'Susanna Clarke');
  assert.strictEqual(nb.shell.shelfSnapshot().entries[0].title, 'Piranesi');
});

test('P6: the shelf screen says how many library books are not on the shelf', () => {
  const { doc } = openPage({});
  const line = doc.body.textContent.match(/(\d+) unshelved books? in your library list/);
  assert.ok(line, 'the unshelved count is on the page');
  assert.ok(Number(line[1]) >= 1, 'and it counts the library books that are not shelved');
});

test('P7: books that came with the copy are not announced as found by the helper', () => {
  const found = { schema: 'nextbook/found-1', searches: [{ query: 'horror novels', fetched: '2026-11-07T00:00:00Z', works: 1, starter: true }],
    facets: {}, works: [{ id: 'S1AAA', groupKey: 'x', title: 'Some Book', subtitle: null, author: 'A Writer', authorKey: 'writer, a',
      year: 2001, formats: ['BK'], contentType: 'FICTION', audience: 'ADULT', language: 'eng', callNumber: 'FIC WRI', series: [],
      facets: [], found: { query: 'horror novels', starter: true } }] };
  const { doc } = openPage({ found });
  assert.strictEqual(byTest(doc, 'found-notice'), null, 'no "your helper found" for books that shipped with the copy');
});
