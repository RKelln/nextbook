// Ported from searchdesk/core/h.js (MIT, same author).
// Ported from searchdesk/core/strings.js (MIT, same author).
'use strict';
// The namespace every other file attaches to: the strings table, the safe element
// builder, the data registry and the workshop flag. Nothing here touches the network.
(function (window) {
  var Nextbook = window.Nextbook || {};
  window.Nextbook = Nextbook;

  Nextbook.version = Nextbook.version || '0.1.0';

  // ---- Strings ------------------------------------------------------------------------------
  // Every user-facing word lives here. Grade 6: short sentences, no jargon, no claim that the
  // app knows or recommends anything.
  Nextbook.strings = Nextbook.strings || {
    appName: 'nextbook',
    shelfLoaded: 'The book list is loaded.',
    missingData: 'The book list did not load. The rest of the app still works.',
    missingMode: 'A way of choosing books did not load. The rest of the app still works.',
    modesLoaded: 'Ways to choose: ',
    noModes: 'No ways of choosing books are loaded yet.',
    notSaving: 'This browser is not saving. Export before you close it.',
    libraryPage: "the library's page",
    libraryLine: "Holds, copies, your library shelves and the library's own suggestions are on the library's page.",
    practiceBanner: 'Practice shelf. Try anything. Reset puts it back.',
    practiceOnly: 'On this computer, use the practice shelf. Your own books go in at home, on your own computer.',
    booksFound: 'Your helper found {n} books for "{words}"',
    booksFoundOne: 'Your helper found 1 book for "{words}"',
    bookCount: '{n} books',
    bookCountOne: '1 book'
  };

  var has = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };

  // Replace {name} with vars.name in one pass. A name with no value stays as written, so a
  // missing variable shows up as itself rather than as "undefined".
  function fill(s, vars) {
    if (!vars) return s;
    return s.replace(/\{([A-Za-z0-9_]+)\}/g, function (m, k) {
      return has(vars, k) && vars[k] !== null && vars[k] !== undefined ? String(vars[k]) : m;
    });
  }

  // t(key, vars): the core table; if the key is missing, the key itself is shown, which is
  // dull but never blanks a screen and never throws.
  function t(key, vars) {
    var s = has(Nextbook.strings, key) && typeof Nextbook.strings[key] === 'string'
      ? Nextbook.strings[key] : String(key);
    return fill(s, vars);
  }
  Nextbook.t = t;

  // ---- The safe element builder -------------------------------------------------------------
  // h(tag, attrs, ...children). Strings and numbers become text nodes; there is no way to pass
  // markup (AGENTS.md, "Safe by construction").
  var BAD_TAGS = /^(script|style|iframe|frame|frameset|object|embed|link|meta|base|template|noscript)$/i;
  var BAD_ATTRS = /^(style|srcdoc|innerhtml|outerhtml|html|textcontent|innertext|is)$/i;
  var LINK_OK = /^(https?:|mailto:)/i;
  var TEL_OK = /^tel:\+?[0-9][0-9\-(). ]{0,30}$/i; // phone numbers only
  var IMG_OK = /^data:image\/(png|jpeg|gif|webp);/i;
  var ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;

  // Only http:, https:, mailto: and tel: (digits only) survive. Whitespace and control
  // characters are stripped first, because browsers ignore them inside a scheme
  // ("java\tscript:" is javascript: to a browser).
  function safeHref(v) {
    if (v === null || v === undefined) return null;
    var raw = String(v);
    var s = raw.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
    if (TEL_OK.test(raw.trim())) return raw.trim();
    return LINK_OK.test(s) ? raw.trim() : null;
  }

  function addChildren(el, list, doc) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c === null || c === undefined || c === false || c === true) continue;
      if (Array.isArray(c)) { addChildren(el, c, doc); continue; }
      if (typeof c === 'string' || typeof c === 'number') { el.appendChild(doc.createTextNode(String(c))); continue; }
      if (typeof c === 'object' && typeof c.nodeType === 'number') { el.appendChild(c); continue; }
      el.appendChild(doc.createTextNode(String(c)));
    }
  }

  function h(tag, attrs) {
    var doc = window.document;
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('h(): there is no document to build in');
    }
    if (typeof tag !== 'string' || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag) || BAD_TAGS.test(tag)) {
      throw new Error('h(): this tag is not allowed: ' + tag);
    }
    var el = doc.createElement(tag);
    var tagLower = tag.toLowerCase();
    var selectValue; // a value waiting for a select's options to exist (see below)
    var children = Array.prototype.slice.call(arguments, 2);

    // A non-plain second argument (string, number, node, array) is a child, so h('p', 'text')
    // works and no one has to write h('p', null, 'text').
    if (attrs !== null && attrs !== undefined &&
        (typeof attrs !== 'object' || Array.isArray(attrs) || typeof attrs.nodeType === 'number')) {
      children.unshift(attrs);
      attrs = null;
    }

    if (attrs) {
      // An attribute name is case-insensitive to a browser, so HREF, Href and HrEf are the
      // same attribute. Every rule below reads the lower-cased name and sets that name, so a
      // differently-cased spelling cannot slip past a safety check.
      var hasHrefAttr = Object.keys(attrs).some(function (k) { return k.toLowerCase() === 'href'; });

      Object.keys(attrs).forEach(function (name) {
        var v = attrs[name];
        if (v === null || v === undefined || v === false) return;
        var key = name.toLowerCase();

        // Text, never markup: a text node is appended as a child instead.
        if (key === 'text') { children.unshift(String(v)); return; }

        // Listeners only ever go through addEventListener. No attribute named "on..." is set.
        if (key === 'on') {
          if (typeof v !== 'object' || Array.isArray(v)) return;
          Object.keys(v).forEach(function (ev) {
            if (typeof v[ev] === 'function') el.addEventListener(ev, v[ev]);
          });
          return;
        }
        if (/^on/.test(key)) {
          if (typeof v === 'function') el.addEventListener(key.slice(2), v);
          return;
        }

        if (BAD_ATTRS.test(key)) return;
        if (typeof v === 'function' || typeof v === 'object') return;

        // A select's value is a property, not an attribute. <select value="big"> is not a
        // thing: every browser ignores it and shows the first option, so a control built to
        // show a saved choice would quietly disagree with it. Hold it until the options are
        // in, or there is nothing to select.
        if (key === 'value' && tagLower === 'select') { selectValue = String(v); return; }

        if (key === 'href') {
          var href = safeHref(v);
          if (href === null) return; // a javascript: URL never becomes an href
          // Only a link has an href: on any other tag it is a load the page did not ask
          // for (an svg use would fetch someone else's file), so it is dropped.
          if (tagLower !== 'a') return;
          el.setAttribute('href', href);
          el.setAttribute('rel', 'noopener noreferrer');
          el.setAttribute('target', '_blank');
          return;
        }
        if (key === 'rel' || key === 'target') {
          if (hasHrefAttr) return; // set by the link rule above
        }

        // No network and no scripts: only inline images pass as a src.
        if (/^(src|action|formaction|srcset|poster|data|xlink:href|ping|background)$/.test(key)) {
          if (key === 'src' && IMG_OK.test(String(v))) el.setAttribute('src', String(v));
          return;
        }

        if (!ATTR_NAME.test(key)) return;
        el.setAttribute(key, v === true ? '' : String(v));
      });
    }

    addChildren(el, children, doc);

    if (selectValue !== undefined) {
      el.value = selectValue;
      // Nothing matched, which happens when a saved value has gone stale. Go back to the first
      // option rather than showing a blank control: the rest of the app treats an unrecognised
      // value as the default, not as nothing.
      if (el.value !== selectValue && el.options && el.options.length) el.selectedIndex = 0;
    }
    return el;
  }
  h.safeHref = safeHref;
  Nextbook.h = h;

  // ---- norm ---------------------------------------------------------------------------------
  // One spelling for comparing titles, authors and facet labels: lower case, no accents, no
  // punctuation, single spaces, and no leading the/a/an. "The Dispossessed" and "dispossessed "
  // are the same book; "Le Guin, Ursula K." and "Ursula K Le Guin" are not (commas are dropped,
  // not reordered), which is why authors keep their own key elsewhere.
  var MARKS = /[\u0300-\u036f]/g; // combining accents left by NFD
  var APOSTROPHES = /['\u2018\u2019\u02bc`]/g; // don't -> dont, not don t
  var NOT_WORD = /[^\p{L}\p{N}]+/gu;
  var LEADING_ARTICLE = /^(the|a|an) /;

  function norm(text) {
    if (text === null || text === undefined) return '';
    var s = String(text);
    if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(MARKS, '');
    s = s.toLowerCase().replace(APOSTROPHES, '');
    s = s.replace(NOT_WORD, ' ').trim();
    s = s.replace(LEADING_ARTICLE, '');
    return s;
  }
  Nextbook.norm = norm;

  // ---- The data registry --------------------------------------------------------------------
  // app/data/<name>.js calls put(); a packed build puts the same object in
  // <script type="application/json" id="nb-<name>">. get() returns null when a file is missing
  // or a block is broken, so a caller never has to catch and the page can say a plain sentence.
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
      var doc = window.document;
      var el = doc && typeof doc.getElementById === 'function' ? doc.getElementById('nb-' + key) : null;
      if (el && el.textContent) return JSON.parse(el.textContent);
    } catch (e) { /* a broken block is the same as no block */ }
    return null;
  };

  // In a workshop copy app/data/workshop.js sets this flag, and the practice shelf becomes the
  // only shelf. The flag is a plain true or an object carrying "workshop": true; anything else
  // (no file, false, 0, a string) is an ordinary copy, because only a real yes turns this on.
  Nextbook.workshop = function () {
    var flag = Nextbook.data.get('workshop');
    if (flag === true) return true;
    if (flag !== null && typeof flag === 'object' && !Array.isArray(flag) && flag.workshop === true) return true;
    return false;
  };

  // ---- Modes --------------------------------------------------------------------------------
  // `Nextbook.modes` is the manifest: app/modes/list.js sets it to the ids the app shows, and it
  // is the only place the app learns about modes (CONTRACT.md 2). A mode file registers its
  // object with Nextbook.mode({id, name, ...}); registering never edits the list, so a mode file
  // can be loaded by a check with no page.
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
