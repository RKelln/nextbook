'use strict';
// T3.6: the events screen, driven through a fake DOM (tests/fakedom.js). The snapshot is the
// only source, so every page here puts one in and never touches the network.
//
//   E1  the events are grouped by day, in date order, each with the day, the time, the title,
//       the library's words and a link to the library's own event page
//   E2  the library's words are text: markup in the snapshot shows as its own characters
//   E3  the tab is drawn only when the snapshot is there, and #events still answers without it
//   E4  a virtual event says so, and one that is not virtual says nothing
//   E5  a summary over 300 characters is not cut, and the page says why it is not shown
//   E6  no "Books for this event" button while no event-hook mode is loaded
//   E7  with an event-hook mode that asks for words, the button opens it with the title in the
//       words box, and says in one sentence what it did and why
//   E8  with an event-hook mode that asks for nothing, the button still opens it and says so
//
// Objects come from a vm realm, so compare after a JSON round trip (AGENTS.md).
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
const REAL_EVENTS = read('data/events.json');

const CORE = [
  'app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js',
  'app/core/links.js', 'app/core/contract.js', 'app/core/seam.js', 'app/core/store.js',
];

const BRANCH = 'North York Central Library';

// Three events on two days, written out of order on purpose: the page has to group and sort.
const EVENTS = {
  fetched: '2026-11-03T19:49:50-05:00',
  branch: 'CL',
  window: { start: '2026-11-03', end: '2026-11-24' },
  source: 'example',
  events: [
    {
      id: 'e3', title: 'Craft Circle', start: '2026-11-04T14:00:00', end: '2026-11-04T15:00:00',
      branch: BRANCH, virtual: false, categories: [], summary: 'Bring your knitting.',
      url: 'https://example.test/events/e3',
    },
    {
      id: 'e1', title: 'Introduction to Serger Sewing', start: '2026-11-03T18:00:00',
      end: '2026-11-03T20:00:00', branch: BRANCH, virtual: false, categories: [],
      summary: 'Learn the basics of operating our serger.',
      url: 'https://example.test/events/e1',
    },
    {
      id: 'e2', title: 'Evening Talk', start: '2026-11-04T18:30:00', end: '2026-11-04T19:30:00',
      branch: BRANCH, virtual: true, categories: [], summary: 'An author speaks from home.',
      url: 'https://example.test/events/e2',
    },
  ],
};

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    raw(key) { return map.get(key); },
  };
}

// A mode with the id the events screen looks for. `noText` leaves out the words input, which is
// the kind the screen can fill; a scratch mode, never in app/modes/.
function eventHookMode(opts) {
  const noText = !!(opts && opts.noText);
  return {
    id: 'event-hook',
    name: 'Books for an event',
    purpose: 'Picks a book for something happening at the library.',
    shape: 'list',
    inputs: noText ? [] : [{ id: 'words', kind: 'text', label: 'Words about the event' }],
    strings: {},
    choose(ctx, input) {
      const w = ctx.works.find((x) => !ctx.onShelf(x.id));
      if (!w) return { picks: [], note: 'Nothing in the list fits yet.' };
      const words = input && input.words ? ' for ' + input.words : '';
      return { picks: [{ id: w.id, why: 'The first book in the list that fits' + words + '.' }] };
    },
  };
}

function plainMode() {
  return {
    id: 'plain-pick',
    name: 'From the list',
    purpose: 'Picks a book from the list.',
    shape: 'list',
    inputs: [],
    strings: {},
    choose(ctx) {
      const w = ctx.works.find((x) => !ctx.onShelf(x.id));
      if (!w) return { picks: [], note: 'Nothing in the list fits yet.' };
      return { picks: [{ id: w.id, why: 'It is the first book in the list that is not on your shelf.' }] };
    },
  };
}

// Load core through store.js, put the data in, register the modes, then load the shell, which
// boots on load because the fake document is already complete.
function openPage(opts) {
  const options = opts || {};
  const doc = createDocument();
  const app = doc.createElement('main');
  app.setAttribute('id', 'app');
  doc.body.appendChild(app);

  const window = {
    console,
    document: doc,
    location: { hash: options.hash || '#events' },
    addEventListener() {},
    setTimeout() { return 0; },
    clearTimeout() {},
  };
  if (options.storage) window.localStorage = options.storage;
  window.window = window;

  const ctx = vm.createContext(window);
  const run = (rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  CORE.forEach(run);

  const nb = window.Nextbook;
  nb.data.put('slice', options.slice || SLICE);
  nb.data.put('tags', { schema: 'nextbook/tags-1', vocab: {}, works: {} });
  nb.data.put('practice', options.practice || PRACTICE);
  if (options.events) nb.data.put('events', options.events);

  const defs = options.defs || [];
  defs.forEach((def) => nb.mode(def));
  nb.modes = defs.map((def) => def.id);

  run('app/core/shell.js');
  return { nb, doc, app };
}

const events = (doc) => all(doc, '[data-event]');
const statusText = (doc) => all(doc, '[role]')
  .filter((el) => el.getAttribute('role') === 'status')
  .map((el) => el.textContent).join(' ');

test('E1: the events are grouped by day, in date order, with day, time, title, words and a link', () => {
  const { nb, doc } = openPage({ events: EVENTS });

  const days = withPrefix(doc, 'event-day-').filter((el) => el.tagName === 'H3');
  assert.strictEqual(days.length, 2, 'two days, one heading each');
  assert.strictEqual(days[0].textContent, 'Tuesday, November 3', 'the day heading is written plainly');
  assert.strictEqual(days[1].textContent, 'Wednesday, November 4');

  // Both days are in order, and the two events on the second day are in start order.
  const ids = events(doc).map((el) => el.getAttribute('data-event'));
  assert.deepStrictEqual(plain(ids), ['e1', 'e3', 'e2'], 'sorted by day, then by time');

  assert.strictEqual(byTest(doc, 'event-time-1').textContent, '6:00 pm to 8:00 pm', 'the time is plain and local');
  assert.strictEqual(byTest(doc, 'event-time-3').textContent, '6:30 pm to 7:30 pm');
  assert.strictEqual(byTest(doc, 'event-2').getAttribute('data-event'), 'e3');

  const link = byTest(doc, 'event-link-1');
  assert.strictEqual(link.getAttribute('href'), EVENTS.events[1].url, 'the title links to the event page');
  assert.strictEqual(link.textContent, 'Introduction to Serger Sewing');
  assert.strictEqual(byTest(doc, 'event-open-1').getAttribute('href'), EVENTS.events[1].url,
    'and the link under the words is the same page');

  assert.strictEqual(byTest(doc, 'event-summary-1').textContent, 'Learn the basics of operating our serger.',
    "the library's own words are shown as text");

  const said = byTest(doc, 'events-snapshot').textContent;
  assert.strictEqual(said, "Snapshot taken November 3, 2026. Check the library's page before you go.");
  assert.ok(doc.body.textContent.indexOf(BRANCH) !== -1, 'the branch is named');
  assert.strictEqual(nb.t('eventsHeading'), 'Events at the library');
});

test('E2: markup in the snapshot shows as characters, never as markup', () => {
  const snapshot = plain(EVENTS);
  snapshot.events = [{
    id: 'm1', title: 'A title with <em>tags</em>', start: '2026-11-05T10:00:00',
    end: '2026-11-05T11:00:00', branch: BRANCH, virtual: false, categories: [],
    summary: 'Bring <b>bold</b> ideas & a pencil.',
    url: 'https://example.test/events/m1',
  }];
  const { doc } = openPage({ events: snapshot });

  const summary = byTest(doc, 'event-summary-1');
  assert.ok(summary, 'the words are there');
  assert.strictEqual(summary.textContent, 'Bring <b>bold</b> ideas & a pencil.', 'the characters survive');
  assert.strictEqual(all(summary, 'b').length, 0, 'and no element was made from them');
  assert.strictEqual(all(summary, 'em').length, 0);
  const title = byTest(doc, 'event-link-1');
  assert.strictEqual(title.textContent, 'A title with <em>tags</em>');
  assert.strictEqual(all(title, 'em').length, 0, 'the title is text too');
});

test('E3: the tab is drawn only with the snapshot, and #events answers without one', () => {
  const withIt = openPage({ events: EVENTS });
  const tab = byTest(withIt.doc, 'nav-events');
  assert.ok(tab, 'the tab is there');
  assert.strictEqual(tab.textContent, 'Events');
  tab.click();
  assert.strictEqual(withIt.nb.shell.route(), 'events', 'pressing it lands on #events');

  const without = openPage({ defs: [plainMode()] });
  assert.strictEqual(byTest(without.doc, 'nav-events'), null, 'no snapshot, no tab');
  assert.strictEqual(byTest(without.doc, 'nav-find'), byTest(without.doc, 'nav-find'), 'the rest of the tabs are there');
  assert.ok(byTest(without.doc, 'nav-find') && byTest(without.doc, 'nav-shelf') && byTest(without.doc, 'nav-selftest'));

  const empty = byTest(without.doc, 'events-empty');
  assert.ok(empty, 'a plain sentence instead of a blank page');
  assert.strictEqual(empty.textContent, without.nb.t('eventsNone'));
  assert.strictEqual(withPrefix(without.doc, 'event-').filter((el) => el.tagName === 'LI').length, 0);
});

test('E4: a virtual event says so, and one that is not virtual says nothing', () => {
  const { nb, doc } = openPage({ events: EVENTS });
  const online = byTest(doc, 'event-virtual-3');
  assert.ok(online, 'the online event says so');
  assert.strictEqual(online.textContent, nb.t('eventVirtual'));
  assert.strictEqual(byTest(doc, 'event-virtual-1'), null, 'the in-person ones do not');
  assert.strictEqual(byTest(doc, 'event-virtual-2'), null);
});

test('E5: a summary over 300 characters is not cut, and the page says why', () => {
  const long = 'a'.repeat(301);
  const snapshot = plain(EVENTS);
  snapshot.events = [{
    id: 'long-1', title: 'A long one', start: '2026-11-06T13:00:00', end: '2026-11-06T14:00:00',
    branch: BRANCH, virtual: false, categories: [], summary: long,
    url: 'https://example.test/events/long-1',
  }];
  const { nb, doc } = openPage({ events: snapshot });

  assert.strictEqual(byTest(doc, 'event-summary-1'), null, 'no shortened copy is shown as the library\'s words');
  const note = byTest(doc, 'event-summary-long-1');
  assert.ok(note, 'the page says what it found');
  assert.strictEqual(note.textContent, nb.t('eventSummaryLong'));
  assert.strictEqual(doc.body.textContent.indexOf(long.slice(0, 300)), -1, 'and nothing was cut to 300');

  // Exactly 300 is still the library's words, so it is shown whole.
  const atLimit = plain(snapshot);
  atLimit.events[0].summary = 'b'.repeat(300);
  const ok = openPage({ events: atLimit });
  assert.strictEqual(byTest(ok.doc, 'event-summary-1').textContent, 'b'.repeat(300));
});

test('E6: no "Books for this event" button while no event-hook mode is loaded', () => {
  const { doc } = openPage({ events: EVENTS, defs: [plainMode()] });
  assert.ok(events(doc).length, 'the events are drawn');
  assert.strictEqual(withPrefix(doc, 'event-books-').length, 0, 'and no button on any of them');

  // The real copy, with the one mode it ships, is the same.
  const real = openPage({ events: REAL_EVENTS, defs: [plainMode()] });
  assert.strictEqual(withPrefix(real.doc, 'event-books-').length, 0);
});

test('E7: with an event-hook mode, the button opens it with the title in the words box', () => {
  const storage = memoryStorage();
  const { nb, doc } = openPage({ events: EVENTS, defs: [eventHookMode(), plainMode()], storage });

  const buttons = withPrefix(doc, 'event-books-');
  assert.strictEqual(buttons.length, 3, 'one button per event');
  assert.strictEqual(buttons[0].textContent, nb.t('eventBooks'));
  assert.strictEqual(buttons[0].textContent, 'Books for this event');

  buttons[0].click();

  assert.strictEqual(nb.shell.route(), 'find', 'pressing it opens the mode on #find');
  assert.ok(byTest(doc, 'mode-current-event-hook'), 'with that mode showing');
  assert.ok(byTest(doc, 'input-words'), 'its words input is drawn');
  assert.strictEqual(byTest(doc, 'input-words').getAttribute('value'), 'Introduction to Serger Sewing',
    "the event's title is in the box");
  assert.strictEqual(statusText(doc), nb.t('eventHookWords'), 'and one sentence says what it did and why');
  assert.strictEqual(nb.store.open(storage).inputs('event-hook').words, 'Introduction to Serger Sewing',
    'the choice is kept in this browser');

  // The same words reach choose() on the next page, so the mode really was given the event.
  const second = openPage({ events: EVENTS, defs: [eventHookMode(), plainMode()], storage, hash: '#find' });
  const why = byTest(second.doc, 'pick-1').textContent;
  assert.ok(why.indexOf('for Introduction to Serger Sewing') !== -1,
    'the mode read the words on a reload, got ' + why);
});

test('E8: an event-hook mode that asks for no words still opens, and says so', () => {
  const { nb, doc } = openPage({ events: EVENTS, defs: [eventHookMode({ noText: true })] });
  const button = byTest(doc, 'event-books-1');
  assert.ok(button, 'the button is there for a loaded mode');
  button.click();

  assert.strictEqual(nb.shell.route(), 'find');
  assert.ok(byTest(doc, 'mode-current-event-hook'), 'the mode is showing');
  assert.strictEqual(byTest(doc, 'input-words'), null, 'it has no words box to fill');
  assert.strictEqual(statusText(doc), nb.t('eventHookNoInput'), 'the sentence says what happened instead');
  assert.ok(nb.t('eventHookNoInput').indexOf(nb.t('eventBooks')) === -1);
});

// The real snapshot, so the page is proved on the data it ships with and not only on fixtures.
test('E9: the committed snapshot draws every event, under its own day', () => {
  const { doc } = openPage({ events: REAL_EVENTS, defs: [plainMode()] });
  assert.strictEqual(events(doc).length, REAL_EVENTS.events.length, 'every event on the page');
  const dayKeys = [...new Set(REAL_EVENTS.events.map((e) => e.start.slice(0, 10)))].sort();
  const headings = withPrefix(doc, 'event-day-').filter((el) => el.tagName === 'H3');
  assert.strictEqual(headings.length, dayKeys.length, 'one heading per day');
  assert.strictEqual(headings[0].textContent, 'Tuesday, November 3', 'the first day, in the city it happens in');

  // No summary was over the limit, so every card shows the library's words and none shows the note.
  assert.strictEqual(withPrefix(doc, 'event-summary-long-').length, 0);
  assert.strictEqual(withPrefix(doc, 'event-summary-').length, REAL_EVENTS.events.length);

  const first = REAL_EVENTS.events.slice().sort((a, b) => (a.start < b.start ? -1 : 1))[0];
  assert.ok(byTest(doc, 'event-summary-1').textContent.indexOf(first.summary.slice(0, 40)) !== -1);
  assert.strictEqual(byTest(doc, 'event-link-1').getAttribute('href'), first.url);
});
