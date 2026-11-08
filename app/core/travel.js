'use strict';
// A person's own travel times to the library's branches, read from a map file the person made
// with tools/distance-map.py (docs/DATA.md, "distance-map.json"). The times come from one start
// point, so the map is one person's: it is never packed into a build, never exported with a
// shelf, never sent anywhere, and never part of what a mode can see.
//
//   Nextbook.travel.read(text)          untrusted text -> { ok, map } or { ok: false, error }.
//                                       The map is rebuilt from known fields only; the start
//                                       point's numbers are dropped and only its label is kept.
//   Nextbook.travel.current()           { map, source: 'folder'|'browser'|null }
//   Nextbook.travel.save(text)          validate, then keep it in this browser only
//   Nextbook.travel.remove()            forget the copy kept in this browser
//   Nextbook.travel.branchFor(map, name)  the map's branch for an event's place name, or null
//   Nextbook.travel.trip(row, mode, weekend)   { seconds, via } or null (never 0 for "unknown")
//   Nextbook.travel.forEvent(map, event, mode)  { kind: 'virtual'|'unknown'|'known', seconds, minutes, via }
//   Nextbook.travel.normName(name)      the matching key
//
// Reading rules (the same as the tool that writes the map): a missing time is null and is never
// treated as zero; "transit" is the lesser of transit and walking, since walking is always
// possible; "any" is the least of walk, bike and transit, never car; the transit time used is the
// weekend one when the event is on a Saturday or Sunday, and the weekday one otherwise.
//
// Matching is by name and nothing else: the event's place and the branch are lowercased, their
// punctuation made into spaces, a trailing " - Closed" and a trailing "Library" dropped. A name
// that is still different is not matched, and a branch may list explicit `aliases` in its data.
// There is no match by similarity: a wrong branch would put a wrong time on an event.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.travel = Nextbook.travel || {};

  var KEY = 'nextbook1:travel';
  var MAX_BYTES = 1024 * 1024;
  var MAX_BRANCHES = 400;
  var MAX_SECONDS = 6 * 3600;
  var MODES = ['any', 'transit', 'walk', 'bike', 'car'];

  function addStrings(table) {
    Nextbook.strings = Nextbook.strings || {};
    Object.keys(table).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(Nextbook.strings, k)) Nextbook.strings[k] = table[k];
    });
  }

  addStrings({
    travelErrBig: 'That file is too big to be a travel times file.',
    travelErrJson: 'That file is not a travel times file. It could not be read.',
    travelErrShape: 'That file is not a travel times file. It has no list of branches.',
    travelErrNone: 'That file has no branches with a name, so there is nothing to use.'
  });

  function t(key) { return typeof Nextbook.t === 'function' ? Nextbook.t(key) : String(key); }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function text(v, limit) {
    if (typeof v !== 'string') return '';
    v = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, '');
    return v.length > limit ? v.slice(0, limit) : v;
  }

  // A time in seconds, or null. 0 is not a time, a negative is not a time, NaN is not a time.
  function secs(v) {
    return typeof v === 'number' && isFinite(v) && v > 0 && v <= MAX_SECONDS ? Math.round(v) : null;
  }

  function normName(name) {
    var s = typeof name === 'string' ? name.toLowerCase() : '';
    s = s.replace(/\s*-\s*closed\s*$/, '').replace(/[^a-z0-9]+/g, ' ').replace(/^ | $/g, '');
    return s.replace(/ library$/, '');
  }

  // ---- Reading a map --------------------------------------------------------------------------
  function readMap(raw) {
    if (!isObj(raw) || !Array.isArray(raw.branches)) return { ok: false, error: t('travelErrShape') };
    var rows = [];
    raw.branches.slice(0, MAX_BRANCHES).forEach(function (b) {
      if (!isObj(b)) return;
      var name = text(b.name, 120);
      if (!name) return;
      var aliases = (Array.isArray(b.aliases) ? b.aliases : []).map(function (a) { return text(a, 120); })
        .filter(Boolean).slice(0, 8);
      rows.push({
        code: text(b.code, 20), name: name, aliases: aliases,
        walk_s: secs(b.walk_s), bike_s: secs(b.bike_s), car_s: secs(b.car_s),
        transit_weekday_s: secs(b.transit_weekday_s), transit_weekend_s: secs(b.transit_weekend_s),
        transit_weekday_walk: typeof b.transit_weekday_route === 'string' && /^walk \(no transit/i.test(b.transit_weekday_route),
        transit_weekend_walk: typeof b.transit_weekend_route === 'string' && /^walk \(no transit/i.test(b.transit_weekend_route)
      });
    });
    if (!rows.length) return { ok: false, error: t('travelErrNone') };
    var built = text(raw.built, 10);
    return { ok: true, map: { label: text(raw.label, 80), built: /^\d{4}-\d{2}-\d{2}$/.test(built) ? built : '', branches: rows } };
  }

  function read(src) {
    var raw = src;
    if (typeof src === 'string') {
      if (src.length > MAX_BYTES) return { ok: false, error: t('travelErrBig') };
      try { raw = JSON.parse(src); } catch (e) { return { ok: false, error: t('travelErrJson') }; }
    }
    return readMap(raw);
  }

  // ---- Where the map is kept ------------------------------------------------------------------
  function storage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  function fromBrowser() {
    try {
      var st = storage();
      var raw = st ? st.getItem(KEY) : null;
      if (!raw) return null;
      var r = read(raw);
      return r.ok ? r.map : null;
    } catch (e) { return null; }
  }

  function fromFolder() {
    var doc = null;
    try { doc = Nextbook.data.get('distance'); } catch (e) { doc = null; }
    if (doc === null) return null;
    var r = read(doc);
    return r.ok ? r.map : null;
  }

  var index = null;                 // matching keys for the map last used
  function current() {
    var m = fromBrowser();
    if (m) return { map: m, source: 'browser' };
    m = fromFolder();
    return m ? { map: m, source: 'folder' } : { map: null, source: null };
  }

  // Keep the cleaned map, never the file as it came: nothing in it that was not read.
  function save(src) {
    var r = read(src);
    if (!r.ok) return r;
    try {
      var st = storage();
      if (!st) return { ok: false, error: t('travelErrNone') };
      st.setItem(KEY, JSON.stringify(r.map));
    } catch (e) { return { ok: false, error: t('travelErrNone') }; }
    index = null;
    return r;
  }

  function remove() {
    try { var st = storage(); if (st) st.removeItem(KEY); } catch (e) { /* nothing was kept */ }
    index = null;
  }

  // ---- Matching and times ---------------------------------------------------------------------
  function indexOf(map) {
    if (index && index.map === map) return index.by;
    var by = {};
    map.branches.forEach(function (row) {
      [row.name].concat(row.aliases || []).forEach(function (n) {
        var k = normName(n);
        if (k && !has(by, k)) by[k] = row;
      });
    });
    index = { map: map, by: by };
    return by;
  }

  function branchFor(map, name) {
    if (!map || !Array.isArray(map.branches)) return null;
    var k = normName(name);
    if (!k) return null;
    var by = indexOf(map);
    return has(by, k) ? by[k] : null;
  }

  function trip(row, mode, weekend) {
    if (!row) return null;
    var slot = weekend ? 'weekend' : 'weekday';
    var transit = { s: row['transit_' + slot + '_s'], via: row['transit_' + slot + '_walk'] ? 'walk' : 'transit' };
    var walk = { s: row.walk_s, via: 'walk' }, bike = { s: row.bike_s, via: 'bike' }, car = { s: row.car_s, via: 'car' };
    var options;
    if (mode === 'transit') options = [transit, walk];
    else if (mode === 'walk') options = [walk];
    else if (mode === 'bike') options = [bike];
    else if (mode === 'car') options = [car];
    else options = [walk, bike, transit];
    var best = null;
    options.forEach(function (o) {
      if (typeof o.s === 'number' && o.s > 0 && (!best || o.s < best.s)) best = o;
    });
    return best ? { seconds: best.s, via: best.via } : null;
  }

  function weekendOf(start) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof start === 'string' ? start : '');
    if (!m) return false;
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    var w = d.getUTCDay();
    return w === 0 || w === 6;
  }

  function forEvent(map, event, mode) {
    if (!event || event.virtual === true || !event.branch) return { kind: 'virtual' };
    var row = branchFor(map, event.branch);
    var tr = row ? trip(row, MODES.indexOf(mode) === -1 ? 'any' : mode, weekendOf(event.start)) : null;
    if (!tr) return { kind: 'unknown' };
    return { kind: 'known', seconds: tr.seconds, minutes: Math.ceil(tr.seconds / 60), via: tr.via };
  }

  Nextbook.travel.MODES = MODES;
  Nextbook.travel.KEY = KEY;
  Nextbook.travel.MAX_BYTES = MAX_BYTES;
  Nextbook.travel.read = read;
  Nextbook.travel.current = current;
  Nextbook.travel.save = save;
  Nextbook.travel.remove = remove;
  Nextbook.travel.branchFor = branchFor;
  Nextbook.travel.trip = trip;
  Nextbook.travel.forEvent = forEvent;
  Nextbook.travel.normName = normName;
})(window);
