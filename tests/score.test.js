'use strict';
// T2.3: the scoring core. Objects come from a vm realm, so compare them after a JSON
// round trip (AGENTS.md), and compare scores with a tolerance, because they are sums
// of fractions. The ten works are tests/fixtures/slice-small.json, made up for this.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./_load.js');

const SLICE = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/slice-small.json'), 'utf8'));
const plain = (value) => JSON.parse(JSON.stringify(value));
const nb = load(['app/core/base.js', 'app/core/score.js']);
const byId = (id) => SLICE.works.filter((w) => w.id === id)[0];

const entry = (work, state, rating) => ({
  key: work ? 'w:' + work.groupKey : 't:a-typed-book|someone',
  title: work ? work.title : 'A typed book',
  author: work ? work.author : 'Someone',
  state: state,
  rating: rating === undefined ? null : rating,
  work: work || null,
});

const near = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-9,
    message + ' (got ' + actual + ', wanted ' + expected + ')');
};

test('the weights table: loved 3, liked 2, ok 1, reading 0.5, stopped -1, not-for-me -2, want 0', () => {
  assert.strictEqual(nb.weightOf(entry(null, 'read', 'loved')), 3);
  assert.strictEqual(nb.weightOf(entry(null, 'read', 'liked')), 2);
  assert.strictEqual(nb.weightOf(entry(null, 'read', 'ok')), 1);
  assert.strictEqual(nb.weightOf(entry(null, 'read', null)), 1, 'read with no rating weighs 1');
  assert.strictEqual(nb.weightOf(entry(null, 'reading', null)), 0.5);
  assert.strictEqual(nb.weightOf(entry(null, 'stopped', null)), -1);
  assert.strictEqual(nb.weightOf(entry(null, 'read', 'not-for-me')), -2);
  assert.strictEqual(nb.weightOf(entry(null, 'stopped', 'not-for-me')), -2, 'not-for-me is negative in any state');
  assert.strictEqual(nb.weightOf(entry(null, 'want', null)), 0, 'want is a wish, not evidence');
  assert.strictEqual(nb.weightOf(entry(null, 'want', 'loved')), 0, 'want is still a wish');
  assert.strictEqual(nb.weightOf(null), 0);
});

test('a loved book adds 3 to each of its facets, to its author, and keeps the entry as evidence', () => {
  const w1 = byId('w1');
  const p = plain(nb.profile([entry(w1, 'read', 'loved')]));

  assert.strictEqual(p.rated, 1);
  assert.deepStrictEqual(Object.keys(p.weights).sort(),
    ['genre:fantasy', 'mood:quiet', 'section:fantasy', 'series:earthsea', 'topic:wizards']);
  Object.keys(p.weights).forEach((facet) => assert.strictEqual(p.weights[facet], 3, facet + ' weighs 3'));
  assert.deepStrictEqual(p.authors, { 'le guin, u k': 3 });

  assert.strictEqual(p.evidence['topic:wizards'].length, 1);
  assert.strictEqual(p.evidence['topic:wizards'][0].title, 'A Wizard of Earthsea');
  assert.strictEqual(p.evidence['topic:wizards'][0].state, 'read');
  assert.strictEqual(p.evidence['topic:wizards'][0].rating, 'loved');
});

test('a "not for me" book is negative evidence, and the parts say why the score is low', () => {
  const p = nb.profile([entry(byId('w1'), 'read', 'not-for-me')]);
  assert.strictEqual(plain(p).weights['topic:wizards'], -2);

  const s = plain(nb.score(byId('w2'), p));
  assert.ok(s.score < 0, 'a work sharing only "not for me" facets scores below zero (got ' + s.score + ')');
  assert.ok(s.parts.length > 0, 'the negative parts are kept');
  s.parts.forEach((part) => assert.ok(part.weight < 0, part.facet + ' is a negative part'));
  assert.strictEqual(s.parts.filter((part) => part.facet === 'author:le guin, u k')[0].weight, -4,
    'the author part is 2 x -2');
});

test('a "want" book adds nothing to the profile', () => {
  const p = plain(nb.profile([entry(byId('w4'), 'want', null)]));
  assert.deepStrictEqual(p, { weights: {}, authors: {}, evidence: {}, rated: 0 });
});

test('a book typed in with no match in the list adds nothing', () => {
  const p = plain(nb.profile([entry(null, 'read', 'loved')]));
  assert.deepStrictEqual(p, { weights: {}, authors: {}, evidence: {}, rated: 0 });
});

test('rated counts evidence: a shelf of "not for me" books is still rated', () => {
  const p = plain(nb.profile([
    entry(byId('w1'), 'read', 'not-for-me'),
    entry(byId('w2'), 'want', null),
    entry(null, 'read', 'loved'),
  ]));
  assert.strictEqual(p.rated, 1);
});

test('more facets do not win on count alone: the square root is what keeps a weak work down', () => {
  // One shared subject, loved (weight 3).
  const strong = {
    id: 'a1', title: 'One true thing', author: 'Ann Author', authorKey: 'author, a',
    facets: ['topic:wizards'],
  };
  // Eight shared facets, every one of them only half-evidence ("reading", weight 0.5).
  const weak = {
    id: 'b1', title: 'Many weak things', author: 'Bo Writer', authorKey: 'writer, b',
    facets: ['topic:botany', 'topic:indigenous-knowledge', 'section:500', 'genre:nature',
      'topic:trees', 'genre:literary', 'mood:hopeful', 'pace:slow'],
  };
  const p = nb.profile([
    entry(byId('w1'), 'read', 'loved'),     // 3 on topic:wizards
    entry(byId('w6'), 'reading', null),     // 0.5 on botany, indigenous knowledge, section:500, nature
    entry(byId('w7'), 'reading', null),     // 0.5 on trees, literary, hopeful
    entry(byId('w10'), 'reading', null),    // 0.5 on quiet, slow, literary
  ]);

  const a = plain(nb.score(strong, p));
  const b = plain(nb.score(weak, p));

  near(a.score, 3, 'one strong shared facet scores 3');
  near(b.score, 4 / Math.sqrt(8),
    'eight shared facets (two of them halves of a section and a pace) are divided by sqrt(8)');
  assert.ok(a.score > b.score,
    'the thinly catalogued work wins (' + a.score + ' > ' + b.score + '), though the other shares eight times as many facets');

  // Prove the division is doing the work: undivided, the many-facet work is ahead.
  const raw = (scored, work) => scored.parts
    .filter((part) => part.facet.indexOf('author:') !== 0)
    .reduce((sum, part) => sum + part.weight, 0) * Math.sqrt(work.facets.length);
  near(raw(a, strong), 3, 'the raw sum for the strong work');
  near(raw(b, weak), 4, 'the raw sum for the weak work');
  assert.ok(raw(b, weak) > raw(a, strong),
    'without the square root the many-facet work would win (' + raw(b, weak) + ' > ' + raw(a, strong) + ')');
});

test('ties keep id order, so the same shelf gives the same six', () => {
  const twin = (id) => ({ id: id, title: 'Twin ' + id, author: 'Twin Author', authorKey: 'twin, a', facets: ['topic:wizards'] });
  const p = nb.profile([entry(byId('w1'), 'read', 'loved')]);
  const ranked = plain(nb.rank([twin('w9'), twin('w2'), twin('w5')], p));
  assert.deepStrictEqual(ranked.map((row) => row.id), ['w2', 'w5', 'w9']);
  assert.strictEqual(ranked[0].score, ranked[1].score, 'the three really do tie');
  assert.ok(ranked[0].parts.length > 0, 'a ranked row carries its parts');
});

test('similar is symmetric and lists the shared facets', () => {
  const a = byId('w1');
  const b = byId('w2');
  const ab = plain(nb.similar(a, b));
  const ba = plain(nb.similar(b, a));
  assert.deepStrictEqual(ab, ba, 'a then b is the same as b then a');
  assert.deepStrictEqual(ab.shared, ['series:earthsea', 'genre:fantasy', 'section:fantasy']);
  near(ab.score, (1.5 + 1 + 0.5) / Math.sqrt(5 * 4),
    'the shared weight over the geometric mean of the two facet counts');
  assert.deepStrictEqual(plain(nb.similar(a, byId('w6'))), { score: 0, shared: [] });
});

test('a work with no facets still adds its weight to its author, and counts as rated', () => {
  // ARCHITECTURE: every entry adds its weight to every facet AND to its author. A work the
  // catalogue has not labelled yet has no facets, but it is still evidence for its author.
  const noFacets = { id: 'n1', title: 'Bare', author: 'N N', authorKey: 'n, n', facets: [] };
  const p = plain(nb.profile([{ key: 'x', title: 'x', state: 'read', rating: 'loved', work: noFacets }]));
  assert.deepStrictEqual(p, { weights: {}, authors: { 'n, n': 3 }, evidence: {}, rated: 1 });

  // Same when the work has no facets property at all, and a negative weight is kept.
  const bare = { id: 'n2', author: 'N N', authorKey: 'n, n' };
  const q = plain(nb.profile([{ key: 'y', state: 'read', rating: 'not-for-me', work: bare }]));
  assert.deepStrictEqual(q, { weights: {}, authors: { 'n, n': -2 }, evidence: {}, rated: 1 });

  // A "want" with no facets is still a wish: nothing at all.
  const w = plain(nb.profile([{ key: 'z', state: 'want', rating: null, work: noFacets }]));
  assert.deepStrictEqual(w, { weights: {}, authors: {}, evidence: {}, rated: 0 });
});

test('sections groups works by their section facet, in facet and then id order', () => {
  const out = plain(nb.sections(SLICE.works));
  assert.deepStrictEqual(out.map((s) => s.facet),
    ['section:500', 'section:fantasy', 'section:literary', 'section:science-fiction']);
  const fantasy = out.filter((s) => s.facet === 'section:fantasy')[0];
  assert.deepStrictEqual(fantasy.works.map((w) => w.id), ['w1', 'w2', 'w8']);
  assert.strictEqual(fantasy.label, 'the fantasy shelves', 'the fallback words, with no label table');
  out.forEach((s) => assert.ok(s.works.length > 0, s.facet + ' has works'));

  // With the slice's own facet dictionary, the slice's words win.
  const labelled = plain(nb.sections(SLICE.works, SLICE.facets));
  assert.strictEqual(labelled.filter((s) => s.facet === 'section:fantasy')[0].label, 'fantasy and myth');
});

test('the score is the sum of its parts, negative parts kept, and the author part is 2 x its weight', () => {
  const p = nb.profile([
    entry(byId('w1'), 'read', 'loved'),        // author +3
    entry(byId('w5'), 'read', 'not-for-me'),   // author -2, so the author weight is 1
  ]);
  const s = plain(nb.score(byId('w5'), p));

  const author = s.parts.filter((part) => part.facet === 'author:le guin, u k')[0];
  assert.ok(author, 'the author has its own part');
  assert.strictEqual(author.weight, 2 * 1, 'author weight 3 - 2 = 1, doubled');
  assert.strictEqual(author.label, 'Ursula K. Le Guin');

  near(s.score, s.parts.reduce((sum, part) => sum + part.weight, 0), 'score is the sum of the parts');
  assert.ok(s.parts.some((part) => part.weight < 0), 'a negative part is kept');
  assert.strictEqual(s.parts.filter((part) => part.facet === 'mood:quiet')[0].weight, 1 / Math.sqrt(5),
    'quiet is 3 - 2 = 1, over sqrt(5) facets');
});

test('one kind weight table, in one place', () => {
  assert.strictEqual(nb.kindWeight('topic:wizards'), 1);
  assert.strictEqual(nb.kindWeight('genre:fantasy'), 1);
  assert.strictEqual(nb.kindWeight('bisac:science-fiction'), 0.75);
  assert.strictEqual(nb.kindWeight('series:earthsea'), 1.5);
  assert.strictEqual(nb.kindWeight('mood:quiet'), 1);
  assert.strictEqual(nb.kindWeight('pace:slow'), 0.5);
  assert.strictEqual(nb.kindWeight('section:500'), 0.5);
  assert.strictEqual(nb.kindWeight('audience:adult'), 0, 'audience never moves the score');
  assert.strictEqual(nb.kindWeight('something-new:x'), 1, 'an unknown kind counts as a plain subject');

  // audience is in the work, so it is a facet the work has, but it contributes nothing.
  const withAudience = { id: 'z1', authorKey: 'z, z', facets: ['audience:adult', 'topic:wizards'] };
  const p = nb.profile([entry(byId('w1'), 'read', 'loved')]);
  const s = plain(nb.score(withAudience, p));
  assert.deepStrictEqual(s.parts.map((part) => part.facet), ['topic:wizards']);
  near(s.score, 2.1213203435596424, 'the subject over sqrt(2), with audience silent');
});
