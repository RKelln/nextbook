'use strict';
// The events screen with the latest list and the person's travel times, through the fake DOM.
// A fake fetch is the only "network"; nothing here touches a real one.
//
//   S1  nothing is asked until the button is pressed; then events from many branches appear,
//       the source says "latest list", and the choice is kept
//   S2  a workshop copy shows no button and asks nothing
//   S3  the branch filter narrows the list and is remembered
//   S4  a page of events at a time, and "Show more"
//   S5  this week and next week
//   S6  a failed ask keeps the snapshot and says so in one line
//   S7  travel times: added from a file, shown on events, limited, kept in this browser only, removable
//   S8  the picker is capped and follows the screen's branch; modes see the same list and no network
//   S9  turning the latest list off goes back to the snapshot
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./_load.js');
const { createDocument, all, byTest, withPrefix } = require('./fakedom.js');

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const SLICE = read('data/slice.json');
const PRACTICE = read('data/practice.json');
const SNAP = read('data/events.json');
const CORE = [
  'app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
  'app/core/links.js', 'app/core/contract.js', 'app/core/seam.js', 'app/core/store.js',
  'app/core/net.js', 'app/core/eventlist.js', 'app/core/travel.js',
];
const API = SLICE.library.events.apiUrl;
const ORG = SLICE.library.events.organizerIds;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) { map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
    all: () => [...map.entries()],
  };
}

const pad = (n) => String(n).padStart(2, '0');
function dayPlus(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// One service item. Place names are the library's own.
function item(n, place, dayOffset, extra) {
  return Object.assign({
    '@id': 'https://' + new URL(API).host + '/events/01EVENT' + String(n).padStart(5, '0'),
    name: 'Event ' + n, description: 'Words about event ' + n + '.', keywords: ['crafts'],
    startDate: dayPlus(dayOffset) + 'T' + pad(10 + (n % 8)) + ':00:00-05:00',
    endDate: dayPlus(dayOffset) + 'T' + pad(11 + (n % 8)) + ':00:00-05:00',
    location: place ? { '@type': 'Place', name: place } : { '@type': 'VirtualLocation', url: 'https://tpl.bibliocommons.com/events/v' + n },
  }, extra || {});
}

function fakeService(items, log, opts) {
  return function fetch(url, init) {
    log.push({ url, init });
    if (opts && opts.fail) return Promise.reject(new Error('offline'));
    const u = new URL(url);
    const org = u.searchParams.get('organizerId');
    const list = org === ORG[0] ? items : [];
    const cursor = Number(u.searchParams.get('after') || 0);
    const size = 200;
    const slice = list.slice(cursor, cursor + size);
    const next = cursor + size < list.length ? String(cursor + size) : '';
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ items: slice, next_cursor: next })) });
  };
}

function openPage(opts) {
  const o = opts || {};
  const doc = createDocument();
  const app = doc.createElement('main');
  app.setAttribute('id', 'app');
  doc.body.appendChild(app);
  const log = [];
  const storage = o.storage || memoryStorage();
  const window = {
    console: { warn() {}, log() {}, error: console.error },
    document: doc,
    location: { hash: o.hash || '#events' },
    addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {},
    localStorage: storage, AbortController,
    fetch: o.items ? fakeService(o.items, log, o) : undefined,
  };
  window.window = window;
  const ctx = vm.createContext(window);
  const run = (rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  CORE.forEach(run);
  const nb = window.Nextbook;
  nb.data.put('slice', SLICE);
  nb.data.put('tags', { schema: 'nextbook/tags-1', vocab: {}, works: {} });
  nb.data.put('practice', PRACTICE);
  if (o.snapshot !== false) nb.data.put('events', o.snapshot || SNAP);
  if (o.workshop) nb.data.put('workshop', { workshop: true });
  if (o.distance) nb.data.put('distance', o.distance);
  const defs = o.defs || [];
  defs.forEach((def) => nb.mode(def));
  nb.modes = defs.map((def) => def.id);
  run('app/core/shell.js');
  return { nb, doc, log, storage, window };
}

const settle = async (doc, until) => {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setImmediate(r));
    if (!until || until(doc)) return;
  }
};
const evs = (doc) => all(doc, '[data-event]');
const pressLive = async (page) => {
  byTest(page.doc, 'events-live-on').click();
  await settle(page.doc, (d) => !byTest(d, 'events-live-busy') && byTest(d, 'events-live-refresh'));
};
const choose = (el, value) => { el.value = value; el.dispatch('change', { type: 'change', target: el, preventDefault() {} }); };
const placeOf = (doc) => withPrefix(doc, 'event-place-').map((e) => e.textContent.replace(/^At /, ''));

const PLACES = ['Malvern', 'Jones', 'North York Central Library', 'Elsewhere Place'];
function manyItems(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(item(i + 1, i % 9 === 8 ? '' : PLACES[i % 4], i % 25));
  return out;
}

test('S1: nothing is asked until the button; then many branches appear; the choice is kept', async () => {
  const page = openPage({ items: manyItems(60) });
  assert.ok(byTest(page.doc, 'events-live-on'), 'the button is there');
  const ask = byTest(page.doc, 'events-live-ask').textContent;
  assert.ok(ask.indexOf('Nothing about your books is sent') !== -1, 'one plain line says what is sent');
  assert.ok(ask.indexOf(new URL(API).host) !== -1, 'it names the service');
  assert.ok(ask.indexOf('internet address') !== -1, 'and says its owners can see the visitor');
  assert.strictEqual(page.log.length, 0, 'drawing the page asks nothing');
  assert.match(byTest(page.doc, 'events-snapshot').textContent, /^Copied from the library on /);

  await pressLive(page);
  assert.ok(page.log.length >= 3, 'one list for each organiser id');
  assert.ok(page.log.every((l) => l.init.method === 'GET' && l.init.credentials === 'omit' && new URL(l.url).host === new URL(API).host));
  assert.match(byTest(page.doc, 'events-snapshot').textContent, /^The latest list, asked for on /);
  assert.ok(new Set(placeOf(page.doc)).size >= 3, 'events from several branches');
  assert.ok(byTest(page.doc, 'events-branch'), 'a branch filter');
  assert.ok(page.storage.getItem('nextbook1:events-live') === '1', 'the choice is kept');

  // A new page with the same storage asks again only because the saved list is empty of a fresh one.
  const again = openPage({ items: manyItems(60), storage: page.storage });
  await settle(again.doc);
  assert.ok(again.log.length === 0, 'a fresh saved list is not asked for again');
  assert.match(byTest(again.doc, 'events-snapshot').textContent, /^The latest list/);
});

test('S2: a workshop copy shows no button and asks nothing', async () => {
  const page = openPage({ items: manyItems(10), workshop: true });
  assert.ok(!byTest(page.doc, 'events-live-on'));
  assert.ok(!byTest(page.doc, 'events-live'));
  await settle(page.doc);
  assert.strictEqual(page.log.length, 0);
  assert.ok(evs(page.doc).length > 0, 'the snapshot still shows');
});

test('S3: the branch filter narrows the list and is remembered', async () => {
  const page = openPage({ items: manyItems(60) });
  await pressLive(page);
  const total = evs(page.doc).length;
  choose(byTest(page.doc, 'events-branch'), 'Malvern');
  const some = evs(page.doc);
  assert.ok(some.length > 0 && some.length < total);
  assert.deepStrictEqual([...new Set(placeOf(page.doc))], ['Malvern']);
  const again = openPage({ items: manyItems(60), storage: page.storage });
  assert.strictEqual(byTest(again.doc, 'events-branch').value, 'Malvern', 'remembered');
  choose(byTest(page.doc, 'events-branch'), '__online__');
  assert.ok(evs(page.doc).length > 0 && placeOf(page.doc).length === 0, 'online events have no place line');
});

test('S4: a page at a time, and Show more', async () => {
  const items = [];
  for (let i = 0; i < 120; i++) items.push(item(i + 1, PLACES[i % 3], i % 20));
  const page = openPage({ items });
  await pressLive(page);
  assert.strictEqual(evs(page.doc).length, 50);
  assert.match(byTest(page.doc, 'events-count').textContent, /Showing 50 of 120 events/);
  byTest(page.doc, 'events-more').click();
  assert.strictEqual(evs(page.doc).length, 100);
  byTest(page.doc, 'events-more').click();
  assert.strictEqual(evs(page.doc).length, 120);
  assert.ok(!byTest(page.doc, 'events-more'), 'no button when everything is drawn');
});

test('S5: this week and next week', async () => {
  const items = [item(1, 'Malvern', 0), item(2, 'Malvern', 6), item(3, 'Malvern', 7), item(4, 'Malvern', 13), item(5, 'Malvern', 14), item(6, 'Malvern', 20)];
  const page = openPage({ items });
  await pressLive(page);
  assert.strictEqual(evs(page.doc).length, 6);
  byTest(page.doc, 'events-week-this').click();
  assert.deepStrictEqual(evs(page.doc).map((e) => e.getAttribute('data-event')).sort(), ['01EVENT00001', '01EVENT00002']);
  byTest(page.doc, 'events-week-next').click();
  assert.deepStrictEqual(evs(page.doc).map((e) => e.getAttribute('data-event')).sort(), ['01EVENT00003', '01EVENT00004']);
  assert.strictEqual(byTest(page.doc, 'events-week-next').getAttribute('aria-pressed'), 'true');
  byTest(page.doc, 'events-week-all').click();
  assert.strictEqual(evs(page.doc).length, 6);
});

test('S6: a failed ask keeps the snapshot and says so in one line', async () => {
  const page = openPage({ items: manyItems(5), fail: true });
  await pressLive(page);
  assert.match(byTest(page.doc, 'events-note').textContent, /could not be loaded/);
  assert.match(byTest(page.doc, 'events-snapshot').textContent, /^Copied from the library on /);
  assert.strictEqual(evs(page.doc).length, Math.min(50, SNAP.events.length));
});

const MAP = {
  origin: [43.7, -79.4], label: 'test point', built: dayPlus(-1),
  branches: [
    { code: 'MV', name: 'Malvern', walk_s: 7000, bike_s: 3000, car_s: 1500, transit_weekday_s: 1500, transit_weekend_s: 1500 },
    { code: 'JN', name: 'Jones', walk_s: 9000, bike_s: 4000, car_s: 1200, transit_weekday_s: 6000, transit_weekend_s: 6000 },
    { code: 'NY', name: 'North York Central Library', walk_s: 900, bike_s: 400, car_s: 200, transit_weekday_s: null, transit_weekend_s: null },
  ],
};
const file = (text) => ({ size: text.length, text: () => Promise.resolve(text) });
const addFile = async (page, text) => {
  const input = byTest(page.doc, 'events-travel-file');
  input.files = [file(text)];
  input.dispatch('change', { type: 'change', target: input, preventDefault() {} });
  await settle(page.doc, (d) => !byTest(d, 'events-travel-how'));
};

test('S7: travel times from a file: shown, limited, kept in this browser only, removable', async () => {
  const items = [item(1, 'Malvern', 2), item(2, 'Jones', 2), item(3, 'North York Central Library', 2), item(4, 'Elsewhere Place', 2), item(5, '', 2)];
  const page = openPage({ items });
  await pressLive(page);
  assert.ok(byTest(page.doc, 'events-travel-how'), 'with no map, one line says how to get one');
  assert.strictEqual(withPrefix(page.doc, 'event-travel-').length, 0);

  await addFile(page, JSON.stringify(MAP));
  assert.ok(!byTest(page.doc, 'events-travel-error'));
  assert.match(byTest(page.doc, 'events-travel-source').textContent, /test point/);
  assert.match(byTest(page.doc, 'events-travel-source').textContent, /rough guides/);
  const lines = (doc) => {
    const out = {};
    evs(doc).forEach((li) => {
      const el = all(li, '[data-test]').find((x) => x.getAttribute('data-test').indexOf('event-travel-') === 0);
      out[li.getAttribute('data-event')] = el ? el.textContent : null;
    });
    return out;
  };
  // Default is any way but a car, longest 60 minutes: Jones (4000 s by bike = 67 min) is too far.
  let l = lines(page.doc);
  assert.strictEqual(l['01EVENT00001'], '25 min by transit', 'Malvern: any way, and transit is the least');
  assert.strictEqual(byTest(page.doc, 'events-far-count').textContent, '1 event is more than 60 minutes away, so it is hidden.');
  assert.ok(!('01EVENT00002' in l), 'the far one is hidden');
  assert.match(l['01EVENT00004'], /We do not have a travel time/, 'an unknown place is kept and says so');
  assert.strictEqual(l['01EVENT00005'], null, 'an online event has no trip');

  byTest(page.doc, 'events-far-toggle').click();
  assert.ok('01EVENT00002' in lines(page.doc), 'shown on request');

  choose(byTest(page.doc, 'events-travel-mode'), 'transit');
  l = lines(page.doc);
  assert.strictEqual(l['01EVENT00001'], '25 min by transit');
  assert.strictEqual(l['01EVENT00003'], '15 min walking', 'no transit time: walking is the lesser');
  assert.strictEqual(l['01EVENT00002'], '100 min by transit');
  choose(byTest(page.doc, 'events-travel-max'), '120');
  assert.ok(!byTest(page.doc, 'events-far-count'), 'nothing is beyond 120 minutes');

  // In this browser only: its own key, never in the shelf's export.
  const keys = page.storage.all().map((e) => e[0]);
  assert.ok(keys.indexOf('nextbook1:travel') !== -1);
  const kept = JSON.parse(page.storage.getItem('nextbook1:travel'));
  assert.ok(!('origin' in kept), 'the start point is not kept');
  const store = page.nb.store.open(page.storage);
  assert.ok(store.exportShelf().indexOf('test point') === -1, 'not in a shelf export');

  byTest(page.doc, 'events-travel-remove').click();
  assert.ok(byTest(page.doc, 'events-travel-how'));
  assert.strictEqual(page.storage.getItem('nextbook1:travel'), null);

  await (async () => {
    const input = byTest(page.doc, 'events-travel-file');
    input.files = [file('{"nope":true}')];
    input.dispatch('change', { type: 'change', target: input, preventDefault() {} });
    await settle(page.doc, (d) => byTest(d, 'events-travel-error'));
  })();
  assert.ok(byTest(page.doc, 'events-travel-error'), 'a bad file is refused in words');
  assert.ok(byTest(page.doc, 'events-travel-how'), 'and nothing is kept');
});

test('S7b: a folder copy loads app/data/distance.js with no button press', () => {
  const page = openPage({ distance: MAP, snapshot: Object.assign({}, SNAP, { events: SNAP.events.map((e) => Object.assign({}, e, { branch: 'Malvern' })) }) });
  assert.match(byTest(page.doc, 'events-travel-source').textContent, /test point/);
  assert.ok(byTest(page.doc, 'events-travel-folder'), 'it says where the file is');
  assert.ok(!byTest(page.doc, 'events-travel-remove'), 'a folder file is removed by deleting it');
  assert.ok(withPrefix(page.doc, 'event-travel-').length > 0);
});

function listMode() {
  return {
    id: 'event-hook', name: 'Books for an event', purpose: 'Picks a book for an event.', shape: 'list',
    inputs: [{ id: 'event', kind: 'event', label: 'Which event' }], strings: {},
    choose(ctx, input) {
      seen = { n: ctx.events.length, event: input.event };
      const w = ctx.works.find((x) => !ctx.onShelf(x.id));
      return { picks: [{ id: w.id, why: 'It is the first book that fits ' + input.event.title + '.' }] };
    },
  };
}
let seen = null;

test('S8: the picker is capped and follows the branch; modes see the same list and no network', async () => {
  const items = [];
  for (let i = 0; i < 400; i++) items.push(item(i + 1, PLACES[i % 4], i % 20));
  const page = openPage({ items, defs: [listMode()] });
  await pressLive(page);
  page.window.location.hash = '#find';
  page.nb.shell.render();
  let picker = byTest(page.doc, 'input-event');
  assert.ok(picker, 'the picker is drawn');
  assert.ok(picker.options.length <= 151, 'a page of options and the empty one, not 400');
  assert.ok(byTest(page.doc, 'input-event-capped'), 'and says it shows some of many');
  page.window.location.hash = '#events';
  page.nb.shell.render();
  choose(byTest(page.doc, 'events-branch'), 'Jones');
  page.window.location.hash = '#find';
  page.nb.shell.render();
  picker = byTest(page.doc, 'input-event');
  assert.ok(picker.options.slice(1).every((o) => /, at Jones$/.test(o.textContent)), 'it follows the screen\'s branch');

  // Choosing from it reaches the mode with the live event, and the mode saw the whole list.
  const first = picker.options[1];
  choose(picker, first.getAttribute('value'));
  assert.ok(seen && seen.event.id === first.getAttribute('value'));
  assert.strictEqual(seen.n, 400, 'ctx.events is the current list');
  assert.strictEqual(seen.event.branch, 'Jones');

  // A chosen event stays selectable when the filter changes under it.
  const chosenId = first.getAttribute('value');
  page.window.location.hash = '#events';
  page.nb.shell.render();
  choose(byTest(page.doc, 'events-branch'), 'Malvern');
  page.window.location.hash = '#find';
  page.nb.shell.render();
  const options = byTest(page.doc, 'input-event').options.map((o) => o.getAttribute('value'));
  assert.ok(options.indexOf(chosenId) !== -1, 'D35: the chosen event is still an option');
});

test('S9: turning the latest list off goes back to the snapshot', async () => {
  const page = openPage({ items: manyItems(30) });
  await pressLive(page);
  byTest(page.doc, 'events-live-off').click();
  assert.ok(byTest(page.doc, 'events-live-on'), 'the button is back');
  assert.match(byTest(page.doc, 'events-snapshot').textContent, /^Copied from the library on /);
  assert.strictEqual(page.storage.getItem('nextbook1:events-live'), null);
  assert.strictEqual(page.storage.getItem('nextbook1:events'), null);
});

test('S10: a live event links to the event page in honest words; a snapshot event keeps the library wording', async () => {
  const page = openPage({ items: manyItems(5) });
  assert.strictEqual(byTest(page.doc, 'event-open-1').textContent, "Open the library's page", 'the snapshot links to the library');
  await pressLive(page);
  assert.strictEqual(byTest(page.doc, 'event-open-1').textContent, 'Open the event page');
  assert.ok(!/library's page/.test(byTest(page.doc, 'events-snapshot').textContent), 'the source line makes no such claim either');
  const href = byTest(page.doc, 'event-link-1').getAttribute('href');
  assert.strictEqual(new URL(href).host, new URL(API).host, 'the title link goes where the words say');
});

test('S11: a workshop copy has no travel block, even when a map is in the folder', () => {
  const page = openPage({ items: manyItems(3), workshop: true, distance: MAP });
  assert.ok(!byTest(page.doc, 'events-travel'), 'no travel block');
  assert.ok(!byTest(page.doc, 'events-travel-how'), 'and no pointer to a tool the folder lacks');
  assert.strictEqual(withPrefix(page.doc, 'event-travel-').length, 0);
});
