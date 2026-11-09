'use strict';
// The only network code in the app: ask one events service for the library's list of events.
//
// Ported from searchdesk/core/net.js (MIT, same author), with the library named in data and
// not in code: the service's address and the library's organiser ids come from the slice,
// `library.events` (docs/DATA.md), so another library is one file.
//
// What this file may do, and nothing else:
//   - GET, over https, to the one host named by `library.events.apiUrl`. No other address, no
//     other method, no cookies (`credentials: 'omit'`), no redirects, a time limit and a size
//     limit on every answer.
//   - It sends no shelf data. The request is the dates and the organiser ids, which are the
//     library's, and nothing about a person or their books.
//   - It asks only after the person pressed the button on the events screen (`setEnabled`), and
//     never in a workshop copy (`Nextbook.workshop()`), and never when the slice names no service.
//   - A mode gets `ctx.events`, a copy, and is told by the contract check not to name this module.
//     That check is a lint on honest code, not a sandbox.
//
//   Nextbook.net.available()           true when this copy may offer the button at all
//   Nextbook.net.enabled()             true when the person said yes, and it is still allowed
//   Nextbook.net.setEnabled(on)        remember the choice. Off forgets the saved list as well, and
//                                      stops a fetch already on its way: nothing is saved after it.
//   Nextbook.net.today(now)            today's date ('YYYY-MM-DD') in the library's own time zone
//   Nextbook.net.current()             what to show now, no network:
//                                      { events, source: 'cache'|'snapshot', fetched, note }
//   Nextbook.net.refresh({ force })    when enabled, fetch if the saved list is older than 12 hours
//                                      (or force). Resolves to current(), with `note` set on failure.
//   Nextbook.net.onChange = fn         called after a good fetch, so the screen can be drawn again
//   Nextbook.net.normalise(item)       one service item -> the event shape, or null
//   Nextbook.net.get(url, opts)        the one GET (exposed so a test can prove what it refuses)
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.net = Nextbook.net || {};

  var CACHE_KEY = 'nextbook1:events';
  var CHOICE_KEY = 'nextbook1:events-live';
  var FRESH_MS = 12 * 3600 * 1000;
  var PAGE = 200, MAX_PAGES = 20, MAX_EVENTS = 6000, TIMEOUT = 15000, MAX_BYTES = 5 * 1024 * 1024;
  var DEADLINE = 120000;            // one refresh, all its requests together
  var DEFAULT_DAYS = 21;
  var SUMMARY_MAX = 300;
  var inflight = null, lastNote = '';
  var held = null;                  // the list just fetched, for a browser that would not keep it
  var epoch = 0;                    // moves when the person turns it off or on, so an old fetch knows
  var live = [];                    // the abort controllers of requests on their way

  function addStrings(table) {
    Nextbook.strings = Nextbook.strings || {};
    Object.keys(table).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(Nextbook.strings, k)) Nextbook.strings[k] = table[k];
    });
  }

  addStrings({
    netNoteCache: 'The latest list could not be loaded, so this is the list saved on this device.',
    netNoteSnapshot: 'The latest list could not be loaded, so this is the list that came with this copy.',
    netNotePartial: 'Part of the latest list could not be loaded, so some events may be missing.',
    netNoneBack: 'The events service sent no events.',
    netErrHost: 'That address is not allowed.',
    netErrNone: 'This copy has no events address, so nothing was fetched.',
    netErrFetch: 'This browser cannot fetch.',
    netErrTime: 'The events service took too long.',
    netErrStatus: 'The events service answered {status}.',
    netErrBig: 'The events answer was too big.',
    netErrForm: 'The events answer was not in the expected form.',
    netErrDown: 'The events service did not answer.',
    netErrStopped: 'The latest list was stopped.',
    netErrDeadline: 'Getting the latest list took too long.'
  });

  function t(key, vars) {
    return typeof Nextbook.t === 'function' ? Nextbook.t(key, vars) : String(key);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  // ---- Pure helpers ---------------------------------------------------------------------------
  // The service sends some text still HTML-encoded ("Toronto&#39;s"). Decode the common entities
  // to plain characters; the result is only ever shown as text, so a decoded "<" is harmless.
  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–',
    mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };

  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, function (all, e) {
      if (e.charAt(0) !== '#') {
        var low = e.toLowerCase();
        return has(NAMED, low) ? NAMED[low] : all;
      }
      var n = (e.charAt(1) === 'x' || e.charAt(1) === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
    });
  }

  function tidy(s, limit) {
    s = typeof s === 'string' ? decodeEntities(s).replace(/\s+/g, ' ').replace(/^ | $/g, '') : '';
    return s.length > limit ? s.slice(0, limit).replace(/ $/, '') : s;
  }

  // Some place names arrive as "MalvernEvent location: Malvern": keep the part after the label.
  function tidyPlace(s, limit) {
    s = tidy(s, 1000);
    var m = /^(.*?)\s*Event location:\s*(.+)$/.exec(s);
    return tidy(m ? m[2] : s, limit);
  }

  function hostOf(u) {
    var m = /^https:\/\/([^\/?#]+)/.exec(typeof u === 'string' ? u : '');
    return m ? m[1] : '';
  }

  // The url if it is a usable https link, else ''.
  function httpsUrl(u) {
    if (typeof u !== 'string') return '';
    u = u.replace(/^\s+|\s+$/g, '');
    if (u.length < 12 || u.length > 500 || !/^https:\/\/[^\s<>"']+$/.test(u)) return '';
    var host = hostOf(u);
    return host && host.indexOf('@') < 0 ? u : '';
  }

  // '2026-10-22T18:30:00-04:00' -> '2026-10-22T18:30:00': the library's own wall clock, as the
  // snapshot writes it (the offset already says the library's time). A date alone stays a date.
  function localTime(v) {
    if (typeof v !== 'string') return '';
    var m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?)?/.exec(v.replace(/^\s+/, ''));
    return m ? m[1] + (m[2] ? 'T' + m[2] + ':' + (m[3] || '00') : '') : '';
  }

  // The words the service puts first on some listings ("More info:" and an address, then "Hosted by ...")
  // are a pointer, not a summary. Only the clean part is dropped: "More info:" and its address.
  function summaryOf(text) {
    var s = tidy(text, 5000).replace(/^More info:\s*https?:\/\/\S+\s*/i, '');
    s = s.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, '');
    if (s.length <= SUMMARY_MAX) return s;
    var cut = s.slice(0, SUMMARY_MAX - 4);
    if (cut.indexOf(' ') !== -1) cut = cut.replace(/ [^ ]*$/, '');
    return cut.replace(/[ ,;:.!?-]+$/, '') + ' ...';
  }

  // A link is kept only when it is on the events host, or (for an online event's own page) on one of
  // the library's hosts named in the slice. Anything else, from the service or from a saved list, is
  // dropped to '': a title with no link is better than a link the library never made.
  function linkOn(url, virtual) {
    var cfg = config();
    var u = httpsUrl(url);
    if (!cfg || !u) return '';
    var host = hostOf(u).toLowerCase().replace(/:\d+$/, '');
    if (host === cfg.host.replace(/:\d+$/, '')) return u;
    return virtual && cfg.libraryHosts.indexOf(host) !== -1 ? u : '';
  }

  function normalise(item) {
    if (!isObj(item)) return null;
    var page = linkOn(item['@id'], false);
    var id = page ? page.replace(/\/+$/, '').split('/').pop() : '';
    var title = tidy(item.name, 200), start = localTime(item.startDate);
    if (!/^[0-9A-Za-z]{6,40}$/.test(id) || !title || !start) return null;
    var end = localTime(item.endDate);
    var place = isObj(item.location) ? item.location : {};
    var name = tidyPlace(place.name, 120);
    var virtual = !name || String(place['@type']) === 'VirtualLocation';
    var cats = [];
    (Array.isArray(item.keywords) ? item.keywords : []).forEach(function (k) {
      k = tidy(k, 40);
      if (k && cats.indexOf(k) < 0) cats.push(k);
    });
    // A virtual place may carry the listing's own page; the list gives no such link for the rest
    // (the detail does, and a browser cannot afford one request per event), so those use the
    // service's own page for the event.
    var url = virtual ? (linkOn(place.url, true) || page) : page;
    return {
      id: id, title: title, start: start, end: end >= start ? end : '',
      branch: virtual ? '' : name, virtual: virtual, categories: cats.slice(0, 8),
      summary: summaryOf(item.description), url: url
    };
  }

  // A stored event (the cache) in the safe shape, or null. The same limits as normalise.
  function cleanEvent(e) {
    if (!isObj(e)) return null;
    var id = typeof e.id === 'string' ? e.id : '', title = tidy(e.title, 200), start = localTime(e.start);
    if (!id || id.length > 60 || !title || !start || start.length !== String(e.start).length) return null;
    var end = localTime(e.end);
    var summary = typeof e.summary === 'string' ? tidy(e.summary, SUMMARY_MAX) : '';
    return {
      id: id, title: title, start: start, end: end >= start ? end : '',
      branch: tidyPlace(e.branch, 120), virtual: e.virtual === true,
      categories: (Array.isArray(e.categories) ? e.categories : []).filter(function (c) {
        return typeof c === 'string' && c;
      }).map(function (c) { return tidy(c, 40); }).slice(0, 8),
      summary: summary, url: linkOn(e.url, e.virtual === true)
    };
  }

  function cleanList(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (e) {
      var c = cleanEvent(e);
      if (c) out.push(c);
    });
    return out;
  }

  function byStart(a, b) {
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    var x = a.title.toLowerCase(), y = b.title.toLowerCase();
    if (x !== y) return x < y ? -1 : 1;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  // responses: one list of service items for each organiser. A repeat id is kept once.
  function normaliseAll(responses) {
    var seen = {}, out = [];
    (responses || []).forEach(function (items) {
      (items || []).forEach(function (item) {
        var ev = normalise(item);
        if (!ev || has(seen, ev.id)) return;
        seen[ev.id] = true;
        out.push(ev);
      });
    });
    return out.sort(byStart);
  }

  // ---- The library's own clock ------------------------------------------------------------------
  // "Today" and the time a list was asked for are the library's: a person abroad, or a browser with
  // the wrong zone, still sees the library's week. With no usable zone the browser's own clock is used.
  function validZone(name) {
    try { new window.Intl.DateTimeFormat('en-CA', { timeZone: name }); return true; } catch (e) { return false; }
  }

  function zoneParts(ms) {
    var cfg = config();
    if (cfg && cfg.zone) {
      try {
        var f = new window.Intl.DateTimeFormat('en-CA', {
          timeZone: cfg.zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        var o = {};
        f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
        if (o.year && o.month && o.day && o.hour !== undefined) {
          return { y: o.year, m: o.month, d: o.day, h: o.hour === '24' ? '00' : o.hour, mi: o.minute, s: o.second };
        }
      } catch (e) { /* the browser's own clock below */ }
    }
    var d = new Date(ms);
    return { y: String(d.getFullYear()), m: pad(d.getMonth() + 1), d: pad(d.getDate()),
      h: pad(d.getHours()), mi: pad(d.getMinutes()), s: pad(d.getSeconds()) };
  }

  function today(now) {
    var p = zoneParts(now === undefined ? Date.now() : new Date(now).getTime());
    return p.y + '-' + p.m + '-' + p.d;
  }

  // ---- The address and the switches -----------------------------------------------------------
  function config() {
    var slice = null;
    try { slice = Nextbook.data.get('slice'); } catch (e) { slice = null; }
    var ev = isObj(slice) && isObj(slice.library) && isObj(slice.library.events) ? slice.library.events : null;
    if (!ev || ev.service !== 'togather') return null;
    var api = typeof ev.apiUrl === 'string' && /^https:\/\/[^\s\/?#]+\//.test(ev.apiUrl) && ev.apiUrl.indexOf('?') < 0
      ? ev.apiUrl : '';
    var ids = (Array.isArray(ev.organizerIds) ? ev.organizerIds : []).filter(function (id) {
      return typeof id === 'string' && /^[0-9A-Za-z]{10,40}$/.test(id);
    });
    if (!api || !ids.length) return null;
    var days = typeof ev.days === 'number' && ev.days >= 1 && ev.days <= 60 ? Math.floor(ev.days) : DEFAULT_DAYS;
    var hosts = [];
    (function walk(v, depth) {
      if (typeof v === 'string') {
        var h = hostOf(v).toLowerCase();
        if (h && hosts.indexOf(h) === -1) hosts.push(h);
      } else if (isObj(v) && depth < 4) {
        Object.keys(v).forEach(function (k) { if (k !== 'events') walk(v[k], depth + 1); });
      }
    })(slice.library, 0);
    var zone = typeof ev.timeZone === 'string' && validZone(ev.timeZone) ? ev.timeZone : '';
    return { api: api, host: hostOf(api).toLowerCase(), organizerIds: ids, days: days, libraryHosts: hosts, zone: zone };
  }

  function storage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  function readItem(key) {
    try { var st = storage(); return st ? st.getItem(key) : null; } catch (e) { return null; }
  }

  function writeItem(key, value) {
    try {
      var st = storage();
      if (!st) return false;
      st.setItem(key, value);
      return true;
    } catch (e) { return false; }                 // full or blocked: the page does not break
  }

  function removeItem(key) {
    try { var st = storage(); if (st) st.removeItem(key); } catch (e) { /* nothing to remove */ }
  }

  function inWorkshop() {
    try { return Nextbook.workshop() === true; } catch (e) { return true; }
  }

  function available() {
    return !!config() && !inWorkshop() && typeof window.fetch === 'function';
  }

  function enabled() { return available() && readItem(CHOICE_KEY) === '1'; }

  function stopLive() {
    epoch += 1;                                       // every fetch on its way is now out of date
    var list = live.slice();
    live = [];
    list.forEach(function (ctl) { try { ctl.abort(); } catch (e) { /* already done */ } });
    inflight = null;
  }

  function setEnabled(on) {
    if (on && !available()) return false;
    if (on) {
      var saved = writeItem(CHOICE_KEY, '1');
      if (saved) epoch += 1;
      return saved;
    }
    stopLive();                                       // a fetch under way must not save anything after this
    removeItem(CHOICE_KEY);
    removeItem(CACHE_KEY);
    lastNote = '';
    held = null;
    return true;
  }

  // ---- GET ------------------------------------------------------------------------------------
  // opts: timeout (ms, one request), deadline (a Date.now() value for the whole refresh).
  function get(url, opts) {
    var timeout = opts && typeof opts.timeout === 'number' && opts.timeout > 0 ? opts.timeout : TIMEOUT;
    var deadline = opts && typeof opts.deadline === 'number' ? opts.deadline : 0;
    return new Promise(function (resolve, reject) {
      var cfg = config();
      if (!cfg || inWorkshop()) { reject(new Error(t('netErrNone'))); return; }
      var u = typeof url === 'string' ? url : '';
      if (!/^https:\/\//.test(u) || hostOf(u).toLowerCase() !== cfg.host) { reject(new Error(t('netErrHost'))); return; }
      if (typeof window.fetch !== 'function') { reject(new Error(t('netErrFetch'))); return; }
      if (deadline) {
        var left = deadline - Date.now();
        if (left <= 0) { reject(new Error(t('netErrDeadline'))); return; }
        if (left < timeout) timeout = left;
      }
      var ctl = typeof window.AbortController === 'function' ? new window.AbortController() : null;
      if (ctl) live.push(ctl);
      function done() {
        var i = live.indexOf(ctl);
        if (i !== -1) live.splice(i, 1);
      }
      var timer = setTimeout(function () {                           // one-shot, cleared below
        if (ctl) ctl.abort();
        done();
        reject(new Error(t('netErrTime')));
      }, timeout);
      window.fetch(u, {
        method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined
      })
        .then(function (res) {
          if (!res.ok) throw new Error(t('netErrStatus', { status: res.status }));
          return res.text();
        })
        .then(function (text) {
          if (text.length > MAX_BYTES) throw new Error(t('netErrBig'));
          return JSON.parse(text);
        })
        .then(function (data) { clearTimeout(timer); done(); resolve(data); },
          function (e) { clearTimeout(timer); done(); reject(e instanceof Error ? e : new Error(t('netErrDown'))); });
    });
  }

  // ---- The snapshot and the saved list --------------------------------------------------------
  function stamp(ms) {
    var p = zoneParts(ms);
    return p.y + '-' + p.m + '-' + p.d + 'T' + p.h + ':' + p.mi + ':' + p.s;
  }

  function snapshot() {
    var s = null;
    try { s = Nextbook.data.get('events'); } catch (e) { s = null; }
    if (!isObj(s) || !Array.isArray(s.events)) return { events: [], fetched: '', doc: null };
    return { events: s.events.filter(isObj), fetched: typeof s.fetched === 'string' ? s.fetched : '', doc: s };
  }

  function readCache() {
    var cfg = config();
    if (!cfg) return null;
    try {
      var c = JSON.parse(readItem(CACHE_KEY));
      if (isObj(c) && typeof c.fetched === 'number' && c.api === cfg.api && Array.isArray(c.events)) {
        return { fetched: c.fetched, partial: c.partial === true, events: cleanList(c.events) };
      }
    } catch (e) { /* no saved list */ }
    return null;
  }

  function writeCache(fetched, events, partial) {
    var cfg = config();
    if (!cfg) return false;
    return writeItem(CACHE_KEY, JSON.stringify({ fetched: fetched, api: cfg.api, partial: !!partial, events: events }));
  }

  // What to show now. A saved latest list is used only while the person's yes stands.
  function current() {
    var c = enabled() ? readCache() : null;
    if (c && c.events.length) return { events: c.events, source: 'cache', fetched: stamp(c.fetched), note: lastNote };
    var s = snapshot();
    return { events: s.events, source: 'snapshot', fetched: s.fetched, note: lastNote };
  }

  // ---- The live fetch -------------------------------------------------------------------------
  function listUrl(cfg, organizer, startDay, endDay, cursor) {
    var q = [['startDate', startDay], ['endDate', endDay], ['limit', String(PAGE)], ['context', 'document'],
      ['organizerId', organizer]];
    if (cursor) q.push(['after', cursor]);
    return cfg.api + '?' + q.map(function (p) {
      return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]);
    }).join('&');
  }

  // `go()` says whether this fetch is still wanted: the person may have pressed "Stop" meanwhile.
  function fetchOrganizer(cfg, organizer, startDay, endDay, go, deadline) {
    var items = [];
    function page(n, cursor) {
      if (!go()) return Promise.reject(new Error(t('netErrStopped')));
      return get(listUrl(cfg, organizer, startDay, endDay, cursor), { deadline: deadline }).then(function (d) {
        if (!isObj(d) || !Array.isArray(d.items)) throw new Error(t('netErrForm'));
        items = items.concat(d.items);
        var next = typeof d.next_cursor === 'string' ? d.next_cursor : '';
        if (next && (n >= MAX_PAGES || items.length >= MAX_EVENTS)) return { items: items, truncated: true };
        if (next) return page(n + 1, next);
        return { items: items, truncated: false };
      });
    }
    return page(1, '');
  }

  // Each organiser is its own request chain, one at a time. The service lists the library under
  // more than one id, and one that fails or is empty must not sink the rest. A chain stopped by a
  // cap while the service still had more is counted as partial, so the page says so.
  function fetchAll(now, go, deadline) {
    var cfg = config();
    var startDay = today(now), end = today(new Date(now).getTime() + cfg.days * 86400000);
    var responses = [], failed = 0, chain = Promise.resolve();
    cfg.organizerIds.forEach(function (organizer) {
      chain = chain
        .then(function () { return fetchOrganizer(cfg, organizer, startDay, end, go, deadline); })
        .then(function (got) {
          responses.push(got.items);
          if (got.truncated) failed += 1;
        }, function (e) {
          if (!go()) throw e;                         // stopped: nothing more is asked
          failed += 1;
          if (typeof console !== 'undefined' && console.warn) console.warn('nextbook: one events list failed.', e);
        });
    });
    return chain.then(function () {
      var events = normaliseAll(responses);
      var cut = events.length > MAX_EVENTS;
      return { events: events.slice(0, MAX_EVENTS), partial: failed > 0 || cut };
    });
  }

  function refresh(opts) {
    opts = opts || {};
    if (!enabled()) return Promise.resolve(current());
    var now = opts.now !== undefined ? new Date(opts.now).getTime() : Date.now();
    var c = readCache();
    if (!opts.force && c && !c.partial && c.events.length && now - c.fetched >= 0 && now - c.fetched < FRESH_MS) {
      return Promise.resolve(current());
    }
    if (inflight) return inflight;
    var mine = epoch;
    function go() { return mine === epoch && enabled(); }
    var deadline = Date.now() + (typeof opts.deadlineMs === 'number' ? opts.deadlineMs : DEADLINE);
    var run = fetchAll(now, go, deadline).then(function (got) {
      if (!go()) throw new Error(t('netErrStopped'));
      if (!got.events.length) throw new Error(t('netNoneBack'));
      writeCache(now, got.events, got.partial);
      lastNote = got.partial ? t('netNotePartial') : '';
      var res = current();
      // A write that did not take leaves no saved list: show what was just fetched anyway.
      if (res.source !== 'cache') res = { events: got.events, source: 'cache', fetched: stamp(now), note: lastNote };
      held = res;
      if (typeof Nextbook.net.onChange === 'function') {
        try { Nextbook.net.onChange(res); } catch (e) { /* drawing is not our job */ }
      }
      return res;
    }).catch(function (e) {
      if (mine !== epoch) return current();            // stopped by the person: say nothing, keep nothing
      if (typeof console !== 'undefined' && console.warn) console.warn('nextbook: the latest events failed.', e);
      held = null;
      lastNote = t(readCache() ? 'netNoteCache' : 'netNoteSnapshot');
      return current();
    }).then(function (res) { if (inflight === run) inflight = null; return res; });
    inflight = run;
    return run;
  }

  function shown() {
    var c = current();
    if (c.source === 'snapshot' && held && enabled()) return held;
    return c;
  }

  Nextbook.net.available = available;
  Nextbook.net.enabled = enabled;
  Nextbook.net.setEnabled = setEnabled;
  Nextbook.net.current = shown;
  Nextbook.net.refresh = refresh;
  Nextbook.net.get = get;
  Nextbook.net.today = today;
  Nextbook.net.config = config;
  Nextbook.net.normalise = normalise;
  Nextbook.net.normaliseAll = normaliseAll;
  Nextbook.net.cleanEvent = cleanEvent;
  Nextbook.net.tidy = tidy;
  Nextbook.net.tidyPlace = tidyPlace;
  Nextbook.net.FRESH_MS = FRESH_MS;
  Nextbook.net.CACHE_KEY = CACHE_KEY;
  Nextbook.net.CHOICE_KEY = CHOICE_KEY;
})(window);
