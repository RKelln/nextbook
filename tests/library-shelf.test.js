'use strict';
// T8.8a: the library shelf page reader. The page first (a saved fixture in the shape
// docs/DATA.md measured), then the facet port against small hand-made pages, then combine()
// over two saved pages, then the security property the file exists for. Objects come from a
// vm realm, so compare them after a JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load, root } = require('./_load.js');

const NOW = '2026-11-03T16:44:00Z';
const nb = load(['app/core/base.js', 'app/core/library-shelf.js', 'app/core/merge.js']);
const plain = (value) => JSON.parse(JSON.stringify(value));

const PAGE = (name) => fs.readFileSync(path.join(root, 'tests/fixtures/tpl', name), 'utf8');
const pageOne = PAGE('shelf-page.html');
const pageTwo = PAGE('shelf-page-2.html');
const one = plain(nb.libraryShelf.read(pageOne, { now: NOW }));
const two = plain(nb.libraryShelf.read(pageTwo));

const LEFT_HAND = one.entries.filter((e) => e.title === 'The Left Hand of Darkness')[0];
const BRAIDING = one.entries.filter((e) => e.title === 'Braiding Sweetgrass')[0];
const PIRANESI = one.entries.filter((e) => e.title === 'Piranesi')[0];
const workNamed = (out, start) => out.works.filter((w) => w.title.indexOf(start) === 0)[0];

// ---- hand-made pages, for one rule at a time -------------------------------------------------
const USER = 'N0TPERS0N';
let counter = 9100;

function item(over) {
  counter += 1;
  return Object.assign({ id: 'S' + counter, metadataId: 'S' + counter, shelf: 'completed', rating: 0 }, over || {});
}

// A page with the given items and the brief for each of their record ids.
function mini(items, summary) {
  const shelves = { [USER]: {} };
  const bibs = {};
  items.forEach((it, i) => {
    shelves[USER][String(9200 + i)] = it;
    const id = it.metadataId || it.id;
    if (it.brief !== false) {
      bibs[id] = {
        briefInfo: Object.assign(
          { id: id, metadataId: id, groupKey: 'g-' + id, authors: ['Kimmerer, Robin Wall'], publicationDate: '2013' },
          it.brief || {}
        )
      };
    }
  });
  if (summary) shelves.shelfSearch = { summary: summary };
  return JSON.stringify({ entities: { shelves: shelves, bibs: bibs } });
}

// ---- the saved page --------------------------------------------------------------------------

test('the saved page parses: three entries, three works, nothing left out', () => {
  assert.strictEqual(one.ok, true);
  assert.strictEqual(one.error, '');
  assert.deepStrictEqual(one.problems, []);
  assert.strictEqual(one.entries.length, 3, 'four items, two of them editions of one work');
  assert.strictEqual(one.works.length, 3);
  assert.strictEqual(one.seen, NOW, 'the reader hands back the time it was told, and reads no clock');
});

test('an entry is exactly the shape merge.plan takes, with the library word and our state', () => {
  assert.deepStrictEqual(Object.keys(LEFT_HAND).sort(), [
    'author', 'dateAdded', 'from', 'groupKey', 'id', 'isbn', 'key', 'rating', 'rating10', 'shelf', 'state', 'title'
  ]);
  assert.strictEqual(LEFT_HAND.from, 'library-shelf');
  assert.strictEqual(LEFT_HAND.shelf, 'completed');
  assert.strictEqual(LEFT_HAND.state, 'read');
  assert.strictEqual(LEFT_HAND.id, 'S1001');
  assert.strictEqual(LEFT_HAND.isbn, '9780441478125');
  assert.strictEqual(LEFT_HAND.dateAdded, '2026-04-07');
  assert.strictEqual(LEFT_HAND.author, 'Ursula K. Le Guin', 'the catalogue spelling is turned round');
  assert.strictEqual(LEFT_HAND.key, 'w:' + LEFT_HAND.groupKey);

  assert.strictEqual(PIRANESI.shelf, 'for_later');
  assert.strictEqual(PIRANESI.state, 'want');
  assert.strictEqual(BRAIDING.shelf, 'completed');
  assert.strictEqual(BRAIDING.state, 'read');
});

test('two editions of one work are one entry with the furthest-along state', () => {
  const lefts = one.entries.filter((e) => e.title === 'The Left Hand of Darkness');
  assert.strictEqual(lefts.length, 1);
  // The paper copy is completed and the e-book is in progress. Read wins.
  assert.strictEqual(lefts[0].shelf, 'completed');
  assert.strictEqual(lefts[0].state, 'read');
  // The rating rides with the edition that got furthest (8 = four stars, on the paper copy).
  assert.strictEqual(lefts[0].rating10, 8);
  assert.strictEqual(lefts[0].rating, 'liked');
  // The work is one work too, and its facets are the union over both records.
  const works = one.works.filter((w) => w.title === 'The Left Hand of Darkness');
  assert.strictEqual(works.length, 1);
  assert.strictEqual(works[0].id, 'S1001', 'the preferred format (BK) gives the record id');
  assert.ok(works[0].facets.indexOf('genre:science-fiction') !== -1);
  assert.ok(works[0].facets.indexOf('topic:gender-identity') !== -1, 'from the paper copy only');
});

test('rating10 is kept exactly, and the bucket comes from it', () => {
  assert.strictEqual(LEFT_HAND.rating10, 8);
  assert.strictEqual(LEFT_HAND.rating, 'liked');
  assert.strictEqual(BRAIDING.rating10, 9);
  assert.strictEqual(BRAIDING.rating, 'loved');
  assert.strictEqual(PIRANESI.rating10, 7);
  assert.strictEqual(PIRANESI.rating, 'liked');

  // Every bucket, and 0 is not rated. A number out of 10 and nothing else.
  const ten = (n) => item({ brief: { title: 'Rated ' + n }, rating: n });
  const page = mini([ten(10), ten(9), ten(8), ten(7), ten(6), ten(5), ten(4), ten(1), ten(0)],
    { completed: { count: 9, page: 1, pages: 1 } });
  const out = plain(nb.libraryShelf.read(page));
  const buckets = out.entries.map((e) => e.rating);
  assert.deepStrictEqual(buckets, ['loved', 'loved', 'liked', 'liked', 'ok', 'ok', 'not-for-me', 'not-for-me', null]);
  assert.deepStrictEqual(out.entries.map((e) => e.rating10), [10, 9, 8, 7, 6, 5, 4, 1, 0]);
});

test('pages says what the page states, and complete is the shelf this page covers', () => {
  assert.deepStrictEqual(one.pages, {
    for_later: { page: 1, pages: 2, count: 2, got: 1 },
    in_progress: { page: 1, pages: 2, count: 2, got: 1 },
    completed: { page: 1, pages: 1, count: 2, got: 2 }
  });
  // Two completed books on a page that says two: whole. One in progress of two, one For
  // Later book of two on page 1 of 2: neither is whole, and the merge must not read their
  // missing books as gone.
  assert.deepStrictEqual(one.complete, { for_later: false, in_progress: false, completed: true });
});

test('a shelf the page does not mention is not complete', () => {
  const page = mini([item({ brief: { title: 'Only Book' } })], { completed: { count: 1, page: 1, pages: 1 } });
  const out = plain(nb.libraryShelf.read(page));
  assert.deepStrictEqual(out.complete, { for_later: false, in_progress: false, completed: true });
  assert.strictEqual(out.pages.for_later.count, null);
});

test('a book with no record on the page is named and left out', () => {
  const it = item({ id: 'S7', metadataId: 'S7', title: 'A Ghost Book', shelf: 'completed' });
  const page = mini([{ ...it, brief: false }], { completed: { count: 2, page: 1, pages: 1 } });
  const out = plain(nb.libraryShelf.read(page));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.entries.length, 0);
  assert.strictEqual(out.problems.length, 1);
  assert.match(out.problems[0], /A Ghost Book/);
  assert.match(out.problems[0], /no record/);
  assert.strictEqual(out.complete.completed, false, 'a book was read for that shelf, so it is not whole');
});

test('an unknown shelf word is named, not an entry, and no shelf is called whole', () => {
  const page = mini([
    item({ brief: { title: 'Finished Book' }, shelf: 'completed' }),
    item({ brief: { title: 'Abandoned Book' }, shelf: 'abandoned' })
  ], { completed: { count: 1, page: 1, pages: 1 } });
  const out = plain(nb.libraryShelf.read(page));
  assert.strictEqual(out.entries.length, 1);
  assert.strictEqual(out.problems.length, 1);
  assert.match(out.problems[0], /Abandoned Book/);
  assert.match(out.problems[0], /abandoned/);
  assert.deepStrictEqual(out.complete, { for_later: false, in_progress: false, completed: false },
    'the row shelf is exactly what could not be read');
});

test('a book with no title is named', () => {
  const page = mini([item({ title: '', brief: { title: '' } })], { completed: { count: 1, page: 1, pages: 1 } });
  const out = plain(nb.libraryShelf.read(page));
  assert.strictEqual(out.entries.length, 0);
  assert.strictEqual(out.problems.length, 1);
  assert.match(out.problems[0], /no title/);
});

// ---- what is not a shelf page -----------------------------------------------------------------

test('a file that is not a shelf page gets the one sentence, and never throws', () => {
  const cases = [
    '<!DOCTYPE html><html><body><p>Not saved from the library.</p></body></html>',
    'https://tpl.bibliocommons.com/v2/shelves/completed',
    '',
    '{"works": []}'
  ];
  cases.forEach((text) => {
    const out = plain(nb.libraryShelf.read(text));
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.error,
      'This file does not look like a page saved from the library. Save the shelf page itself, not a link to it.');
    assert.deepStrictEqual(out.entries, []);
    assert.deepStrictEqual(out.complete, { for_later: false, in_progress: false, completed: false });
  });

  [null, undefined, 42, {}, [], { entities: 'no' }, '{ broken', '<script>{oops</script>'].forEach((rubbish) => {
    assert.doesNotThrow(() => nb.libraryShelf.read(rubbish));
    assert.strictEqual(plain(nb.libraryShelf.read(rubbish)).ok, false);
  });
});

test('the JSON itself parses, with no HTML around it', () => {
  const opener = 'id="bc-initial-state">';
  const rest = pageOne.slice(pageOne.indexOf(opener) + opener.length);
  const json = rest.slice(0, rest.indexOf('</script>')).trim();
  const out = plain(nb.libraryShelf.read(json));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.entries.length, one.entries.length);
  assert.deepStrictEqual(out.entries, one.entries);
  // And as an object, for a caller that has already parsed it.
  const asObject = plain(nb.libraryShelf.read(JSON.parse(json)));
  assert.strictEqual(asObject.ok, true);
  assert.strictEqual(asObject.works.length, one.works.length);
});

// ---- the property the file exists for ---------------------------------------------------------
test('no name, email, barcode, session or token can come out of the reader', () => {
  const decoys = [
    'N0TPERS0N', 'Nora Notaperson', 'n0ra.notaperson@example.invalid',
    '99999000000000', 'session-N0TR3ALSESSION', 'token-N0TR3ALTOKEN', 'acct-N0TR3AL'
  ];
  const combined = plain(nb.libraryShelf.combine([one, two]));
  const pages = [one, two, combined];
  pages.forEach((out) => {
    const text = JSON.stringify(out);
    decoys.forEach((decoy) => {
      assert.strictEqual(text.indexOf(decoy), -1, 'the reader returned ' + decoy);
    });
  });
  // The fixture does carry them, so the test above is testing something.
  const fixture = PAGE('shelf-page.html');
  decoys.slice(0, 6).forEach((decoy) => assert.ok(fixture.indexOf(decoy) !== -1, decoy + ' is in the fixture'));
});

test('a work is the nine facts the app needs, and never a blurb, a jacket or a rating', () => {
  one.works.forEach((work) => {
    assert.deepStrictEqual(Object.keys(work).sort(), [
      'author', 'authorKey', 'facets', 'groupKey', 'id', 'isbn', 'sections', 'subjects', 'title', 'year'
    ].sort());
    assert.ok(!('description' in work));
    assert.ok(!('jacket' in work));
    assert.ok(!('rating' in work));
  });
  // And the fixture's briefs really do carry all three, so this is not a vacuous pass.
  const fixture = PAGE('shelf-page.html');
  assert.ok(fixture.indexOf('"description"') !== -1);
  assert.ok(fixture.indexOf('"jacket"') !== -1);
  assert.ok(fixture.indexOf('"rating": 4.5') !== -1);
});

// ---- the facet port ----------------------------------------------------------------------------
test('the facet rules are the adapter\'s: author headings, fast twins, form words, BISAC, genres', () => {
  const b = {
    title: 'The Facet Book',
    authors: ['Kimmerer, Robin Wall'],
    callNumber: '813.54 L2453.109',
    subjectHeadings: [
      'Kimmerer, Robin Wall, 1953-',            // rule 1: an author heading
      'Kimmerer, Robin Wall',                   // rule 1, by author key
      'Botany. fast',                           // rule 2: the "fast" twin
      'Wizards Juvenile fiction.',              // rule 4: strip the form word
      'FICTION / Science Fiction / Action bisacsh', // rule 3
      'Fantasy',                                // rule 5
      'Fiction',                                // rule 5: dropped as a genre
      'History'                                 // a form word on its own: not a topic
    ],
    genreForm: ['Science Fiction']
  };
  const page = mini([item({ brief: b })], { completed: { count: 1, page: 1, pages: 1 } });
  const work = plain(nb.libraryShelf.read(page)).works[0];

  assert.deepStrictEqual(work.facets, [
    'bisac:science-fiction',
    'genre:fantasy',
    'genre:science-fiction',
    'section:800',
    'topic:wizards'
  ]);
  assert.deepStrictEqual(work.sections, ['section:800']);
  assert.deepStrictEqual(work.subjects, ['Wizards Juvenile fiction', 'FICTION / Science Fiction / Action bisacsh',
    'Fantasy', 'Fiction', 'History'], 'the heading words the library gave, cleaned and nothing more');
  assert.strictEqual(work.author, 'Robin Wall Kimmerer');
  assert.strictEqual(work.authorKey, 'kimmerer, r');
  assert.strictEqual(work.year, 2013);
});

test('a section comes from the call number, and fiction from a Fiction heading', () => {
  const withCall = (callNumber, contentType) => mini([item({
    brief: { title: 'Shelf ' + callNumber, callNumber: callNumber, contentType: contentType || 'NONFICTION' }
  })], { completed: { count: 1, page: 1, pages: 1 } });

  const dewey = plain(nb.libraryShelf.read(withCall('500.9 ABC')));
  assert.deepStrictEqual(dewey.works[0].sections, ['section:500']);
  assert.strictEqual(nb.libraryShelf.sectionLabel('section:500'), 'the science shelves (500s)');

  const letters = plain(nb.libraryShelf.read(withCall('SCIENCE FICTION LEG')));
  assert.deepStrictEqual(letters.works[0].sections, ['section:science-fiction']);
  assert.strictEqual(nb.libraryShelf.sectionLabel('section:science-fiction'), 'the science fiction shelves');

  const fic = plain(nb.libraryShelf.read(withCall('FIC LEG')));
  assert.deepStrictEqual(fic.works[0].sections, ['section:fiction']);

  // No call number: a "Fiction" heading still says which part of the library it is.
  const heading = mini([item({
    brief: { title: 'Heading Only', subjectHeadings: ['Fiction'], contentType: 'FICTION' }
  })], { completed: { count: 1, page: 1, pages: 1 } });
  assert.deepStrictEqual(plain(nb.libraryShelf.read(heading)).works[0].sections, ['section:fiction']);

  // A non-fiction record with neither says nothing rather than guessing.
  const none = mini([item({ brief: { title: 'No Shelf', contentType: 'NONFICTION' } })],
    { completed: { count: 1, page: 1, pages: 1 } });
  assert.deepStrictEqual(plain(nb.libraryShelf.read(none)).works[0].sections, []);

  // "ON ORDER" is not a shelf address (the adapter's rule).
  const order = plain(nb.libraryShelf.read(withCall('ON ORDER')));
  assert.deepStrictEqual(order.works[0].sections, []);
});

// ---- combine: several saved pages of one shelf -------------------------------------------------
test('one page is not the shelf; the pages that cover it are', () => {
  assert.deepStrictEqual(one.complete.for_later, false, 'page 1 of 2');
  assert.deepStrictEqual(two.pages.for_later, { page: 2, pages: 2, count: 2, got: 1 });

  const alone = plain(nb.libraryShelf.combine([one]));
  assert.deepStrictEqual(alone.complete, one.complete, 'one page alone says what that page says');

  const both = plain(nb.libraryShelf.combine([one, two]));
  assert.strictEqual(both.ok, true);
  assert.deepStrictEqual(both.complete, { for_later: true, in_progress: false, completed: true });
  assert.strictEqual(both.entries.length, 4);
  assert.strictEqual(both.works.length, 4);
  assert.deepStrictEqual(both.pages.for_later, { page: null, pages: 2, count: 2, got: 2 });
  assert.deepStrictEqual(both.pages.in_progress, { page: 1, pages: 2, count: 2, got: 1 });
  assert.ok(both.entries.some((e) => e.title === 'The Dispossessed'));
});

test('combine counts a page saved twice once, and reaches the count without every page', () => {
  const twice = plain(nb.libraryShelf.combine([one, one]));
  assert.strictEqual(twice.entries.length, 3, 'deduped by key');
  assert.strictEqual(twice.pages.completed.got, 2, 'the same page is not two pages of reading');
  assert.strictEqual(twice.complete.for_later, false);

  // Page 2 of a two-page In Progress shelf, saved alone, holding the one book that is on it:
  // the count is reached, so the shelf is whole even though page 1 was never opened.
  const last = mini(
    [item({ id: 'S9', metadataId: 'S9', shelf: 'in_progress', brief: { title: 'The Last Book' } })],
    { in_progress: { count: 1, page: 2, pages: 2 } }
  );
  const short = plain(nb.libraryShelf.combine([plain(nb.libraryShelf.read(last))]));
  assert.strictEqual(short.complete.in_progress, true, 'one book saved of a one-book shelf');
  assert.strictEqual(short.pages.in_progress.got, 1);
});

test('combine with nothing usable is the one sentence', () => {
  const out = plain(nb.libraryShelf.combine([]));
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /does not look like a page saved from the library/);
  const half = plain(nb.libraryShelf.combine([plain(nb.libraryShelf.read('nope')), one]));
  assert.strictEqual(half.ok, true, 'one good page and one joke file still brings the shelf in');
  assert.strictEqual(half.entries.length, 3);
});

// ---- it is the shape merge.plan takes ----------------------------------------------------------
test('the reader output feeds merge.plan on an empty shelf', () => {
  const empty = plain(nb.merge.plan(one, [], { now: NOW }));
  assert.strictEqual(empty.report.added, 3);
  assert.deepStrictEqual(empty.tidy, []);
  // The two unfinished shelves are refused, so nothing is treated as removed.
  assert.strictEqual(empty.refusals.length, 2);

  const combined = plain(nb.libraryShelf.combine([one, two]));
  assert.strictEqual(plain(nb.merge.plan(combined, [], { now: NOW })).report.added, 4);
  assert.strictEqual(plain(nb.merge.plan(combined, [], { now: NOW })).refusals.length, 1,
    'only In Progress is unfinished once both For Later pages are in');
  assert.strictEqual(plain(nb.merge.plan(one, [], { now: NOW, practice: true })).refusals.length, 1,
    'the practice shelf still refuses a real import');
});
