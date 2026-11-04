'use strict';
// T8.8b: the three-way merge from ARCHITECTURE.md, "Bringing in the library's shelf".
// One test per row of the rule table, then the edges the same section names. Objects come
// from a vm realm, so compare them after a JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_load.js');

const NOW = '2026-11-03T16:44:00Z';
const ALL_COMPLETE = { for_later: true, in_progress: true, completed: true };

const nb = load(['app/core/base.js', 'app/core/merge.js']);
const plain = (value) => JSON.parse(JSON.stringify(value));

// What the app's shelf holds: an entry in the store's shape.
function here(n, state, rating, updated) {
  return {
    key: 'w:g' + n,
    id: n,
    groupKey: 'g' + n,
    title: 'A Book ' + n,
    author: 'A Writer',
    state: state,
    rating: rating,
    updated: updated || '2026-10-01T00:00:00Z'
  };
}

// B: what the library said the last time this book was brought in.
function memory(shelf, rating10) {
  return {
    shelf: shelf,
    rating10: rating10,
    dateAdded: '2026-01-02',
    seen: '2026-10-01T00:00:00Z',
    ignore: null
  };
}

// What the reader produced for one book.
function there(n, state, rating, extra) {
  return Object.assign({
    key: 'w:g' + n,
    id: n,
    groupKey: 'g' + n,
    title: 'A Book ' + n,
    author: 'A Writer',
    state: state,
    rating: rating,
    updated: '2026-11-01T00:00:00Z',
    from: 'library-shelf'
  }, extra || {});
}

function plan(entries, ours, complete, opts) {
  return plain(nb.merge.plan(
    { entries: entries, works: [], complete: complete || ALL_COMPLETE },
    ours,
    Object.assign({ now: NOW, practice: false }, opts || {})
  ));
}

const one = (out) => out.entries.filter((e) => e.key === 'w:g1')[0];

test('row 1: new at the library, not here, is added', () => {
  const out = plan([there(1, 'read', 'loved')], []);

  assert.deepStrictEqual(out.report, { added: 1, updated: 0, kept: 0, gone: 0, ignored: 0 });
  assert.strictEqual(out.entries.length, 1);
  const added = one(out);
  assert.strictEqual(added.state, 'read');
  assert.strictEqual(added.rating, 'loved');
  assert.strictEqual(added.from, 'library-shelf', 'the entry says where it came from');
  assert.strictEqual(added.library.shelf, 'completed', 'B is the library shelf code');
  assert.strictEqual(added.library.seen, NOW, 'B says when it was brought in');
  assert.deepStrictEqual(out.tidy, []);
  assert.deepStrictEqual(out.choose, []);
  assert.deepStrictEqual(out.refusals, []);
});

test('row 2: changed at the library, not here, follows the library quietly', () => {
  const ours = [Object.assign(here(1, 'want', 'loved'), { library: memory('for_later', 10) })];
  const out = plan([there(1, 'reading', 'liked')], ours);

  assert.strictEqual(out.report.updated, 1);
  assert.strictEqual(out.report.added, 0);
  assert.deepStrictEqual(out.tidy, [], 'quietly: no tidy row');
  assert.deepStrictEqual(out.choose, [], 'quietly: no question');
  const entry = one(out);
  assert.strictEqual(entry.state, 'reading');
  assert.strictEqual(entry.rating, 'liked');
  assert.strictEqual(entry.library.shelf, 'in_progress', 'B moves to L');
  assert.strictEqual(entry.library.rating10, 8);
});

test('row 3: changed here, not at the library, keeps ours and lists a tidy row', () => {
  const ours = [Object.assign(here(1, 'read', 'ok'), { library: memory('completed', 10) })];
  const out = plan([there(1, 'read', 'loved')], ours);

  assert.strictEqual(out.report.kept, 1);
  assert.strictEqual(out.report.updated, 0);
  assert.strictEqual(out.tidy.length, 1);
  assert.strictEqual(out.tidy[0].why, 'changed-here');
  assert.strictEqual(out.choose.length, 0);
  assert.deepStrictEqual(out.tidy[0].here, { state: 'read', rating: 'ok' });
  assert.deepStrictEqual(out.tidy[0].library, { shelf: 'completed', rating: 'loved' });
  assert.strictEqual(out.tidy[0].title, 'A Book 1');
  assert.strictEqual(out.tidy[0].author, 'A Writer');
  const entry = one(out);
  assert.strictEqual(entry.rating, 'ok', 'ours is kept');
  assert.strictEqual(entry.state, 'read');
  assert.strictEqual(entry.library.shelf, 'completed');
  assert.strictEqual(entry.library.rating10, 10, 'B moves to L even when we keep ours');
});

test('row 4: changed in both, differently, keeps ours and asks once', () => {
  const ours = [Object.assign(here(1, 'reading', 'liked'), { library: memory('for_later', 10) })];
  const first = plan([there(1, 'read', 'loved')], ours);

  assert.strictEqual(first.report.kept, 1);
  assert.strictEqual(first.choose.length, 1);
  assert.strictEqual(first.choose[0].why, 'changed-both');
  assert.deepStrictEqual(first.choose[0].here, { state: 'reading', rating: 'liked' });
  assert.deepStrictEqual(first.choose[0].library, { shelf: 'completed', rating: 'loved' });
  assert.strictEqual(first.tidy.length, 0);
  assert.strictEqual(one(first).state, 'reading', 'ours is kept for now');
  assert.strictEqual(one(first).library.shelf, 'completed', 'B moves to L whatever we decide');

  // The same import again: B now equals L, so it is a "changed here", not a second question.
  const again = plan([there(1, 'read', 'loved')], first.entries);
  assert.strictEqual(again.choose.length, 0, 'a difference is asked once');
  assert.strictEqual(again.tidy.length, 1);
  assert.strictEqual(again.tidy[0].why, 'changed-here');
});

test('row 5: changed in both the same way, nothing to do', () => {
  const ours = [Object.assign(here(1, 'read', 'loved'), { library: memory('for_later', 10) })];
  const out = plan([there(1, 'read', 'loved')], ours);

  assert.deepStrictEqual(out.report, { added: 0, updated: 0, kept: 0, gone: 0, ignored: 0 });
  assert.deepStrictEqual(out.tidy, []);
  assert.deepStrictEqual(out.choose, []);
  assert.strictEqual(one(out).library.shelf, 'completed', 'B still moves to L');
});

test('row 6: gone from a complete library shelf is kept, marked and listed', () => {
  const ours = [Object.assign(here(1, 'read', 'loved'), { library: memory('completed', 10) })];
  const out = plan([], ours);

  assert.strictEqual(out.report.gone, 1);
  assert.strictEqual(out.report.kept, 0, 'gone has its own count');
  assert.strictEqual(out.entries.length, 1, 'the book is not deleted');
  assert.strictEqual(one(out).state, 'read');
  assert.strictEqual(one(out).library.gone, true, 'it is marked');
  assert.strictEqual(one(out).library.shelf, 'completed', 'the last known shelf is kept');
  assert.strictEqual(out.tidy.length, 1);
  assert.strictEqual(out.tidy[0].why, 'gone');
  assert.strictEqual(out.tidy[0].library.shelf, 'completed');
});

test('row 6 edge: an incomplete shelf never says gone, and the import says why', () => {
  const ours = [Object.assign(here(1, 'read', 'loved'), { library: memory('completed', 10) })];
  const out = plan([], ours, { for_later: true, in_progress: true, completed: false });

  assert.strictEqual(out.report.gone, 0);
  assert.deepStrictEqual(out.tidy, [], 'no row for a removal that may not have happened');
  assert.strictEqual(out.entries.length, 1);
  assert.strictEqual(one(out).library.gone, undefined, 'and no mark');
  assert.strictEqual(one(out).library.seen, '2026-10-01T00:00:00Z', 'the memory is left alone');
  assert.strictEqual(out.refusals.length, 1);
  assert.match(out.refusals[0], /Completed/);
  assert.match(out.refusals[0], /not fully saved/);
});

test('row 7: on the app shelf, never at the library, is nothing at all', () => {
  const ours = [here(1, 'want', 'loved')];
  const out = plan([], ours);

  assert.deepStrictEqual(out.report, { added: 0, updated: 0, kept: 0, gone: 0, ignored: 0 });
  assert.deepStrictEqual(out.tidy, []);
  assert.deepStrictEqual(out.choose, []);
  assert.deepStrictEqual(out.entries, plain(ours), 'not even a memory is added');
});

test('row 8: first import with the book already here asks when they disagree', () => {
  const ours = [here(1, 'read', 'loved')]; // from the slice: no library memory yet
  const disagree = plan([there(1, 'read', 'ok')], ours);

  assert.strictEqual(disagree.choose.length, 1);
  assert.strictEqual(disagree.choose[0].why, 'changed-both');
  assert.strictEqual(disagree.report.kept, 1);
  const entry = one(disagree);
  assert.strictEqual(entry.rating, 'loved', 'ours is kept for now');
  assert.strictEqual(entry.library.shelf, 'completed', 'the first memory is written');
  assert.strictEqual(entry.library.seen, NOW);

  const agree = plan([there(1, 'read', 'loved')], [here(1, 'read', 'loved')]);
  assert.deepStrictEqual(agree.report, { added: 0, updated: 0, kept: 0, gone: 0, ignored: 0 });
  assert.strictEqual(agree.choose.length, 0);
  assert.strictEqual(one(agree).library.shelf, 'completed', 'agreement still starts the memory');
});

test('edge: ratings compare in buckets, and rating10 is kept exactly', () => {
  // 9/10 and loved agree: a different number in the same bucket is not a change.
  const inside = plan(
    [there(1, 'read', 'loved', { rating10: 10 })],
    [Object.assign(here(1, 'read', 'loved'), { library: memory('completed', 9) })]
  );
  assert.deepStrictEqual(inside.tidy, [], 'a difference inside a bucket is not a difference');
  assert.strictEqual(inside.report.kept, 0);
  assert.strictEqual(one(inside).library.rating10, 10, 'the exact number moves to 10');

  // 8 is liked and 10 is loved: a different bucket is a real change.
  const across = plan(
    [there(1, 'read', 'loved', { rating10: 10 })],
    [Object.assign(here(1, 'read', 'liked'), { library: memory('completed', 8) })]
  );
  assert.strictEqual(across.report.updated, 1, 'the bucket disagreement is followed');
  assert.strictEqual(one(across).rating, 'loved');
  assert.strictEqual(one(across).library.rating10, 10);

  // A reader that carries only the bucket does not flatten an unchanged half star.
  const half = plan(
    [there(1, 'read', 'loved')],
    [Object.assign(here(1, 'read', 'loved'), { library: memory('completed', 9) })]
  );
  assert.strictEqual(one(half).library.rating10, 9, 'rating10 is kept exactly');
});

test('edge: two editions on the library shelf become one entry, furthest along', () => {
  const ebooks = [
    there(1, 'want', 'ok', { id: 11, title: 'A Book 1 (e-book)' }),
    there(1, 'reading', 'liked', { id: 12, title: 'A Book 1 (paper)' })
  ];
  const out = plan(ebooks, []);

  assert.strictEqual(out.entries.length, 1, 'one entry for one work');
  assert.strictEqual(out.report.added, 1);
  assert.strictEqual(one(out).groupKey, 'g1', 'the same work, not two books');
  assert.strictEqual(one(out).state, 'reading', 'reading is further along than want');
  assert.strictEqual(one(out).rating, 'liked');

  const completed = ebooks.concat([there(1, 'read', 'loved', { id: 13 })]);
  const read = plan(completed, []);
  assert.strictEqual(read.entries.length, 1);
  assert.strictEqual(one(read).state, 'read', 'completed beats both');
  assert.strictEqual(one(read).rating, 'loved');
});

test('edge: stopped here against the library still reading is information, not an error', () => {
  const ours = [Object.assign(here(1, 'stopped', 'not-for-me'), {
    library: memory('in_progress', 8)
  })];
  const out = plan([there(1, 'reading', 'liked')], ours);

  assert.strictEqual(out.tidy.length, 1);
  assert.strictEqual(out.tidy[0].why, 'stopped');
  assert.strictEqual(out.tidy[0].here.state, 'stopped');
  assert.strictEqual(out.tidy[0].library.shelf, 'in_progress');
  assert.strictEqual(one(out).state, 'stopped', 'ours is kept');
});

test('edge: ignore suppresses the row until either side moves again', () => {
  const stamp = { at: '2026-10-20T00:00:00Z', here: { state: 'reading', rating: 'liked' } };
  const ours = [Object.assign(here(1, 'reading', 'liked'), {
    library: Object.assign(memory('for_later', 10), { ignore: stamp })
  })];

  const quiet = plan([there(1, 'want', 'loved')], ours);
  assert.deepStrictEqual(quiet.tidy, [], 'the same difference is not asked again');
  assert.strictEqual(quiet.report.ignored, 1);
  assert.strictEqual(quiet.report.kept, 0);
  assert.deepStrictEqual(one(quiet).library.ignore, stamp, 'the stamp stays');
  assert.strictEqual(one(quiet).library.seen, NOW, 'B is still updated');

  // Here changed: a new rating since the stamp.
  const hereMoved = [Object.assign(here(1, 'reading', 'ok'), {
    library: Object.assign(memory('for_later', 10), { ignore: stamp })
  })];
  const moved = plan([there(1, 'want', 'loved')], hereMoved);
  assert.strictEqual(moved.tidy.length, 1, 'a change here brings the row back');
  assert.strictEqual(moved.report.ignored, 0);
  assert.strictEqual(one(moved).library.ignore, null, 'and clears the stamp');

  // The library changed: L differs from B, so the row comes back even though here is still
  // the state that was left.
  const thereMoved = plan([there(1, 'read', 'loved')], ours);
  assert.strictEqual(thereMoved.choose.length, 1, 'a change at the library brings the row back');
  assert.strictEqual(thereMoved.choose[0].why, 'changed-both');
});

test('edge: the practice shelf refuses a real import in words and changes nothing', () => {
  const ours = [Object.assign(here(1, 'read', 'loved'), { library: memory('completed', 10) })];
  const out = plan([there(1, 'read', 'ok')], ours, ALL_COMPLETE, { practice: true });

  assert.deepStrictEqual(out.entries, plain(ours), 'not one byte changes');
  assert.deepStrictEqual(out.report, { added: 0, updated: 0, kept: 0, gone: 0, ignored: 0 });
  assert.deepStrictEqual(out.tidy, []);
  assert.deepStrictEqual(out.choose, []);
  assert.strictEqual(out.refusals.length, 1);
  assert.match(out.refusals[0], /practice shelf/);
});

// D42: "on hold" is ours. The library has no hold shelf: a held book sits on For Later there.
test('hold: For Later unchanged at the library never undoes a hold, and asks nothing', () => {
  const ours = [Object.assign(here(1, 'hold', null), { library: memory('for_later', 0) })];
  const out = plan([there(1, 'want', null)], ours);
  assert.strictEqual(one(out).state, 'hold', 'still on hold');
  assert.strictEqual(out.tidy.length, 0, 'nothing to tidy');
  assert.strictEqual(out.choose.length, 0, 'nothing to choose');
});

test('hold: a held book the library moved on (picked up, then read) takes the library\'s answer', () => {
  const ours = [Object.assign(here(1, 'hold', null), { library: memory('for_later', 0) })];
  const reading = plan([there(1, 'reading', null)], ours);
  assert.strictEqual(one(reading).state, 'reading', 'in progress at the library: reading here');
  assert.strictEqual(reading.choose.length, 0, 'without asking');
  const read = plan([there(1, 'read', 'liked')], ours);
  assert.strictEqual(one(read).state, 'read');
  assert.strictEqual(one(read).rating, 'liked');
});

test('hold: the first import beside a held book on For Later is not a disagreement', () => {
  const out = plan([there(1, 'want', null)], [here(1, 'hold', null)]);
  assert.strictEqual(one(out).state, 'hold');
  assert.strictEqual(out.choose.length, 0);
});
