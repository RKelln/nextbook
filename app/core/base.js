'use strict';
// The namespace every other file attaches to: the strings table, the safe element
// builder, and the data registry. Nothing here touches the network.
(function (window) {
  var Nextbook = window.Nextbook || {};
  window.Nextbook = Nextbook;

  Nextbook.version = '0.1.0';

  // Every user-facing word lives here. Grade 6: short sentences, no jargon.
  Nextbook.strings = Nextbook.strings || {
    appName: 'nextbook',
    shelfLoaded: 'The book list is loaded.',
    missingData: 'The book list did not load. The rest of the app still works.',
    missingMode: 'A way of choosing books did not load. The rest of the app still works.',
    modesLoaded: 'Ways to choose: ',
    noModes: 'No ways of choosing books are loaded yet.'
  };

  // Build an element from text, never from markup. See AGENTS.md
  // "Safe by construction": every element is made here, from text nodes.
  function h(tag, attrs, children) {
    var el = window.document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = String(v);
      else if (k === 'class') el.className = String(v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, String(v));
    });
    [].concat(children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? window.document.createTextNode(c) : c);
    });
    return el;
  }
  Nextbook.h = h;

  // The data registry. app/data/<name>.js calls put(); a packed build puts the same
  // object in <script type="application/json" id="nb-<name>">. get() returns null
  // when a file is missing or a block is broken, so a caller never has to catch.
  var store = Object.create(null);
  Nextbook.data = Nextbook.data || {};
  Nextbook.data.put = function (name, value) {
    store[String(name)] = value;
    return value;
  };
  Nextbook.data.get = function (name) {
    var key = String(name);
    if (key in store) return store[key];
    try {
      var el = window.document.getElementById('nb-' + key);
      if (el && el.textContent) return JSON.parse(el.textContent);
    } catch (e) { /* a broken block is the same as no block */ }
    return null;
  };

  // Modes. `Nextbook.modes` is the manifest: app/modes/list.js sets it to the ids the
  // app shows, and it is the only place the app learns about modes (CONTRACT.md 2).
  // A mode file registers its object with Nextbook.mode({id, name, ...}); registering
  // never edits the list, so a mode file can be loaded by a check with no page.
  Nextbook.modes = Nextbook.modes || [];
  Nextbook.modeDefs = Nextbook.modeDefs || {};
  Nextbook.mode = function (def) {
    var key = def && typeof def.id === 'string' ? def.id : '';
    if (!key) {
      try { window.console.warn('nextbook: a mode was registered with no id, so it is skipped.'); } catch (e) { /* no console */ }
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(Nextbook.modeDefs, key)) {
      try { window.console.warn('nextbook: "' + key + '" was registered twice; the second one is used.'); } catch (e) { /* no console */ }
    }
    Nextbook.modeDefs[key] = def;
    return def;
  };

  // A missing mode is said out loud, once, and the app keeps going.
  Nextbook.missingIds = Nextbook.missingIds || [];
  Nextbook.missing = function (id) {
    var key = String(id);
    if (Nextbook.missingIds.indexOf(key) === -1) Nextbook.missingIds.push(key);
    try { window.console.warn('nextbook: "' + key + '" did not load, so it is skipped.'); } catch (e) { /* no console */ }
  };
})(window);
