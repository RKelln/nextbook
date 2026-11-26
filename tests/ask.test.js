'use strict';
// D46: a mode that asks a chat. The prompt carries the shelf only as numbers and the list's own
// subject words (seam.shelfSummary), never a title, an author or a series name; the mode's
// question may not name one either (contract validate); the answer keeps only books offered.
// Run on the real slice and practice shelf, so the words checked are the ones a person sees.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./_load.js');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const plain = (v) => JSON.parse(JSON.stringify(v));
const nb = load(['app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
  'app/core/contract.js', 'app/core/seam.js']);
nb.data.put('slice', read('data/slice.json'));
nb.data.put('tags', read('data/tags.json'));
const PRACTICE = read('data/practice.json');
const pool = nb.pool.load();

function ctxFor(entries) { return nb.makeCtx({ pool, shelf: entries }); }
const practiceCtx = ctxFor(PRACTICE.entries);

// Every title and author on the practice shelf, as the page would match them.
function shelfWords(ctx) {
  const out = [];
  ctx.shelf.forEach((e) => {
    [e.title, e.author, e.work && e.work.title, e.work && e.work.author].forEach((v) => {
      if (v && out.indexOf(v) === -1) out.push(v);
    });
  });
  return out;
}

test('A1: the shelf summary has counts and subjects, and no title or author from the shelf', () => {
  const s = plain(nb.seam.shelfSummary(practiceCtx.shelf, pool));
  assert.strictEqual(s.small, false);
  const text = s.lines.join('\n');
  assert.match(text, /^Books on their shelf: \d+ \(/);
  assert.match(text, /Their ratings: .*loved/);
  assert.match(text, /Subjects in books they loved or liked: .+\(\d+\)/);
  assert.match(text, /Parts of the library with none of their books: /);
  shelfWords(practiceCtx).forEach((w) => {
    assert.strictEqual(text.toLowerCase().indexOf(w.toLowerCase()), -1, 'the summary names "' + w + '"');
  });
  // The same shelf says the same thing.
  assert.deepStrictEqual(plain(nb.seam.shelfSummary(practiceCtx.shelf, pool)), s);
});

test('A2: under three rated books the summary gives only the counts', () => {
  const two = PRACTICE.entries.filter((e) => e.rating).slice(0, 2);
  const s = plain(nb.seam.shelfSummary(ctxFor(two).shelf, pool));
  assert.strictEqual(s.small, true);
  assert.strictEqual(s.lines.length, 3, s.lines.join('\n'));
  assert.ok(!/Subjects/.test(s.lines.join('\n')), 'no subjects for a tiny shelf');
  const none = plain(nb.seam.shelfSummary([], pool));
  assert.deepStrictEqual(none.lines.slice(0, 2), ['Books on their shelf: 0.', 'Their ratings: none yet.']);
});

const ASK_MODE = {
  id: 'ask-test', name: 'Ask', purpose: 'Asks a chat.', shape: 'list', inputs: [], strings: {}
};

test('A3: validate keeps the question and the offered books, and drops shelf books and repeats', () => {
  const onShelf = practiceCtx.shelf[0].work.id;
  const pile = practiceCtx.works.filter((w) => !practiceCtx.onShelf(w.id)).map((w) => w.id);
  const v = plain(nb.validate({ picks: [], ask: { question: 'Choose well.', books: [pile[0], onShelf, pile[0], 'no-such-book', pile[1]] } },
    practiceCtx, ASK_MODE));
  assert.strictEqual(v.error, null);
  assert.deepStrictEqual(v.ask, { question: 'Choose well.', books: [pile[0], pile[1]] });
  assert.deepStrictEqual(v.dropped.map((d) => d.code), ['shelf', 'repeat', 'unknown']);
  // A shelf book is dropped from the offer even for a mode that may pick shelf books.
  const shelfMode = Object.assign({}, ASK_MODE, { allowShelf: true });
  const v2 = plain(nb.validate({ ask: { question: 'Q.', books: [onShelf, pile[0]] } }, practiceCtx, shelfMode));
  assert.deepStrictEqual(v2.ask.books, [pile[0]]);
});

test('A4: a question that names a shelf title or author is refused', () => {
  const e = practiceCtx.shelf[0];
  const free = practiceCtx.works.find((w) => !practiceCtx.onShelf(w.id)).id;
  [e.title, e.author, 'Something like ' + e.title.toUpperCase() + ', please.'].forEach((q) => {
    const v = plain(nb.validate({ ask: { question: q, books: [free] } }, practiceCtx, ASK_MODE));
    assert.ok(!v.ask, 'no ask for "' + q + '"');
    assert.match(String(v.error), /never sees a title or an author/);
  });
  const fine = plain(nb.validate({ ask: { question: 'Something quiet.', books: [free] } }, practiceCtx, ASK_MODE));
  assert.ok(fine.ask);
});

test('A5: no question, too long, no books, too many books', () => {
  const id = practiceCtx.works.find((w) => !practiceCtx.onShelf(w.id)).id;
  assert.match(String(nb.validate({ ask: { question: ' ', books: [id] } }, practiceCtx, ASK_MODE).error), /no question/);
  assert.match(String(nb.validate({ ask: { question: 'x'.repeat(501), books: [id] } }, practiceCtx, ASK_MODE).error), /too long/);
  assert.match(String(nb.validate({ ask: { question: 'Q.', books: [] } }, practiceCtx, ASK_MODE).error), /offers it no books/);
  assert.strictEqual(nb.validate({ ask: { question: 'Q.', books: [] }, note: 'Nothing to ask about.' }, practiceCtx, ASK_MODE).error, null);
  assert.match(String(nb.validate({ ask: ['Q.'] }, practiceCtx, ASK_MODE).error), /question, books/);
  const pile = practiceCtx.works.filter((w) => !practiceCtx.onShelf(w.id)).map((w) => w.id);
  assert.ok(pile.length > 45, 'the pile is big enough for this test');
  const v = plain(nb.validate({ ask: { question: 'Q.', books: pile.slice(0, 45) } }, practiceCtx, ASK_MODE));
  assert.strictEqual(v.ask.books.length, 40);
  assert.deepStrictEqual(v.dropped.map((d) => [d.id, d.code]), [['5', 'askMany']]);
});

test('A6: the prompt is the question, the numbers and the books offered, and nothing from the shelf', () => {
  const books = practiceCtx.works.filter((w) => !practiceCtx.onShelf(w.id)).slice(0, 12).map((w) => w.id);
  const made = plain(nb.seam.askPrompt({ question: 'Choose something quiet.', books }, practiceCtx.shelf, pool));
  const lines = made.text.split('\n');
  assert.strictEqual(lines[0], 'Choose something quiet.');
  assert.ok(lines.indexOf('What their shelf adds up to (counts only: no titles, no authors):') !== -1);
  assert.strictEqual(lines.filter((l) => /^- [a-z0-9-]+ \| /.test(l)).length, 12, 'one line per book offered');
  assert.strictEqual(lines[lines.length - 1], nb.seam.endAsk);
  // The books offered are the catalogue's own words, and one may share an author with the shelf;
  // everything above them (the question and the shelf's numbers) names nothing from the shelf.
  const above = made.text.slice(0, made.text.indexOf('The books to choose from:'));
  shelfWords(practiceCtx).forEach((w) => {
    assert.strictEqual(above.toLowerCase().indexOf(w.toLowerCase()), -1, 'the prompt names "' + w + '"');
  });
});

test('A7: the answer keeps up to six offered books, each with its sentence', () => {
  const books = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
  const answer = [
    'a1: Quiet and short.', 'A2: Strange in a good way.', 'zz9: Made up.', 'a1: Again.',
    'a3: One.', 'a4: Two.', 'a5: Three.', 'a6: Four.', 'a7: Seven is too many.', 'a8'
  ].join('\n');
  const r = plain(nb.seam.parseAsk(answer, { question: 'Q', books }, '^[a-z0-9-]+$'));
  assert.deepStrictEqual(r.kept.map((k) => k.id), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  assert.strictEqual(r.kept[1].why, 'Strange in a good way.');
  assert.deepStrictEqual(r.dropped.map((d) => d.code), ['unknown', 'repeat', 'third', 'third']);
  assert.match(r.reason, /zz9 is not one of the books offered\./);
  assert.match(r.reason, /a7 is more than the six asked for\./);
  const none = plain(nb.seam.parseAsk('I like all of them!', { question: 'Q', books }, '^[a-z0-9-]+$'));
  assert.deepStrictEqual(none.kept, []);
  assert.match(none.reason, /did not name any of the books offered/);
});

test('A8: the reference ask-chat mode passes its checks', () => {
  const nb2 = load(['app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
    'app/core/contract.js', 'app/core/seam.js', 'reference/modes/ask-chat.js', 'reference/modes/ask-chat.check.js']);
  nb2.data.put('slice', read('data/slice.json'));
  nb2.data.put('tags', read('data/tags.json'));
  nb2.data.put('practice', PRACTICE);
  const r = plain(nb2.runModeChecks('ask-chat'));
  assert.strictEqual(r.fail, 0, r.results.filter((x) => !x.ok).map((x) => x.msg).join('\n'));
  assert.ok(r.results.some((x) => /asks a chat to choose from \d+ books/.test(x.msg)));
});

test('A9: answers the way real chats write them are read', () => {
  const ask = { question: 'Q', books: ['oryx', 'handmaid', 'beloved', 'station-eleven'] };
  const P = '^[a-z0-9-]+$';
  const kept = (text) => plain(nb.seam.parseAsk(text, ask, P)).kept.map((k) => k.id + '=' + k.why);
  assert.deepStrictEqual(kept('oryx (Oryx and Crake): Speculative and dark.'), ['oryx=Speculative and dark.']);
  assert.deepStrictEqual(kept('1. **oryx** (Oryx and Crake): A reason.'), ['oryx=A reason.']);
  assert.deepStrictEqual(kept('- `station-eleven` [Station Eleven] - Hopeful.'), ['station-eleven=Hopeful.']);
  assert.deepStrictEqual(kept('Here are my picks:\n\n**beloved**\nMemory and family.\n\nhandmaid: Tense.'),
    ['beloved=Memory and family.', 'handmaid=Tense.']);
  const table = plain(nb.seam.parseAsk('| id | why |\n|---|---|\n| oryx | Quiet. |\n| beloved | Sad. |', ask, P));
  assert.deepStrictEqual(table.kept.map((k) => k.id), ['oryx', 'beloved']);
  assert.deepStrictEqual(table.dropped, [], 'the header and rule rows are not books');
});

test('A10: part of a shelf name written as a name is refused; plain words are not', () => {
  const free = practiceCtx.works.find((w) => !practiceCtx.onShelf(w.id)).id;
  const err = (q) => nb.validate({ ask: { question: q, books: [free] } }, practiceCtx, ASK_MODE).error;
  assert.match(String(err('Something like Le Guin, please.')), /"guin"/);
  assert.match(String(err('Something like Earthsea.')), /"earthsea"/);
  assert.strictEqual(err('A good book for a quiet night.'), null);
  assert.strictEqual(err('Darkness and light: choose something strange.'), null);
});
