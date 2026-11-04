'use strict';
// T2.6: the contract (CONTRACT.md sections 3, 4, 5, 6). One test per "Done when" line in
// BUILD.md, plus the ctx fields, the input defaults and the standard shelves. Objects come
// from a vm realm, so compare them after a JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./_load.js');

const SLICE = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/slice-small.json'), 'utf8'));
const plain = (value) => JSON.parse(JSON.stringify(value));
const nb = load([
  'app/core/base.js', 'app/core/score.js', 'app/core/reason.js', 'app/core/contract.js',
]);

const WHY = 'Shares the wizards with books in the library list.';

// A stand-in for Nextbook.pool.load(): the names contract.js is allowed to read.
function makePool(slice) {
  const byId = Object.create(null);
  const byGroupKey = Object.create(null);
  slice.works.forEach((w) => { byId[w.id] = w; byGroupKey[w.groupKey] = w; });
  const facets = slice.facets;
  return {
    ok: true,
    works: slice.works.slice(),
    byId: byId,
    byGroupKey: byGroupKey,
    facets: facets,
    match: (title, author) => slice.works.find((w) => nb.norm(w.title) === nb.norm(title) &&
      nb.norm(w.author) === nb.norm(author)) || null,
    search: () => [],
    sections: () => nb.sections(slice.works, facets),
    labelOf: (facet) => (facets[facet] ? facets[facet].label : nb.labelFor(facet, facets)),
    tagsOf: () => null,
  };
}
const pool = makePool(SLICE);

// The practice shelf's spread, made from the first six works of this fixture (two loved, two
// liked, one ok, one not-for-me), so four works are still off the shelf: enough that the
// random mode the checks run below takes three of them, and a different seed would change
// which three and in what order. A shelf with fewer than three off it could not tell a seed
// change apart at all.
const RATINGS = ['loved', 'loved', 'liked', 'liked', 'ok', 'not-for-me'];
const PRACTICE = SLICE.works.slice(0, 6).map((w, i) => ({
  key: 'w:' + w.groupKey,
  id: w.id,
  groupKey: w.groupKey,
  title: w.title,
  author: w.author,
  state: 'read',
  rating: RATINGS[i],
  work: null,
}));

const shelfOf = (work, rating) => [{
  key: 'w:' + work.groupKey, id: work.id, groupKey: work.groupKey,
  title: work.title, author: work.author, state: 'read', rating: rating || 'loved', work: work,
}];

// ---- the result check ----------------------------------------------------------------------

test('an unknown id is dropped and named', () => {
  const ctx = nb.makeCtx({ pool, shelf: [], seed: 1 });
  const v = plain(nb.validate({ picks: [{ id: 'w1', why: WHY }, { id: 'not-a-book', why: WHY }] }, ctx, {}));
  assert.deepStrictEqual(v.picks.map((p) => p.id), ['w1']);
  assert.strictEqual(v.dropped.length, 1);
  assert.strictEqual(v.dropped[0].id, 'not-a-book', 'the dropped pick is named');
  assert.strictEqual(v.dropped[0].code, 'unknown');
  assert.match(v.dropped[0].why, /not in the library list/);
  assert.strictEqual(v.error, null);
});

test('a missing why is dropped', () => {
  const ctx = nb.makeCtx({ pool, shelf: [], seed: 1 });
  const v = plain(nb.validate({
    picks: [{ id: 'w1', why: WHY }, { id: 'w2' }, { id: 'w3', why: '   ' }],
  }, ctx, {}));
  assert.deepStrictEqual(v.picks.map((p) => p.id), ['w1']);
  assert.deepStrictEqual(v.dropped.map((d) => d.id), ['w2', 'w3']);
  v.dropped.forEach((d) => assert.strictEqual(d.code, 'noWhy', d.id + ' is dropped for its reason'));
  v.dropped.forEach((d) => assert.match(d.why, /no reason with it/, d.id + ' says the true thing'));
});

test('a reason over 200 characters, and the stock phrase, each say what is wrong', () => {
  const ctx = nb.makeCtx({ pool, shelf: [], seed: 1 });
  const long = 'It shares ' + 'the wizards '.repeat(20) + 'with your shelf.';   // 201+ characters
  const v = plain(nb.validate({
    picks: [
      { id: 'w1', why: long },
      { id: 'w2', why: 'A small match.' },
      { id: 'w3', why: 'It shares the wizards with your shelf.' },
    ],
  }, ctx, {}));
  assert.deepStrictEqual(v.picks.map((p) => p.id), ['w3'], 'the good reason is the only pick');

  const byId = {};
  v.dropped.forEach((d) => { byId[d.id] = d; });
  assert.strictEqual(byId.w1.code, 'whyLong');
  assert.match(byId.w1.why, /too long\. Keep it under 200 characters\./);
  assert.strictEqual(byId.w2.code, 'whyStock');
  assert.match(byId.w2.why, /not a reason\. Say what the book shares with your shelf\./);
  assert.ok(byId.w1.why.indexOf('no reason with it') === -1, 'a long reason is not called missing');
  assert.ok(byId.w2.why.indexOf('no reason with it') === -1, 'the stock phrase is not called missing');
});

test('a seventh pick is dropped', () => {
  const ctx = nb.makeCtx({ pool, shelf: [], seed: 1 });
  const ids = SLICE.works.slice(0, 7).map((w) => w.id);
  const v = plain(nb.validate({ picks: ids.map((id) => ({ id: id, why: WHY })) }, ctx, {}));
  assert.strictEqual(v.picks.length, 6, 'six books at most');
  assert.strictEqual(v.dropped.length, 1);
  assert.strictEqual(v.dropped[0].id, ids[6]);
  assert.strictEqual(v.dropped[0].code, 'seventh');
});

test('a shelf book is dropped unless the mode allows the shelf', () => {
  const w1 = SLICE.works[0];
  const ctx = nb.makeCtx({ pool, shelf: shelfOf(w1, 'loved'), seed: 1 });
  const result = { picks: [{ id: w1.id, why: WHY }] };

  const strict = plain(nb.validate(result, ctx, { shape: 'list' }));
  assert.deepStrictEqual(strict.picks, []);
  assert.strictEqual(strict.dropped[0].id, w1.id);
  assert.strictEqual(strict.dropped[0].code, 'shelf');

  const allowed = plain(nb.validate(result, ctx, { shape: 'list', allowShelf: true }));
  assert.deepStrictEqual(allowed.picks.map((p) => p.id), [w1.id]);
  assert.deepStrictEqual(allowed.dropped, []);
});

test('an empty result with no note is an error, and a note makes it an answer', () => {
  const ctx = nb.makeCtx({ pool, shelf: [], seed: 1 });
  const empty = plain(nb.validate({ picks: [] }, ctx, {}));
  assert.strictEqual(empty.error, 'This way of choosing books found nothing and did not say why.');

  const noted = plain(nb.validate({ picks: [], note: 'Nothing here fits yet.' }, ctx, {}));
  assert.strictEqual(noted.error, null);

  // Every pick dropped is an empty result too.
  const allDropped = plain(nb.validate({ picks: [{ id: 'no-such-book', why: WHY }] }, ctx, {}));
  assert.deepStrictEqual(allDropped.picks, []);
  assert.strictEqual(allDropped.error, 'This way of choosing books found nothing and did not say why.');
});

test('a path with no steps gets "Step 1", "Step 2", ...', () => {
  const ctx = nb.makeCtx({ pool, shelf: [], seed: 1 });
  const v = plain(nb.validate({
    picks: [
      { id: 'w1', why: WHY },
      { id: 'w2', why: WHY, step: 'Week 2' },
      { id: 'w3', why: WHY },
    ],
  }, ctx, { shape: 'path' }));
  assert.deepStrictEqual(v.picks.map((p) => p.step), ['Step 1', 'Week 2', 'Step 3']);
  // A list does not invent steps.
  const list = plain(nb.validate({ picks: [{ id: 'w1', why: WHY }] }, ctx, { shape: 'list' }));
  assert.strictEqual(list.picks[0].step, undefined);
});

// ---- the scan --------------------------------------------------------------------------

const CODE = {
  'fetch(': 'fetch("/x")',
  'document.': 'document.title',
  'window.': 'window.name',
  'localStorage': 'localStorage',
  'Math.random(': 'Math.random()',
  'new Date': 'new Date()',
  'Date.now(': 'Date.now()',
  'setTimeout(': 'setTimeout(f, 1)',
  'setInterval(': 'setInterval(f, 1)',
  'innerHTML': 'x.innerHTML',
  'outerHTML': 'x.outerHTML',
  'insertAdjacentHTML': 'x.insertAdjacentHTML("afterend", "y")',
  'eval(': 'eval("1")',
  'new Function': 'new Function("return 1")',
  'XMLHttpRequest': 'new XMLHttpRequest()',
  'import(': 'import("x")',
};

test('the scan catches each banned token in code', () => {
  assert.deepStrictEqual(plain(nb.banned).slice().sort(), Object.keys(CODE).sort(), 'the list is the contract list');
  Object.keys(CODE).forEach((word) => {
    const src = 'function f() {\n  var x;\n  ' + CODE[word] + ';\n}';
    const found = plain(nb.contract.scan(src));
    assert.ok(found.some((f) => f.word === word), word + ' should be caught in: ' + CODE[word]);
    const hit = found.filter((f) => f.word === word)[0];
    assert.strictEqual(hit.line, 3, word + ' is reported on its line');
    assert.ok(hit.advice && hit.advice.length > 10, word + ' says what to do instead');
    assert.match(hit.message, /on line 3/);
    assert.ok(hit.message.indexOf(word) !== -1, 'the message names the word');
  });
});

test('the scan ignores a quoted sentence and a comment, and names the function and line', () => {
  const quoted = 'function choose(ctx) {\n' +
    "  var s = 'The library could not fetch this.';\n" +
    '  var t = "window.open is not our business";\n' +
    '  return s + t;\n' +
    '}';
  assert.deepStrictEqual(plain(nb.contract.scan(quoted)), []);

  // A real token in a real function: the failure names the word, the line and the function.
  function plainChoose() {
    var s = 'The library could not fetch this.'; // fetch( is only in this comment
    return s + localStorage;
  }
  const found = nb.contract.scanFeature({ choose: plainChoose });
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].word, 'localStorage');
  assert.strictEqual(found[0].where, 'choose');
  assert.strictEqual(found[0].line, 3, 'the string and the comment on line 2 do not move it');
  assert.match(found[0].message, /inside choose, 3 lines in/);
  assert.match(found[0].message, /A mode saves nothing/);
});

test('a function finding says how far in it is, never a file line', () => {
  function shortChoose() { return localStorage; }
  const found = plain(nb.contract.scanFeature({ choose: shortChoose }));
  assert.strictEqual(found.length, 1);
  assert.match(found[0].message, /is inside choose, 1 lines in\./);
  assert.ok(!/on line/.test(found[0].message), 'a line inside a function is not a file line: ' + found[0].message);
  // A whole file still gives its own file line.
  const file = plain(nb.contract.scan('var a;\n' + 'localStorage;'));
  assert.match(file[0].message, /on line 2\./);
});

// ---- ctx -----------------------------------------------------------------------------------

test('makeCtx has every field of CONTRACT.md section 4', () => {
  const w1 = SLICE.works[0];
  const ctx = nb.makeCtx({
    pool,
    shelf: shelfOf(w1, 'loved'),
    others: [{ name: 'A friend', entries: [{ title: 'A typed book', author: 'Someone', rating: 'loved' }] }],
    events: { fetched: '2026-11-01', events: [{ id: 'e1', title: 'An event' }] },
    seed: 3,
    def: { strings: { hello: 'Hello {name}.' } },
  });
  ['works', 'work', 'shelf', 'onShelf', 'profile', 'score', 'similar', 'reason', 'facetsOf',
    'labelOf', 'facets', 'tagsOf', 'sections', 'others', 'events', 'eventsFetched', 'random', 't']
    .forEach((k) => assert.ok(typeof ctx[k] !== 'undefined', 'ctx.' + k + ' exists'));

  const plainCtx = plain({ shelf: ctx.shelf, others: ctx.others, events: ctx.events, fetched: ctx.eventsFetched });
  assert.strictEqual(plainCtx.shelf[0].work.id, w1.id, 'a shelf entry gets its work');
  assert.strictEqual(plainCtx.others[0].entries[0].work, null, 'a typed book has no work');
  assert.deepStrictEqual(plainCtx.events.map((e) => e.id), ['e1']);
  assert.strictEqual(plainCtx.fetched, '2026-11-01');

  assert.strictEqual(ctx.work(w1.id).id, w1.id);
  assert.strictEqual(ctx.work('no-such-book'), null);
  assert.strictEqual(ctx.onShelf(w1.id), true);
  assert.strictEqual(ctx.onShelf('w2'), false);
  assert.deepStrictEqual(nb.workFacets(ctx.work('w2')).length > 0, true);
  assert.deepStrictEqual(plain(ctx.facetsOf(ctx.work('w1'), 'topic')), ['topic:wizards']);
  assert.strictEqual(ctx.labelOf('topic:wizards'), 'wizards');
  assert.ok(Array.isArray(ctx.sections()) && ctx.sections().length > 0);
  assert.strictEqual(ctx.t('hello', { name: 'there' }), 'Hello there.', 'the mode strings come first');
  assert.strictEqual(ctx.t('appName'), 'nextbook', 'then the app strings');
  assert.ok(ctx.profile().rated > 0);
  assert.ok(ctx.score(ctx.work('w2'), ctx.profile()).score > 0);
  assert.ok(ctx.similar(ctx.work('w1'), ctx.work('w2')).score > 0);
  assert.ok(typeof ctx.tagsOf(ctx.work('w1')) === 'object');
});

test('the same seed gives the same sequence', () => {
  const a = nb.makeCtx({ pool, shelf: [], seed: 42 });
  const b = nb.makeCtx({ pool, shelf: [], seed: 42 });
  const c = nb.makeCtx({ pool, shelf: [], seed: 43 });
  const take = (ctx) => { const out = []; for (let i = 0; i < 20; i++) out.push(ctx.random()); return out; };
  const seqA = take(a);
  const seqB = take(b);
  const seqC = take(c);
  assert.deepStrictEqual(seqA, seqB, 'the same seed gives the same numbers');
  assert.notDeepStrictEqual(seqA, seqC, 'a different seed gives different numbers');
  seqA.forEach((n) => assert.ok(n >= 0 && n < 1, 'a number from 0 to 1: ' + n));
});

test('the seven standard shelves run with defaults, and 5 and 6 give the same answer twice', () => {
  let lastInput = null;
  const mode = {
    id: 'shelf-tester',
    name: 'Shelf tester',
    purpose: 'For the tests.',
    shape: 'list',
    inputs: [
      { id: 'from', kind: 'shelf-book', label: 'A book' },
      { id: 'book', kind: 'book', label: 'A book from the list' },
      { id: 'facet', kind: 'facet', label: 'A subject' },
      { id: 'facets', kind: 'facets', label: 'Some subjects' },
      { id: 'text', kind: 'text', label: 'Some words' },
      { id: 'number', kind: 'number', min: 1, max: 9, 'default': 3, label: 'How many' },
      { id: 'choice', kind: 'choice', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'default': 'b', label: 'Which' },
    ],
    strings: { none: 'Every book is on your shelf already.' },
    logic: {},
    choose(ctx, input) {
      lastInput = input;
      const off = ctx.works.filter((w) => !ctx.onShelf(w.id));
      const keyed = off.map((w) => ({ work: w, k: ctx.random() }));
      keyed.sort((x, y) => (x.k - y.k) || (x.work.id < y.work.id ? -1 : 1));
      const n = Math.max(1, Math.min(6, Number(input.number) || 3));
      const picks = keyed.slice(0, n).map((x) => ({
        id: x.work.id,
        why: 'Shares the ' + ctx.labelOf(ctx.facetsOf(x.work)[0]) + ' with the library list.',
      }));
      return picks.length ? { picks: picks } : { picks: [], note: ctx.t('none') };
    },
  };
  nb.mode(mode);
  nb.check('shelf-tester', (t) => { t.ok(mode.strings.none, 'has the sentence for an empty list'); });

  const run = nb.runModeChecks('shelf-tester', { pool, practice: PRACTICE });
  const failures = plain(run.results).filter((r) => !r.ok).map((r) => r.msg);
  assert.deepStrictEqual(failures, [], 'every check passes');
  assert.strictEqual(run.ok, true);
  assert.strictEqual(run.shelves.length, 7, 'seven standard shelves');
  assert.deepStrictEqual(plain(run.shelves).map((s) => s.name), [
    'an empty shelf', 'one book, rated loved', 'every book rated not for me', 'only books typed in',
    'the practice shelf', 'the practice shelf again', "the practice shelf with a friend's shelf",
  ]);
  plain(run.shelves).forEach((s) => assert.ok(s.ok, s.name + ': ' + s.message));

  const five = plain(run.shelves[4].answer);
  const six = plain(run.shelves[5].answer);
  assert.deepStrictEqual(five, six, 'the same shelf and seed give the same answer');
  assert.ok(five.picks.length > 0, 'the practice shelf gives books');

  // Shelves 5 and 6 carry the same seed, and the test asserts the seed itself: two answers
  // that happen to match are not the behaviour the contract promises. An implementation that
  // gave shelf 6 a different seed fails here even if its answers came out the same.
  const standard = nb.standardShelves(pool, PRACTICE);
  assert.strictEqual(standard[4].seed, standard[5].seed, 'shelves 5 and 6 carry the same seed');
  assert.strictEqual(standard[5].seed, standard[4].seed);

  // And the practice shelf is big enough for the seed to matter: at least three works are off
  // it, and this mode takes three at random, so a different seed would change its answer.
  const probe = nb.makeCtx({ pool, shelf: standard[4].shelf, seed: standard[4].seed });
  const offShelf = probe.works.filter((w) => !probe.onShelf(w.id));
  assert.ok(offShelf.length >= 3, 'three or more works are off the practice shelf: ' + offShelf.length);
  const otherSeedCtx = nb.makeCtx({ pool, shelf: standard[4].shelf, seed: standard[4].seed + 1 });
  const otherSeed = plain(mode.choose(otherSeedCtx, nb.defaultInput(mode, otherSeedCtx)));
  assert.notDeepStrictEqual(otherSeed.picks.map((p) => p.id), five.picks.map((p) => p.id),
    'a different seed really would change this answer');

  // Every input kind got a sensible default.
  const seen = plain(lastInput);
  assert.deepStrictEqual(Object.keys(seen).sort(), ['book', 'choice', 'facet', 'facets', 'from', 'number', 'text']);
  assert.ok(seen.from && seen.from.work && seen.from.rating === 'loved', 'the first loved book');
  assert.ok(seen.book && seen.book.id && seen.book.facets, 'a work from the list');
  assert.strictEqual(seen.facet, 'bisac:science-fiction', 'the most common subject');
  assert.deepStrictEqual(seen.facets, ['bisac:science-fiction']);
  assert.strictEqual(typeof seen.text, 'string');
  assert.strictEqual(seen.number, 3, "the number's default");
  assert.strictEqual(seen.choice, 'b', "the choice's default");

  // Registering a mode never edits the manifest.
  assert.deepStrictEqual(plain(nb.modes), []);
});

test('runModeChecks names a banned word in the mode, and a mode that is not loaded', () => {
  function badChoose() {
    return 'x'.innerHTML;
  }
  nb.mode({ id: 'bad-mode', name: 'Bad', purpose: 'For the tests.', shape: 'list', inputs: [], strings: {}, logic: {}, choose: badChoose });
  nb.check('bad-mode', (t) => { t.ok(true, 'runs'); });
  const run = nb.runModeChecks('bad-mode', { pool, practice: PRACTICE });
  assert.strictEqual(run.ok, false);
  assert.strictEqual(run.fail > 0, true);
  const msgs = plain(run.results).filter((r) => !r.ok).map((r) => r.msg);
  assert.ok(msgs.some((m) => m.indexOf('innerHTML') !== -1 && /inside choose/.test(m)), msgs.join(' | '));

  const missing = plain(nb.runModeChecks('no-such-mode', { pool, practice: PRACTICE }));
  assert.strictEqual(missing.ok, false);
  assert.match(missing.results[0].msg, /did not load/);
});

// ---- the ctx's own copies, the practice shelf, and the same shelf twice --------------------

test('two contexts from one pool never share a work', () => {
  const w1 = SLICE.works[0];
  const before = JSON.stringify(plain(pool.works));
  const ctx1 = nb.makeCtx({ pool, shelf: shelfOf(w1, 'loved'), seed: 1 });
  const ctx2 = nb.makeCtx({ pool, shelf: shelfOf(w1, 'loved'), seed: 1 });

  assert.notStrictEqual(ctx1.works[0], pool.works[0], 'ctx.works is its own copy');
  assert.strictEqual(ctx1.work(w1.id), ctx1.works[0], 'work(id) returns the ctx copy');
  assert.notStrictEqual(ctx1.shelf[0].work, pool.byId[w1.id], 'a shelf entry holds the ctx copy');

  const keptFacets = ctx2.works[0].facets.slice();
  const keptTitle = ctx2.works[0].title;
  ctx1.works[0].facets.push('topic:made-up');
  ctx1.works[0].title = 'Changed after the copy';
  ctx1.shelf[0].work.facets.push('topic:changed-on-the-shelf');
  ctx1.facets['topic:made-up'] = { label: 'made up', kind: 'topic', works: 99 };

  assert.deepStrictEqual(ctx2.works[0].facets, keptFacets, 'the second ctx is unchanged');
  assert.strictEqual(ctx2.works[0].title, keptTitle, 'and keeps its own title');
  assert.strictEqual(JSON.stringify(plain(pool.works)), before, 'the pool is unchanged');

  // Sections and facetsOf read the copies too.
  const sectionWorks = ctx1.sections().reduce((all, s) => all.concat(s.works), []);
  assert.ok(sectionWorks.length > 0);
  sectionWorks.forEach((w) => assert.ok(ctx1.works.indexOf(w) !== -1, 'a section holds the ctx copy'));
  assert.ok(ctx1.facetsOf(ctx1.work(w1.id)).length > 0, 'facetsOf reads the copy');
});

test('standardShelves gives every practice entry its work, so profile() rates the shelf', () => {
  const shelves = plain(nb.standardShelves(pool, PRACTICE));
  assert.ok(shelves[4].shelf.length > 0);
  shelves[4].shelf.forEach((e) => assert.ok(e.work && e.work.id, 'the entry has its work: ' + e.title));
  shelves[6].shelf.forEach((e) => assert.ok(e.work && e.work.id, "the friend's shelf too"));
  assert.ok(nb.profile(shelves[4].shelf).rated > 0, 'a rated practice shelf counts as rated');

  // With no id and no groupKey, the title and author still find the work.
  const w6 = SLICE.works[5];
  const typed = [{ title: w6.title, author: w6.author, state: 'read', rating: 'loved', work: null }];
  const found = plain(nb.standardShelves(pool, typed));
  assert.strictEqual(found[4].shelf[0].work.id, w6.id, 'pool.match(title, author) finds it');
  assert.ok(nb.profile(found[4].shelf).rated > 0);
});

test('runModeChecks says a practice shelf is missing instead of going green', () => {
  nb.mode({
    id: 'practice-probe', name: 'Practice probe', purpose: 'For the tests.', shape: 'list',
    allowShelf: true, inputs: [], strings: {}, logic: {},
    choose(ctx) {
      const w = ctx.works[0];
      return w ? { picks: [{ id: w.id, why: WHY }] } : { picks: [], note: 'Nothing to show.' };
    },
  });
  nb.check('practice-probe', (t) => { t.ok(true, 'runs'); });
  const run = plain(nb.runModeChecks('practice-probe', { pool, practice: [] }));
  assert.strictEqual(run.ok, false);
  assert.strictEqual(run.shelves.length, 4, 'the three practice shelves did not pretend to run');
  const msgs = run.results.filter((r) => !r.ok).map((r) => r.msg);
  assert.deepStrictEqual(msgs,
    ['There is no practice shelf, so this mode was not checked against a real shelf.']);
});

test('runModeChecks names the failure when the same shelf answers twice differently', () => {
  let calls = 0;
  nb.mode({
    id: 'unstable-mode', name: 'Unstable', purpose: 'For the tests.', shape: 'list',
    allowShelf: true, inputs: [], strings: {}, logic: {},
    choose(ctx) {
      calls += 1;
      const w = ctx.works[calls % ctx.works.length];
      return { picks: [{ id: w.id, why: WHY }] };
    },
  });
  nb.check('unstable-mode', (t) => { t.ok(true, 'runs'); });
  const run = plain(nb.runModeChecks('unstable-mode', { pool, practice: PRACTICE }));
  const want = 'The same shelf gave two different answers. A mode must give the same six twice.';
  const msgs = run.results.filter((r) => !r.ok).map((r) => r.msg);
  assert.ok(msgs.indexOf(want) !== -1, msgs.join(' | '));
  assert.strictEqual(run.ok, false);
});

// ---- T2.9: the events a mode may read ------------------------------------------------------

test('a mode sees the events in the snapshot and its date, and an empty list when there is none', () => {
  const snapshot = {
    fetched: '2026-11-03T19:49:50-05:00',
    branch: 'CL',
    window: { start: '2026-11-03', end: '2026-11-24' },
    source: 'https://gateway.bibliocommons.com/v2/libraries/tpl/rss/events',
    events: [
      { id: 'e1', title: 'Serger Sewing', start: '2026-11-03T18:00:00', end: '2026-11-03T19:30:00',
        branch: 'CL', virtual: false, categories: ['Crafts'], summary: 'Learn a serger.', url: 'https://example.test/e1' },
      { id: 'e2', title: 'Book Club', start: '2026-11-05T14:00:00', end: '2026-11-05T15:00:00',
        branch: 'CL', virtual: true, categories: [], summary: 'Talk about a book.', url: 'https://example.test/e2' }
    ]
  };

  const ctx = nb.makeCtx({ pool: pool, shelf: [], events: snapshot, seed: 1 });
  assert.deepStrictEqual(plain(ctx.events).map((e) => e.id), ['e1', 'e2']);
  assert.strictEqual(ctx.events[1].title, 'Book Club');
  assert.strictEqual(ctx.eventsFetched, '2026-11-03T19:49:50-05:00');

  // A mode reaches them through ctx and nothing else.
  nb.mode({
    id: 'event-probe',
    name: 'Event probe',
    purpose: 'Reads the events.',
    shape: 'list',
    inputs: [],
    strings: { none: 'No event was in the list.' },
    logic: {},
    choose(c) {
      return c.events.length ? { picks: [{ id: 'w1', why: 'An event was in the list: ' + c.events[0].title + '.' }] }
        : { picks: [], note: c.t('none') };
    }
  });
  const v = plain(nb.validate(nb.modeDefs['event-probe'].choose(ctx), ctx, nb.modeDefs['event-probe']));
  assert.strictEqual(v.picks.length, 1);
  assert.match(v.picks[0].why, /Serger Sewing/);

  const bare = nb.makeCtx({ pool: pool, shelf: [], seed: 1 });
  assert.deepStrictEqual(plain(bare.events), [], 'a copy with no snapshot gives an empty list');
  assert.ok(!bare.eventsFetched, 'and no date');
});

// D35: CONTRACT.md section 4's `event` kind, and the default the standard shelves need.
test('an event input defaults to the first snapshot event, or the two-event fixture', () => {
  const EVENT = {
    id: 'ev-1', title: 'Introduction to Serger Sewing', start: '2026-11-03T18:00:00',
    end: '2026-11-03T20:00:00', branch: 'North York Central Library', virtual: false,
    categories: ['Crafts'], summary: 'Learn the basics.', url: 'https://example.test/events/ev-1',
  };
  const mode = {
    id: 'event-default',
    name: 'Event default',
    purpose: 'For the tests.',
    shape: 'list',
    inputs: [{ id: 'event', kind: 'event', label: 'Which event' }],
    strings: {},
    logic: {},
    choose(ctx, input) {
      const w = ctx.works.find((x) => !ctx.onShelf(x.id));
      if (!w) return { picks: [], note: 'Nothing in the list fits yet.' };
      const e = input && input.event;
      return { picks: [{ id: w.id, why: 'It was picked for "' + (e && e.title) + '" at the library.' }] };
    },
  };
  nb.mode(mode);

  // The snapshot's first event is handed over whole.
  const withSnapshot = nb.makeCtx({ pool: pool, events: [EVENT], seed: 1 });
  const fromSnapshot = plain(nb.defaultInput(mode, withSnapshot));
  assert.deepStrictEqual(fromSnapshot.event, EVENT, 'the event object itself');

  // No snapshot: a two-event fixture stands in, in the shape the contract promises.
  const bare = nb.makeCtx({ pool: pool, seed: 1 });
  const fallback = plain(nb.defaultInput(mode, bare));
  assert.ok(fallback.event && fallback.event.id && fallback.event.title, 'a usable event');
  ['id', 'title', 'start', 'end', 'branch', 'virtual', 'categories', 'summary', 'url']
    .forEach((k) => assert.ok(Object.prototype.hasOwnProperty.call(fallback.event, k), 'has ' + k));
  assert.ok(Array.isArray(fallback.event.categories), 'categories is a list');
  assert.ok(fallback.event.start < '2030-01-01', 'a real-looking start');

  // And a mode that needs one runs the seven standard shelves without a special case.
  nb.check('event-default', (t) => { t.ok(mode.strings, 'has a strings table'); });
  const run = nb.runModeChecks('event-default', { pool, practice: PRACTICE });
  assert.deepStrictEqual(plain(run.results).filter((r) => !r.ok).map((r) => r.msg), []);
  assert.strictEqual(run.ok, true);
  assert.strictEqual(run.shelves.length, 7);
});
