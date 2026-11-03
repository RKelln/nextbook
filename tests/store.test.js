'use strict';
// T2.8: the shelf. Storage is a plain object here, as the task says; the throwing one stands
// in for a browser that will not save. Objects come from a vm realm, so compare them after a
// JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./_load.js');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const PRACTICE = read('data/practice.json');
const plain = (value) => JSON.parse(JSON.stringify(value));

const FILES = ['app/core/base.js', 'app/core/store.js'];

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

function throwingStorage() {
  const boom = () => { throw new Error('this browser is not saving'); };
  return { getItem: boom, setItem: boom, removeItem: boom, key: boom, clear: boom, length: 0 };
}

function nbWith(data) {
  const nb = load(FILES);
  Object.keys(data || {}).forEach((name) => nb.data.put(name, data[name]));
  return nb;
}

const entry = (n, updated, extra) => Object.assign({
  key: 'w:pack:' + n,
  id: n,
  groupKey: 'pack:' + n,
  title: 'A Book ' + n,
  author: 'A Writer',
  state: 'read',
  rating: 'loved',
  updated: updated,
}, extra || {});

const shelfFile = (entries) => JSON.stringify({ schema: 'nextbook/shelf-1', exported: '2026-11-10T10:00:00Z', entries: entries });

test('the practice shelf is the default, seeded from the practice data', () => {
  const nb = nbWith({ practice: PRACTICE });
  const store = nb.store.open(memoryStorage());

  assert.strictEqual(store.persistent, true, 'a storage that works is persistent');
  assert.strictEqual(store.which(), 'practice', 'practice is the shelf a person starts on');
  assert.deepStrictEqual(plain(store.shelf()), plain(PRACTICE.entries), 'seeded from data/practice.json');
  assert.deepStrictEqual(plain(store.practice()), plain(PRACTICE.entries));
  assert.deepStrictEqual(plain(store.own()), [], 'the own shelf starts empty and is not seeded');
});

test('add keeps the merge rule: new is added, newer wins, a tie keeps ours', () => {
  const nb = nbWith({ practice: PRACTICE });
  const store = nb.store.open(memoryStorage());
  store.use('own');

  assert.deepStrictEqual(plain(store.add(entry('a', '2026-11-10T14:00:00Z'))), { added: 1, changed: 0, kept: 0 });
  assert.deepStrictEqual(plain(store.add(entry('a', '2026-11-10T14:00:00Z', { state: 'want' }))),
    { added: 0, changed: 0, kept: 1 }, 'the same updated is a tie, so ours stays');
  assert.strictEqual(store.own()[0].state, 'read');

  assert.deepStrictEqual(plain(store.add(entry('a', '2026-11-10T15:00:00Z', { state: 'reading' }))),
    { added: 0, changed: 1, kept: 0 }, 'a newer updated wins');
  assert.strictEqual(store.own()[0].state, 'reading');

  assert.deepStrictEqual(plain(store.add(entry('a', '2026-11-10T13:00:00Z', { state: 'stopped' }))),
    { added: 0, changed: 0, kept: 1 }, 'an older updated loses');
  assert.strictEqual(store.own()[0].state, 'reading');
  assert.strictEqual(store.own().length, 1, 'one entry per key');
});

test('setState and setRating edit an entry, and take the timestamp from the caller', () => {
  const nb = nbWith({ practice: PRACTICE });
  const store = nb.store.open(memoryStorage());
  store.use('own');
  store.add(entry('a', '2026-11-10T14:00:00Z'));

  const afterState = plain(store.setState('w:pack:a', 'stopped', '2026-11-11T09:00:00Z'));
  assert.strictEqual(afterState.state, 'stopped');
  assert.strictEqual(afterState.updated, '2026-11-11T09:00:00Z');
  assert.strictEqual(store.shelf()[0].state, 'stopped');

  const afterRating = plain(store.setRating('w:pack:a', 'not-for-me'));
  assert.strictEqual(afterRating.rating, 'not-for-me');
  assert.strictEqual(afterRating.updated, '2026-11-11T09:00:00Z', 'no clock: the old timestamp is left alone');

  assert.strictEqual(store.setRating('w:pack:a', null).rating, null, 'a rating can be cleared');
  assert.strictEqual(store.setState('w:pack:a', 'lost'), null, 'an unknown state is refused');
  assert.strictEqual(store.setRating('w:pack:a', 'five-stars'), null, 'an unknown rating is refused');
  assert.strictEqual(store.setState('w:pack:nope', 'read'), null, 'an unknown key is refused');
  assert.deepStrictEqual(plain(store.practice()), plain(PRACTICE.entries), 'nothing leaked into the practice shelf');
  assert.strictEqual(store.own().length, 1, 'and the edit went to the shelf in use');

  assert.strictEqual(store.remove('w:pack:a'), true);
  assert.strictEqual(store.remove('w:pack:a'), false, 'removing twice says no the second time');
  assert.deepStrictEqual(plain(store.shelf()), []);
});

test('practiceReset leaves the own shelf and friends\' shelves untouched', () => {
  const nb = nbWith({ practice: PRACTICE });
  const storage = memoryStorage();
  const store = nb.store.open(storage);

  store.use('own');
  store.add(entry('mine', '2026-11-10T14:00:00Z'));
  const friend = store.addOther(shelfFile([entry('theirs', '2026-11-10T14:10:00Z')]), 'Sam');
  assert.strictEqual(friend.added, 1);
  assert.strictEqual(friend.error, null);

  store.use('practice');
  store.setState(PRACTICE.entries[0].key, 'want', '2026-11-11T10:00:00Z');
  const reset = store.practiceReset();
  assert.strictEqual(reset.length, PRACTICE.entries.length, 'the practice shelf is refilled');
  assert.deepStrictEqual(plain(store.practice()), plain(PRACTICE.entries), 'back to the data, edits gone');

  assert.deepStrictEqual(plain(store.own()), [entry('mine', '2026-11-10T14:00:00Z')], 'the own shelf is untouched');
  assert.strictEqual(store.others().length, 1, 'the friend is untouched');
  assert.strictEqual(store.others()[0].name, 'Sam');
  assert.strictEqual(store.others()[0].entries.length, 1);
});

test('a friend\'s file never changes the own shelf, and a second file with the name replaces the first', () => {
  const nb = nbWith({ practice: PRACTICE });
  const store = nb.store.open(memoryStorage());
  store.use('own');
  store.add(entry('mine', '2026-11-10T14:00:00Z'));

  const before = plain(store.own());
  const theirs = [
    entry('mine', '2026-12-01T00:00:00Z', { state: 'want', rating: null }),
    entry('theirs', '2026-11-10T14:10:00Z'),
  ];
  const report = plain(store.addOther(shelfFile(theirs), 'Sam'));
  assert.deepStrictEqual(report, { added: 2, skipped: 0, error: null });

  assert.deepStrictEqual(plain(store.own()), before, 'the own shelf is exactly as it was, same states');
  assert.strictEqual(store.which(), 'own', 'adding a friend does not switch shelves');
  assert.deepStrictEqual(plain(store.others()), [{ name: 'Sam', entries: plain(theirs) }],
    'their entries are kept beside ours, as their own rows');

  // A second file with the same name replaces the first.
  const replacement = plain(store.addOther(shelfFile([entry('other', '2026-11-10T14:20:00Z')]), 'Sam'));
  assert.deepStrictEqual(replacement, { added: 1, skipped: 0, error: null });
  assert.strictEqual(store.others().length, 1, 'still one friend called Sam');
  assert.deepStrictEqual(plain(store.others()[0].entries).map((e) => e.key), ['w:pack:other']);

  assert.strictEqual(store.removeOther('Sam'), true);
  assert.deepStrictEqual(plain(store.others()), []);
  assert.strictEqual(store.removeOther('Sam'), false);
  assert.deepStrictEqual(plain(store.own()), before, 'the own shelf is still untouched');
});

test('export then import round-trips a shelf', () => {
  const nb = nbWith({ practice: PRACTICE });
  const store = nb.store.open(memoryStorage());
  store.use('own');
  store.add(entry('a', '2026-11-10T14:00:00Z'));
  store.add(entry('b', '2026-11-10T14:05:00Z', { state: 'want', rating: null }));

  const text = store.exportShelf('2026-11-10T14:03:00Z');
  const file = JSON.parse(text);
  assert.strictEqual(file.schema, 'nextbook/shelf-1');
  assert.strictEqual(file.exported, '2026-11-10T14:03:00Z');
  assert.deepStrictEqual(file.entries, plain(store.own()));

  const other = nb.store.open(memoryStorage());
  other.use('own');
  const report = plain(other.importShelf(text));
  assert.deepStrictEqual(report, { added: 2, changed: 0, kept: 0, skipped: 0, error: null });
  assert.deepStrictEqual(plain(other.own()), plain(store.own()), 'the same shelf comes back');

  // Importing the same file again changes nothing and keeps everything.
  const again = plain(other.importShelf(text));
  assert.deepStrictEqual(again, { added: 0, changed: 0, kept: 2, skipped: 0, error: null });
  assert.deepStrictEqual(plain(other.own()), plain(store.own()));
});

test('import: the newer updated wins, a tie keeps ours, bad rows are skipped and named in the count', () => {
  const nb = nbWith({ practice: PRACTICE });
  const store = nb.store.open(memoryStorage());
  store.use('own');
  store.add(entry('a', '2026-11-10T14:00:00Z'));
  store.add(entry('b', '2026-11-10T14:00:00Z'));

  const report = plain(store.importShelf(shelfFile([
    entry('a', '2026-11-10T15:00:00Z', { state: 'reading' }),
    entry('b', '2026-11-10T14:00:00Z', { state: 'stopped' }),
    entry('c', '2026-11-10T14:30:00Z'),
    { title: 'no key at all' },
    'not an entry',
  ])));
  assert.strictEqual(report.added, 1, 'c is new');
  assert.strictEqual(report.changed, 1, 'a is newer in the file');
  assert.strictEqual(report.kept, 1, 'b is a tie, so ours stays');
  assert.strictEqual(report.skipped, 2, 'two rows could not be read');
  assert.strictEqual(report.error, null);

  const byKey = {};
  store.own().forEach((e) => { byKey[e.key] = e; });
  assert.strictEqual(byKey['w:pack:a'].state, 'reading');
  assert.strictEqual(byKey['w:pack:b'].state, 'read', 'a tie keeps ours');
  assert.strictEqual(store.own().length, 3);
});

test('a broken import is refused with a sentence, not thrown, and nothing changes', () => {
  const nb = nbWith({ practice: PRACTICE });
  const store = nb.store.open(memoryStorage());
  store.use('own');
  store.add(entry('a', '2026-11-10T14:00:00Z'));
  const before = plain(store.own());

  const cases = [
    'not a shelf file at all',
    '',
    '{"hello":"world"}',
    '{"schema":"something/else","entries":[]}',
    '{"schema":"nextbook/shelf-1","entries":"nope"}',
  ];
  cases.forEach((text) => {
    const report = plain(store.importShelf(text));
    assert.strictEqual(typeof report.error, 'string', 'a sentence for: ' + text);
    assert.ok(report.error.length > 10);
    assert.strictEqual(report.added + report.changed + report.kept, 0, 'nothing counted as merged');
    assert.deepStrictEqual(plain(store.own()), before, 'the shelf is untouched');
  });

  const friend = plain(store.addOther('not a file', 'Sam'));
  assert.ok(friend.error && friend.added === 0, 'a friend\'s broken file says so too');
  assert.deepStrictEqual(plain(store.others()), []);
});

test('unknown keys on an entry survive add, import, export and a later edit', () => {
  const nb = nbWith({ practice: PRACTICE });
  const store = nb.store.open(memoryStorage());
  store.use('own');
  const fancy = entry('a', '2026-11-10T14:00:00Z', {
    stars: 4,
    from: 'goodreads',
    library: { shelf: 'completed', rating10: 8, ignore: null },
  });
  store.add(fancy);

  const kept = plain(store.own()[0]);
  assert.strictEqual(kept.stars, 4);
  assert.strictEqual(kept.from, 'goodreads');
  assert.deepStrictEqual(kept.library, { shelf: 'completed', rating10: 8, ignore: null });

  store.setState('w:pack:a', 'read', '2026-11-12T00:00:00Z');
  const edited = plain(store.own()[0]);
  assert.strictEqual(edited.stars, 4, 'an edit keeps what it did not touch');
  assert.deepStrictEqual(edited.library, { shelf: 'completed', rating10: 8, ignore: null });

  const other = nb.store.open(memoryStorage());
  other.use('own');
  other.importShelf(store.exportShelf());
  assert.strictEqual(plain(other.own()[0]).stars, 4, 'and they survive a file as well');
  assert.strictEqual(plain(other.own()[0]).from, 'goodreads');
  assert.deepStrictEqual(plain(other.own()[0]).library, { shelf: 'completed', rating10: 8, ignore: null });
});

test('a storage object that throws on every call still works, in memory, with persistent false', () => {
  const nb = nbWith({ practice: PRACTICE });
  const store = nb.store.open(throwingStorage());

  assert.strictEqual(store.persistent, false, 'the page can say "This browser is not saving."');
  assert.strictEqual(store.which(), 'practice');
  assert.strictEqual(store.shelf().length, PRACTICE.entries.length, 'the practice shelf still arrives');

  store.use('own');
  assert.deepStrictEqual(plain(store.add(entry('a', '2026-11-10T14:00:00Z'))), { added: 1, changed: 0, kept: 0 });
  assert.strictEqual(store.own().length, 1, 'the shelf is kept in memory');
  const edited = plain(store.setState('w:pack:a', 'reading'));
  assert.strictEqual(edited.state, 'reading');
  assert.strictEqual(edited.updated, '2026-11-10T14:00:00Z', 'no clock was read; the given timestamp stays');
  assert.strictEqual(store.own()[0].state, 'reading');
  assert.strictEqual(store.persistent, false);

  const text = store.exportShelf('2026-11-10T14:03:00Z');
  assert.strictEqual(JSON.parse(text).entries.length, 1, 'export still gives a file to keep');

  assert.strictEqual(plain(store.addOther(shelfFile([entry('theirs', '2026-11-10T14:10:00Z')]), 'Sam')).added, 1);
  assert.strictEqual(store.others().length, 1);

  assert.deepStrictEqual(plain(store.setInputs('blind-date', { mood: 'quiet' })), { mood: 'quiet' });
  assert.strictEqual(store.seed('blind-date'), null);
  assert.strictEqual(store.setSeed('blind-date', 7), 7);
  assert.strictEqual(store.seed('blind-date'), 7);
});

test('a missing or unusable storage object is the same as one that throws', () => {
  const nb = nbWith({ practice: PRACTICE });
  [null, undefined, {}, { getItem() { return null; } }].forEach((storage) => {
    const store = nb.store.open(storage);
    assert.strictEqual(store.persistent, false, 'no storage means not saving');
    assert.strictEqual(store.shelf().length, PRACTICE.entries.length, 'and still a working practice shelf');
  });
});

test('a shelf survives a reload: a second open reads the same keys', () => {
  const nb = nbWith({ practice: PRACTICE });
  const storage = memoryStorage();
  const first = nb.store.open(storage);
  first.use('own');
  first.add(entry('a', '2026-11-10T14:00:00Z'));
  first.setSeed('pick-three', 11);

  const second = nb.store.open(storage);
  assert.strictEqual(second.which(), 'practice', 'the chosen shelf is per visit; practice is where a visit starts');
  second.use('own');
  assert.deepStrictEqual(plain(second.own()), [entry('a', '2026-11-10T14:00:00Z')], 'the own shelf came back');
  assert.strictEqual(second.seed('pick-three'), 11, 'and the seed');
});

test('in a workshop copy the practice shelf is the only shelf, and use(\'own\') is refused', () => {
  const storage = memoryStorage();

  // Someone's own shelf is already in this browser, put there by an ordinary copy. A
  // workshop copy must not show it.
  const ordinary = nbWith({ practice: PRACTICE });
  const before = ordinary.store.open(storage);
  before.use('own');
  before.add(entry('private', '2026-11-10T14:00:00Z'));
  assert.strictEqual(before.own().length, 1);

  const nb = nbWith({ practice: PRACTICE, workshop: true });
  const store = nb.store.open(storage);
  assert.strictEqual(nb.workshop(), true);
  assert.strictEqual(store.which(), 'practice');
  assert.strictEqual(store.use('own'), 'practice', 'the refusal is reported by the shelf it leaves in use');
  assert.strictEqual(store.which(), 'practice');
  assert.deepStrictEqual(plain(store.shelf()), plain(PRACTICE.entries), 'the practice shelf, not the own one');
  assert.deepStrictEqual(plain(store.own()), [entry('private', '2026-11-10T14:00:00Z')],
    'the own shelf is still in the browser, just not in use');

  store.add(entry('trying', '2026-11-10T14:05:00Z'));
  assert.strictEqual(store.practice().length, PRACTICE.entries.length + 1, 'the add went to practice');
  assert.strictEqual(store.own().length, 1, 'and never to the own shelf');
});

test('per-mode inputs and the shuffle seed are kept apart, by mode', () => {
  const nb = nbWith({ practice: PRACTICE });
  const storage = memoryStorage();
  const store = nb.store.open(storage);

  assert.deepStrictEqual(plain(store.inputs('blind-date')), {}, 'nothing remembered yet');
  assert.strictEqual(store.seed('blind-date'), null);

  assert.deepStrictEqual(plain(store.setInputs('blind-date', { mood: 'quiet', years: 10 })),
    { mood: 'quiet', years: 10 });
  assert.strictEqual(store.setSeed('blind-date', 12345), 12345);

  assert.deepStrictEqual(plain(store.setInputs('swap', { who: 'Sam' })), { who: 'Sam' });
  assert.strictEqual(store.seed('swap'), null, 'another mode has no seed');

  const reloaded = nb.store.open(storage);
  assert.deepStrictEqual(plain(reloaded.inputs('blind-date')), { mood: 'quiet', years: 10 });
  assert.strictEqual(reloaded.seed('blind-date'), 12345);
  assert.deepStrictEqual(plain(reloaded.inputs('swap')), { who: 'Sam' });
  assert.deepStrictEqual(plain(reloaded.inputs('never-used')), {});

  // A seed of 0 is a seed, and setInputs replaces rather than merges.
  assert.strictEqual(reloaded.setSeed('blind-date', 0), 0);
  assert.strictEqual(reloaded.seed('blind-date'), 0);
  reloaded.setInputs('swap', { who: 'Lee' });
  assert.deepStrictEqual(plain(reloaded.inputs('swap')), { who: 'Lee' });
});

test('two stores open on one storage do not lose each other\'s writes', () => {
  const nb = nbWith({ practice: PRACTICE });
  const storage = memoryStorage();
  const a = nb.store.open(storage);
  const b = nb.store.open(storage);
  a.use('own');
  b.use('own');

  assert.deepStrictEqual(plain(a.add(entry('x', '2026-11-10T14:00:00Z'))), { added: 1, changed: 0, kept: 0 });
  assert.deepStrictEqual(plain(b.add(entry('y', '2026-11-10T14:05:00Z'))), { added: 1, changed: 0, kept: 0 });
  assert.deepStrictEqual(plain(a.add(entry('z', '2026-11-10T14:10:00Z'))), { added: 1, changed: 0, kept: 0 });

  const keys = (store) => plain(store.own()).map((e) => e.key).sort();
  assert.deepStrictEqual(keys(a), ['w:pack:x', 'w:pack:y', 'w:pack:z'], 'the first store sees all three');
  assert.deepStrictEqual(keys(b), ['w:pack:x', 'w:pack:y', 'w:pack:z'], 'and so does the second');

  // The same for a single mode record, written by two stores in turn.
  a.setInputs('blind-date', { mood: 'quiet' });
  b.setInputs('blind-date', { mood: 'strange', years: 5 });
  assert.deepStrictEqual(plain(a.inputs('blind-date')), { mood: 'strange', years: 5 },
    'the last write is the one both stores read');
});

test('a storage that answers the probe then throws on a write keeps the entry in memory', () => {
  const nb = nbWith({ practice: PRACTICE });
  const map = new Map();
  const storage = {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (key === '__nextbook_probe__') { map.set(key, String(value)); return; }
      throw new Error('this browser is full');
    },
    removeItem(key) { map.delete(key); },
  };

  const store = nb.store.open(storage);
  assert.strictEqual(store.persistent, true, 'the probe passed, so the page believes it is saving');
  store.use('own');

  assert.deepStrictEqual(plain(store.add(entry('a', '2026-11-10T14:00:00Z'))), { added: 1, changed: 0, kept: 0 });
  assert.strictEqual(store.persistent, false, 'the failed write turns persistent false, and stays false');
  assert.deepStrictEqual(plain(store.own()).map((e) => e.key), ['w:pack:a'], 'the entry is kept in memory');

  // Later writes keep working from memory, and still do not throw.
  assert.deepStrictEqual(plain(store.add(entry('b', '2026-11-10T14:05:00Z'))), { added: 1, changed: 0, kept: 0 });
  assert.deepStrictEqual(plain(store.own()).map((e) => e.key), ['w:pack:a', 'w:pack:b']);
  assert.strictEqual(store.persistent, false);

  const edited = plain(store.setState('w:pack:a', 'reading'));
  assert.strictEqual(edited.state, 'reading', 'the entry is editable in memory');
  assert.strictEqual(store.own()[0].state, 'reading');
  const text = store.exportShelf('2026-11-10T14:03:00Z');
  assert.strictEqual(JSON.parse(text).entries.length, 2, 'and export still gives a file to keep');
  assert.strictEqual(store.seed('blind-date'), null);
  assert.strictEqual(store.setSeed('blind-date', 3), 3);
  assert.strictEqual(store.seed('blind-date'), 3, 'a mode record survives in memory too');
});
