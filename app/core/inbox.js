'use strict';
// The inbox: the one file a helper writes so the page can bring books in (D36).
//
// Search Desk's `data/inbox.js` is the pattern (MIT, same author): the agent writes
// `Nextbook.data.put('inbox', {...})`, the page reads it at load, and nothing else is asked of
// the person. This file is the reading half only. It has no document and no storage, so it can
// be tested on its own; core/shell.js applies what it accepts, once, through store.add.
//
//   var doc = Nextbook.data.get('inbox');   // null when the file is not there
//   var seen = Nextbook.inbox.check(doc, { now: new Date().toISOString() });
//   seen.ok        true when this file is one this page understands
//   seen.error     one plain sentence when it is not (wrong schema, no name)
//   seen.id        the inbox's own name, which storage remembers once it is applied
//   seen.accepted  whole shelf entries: key, state, rating, updated, title, author, ...
//   seen.refused   the names of the records that were left out
//   seen.reasons   one plain sentence for each of those, naming it
//
// Nextbook.inbox.read(records, opts) is the same reading without the wrapper, for a caller that
// already has the list. A record is left out when it is not a book, has no key, has no date, has
// a date this page cannot read, or says it changed more than a day after `opts.now`. The day of
// slack is for two clocks a few hours apart; a record from next week is a mistake, not news.
// Newer-wins is not decided here: store.add already keeps the newer entry and keeps ours on a
// tie, so this file only says what may be read, never which side is right.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.inbox = Nextbook.inbox || {};

  var SCHEMA = 'nextbook/inbox-1';
  var DAY = 24 * 60 * 60 * 1000;

  function addStrings(table) {
    Nextbook.strings = Nextbook.strings || {};
    Object.keys(table).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(Nextbook.strings, k)) Nextbook.strings[k] = table[k];
    });
  }

  function t(key, vars) {
    if (typeof Nextbook.t === 'function') return Nextbook.t(key, vars);
    return String(key);
  }

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function clone(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; }
  }

  // Date.parse is a pure function of its argument, so this file still reads no clock.
  function timeOf(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      var ms = Date.parse(value);
      if (isFinite(ms)) return ms;
    } catch (e) { /* an odd timestamp is refused as one this page cannot read */ }
    return null;
  }

  // What a refusal calls the record: its title, else its key, else where it sat in the list.
  function nameOf(record, index) {
    if (isObj(record)) {
      if (typeof record.title === 'string' && record.title.trim()) return '"' + record.title.trim() + '"';
      if (typeof record.key === 'string' && record.key) return '"' + record.key + '"';
    }
    return t('inboxChangeN', { n: index + 1 });
  }

  // One list of records in, whole shelf entries out. `opts.now` is the only thing read from
  // outside: without it the future check cannot run, and nothing else changes.
  function read(records, opts) {
    var out = { accepted: [], refused: [], reasons: [], error: '' };
    var nowMs = isObj(opts) ? timeOf(opts.now) : null;

    if (!Array.isArray(records)) {
      out.error = t('inboxNotList');
      return out;
    }

    for (var i = 0; i < records.length; i++) {
      var raw = records[i];
      var name = nameOf(raw, i);

      if (!isObj(raw)) {
        out.refused.push(name);
        out.reasons.push(t('inboxNotBook', { n: i + 1 }));
        continue;
      }
      if (typeof raw.key !== 'string' || !raw.key) {
        out.refused.push(name);
        out.reasons.push(t('inboxNoKey', { name: name }));
        continue;
      }
      if (typeof raw.updated !== 'string' || !raw.updated) {
        out.refused.push(name);
        out.reasons.push(t('inboxNoDate', { name: name }));
        continue;
      }
      var at = timeOf(raw.updated);
      if (at === null) {
        out.refused.push(name);
        out.reasons.push(t('inboxBadDate', { name: name }));
        continue;
      }
      if (nowMs !== null && at - nowMs > DAY) {
        out.refused.push(name);
        out.reasons.push(t('inboxFuture', { name: name }));
        continue;
      }

      var entry = clone(raw);
      if (!isObj(entry)) {
        out.refused.push(name);
        out.reasons.push(t('inboxNotBook', { n: i + 1 }));
        continue;
      }
      out.accepted.push(entry);
    }
    return out;
  }

  // The whole file: the wrapper checked first, then the records. `ok: false` carries one plain
  // sentence and no accepted entries, so a caller cannot half-apply a file it does not know.
  function check(doc, opts) {
    if (!isObj(doc)) return { ok: false, error: t('inboxMissing') };
    if (doc.schema !== SCHEMA) return { ok: false, error: t('inboxWrongSchema') };
    var id = typeof doc.id === 'string' ? doc.id.trim() : '';
    if (!id) return { ok: false, error: t('inboxNoId') };

    var seen = read(doc.records, opts);
    if (seen.error) return { ok: false, error: seen.error };
    return {
      ok: true,
      id: id,
      source: typeof doc.source === 'string' ? doc.source : '',
      accepted: seen.accepted,
      refused: seen.refused,
      reasons: seen.reasons
    };
  }

  Nextbook.inbox.SCHEMA = SCHEMA;
  Nextbook.inbox.read = read;
  Nextbook.inbox.check = check;

  // Every word this file says. Grade 6: short sentences, and no claim that the app knows best.
  addStrings({
    inboxMissing: 'There is no note from your helper, so nothing was brought in.',
    inboxWrongSchema: 'That note was saved by a different version of the app, so nothing was brought in.',
    inboxNoId: 'That note has no name, so nothing was brought in.',
    inboxNotList: 'That note has no list of books, so nothing was brought in.',
    inboxChangeN: 'change {n}',
    inboxNotBook: 'Change {n} from your helper is not a book, so it was left out.',
    inboxNoKey: '{name} has no key, so it was left out.',
    inboxNoDate: '{name} has no date, so it was left out.',
    inboxBadDate: '{name} has a date this page cannot read, so it was left out.',
    inboxFuture: '{name} says it was changed after today, so it was left out.'
  });
})(window);
