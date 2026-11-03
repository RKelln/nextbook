'use strict';
// Ported from searchdesk/tests/unit/_load.js (MIT, same author).
// Loads classic app scripts into a vm context with a fake window; returns window.Nextbook.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

function load(relPaths, extras) {
  const list = Array.isArray(relPaths) ? relPaths : [relPaths];
  const window = Object.assign({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: require('crypto').webcrypto,
  }, extras || {});
  window.window = window;
  const ctx = vm.createContext(window);
  for (const rel of list) {
    const file = path.join(root, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  return window.Nextbook;
}

module.exports = { load, root };
