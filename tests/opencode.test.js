'use strict';
// opencode.jsonc: OpenCode v2 allows everything by default and the LAST matching rule wins, so the
// "ask" rules must come before the narrow "allow" rules, and nothing may be set that the file says it
// does not set. (The resolved rules were checked once with `opencode debug agents`, 2026-11-08.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./_load.js');

// Drop whole-line // comments (the file has no URL on a comment-only line, and its one URL is in a string).
const text = fs.readFileSync(path.join(root, 'opencode.jsonc'), 'utf8')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const cfg = JSON.parse(text);

test('O1: the file names its schema, sets no model, and has the ask rules before the allows', () => {
  assert.strictEqual(cfg.$schema, 'https://opencode.ai/config.json');
  assert.ok(!('model' in cfg) && !('small_model' in cfg));
  const rules = cfg.permissions;
  rules.forEach((r) => assert.ok(['allow', 'ask'].includes(r.effect), 'no deny: ' + JSON.stringify(r)));
  ['edit', 'shell', 'external_directory'].forEach((a) => {
    const i = rules.findIndex((r) => r.action === a && r.resource === '*' && r.effect === 'ask');
    assert.ok(i !== -1, a + ' asks');
    rules.forEach((r, j) => { if (r.action === a && r.effect === 'allow') assert.ok(j > i, 'an allow for ' + a + ' comes after its ask'); });
  });
});

test('O2: the allows are the narrow ones, and git push is not among them', () => {
  const allows = cfg.permissions.filter((r) => r.effect === 'allow').map((r) => r.action + ' ' + r.resource);
  assert.deepStrictEqual(allows.sort(), [
    'edit app/PLAN.md', 'edit app/README.md', 'edit app/modes/*',
    'shell bash tools/check.sh *', 'shell git diff*', 'shell git log*', 'shell git status*',
    'shell node --test *', 'shell node tools/check-mode.js *', 'shell python3 tools/build.py*',
    'shell python3 tools/coverage.py*', 'shell python3 tools/serve.py*',
  ].sort());
  assert.ok(!allows.some((a) => /push/.test(a)));
  assert.deepStrictEqual(cfg.watcher.ignore.slice(0, 3), ['dist/**', 'screens/**', 'app/data/**']);
});
