'use strict';
// T8.9d: reading the inbox, on its own. No DOM and no storage: the shell applies what this
// returns. `updated` values are built from the real clock here, because the only clock the
// reader is given is `opts.now`.
//
//   R1  a whole record passes as it is, every field carried
//   R2  a record that is not a book is refused, named by where it sat
//   R3  a record with no key is refused and named by its title
//   R4  a record with no date, or a date that cannot be read, is refused
//   R5  two days ahead is refused; an hour ahead is the day's slack and passes
//   R6  the wrapper is checked first: a bad schema is one sentence and no records
//   R7  a note with no name, or no list, is one sentence
//   R8  the page loads the reader before the shell, and the note after the workshop flag
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./_load.js');

const plain = (value) => JSON.parse(JSON.stringify(value));
const nb = load(['app/core/base.js', 'app/core/inbox.js']);
const inbox = nb.inbox;

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const record = (extra) => Object.assign({
  key: 't:piranesi|susanna clarke', title: 'Piranesi', author: 'Susanna Clarke',
  state: 'read', rating: 'loved', updated: iso(NOW),
}, extra || {});

test('R1: a whole record passes as it is, with every field carried', () => {
  const given = record({ library: { shelf: 'completed', rating10: 9 }, from: 'goodreads' });
  const seen = plain(inbox.read([given], { now: iso(NOW) }));

  assert.deepStrictEqual(seen.accepted, [given], 'the entry is whole, unknown fields included');
  assert.deepStrictEqual(seen.refused, []);
  assert.deepStrictEqual(seen.reasons, []);
  assert.strictEqual(given.key, 't:piranesi|susanna clarke', 'the caller\'s record is not changed');
});

test('R2: a record that is not a book is refused, and named by where it sat', () => {
  const seen = plain(inbox.read([record(), 'Piranesi'], { now: iso(NOW) }));

  assert.strictEqual(seen.accepted.length, 1);
  assert.deepStrictEqual(seen.refused, ['change 2']);
  assert.deepStrictEqual(seen.reasons, ['Change 2 from your helper is not a book, so it was left out.']);
});

test('R3: a record with no key is refused, and named by its title', () => {
  const seen = plain(inbox.read([record({ key: '' })], { now: iso(NOW) }));

  assert.strictEqual(seen.accepted.length, 0);
  assert.deepStrictEqual(seen.refused, ['"Piranesi"']);
  assert.deepStrictEqual(seen.reasons, ['"Piranesi" has no key, so it was left out.']);
});

test('R4: a record with no date, or a date that cannot be read, is refused', () => {
  const missing = plain(inbox.read([record({ updated: undefined })], { now: iso(NOW) }));
  assert.deepStrictEqual(missing.reasons, ['"Piranesi" has no date, so it was left out.']);

  const broken = plain(inbox.read([record({ updated: 'last tuesday' })], { now: iso(NOW) }));
  assert.deepStrictEqual(broken.reasons,
    ['"Piranesi" has a date this page cannot read, so it was left out.']);
});

test('R5: two days ahead is refused, an hour ahead is the day\'s slack and passes', () => {
  const ahead = record({ title: 'The Left Hand of Darkness', key: 't:left hand of darkness|ursula k le guin',
    updated: iso(NOW + 3600 * 1000) });
  const future = record({ title: 'Kindred', key: 't:kindred|octavia e butler',
    updated: iso(NOW + 2 * 24 * 3600 * 1000) });

  const seen = plain(inbox.read([ahead, future], { now: iso(NOW) }));

  assert.deepStrictEqual(seen.accepted.map((e) => e.title), ['The Left Hand of Darkness']);
  assert.deepStrictEqual(seen.refused, ['"Kindred"']);
  assert.deepStrictEqual(seen.reasons,
    ['"Kindred" says it was changed after today, so it was left out.']);

  // Exactly one day ahead is still the day of slack: "more than a day" is the rule.
  const edge = record({ updated: iso(NOW + 24 * 3600 * 1000) });
  assert.strictEqual(plain(inbox.read([edge], { now: iso(NOW) })).accepted.length, 1);
});

test('R6: the wrapper is checked first: a bad schema is one sentence and no records', () => {
  const doc = { schema: 'nextbook/inbox-2', id: 'abc', records: [record()], source: 'ai' };
  const seen = plain(inbox.check(doc, { now: iso(NOW) }));

  assert.strictEqual(seen.ok, false);
  assert.strictEqual(seen.error,
    'That note was saved by a different version of the app, so nothing was brought in.');
  assert.strictEqual(seen.accepted, undefined, 'nothing is handed back to apply');

  const good = plain(inbox.check({ schema: 'nextbook/inbox-1', id: 'a1', records: [record()] },
    { now: iso(NOW) }));
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.id, 'a1');
  assert.strictEqual(good.accepted.length, 1);
});

test('R7: a note with no name, or no list, is one sentence', () => {
  const nameless = plain(inbox.check({ schema: 'nextbook/inbox-1', records: [] }, {}));
  assert.strictEqual(nameless.ok, false);
  assert.strictEqual(nameless.error, 'That note has no name, so nothing was brought in.');

  const noList = plain(inbox.check({ schema: 'nextbook/inbox-1', id: 'a1', records: {} }, {}));
  assert.strictEqual(noList.ok, false);
  assert.strictEqual(noList.error, 'That note has no list of books, so nothing was brought in.');

  const nothing = plain(inbox.check(null, {}));
  assert.strictEqual(nothing.error, 'There is no note from your helper, so nothing was brought in.');
});

test('R8: the page loads the reader before the shell, and the note after the workshop flag', () => {
  const html = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const at = (src) => html.indexOf('src="' + src + '"');

  assert.ok(at('core/inbox.js') !== -1, 'core/inbox.js is loaded at all');
  assert.ok(at('core/inbox.js') < at('core/shell.js'), 'and before the shell that applies it');
  assert.ok(at('data/inbox.js') !== -1, 'the note file is loaded');
  assert.ok(at('data/workshop.js') < at('data/inbox.js'), 'after the workshop flag');
  assert.ok(at('data/inbox.js') < at('core/shell.js'), 'and before the shell reads it at boot');
});

test('R9: notes already read are kept newest last, and at most twenty', () => {
  const storeNb = load(['app/core/base.js', 'app/core/store.js']);
  const map = new Map();
  const storage = {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
  const store = storeNb.store.open(storage);

  assert.deepStrictEqual(plain(store.inboxApplied()), [], 'nothing read yet');
  for (let i = 0; i < 25; i += 1) assert.strictEqual(store.inboxMark('note-' + i), true);
  assert.strictEqual(store.inboxMark('note-24'), true, 'marking one twice is not an error');

  const list = plain(store.inboxApplied());
  assert.strictEqual(list.length, 20, 'the list is bounded');
  assert.strictEqual(list[0], 'note-5', 'the oldest five fell off');
  assert.strictEqual(list[19], 'note-24', 'the newest is last');
  assert.strictEqual(store.inboxMark(''), false, 'no name, nothing to remember');
  assert.strictEqual(JSON.parse(map.get('nextbook-inbox-applied-v1')).length, 20);
});
