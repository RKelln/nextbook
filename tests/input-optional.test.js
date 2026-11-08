'use strict';
// D37: an input may be optional, and the page passes null for one left blank.
//
// The maintainer found this by using the app as a participant would: a facet dropdown draws an empty
// "Pick one", `inputsFor()` treated an empty value as missing, and the contract said choose
// is not called until every input has a value. So every input was required, and a mode could
// not offer "any subject". These tests drive the page through the fake DOM (tests/fakedom.js)
// and check three states that must stay apart: asked and left blank (null), a chosen value,
// and never asked (missing).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./_load.js');
const { createDocument, byTest } = require('./fakedom.js');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const SLICE = read('data/slice.json');
const PRACTICE = read('data/practice.json');

const CORE = [
  'app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
  'app/core/links.js', 'app/core/contract.js', 'app/core/seam.js', 'app/core/store.js',
];

// What the mode's choose received, read in the host after the page has run it.
let seen = null;

// A mode that picks one book, filtered by the subject it is given, or by no subject at all.
// It is the mode from the maintainer's bug: the hasSubject() branch that treats null as "no filter".
function subjectMode(id, spec) {
  return {
    id: id,
    name: 'Only this subject',
    purpose: 'Picks a book about one subject, or about any subject.',
    shape: 'list',
    inputs: [spec],
    strings: { none: 'Nothing in the list fits today.' },
    choose(ctx, input) {
      seen = Object.prototype.hasOwnProperty.call(input, 'subject')
        ? { has: true, value: input.subject } : { has: false, value: undefined };
      const wanted = input.subject;
      const pool = wanted ? ctx.works.filter((w) => w.facets.indexOf(wanted) !== -1) : ctx.works;
      const w = pool.find((x) => !ctx.onShelf(x.id));
      if (!w) return { picks: [], note: ctx.t('none') };
      return {
        picks: [{ id: w.id, why: 'It fits ' + (wanted ? 'the subject you picked' : 'any subject') + ' from the list.' }],
      };
    },
  };
}

function eventMode(id, spec) {
  return {
    id: id,
    name: 'For an event',
    purpose: 'Picks a book for a library event.',
    shape: 'list',
    inputs: [spec],
    strings: { none: 'Nothing in the list fits today.' },
    choose(ctx, input) {
      seen = { has: Object.prototype.hasOwnProperty.call(input, 'event'), value: input.event };
      const w = ctx.works.find((x) => !ctx.onShelf(x.id));
      if (!w) return { picks: [], note: ctx.t('none') };
      const title = input.event && input.event.title ? input.event.title : 'no event';
      return { picks: [{ id: w.id, why: 'It was picked for ' + title + ' at the library.' }] };
    },
  };
}

function openFind(defs, events) {
  seen = null;
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
  if (events) nb.data.put('events', events);
  defs.forEach((def) => nb.mode(def));
  nb.modes = defs.map((def) => def.id);

  run('app/core/shell.js');
  return { nb, doc, app };
}

const optionWords = (select) => select.options.map((o) => o.textContent);

test('an optional input left blank calls choose with null, and the page shows the books', () => {
  const { doc } = openFind([subjectMode('any-subject', { id: 'subject', kind: 'facet', label: 'A subject', optional: true })]);

  const select = byTest(doc, 'input-subject');
  assert.ok(select, 'the dropdown is drawn');
  assert.strictEqual(optionWords(select)[0], 'Any subject', 'its empty option reads the default for a subject');

  assert.ok(byTest(doc, 'find-result'), 'the mode ran without the person picking anything');
  assert.strictEqual(byTest(doc, 'find-needs-input'), null, 'nothing is asked for');
  assert.deepStrictEqual(seen, { has: true, value: null }, 'choose received the key, holding null');
});

test('a chosen subject reaches choose, and clearing it goes back to null', () => {
  const { doc } = openFind([subjectMode('any-subject', { id: 'subject', kind: 'facet', label: 'A subject', optional: true })]);

  const key = byTest(doc, 'input-subject').options[1].getAttribute('value');
  let select = byTest(doc, 'input-subject');
  select.value = key;
  select.dispatch('change', { type: 'change', target: select });
  assert.deepStrictEqual(seen, { has: true, value: key }, 'the chosen key');
  assert.ok(byTest(doc, 'find-result'), 'and the result moves with it');

  select = byTest(doc, 'input-subject');
  select.value = '';
  select.dispatch('change', { type: 'change', target: select });
  assert.deepStrictEqual(seen, { has: true, value: null }, 'cleared is null, not missing');
  assert.ok(byTest(doc, 'find-result'), 'and the page still shows books');
});

test('a required input left empty still blocks, with the same sentence as before', () => {
  const { doc } = openFind([subjectMode('needs-subject', { id: 'subject', kind: 'facet', label: 'A subject' })]);

  assert.strictEqual(byTest(doc, 'find-result'), null, 'nothing is chosen');
  const needed = byTest(doc, 'find-needs-input');
  assert.ok(needed, 'the page asks for it');
  assert.strictEqual(needed.textContent, 'Pick something for "A subject" first.');
  assert.strictEqual(seen, null, 'choose was not called');
  assert.strictEqual(optionWords(byTest(doc, 'input-subject'))[0], 'Pick one', 'and the empty option is the generic one');
});

test('an input the page never offered is missing, optional or not', () => {
  // No event snapshot: the control cannot be drawn, so nobody was asked. The contract already
  // says choose is not called then, and an optional input does not change that.
  const optional = openFind([eventMode('event-optional', { id: 'event', kind: 'event', label: 'Which event', optional: true })]);
  assert.strictEqual(byTest(optional.doc, 'find-result'), null, 'an optional event input blocks too');
  assert.ok(byTest(optional.doc, 'find-needs-input'), 'the page says what it needs');
  assert.strictEqual(seen, null, 'choose was not called');

  const required = openFind([eventMode('event-required', { id: 'event', kind: 'event', label: 'Which event' })]);
  assert.strictEqual(byTest(required.doc, 'find-result'), null, 'and a required one blocks as before');
  assert.ok(byTest(required.doc, 'find-needs-input'));
  assert.strictEqual(seen, null);
});

test('the empty option says the optional input\'s words, and the required one keeps the generic prompt', () => {
  const mode = subjectMode('both-kinds', {
    id: 'subject', kind: 'facet', label: 'A subject', optional: true, any: 'No particular subject',
  });
  mode.inputs.push({ id: 'other', kind: 'facet', label: 'Another subject' });
  const { doc } = openFind([mode]);

  assert.strictEqual(optionWords(byTest(doc, 'input-subject'))[0], 'No particular subject',
    "the optional dropdown reads the input's own words");
  assert.strictEqual(optionWords(byTest(doc, 'input-other'))[0], 'Pick one',
    'the required dropdown does not');
});

test('an optional text input says how to leave it empty, and a required one does not', () => {
  const optional = openFind([subjectMode('any-words', { id: 'subject', kind: 'text', label: 'Some words', optional: true })]);
  const hint = byTest(optional.doc, 'input-subject-any');
  assert.ok(hint, 'the hint is drawn');
  assert.strictEqual(hint.textContent, 'Leave this empty for "Anything".');

  const required = openFind([subjectMode('needs-words', { id: 'subject', kind: 'text', label: 'Some words' })]);
  assert.strictEqual(byTest(required.doc, 'input-subject-any'), null, 'a required text input says nothing');
  assert.ok(byTest(required.doc, 'find-needs-input'), 'and it still blocks');
});
