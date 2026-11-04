'use strict';
// T3.3b: "From some words" inside a facets input. The answer is read against the list, only
// subjects that exist are ticked, the invented ones are named, and the mode receives facet
// keys and nothing else. Driven through the fake DOM (tests/fakedom.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./_load.js');
const { createDocument, all, byTest } = require('./fakedom.js');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const SLICE = read('data/slice.json');
const PRACTICE = read('data/practice.json');

const CORE = [
  'app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
  'app/core/links.js', 'app/core/contract.js', 'app/core/seam.js', 'app/core/store.js',
];

function wordsMode() {
  return {
    id: 'words-pick',
    name: 'From an event',
    purpose: 'Chooses books for an event from its subjects.',
    shape: 'list',
    inputs: [{ id: 'subjects', kind: 'facets', label: 'Pick up to four subjects' }],
    strings: {},
    choose(ctx, input) {
      const keys = input.subjects.slice();
      const w = ctx.works.find((x) => keys.some((k) => x.facets.indexOf(k) !== -1)) || ctx.works[0];
      return {
        picks: [{ id: w.id, why: 'It shares a subject with the words.' }],
        note: 'Got: ' + keys.join(' '),
      };
    },
  };
}

function noInputMode() {
  return {
    id: 'plain-pick',
    name: 'From the list',
    purpose: 'Picks a book from the list.',
    shape: 'list',
    inputs: [],
    strings: {},
    choose(ctx) {
      const w = ctx.works.find((x) => !ctx.onShelf(x.id)) || ctx.works[0];
      return { picks: [{ id: w.id, why: 'It is the first book in the list.' }] };
    },
  };
}

function openFind(defs) {
  const doc = createDocument();
  const app = doc.createElement('main');
  app.setAttribute('id', 'app');
  doc.body.appendChild(app);

  const window = {
    console,
    document: doc,
    location: { hash: '#find' },
    addEventListener() {},
    setTimeout() { return 0; },
    clearTimeout() {},
  };
  window.window = window;

  const ctx = vm.createContext(window);
  const run = (rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  CORE.forEach(run);

  const nb = window.Nextbook;
  nb.data.put('slice', SLICE);
  nb.data.put('tags', { schema: 'nextbook/tags-1', vocab: {}, works: {} });
  nb.data.put('practice', PRACTICE);
  defs.forEach((def) => nb.mode(def));
  nb.modes = defs.map((def) => def.id);

  run('app/core/shell.js');
  return { nb, doc, app };
}

function type(doc, testName, value) {
  const box = byTest(doc, testName);
  assert.ok(box, 'the box exists: ' + testName);
  box.value = value;
  box.dispatch('input', { type: 'input', target: box });
  return box;
}

test('T3.3b: paste words, copy the prompt, keep one real subject and name one invented', () => {
  const { nb, doc } = openFind([wordsMode()]);

  // The control belongs to the facets input, and the panel is closed until it is pressed.
  assert.ok(byTest(doc, 'input-subjects-words-toggle'), 'the words control is in the facets input');
  assert.strictEqual(byTest(doc, 'input-subjects-words-text'), null, 'no panel before a press');
  byTest(doc, 'input-subjects-words-toggle').click();
  assert.strictEqual(byTest(doc, 'input-subjects-words-toggle').getAttribute('aria-expanded'), 'true');

  // A pasted event; the app writes the words to copy from the list's own subjects.
  type(doc, 'input-subjects-words-text', 'A talk about fantasy, maps and the sea monsters in old charts.');
  const prompt = byTest(doc, 'input-subjects-words-prompt');
  assert.ok(prompt, 'the prompt is written');
  const promptText = prompt.value || prompt.textContent;
  assert.ok(promptText.indexOf('the sea monsters in old charts') !== -1, 'the pasted text is in it');
  assert.ok(promptText.indexOf('Pick up to four subjects') !== -1, 'it asks for subjects');
  assert.ok(!byTest(doc, 'input-subjects-words-copy').disabled, 'Copy is ready once there are words');

  // The answer names one subject in the list and one it invented.
  type(doc, 'input-subjects-words-answer', 'fantasy\nsea monsters');
  byTest(doc, 'input-subjects-words-check').click();

  const ticks = all(doc, '[data-test]').filter((el) =>
    (el.getAttribute('data-test') || '').indexOf('input-subjects-facet-') === 0 && el.checked);
  assert.strictEqual(ticks.length, 1, 'exactly one subject is ticked');
  assert.ok(ticks[0].parentNode.textContent.indexOf('fantasy') !== -1, 'and it is fantasy');
  assert.ok(byTest(doc, 'input-subjects-words-result').textContent.indexOf('Ticked: fantasy.') !== -1);
  const dropped = byTest(doc, 'input-subjects-words-dropped');
  assert.ok(dropped, 'the invented subject is named');
  assert.ok(dropped.textContent.indexOf('sea monsters') !== -1);
  assert.ok(dropped.textContent.indexOf('has no subject called') !== -1);

  // The mode got facet keys, never the chat's words.
  const note = byTest(doc, 'find-note');
  assert.ok(note, 'the mode ran');
  assert.ok(note.textContent.indexOf('genre:fantasy') !== -1, 'the mode got the key');
  assert.strictEqual(note.textContent.indexOf('sea monsters'), -1, 'and never the invented words');
  assert.ok(byTest(doc, 'find-result'), 'the result is drawn from the ticked subject');
});

test('T3.3b: an answer with no subject in this list ticks nothing and says so', () => {
  const { doc } = openFind([wordsMode()]);
  byTest(doc, 'input-subjects-words-toggle').click();
  type(doc, 'input-subjects-words-answer', 'sea monsters\ndragons');
  byTest(doc, 'input-subjects-words-check').click();

  assert.ok(byTest(doc, 'input-subjects-words-result').textContent.indexOf(
    'did not name any subject in this list') !== -1);
  const dropped = byTest(doc, 'input-subjects-words-dropped').textContent;
  assert.ok(dropped.indexOf('sea monsters') !== -1 && dropped.indexOf('dragons') !== -1);
  assert.ok(!byTest(doc, 'find-result'), 'nothing is chosen from words the list does not have');
});

test('T3.3b: an empty answer asks for one before reading it', () => {
  const { doc } = openFind([wordsMode()]);
  byTest(doc, 'input-subjects-words-toggle').click();
  byTest(doc, 'input-subjects-words-check').click();
  assert.ok(byTest(doc, 'input-subjects-words-said').textContent.indexOf('Paste the answer first.') !== -1);
  assert.strictEqual(byTest(doc, 'input-subjects-words-result'), null, 'no result is invented');
});

test('T3.3b: a mode with no facets input never draws the words control', () => {
  const { doc } = openFind([noInputMode()]);
  assert.strictEqual(byTest(doc, 'input-subjects-words-toggle'), null);
  assert.strictEqual(byTest(doc, 'input-subjects-words-text'), null);
});
