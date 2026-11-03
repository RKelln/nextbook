'use strict';
// T2.4: the reason sentence. One test per shape in docs/ARCHITECTURE.md "Reasons",
// then the three things isReason must reject, then the prompt clause that must never
// name a book on the shelf. Objects come from a vm realm, so compare after a JSON
// round trip (AGENTS.md). The ten works are tests/fixtures/slice-small.json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./_load.js');

const SLICE = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/slice-small.json'), 'utf8'));
const plain = (value) => JSON.parse(JSON.stringify(value));
const nb = load(['app/core/base.js', 'app/core/score.js', 'app/core/reason.js']);
const byId = (id) => SLICE.works.filter((w) => w.id === id)[0];

const entry = (work, state, rating) => ({
  key: work ? 'w:' + work.groupKey : 't:a-typed-book|someone',
  title: work ? work.title : 'A typed book',
  author: work ? work.author : 'Someone',
  state: state,
  rating: rating === undefined ? null : rating,
  work: work || null,
});

// Two works made up for the sentences below: one shares a subject and a bisac term,
// the other shares one series and nothing else.
const pair = { id: 't1', title: 'Wizards and rockets', author: 'Kit Marsh', authorKey: 'marsh, k',
  facets: ['topic:wizards', 'bisac:science-fiction'] };
const oneSeries = { id: 't2', title: 'The Further Shore', author: 'Kit Marsh', authorKey: 'marsh, k',
  facets: ['series:earthsea'] };
const oneTopic = { id: 't3', title: 'A Book of Wizards', author: 'Kit Marsh', authorKey: 'marsh, k',
  facets: ['topic:wizards'] };

const loved = nb.profile([entry(byId('w1'), 'read', 'loved')]);
const twoSources = nb.profile([entry(byId('w1'), 'read', 'loved'), entry(byId('w3'), 'read', 'liked')]);

test('the author shape: the strongest part is the author', () => {
  const parts = nb.score(byId('w5'), loved).parts;
  assert.strictEqual(nb.reason(parts), 'You rated Ursula K. Le Guin well already.');
});

test('the two-facet shape: the two strongest subjects', () => {
  const parts = nb.score(pair, twoSources).parts;
  assert.strictEqual(nb.reason(parts), 'Matches books about wizards and science fiction on your shelf.');
});

test('the one-facet shape with evidence names the book the person loved', () => {
  const parts = nb.score(oneSeries, loved).parts;
  assert.strictEqual(nb.reason(parts, { evidence: loved.evidence }),
    'Shares the Earthsea series with A Wizard of Earthsea, which you loved.');
});

test('the one-facet shape with no evidence still names the subject', () => {
  const parts = nb.score(oneTopic, loved).parts;
  assert.strictEqual(nb.reason(parts), 'Matches books about wizards on your shelf.');
});

test('the negative shape, only when a mode asks for it', () => {
  const against = nb.profile([entry(byId('w1'), 'read', 'not-for-me')]);
  const parts = nb.score(byId('w2'), against).parts;

  assert.strictEqual(nb.reason(parts), '', 'no positive parts and no request: no sentence');
  assert.strictEqual(nb.reason(parts, { negative: true }),
    'Not much like your shelf, which is the point.');
  assert.strictEqual(nb.reason(parts, { negative: true, because: 'you have no history' }),
    'Not much like your shelf, which is the point: you have no history.');
  assert.strictEqual(nb.reason([], { negative: true, because: 'you have no history.' }),
    'Not much like your shelf, which is the point: you have no history.');
});

test('the sentence names the loved book when two shelf books share the facet', () => {
  const p = nb.profile([entry(byId('w2'), 'read', 'ok'), entry(byId('w1'), 'read', 'loved')]);
  const parts = nb.score(oneSeries, p).parts;
  assert.strictEqual(nb.reason(parts, { evidence: p.evidence }),
    'Shares the Earthsea series with A Wizard of Earthsea, which you loved.');
});

test('a reason is at most 200 characters, even with a label that is far too long', () => {
  const longFacet = 'topic:' + 'x'.repeat(230);
  const p = nb.profile([entry({ facets: [longFacet], authorKey: 'x, x' }, 'read', 'loved')]);
  const parts = nb.score({ id: 't9', authorKey: 'y, y', facets: [longFacet] }, p).parts;
  const said = nb.reason(parts);

  assert.strictEqual(Array.from(said).length, 200);
  assert.ok(said.slice(-1) === '\u2026', 'it ends with an ellipsis');
  assert.strictEqual(nb.isReason(said), true);
});

test('a reason that is too long drops the second facet before it cuts the words', () => {
  const longFacet = 'topic:' + 'x'.repeat(230);
  const p = nb.profile([
    entry({ facets: [longFacet], authorKey: 'x, x' }, 'read', 'loved'),
    entry(byId('w1'), 'read', 'loved'),
  ]);
  const parts = nb.score({ id: 't8', authorKey: 'y, y', facets: [longFacet, 'genre:fantasy'] }, p).parts;
  const said = nb.reason(parts);

  assert.strictEqual(said, 'Matches books about fantasy on your shelf.');
  assert.ok(Array.from(said).length <= 200);
});

test('isReason rejects empty, the stock phrase, and anything over 200 characters', () => {
  assert.strictEqual(nb.isReason(''), false);
  assert.strictEqual(nb.isReason('   '), false);
  assert.strictEqual(nb.isReason('A small match.'), false);
  assert.strictEqual(nb.isReason('a small match'), false);
  assert.strictEqual(nb.isReason('x'.repeat(201)), false);
  assert.strictEqual(nb.isReason('x'.repeat(200)), true);
  assert.strictEqual(nb.isReason(null), false);
  assert.strictEqual(nb.isReason('Matches books about wizards on your shelf.'), true);
});

test('every reason the core writes passes isReason, on all ten works', () => {
  const p = nb.profile([
    entry(byId('w1'), 'read', 'loved'),
    entry(byId('w3'), 'read', 'liked'),
    entry(byId('w9'), 'reading', null),
  ]);
  SLICE.works.forEach((work) => {
    const said = nb.reason(nb.score(work, p, SLICE.facets).parts, { evidence: p.evidence });
    if (said) assert.strictEqual(nb.isReason(said), true, work.id + ': ' + said);
  });
});

test('factsClause is the same evidence for a prompt, and names no book on the shelf', () => {
  const p = nb.profile([entry(byId('w1'), 'read', 'loved'), entry(byId('w3'), 'read', 'liked')]);
  const clause = nb.factsClause(nb.score(pair, p).parts, { evidence: plain(p.evidence) });

  assert.strictEqual(clause, 'matches books about wizards and science fiction');
  assert.strictEqual(clause.indexOf('A Wizard of Earthsea'), -1);
  assert.strictEqual(clause.indexOf('The Dispossessed'), -1);

  // The same guarantee for every work in the list: no shelf title ever appears.
  const titles = ['A Wizard of Earthsea', 'The Dispossessed'];
  SLICE.works.forEach((work) => {
    const said = nb.factsClause(nb.score(work, p, SLICE.facets).parts, { evidence: plain(p.evidence) });
    titles.forEach((title) => {
      assert.strictEqual(said.indexOf(title), -1, work.id + ' must not name "' + title + '"');
    });
  });
});

test('factsClause for author evidence names the author, which is not a shelf book', () => {
  const clause = nb.factsClause(nb.score(byId('w5'), loved).parts);
  assert.strictEqual(clause, 'matches other books by Ursula K. Le Guin');
  assert.strictEqual(clause.indexOf('A Wizard of Earthsea'), -1);
  assert.strictEqual(nb.factsClause([]), '', 'no parts, no words');
});
