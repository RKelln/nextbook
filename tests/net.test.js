'use strict';
// core/net.js, the only network code: what it refuses, how it reads the service's answer, and how
// it keeps and falls back. A fake fetch stands in for the network; no test touches a real one.
//
//   N1  it asks only the configured host, over https, by GET, with no cookies and no redirects
//   N2  nothing is asked until the person said yes; a workshop copy and a slice with no service never ask
//   N3  an item becomes the event shape: local clock, tidy place, summary at most 300, no description
//   N4  the three organiser ids are fetched, pages followed, repeats kept once; one failing does not sink the rest
//   N5  a fresh saved list is used without asking; a stale one is refreshed; a failure falls back with a note
//   N6  a browser that will not keep the list still shows it; a bad answer is refused
//   N7  turning it off forgets the saved list and the choice
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_load.js');

const plain = (value) => JSON.parse(JSON.stringify(value));
const API = 'https://events.example.test/api/v1/events';
const ORG = ['01AAAAAAAAAAAAAAAAAAAAAAAA', '01BBBBBBBBBBBBBBBBBBBBBBBB', '01CCCCCCCCCCCCCCCCCCCCCCCC'];
const SLICE = { library: { name: 'Example Library', recordIdUrl: 'https://tpl.example.test/record/{id}', events: { service: 'togather', apiUrl: API, organizerIds: ORG, days: 21 } } };

function memoryStorage(opts) {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) { if (opts && opts.full) throw new Error('quota'); map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
}

const item = (n, extra) => Object.assign({
  '@id': 'https://events.example.test/events/01ABCDEF' + String(n).padStart(4, '0'),
  name: 'Event ' + n, description: 'Words about ' + n + '.', keywords: ['crafts & hobbies'],
  startDate: '2026-11-09T13:30:00-05:00', endDate: '2026-11-09T15:00:00-05:00',
  location: { '@type': 'Place', name: 'Malvern', address: { streetAddress: '30 Sewells Road' }, geo: { latitude: 43.8, longitude: -79.2 } },
}, extra || {});

// A fake service. `pages` maps organiser id to a list of pages; a function answers instead.
function service(pages, log) {
  return function fetch(url, init) {
    log.push({ url, init });
    const u = new URL(url);
    const org = u.searchParams.get('organizerId');
    const cursor = u.searchParams.get('after');
    const list = pages[org];
    if (typeof list === 'function') return list(u);
    if (!list) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    const i = cursor ? Number(cursor) : 0;
    const body = { items: list[i], next_cursor: i + 1 < list.length ? String(i + 1) : '', timeZone: 'America/Toronto' };
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
  };
}

function page(extra) {
  const log = [];
  const storage = (extra && extra.storage) || memoryStorage();
  const nb = load(['app/core/base.js', 'app/core/net.js'], {
    fetch: extra && extra.pages ? service(extra.pages, log) : undefined,
    localStorage: storage,
    AbortController,
  });
  nb.data.put('slice', (extra && extra.slice) || SLICE);
  if (extra && extra.workshop) nb.data.put('workshop', { workshop: true });
  if (extra && extra.snapshot) nb.data.put('events', extra.snapshot);
  return { nb, log, storage };
}

const SNAP = { fetched: '2026-11-03T19:49:50-05:00', branch: 'CL', window: { start: 'a', end: 'b' }, source: 's',
  events: [{ id: 's1', title: 'Snap', start: '2026-11-04T10:00:00', end: '', branch: 'North York Central Library', virtual: false, categories: [], summary: '', url: 'https://x.test/e' }] };

test('N1: get asks only the configured host, over https, and nothing else', async () => {
  const { nb, log } = page({ pages: { [ORG[0]]: [[item(1)]] } });
  await assert.rejects(nb.net.get('http://events.example.test/api/v1/events'), /not allowed/);
  await assert.rejects(nb.net.get('https://elsewhere.test/api/v1/events'), /not allowed/);
  await assert.rejects(nb.net.get('https://events.example.test.evil.test/x'), /not allowed/);
  assert.strictEqual(log.length, 0, 'a refused address is never sent');
  await nb.net.get(API + '?organizerId=' + ORG[0]);
  assert.strictEqual(log.length, 1);
  const init = log[0].init;
  assert.strictEqual(init.method, 'GET');
  assert.strictEqual(init.credentials, 'omit');
  assert.strictEqual(init.redirect, 'error');
  assert.strictEqual(init.body, undefined, 'a GET has no body');
});

test('N1b: a slow answer and an answer that is too big are refused', async () => {
  const slow = page({ pages: { [ORG[0]]: () => new Promise(() => {}) } });
  await assert.rejects(slow.nb.net.get(API + '?organizerId=' + ORG[0], { timeout: 20 }), /too long/);
  const big = page({ pages: { [ORG[0]]: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('x'.repeat(5 * 1024 * 1024 + 1)) }) } });
  await assert.rejects(big.nb.net.get(API + '?organizerId=' + ORG[0]), /too big/);
});

test('N2: nothing is asked without a yes, in a workshop copy, or with no service named', async () => {
  const a = page({ pages: { [ORG[0]]: [[item(1)]] }, snapshot: SNAP });
  assert.strictEqual(a.nb.net.available(), true);
  assert.strictEqual(a.nb.net.enabled(), false);
  const r = await a.nb.net.refresh();
  assert.strictEqual(a.log.length, 0, 'no yes, no request');
  assert.strictEqual(r.source, 'snapshot');

  const w = page({ pages: { [ORG[0]]: [[item(1)]] }, workshop: true, snapshot: SNAP });
  assert.strictEqual(w.nb.net.available(), false);
  assert.strictEqual(w.nb.net.setEnabled(true), false);
  await w.nb.net.refresh({ force: true });
  assert.strictEqual(w.log.length, 0);

  const none = page({ pages: { [ORG[0]]: [[item(1)]] }, slice: { library: { name: 'X' } } });
  assert.strictEqual(none.nb.net.available(), false);
  const bad = page({ slice: { library: { events: { service: 'togather', apiUrl: 'http://x.test/a/', organizerIds: ORG } } } });
  assert.strictEqual(bad.nb.net.available(), false, 'an http address is not a service');
});

test('N3: an item becomes the event shape', () => {
  const { nb } = page();
  const e = plain(nb.net.normalise(item(7, {
    name: 'Knit &amp; Crochet', description: 'More info: https://example.test/x Hosted by Someone. <b>Bring</b> yarn &#39;n needles.',
    location: { '@type': 'Place', name: 'MalvernEvent location: Malvern' },
  })));
  assert.deepStrictEqual(Object.keys(e).sort(), ['branch', 'categories', 'end', 'id', 'start', 'summary', 'title', 'url', 'virtual']);
  assert.strictEqual(e.id, '01ABCDEF0007');
  assert.strictEqual(e.title, 'Knit & Crochet');
  assert.strictEqual(e.start, '2026-11-09T13:30:00', 'the library wall clock, as the snapshot writes it');
  assert.strictEqual(e.end, '2026-11-09T15:00:00');
  assert.strictEqual(e.branch, 'Malvern');
  assert.strictEqual(e.virtual, false);
  assert.strictEqual(e.url, 'https://events.example.test/events/01ABCDEF0007');
  assert.ok(!/More info/.test(e.summary) && /Hosted by Someone/.test(e.summary), 'only the clean pointer is dropped');
  assert.ok(e.summary.indexOf('<') === -1);
  const long = nb.net.normalise(item(8, { description: 'word '.repeat(200) }));
  assert.ok(long.summary.length <= 300, 'summary is at most 300');
  assert.strictEqual(nb.net.normalise(item(9, { name: '' })), null);
  assert.strictEqual(nb.net.normalise(item(9, { startDate: 'soon' })), null);
  assert.strictEqual(nb.net.normalise(item(9, { '@id': 'http://x.test/events/01ABCDEF0009' })), null);
  const v = plain(nb.net.normalise(item(10, { location: { '@type': 'VirtualLocation', url: 'https://tpl.example.test/events/abc123' } })));
  assert.strictEqual(v.virtual, true);
  assert.strictEqual(v.branch, '');
  assert.strictEqual(v.url, 'https://tpl.example.test/events/abc123', 'a virtual event carries the listing page when it has one');
  const noLoc = plain(nb.net.normalise(item(11, { location: undefined })));
  assert.strictEqual(noLoc.virtual, true);
  assert.strictEqual(noLoc.url, 'https://events.example.test/events/01ABCDEF0011');
});

test('N4: every organiser is fetched, pages followed, repeats kept once, one failure does not sink the rest', async () => {
  const { nb, log, storage } = page({
    pages: { [ORG[0]]: [[item(1), item(2)], [item(3)]], [ORG[1]]: [[item(3), item(4)]] }, // ORG[2] answers 404
  });
  assert.strictEqual(nb.net.setEnabled(true), true);
  const r = plain(await nb.net.refresh({ now: Date.parse('2026-11-08T12:00:00') }));
  assert.deepStrictEqual(r.events.map((e) => e.title), ['Event 1', 'Event 2', 'Event 3', 'Event 4']);
  assert.strictEqual(r.source, 'cache');
  assert.match(r.note, /Part of the latest list/);
  const urls = log.map((l) => new URL(l.url));
  assert.ok(urls.every((u) => u.host === 'events.example.test'));
  assert.deepStrictEqual([...new Set(urls.map((u) => u.searchParams.get('organizerId')))], ORG);
  assert.strictEqual(urls[0].searchParams.get('startDate'), '2026-11-08');
  assert.strictEqual(urls[0].searchParams.get('endDate'), '2026-11-29', 'today and 21 days');
  assert.strictEqual(urls[0].searchParams.get('limit'), '200');
  assert.strictEqual(urls[0].searchParams.get('context'), 'document');
  assert.ok(log.every((l) => !/shelf|book|title/i.test(new URL(l.url).search)), 'nothing about books is sent');
  const saved = JSON.parse(storage.getItem(nb.net.CACHE_KEY));
  assert.strictEqual(saved.events.length, 4);
  assert.ok(saved.events.every((e) => !('description' in e)), 'rule 4: no description field');
  assert.strictEqual(saved.partial, true);
});

test('N5: a fresh list is not asked again, a stale one is, a failure falls back with a note', async () => {
  const good = { [ORG[0]]: [[item(1)]], [ORG[1]]: [[item(2)]], [ORG[2]]: [[item(2)]] };
  const p = page({ pages: good, snapshot: SNAP });
  p.nb.net.setEnabled(true);
  const t0 = Date.parse('2026-11-08T12:00:00');
  await p.nb.net.refresh({ now: t0 });
  const asked = p.log.length;
  assert.strictEqual(asked, 3);
  const again = await p.nb.net.refresh({ now: t0 + 11 * 3600 * 1000 });
  assert.strictEqual(p.log.length, asked, 'under 12 hours: no request');
  assert.strictEqual(again.source, 'cache');
  await p.nb.net.refresh({ now: t0 + 13 * 3600 * 1000 });
  assert.strictEqual(p.log.length, asked * 2, 'over 12 hours: asked again');

  // The service goes away: the saved list is shown, with a note.
  const down = page({ pages: {}, snapshot: SNAP, storage: p.storage });
  down.nb.net.setEnabled(true);
  const r = plain(await down.nb.net.refresh({ force: true }));
  assert.strictEqual(r.source, 'cache');
  assert.match(r.note, /saved on this device/);
  // And with nothing saved, the snapshot.
  const bare = page({ pages: {}, snapshot: SNAP });
  bare.nb.net.setEnabled(true);
  const s = plain(await bare.nb.net.refresh({ force: true }));
  assert.strictEqual(s.source, 'snapshot');
  assert.strictEqual(s.events.length, 1);
  assert.match(s.note, /came with this copy/);
});

test('N6: a browser that will not keep the list still shows it, and a bad answer is refused', async () => {
  const full = page({ pages: { [ORG[0]]: [[item(1)]] }, storage: memoryStorage({ full: true }), snapshot: SNAP });
  // The choice cannot be saved either, so enabling reports false and nothing is asked.
  assert.strictEqual(full.nb.net.setEnabled(true), false);

  const st = memoryStorage();
  const ok = page({ pages: { [ORG[0]]: [[item(1)]] }, storage: st, snapshot: SNAP });
  ok.nb.net.setEnabled(true);
  st.setItem = (k, v) => { if (k === ok.nb.net.CACHE_KEY) throw new Error('quota'); };
  const r = plain(await ok.nb.net.refresh({ force: true }));
  assert.strictEqual(r.events[0].title, 'Event 1', 'the list just fetched is shown');
  assert.strictEqual(plain(ok.nb.net.current()).events[0].title, 'Event 1');

  const junk = page({ pages: { [ORG[0]]: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"nope":1}') }) }, snapshot: SNAP });
  junk.nb.net.setEnabled(true);
  const j = plain(await junk.nb.net.refresh({ force: true }));
  assert.strictEqual(j.source, 'snapshot');
  assert.ok(j.note);
});

test('N7: turning it off forgets the saved list and the choice', async () => {
  const p = page({ pages: { [ORG[0]]: [[item(1)]] }, snapshot: SNAP });
  p.nb.net.setEnabled(true);
  await p.nb.net.refresh({ force: true });
  assert.ok(p.storage.has(p.nb.net.CACHE_KEY) && p.storage.has(p.nb.net.CHOICE_KEY));
  p.nb.net.setEnabled(false);
  assert.ok(!p.storage.has(p.nb.net.CACHE_KEY) && !p.storage.has(p.nb.net.CHOICE_KEY));
  assert.strictEqual(plain(p.nb.net.current()).source, 'snapshot');
  assert.strictEqual(p.nb.net.enabled(), false);
});

// ---- the review's findings ------------------------------------------------------------------

test('N8: pressing Stop mid-fetch stops it, and nothing is saved afterwards', async () => {
  const gates = [];
  const log = [];
  const pagesOf = (n) => ({ items: [item(n)], next_cursor: 'more' });
  const nb = load(['app/core/base.js', 'app/core/net.js'], {
    fetch(url, init) {
      log.push({ url, signal: init.signal });
      return new Promise((resolve, reject) => {
        gates.push(() => resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(pagesOf(log.length))) }));
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
    localStorage: memoryStorage(), AbortController,
  });
  nb.data.put('slice', SLICE);
  nb.net.setEnabled(true);
  const running = nb.net.refresh({ force: true });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(log.length, 1, 'the first page is on its way');
  nb.net.setEnabled(false);
  assert.strictEqual(log[0].signal.aborted, true, 'the request on its way is aborted');
  const r = plain(await running);
  assert.strictEqual(r.source, 'snapshot');
  assert.strictEqual(log.length, 1, 'no second request after Stop');
  assert.strictEqual(nb.net.enabled(), false);
  assert.strictEqual(nb.net.current().events.length, 0);
});

test('N8b: a page that arrives after Stop is not saved and does not bring the list back', async () => {
  const storage = memoryStorage();
  let release;
  const nb = load(['app/core/base.js', 'app/core/net.js'], {
    fetch: () => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ items: [item(1)], next_cursor: '' })) }); }),
    localStorage: storage, AbortController,   // this fetch ignores the abort signal, as a stubborn one might
  });
  nb.data.put('slice', SLICE);
  nb.net.setEnabled(true);
  const running = nb.net.refresh({ force: true });
  await new Promise((r) => setImmediate(r));
  nb.net.setEnabled(false);
  release();
  await running;
  assert.ok(!storage.has(nb.net.CACHE_KEY), 'nothing written after Stop');
  assert.strictEqual(plain(nb.net.current()).events.length, 0);
});

test('N9: a chain cut short by a cap that still had more is said to be partial', async () => {
  const log = [];
  const fetch = (url) => {
    log.push(url);
    const n = log.length;
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ items: [item(n)], next_cursor: 'c' + n })) });
  };
  const nb = load(['app/core/base.js', 'app/core/net.js'], { fetch, localStorage: memoryStorage(), AbortController });
  nb.data.put('slice', Object.assign({}, SLICE, { library: Object.assign({}, SLICE.library, { events: Object.assign({}, SLICE.library.events, { organizerIds: [ORG[0]] }) }) }));
  nb.net.setEnabled(true);
  const r = plain(await nb.net.refresh({ force: true }));
  assert.strictEqual(log.length, 20, 'twenty pages and no more');
  assert.match(r.note, /Part of the latest list/);
});

test('N10: today and the stamp are the library\'s, whatever the browser thinks', () => {
  const mk = (zone) => {
    const nb = load(['app/core/base.js', 'app/core/net.js'], { localStorage: memoryStorage() });
    nb.data.put('slice', { library: { events: Object.assign({}, SLICE.library.events, { timeZone: zone }) } });
    return nb;
  };
  const late = Date.parse('2026-11-08T23:30:00-05:00');
  assert.strictEqual(mk('America/Toronto').net.today(late), '2026-11-08');
  assert.strictEqual(mk('Asia/Tokyo').net.today(late), '2026-11-09');
  assert.strictEqual(mk('Not/AZone').net.today(late).length, 10, 'a bad zone falls back to the browser clock');
});

test('N10b: the query window starts on the library\'s today', async () => {
  const log = [];
  const nb = load(['app/core/base.js', 'app/core/net.js'], {
    fetch(url, init) { log.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"items":[],"next_cursor":""}') }); },
    localStorage: memoryStorage(), AbortController,
  });
  nb.data.put('slice', { library: { events: Object.assign({}, SLICE.library.events, { timeZone: 'Asia/Tokyo' }) } });
  nb.net.setEnabled(true);
  await nb.net.refresh({ force: true, now: Date.parse('2026-11-08T23:30:00-05:00') });
  const u = new URL(log[0].url);
  assert.strictEqual(u.searchParams.get('startDate'), '2026-11-09');
  assert.strictEqual(u.searchParams.get('endDate'), '2026-11-30');
  assert.strictEqual(log[0].init.referrerPolicy, 'no-referrer', 'no referrer is sent');
});

test('N11: links are locked to the events host, and a virtual one to the library\'s hosts', () => {
  const { nb } = page();
  assert.strictEqual(nb.net.normalise(item(1, { '@id': 'https://evil.example/events/01ABCDEF0001' })), null, 'a page elsewhere is not an event');
  const online = (url) => plain(nb.net.normalise(item(2, { location: { '@type': 'VirtualLocation', url } })));
  assert.strictEqual(online('https://tpl.example.test/events/abc123').url, 'https://tpl.example.test/events/abc123');
  assert.strictEqual(online('https://evil.example/x/abc123').url, 'https://events.example.test/events/01ABCDEF0002', 'a foreign link falls back to the service page');
  // From the saved list too.
  const clean = plain(nb.net.cleanEvent({ id: 'a', title: 'T', start: '2026-11-09T10:00:00', end: '', branch: 'X', virtual: false, categories: [], summary: '', url: 'https://evil.example/e/1' }));
  assert.strictEqual(clean.url, '', 'a saved link off the events host is dropped');
});

test('N12: one refresh has an overall deadline', async () => {
  const p = page({ pages: { [ORG[0]]: [[item(1)]] }, snapshot: SNAP });
  p.nb.net.setEnabled(true);
  const r = plain(await p.nb.net.refresh({ force: true, deadlineMs: -1 }));
  assert.strictEqual(p.log.length, 0, 'past the deadline, nothing more is asked');
  assert.strictEqual(r.source, 'snapshot');
});
