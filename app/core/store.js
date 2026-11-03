'use strict';
// The shelf: kept in this browser only, in four keys that are never mixed.
//
//   nextbook-own-v1       the person's own shelf
//   nextbook-practice-v1  the practice shelf, filled from data/practice.js on first use
//   nextbook-others-v1    friends' shelves, each an exported file added under a name
//   nextbook-mode-v1:<id> one per mode: its last inputs and its shuffle seed
//   nextbook-which-v1     the shelf last in use: 'own' or 'practice', one plain value
//
// A friend's shelf is never merged into the person's own; importing a file merges into the
// shelf in use. On a key clash the newer `updated` wins and a tie keeps ours (the rule in
// searchdesk/core/merge.js). Nothing here reads a clock: a caller that wants a timestamp
// passes one, as an optional third argument to setState/setRating and an optional argument
// to exportShelf. `updated` values are only compared, never made.
//
// Storage is passed in, so tests can use a plain object:
//
//   var store = Nextbook.store.open(storage);
//   store.persistent        true when this browser is really saving
//   store.which()           'own' or 'practice' (practice is the default)
//   store.use(name)         switch, returning the shelf now in use. The choice is written to
//                           nextbook-which-v1, so the next visit opens on that shelf; use('own')
//                           is refused in a workshop copy, which leaves 'practice' and says so
//                           by return
//   store.shelf()           the entries in use
//   store.own(), store.practice(), store.practiceReset()
//   store.add(entry)        -> {added, changed, kept}
//   store.setState(key, state, at?), store.setRating(key, rating, at?), store.remove(key)
//   store.others()          -> [{name, entries}]
//   store.addOther(text, name) -> {added, skipped, error}; a second file with that name
//                                 replaces the first
//   store.removeOther(name)
//   store.exportShelf(at?)  -> text
//   store.importShelf(text) -> {added, changed, kept, skipped, error}
//   store.inputs(modeId), store.setInputs(modeId, obj)
//   store.seed(modeId)      -> number or null
//   store.setSeed(modeId, n)
//
// A storage object that is missing or throws on every call still works, in memory, with
// persistent false, so the page can say "This browser is not saving. Export before you
// close it." A broken import is refused with a sentence in `error`, never thrown.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.store = Nextbook.store || {};

  var OWN = 'nextbook-own-v1';
  var PRACTICE = 'nextbook-practice-v1';
  var OTHERS = 'nextbook-others-v1';
  var WHICH = 'nextbook-which-v1';
  var MODE_PREFIX = 'nextbook-mode-v1:';

  var SHELF_SCHEMA = 'nextbook/shelf-1';
  var OTHERS_SCHEMA = 'nextbook/others-1';

  var STATES = { want: 1, reading: 1, read: 1, stopped: 1 };
  var RATINGS = { loved: 1, liked: 1, ok: 1, 'not-for-me': 1 };

  // The store's own keys join the one table in core/base.js, exactly as the shell's do. A key
  // already set elsewhere wins, so the wording can move to the table without touching this file.
  function addStrings(table) {
    Nextbook.strings = Nextbook.strings || {};
    Object.keys(table).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(Nextbook.strings, k)) Nextbook.strings[k] = table[k];
    });
  }
  addStrings({
    importNotFile: 'That file is not a shelf file, so nothing was changed.',
    importWrongSchema: 'That file was saved by a different version of the app, so nothing was changed.',
    importNoEntries: 'That file has no books in it, so nothing was changed.'
  });

  function t(key) { return typeof Nextbook.t === 'function' ? Nextbook.t(key) : String(key); }

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function clone(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; }
  }

  // Newer wins; a tie keeps ours. ISO-8601 timestamps compare as text, and Date.parse (a
  // pure function, not a clock) settles the mixed and offset cases.
  function timeOf(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      var ms = Date.parse(value);
      if (isFinite(ms)) return ms;
    } catch (e) { /* an odd timestamp still compares as text */ }
    return null;
  }

  function cmpTime(a, b) {
    var x = timeOf(a);
    var y = timeOf(b);
    if (x !== null && y !== null) return x < y ? -1 : x > y ? 1 : 0;
    var sa = typeof a === 'string' ? a : '';
    var sb = typeof b === 'string' ? b : '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  function incomingWins(ours, theirs) {
    return cmpTime(theirs.updated, ours.updated) > 0;
  }

  function validEntry(entry) {
    return isObj(entry) && typeof entry.key === 'string' && entry.key.length > 0;
  }

  // A shelf as stored: {schema, entries}. Anything else is the same as no shelf.
  function readEntries(record) {
    if (!isObj(record) || !Array.isArray(record.entries)) return null;
    var out = [];
    for (var i = 0; i < record.entries.length; i++) {
      if (validEntry(record.entries[i])) out.push(clone(record.entries[i]));
    }
    return out;
  }

  // Merge a list of entries into ours. The whole entry wins or loses (searchdesk merge):
  // unknown keys ride along untouched with whichever entry is kept.
  function mergeEntries(ours, incoming) {
    var byKey = Object.create(null);
    var order = [];
    var i;
    for (i = 0; i < (ours || []).length; i++) {
      var mine = ours[i];
      if (!validEntry(mine) || has(byKey, mine.key)) continue;
      byKey[mine.key] = mine;
      order.push(mine.key);
    }

    var report = { added: 0, changed: 0, kept: 0, skipped: 0 };
    for (i = 0; i < (incoming || []).length; i++) {
      var raw = incoming[i];
      if (!validEntry(raw)) { report.skipped += 1; continue; }
      var entry = clone(raw);
      if (!isObj(entry)) { report.skipped += 1; continue; }
      var old = has(byKey, entry.key) ? byKey[entry.key] : null;
      if (!old) {
        byKey[entry.key] = entry;
        order.push(entry.key);
        report.added += 1;
        continue;
      }
      if (JSON.stringify(old) === JSON.stringify(entry)) { report.kept += 1; continue; }
      if (incomingWins(old, entry)) {
        byKey[entry.key] = entry;
        report.changed += 1;
      } else {
        report.kept += 1;
      }
    }

    var entries = [];
    for (i = 0; i < order.length; i++) entries.push(byKey[order[i]]);
    return { entries: entries, report: report };
  }

  // Parse a shelf file. Returns {entries} or {error: one plain sentence}. A file with a valid
  // schema and an empty list is refused with the sentence that says it has no books in it, so
  // the page never reports a hollow "0 added, 0 changed, 0 kept".
  function readFile(text) {
    if (typeof text !== 'string' || !text.trim()) return { error: t('importNotFile') };
    var data = null;
    try { data = JSON.parse(text); } catch (e) { return { error: t('importNotFile') }; }
    if (!isObj(data)) return { error: t('importNotFile') };
    if (has(data, 'schema') && data.schema !== SHELF_SCHEMA) return { error: t('importWrongSchema') };
    if (!Array.isArray(data.entries) || !data.entries.length) return { error: t('importNoEntries') };
    return { entries: data.entries };
  }

  function open(storage) {
    // `mem` holds only what storage could not take: a shelf written when the disk is full,
    // or a value written after the storage started refusing. Anything storage accepted is
    // read back from it, so two stores open on one storage see each other's writes.
    var mem = Object.create(null);
    var unsaved = Object.create(null);
    var persistent = true;
    var chosen = 'practice';
    var st = null;

    if (storage === undefined) {
      try { st = window.localStorage || null; } catch (e) { st = null; }
    } else {
      st = storage || null;
    }

    function probe() {
      try {
        st.setItem('__nextbook_probe__', '1');
        var seen = st.getItem('__nextbook_probe__');
        st.removeItem('__nextbook_probe__');
        return seen === '1';
      } catch (e) {
        return false;
      }
    }

    if (!st || typeof st.getItem !== 'function' || typeof st.setItem !== 'function') {
      st = null;
      persistent = false;
    } else if (!probe()) {
      st = null;
      persistent = false;
    }

    // The shelf last in use, from its own one-value key, so a reload lands where the person
    // left off instead of back on the practice shelf. Read here, once, at open.
    chosen = storedWhich();

    function workshopCopy() {
      if (typeof Nextbook.workshop !== 'function') return false;
      try { return Nextbook.workshop() === true; } catch (e) { return false; }
    }

    // Only 'own' or 'practice' is a real answer; anything else is the practice default. A
    // workshop copy refuses 'own' here too, so a value left by an ordinary copy in the same
    // browser can never put the practice-only copy on someone's own shelf.
    function storedWhich() {
      var value = readRaw(WHICH);
      var name = typeof value === 'string' ? value : '';
      if (name !== 'own' && name !== 'practice') return 'practice';
      if (name === 'own' && workshopCopy()) return 'practice';
      return name;
    }

    // Read from storage every time, so a write by another store is never missed. Only a
    // value storage could not take comes from `mem`, and then ours is the newer one.
    function readRaw(key) {
      if (!st) return has(mem, key) ? mem[key] : null;
      var raw;
      try {
        raw = st.getItem(key);
      } catch (e) {
        persistent = false;
        return has(mem, key) ? mem[key] : null;
      }
      if (has(unsaved, key)) return mem[key];
      if (raw === null || raw === undefined) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function writeRaw(key, value) {
      if (!st) {
        mem[key] = value;
        return false;
      }
      try {
        st.setItem(key, JSON.stringify(value));
        delete mem[key];
        delete unsaved[key];
        return true;
      } catch (e) {
        // A full disk, a private window: keep this value in memory and carry on.
        mem[key] = value;
        unsaved[key] = true;
        persistent = false;
        return false;
      }
    }

    function dropRaw(key) {
      delete mem[key];
      delete unsaved[key];
      if (!st) return;
      try { st.removeItem(key); } catch (e) { persistent = false; }
    }

    // The stored shelf record, or null when there is none. A record that is not a shelf is
    // treated as no shelf, so a hand-edited key cannot break the page.
    function shelfRecord(key) {
      var record = readRaw(key);
      var entries = readEntries(record);
      if (!entries) return null;
      return { schema: typeof record.schema === 'string' ? record.schema : SHELF_SCHEMA, entries: entries };
    }

    function saveShelf(key, entries) {
      var record = readRaw(key);
      var out = isObj(record) ? clone(record) : { schema: SHELF_SCHEMA };
      if (!isObj(out)) out = { schema: SHELF_SCHEMA };
      if (typeof out.schema !== 'string') out.schema = SHELF_SCHEMA;
      out.entries = entries;
      writeRaw(key, out);
    }

    function practiceSeed() {
      var seed = null;
      try { seed = Nextbook.data.get('practice'); } catch (e) { seed = null; }
      var entries = isObj(seed) && Array.isArray(seed.entries) ? seed.entries : [];
      var out = [];
      for (var n = 0; n < entries.length; n++) {
        if (!validEntry(entries[n])) continue;
        out.push(clone(entries[n]));
      }
      return out;
    }

    // Seeded on first use: a practice shelf that exists, even empty, is left as it is.
    function practiceEntries() {
      var record = shelfRecord(PRACTICE);
      if (record) return record.entries;
      var seeded = practiceSeed();
      writeRaw(PRACTICE, { schema: SHELF_SCHEMA, entries: seeded });
      return seeded;
    }

    function ownEntries() {
      var record = shelfRecord(OWN);
      return record ? record.entries : [];
    }

    function entriesFor(name) {
      return name === 'own' ? ownEntries() : practiceEntries();
    }

    function which() { return chosen; }

    function use(name) {
      var wanted = String(name === null || name === undefined ? '' : name);
      if (wanted !== 'own' && wanted !== 'practice') return chosen;
      if (wanted === 'own' && workshopCopy()) return chosen; // the practice shelf is the only shelf here
      chosen = wanted;
      writeRaw(WHICH, chosen); // remembered, so the next visit opens on this shelf
      return chosen;
    }

    function shelf() { return clone(entriesFor(chosen)) || []; }
    function own() { return clone(ownEntries()) || []; }
    function practice() { return clone(practiceEntries()) || []; }

    function practiceReset() {
      var seeded = practiceSeed();
      writeRaw(PRACTICE, { schema: SHELF_SCHEMA, entries: seeded });
      return clone(seeded) || [];
    }

    function add(entry) {
      var current = entriesFor(chosen);
      var merged = mergeEntries(current, [entry]);
      saveShelf(chosen === 'own' ? OWN : PRACTICE, merged.entries);
      return { added: merged.report.added, changed: merged.report.changed, kept: merged.report.kept };
    }

    function findEntry(entries, key) {
      for (var n = 0; n < entries.length; n++) {
        if (entries[n] && entries[n].key === key) return n;
      }
      return -1;
    }

    function edit(key, change, at) {
      var entries = entriesFor(chosen);
      var index = findEntry(entries, String(key));
      if (index === -1) return null;
      change(entries[index]);
      if (typeof at === 'string' && at) entries[index].updated = at;
      saveShelf(chosen === 'own' ? OWN : PRACTICE, entries);
      return clone(entries[index]);
    }

    function setState(key, state, at) {
      var wanted = String(state === null || state === undefined ? '' : state);
      if (!has(STATES, wanted)) return null;
      return edit(key, function (entry) { entry.state = wanted; }, at);
    }

    function setRating(key, rating, at) {
      var wanted = rating === null || rating === undefined ? null : String(rating);
      if (wanted !== null && !has(RATINGS, wanted)) return null;
      return edit(key, function (entry) { entry.rating = wanted; }, at);
    }

    function remove(key) {
      var entries = entriesFor(chosen);
      var index = findEntry(entries, String(key));
      if (index === -1) return false;
      entries.splice(index, 1);
      saveShelf(chosen === 'own' ? OWN : PRACTICE, entries);
      return true;
    }

    function othersRecord() {
      var record = readRaw(OTHERS);
      if (!isObj(record) || !Array.isArray(record.shelves)) return { schema: OTHERS_SCHEMA, shelves: [] };
      return record;
    }

    function others() {
      var record = othersRecord();
      var out = [];
      for (var i = 0; i < record.shelves.length; i++) {
        var shelfIn = record.shelves[i];
        if (!isObj(shelfIn) || typeof shelfIn.name !== 'string') continue;
        var entries = readEntries(shelfIn);
        out.push({ name: shelfIn.name, entries: clone(entries || []) || [] });
      }
      return out;
    }

    function addOther(text, name) {
      var file = readFile(text);
      if (file.error) return { added: 0, skipped: 0, error: file.error };
      var label = String(name === null || name === undefined ? '' : name).replace(/\s+/g, ' ').trim();
      if (!label) label = 'A friend';

      var merged = mergeEntries([], file.entries);
      var record = othersRecord();
      var shelves = [];
      var placed = false;
      for (var i = 0; i < record.shelves.length; i++) {
        var existing = record.shelves[i];
        if (!isObj(existing) || typeof existing.name !== 'string') continue;
        if (existing.name === label) {
          // A second file with the same name replaces the first.
          shelves.push({ name: label, entries: merged.entries });
          placed = true;
        } else {
          shelves.push(existing);
        }
      }
      if (!placed) shelves.push({ name: label, entries: merged.entries });
      writeRaw(OTHERS, { schema: OTHERS_SCHEMA, shelves: shelves });
      return { added: merged.report.added, skipped: merged.report.skipped, error: null };
    }

    function removeOther(name) {
      var label = String(name === null || name === undefined ? '' : name);
      var record = othersRecord();
      var shelves = [];
      var removed = false;
      for (var i = 0; i < record.shelves.length; i++) {
        var existing = record.shelves[i];
        if (isObj(existing) && existing.name === label) { removed = true; continue; }
        shelves.push(existing);
      }
      if (removed) writeRaw(OTHERS, { schema: OTHERS_SCHEMA, shelves: shelves });
      return removed;
    }

    function exportShelf(at) {
      var out = { schema: SHELF_SCHEMA };
      if (typeof at === 'string' && at) out.exported = at;
      out.entries = entriesFor(chosen);
      return JSON.stringify(out, null, 2);
    }

    function importShelf(text) {
      var file = readFile(text);
      if (file.error) return { added: 0, changed: 0, kept: 0, skipped: 0, error: file.error };
      var merged = mergeEntries(entriesFor(chosen), file.entries);
      saveShelf(chosen === 'own' ? OWN : PRACTICE, merged.entries);
      return {
        added: merged.report.added,
        changed: merged.report.changed,
        kept: merged.report.kept,
        skipped: merged.report.skipped,
        error: null
      };
    }

    function modeKey(modeId) { return MODE_PREFIX + String(modeId); }

    function modeRecord(modeId) {
      var record = readRaw(modeKey(modeId));
      return isObj(record) ? record : {};
    }

    function inputs(modeId) {
      var record = modeRecord(modeId);
      return isObj(record.inputs) ? clone(record.inputs) : {};
    }

    function setInputs(modeId, obj) {
      var record = modeRecord(modeId);
      var next = isObj(record) ? record : {};
      next.inputs = isObj(obj) ? clone(obj) : {};
      writeRaw(modeKey(modeId), next);
      return clone(next.inputs);
    }

    function seed(modeId) {
      var record = modeRecord(modeId);
      return typeof record.seed === 'number' && isFinite(record.seed) ? record.seed : null;
    }

    function setSeed(modeId, n) {
      var value = typeof n === 'number' ? n : Number(n);
      if (!isFinite(value)) return seed(modeId);
      var record = modeRecord(modeId);
      var next = isObj(record) ? record : {};
      next.seed = value;
      writeRaw(modeKey(modeId), next);
      return value;
    }

    var api = {
      which: which,
      use: use,
      shelf: shelf,
      own: own,
      practice: practice,
      practiceReset: practiceReset,
      add: add,
      setState: setState,
      setRating: setRating,
      remove: remove,
      others: others,
      addOther: addOther,
      removeOther: removeOther,
      exportShelf: exportShelf,
      importShelf: importShelf,
      inputs: inputs,
      setInputs: setInputs,
      seed: seed,
      setSeed: setSeed
    };

    // `persistent` is a property, not a call: the page reads it after any operation, and a
    // write that fails later turns it false from then on.
    Object.defineProperty(api, 'persistent', {
      enumerable: true,
      get: function () { return persistent; }
    });

    return api;
  }

  Nextbook.store.open = open;
})(window);
