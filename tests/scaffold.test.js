'use strict';
// T0.1: the scaffold loads. Every core stub and the one mode file, in the same order
// app/index.html uses them, and the namespace they share behaves. Objects come from a
// vm realm, so compare after a JSON round trip (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_load.js');

const ORDER = [
  'app/core/base.js',
  'app/core/slice.js',
  'app/core/score.js',
  'app/core/reason.js',
  'app/core/links.js',
  'app/core/contract.js',
  'app/core/seam.js',
  'app/core/store.js',
  'app/modes/list.js',
  'app/core/shell.js',
];

const plain = (value) => JSON.parse(JSON.stringify(value));

test('the scaffold loads and the Nextbook namespace works', () => {
  const nb = load(ORDER); // throws if any stub fails to parse or throws at load

  assert.ok(nb, 'window.Nextbook should exist');
  assert.strictEqual(typeof nb.h, 'function');
  assert.strictEqual(typeof nb.data.put, 'function');
  assert.strictEqual(typeof nb.data.get, 'function');

  // No app/data/*.js in the scaffold: a missing slice reads as null, not an exception.
  assert.strictEqual(nb.data.get('slice'), null);
  assert.strictEqual(nb.data.get('no-such-data-file'), null);

  nb.data.put('slice', { books: [{ id: 'b1' }] });
  assert.deepStrictEqual(plain(nb.data.get('slice')), { books: [{ id: 'b1' }] });

  // modes/list.js is the manifest, and nothing else: an array of mode ids, each one
  // usable as a file name (lower case letters and hyphens, CONTRACT.md section 2).
  const modes = plain(nb.modes);
  assert.ok(Array.isArray(modes), 'Nextbook.modes should be an array');
  for (const id of modes) {
    assert.ok(typeof id === 'string' && /^[a-z]+(-[a-z]+)*$/.test(id),
      'manifest entry should be a usable mode id, got ' + JSON.stringify(id));
  }
  assert.deepStrictEqual(plain(nb.modeDefs), {});

  // A mode registers one object; registering never edits the manifest.
  nb.mode({ id: 'demo', choose: function () { return { picks: [] }; } });
  assert.ok(!plain(nb.modes).includes('demo'), 'registering a mode must not add it to the manifest');
  assert.strictEqual(nb.modeDefs.demo.id, 'demo');
  assert.strictEqual(typeof nb.modeDefs.demo.choose, 'function');

  // A repeat id is replaced, and an id-less registration is skipped rather than thrown.
  nb.mode({ id: 'demo', name: 'second' });
  assert.strictEqual(nb.modeDefs.demo.name, 'second');
  assert.strictEqual(nb.mode({}), null);
  assert.strictEqual(typeof nb.shell.boot, 'function');
});
