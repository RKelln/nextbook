'use strict';
// Proof for T8.8b, run by hand: three rows end to end. Each merged entry goes in through
// store.add, the shelf is read back from storage and compared after a JSON round trip.
const assert = require('node:assert');
const { load } = require('./_load.js');

const nb = load(['app/core/base.js', 'app/core/store.js', 'app/core/merge.js']);
const NOW = '2026-11-03T16:44:00Z';
const plain = (value) => JSON.parse(JSON.stringify(value));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

const entry = (n, state, rating, updated, shelf, rating10) => ({
  key: 'w:g' + n,
  id: n,
  groupKey: 'g' + n,
  title: 'A Book ' + n,
  author: 'A Writer',
  state: state,
  rating: rating,
  updated: updated,
  library: { shelf: shelf, rating10: rating10, dateAdded: '2026-01-02', seen: '2026-10-01T00:00:00Z', ignore: null }
});

const there = (n, state, rating) => ({
  key: 'w:g' + n,
  id: n,
  groupKey: 'g' + n,
  title: 'A Book ' + n,
  author: 'A Writer',
  state: state,
  rating: rating,
  updated: '2026-11-01T00:00:00Z',
  from: 'library-shelf'
});

const store = nb.store.open(memoryStorage());
store.use('own');

// Ours before the import: book 2 has changed at the library; book 3 has gone from it.
store.add(entry(2, 'want', 'loved', '2026-10-01T00:00:00Z', 'for_later', 10));
store.add(entry(3, 'read', 'loved', '2026-10-01T00:00:00Z', 'completed', 10));

const out = plain(nb.merge.plan(
  {
    entries: [there(1, 'read', 'loved'), there(2, 'reading', 'liked')],
    works: [],
    complete: { for_later: true, in_progress: true, completed: true }
  },
  store.shelf(),
  { now: NOW, practice: false }
));

out.entries.forEach((e) => store.add(e));
const back = plain(store.own());
const byKey = (k) => back.filter((e) => e.key === k)[0];

assert.strictEqual(back.length, 3, 'nothing was lost');
assert.strictEqual(byKey('w:g1').state, 'read', 'row 1: added');
assert.strictEqual(byKey('w:g1').library.seen, NOW, 'row 1: memory saved');
assert.strictEqual(byKey('w:g2').state, 'reading', 'row 2: followed the library');
assert.strictEqual(byKey('w:g2').library.shelf, 'in_progress', 'row 2: B saved');
assert.strictEqual(byKey('w:g3').library.gone, true, 'row 6: marked gone');
assert.strictEqual(byKey('w:g3').state, 'read', 'row 6: kept');

console.log(JSON.stringify({
  report: out.report,
  tidy: out.tidy.map((r) => ({ key: r.key, why: r.why, library: r.library })),
  shelf: back.map((e) => ({
    key: e.key,
    state: e.state,
    rating: e.rating,
    library: { shelf: e.library.shelf, rating10: e.library.rating10, seen: e.library.seen, gone: e.library.gone }
  }))
}));
