// Ported from searchdesk/core/contract.js (MIT, same author).
'use strict';
// The mode contract, docs/CONTRACT.md: the words a mode may not use, the check API,
// the result check, `ctx`, the seven standard shelves (plus one run per optional input with
// that input empty) and runModeChecks. Pure: no page, no clock, no network. The app and
// tools/check-mode.js both call this file.
//
//   Nextbook.check(id, fn)             a check file registers fn(t, mode)
//   Nextbook.runCheck(fn, mode)        -> { pass, fail, results: [{ ok, msg }] }
//   Nextbook.contract.scan(source)     -> [{ word, line, message }]  (comments and strings left out)
//   Nextbook.contract.scanFeature(def) -> [{ word, line, where, message }]
//   Nextbook.validate(result, ctx, def) -> { picks, dropped: [{ id, why, code }], error }
//   Nextbook.makeCtx({ pool, shelf, others, events, seed, def })  -> the ctx a mode talks to
//   Nextbook.standardShelves(pool, practice) -> the seven shelves
//   Nextbook.runModeChecks(id, { pool, practice, mode, check, events }) -> { pass, fail, results, ... }
//
// Nextbook.mode(def) lives in core/base.js, which loads first: registering a mode never
// touches Nextbook.modes, the manifest that app/modes/list.js writes.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};

  var has = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  function str(v) { return v === null || v === undefined ? '' : String(v); }

  // A deep copy of plain data (works, entries): strings, numbers, arrays and plain objects.
  // ctx gets its own copy, so a mode that edits a work cannot change the pool, and one shelf
  // cannot change the next.
  function deepCopy(v) {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(deepCopy);
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = deepCopy(v[k]); });
    return out;
  }

  // User-facing words this file needs. They join the one table in core/base.js rather than
  // living in a second place; an app string of the same name wins.
  Nextbook.strings = Nextbook.strings || {};
  if (!has(Nextbook.strings, 'foundNothing')) {
    Nextbook.strings.foundNothing = 'This way of choosing books found nothing and did not say why.';
  }
  if (!has(Nextbook.strings, 'noList')) {
    Nextbook.strings.noList = 'The book list did not load, so the checks did not run.';
  }

  function fill(s, vars) {
    if (!vars) return String(s);
    return String(s).replace(/\{([A-Za-z0-9_]+)\}/g, function (m, k) {
      return has(vars, k) && vars[k] !== null && vars[k] !== undefined ? String(vars[k]) : m;
    });
  }

  // ---- The words a mode may not use ---------------------------------------------------------
  // One table: what is shown, how it is found, and what to write instead. A whole identifier
  // must match, so `evaluate` is not `eval` and `prefetch` is not `fetch`; `x.fetch(` still is.
  var BEFORE = '(^|[^A-Za-z0-9_$])';
  var AFTER = '(?![A-Za-z0-9_$])';
  var NO_NET = 'A mode does not use the network. Take the books from ctx.works.';
  var NO_PAGE = 'A mode does not touch the page. Return picks and the app draws the cards.';
  var NO_CODE = 'A mode does not build code. Write a plain function in logic.';
  var NO_CLOCK = 'A mode has no clock. Use the list and the shelf as they are.';
  var NO_TIMER = 'A mode is one quick function. The app runs it again when the shelf changes.';

  var BANNED = [
    { word: 'fetch(', core: BEFORE + 'fetch\\s*\\(', advice: NO_NET },
    { word: 'document.', core: BEFORE + 'document\\s*\\.', advice: NO_PAGE },
    { word: 'window.', core: BEFORE + 'window\\s*\\.', advice: NO_PAGE },
    { word: 'localStorage', core: BEFORE + 'localStorage' + AFTER,
      advice: 'A mode saves nothing. The app keeps the shelf and the mode inputs.' },
    { word: 'Math.random(', core: BEFORE + 'Math\\s*\\.\\s*random\\s*\\(',
      advice: 'Use ctx.random(), so the same shelf gives the same six.' },
    { word: 'new Date', core: BEFORE + 'new\\s+Date' + AFTER, advice: NO_CLOCK },
    { word: 'Date.now(', core: BEFORE + 'Date\\s*\\.\\s*now\\s*\\(', advice: NO_CLOCK },
    { word: 'setTimeout(', core: BEFORE + 'setTimeout\\s*\\(', advice: NO_TIMER },
    { word: 'setInterval(', core: BEFORE + 'setInterval\\s*\\(', advice: NO_TIMER },
    { word: 'innerHTML', core: BEFORE + 'innerHTML' + AFTER,
      advice: 'A mode does not write markup. Return picks and the app draws them.' },
    { word: 'outerHTML', core: BEFORE + 'outerHTML' + AFTER,
      advice: 'A mode does not write markup. Return picks and the app draws them.' },
    { word: 'insertAdjacentHTML', core: BEFORE + 'insertAdjacentHTML' + AFTER,
      advice: 'A mode does not write markup. Return picks and the app draws them.' },
    { word: 'eval(', core: BEFORE + 'eval\\s*\\(', advice: NO_CODE },
    { word: 'new Function', core: BEFORE + 'new\\s+Function' + AFTER, advice: NO_CODE },
    { word: 'XMLHttpRequest', core: BEFORE + 'XMLHttpRequest' + AFTER, advice: NO_NET },
    { word: 'Nextbook.net', core: BEFORE + 'Nextbook\\s*\\.\\s*net' + AFTER,
      advice: 'A mode has no network and cannot change the app\'s choices. Take the events from ctx.events.' },
    { word: 'Nextbook.travel', core: BEFORE + 'Nextbook\\s*\\.\\s*travel' + AFTER,
      advice: 'A person\'s travel times are theirs, not a mode\'s. A mode cannot read them.' },
    { word: 'globalThis', core: BEFORE + 'globalThis' + AFTER, advice: NO_PAGE },
    { word: 'self', core: '(^|[^A-Za-z0-9_$.])self' + AFTER, advice: NO_PAGE },
    { word: 'navigator', core: BEFORE + 'navigator' + AFTER, advice: NO_NET },
    { word: 'Image', core: BEFORE + 'Image' + AFTER, advice: NO_NET },
    { word: 'sendBeacon', core: BEFORE + 'sendBeacon' + AFTER, advice: NO_NET },
    { word: 'import(', core: '(^|[^A-Za-z0-9_$.])import\\s*\\(',
      advice: 'A mode is one file. Use ctx and the functions the app already loads.' }
  ];

  var PLACEHOLDER = '\u0000'; // stands in for a stripped character: positions and lines survive

  // Remove comments AND the contents of quoted strings, keeping line breaks so the line
  // numbers still point at the real file. A sentence like "The library could not fetch this."
  // is not code, so it is fine. Building a word from pieces (window['ev' + 'al']) is not
  // caught: this is a safety net, not a wall.
  function strip(src) {
    var text = String(src === null || src === undefined ? '' : src);
    var out = '', i = 0, n = text.length, last = '';
    while (i < n) {
      var c = text.charAt(i), d = text.charAt(i + 1);
      if (c === '/' && d === '/') {
        while (i < n && text.charAt(i) !== '\n') { out += ' '; i++; }
        continue;
      }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(text.charAt(i) === '*' && text.charAt(i + 1) === '/')) {
          out += text.charAt(i) === '\n' ? '\n' : ' ';
          i++;
        }
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        var q = c;
        out += q; i++;
        while (i < n && text.charAt(i) !== q) {
          if (q !== '`' && text.charAt(i) === '\n') break;   // an unterminated quote stops at the line end
          if (text.charAt(i) === '\\') {
            out += PLACEHOLDER; i++;
            if (i < n) { out += text.charAt(i) === '\n' ? '\n' : PLACEHOLDER; i++; }
            continue;
          }
          out += text.charAt(i) === '\n' ? '\n' : PLACEHOLDER;
          i++;
        }
        if (i < n) { out += q; i++; }
        last = q;
        continue;
      }
      // A regular expression literal, roughly: / after a place a value cannot end.
      if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(last) >= 0)) {
        out += c; i++;
        var inClass = false;
        while (i < n && text.charAt(i) !== '\n' && (inClass || text.charAt(i) !== '/')) {
          var e = text.charAt(i);
          if (e === '\\') {
            out += e; i++;
            e = text.charAt(i);
          } else if (e === '[') inClass = true;
          else if (e === ']') inClass = false;
          out += e; i++;
        }
        if (i < n) { out += '/'; i++; }
        last = '/';
        continue;
      }
      out += c; i++;
      if (!/\s/.test(c)) last = c;
    }
    return out;
  }

  function lineOf(text, at) {
    var n = 1;
    for (var i = 0; i < at && i < text.length; i++) if (text.charAt(i) === '\n') n++;
    return n;
  }

  function messageFor(finding) {
    // scan() reads a whole file, so its number is a file line. scanFeature() reads one
    // function, so its number is a count inside that function: say "inside choose", never
    // "on line 5", or a beginner opens line 5 of the file and lands in the metadata.
    var at = finding && finding.where
      ? ' is inside ' + finding.where + ', ' + finding.line + ' lines in.'
      : ' is on line ' + finding.line + '.';
    return '"' + finding.word + '"' + at + ' ' + finding.advice;
  }

  // scan(source) -> [{ word, line, advice, message }], in line order.
  function scan(source) {
    var s = strip(source), found = [];
    BANNED.forEach(function (b) {
      var re = new RegExp(b.core, 'g'), m;
      while ((m = re.exec(s))) {
        var at = m.index + (m[1] ? m[1].length : 0);
        found.push({ word: b.word, line: lineOf(s, at), advice: b.advice, message: messageFor({ word: b.word, line: lineOf(s, at), advice: b.advice }) });
        if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
      }
    });
    return found.sort(function (a, b) {
      return (a.line - b.line) || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0);
    });
  }

  // Every function of a mode: choose, the other top-level functions, and logic.*.
  function scanFeature(def) {
    var out = [];
    function one(where, fn) {
      if (typeof fn !== 'function') return;
      scan(fn).forEach(function (f) {
        out.push({ word: f.word, line: f.line, where: where, advice: f.advice,
          message: messageFor({ word: f.word, line: f.line, where: where, advice: f.advice }) });
      });
    }
    if (!def || typeof def !== 'object') return out;
    Object.keys(def).forEach(function (k) { if (k !== 'logic') one(k, def[k]); });
    if (def.logic && typeof def.logic === 'object') {
      Object.keys(def.logic).forEach(function (k) { one('logic.' + k, def.logic[k]); });
    }
    return out;
  }

  // ---- The check API ------------------------------------------------------------------------
  function same(a, b) { // deep equality for plain data
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return a !== a && b !== b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) {
      return has(b, k) && same(a[k], b[k]);
    });
  }
  function show(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }

  function runCheck(fn, mode) {
    var r = { pass: 0, fail: 0, results: [] };
    function add(ok, msg) { r[ok ? 'pass' : 'fail']++; r.results.push({ ok: ok, msg: msg }); }
    var t = {
      ok: function (cond, msg) { add(!!cond, String(msg)); },
      eq: function (actual, expected, msg) {
        if (same(actual, expected)) add(true, String(msg));
        else add(false, msg + ' (got ' + show(actual) + ', wanted ' + show(expected) + ')');
      }
    };
    try { fn(t, mode); }
    catch (e) { add(false, 'the check stopped with an error: ' + (e && e.message)); }
    return r;
  }

  Nextbook.checks = Nextbook.checks || {};
  // One check per mode id; a second check for the same id replaces the first.
  Nextbook.check = function (id, fn) {
    if (typeof id !== 'string' || typeof fn !== 'function') throw new Error('Nextbook.check needs an id and a function.');
    Nextbook.checks[id] = fn;
  };

  // ---- The result check ---------------------------------------------------------------------
  var DROP = {
    unknown: 'not in the list',
    shelf: 'already on your shelf',
    repeat: 'named twice',
    noWhy: 'no reason',
    whyLong: 'reason too long',
    whyStock: 'not a reason',
    seventh: 'more than six',
    bad: 'not a book'
  };
  var WHY = {
    unknown: 'That book is not in the library list.',
    shelf: 'That book is already on your shelf.',
    repeat: 'That book is on the list twice.',
    noWhy: 'That book has no reason with it.',
    whyLong: 'That reason is too long. Keep it under 200 characters.',
    whyStock: 'That is not a reason. Say what the book shares with your shelf.',
    seventh: 'Only six books are shown.',
    bad: 'That pick is not a book with an id.'
  };

  // Which reason is wrong, in words that match: empty, over 200 characters, or the stock
  // phrase. isReason() says yes or no; this says which, so the page can say the true thing.
  var WHY_MAX = 200;
  var WHY_STOCK = /a\s+small\s+match/i;
  function reasonProblem(why) {
    var t = str(why).trim();
    if (!t) return 'noWhy';
    var n = typeof Array.from === 'function' ? Array.from(t).length : t.length;
    if (n > WHY_MAX) return 'whyLong';
    if (WHY_STOCK.test(t)) return 'whyStock';
    if (typeof Nextbook.isReason === 'function' && !Nextbook.isReason(t)) return 'whyStock';
    return '';
  }

  // validate(result, ctx, def) -> { picks, dropped: [{id, why, code}], error }.
  // `picks` holds only id, why, step and group, so nothing a mode (or a model) adds can
  // become a title, an author, a year or a link. A path labels its steps "Step 1", ...
  function validate(result, ctx, def) {
    var out = { picks: [], dropped: [], error: null };
    var mode = def || {};
    var c = ctx || {};
    if (!result || typeof result !== 'object') {
      out.error = 'This mode did not return an answer.';
      return out;
    }
    var note = typeof result.note === 'string' ? result.note.trim() : '';
    var list = Array.isArray(result.picks) ? result.picks : [];
    var seen = Object.create(null);
    var allowShelf = mode.allowShelf === true;
    var isPath = mode.shape === 'path';

    function drop(id, code) {
      out.dropped.push({ id: str(id), why: WHY[code], code: code });
    }

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || typeof p !== 'object') { drop('', 'bad'); continue; }
      var id = typeof p.id === 'string' ? p.id : (typeof p.id === 'number' ? String(p.id) : '');
      if (!id) { drop('', 'bad'); continue; }
      var work = typeof c.work === 'function' ? c.work(id) : null;
      if (!work) { drop(id, 'unknown'); continue; }
      if (seen[id]) { drop(id, 'repeat'); continue; }
      if (!allowShelf && typeof c.onShelf === 'function' && c.onShelf(id)) { drop(id, 'shelf'); continue; }
      var why = typeof p.why === 'string' ? p.why.trim() : '';
      var problem = reasonProblem(why);
      if (problem) { drop(id, problem); continue; }
      if (out.picks.length >= 6) { drop(id, 'seventh'); continue; }
      var pick = { id: id, why: why };
      if (typeof p.group === 'string' && p.group.trim()) pick.group = p.group.trim();
      if (isPath) {
        var step = typeof p.step === 'string' ? p.step.trim() : '';
        pick.step = step || 'Step ' + (out.picks.length + 1);
      } else if (typeof p.step === 'string' && p.step.trim()) {
        pick.step = p.step.trim();
      }
      seen[id] = true;
      out.picks.push(pick);
    }
    if (!out.picks.length && !note) out.error = Nextbook.t('foundNothing');
    return out;
  }

  // ---- ctx ----------------------------------------------------------------------------------
  // mulberry32: a small seeded generator, so ctx.random() gives the same sequence for the
  // same seed and a mode can be tested. Never Math.random.
  function mulberry32(seed) {
    var a = (seed | 0) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Resolve one shelf or friend entry against the ctx's own copies of the works: by id,
  // then by groupKey, then the entry's own work (copied), so nothing the ctx holds is
  // shared with the pool.
  function resolveEntry(pool, e, lookup) {
    var src = e && typeof e === 'object' ? e : {};
    var entry = {};
    Object.keys(src).forEach(function (k) { entry[k] = deepCopy(src[k]); });
    if (entry.work === undefined) entry.work = null;
    if (entry.rating === undefined) entry.rating = null;
    var byId = lookup ? lookup.byId : (pool && pool.byId);
    var byGroup = lookup ? lookup.byGroupKey : (pool && pool.byGroupKey);
    var id = str(src.id);
    var gk = str(src.groupKey);
    entry.work = (id && byId && byId[id]) || (gk && byGroup && byGroup[gk]) || entry.work || null;
    if (!entry.key) {
      entry.key = entry.work ? 'w:' + entry.work.groupKey : 't:' + Nextbook.norm(src.title) + '|' + Nextbook.norm(src.author);
    }
    if (!entry.title && entry.work) entry.title = entry.work.title;
    if (!entry.author && entry.work) entry.author = entry.work.author;
    return entry;
  }

  // makeCtx({ pool, shelf, others, events, eventsFetched, seed, def }).
  // `pool` is Nextbook.pool.load() (app/core/slice.js): works, byId, byGroupKey, facets,
  // labelOf, tagsOf, sections. `def` is the mode, read only for `strings` (ctx.t) — the rest
  // of the signature is docs/CONTRACT.md section 4.
  function makeCtx(opts) {
    var o = opts || {};
    var pool = o.pool;
    if (!pool || typeof pool !== 'object') {
      throw new Error('makeCtx needs the pool from Nextbook.pool.load().');
    }
    var def = o.def && typeof o.def === 'object' ? o.def : null;
    // The ctx's own deep copy of the works, and its own index. A mode that sorts, or edits,
    // ctx.works cannot reorder or change the pool, and one shelf cannot change the next.
    var works = Array.isArray(pool.works) ? pool.works.map(deepCopy) : [];
    var byId = Object.create(null), byGroupKey = Object.create(null);
    works.forEach(function (w) {
      if (!w) return;
      if (w.id !== undefined && w.id !== null && !byId[str(w.id)]) byId[str(w.id)] = w;
      if (w.groupKey !== undefined && w.groupKey !== null && !byGroupKey[str(w.groupKey)]) byGroupKey[str(w.groupKey)] = w;
    });
    var lookup = { byId: byId, byGroupKey: byGroupKey };
    var facets = pool.facets && typeof pool.facets === 'object' ? deepCopy(pool.facets) : {};
    var shelf = [];
    (Array.isArray(o.shelf) ? o.shelf : []).forEach(function (e) { shelf.push(resolveEntry(pool, e, lookup)); });
    var others = [];
    (Array.isArray(o.others) ? o.others : []).forEach(function (friend) {
      if (!friend || typeof friend !== 'object') return;
      others.push({
        name: str(friend.name) || 'A friend',
        entries: (Array.isArray(friend.entries) ? friend.entries : []).map(function (e) { return resolveEntry(pool, e, lookup); })
      });
    });

    var events = o.events, fetched = str(o.eventsFetched);
    if (events && !Array.isArray(events) && typeof events === 'object') {
      fetched = fetched || str(events.fetched);
      events = Array.isArray(events.events) ? events.events : [];
    }
    if (!Array.isArray(events)) events = [];

    var seed = typeof o.seed === 'number' && isFinite(o.seed) ? o.seed : 1;
    var random = mulberry32(seed);

    var shelfIds = Object.create(null);
    var shelfGroups = Object.create(null);
    shelf.forEach(function (e) {
      if (e.id) shelfIds[str(e.id)] = true;
      if (e.groupKey) shelfGroups[str(e.groupKey)] = true;
      if (e.work) {
        if (e.work.id) shelfIds[str(e.work.id)] = true;
        if (e.work.groupKey) shelfGroups[str(e.work.groupKey)] = true;
      }
    });

    function work(id) {
      var key = str(id);
      if (!key) return null;
      if (byId[key]) return byId[key];
      for (var i = 0; i < works.length; i++) if (works[i] && str(works[i].id) === key) return works[i];
      return null;
    }

    var ownProfile = null;
    function profileOf(entries) {
      if (entries !== undefined && entries !== null) return Nextbook.profile(entries);
      if (!ownProfile) ownProfile = Nextbook.profile(shelf);
      return ownProfile;
    }

    var ctx = {
      works: works,
      work: work,
      shelf: shelf,
      onShelf: function (id) {
        var key = str(id);
        if (!key) return false;
        if (shelfIds[key]) return true;
        var w = work(key);
        return !!(w && w.groupKey && shelfGroups[str(w.groupKey)]);
      },
      profile: profileOf,
      score: function (w, p) {
        var prof = p && typeof p === 'object' ? p : profileOf();
        return Nextbook.score(w, prof, facets);
      },
      similar: function (a, b) { return Nextbook.similar(a, b); },
      reason: function (parts, reasonOpts) {
        var opt = {};
        if (reasonOpts && typeof reasonOpts === 'object') {
          Object.keys(reasonOpts).forEach(function (k) { opt[k] = reasonOpts[k]; });
        }
        if (!opt.evidence) {
          var prof = profileOf();
          if (prof && prof.evidence) opt.evidence = prof.evidence;
        }
        return Nextbook.reason(parts, opt);
      },
      facetsOf: function (w, kind) {
        var list = Nextbook.workFacets(w);
        if (!kind) return list;
        var prefix = str(kind).replace(/:$/, '') + ':';
        return list.filter(function (f) { return f.indexOf(prefix) === 0; });
      },
      labelOf: function (facet) {
        if (typeof pool.labelOf === 'function') {
          var said = pool.labelOf(facet);
          if (typeof said === 'string' && said) return said;
        }
        return Nextbook.labelFor(facet, facets);
      },
      facets: facets,
      tagsOf: function (w) {
        return typeof pool.tagsOf === 'function' ? (pool.tagsOf(w) || null) : null;
      },
      sections: function () {
        // From the ctx's copies, never from the pool: a section must not hand a mode a work
        // the pool can still change under it.
        return Nextbook.sections(works, facets);
      },
      others: others,
      events: events,
      eventsFetched: fetched,
      random: random,
      seed: seed,
      t: function (key, vars) {
        if (def && def.strings && has(def.strings, key) && typeof def.strings[key] === 'string') {
          return fill(def.strings[key], vars);
        }
        return Nextbook.t(key, vars);
      }
    };
    return ctx;
  }

  // ---- The standard shelves -----------------------------------------------------------------
  function practiceEntries(practice) {
    if (Array.isArray(practice)) return practice;
    if (practice && Array.isArray(practice.entries)) return practice.entries;
    return [];
  }

  var FLIP = { 'loved': 'not-for-me', 'not-for-me': 'loved', 'liked': 'ok', 'ok': 'liked' };

  function shelfEntry(work, state, rating) {
    return {
      key: 'w:' + (work.groupKey || work.id), id: work.id, groupKey: work.groupKey,
      title: work.title, author: work.author, state: state, rating: rating, work: work
    };
  }

  function copyEntry(e) {
    var out = {};
    Object.keys(e || {}).forEach(function (k) { out[k] = e[k]; });
    return out;
  }

  // The seven shelves in CONTRACT.md section 6, in its order, built from the practice data.
  // Every practice entry carries its work, found by id, then groupKey, then the title and
  // author the pool can match, so profile() of these entries counts them (a rated shelf must
  // not read as "nothing rated yet"). Shelf 5 and shelf 6 carry the same seed, so a mode
  // that uses ctx.random() must answer the same way twice.
  function standardShelves(pool, practice) {
    var works = (pool && Array.isArray(pool.works) ? pool.works : []).slice().sort(function (a, b) {
      return str(a.id) < str(b.id) ? -1 : str(a.id) > str(b.id) ? 1 : 0;
    });
    function resolved(e) {
      var c = resolveEntry(pool, copyEntry(e));
      if (!c.work && pool && typeof pool.match === 'function') {
        try { c.work = pool.match(str(c.title), str(c.author)) || null; }
        catch (err) { c.work = null; }
      }
      if (c.work) {
        if (!c.id) c.id = c.work.id;
        if (!c.groupKey) c.groupKey = c.work.groupKey;
        if (!c.key) c.key = 'w:' + (c.work.groupKey || c.work.id);
        if (!c.title) c.title = c.work.title;
        if (!c.author) c.author = c.work.author;
      }
      return c;
    }
    var shelf = practiceEntries(practice).map(resolved);
    var typed = [
      { key: 't:the book not in the list|nobody here', title: 'The Book Not in the List', author: 'Nobody Here', state: 'read', rating: 'loved', work: null },
      { key: 't:another typed book|someone else', title: 'Another Typed Book', author: 'Someone Else', state: 'read', rating: 'liked', work: null }
    ];
    var flipped = shelf.map(function (e) {
      var c = copyEntry(e);
      if (c.rating && FLIP[c.rating]) c.rating = FLIP[c.rating];
      return c;
    });
    var seed = 1;
    var practiceSeed = seed;   // shelves 5 and 6: the same seeds, on purpose
    return [
      { name: 'an empty shelf', shelf: [], others: [], events: [], seed: seed },
      { name: 'one book, rated loved', shelf: works.length ? [shelfEntry(works[0], 'read', 'loved')] : [], others: [], events: [], seed: seed },
      { name: 'every book rated not for me', shelf: works.map(function (w) { return shelfEntry(w, 'read', 'not-for-me'); }), others: [], events: [], seed: seed },
      { name: 'only books typed in', shelf: typed, others: [], events: [], seed: seed },
      { name: 'the practice shelf', shelf: shelf, others: [], events: [], seed: practiceSeed },
      { name: 'the practice shelf again', shelf: shelf.map(copyEntry), others: [], events: [], seed: practiceSeed },
      { name: "the practice shelf with a friend's shelf", shelf: shelf.map(copyEntry),
        others: [{ name: 'A friend', entries: flipped }], events: [], seed: seed }
    ];
  }

  // ---- A sensible default for every input kind ----------------------------------------------
  // An `event` input needs something to hand over in the checks. The snapshot's first event is
  // the real default; when the standard shelves carry no events (they carry none), a two-event
  // fixture stands in, so a mode can be checked with the shape the contract promises.
  // An optional input gets a real value here on purpose: the seven shelves show what a mode
  // does with a chosen value, and runModeChecks adds one more run with it empty (D37).
  var DEFAULT_EVENTS = [
    {
      id: 'sample-event-1', title: 'An evening talk at the library',
      start: '2026-11-03T18:30:00', end: '2026-11-03T19:30:00', branch: 'the library',
      virtual: false, categories: [], summary: 'A talk about books and reading.', url: ''
    },
    {
      id: 'sample-event-2', title: 'A morning story time',
      start: '2026-11-04T10:00:00', end: '2026-11-04T10:30:00', branch: 'the library',
      virtual: false, categories: [], summary: 'Stories for young readers.', url: ''
    }
  ];

  // The fixture is shared by every shelf, so it is copied before a mode can edit it: shelves
  // 5 and 6 must still give the same answer.
  function eventCopy(e) {
    var out = {};
    Object.keys(e || {}).forEach(function (k) {
      out[k] = Array.isArray(e[k]) ? e[k].slice() : e[k];
    });
    return out;
  }

  function commonFacet(ctx) {
    var facets = ctx && ctx.facets ? ctx.facets : {};
    var best = '', count = -1;
    Object.keys(facets).sort().forEach(function (k) {
      var c = facets[k] && typeof facets[k].works === 'number' ? facets[k].works : 0;
      if (c > count) { count = c; best = k; }
    });
    if (best) return best;
    var works = ctx && Array.isArray(ctx.works) ? ctx.works : [];
    for (var i = 0; i < works.length; i++) {
      if (works[i] && Array.isArray(works[i].facets) && works[i].facets.length) return works[i].facets[0];
    }
    return '';
  }

  function defaultInput(def, ctx) {
    var input = {};
    var list = def && Array.isArray(def.inputs) ? def.inputs : [];
    var shelf = ctx && Array.isArray(ctx.shelf) ? ctx.shelf : [];
    var works = ctx && Array.isArray(ctx.works) ? ctx.works : [];
    var events = ctx && Array.isArray(ctx.events) ? ctx.events : [];
    var facet = commonFacet(ctx);
    var firstLoved = null, firstShelfBook = null, firstOffShelf = null;
    shelf.forEach(function (e) {
      if (!firstLoved && e.rating === 'loved') firstLoved = e;
      if (!firstShelfBook && e.work) firstShelfBook = e;
    });
    works.forEach(function (w) {
      if (!firstOffShelf && ctx && typeof ctx.onShelf === 'function' && !ctx.onShelf(w.id)) firstOffShelf = w;
    });
    list.forEach(function (spec) {
      if (!spec || typeof spec !== 'object' || !spec.id) return;
      var kind = str(spec.kind);
      if (kind === 'shelf-book') input[spec.id] = firstLoved || firstShelfBook || shelf[0] || null;
      else if (kind === 'book') input[spec.id] = firstOffShelf || works[0] || null;
      else if (kind === 'facet') input[spec.id] = facet;
      else if (kind === 'facets') input[spec.id] = facet ? [facet] : [];
      else if (kind === 'event') input[spec.id] = events[0] || eventCopy(DEFAULT_EVENTS[0]);
      else if (kind === 'text') input[spec.id] = 'a quiet book about the sea';
      else if (kind === 'number') input[spec.id] = spec['default'] !== undefined ? spec['default'] : (spec.min !== undefined ? spec.min : 1);
      else if (kind === 'choice') {
        input[spec.id] = spec['default'] !== undefined ? spec['default']
          : (Array.isArray(spec.options) && spec.options[0] ? spec.options[0].value : '');
      }
    });
    return input;
  }

  // ---- runModeChecks -------------------------------------------------------------------------
  // Runs, for one mode: the scan, the mode's own check, and the seven standard shelves, plus
  // one more run for each optional input the mode lists, with that input empty (null). A
  // missing practice shelf is a named failure (and shelves 5 to 7 are not run), never three
  // empty shelves that pass. A mode that answers shelves 5 and 6 differently fails too.
  // A mode that needs inputs gets defaultInput() above. Returns the flat `results` list the
  // check screen and tools/check-mode.js print, plus the per-shelf answers.
  function runModeChecks(id, opts) {
    var o = opts || {};
    var modeId = str(id);
    var def = o.mode || (Nextbook.modeDefs ? Nextbook.modeDefs[modeId] : null) || null;
    var out = { id: modeId, ok: false, pass: 0, fail: 0, results: [], scan: [], check: null, shelves: [] };
    function add(ok, msg) { out[ok ? 'pass' : 'fail']++; out.results.push({ ok: !!ok, msg: String(msg) }); }

    if (!def) {
      add(false, '"' + modeId + '" did not load, so there was nothing to check.');
      out.ok = false;
      return out;
    }

    // 1. The words a mode may not use.
    var findings = scanFeature(def);
    out.scan = findings;
    if (findings.length) {
      findings.forEach(function (f) { add(false, 'The scan: ' + f.message); });
    } else {
      add(true, 'The scan: no words a mode may not use.');
    }

    // 2. The mode's own check file.
    var fn = o.check || (Nextbook.checks ? Nextbook.checks[modeId] : null);
    if (typeof fn !== 'function') {
      add(false, 'This mode has no check. Add app/modes/' + modeId + '.check.js.');
    } else {
      var r = runCheck(fn, def);
      out.check = r;
      r.results.forEach(function (x) { add(x.ok, 'The check: ' + x.msg); });
    }

    // 3. The seven standard shelves.
    var pool = o.pool || (Nextbook.pool && typeof Nextbook.pool.load === 'function' ? Nextbook.pool.load() : null);
    if (!pool || typeof pool !== 'object' || pool.ok === false) {
      add(false, (pool && pool.message) || Nextbook.t('noList'));
      out.ok = false;
      return out;
    }
    var practice = o.practice !== undefined && o.practice !== null ? o.practice
      : (Nextbook.data && typeof Nextbook.data.get === 'function' ? Nextbook.data.get('practice') : null);
    var hasPractice = practiceEntries(practice).length > 0;
    if (!hasPractice) {
      // No practice data: shelves 5 to 7 would silently become empty-shelf runs, and the
      // check would go green without ever exercising a real shelf. Say so instead.
      add(false, 'There is no practice shelf, so this mode was not checked against a real shelf.');
    }
    var practiceAnswerA = null, practiceAnswerB = null;
    var shelves = standardShelves(pool, practice);

    // One shelf, one answer. `label` is the shelf's name, or the words for a run of the same
    // shelf with one input left empty, and it opens every message.
    function runShelf(label, shelf, inputOf) {
      var one = {
        name: label, ok: true, error: null, picks: [], dropped: [], note: '',
        answer: null, message: ''
      };
      try {
        var ctx = makeCtx({ pool: pool, shelf: shelf.shelf, others: shelf.others, events: shelf.events, seed: shelf.seed, def: def });
        var answer = def.choose.call(def, ctx, inputOf(ctx));
        var v = validate(answer, ctx, def);
        one.picks = v.picks;
        one.dropped = v.dropped;
        one.error = v.error;
        one.note = answer && typeof answer.note === 'string' ? answer.note : '';
        one.answer = { picks: v.picks, note: one.note };
        if (v.error) {
          one.ok = false;
          one.message = label + ': ' + v.error;
        } else if (v.dropped.length) {
          one.ok = false;
          one.message = label + ': dropped ' + v.dropped.map(function (d) {
            return (d.id || 'a pick') + ' (' + d.why + ')';
          }).join(', ');
        } else {
          one.message = label + ': ' + (v.picks.length
            ? v.picks.length + (v.picks.length === 1 ? ' book.' : ' books.')
            : 'no books, and it said why.');
        }
      } catch (e) {
        one.ok = false;
        one.message = label + ': this mode stopped with an error: ' + (e && e.message ? e.message : String(e));
      }
      return one;
    }

    shelves.forEach(function (s, index) {
      if (!hasPractice && index >= 4) return;   // the three practice shelves cannot run
      var one = runShelf(s.name, s, function (ctx) { return defaultInput(def, ctx); });
      if (index === 4) practiceAnswerA = one;
      if (index === 5) practiceAnswerB = one;
      out.shelves.push(one);
      add(one.ok, one.message);
    });

    // D37: the eighth standard run, once for each optional input a mode lists: the practice
    // shelf with that input empty (null) and every other input at its default. The seven above
    // only ever hand a mode a real value, so without this one a mode that crashes on null, or
    // treats it as a subject, would pass its own check. The words name the input, because the
    // fix belongs in the mode.
    var optionalSpecs = (Array.isArray(def.inputs) ? def.inputs : []).filter(function (spec) {
      return spec && typeof spec === 'object' && spec.id && spec.optional === true;
    });
    if (hasPractice && optionalSpecs.length) {
      optionalSpecs.forEach(function (spec) {
        var label = 'the practice shelf, with "' + spec.id + '" left empty';
        var one = runShelf(label, shelves[4], function (ctx) {
          var input = defaultInput(def, ctx);
          input[spec.id] = null;
          return input;
        });
        one.optional = spec.id;
        if (!one.ok) {
          one.message += ' A mode must work with "' + spec.id + '" empty, because it says the input is optional.';
        }
        out.shelves.push(one);
        add(one.ok, one.message);
      });
    }

    // Shelves 5 and 6 are the same shelf with the same seed. If the answers differ, the mode
    // depends on something other than the shelf: same picks, same reasons, same note, twice.
    if (hasPractice && practiceAnswerA && practiceAnswerB &&
        !practiceAnswerA.error && !practiceAnswerB.error &&
        !same(practiceAnswerA.answer, practiceAnswerB.answer)) {
      add(false, 'The same shelf gave two different answers. A mode must give the same six twice.');
    }

    out.ok = out.fail === 0;
    return out;
  }

  Nextbook.contract = {
    banned: BANNED.map(function (b) { return b.word; }),
    scan: scan,
    scanFeature: scanFeature,
    strip: strip,
    same: same,
    runCheck: runCheck,
    validate: validate,
    makeCtx: makeCtx,
    mulberry32: mulberry32,
    standardShelves: standardShelves,
    defaultInput: defaultInput,
    runModeChecks: runModeChecks,
    dropCodes: DROP
  };

  Nextbook.banned = Nextbook.contract.banned;
  Nextbook.validate = validate;
  Nextbook.makeCtx = makeCtx;
  Nextbook.standardShelves = standardShelves;
  Nextbook.defaultInput = defaultInput;
  Nextbook.runModeChecks = runModeChecks;
  Nextbook.runCheck = runCheck;
})(window);
