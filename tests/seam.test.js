'use strict';
// T2.7: the model seam (ARCHITECTURE.md "The model seam"). The prompt carries the
// candidates' own words and never a reason sentence, because a reason may name a shelf
// book; the parsers keep only what exists. vm-realm objects are compared after a JSON
// round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./_load.js');

const SLICE = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/slice-small.json'), 'utf8'));
const plain = (value) => JSON.parse(JSON.stringify(value));
const nb = load(['app/core/base.js', 'app/core/score.js', 'app/core/reason.js', 'app/core/seam.js']);

const END = 'Answer with two lines. Do not change any files.';

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
    sections: () => nb.sections(slice.works, facets),
    labelOf: (facet) => (facets[facet] ? facets[facet].label : nb.labelFor(facet, facets)),
    tagsOf: () => null,
  };
}
const pool = makePool(SLICE);

// The shelf book whose title must never reach a prompt, and a profile built from it.
const SHELF_BOOK = SLICE.works[0]; // A Wizard of Earthsea
const profile = nb.profile([{
  key: 'w:' + SHELF_BOOK.groupKey, id: SHELF_BOOK.id, title: SHELF_BOOK.title, author: SHELF_BOOK.author,
  state: 'read', rating: 'loved', work: SHELF_BOOK,
}]);

// A validated result whose reasons name the shelf book: the reason is for the person's
// eyes only ("Shares the Earthsea series with A Wizard of Earthsea, which you loved").
const result = {
  picks: [
    { id: 'w2', why: 'Shares the Earthsea series with A Wizard of Earthsea, which you loved.' },
    { id: 'w5', why: 'Matches books about gender and science fiction on your shelf.' },
  ],
};

test('a reason that names a shelf book gives a prompt without that title', () => {
  const prompt = nb.seam.finalistsPrompt(result, profile, pool);
  assert.ok(prompt.indexOf(SHELF_BOOK.title) === -1, 'the shelf title is not in the prompt');
  assert.ok(prompt.indexOf(result.picks[0].why) === -1, 'the reason itself is not in the prompt');
  // The candidates carry their own words, from the list.
  assert.ok(prompt.indexOf('w2') !== -1 && prompt.indexOf('The Tombs of Atuan') !== -1);
  assert.ok(prompt.indexOf('w5') !== -1 && prompt.indexOf('The Left Hand of Darkness') !== -1);
  assert.ok(prompt.indexOf('Ursula K. Le Guin') !== -1);
  assert.ok(prompt.indexOf('1970') !== -1);
  assert.ok(prompt.indexOf('the Earthsea series') !== -1, 'facet labels, not a title');
  assert.ok(/matches (books about|other books by)/.test(prompt), 'factsClause(), not reason()');
  assert.ok(prompt.indexOf('fantasy') !== -1, "the profile's labels are there");
});

test('both prompts end with the exact sentence', () => {
  const finalists = nb.seam.finalistsPrompt(result, profile, pool);
  assert.strictEqual(finalists.split('\n').pop(), END);
  const labels = nb.seam.labelsPrompt('a night about sea monsters and maps', SLICE.facets);
  assert.strictEqual(labels.split('\n').pop(), END);
  assert.strictEqual(nb.seam.end, END);
  assert.strictEqual(END, 'Answer with two lines. Do not change any files.');
});

test('one good id plus one invented keeps one and names the other', () => {
  const r = plain(nb.seam.parseFinalists(
    'w2: It is short and strange.\nnot-a-book: Because I liked its cover.', result));
  assert.deepStrictEqual(r.kept.map((k) => k.id), ['w2']);
  assert.strictEqual(r.dropped.length, 1);
  assert.strictEqual(r.dropped[0].id, 'not-a-book');
  assert.match(r.reason, /not-a-book/);
  assert.match(r.reason, /is not one of the six books/);
});

test('a fenced, a JSON and a bulleted answer all parse', () => {
  const fenced = plain(nb.seam.parseFinalists(
    'Here you go:\n```\nw2: It is short and strange.\nw5: It is about gender.\n```\n', result));
  assert.deepStrictEqual(fenced.kept.map((k) => k.id), ['w2', 'w5']);
  assert.strictEqual(fenced.kept[1].why, 'It is about gender.');

  const json = plain(nb.seam.parseFinalists(
    '{"picks":[{"id":"w2","why":"It is short and strange."},{"id":"w5","reason":"It is about gender."}]}', result));
  assert.deepStrictEqual(json.kept.map((k) => k.id), ['w2', 'w5']);
  assert.strictEqual(json.kept[1].why, 'It is about gender.');

  const bullets = plain(nb.seam.parseFinalists(
    '- **w2**: It is short and strange.\n- w5 - It is about gender.\n', result));
  assert.deepStrictEqual(bullets.kept.map((k) => k.id), ['w2', 'w5']);
});

test('an answer with no valid id says so', () => {
  const r = plain(nb.seam.parseFinalists('I would read something else entirely.', result));
  assert.deepStrictEqual(r.kept, []);
  assert.strictEqual(r.reason, 'The answer did not name any of the six books.');
});

test('a title in the answer is ignored, never kept and never named', () => {
  const r = plain(nb.seam.parseFinalists(
    'The Tombs of Atuan by Ursula K. Le Guin: a fine book about a priestess.', result));
  assert.deepStrictEqual(r.kept, []);
  assert.deepStrictEqual(r.dropped, []);
});

test('parseLabels keeps only labels in the list, by norm()', () => {
  const labels = {
    'topic:wizards': { label: 'wizards', kind: 'topic', works: 1 },
    'topic:deserts': { label: 'deserts', kind: 'topic', works: 1 },
    'section:science-fiction': { label: 'the science fiction shelves', kind: 'section', works: 1 },
    'mood:quiet': { label: 'quiet books', kind: 'mood', works: 1 },
  };
  const r = plain(nb.parseLabels('WIZARDS\nsea stories\nthe science fiction shelves', labels));
  assert.deepStrictEqual(r.kept, ['topic:wizards', 'section:science-fiction']);
  assert.deepStrictEqual(r.dropped.map((d) => d.label), ['sea stories']);
  assert.match(r.reason, /sea stories is not a label in the list/);

  // Bullets, JSON and "label: why" lines read the same way.
  assert.deepStrictEqual(plain(nb.parseLabels('1. wizards\n2. deserts', labels)).kept, ['topic:wizards', 'topic:deserts']);
  assert.deepStrictEqual(plain(nb.parseLabels('["quiet books","sea stories"]', labels)).kept, ['mood:quiet']);
  assert.deepStrictEqual(plain(nb.parseLabels('wizards: books about magic schools', labels)).kept, ['topic:wizards']);
});

test('parseLabels says so when nothing matches, and the prompt carries the list', () => {
  const r = plain(nb.parseLabels('none of these\nwords are labels', SLICE.facets));
  assert.deepStrictEqual(r.kept, []);
  assert.strictEqual(r.reason.indexOf('did not name any subject in the list') !== -1, true);

  const prompt = nb.seam.labelsPrompt('a night about sea monsters', SLICE.facets);
  assert.ok(prompt.indexOf('wizards') !== -1);
  assert.ok(prompt.indexOf('the science fiction shelves') !== -1);
  assert.ok(prompt.indexOf('a night about sea monsters') !== -1);
  assert.ok(prompt.indexOf('up to four') !== -1);
  assert.ok(prompt.indexOf(SHELF_BOOK.title) === -1, 'a prompt carries no book title at all');
});

// ---- what a drop says, and what the parsers can read ----------------------------------------

// The six books an answer may name, as a validated result would carry them.
const SIX = {
  picks: SLICE.works.slice(0, 6).map((w) => ({ id: w.id, why: 'It shares the wizards with your shelf.' })),
};

test('a dropped finalist is described by its own reason, never as an unknown book', () => {
  const twice = plain(nb.seam.parseFinalists(
    'w2: It is short and strange.\nw2: It is short and strange again.\nw5: It is about gender.', SIX));
  assert.deepStrictEqual(twice.kept.map((k) => k.id), ['w2', 'w5']);
  assert.strictEqual(twice.dropped.length, 1);
  assert.strictEqual(twice.dropped[0].id, 'w2');
  assert.strictEqual(twice.dropped[0].code, 'repeat');
  assert.strictEqual(twice.reason, 'w2 is named twice, so only the first was kept.');

  const unknown = plain(nb.seam.parseFinalists(
    'w2: It is short and strange.\nnot-a-book: Because I liked its cover.', SIX));
  assert.strictEqual(unknown.dropped[0].code, 'unknown');
  assert.strictEqual(unknown.reason, 'not-a-book is not one of the six books.');
});

test('a third finalist is called a third book, not an unknown one', () => {
  const r = plain(nb.seam.parseFinalists('w2: A short book.\nw5: A strange book.\nw3: A third book.', SIX));
  assert.deepStrictEqual(r.kept.map((k) => k.id), ['w2', 'w5']);
  assert.strictEqual(r.dropped.length, 1);
  assert.strictEqual(r.dropped[0].code, 'third');
  assert.strictEqual(r.reason, 'w3 is a third book; the answer asked for two.');
  assert.ok(r.reason.indexOf('not one of the six books') === -1, r.reason);
});

test('a fifth label is a fifth label, and an unknown one is unknown', () => {
  const labels = {
    'topic:wizards': { label: 'wizards', kind: 'topic', works: 1 },
    'topic:deserts': { label: 'deserts', kind: 'topic', works: 1 },
    'topic:maps': { label: 'maps', kind: 'topic', works: 1 },
    'topic:ships': { label: 'ships', kind: 'topic', works: 1 },
    'topic:quiet': { label: 'quiet books', kind: 'topic', works: 1 },
  };
  const five = plain(nb.parseLabels('wizards\ndeserts\nmaps\nships\nquiet books', labels));
  assert.strictEqual(five.kept.length, 4);
  assert.strictEqual(five.dropped.length, 1);
  assert.strictEqual(five.dropped[0].label, 'quiet books');
  assert.strictEqual(five.dropped[0].code, 'over');
  assert.strictEqual(five.reason, 'quiet books is a fifth label; the answer asked for four.');

  const unknown = plain(nb.parseLabels('wizards\nsea monsters', labels));
  assert.deepStrictEqual(unknown.kept, ['topic:wizards']);
  assert.strictEqual(unknown.dropped[0].code, 'unknown');
  assert.strictEqual(unknown.reason, 'sea monsters is not a label in the list.');
});

test('a line of labels is split before anything is called unknown', () => {
  const labels = {
    'topic:wizards': { label: 'wizards', kind: 'topic', works: 1 },
    'topic:deserts': { label: 'deserts', kind: 'topic', works: 1 },
  };
  const both = plain(nb.parseLabels('WIZARDS , Deserts', labels));
  assert.deepStrictEqual(both.kept, ['topic:wizards', 'topic:deserts']);
  assert.deepStrictEqual(both.dropped, [], 'the line produced kept labels, so it is not dropped');
  assert.strictEqual(both.reason, '');

  const withReason = plain(nb.parseLabels('wizards: because of the school', labels));
  assert.deepStrictEqual(withReason.kept, ['topic:wizards']);
  assert.deepStrictEqual(withReason.dropped, [], 'a reason after a kept label is not a dropped label');
  assert.strictEqual(withReason.reason, '');

  // A piece that really is not a label is still named, and only that piece.
  const mixed = plain(nb.parseLabels('wizards, sea monsters, deserts', labels));
  assert.deepStrictEqual(mixed.kept, ['topic:wizards', 'topic:deserts']);
  assert.deepStrictEqual(mixed.dropped.map((d) => d.label), ['sea monsters']);
});

test('finalistsPrompt tolerates a null, an empty and a real pick', () => {
  const messy = { picks: [null, {}, { id: 'w2', why: 'A reason the prompt must not read.' }] };
  const prompt = nb.seam.finalistsPrompt(messy, profile, pool);
  assert.ok(prompt.indexOf('The Tombs of Atuan') !== -1, 'the real pick is there');
  assert.ok(prompt.indexOf('A reason the prompt must not read.') === -1, 'and its reason is not');
  assert.strictEqual(prompt.split('\n').pop(), END);
  assert.strictEqual(nb.seam.finalistsPrompt(null, null, null).split('\n').pop(), END);
});

test('an id with capitals keeps the real id spelling', () => {
  const hyphen = { picks: [{ id: 'left-hand', why: 'x' }, { id: 'tombs-of-atuan', why: 'y' }] };
  const r = plain(nb.seam.parseFinalists(
    'Left-Hand: It is short and strange.\nTombS-Of-Atuan: It is a quiet book.', hyphen));
  assert.deepStrictEqual(r.kept.map((k) => k.id), ['left-hand', 'tombs-of-atuan']);
  assert.deepStrictEqual(r.dropped, []);

  const six = plain(nb.seam.parseFinalists('W2: It is short and strange.\nw5: It is about gender.', SIX));
  assert.deepStrictEqual(six.kept.map((k) => k.id), ['w2', 'w5']);
});

test('a JSON array of bare ids is read, and a pick with no sentence is dropped by name', () => {
  const array = plain(nb.seam.parseFinalists('["w2", "w5"]', SIX));
  assert.deepStrictEqual(array.kept, []);
  assert.deepStrictEqual(array.dropped.map((d) => d.id), ['w2', 'w5']);
  assert.deepStrictEqual(array.dropped.map((d) => d.code), ['noSentence', 'noSentence']);
  assert.match(array.reason, /w2 has no sentence after it, so there was nothing to keep\./);

  // A lone id on its own line was kept with an empty why and then dropped by validate as
  // "no reason"; the parser now says what is missing itself.
  const lone = plain(nb.seam.parseFinalists('w2', SIX));
  assert.deepStrictEqual(lone.kept, []);
  assert.strictEqual(lone.dropped.length, 1);
  assert.strictEqual(lone.dropped[0].code, 'noSentence');
  assert.match(lone.reason, /no sentence/);
});
