'use strict';
// core/eventlist.js and core/travel.js, the pure parts: the week rule, the branch filter, the
// picker's scope, the travel reading rules and the name matching.
//
//   L1  this week is today to today+6, next week the seven after; an event that is over is past
//   L2  the branch filter, with online events under their own name
//   L3  the picker is capped, honours the filters, and always holds the chosen event
//   V1  null is never 0; transit is the lesser of transit and walk; any never uses the car
//   V2  the transit time follows the event's day: weekend for Saturday and Sunday
//   V3  names are matched by normalised name or a listed alias, never by similarity
//   V4  an untrusted file is rebuilt from known fields; the start point is dropped; junk is refused
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_load.js');

const plain = (value) => JSON.parse(JSON.stringify(value));
const nb = load(['app/core/base.js', 'app/core/eventlist.js', 'app/core/travel.js']);
const L = nb.eventlist, T = nb.travel;

const ev = (id, start, branch, extra) => Object.assign({ id, title: 'E' + id, start, end: '', branch, virtual: !branch, categories: [], summary: '', url: 'https://x.test/' + id }, extra || {});

test('L1: the week rule', () => {
  const today = '2026-11-08';
  assert.strictEqual(L.weekOf(ev('a', '2026-11-08T10:00:00', 'X'), today), 'this');
  assert.strictEqual(L.weekOf(ev('a', '2026-11-14T10:00:00', 'X'), today), 'this');
  assert.strictEqual(L.weekOf(ev('a', '2026-11-15T10:00:00', 'X'), today), 'next');
  assert.strictEqual(L.weekOf(ev('a', '2026-11-21T10:00:00', 'X'), today), 'next');
  assert.strictEqual(L.weekOf(ev('a', '2026-11-22T10:00:00', 'X'), today), 'later');
  assert.strictEqual(L.weekOf(ev('a', '2026-11-07T10:00:00', 'X'), today), 'past');
  assert.strictEqual(L.weekOf(ev('a', '2026-11-07T10:00:00', 'X', { end: '2026-11-09T10:00:00' }), today), 'this', 'still running');
  assert.strictEqual(L.weekOf(ev('a', 'soon', 'X'), today), 'unknown');
  const list = [ev('a', '2026-11-09T10:00:00', 'X'), ev('b', '2026-11-16T10:00:00', 'X'), ev('c', '2026-12-30T10:00:00', 'X')];
  assert.deepStrictEqual(L.filter(list, { when: 'this', today }).map((e) => e.id), ['a']);
  assert.deepStrictEqual(L.filter(list, { when: 'next', today }).map((e) => e.id), ['b']);
  assert.strictEqual(L.filter(list, { when: 'all', today }).length, 3);
});

test('L2: the branch filter', () => {
  const list = [ev('a', '2026-11-09T10:00:00', 'Malvern'), ev('b', '2026-11-09T11:00:00', 'Jones'), ev('c', '2026-11-09T12:00:00', ''), ev('d', '2026-11-09T13:00:00', 'Malvern')];
  assert.deepStrictEqual(plain(L.branches(list)), [{ name: 'Jones', count: 1 }, { name: 'Malvern', count: 2 }]);
  assert.deepStrictEqual(L.filter(list, { branch: 'Malvern' }).map((e) => e.id), ['a', 'd']);
  assert.deepStrictEqual(L.filter(list, { branch: L.ONLINE }).map((e) => e.id), ['c']);
  assert.strictEqual(L.filter(list, {}).length, 4);
});

test('L3: the picker is capped and always holds the chosen event', () => {
  const many = [];
  for (let i = 0; i < 400; i++) many.push(ev('e' + i, '2026-11-09T10:' + String(i % 60).padStart(2, '0') + ':00', i % 2 ? 'Malvern' : 'Jones'));
  const all = L.pickerList(many, {});
  assert.strictEqual(all.events.length, L.PICKER_MAX);
  assert.strictEqual(all.total, 400);
  assert.strictEqual(all.capped, true);
  const one = L.pickerList(many, { branch: 'Malvern' });
  assert.ok(one.events.every((e) => e.branch === 'Malvern'));
  const kept = L.pickerList(many, { branch: 'Malvern', keep: 'e398' });
  assert.ok(kept.events.some((e) => e.id === 'e398'), 'the chosen one is in, even past the cap');
  const out = L.pickerList(many, { branch: 'Jones', keep: 'e1' });
  assert.ok(out.events.some((e) => e.id === 'e1'), 'and even outside the filter');
  assert.strictEqual(L.pickerList(many.slice(0, 5), {}).capped, false);
});

const MAPDOC = {
  origin: [43.7, -79.4], label: 'test point', built: '2026-11-08',
  branches: [
    { code: 'MV', name: 'Malvern', street: 'x', lat: 1, lon: 2, walk_s: 3000, bike_s: 1200, car_s: 600, transit_weekday_s: 1500, transit_weekend_s: 2400, transit_weekday_route: 'Line 2', transit_weekend_route: 'Bus 9' },
    { code: 'PM', name: 'Palmerston', walk_s: 444, bike_s: 204, car_s: 105, transit_weekday_s: 444, transit_weekday_route: 'walk (no transit needed)', transit_weekend_s: null },
    { code: 'NY', name: 'North York Central Library', walk_s: 5000, bike_s: null, car_s: 900, transit_weekday_s: null, transit_weekend_s: null },
    { code: 'ST', name: 'S. Walter Stewart', aliases: ['Walter Stewart Branch'], walk_s: 4000, bike_s: 2000, car_s: 700 },
    { code: 'NO', name: 'Nowhere', walk_s: null, bike_s: null, car_s: null },
  ],
};
const MAP = T.read(MAPDOC).map;

test('V1: null is never 0, transit is the lesser of transit and walk, any never uses the car', () => {
  const row = (code) => MAP.branches.find((b) => b.code === code);
  assert.deepStrictEqual(plain(T.trip(row('MV'), 'transit', false)), { seconds: 1500, via: 'transit' });
  assert.deepStrictEqual(plain(T.trip(row('MV'), 'any', false)), { seconds: 1200, via: 'bike' }, 'the bike beats the rest here');
  assert.deepStrictEqual(plain(T.trip(row('MV'), 'car', false)), { seconds: 600, via: 'car' });
  assert.deepStrictEqual(plain(T.trip(row('MV'), 'walk', false)), { seconds: 3000, via: 'walk' });
  assert.deepStrictEqual(plain(T.trip(row('PM'), 'transit', false)), { seconds: 444, via: 'walk' }, 'walk (no transit needed) says walk');
  assert.strictEqual(T.trip(row('NY'), 'bike', false), null, 'no bike time is no answer, not zero');
  assert.deepStrictEqual(plain(T.trip(row('NY'), 'transit', false)), { seconds: 5000, via: 'walk' }, 'transit falls back to walking');
  assert.strictEqual(T.trip(row('NO'), 'any', false), null);
  assert.strictEqual(T.trip(row('NO'), 'car', false), null);
  const noCar = T.read({ branches: [{ name: 'A', walk_s: 9000, car_s: 60 }] }).map.branches[0];
  assert.deepStrictEqual(plain(T.trip(noCar, 'any', false)), { seconds: 9000, via: 'walk' }, 'any never picks the car');
});

test('V2: the transit time follows the day of the event', () => {
  const e = (start) => ({ id: 'x', title: 'x', start, branch: 'Malvern', virtual: false });
  const wk = plain(T.forEvent(MAP, e('2026-11-09T18:00:00'), 'transit'));   // a Monday
  const we = plain(T.forEvent(MAP, e('2026-11-14T13:00:00'), 'transit'));   // a Saturday
  assert.deepStrictEqual(wk, { kind: 'known', seconds: 1500, minutes: 25, via: 'transit' });
  assert.deepStrictEqual(we, { kind: 'known', seconds: 2400, minutes: 40, via: 'transit' });
  assert.strictEqual(T.forEvent(MAP, e('2026-11-15T13:00:00'), 'transit').minutes, 40, 'Sunday too');
  assert.strictEqual(T.forEvent(MAP, { id: 'v', start: '2026-11-09T18:00:00', branch: '', virtual: true }, 'any').kind, 'virtual');
  assert.strictEqual(T.forEvent(MAP, { id: 'u', start: '2026-11-09T18:00:00', branch: 'Elsewhere', virtual: false }, 'any').kind, 'unknown');
  assert.strictEqual(T.forEvent(MAP, { id: 'n', start: '2026-11-09T18:00:00', branch: 'Nowhere', virtual: false }, 'any').kind, 'unknown', 'a branch with no time is unknown');
});

test('V3: names match by normalised name or alias, never by similarity', () => {
  const m = (name) => { const r = T.branchFor(MAP, name); return r ? r.code : null; };
  assert.strictEqual(m('Malvern'), 'MV');
  assert.strictEqual(m('malvern'), 'MV');
  assert.strictEqual(m('Malvern - Closed'), 'MV');
  assert.strictEqual(m('North York Central Library'), 'NY');
  assert.strictEqual(m('North York Central'), 'NY', 'the word Library is not part of the key');
  assert.strictEqual(m('S. Walter Stewart'), 'ST');
  assert.strictEqual(m('S Walter Stewart Library'), 'ST');
  assert.strictEqual(m('Walter Stewart Branch'), 'ST', 'an alias the data lists');
  assert.strictEqual(m('Malvern Community Library'), null, 'close is not a match');
  assert.strictEqual(m('Malver'), null);
  assert.strictEqual(m(''), null);
  assert.strictEqual(T.branchFor(null, 'Malvern'), null);
});

test('V4: an untrusted file is rebuilt from known fields, and junk is refused', () => {
  const hostile = {
    origin: [43.7, -79.4], label: 'x'.repeat(500) + '<img src=x onerror=alert(1)>', built: 'whenever', evil: 'yes',
    branches: [
      { name: '<b>Malvern</b>', walk_s: -5, bike_s: 'fast', car_s: 0, transit_weekday_s: 1e12, transit_weekend_s: 900, __proto__x: 1, extra: 'x' },
      { name: '', walk_s: 100 }, 7, null,
    ],
  };
  const r = plain(T.read(JSON.stringify(hostile)));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.map.label.length, 80);
  assert.strictEqual(r.map.built, '');
  assert.strictEqual(r.map.branches.length, 1);
  const b = r.map.branches[0];
  assert.deepStrictEqual([b.walk_s, b.bike_s, b.car_s, b.transit_weekday_s, b.transit_weekend_s], [null, null, null, null, 900]);
  assert.ok(!('extra' in b) && !('origin' in r.map) && !('evil' in r.map), 'unknown fields and the start point are dropped');
  assert.ok(JSON.stringify(r).indexOf('43.7') === -1, 'the start point is not kept');
  assert.strictEqual(T.read('not json').ok, false);
  assert.strictEqual(T.read('[1,2]').ok, false);
  assert.strictEqual(T.read('{"branches":[]}').ok, false);
  assert.strictEqual(T.read('{"branches":[{"name":""}]}').ok, false);
  assert.strictEqual(T.read('x'.repeat(T.MAX_BYTES + 1)).ok, false);
});
