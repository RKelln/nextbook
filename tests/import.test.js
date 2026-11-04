'use strict';
// T8.9a: the two CSV readers. The CSV edges first, then each fixture, one assertion per
// mapping decision, and an end-to-end run through Nextbook.merge.plan. Objects come from a
// vm realm, so compare them after a JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load, root } = require('./_load.js');

const NOW = '2026-11-03T16:44:00Z';
const nb = load(['app/core/base.js', 'app/core/import.js', 'app/core/merge.js']);
const plain = (value) => JSON.parse(JSON.stringify(value));

const READ = (name) => fs.readFileSync(path.join(root, 'tests/fixtures/import', name), 'utf8');
const grText = READ('goodreads.csv');
const sgText = READ('storygraph.csv');
const gr = plain(nb.csv.goodreads(grText));
const sg = plain(nb.csv.storygraph(sgText));

const byTitle = (out, start) => out.entries.filter((e) => e.title.indexOf(start) === 0)[0];

// ---- The CSV reader -------------------------------------------------------------------------

test('rows: a quoted field keeps its comma and its doubled quotes', () => {
  assert.deepStrictEqual(plain(nb.csv.rows('a,"b,c",d\n')), [['a', 'b,c', 'd']]);
  assert.deepStrictEqual(plain(nb.csv.rows('"say ""hi""",x\n')), [['say "hi"', 'x']]);
});

test('rows: a newline inside a quoted field is part of the cell', () => {
  assert.deepStrictEqual(plain(nb.csv.rows('a,"one\ntwo"\n')), [['a', 'one\ntwo']]);
});

test('rows: CRLF ends a row and a BOM is not a cell', () => {
  assert.deepStrictEqual(plain(nb.csv.rows('a,b\r\n1,2\r\n')), [['a', 'b'], ['1', '2']]);
  const bom = String.fromCharCode(0xfeff) + 'a,b\n';
  assert.deepStrictEqual(plain(nb.csv.rows(bom)), [['a', 'b']]);
});

test('rows: ragged rows are padded to the widest and blank lines are skipped', () => {
  assert.deepStrictEqual(plain(nb.csv.rows('a,b,c\n1,2\n')), [['a', 'b', 'c'], ['1', '2', '']]);
  assert.deepStrictEqual(plain(nb.csv.rows('a\n\nb\n')), [['a'], ['b']]);
});

test('rows: each fixture is a header and six rows, five of them readable', () => {
  assert.strictEqual(nb.csv.rows(grText).length, 7);
  assert.strictEqual(nb.csv.rows(sgText).length, 7);
  assert.strictEqual(gr.entries.length, 5, 'the empty-title row is named, not used');
  assert.strictEqual(sg.entries.length, 5);
});

// ---- Goodreads ------------------------------------------------------------------------------

test('goodreads: five entries, five works, one problem, and the file is complete', () => {
  assert.strictEqual(gr.entries.length, 5);
  assert.strictEqual(gr.works.length, 5);
  assert.deepStrictEqual(gr.problems, ['Row 7 has no title, so it was left out.']);
  assert.deepStrictEqual(gr.complete, { for_later: true, in_progress: true, completed: true });

  gr.entries.forEach((entry) => {
    assert.strictEqual(entry.id, null, 'no invented record id');
    assert.strictEqual(entry.groupKey, null, 'no invented group key');
    assert.strictEqual(entry.from, 'goodreads');
  });
  gr.works.forEach((work) => {
    assert.strictEqual(work.groupKey, null);
    assert.ok(!Object.prototype.hasOwnProperty.call(work, 'id'), 'a work carries no record id');
  });
});

test('goodreads: shelf words become states, and the shelf code matches the state', () => {
  assert.strictEqual(byTitle(gr, 'The Dispossessed').state, 'read');
  assert.strictEqual(byTitle(gr, 'The Left Hand').state, 'reading');
  assert.strictEqual(byTitle(gr, 'A Wizard of Earthsea').state, 'want');

  assert.strictEqual(byTitle(gr, 'The Dispossessed').shelf, 'completed');
  assert.strictEqual(byTitle(gr, 'The Left Hand').shelf, 'in_progress');
  assert.strictEqual(byTitle(gr, 'A Wizard of Earthsea').shelf, 'for_later');
});

test('goodreads: whole stars become buckets and an exact number out of ten', () => {
  const five = byTitle(gr, 'The Dispossessed');
  assert.strictEqual(five.rating, 'loved');
  assert.strictEqual(five.rating10, 10);

  const four = byTitle(gr, 'The Left Hand');
  assert.strictEqual(four.rating, 'liked');
  assert.strictEqual(four.rating10, 8);

  const three = byTitle(gr, 'The Hunger Games');
  assert.strictEqual(three.rating, 'ok');
  assert.strictEqual(three.rating10, 6);

  const two = byTitle(gr, 'Piranesi');
  assert.strictEqual(two.rating, 'not-for-me');
  assert.strictEqual(two.rating10, 4);
});

test('goodreads: an empty rating is not rated', () => {
  const none = byTitle(gr, 'A Wizard of Earthsea');
  assert.strictEqual(none.rating, null);
  assert.strictEqual(none.rating10, 0);
});

test('goodreads: ISBN wrappers and quotes are stripped, and a 13-digit one is kept as is', () => {
  assert.strictEqual(byTitle(gr, 'The Dispossessed').isbn, '9780060512750');
  assert.strictEqual(byTitle(gr, 'The Hunger Games').isbn, '9780439023481');
  gr.entries.forEach((entry) => {
    assert.ok(entry.isbn.indexOf('=') === -1, 'the ="..." wrapper is gone');
    assert.ok(entry.isbn.indexOf('"') === -1, 'the quotes are gone');
  });
});

test('goodreads: an ISBN-10 is kept as it is when there is no 13-digit one', () => {
  assert.strictEqual(byTitle(gr, 'Piranesi').isbn, '163557563X');
  assert.strictEqual(byTitle(gr, 'The Left Hand').isbn, '9780441478125',
    'the 13-digit column wins when both are present');
});

test('goodreads: a series suffix stays in the title', () => {
  assert.strictEqual(byTitle(gr, 'The Hunger Games').title,
    'The Hunger Games (The Hunger Games, #1)');
});

test('goodreads: the review with a comma, a doubled quote and a newline is one cell', () => {
  const table = nb.csv.rows(grText);
  assert.strictEqual(table[4][7],
    'Slow at first, but "the ending" won me over.\nI would read it again.');
});

test('goodreads: Date Added is the file\'s own text, untouched', () => {
  assert.strictEqual(byTitle(gr, 'The Dispossessed').dateAdded, '2024/01/15');
});

// ---- StoryGraph -----------------------------------------------------------------------------

test('storygraph: five entries, five works, one problem, and the file is complete', () => {
  assert.strictEqual(sg.entries.length, 5);
  assert.strictEqual(sg.works.length, 5);
  assert.deepStrictEqual(sg.problems, ['Row 7 has no title, so it was left out.']);
  assert.deepStrictEqual(sg.complete, { for_later: true, in_progress: true, completed: true });
  sg.entries.forEach((entry) => assert.strictEqual(entry.from, 'storygraph'));
});

test('storygraph: did-not-finish becomes stopped and is not a problem', () => {
  const stopped = byTitle(sg, 'A Wizard of Earthsea');
  assert.strictEqual(stopped.state, 'stopped');
  assert.strictEqual(sg.problems.length, 1, 'the only problem is the empty title');
  assert.ok(sg.problems[0].indexOf('Earthsea') === -1, 'the stopped row is not named as a problem');
});

test('storygraph: half stars go to the nearer bucket and keep the exact number', () => {
  const fourAndAHalf = byTitle(sg, 'The Left Hand');
  assert.strictEqual(fourAndAHalf.state, 'reading');
  assert.strictEqual(fourAndAHalf.rating, 'loved', '4.5 stars is 9/10, the app\'s nearest bucket');
  assert.strictEqual(fourAndAHalf.rating10, 9);

  const threeAndAHalf = byTitle(sg, 'A Memory Called Empire');
  assert.strictEqual(threeAndAHalf.rating, 'liked');
  assert.strictEqual(threeAndAHalf.rating10, 7);

  const twoAndAHalf = byTitle(sg, 'Piranesi');
  assert.strictEqual(twoAndAHalf.rating, 'ok');
  assert.strictEqual(twoAndAHalf.rating10, 5);
});

test('storygraph: an empty rating is not rated, and to-read becomes want', () => {
  const none = byTitle(sg, 'A Wizard of Earthsea');
  assert.strictEqual(none.rating, null);
  assert.strictEqual(none.rating10, 0);
  assert.strictEqual(byTitle(sg, 'A Memory Called Empire').state, 'want');
});

test('storygraph: the series suffix stays and the ISBN/UID is read', () => {
  const memory = byTitle(sg, 'A Memory Called Empire');
  assert.strictEqual(memory.title, 'A Memory Called Empire (Teixcalaan, #1)');
  assert.strictEqual(memory.isbn, '9780062886480');
});

// ---- The shape the merge takes --------------------------------------------------------------

test('a key is stable and is the normalised title and author', () => {
  assert.strictEqual(byTitle(gr, 'The Dispossessed').key, 't:dispossessed|ursula k le guin');
  const again = plain(nb.csv.goodreads(grText));
  assert.deepStrictEqual(again.entries.map((e) => e.key), gr.entries.map((e) => e.key));
});

test('the three catalogue books in each fixture are real works in the slice', () => {
  const slice = JSON.parse(fs.readFileSync(path.join(root, 'data/slice.json'), 'utf8'));
  const works = new Set(slice.works.map((w) => nb.norm(w.title) + '|' + nb.norm(w.author)));
  ['The Dispossessed', 'The Left Hand of Darkness', 'A Wizard of Earthsea'].forEach((title) => {
    assert.ok(works.has(nb.norm(title) + '|' + nb.norm('Ursula K. Le Guin')),
      title + ' should be a slice work');
  });
});

test('a shelf word the reader does not know names the row and leaves it out', () => {
  const text = 'Title,Author,My Rating,ISBN,ISBN13,Exclusive Shelf,Date Added\n' +
    'A Book,A Writer,4,,,owned,2024/01/01\n';
  const out = plain(nb.csv.goodreads(text));
  assert.strictEqual(out.entries.length, 0);
  assert.strictEqual(out.problems.length, 1);
  assert.ok(/Row 2/.test(out.problems[0]), 'the row number is named');
  assert.ok(/owned/.test(out.problems[0]), 'the unknown word is named');
});

test('a rating that is not a number names the row and leaves it out', () => {
  const text = 'Title,Author,My Rating,ISBN,ISBN13,Exclusive Shelf,Date Added\n' +
    'A Book,A Writer,four,,,read,2024/01/01\n';
  const out = plain(nb.csv.goodreads(text));
  assert.strictEqual(out.entries.length, 0);
  assert.strictEqual(out.problems.length, 1);
  assert.ok(/Row 2/.test(out.problems[0]));
  assert.ok(/four/.test(out.problems[0]));
});

test('end to end: a fixture through merge.plan adds every readable row with a library memory', () => {
  const out = plain(nb.merge.plan(gr, [], { now: NOW, practice: false }));

  assert.strictEqual(out.report.added, 5);
  assert.strictEqual(out.entries.length, 5);
  assert.deepStrictEqual(out.refusals, [], 'a file export is whole, so nothing is refused');
  out.entries.forEach((entry) => {
    assert.ok(entry.library && typeof entry.library === 'object', entry.title + ' has a memory');
    assert.strictEqual(entry.library.seen, NOW, 'the memory says when it was brought in');
    assert.strictEqual(typeof entry.library.shelf, 'string');
    assert.strictEqual(typeof entry.library.rating10, 'number');
    assert.strictEqual(entry.from, 'goodreads');
  });
});
