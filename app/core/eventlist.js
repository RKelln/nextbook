'use strict';
// Choosing among many events: which are this week, which branch, and which few go in a picker.
// Pure functions on the event shape {id,title,start,end,branch,virtual,...}; no document, no
// storage, no clock (the caller says what today is, as 'YYYY-MM-DD'). The week rule is Search
// Desk's (MIT, same author): an event that is over is not in "this week" or "next week"; the day
// that counts is the later of its first day and today; 'this' is today to today+6, 'next' is
// today+7 to today+13.
//
//   Nextbook.eventlist.weekOf(event, today)         'past' | 'this' | 'next' | 'later' | 'unknown'
//   Nextbook.eventlist.filter(events, opts)         opts: { branch, when, today }
//   Nextbook.eventlist.branches(events)             [{ name, count }] in name order, in-person only
//   Nextbook.eventlist.pickerList(events, opts)     { events, total, capped } for the event picker
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.eventlist = Nextbook.eventlist || {};

  var ONLINE = '__online__';
  var PICKER_MAX = 150;
  var WEEK_DAYS = 7;

  function dayOf(value) {
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(typeof value === 'string' ? value : '');
    return m ? m[1] : '';
  }

  // Whole days from a to b ('YYYY-MM-DD'), by UTC arithmetic so no time zone moves a day.
  function daysBetween(a, b) {
    function ms(k) { return Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10))); }
    return Math.round((ms(b) - ms(a)) / 86400000);
  }

  function lastDay(e) {
    var s = dayOf(e.start), en = dayOf(e.end);
    return en && en >= s ? en : s;
  }

  function weekOf(e, today) {
    var s = dayOf(e && e.start);
    if (!s || !today) return 'unknown';
    if (lastDay(e) < today) return 'past';
    var n = daysBetween(today, s > today ? s : today);
    return n < WEEK_DAYS ? 'this' : (n < 2 * WEEK_DAYS ? 'next' : 'later');
  }

  function inWhen(e, when, today) {
    if (when !== 'this' && when !== 'next') return true;
    return weekOf(e, today) === when;
  }

  function inBranch(e, branch) {
    if (!branch) return true;
    if (branch === ONLINE) return e.virtual === true || !e.branch;
    return e.branch === branch;
  }

  function filter(events, opts) {
    var o = opts || {};
    return (Array.isArray(events) ? events : []).filter(function (e) {
      return e && inBranch(e, o.branch || '') && inWhen(e, o.when || 'all', o.today || '');
    });
  }

  function branches(events) {
    var counts = {};
    (Array.isArray(events) ? events : []).forEach(function (e) {
      if (!e || e.virtual === true || !e.branch) return;
      counts[e.branch] = (counts[e.branch] || 0) + 1;
    });
    return Object.keys(counts).sort(function (a, b) {
      var x = a.toLowerCase(), y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    }).map(function (name) { return { name: name, count: counts[name] }; });
  }

  // The picker lists what the events screen is looking at (its branch and week), earliest first,
  // at most PICKER_MAX. The event already chosen is always in it, so a remembered choice, or the
  // "Books for this event" button, never points at an option that is not there.
  function pickerList(events, opts) {
    var o = opts || {};
    var all = Array.isArray(events) ? events : [];
    var scoped = filter(all, { branch: o.branch, when: o.when, today: o.today });
    var keep = String(o.keep === undefined || o.keep === null ? '' : o.keep);
    var out = scoped.slice(0, o.max || PICKER_MAX);
    if (keep && !out.some(function (e) { return String(e.id) === keep; })) {
      for (var i = 0; i < all.length; i++) {
        if (String(all[i].id) === keep) { out.push(all[i]); break; }
      }
    }
    return { events: out, total: scoped.length, capped: scoped.length > out.length };
  }

  Nextbook.eventlist.ONLINE = ONLINE;
  Nextbook.eventlist.PICKER_MAX = PICKER_MAX;
  Nextbook.eventlist.dayOf = dayOf;
  Nextbook.eventlist.daysBetween = daysBetween;
  Nextbook.eventlist.weekOf = weekOf;
  Nextbook.eventlist.filter = filter;
  Nextbook.eventlist.branches = branches;
  Nextbook.eventlist.pickerList = pickerList;
})(window);
