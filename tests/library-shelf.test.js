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

test('a book the page has no details for is named and left out', () => {
  const it = item({ id: 'S7', metadataId: 'S7', title: 'A Ghost Book', shelf: 'completed' });
  const page = mini([{ ...it, brief: false }], { completed: { count: 2, page: 1, pages: 1 } });
  const out = plain(nb.libraryShelf.read(page));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.entries.length, 0);
  assert.strictEqual(out.problems.length, 1);
  assert.match(out.problems[0], /A Ghost Book/);
  assert.match(out.problems[0], /does not carry/);
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
  // The second page carries the shelf's own line for its one book: the last of two.
  assert.deepStrictEqual(two.pages.for_later, { page: 2, pages: 2, count: 2, got: 1, from: 2, to: 2 });

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

// ---- what a real saved page does and does not carry -------------------------------------------
// Measured on a real page (RESEARCH.md, 2026-11-04): the state has `entities.shelves.<user>` and
// no `shelfSearch` and no `meta`, so the number of books on a shelf is simply not in the file.

test('a page with no shelf totals is unknown, not partly saved, and the merge stays quiet', () => {
  const bare = plain(nb.libraryShelf.read(mini([item({ title: 'A Book', rating: 8 })]), { now: NOW }));

  assert.strictEqual(bare.entries.length, 1);
  assert.strictEqual(bare.complete.completed, false, 'nothing can be called whole without a count');
  assert.strictEqual(bare.unknown.completed, true, 'and the reader says it was not told');

  const plan = plain(nb.merge.plan(bare, [], { now: NOW }));
  assert.deepStrictEqual(plan.refusals, [], 'no "not fully saved" claim about a shelf nobody counted');
  assert.strictEqual(plan.report.gone, 0, 'and nothing is treated as removed');

  // Combine keeps that: one page, no count anywhere, still unknown.
  const together = plain(nb.libraryShelf.combine([bare]));
  assert.strictEqual(together.unknown.completed, true);
});

test('a page that does state a short shelf is still named, and still marks nothing gone', () => {
  const short = plain(nb.libraryShelf.read(
    mini([item({ title: 'One Book', rating: 6 })], { completed: { count: 12, page: 1, pages: 2 } }),
    { now: NOW }));
  assert.strictEqual(short.complete.completed, false);
  assert.strictEqual(short.unknown.completed, false, 'the page did state a count');

  const plan = plain(nb.merge.plan(short, [], { now: NOW }));
  assert.strictEqual(plan.refusals.length, 1, 'so the person is asked for the other pages');
  assert.ok(plan.refusals[0].indexOf('Completed') !== -1);
});

test('a search page is refused by name, not read as an empty shelf', () => {
  const search = JSON.stringify({
    entities: { shelves: {}, bibs: { S1: { briefInfo: { id: 'S1', groupKey: 'g1', title: 'A Result' } } } }
  });
  const out = plain(nb.libraryShelf.read(search, { now: NOW }));

  assert.strictEqual(out.ok, false);
  assert.ok(out.error.indexOf('search page') !== -1, 'says what it is: ' + out.error);
  assert.deepStrictEqual(out.entries, [], 'and brings nothing in');
});

test('an empty shelf page is a real answer, not a search page', () => {
  const empty = JSON.stringify({ entities: { shelves: { N0TPERS0N: {} }, bibs: {} } });
  const out = plain(nb.libraryShelf.read(empty, { now: NOW }));

  assert.strictEqual(out.ok, true, 'a shelf with nothing on it reads fine');
  assert.strictEqual(out.entries.length, 0);
});

// ---- the page's own count (T8.8e, D39) ---------------------------------------------------------
// The state says no totals, but the saved page says `1 to 2 of 2 items` in a header and a footer
// (measured on two real pages, 2026-11-04). The line is read from the page's text: scripts and
// tags stripped, entities read, whitespace collapsed, first match only.

// A page as a browser saves it: the state in its script, and the library's own line above and
// below it, where a real page carries it.
function shelfPage(items, summary, line) {
  const said = line ? '<div class="pagination"><span>' + line + '</span></div>' : '';
  return '<!DOCTYPE html><html><body>' + said +
    '<script type="application/json" id="bc-initial-state">' + mini(items, summary) + '</script>' +
    said + '</body></html>';
}

function shelfOfBooks(start, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const n = start + i;
    out.push(item({ id: 'B' + n, metadataId: 'B' + n, brief: { title: 'Book ' + n } }));
  }
  return out;
}

test('the page\'s own line is the shelf\'s count, and reaching the total makes it whole', () => {
  const out = plain(nb.libraryShelf.read(shelfPage(shelfOfBooks(1, 2), null, '1 to 2 of 2 items')));
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.pages.completed,
    { page: null, pages: null, count: 2, got: 2, from: 1, to: 2 });
  assert.strictEqual(out.complete.completed, true);
  assert.strictEqual(out.unknown.completed, false, 'we were told, so it is not unknown');
  // The other shelves the page does not mention are untouched by the line.
  assert.strictEqual(out.pages.for_later.count, null);
  assert.strictEqual(out.unknown.for_later, true);
});

test('the line is read through markup, entities and the dashes other locales use', () => {
  const lines = [
    'Showing 1&nbsp;to&nbsp;2 of 2&nbsp;items',
    '<b>1</b> to <b>2</b> of <b>2</b> items',
    '1 &#8211; 2 of 2 items',
    '1 – 2 of 2 items',
    '1-2 of 2 items',
    '1 TO 2 OF 2 ITEMS'
  ];
  lines.forEach((line) => {
    const out = plain(nb.libraryShelf.read(shelfPage(shelfOfBooks(1, 2), null, line)));
    assert.strictEqual(out.pages.completed.count, 2, line);
    assert.strictEqual(out.pages.completed.from, 1, line);
    assert.strictEqual(out.pages.completed.to, 2, line);
    assert.strictEqual(out.complete.completed, true, line);
  });
  // A page with no line at all is unchanged: unknown, as it was before D39.
  const bare = plain(nb.libraryShelf.read(shelfPage(shelfOfBooks(1, 2), null, '')));
  assert.strictEqual(bare.pages.completed.count, null);
  assert.strictEqual(bare.unknown.completed, true);
});

test('a shelf the page says is whole lets the merge mark a book gone; a short page does not', () => {
  const stays = item({ id: 'S41', metadataId: 'S41', brief: { title: 'Still Here' } });
  const went = item({ id: 'S42', metadataId: 'S42', brief: { title: 'Quietly Gone' } });
  const first = plain(nb.libraryShelf.read(shelfPage([stays, went], null, '1 to 2 of 2 items')));
  const ours = plain(nb.merge.plan(first, [], { now: '2025-12-01T00:00:00Z' })).entries;
  assert.strictEqual(ours.length, 2);

  // The shelf is one book now, and the page says it is the whole of it: the other book has gone.
  const whole = plain(nb.libraryShelf.read(shelfPage([stays], null, '1 to 1 of 1 items'), { now: NOW }));
  assert.strictEqual(whole.complete.completed, true);
  const plan = plain(nb.merge.plan(whole, ours, { now: NOW }));
  assert.strictEqual(plan.report.gone, 1);
  assert.strictEqual(plan.tidy.length, 1, 'and it is named, for tidying up at the library');
  assert.deepStrictEqual(plan.refusals, [], 'nothing to ask about: the page was whole');

  // One of two, and the page says so: no gone, and one refusal for the missing page.
  const short = plain(nb.libraryShelf.read(shelfPage([stays], null, '1 to 1 of 2 items'), { now: NOW }));
  assert.strictEqual(short.complete.completed, false);
  assert.strictEqual(short.unknown.completed, false, 'the page did state how many');
  const held = plain(nb.merge.plan(short, ours, { now: NOW }));
  assert.strictEqual(held.report.gone, 0);
  assert.strictEqual(held.tidy.length, 0);
  assert.strictEqual(held.refusals.length, 1);
  assert.ok(held.refusals[0].indexOf('Completed') !== -1);
});

test('a middle range is short: 11 to 20 of 40 is ten books of forty', () => {
  const out = plain(nb.libraryShelf.read(shelfPage(shelfOfBooks(11, 10), null, '11 to 20 of 40 items')));
  assert.deepStrictEqual(out.pages.completed,
    { page: null, pages: null, count: 40, got: 10, from: 11, to: 20 });
  assert.strictEqual(out.complete.completed, false);
  assert.strictEqual(out.unknown.completed, false, 'the page was understood, it is just not the end');
  assert.deepStrictEqual(plain(nb.merge.plan(out, [], { now: NOW })).refusals.length, 1,
    'the person is asked for the rest of the shelf');
});

test('two saved pages cover 1..N by their ranges: a gap is not whole, touching ranges are', () => {
  const read = (start, line) => plain(nb.libraryShelf.read(shelfPage(shelfOfBooks(start, 10), null, line)));

  // 1 to 10 and 21 to 30 of 40: books 11 to 20 were never saved, so the shelf is not whole.
  const gap = plain(nb.libraryShelf.combine([read(1, '1 to 10 of 40 items'), read(21, '21 to 30 of 40 items')]));
  assert.strictEqual(gap.complete.completed, false);
  assert.strictEqual(gap.unknown.completed, false, 'both pages said how big the shelf is');
  assert.strictEqual(gap.pages.completed.count, 40);
  assert.strictEqual(gap.pages.completed.got, 20);
  assert.strictEqual(plain(nb.merge.plan(gap, [], { now: NOW })).refusals.length, 1,
    'and nothing is marked gone from it');

  // The same page saved twice states the same range, so it is one page's worth, not two.
  const twice = plain(nb.libraryShelf.combine([read(1, '1 to 10 of 20 items'), read(1, '1 to 10 of 20 items')]));
  assert.strictEqual(twice.complete.completed, false, 'ten of twenty, however many times it was saved');
  assert.strictEqual(twice.pages.completed.got, 10);
  assert.strictEqual(twice.entries.length, 10);

  // 1 to 10 and 11 to 20 of 40 reaches the middle, not the end.
  const half = plain(nb.libraryShelf.combine([read(1, '1 to 10 of 40 items'), read(11, '11 to 20 of 40 items')]));
  assert.strictEqual(half.complete.completed, false, 'the ranges touch, but the shelf is forty books');

  // 1 to 10 and 11 to 20 of 20: the touching ranges are 1..20, which is the whole shelf.
  const whole = plain(nb.libraryShelf.combine([read(11, '11 to 20 of 20 items'), read(1, '1 to 10 of 20 items')]));
  assert.strictEqual(whole.complete.completed, true);
  assert.strictEqual(whole.pages.completed.count, 20);
  assert.strictEqual(whole.entries.length, 20);
});

test('a thousand with a comma is a thousand', () => {
  const out = plain(nb.libraryShelf.read(shelfPage(shelfOfBooks(1, 2), null, '1 to 20 of 1,744 items')));
  assert.strictEqual(out.pages.completed.count, 1744);
  assert.strictEqual(out.pages.completed.from, 1);
  assert.strictEqual(out.pages.completed.to, 20);
  assert.strictEqual(out.complete.completed, false);
  assert.strictEqual(out.unknown.completed, false);
});

test('`results` and `titles` are not a shelf: the shelf stays unknown', () => {
  ['1 to 20 of 1,744 results', '1 to 2 of 2 titles'].forEach((line) => {
    const out = plain(nb.libraryShelf.read(shelfPage(shelfOfBooks(1, 2), null, line)));
    assert.strictEqual(out.pages.completed.count, null, line);
    assert.ok(!('from' in out.pages.completed), line);
    assert.strictEqual(out.unknown.completed, true, line);
    assert.strictEqual(out.complete.completed, false, line);
    assert.deepStrictEqual(plain(nb.merge.plan(out, [], { now: NOW })).refusals, [],
      'and nothing is claimed about how much of the shelf was saved');
  });
});

test('a French line is not guessed at: the shelf stays unknown', () => {
  const out = plain(nb.libraryShelf.read(shelfPage(shelfOfBooks(1, 2), null, '1 – 2 sur 2 items')));
  assert.strictEqual(out.pages.completed.count, null);
  assert.ok(!('from' in out.pages.completed));
  assert.strictEqual(out.unknown.completed, true);
  assert.strictEqual(out.complete.completed, false);
});

test('a page of two shelves\' items has no one shelf to attribute its line to', () => {
  const items = [
    item({ id: 'S51', metadataId: 'S51', shelf: 'completed', brief: { title: 'Read It' } }),
    item({ id: 'S52', metadataId: 'S52', shelf: 'for_later', brief: { title: 'Want It' } })
  ];
  const out = plain(nb.libraryShelf.read(shelfPage(items, null, '1 to 2 of 2 items')));
  assert.strictEqual(out.pages.completed.count, null);
  assert.strictEqual(out.pages.for_later.count, null);
  assert.ok(!('from' in out.pages.completed));
  assert.deepStrictEqual(out.unknown, { for_later: true, in_progress: true, completed: true });

  // The same is true of the made-up page, which carries three shelves: its line is on it, and
  // is deliberately not attributed (tests/fixtures/tpl/README.md).
  assert.ok(PAGE('shelf-page.html').indexOf('1 to 2 of 2 items') !== -1);
  assert.ok(!('from' in one.pages.completed));

  // A page with no items has no shelf to attribute to either.
  const empty = plain(nb.libraryShelf.read(
    '<p>1 to 2 of 2 items</p><script type="application/json">' +
    JSON.stringify({ entities: { shelves: { N0TPERS0N: {} }, bibs: {} } }) + '</script>'));
  assert.strictEqual(empty.ok, true);
  assert.ok(!('from' in empty.pages.completed));
  assert.deepStrictEqual(empty.unknown, { for_later: true, in_progress: true, completed: true });
});

test('a state handed over already parsed has no page words, so the shelf stays unknown', () => {
  const out = plain(nb.libraryShelf.read(JSON.parse(mini(shelfOfBooks(1, 2)))));
  assert.strictEqual(out.pages.completed.count, null);
  assert.strictEqual(out.unknown.completed, true);
});

test('a last page on its own is not the shelf, however high its Y', () => {
  // "21 to 40 of 40 items": reaches the end, but has never seen book 1. Alone it must not let
  // the merge mark anything gone; only the shelf's own first page can start the coverage.
  const jsonPage = (items, line) =>
    '<html><body><div class="pagination"><span>' + line + '</span></div>' +
    '<script type="application/json">' + mini(items) + '</script></body></html>';

  const last = plain(nb.libraryShelf.read(
    jsonPage([{ id: 'S9001', metadataId: 'S9001', title: 'A Later Book', shelf: 'completed', rating: 8 }],
      '21 to 40 of 40 items'), { now: NOW }));
  assert.strictEqual(last.ok, true);
  assert.strictEqual(last.pages.completed.count, 40, 'the page said how many there are');
  assert.strictEqual(last.complete.completed, false, 'but it is not the whole shelf on its own');

  const first = plain(nb.libraryShelf.read(
    jsonPage([{ id: 'S9002', metadataId: 'S9002', title: 'An Early Book', shelf: 'completed', rating: 8 }],
      '1 to 20 of 40 items'), { now: NOW }));
  assert.strictEqual(first.complete.completed, false, 'the first page alone is short too');

  const covered = plain(nb.libraryShelf.combine([first, last]));
  assert.strictEqual(covered.pages.completed.count, 40);
  // 1..20 plus 21..40 is the shelf, even though neither page holds all forty books.
  assert.strictEqual(covered.unknown.completed, false);
  assert.strictEqual(covered.complete.completed, true, 'the ranges together cover 1..40');
});
