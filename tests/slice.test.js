'use strict';
// T2.2: the pool. The real starting list and the real tags, plus two new books and one
// catalogue record from tests/fixtures/found-small.json (built with the adapter from the
// saved le Guin search page). Objects come from a vm realm, so compare them after a JSON
// round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./_load.js');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const SLICE = read('data/slice.json');
const TAGS = read('data/tags.json');
const FOUND = read('tests/fixtures/found-small.json');
const plain = (value) => JSON.parse(JSON.stringify(value));

const FILES = ['app/core/base.js', 'app/core/slice.js', 'app/core/score.js'];

function poolWith(data) {
  const nb = load(FILES);
  Object.keys(data || {}).forEach((name) => nb.data.put(name, data[name]));
  return nb;
}

const full = () => poolWith({ slice: SLICE, tags: TAGS, found: FOUND });
const sliceWork = (id) => SLICE.works.filter((w) => w.id === id)[0];

test('a found fixture adds two new works and enriches one existing work', () => {
  const nb = full();
  const pool = nb.pool;
  const loaded = pool.load();

  assert.strictEqual(loaded.ok, true, 'the real slice loads');
  assert.strictEqual(loaded.works.length, SLICE.works.length + 2, 'two new works, no duplicate of the third');
  assert.strictEqual(loaded.byId.dispossessed.title, 'The Dispossessed', 'the pack book keeps its own id');
  assert.strictEqual(loaded.byId.dispossessed.groupKey, 'pack:dispossessed', 'and its own groupKey');

  const dispossessed = loaded.byId.dispossessed;
  assert.strictEqual(dispossessed.recordId, 'S234C1129065', 'the record id comes from the record');
  assert.deepStrictEqual(plain(dispossessed.formats), ['BK'], 'the formats come from the record');
  assert.strictEqual(dispossessed.callNumber, 'SCIENCE FICTION LEG');
  assert.strictEqual(dispossessed.contentType, 'FICTION');

  const sliceFacets = sliceWork('dispossessed').facets;
  sliceFacets.forEach((f) => assert.ok(dispossessed.facets.indexOf(f) !== -1, 'the slice facet survived: ' + f));
  ['topic:anarchism', 'topic:utopias', 'series:masterpieces-of-science-fiction'].forEach((f) => {
    assert.ok(dispossessed.facets.indexOf(f) !== -1, 'the record joined its own facet: ' + f);
  });
  assert.strictEqual(new Set(dispossessed.facets).size, dispossessed.facets.length, 'no repeated facets');

  const sameTitle = loaded.works.filter((w) => nb.norm(w.title) === 'dispossessed');
  assert.strictEqual(sameTitle.length, 1, 'the found record did not add a second copy');

  const forest = loaded.byGroupKey['word_for_world_is_forest\ufffdguin_ursula_k_le\ufffdtext_eng'];
  assert.ok(forest, 'the first new work is in the pool by groupKey');
  assert.strictEqual(forest.id, 'S234C4827395');
  assert.deepStrictEqual(plain(forest.found), { query: 'le guin' }, 'a new work is marked with the search');
  assert.strictEqual(forest.recordId, undefined, 'its id is its record id already, so no second one');

  const lathe = loaded.byId['S234C2345281'];
  assert.ok(lathe, 'the second new work is in the pool by id');
  assert.strictEqual(lathe.title, 'The Lathe of Heaven');
  assert.deepStrictEqual(plain(lathe.found), { query: 'le guin' });

  const carried = loaded.works.filter((w) => w.facets.indexOf('genre:science-fiction') !== -1).length;
  assert.strictEqual(loaded.facets['genre:science-fiction'].works, carried,
    'the dictionary counts the works in the finished pool, not the build-time count');
  assert.strictEqual(loaded.facets['topic:anarchism'].works, 1, 'a found singleton is kept and counted');
});

test('a typed book whose title and author match a work gets that work, and moves the profile', () => {
  const nb = full();
  const pool = nb.pool;
  pool.load();

  const matched = pool.match('The Dispossessed', 'Ursula K. Le Guin');
  assert.ok(matched, 'a typed title and author find the work');
  assert.strictEqual(matched.groupKey, 'pack:dispossessed');
  assert.strictEqual(matched.id, 'dispossessed');

  assert.strictEqual(pool.match('the dispossessed', 'Le Guin, Ursula K., 1929-2018').groupKey, 'pack:dispossessed',
    'capitals, a leading "the" and a catalogue author heading still match');
  assert.strictEqual(pool.match('The Dispossessed', 'Someone Else'), null, 'a different author is a different book');
  assert.strictEqual(pool.match('A Book Not Here', 'Ursula K. Le Guin'), null, 'an unknown title has no match');

  // The shelf key is the work's own, so the typed book is the same evidence as the work.
  const entry = {
    key: 'w:' + matched.groupKey,
    id: matched.id,
    groupKey: matched.groupKey,
    title: matched.title,
    author: matched.author,
    state: 'read',
    rating: 'loved',
    work: matched,
  };
  const p = plain(nb.profile([entry]));
  assert.strictEqual(p.rated, 1, 'the typed book counts as evidence');
  assert.strictEqual(p.weights['topic:politics'], 3, 'and adds its loved weight to the work\'s facets');
  assert.strictEqual(p.authors['le guin, u'], 3);

  const unmatched = pool.match('A Book Not Here', 'Nobody At All');
  assert.strictEqual(unmatched, null);
  const q = plain(nb.profile([{ key: 't:a book not here|nobody', title: 'A Book Not Here', state: 'read', rating: 'loved', work: unmatched }]));
  assert.deepStrictEqual(q, { weights: {}, authors: {}, evidence: {}, rated: 0 }, 'an unmatched typed book adds nothing');
});

test('sections() on the real slice gives the parts of the library, with labels', () => {
  const nb = full();
  const sections = plain(nb.pool.sections());

  assert.ok(sections.length >= 12, 'at least twelve sections (got ' + sections.length + ')');
  // The twelve the pack gives, plus section:800, which the found record of The Dispossessed
  // brought with it (one of its manifestations has a Dewey call number).
  assert.deepStrictEqual(sections.map((s) => s.facet), [
    'section:100', 'section:300', 'section:500', 'section:600', 'section:700', 'section:800', 'section:900',
    'section:fantasy', 'section:fiction', 'section:horror', 'section:mystery', 'section:romance',
    'section:science-fiction',
  ]);
  sections.forEach((s) => {
    assert.ok(s.label && s.label !== s.facet, s.facet + ' has words, not a key');
    assert.ok(s.works.length > 0, s.facet + ' has works');
  });
  assert.strictEqual(sections.filter((s) => s.facet === 'section:900')[0].label, 'the history shelves (900s)',
    "the slice's own label is used");
  const fiction = sections.filter((s) => s.facet === 'section:fiction')[0];
  fiction.works.forEach((w) => assert.ok(w.facets.indexOf('section:fiction') !== -1, 'every work on the shelf carries it'));
  const ids = fiction.works.map((w) => w.id);
  assert.deepStrictEqual(ids, ids.slice().sort(), 'works are in id order, so the same list groups the same way');
});

test('tags give mood: and pace: facets, with the words for each', () => {
  const nb = full();
  const loaded = nb.pool.load();
  const work = loaded.byGroupKey['pack:dispossessed'];
  const tag = TAGS.works['pack:dispossessed'];

  assert.ok(work.facets.indexOf('mood:quiet') !== -1, 'the mood is a facet on the work');
  assert.ok(work.facets.indexOf('mood:strange') !== -1);
  assert.ok(work.facets.indexOf('pace:slow') !== -1, 'the pace is a facet on the work');
  assert.strictEqual(new Set(work.facets).size, work.facets.length, 'no repeated facets from tags');

  assert.strictEqual(loaded.facets['mood:quiet'].label, 'quiet books');
  assert.strictEqual(loaded.facets['pace:slow'].label, 'a slow pace');
  assert.strictEqual(loaded.facets['mood:quiet'].kind, 'mood');
  assert.strictEqual(nb.pool.labelOf('mood:quiet'), 'quiet books');
  assert.strictEqual(nb.pool.labelOf('pace:slow'), 'a slow pace');

  const tagged = Object.keys(TAGS.works).filter((k) => (TAGS.works[k].mood || []).indexOf('quiet') !== -1).length;
  assert.strictEqual(loaded.facets['mood:quiet'].works, tagged, 'the count is the works carrying it');

  assert.deepStrictEqual(plain(nb.pool.tagsOf(work)),
    { mood: plain(tag.mood), pace: tag.pace, note: tag.note });
  assert.strictEqual(nb.pool.tagsOf(loaded.byId['S234C2345281']), null, 'a found book with no tags has none');

  // Every facet a work carries has words, so a reason sentence can never be blank.
  loaded.works.forEach((w) => w.facets.forEach((f) => {
    assert.ok(loaded.facets[f] && loaded.facets[f].label, f + ' has a label');
  }));
  assert.strictEqual(nb.pool.labelOf('topic:not-a-real-subject'), '', 'an unknown facet has no words');
  assert.strictEqual(nb.pool.labelOf(''), '');
});

test('a missing slice gives ok:false with a plain sentence, and never throws', () => {
  const nb = load(FILES);
  const res = nb.pool.load();
  assert.strictEqual(res.ok, false);
  assert.strictEqual(typeof res.message, 'string');
  assert.ok(res.message.length > 10 && /\.$/.test(res.message), 'a plain sentence: ' + res.message);

  assert.strictEqual(nb.pool.match('The Dispossessed', 'Ursula K. Le Guin'), null);
  assert.deepStrictEqual(plain(nb.pool.search('birds')), []);
  assert.deepStrictEqual(plain(nb.pool.sections()), []);
  assert.strictEqual(nb.pool.labelOf('topic:wizards'), '');
  assert.strictEqual(nb.pool.tagsOf({ groupKey: 'pack:dispossessed' }), null);

  // A slice that arrived broken is the same as one that did not arrive.
  const broken = poolWith({ slice: { schema: 'nextbook/slice-1', works: 'not a list' } });
  const again = broken.pool.load();
  assert.strictEqual(again.ok, false);
  assert.ok(/\.$/.test(again.message));
  assert.strictEqual(broken.pool.load().ok, false, 'asking twice is still a refusal, not a throw');
});

test('search finds works by title, author and facet words, in list order', () => {
  const nb = full();
  const pool = nb.pool;
  pool.load();

  const byAuthor = plain(pool.search('le guin')).map((w) => w.title);
  assert.ok(byAuthor.indexOf('The Dispossessed') !== -1, 'an author search finds their books');
  assert.ok(byAuthor.indexOf('The Lathe of Heaven') !== -1, 'including a found one');
  assert.strictEqual(byAuthor.length, SLICE.works.filter((w) => w.authorKey === 'le guin, u').length + 2);

  assert.deepStrictEqual(plain(pool.search('dispossessed')).map((w) => w.id), ['dispossessed']);
  assert.deepStrictEqual(plain(pool.search('the dispossessed')).map((w) => w.id), ['dispossessed'],
    'the leading article is dropped, as everywhere else');

  const byFacet = plain(pool.search('politics')).map((w) => w.id);
  assert.ok(byFacet.length > 0, 'a subject finds the books about it');
  byFacet.forEach((id) => {
    const work = pool.load().byId[id];
    const text = nb.norm([work.title, work.subtitle, work.author, work.facets.join(' ')].join(' '));
    assert.ok(text.indexOf('politics') !== -1, id + ' really does mention it');
  });

  assert.deepStrictEqual(plain(pool.search('')), []);
  assert.deepStrictEqual(plain(pool.search('   ')), []);
  assert.deepStrictEqual(plain(pool.search('zzzznotabook')), []);
});

test('load() is repeatable and the indexes point at the pool\'s own works', () => {
  const nb = full();
  const a = nb.pool.load();
  const b = nb.pool.load();
  assert.strictEqual(a.ok, true);
  assert.deepStrictEqual(plain(a.works).length, plain(b.works).length);
  assert.strictEqual(b.byId['dispossessed'], b.works.filter((w) => w.id === 'dispossessed')[0],
    'byId holds the work itself');
  assert.strictEqual(b.byGroupKey['pack:dispossessed'], b.byId['dispossessed']);
  // The profile reads whatever facets the pool gave the work, tags included.
  const p = plain(nb.profile([{ key: 'w:pack:dispossessed', state: 'read', rating: 'loved', work: b.byId['dispossessed'] }]));
  assert.strictEqual(p.weights['mood:quiet'], 3, 'the mood facet moves the profile too');
});

// A copy of the fixture with one record changed, so a test can vary a found file without
// shipping a file that carries a field AGENTS.md rule 4 forbids.
function foundWith(mutate) {
  const copy = JSON.parse(JSON.stringify(FOUND));
  mutate(copy.works[1], copy);
  return poolWith({ slice: SLICE, tags: TAGS, found: copy });
}

test('a found record matches a slice work whichever side has the author key', () => {
  // The record with no authorKey at all: the author string is the only thing to compare.
  const noKey = foundWith((record) => { delete record.authorKey; });
  const a = noKey.pool.load();
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.works.length, SLICE.works.length + 2, 'no authorKey still enriches, not a second work');
  assert.strictEqual(a.works.filter((w) => noKey.norm(w.title) === 'dispossessed').length, 1,
    'one work for The Dispossessed');
  assert.strictEqual(a.byId['dispossessed'].recordId, 'S234C1129065', 'the record enriched the pack work');
  assert.ok(a.byId['dispossessed'].facets.indexOf('topic:anarchism') !== -1, 'and brought its facets');

  // A key in another spelling: the author string agrees even though the keys do not.
  const otherKey = foundWith((record) => { record.authorKey = 'Le Guin, Ursula K.'; });
  const b = otherKey.pool.load();
  assert.strictEqual(b.works.length, SLICE.works.length + 2, 'a differently spelled key still enriches');
  assert.strictEqual(b.works.filter((w) => otherKey.norm(w.title) === 'dispossessed').length, 1,
    'still one work, not a second copy');
  assert.strictEqual(b.byId['dispossessed'].recordId, 'S234C1129065');
  assert.strictEqual(b.works.filter((w) => w.id === 'S234C1129065').length, 0,
    'the record did not join as a work of its own');
  assert.strictEqual(b.byId['S234C1129065'].id, 'dispossessed', 'its record id points at the pack work');
});

test('an enriched work answers to the catalogue record id and groupKey as well as its own', () => {
  const nb = full();
  const loaded = nb.pool.load();
  const record = FOUND.works.filter((w) => w.id === 'S234C1129065')[0];
  const pack = loaded.byId['dispossessed'];

  assert.strictEqual(loaded.byId[record.id], pack, 'the catalogue record id finds the pack work');
  assert.strictEqual(loaded.byGroupKey[record.groupKey], pack, 'the catalogue groupKey finds it too');
  assert.strictEqual(loaded.byId['dispossessed'], pack, 'and its own id still does');
  assert.strictEqual(loaded.byGroupKey['pack:dispossessed'], pack, 'as does its own groupKey');

  // A shelf entry keyed the way a library shelf is keyed: id is the record id, groupKey the
  // catalogue's. It resolves to the pack work, so it is evidence, not a book we do not have.
  const entry = {
    key: 'w:' + record.groupKey,
    id: record.id,
    groupKey: record.groupKey,
    title: record.title,
    author: record.author,
    state: 'read',
    rating: 'loved',
  };
  const work = loaded.byId[entry.id] || loaded.byGroupKey[entry.groupKey] || null;
  assert.strictEqual(work, pack, 'the shelf entry resolves to the work in the pack');
  const p = plain(nb.profile([Object.assign({}, entry, { work })]));
  assert.strictEqual(p.rated, 1, 'the library shelf entry is evidence');
  assert.strictEqual(p.weights['topic:anarchism'], 3, 'and moves the profile through the work\'s facets');
  assert.strictEqual(p.authors['le guin, u'], 3);
});

test('a found work carrying a blurb field loses it at load, and is still usable', () => {
  FOUND.works.forEach((w) => {
    assert.strictEqual(w.description, undefined, 'the fixture itself ships no blurb');
    assert.strictEqual(w.jacket, undefined, 'and no jacket copy');
    assert.strictEqual(w.rating, undefined, 'and no per-record rating');
  });

  const poisoned = JSON.parse(JSON.stringify(FOUND));
  const target = poisoned.works[0];
  target.description = 'A publisher blurb that must never reach the pool.';
  target.Description = 'The same, in another case.';
  target.jacket = 'More publisher words.';
  target.JACKET = 'More, louder.';
  target.rating = 5;
  target.Rating = 4;
  const nb = poolWith({ slice: SLICE, tags: TAGS, found: poisoned });
  const loaded = nb.pool.load();

  assert.strictEqual(loaded.ok, true);
  const work = loaded.byId[target.id];
  assert.ok(work, 'the found work is still in the pool');
  ['description', 'Description', 'DESCRIPTION', 'jacket', 'Jacket', 'JACKET', 'rating', 'Rating', 'RATING']
    .forEach((k) => assert.strictEqual(work[k], undefined, k + ' was dropped at the fence'));
  assert.strictEqual(work.title, target.title, 'the rest of the record is untouched');
  assert.strictEqual(work.author, target.author);
  assert.ok(work.facets.indexOf('genre:science-fiction') !== -1, 'its facets survived');
  assert.deepStrictEqual(plain(nb.pool.search('word for world')).map((w) => w.id), [target.id],
    'and it is still found by search');
});

// Found by reference/modes/challenge: ctx.tagsOf was always null, because load() returned a
// snapshot without the helpers makeCtx asks for. CONTRACT.md section 4 promises ctx.tagsOf.
test('a context built from the loaded pool answers with the helpers the pool exposes', () => {
  const nb = load(['app/core/base.js', 'app/core/slice.js', 'app/core/score.js',
    'app/core/reason.js', 'app/core/contract.js']);
  nb.data.put('slice', SLICE);
  nb.data.put('tags', TAGS);

  const loaded = nb.pool.load();
  ['match', 'search', 'sections', 'labelOf', 'tagsOf'].forEach((name) => {
    assert.strictEqual(typeof loaded[name], 'function', 'the snapshot carries ' + name);
  });
  assert.strictEqual(loaded.tagsOf, nb.pool.tagsOf, 'the same function the pool exposes');

  const ctx = nb.makeCtx({ pool: loaded, shelf: [], seed: 1 });
  const work = loaded.byId['dispossessed'];
  assert.deepStrictEqual(plain(ctx.tagsOf(work).mood), ['quiet', 'strange']);
  assert.strictEqual(ctx.tagsOf(work).pace, 'slow');
  assert.strictEqual(ctx.labelOf('mood:quiet'), 'quiet books');
  assert.ok(ctx.sections().length >= 5, 'the parts of the library come through too');
  assert.strictEqual(ctx.work('left-hand').title, 'The Left Hand of Darkness');
  assert.deepStrictEqual(plain(ctx.works.map((w) => w.id)).length, SLICE.works.length);
});
