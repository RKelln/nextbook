'use strict';
// T2.5: links out. The templates belong to the library data, so the same test library is a
// made-up host: nothing here or in app/core may name a real catalogue.
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_load.js');

const nb = load(['app/core/base.js', 'app/core/links.js']);

const LIBRARY = {
  name: 'A Library',
  recordUrl: 'https://catalogue.example.org/record/{id}',
  searchUrl: 'https://catalogue.example.org/search?type=keyword&query={q}',
  idPattern: '^S\\d+C\\d+$',
};
const PACK_LIBRARY = { name: LIBRARY.name, recordUrl: null, searchUrl: LIBRARY.searchUrl, idPattern: LIBRARY.idPattern };

const PACK_WORK = {
  id: 'pack-dispossessed',
  groupKey: 'pack:dispossessed',
  title: 'The Dispossessed',
  author: 'Ursula K. Le Guin',
  year: 1974,
  formats: [],
};

function queryOf(url) {
  const i = url.indexOf('query=');
  assert.ok(i !== -1, 'the search URL should carry a query: ' + url);
  return url.slice(i + 'query='.length);
}

test('a pack work (no recordUrl) links to the library search, by title and author', () => {
  const url = nb.links.linkFor(PACK_WORK, PACK_LIBRARY);
  assert.strictEqual(url,
    'https://catalogue.example.org/search?type=keyword&query=The+Dispossessed+Ursula+K.+Le+Guin');
  assert.strictEqual(queryOf(url), 'The+Dispossessed+Ursula+K.+Le+Guin'); // spaces are +
});

test('a pack work enriched by a find links to its record', () => {
  const enriched = Object.assign({}, PACK_WORK, {
    recordId: 'S234C4805630', formats: ['BK'], callNumber: '813.54 LEG',
  });
  assert.strictEqual(nb.links.linkFor(enriched, LIBRARY),
    'https://catalogue.example.org/record/S234C4805630');
  // The pack id is not a record id: it only becomes one when a find says so.
  // BUILD.md T2.5: an id links to the record when library.recordUrl is set; today's pack slice
  // carries recordUrl: null, so real pack works take the search path above.
  assert.strictEqual(nb.links.linkFor(PACK_WORK, LIBRARY),
    'https://catalogue.example.org/record/pack-dispossessed');
});

test('a found work (its id is a record id) links to the record page', () => {
  const found = {
    id: 'S111C222', groupKey: 'turbulent_sun', title: 'The Turbulent Sun',
    author: 'Leon Golub', found: { query: 'the sun' },
  };
  assert.strictEqual(nb.links.linkFor(found, LIBRARY),
    'https://catalogue.example.org/record/S111C222');
});

test('a typed book with no record links to the search page', () => {
  const typed = { key: 't:Piranesi|Susanna Clarke', id: null, groupKey: null, title: 'Piranesi', author: 'Susanna Clarke' };
  assert.strictEqual(nb.links.linkFor(typed, LIBRARY),
    'https://catalogue.example.org/search?type=keyword&query=Piranesi+Susanna+Clarke');

  // An entry with only a title is still searchable.
  assert.strictEqual(queryOf(nb.links.linkFor({ title: 'Piranesi' }, LIBRARY)), 'Piranesi');
});

test('& and # in a title are encoded, so neither ends the query', () => {
  const odd = { title: 'Salt & Pepper #1', author: 'Ada X' };
  const url = nb.links.linkFor(odd, LIBRARY);
  const q = queryOf(url);

  assert.strictEqual(q, 'Salt+%26+Pepper+%231+Ada+X');
  assert.strictEqual(q.indexOf('&'), -1);
  assert.strictEqual(q.indexOf('#'), -1);
  assert.strictEqual(url.indexOf('#'), -1);
  // The template's own & (between parameters) is untouched, and {q} is gone.
  assert.ok(url.indexOf('{q}') === -1);
  assert.strictEqual(url.indexOf('query=') > url.indexOf('&'), true);
});

test('a plus sign and a slash in a title survive the round trip', () => {
  const q = queryOf(nb.links.linkFor({ title: 'C++ / Rust', author: 'A B' }, LIBRARY));
  assert.strictEqual(q, 'C%2B%2B+%2F+Rust+A+B');
  assert.strictEqual(decodeURIComponent(q.replace(/\+/g, ' ')), 'C++ / Rust A B');
});

test('nothing but the library templates decides the address', () => {
  const other = {
    name: 'Another Library',
    recordUrl: 'https://books.example.net/item/{id}',
    searchUrl: 'https://books.example.net/find?q={q}',
  };
  assert.strictEqual(nb.links.linkFor({ recordId: 'X1' }, other), 'https://books.example.net/item/X1');
  assert.strictEqual(nb.links.linkFor({ title: 'Piranesi' }, other), 'https://books.example.net/find?q=Piranesi');
});

test('a template that cannot be used gives an empty string, never a broken link', () => {
  assert.strictEqual(nb.links.linkFor(PACK_WORK, { recordUrl: null, searchUrl: null }), '');
  assert.strictEqual(nb.links.linkFor(PACK_WORK, {}), '');
  assert.strictEqual(nb.links.linkFor(PACK_WORK, null), '');
  assert.strictEqual(nb.links.linkFor(null, LIBRARY), '');
  assert.strictEqual(nb.links.linkFor({ title: 'A Book' }, { recordUrl: '{id}' }), '');
});

test('a record id is encoded, and a recordId wins over an id', () => {
  assert.strictEqual(nb.links.linkFor({ id: 'pack-1', recordId: 'S1C2' }, LIBRARY),
    'https://catalogue.example.org/record/S1C2');
  assert.strictEqual(nb.links.linkFor({ id: 'a b/c' }, LIBRARY),
    'https://catalogue.example.org/record/a%20b%2Fc');
});
