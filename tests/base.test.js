'use strict';
// T2.1: the base. A tiny fake document stands in for the page, because the core must work with
// no browser (and because the tests must never need jsdom). Everything that comes back is read
// as plain strings and JSON round-tripped values: the objects live in a vm realm (AGENTS.md).
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_load.js');

const plain = (value) => JSON.parse(JSON.stringify(value));

// ---- A fake document, just enough for h() ---------------------------------------------------
function makeDocument(blocks) {
  const text = (data) => ({ nodeType: 3, data: String(data) });

  function El(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.children = [];
    this.listeners = {};
  }
  El.prototype.setAttribute = function (name, value) { this.attrs[String(name)] = String(value); };
  El.prototype.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, String(name)) ? this.attrs[name] : null;
  };
  El.prototype.appendChild = function (child) { this.children.push(child); return child; };
  El.prototype.addEventListener = function (event, fn) {
    (this.listeners[event] = this.listeners[event] || []).push(fn);
  };

  const byId = blocks || {};
  return {
    createElement: (tag) => new El(tag),
    createTextNode: (data) => text(data),
    getElementById: (id) => (Object.prototype.hasOwnProperty.call(byId, id)
      ? { textContent: byId[id] } : null),
  };
}

function loadBase(blocks) {
  return load(['app/core/base.js'], { document: makeDocument(blocks) });
}

// The text of an element, reading text nodes only: h has no way to make markup.
function textOf(el) {
  return el.children.map((c) => (c.nodeType === 3 ? c.data : textOf(c))).join('');
}

// ---- h --------------------------------------------------------------------------------------
test('h builds an element whose children are text, never markup', () => {
  const nb = loadBase();
  const p = nb.h('p', null, 'hello', 3, null, false, true, ['a', 'b']);

  assert.strictEqual(p.tagName, 'P');
  assert.strictEqual(textOf(p), 'hello3ab');
  assert.strictEqual(p.children.length, 4);
  // No HTML entry points on the element, and none were set as attributes.
  assert.ok(!('innerHTML' in p));
  assert.deepStrictEqual(Object.keys(p.attrs), []);
});

test('h takes a plain string as the second argument, so h(p, text) works', () => {
  const nb = loadBase();
  const p = nb.h('p', 'a sentence');
  assert.strictEqual(textOf(p), 'a sentence');
});

test('h sets class and ordinary attributes with setAttribute', () => {
  const nb = loadBase();
  const btn = nb.h('button', {
    class: 'card primary', 'data-test': 'pick', type: 'button', disabled: true, title: 'Pick it',
  }, 'Pick');

  assert.strictEqual(btn.attrs.class, 'card primary');
  assert.strictEqual(btn.attrs['data-test'], 'pick');
  assert.strictEqual(btn.attrs.type, 'button');
  assert.strictEqual(btn.attrs.title, 'Pick it');
  assert.strictEqual(btn.attrs.disabled, ''); // a boolean attribute, present and empty
  assert.strictEqual(textOf(btn), 'Pick');
});

test('h drops a javascript: href and keeps a good one, with rel and target', () => {
  const nb = loadBase();
  const bad = nb.h('a', { href: 'javascript:alert(1)' }, 'no');
  assert.strictEqual(bad.getAttribute('href'), null);
  assert.strictEqual(bad.getAttribute('rel'), null);
  assert.strictEqual(textOf(bad), 'no'); // the text survives; only the link does not

  // Case and whitespace/control characters are no way around the rule.
  assert.strictEqual(nb.h('a', { href: 'JaVaScRiPt:alert(1)' }).getAttribute('href'), null);
  assert.strictEqual(nb.h('a', { href: '  javascript:alert(1)' }).getAttribute('href'), null);
  assert.strictEqual(nb.h('a', { href: 'java\tscript:alert(1)' }).getAttribute('href'), null);
  assert.strictEqual(nb.h('a', { href: 'data:text/html,<b>x</b>' }).getAttribute('href'), null);

  const good = nb.h('a', { href: 'https://example.org/book/1' }, 'the library');
  assert.strictEqual(good.getAttribute('href'), 'https://example.org/book/1');
  assert.strictEqual(good.getAttribute('rel'), 'noopener noreferrer');
  assert.strictEqual(good.getAttribute('target'), '_blank');
  assert.strictEqual(nb.h.safeHref('mailto:a@example.org'), 'mailto:a@example.org');
  assert.strictEqual(nb.h.safeHref('tel:+1 416 555 0100'), 'tel:+1 416 555 0100');
});

test('h reads attribute names case-insensitively, so HREF cannot carry a script', () => {
  const nb = loadBase();
  const bad = ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:msgbox(1)'];

  // Every spelling a browser treats as href gets the same answer as href.
  ['HREF', 'Href', 'HrEf'].forEach((name) => {
    bad.forEach((value) => {
      const attrs = {};
      attrs[name] = value;
      const a = nb.h('a', attrs, 'no');
      // The fake document only compares attribute names exactly, so check the stored names too:
      // a real browser would read HREF as href.
      assert.strictEqual(Object.keys(a.attrs).map((k) => k.toLowerCase()).indexOf('href'), -1,
        name + ' must not set an href attribute (' + value + ')');
      assert.strictEqual(a.getAttribute('href'), null, name + ' with ' + value + ' must not become a link');
      assert.deepStrictEqual(Object.keys(a.attrs), [], name + ' must set no attribute at all');
      assert.strictEqual(textOf(a), 'no'); // the text survives; only the link does not
    });
  });

  // A good address survives whatever the spelling, and still gets rel and target.
  const good = nb.h('a', { HREF: 'https://example.org/book/2' }, 'ok');
  assert.strictEqual(good.getAttribute('href'), 'https://example.org/book/2');
  assert.strictEqual(good.getAttribute('rel'), 'noopener noreferrer');
  assert.strictEqual(good.getAttribute('target'), '_blank');
});

test('h lower-cases the name for the other rules too: STYLE, ONCLICK, SRC, TEXT and CLASS', () => {
  const nb = loadBase();
  const clicks = [];

  // A differently-cased style, innerHTML, on* handler and src is the same rule, not a way round.
  const styled = nb.h('p', { STYLE: 'color:red', INNERHTML: '<b>x</b>', CLASS: 'note' }, 'text');
  assert.strictEqual(styled.attrs.style, undefined);
  assert.strictEqual(styled.attrs.innerhtml, undefined);
  assert.strictEqual(styled.attrs.class, 'note', 'an ordinary attribute is set under its lower-case name');
  assert.strictEqual(styled.getAttribute('CLASS'), null);

  const el = nb.h('button', { ONCLICK: () => clicks.push('click') });
  assert.strictEqual(el.attrs.onclick, undefined);
  assert.deepStrictEqual(Object.keys(el.listeners), ['click']);

  const img = nb.h('img', { SRC: 'https://example.org/track.gif', ALT: 'cover' });
  assert.strictEqual(img.getAttribute('src'), null); // no network
  assert.strictEqual(img.getAttribute('alt'), 'cover');

  // TEXT is still a text node, never markup.
  const p = nb.h('p', { TEXT: '<b>x</b>' });
  assert.strictEqual(p.children.length, 1);
  assert.strictEqual(p.children[0].nodeType, 3);
  assert.strictEqual(textOf(p), '<b>x</b>');
});

test('an href is only set on a link, so an svg use cannot load an outside file', () => {
  const nb = loadBase();

  const use = nb.h('use', { href: 'https://evil.example/x.svg#a' });
  assert.strictEqual(use.getAttribute('href'), null);
  assert.strictEqual(use.getAttribute('rel'), null);
  assert.strictEqual(use.getAttribute('target'), null);

  const svg = nb.h('svg', { href: 'https://evil.example/x.svg' });
  assert.strictEqual(svg.getAttribute('href'), null);

  // The address is dropped whatever the spelling of the name or the tag.
  const upper = nb.h('SVG', { HREF: 'https://evil.example/x.svg' });
  assert.strictEqual(upper.getAttribute('href'), null);

  // A link is unaffected, including an upper-case tag name.
  const link = nb.h('A', { href: 'https://example.org/book/3' }, 'the library');
  assert.strictEqual(link.getAttribute('href'), 'https://example.org/book/3');
  assert.strictEqual(link.getAttribute('rel'), 'noopener noreferrer');
  assert.strictEqual(link.getAttribute('target'), '_blank');
});

test('h attaches listeners with addEventListener and never as attributes', () => {
  const nb = loadBase();
  const clicks = [];
  const onClick = () => clicks.push('click');
  const onInput = () => clicks.push('input');

  const el = nb.h('button', { on: { click: onClick, input: onInput }, name: 'x' }, 'Go');
  assert.strictEqual(el.attrs.onclick, undefined);
  assert.strictEqual(el.attrs.on, undefined);
  assert.deepStrictEqual(plain(Object.keys(el.listeners)).sort(), ['click', 'input']);
  assert.strictEqual(el.listeners.click[0], onClick);
  el.listeners.click[0]('event');
  assert.deepStrictEqual(plain(clicks), ['click']);

  // The shorthand is the same mechanism, not an attribute.
  const el2 = nb.h('button', { onclick: onClick });
  assert.strictEqual(el2.attrs.onclick, undefined);
  assert.strictEqual(el2.listeners.click[0], onClick);

  // A string handler is not a handler.
  const el3 = nb.h('button', { onclick: 'alert(1)' });
  assert.strictEqual(el3.attrs.onclick, undefined);
  assert.deepStrictEqual(Object.keys(el3.listeners), []);
});

test('h refuses tags and attributes that can run or load things', () => {
  const nb = loadBase();
  assert.throws(() => nb.h('script', null, 'x'), /not allowed/);
  assert.throws(() => nb.h('iframe'), /not allowed/);
  assert.throws(() => nb.h('div onload=alert(1)'), /not allowed/);

  const img = nb.h('img', { src: 'https://example.org/track.gif', alt: 'a cover' });
  assert.strictEqual(img.getAttribute('src'), null); // no network
  assert.strictEqual(img.getAttribute('alt'), 'a cover');
  // Inline images are all that may pass as a src.
  assert.strictEqual(nb.h('img', { src: 'data:image/png;base64,AAA' }).getAttribute('src'), 'data:image/png;base64,AAA');

  const styled = nb.h('p', { style: 'color:red', innerHTML: '<b>x</b>' }, 'text');
  assert.strictEqual(styled.attrs.style, undefined);
  assert.strictEqual(styled.attrs.innerHTML, undefined);
});

// ---- norm -----------------------------------------------------------------------------------
test('norm lower cases, strips accents and punctuation, and collapses spaces', () => {
  const nb = loadBase();
  assert.strictEqual(nb.norm('The Dispossessed'), 'dispossessed');
  assert.strictEqual(nb.norm('  Les   Misérables '), 'les miserables');
  assert.strictEqual(nb.norm('Hello, World! (Revised)'), 'hello world revised');
  assert.strictEqual(nb.norm('Le Guin, Ursula K., 1929-2018'), 'le guin ursula k 1929 2018');
  assert.strictEqual(nb.norm("Don't Panic"), 'dont panic');
  assert.strictEqual(nb.norm('Æther — a novella'), 'æther a novella'); // æ is a letter of its own
  assert.strictEqual(nb.norm('Sœurs'), 'sœurs'); // œ is a letter, not an accent
});

test('norm drops one leading the, a or an, and only as a whole word', () => {
  const nb = loadBase();
  assert.strictEqual(nb.norm('A Wizard of Earthsea'), 'wizard of earthsea');
  assert.strictEqual(nb.norm('An Artist of the Floating World'), 'artist of the floating world');
  assert.strictEqual(nb.norm('THE LEFT HAND OF DARKNESS'), 'left hand of darkness');
  assert.strictEqual(nb.norm('Theatre'), 'theatre'); // "the" is part of the word
  assert.strictEqual(nb.norm('The The'), 'the'); // one article only
  assert.strictEqual(nb.norm(''), '');
  assert.strictEqual(nb.norm(null), '');
  assert.strictEqual(nb.norm(undefined), '');
  assert.strictEqual(nb.norm(2001), '2001');
});

// ---- strings and t --------------------------------------------------------------------------
test('t fills {name} placeholders and leaves an unknown one as written', () => {
  const nb = loadBase();
  assert.strictEqual(nb.t('appName'), 'nextbook');
  assert.strictEqual(nb.t('booksFound', { n: 18, words: 'birds toronto' }),
    'Your helper found 18 books for "birds toronto"');
  assert.strictEqual(nb.t('booksFound', { n: 0, words: 'x' }), 'Your helper found 0 books for "x"');
  assert.strictEqual(nb.t('booksFound', { n: 1 }), 'Your helper found 1 books for "{words}"');
  assert.strictEqual(nb.t('bookCount', { n: 3 }), '3 books');
});

test('t falls back to the key when it is missing, and never throws', () => {
  const nb = loadBase();
  assert.strictEqual(nb.t('no-such-string'), 'no-such-string');
  assert.strictEqual(nb.t('no-such-string', { n: 1 }), 'no-such-string');
  assert.strictEqual(nb.t('appName', null), 'nextbook');
  assert.strictEqual(nb.t('appName', { unused: 1 }), 'nextbook');
  assert.strictEqual(typeof nb.strings.libraryLine, 'string');
});

// ---- data -----------------------------------------------------------------------------------
test('data.get reads a good inline block, a broken one as null, and nothing as null', () => {
  const nb = loadBase({
    'nb-slice': '{"works": [{"id": "pack-1", "title": "The Dispossessed"}]}',
    'nb-tags': '{"works": {', // truncated by a bad edit
    'nb-empty': '',
  });

  assert.deepStrictEqual(plain(nb.data.get('slice')), { works: [{ id: 'pack-1', title: 'The Dispossessed' }] });
  assert.strictEqual(nb.data.get('tags'), null); // parsed in try/catch, no throw
  assert.strictEqual(nb.data.get('empty'), null);
  assert.strictEqual(nb.data.get('never-there'), null);
  assert.strictEqual(nb.data.get('workshop'), null);
});

test('data.put is read back first, even when a block has the same name', () => {
  const nb = loadBase({ 'nb-slice': '{"works": []}' });

  nb.data.put('slice', { works: [{ id: 'pack-2' }] });
  assert.deepStrictEqual(plain(nb.data.get('slice')), { works: [{ id: 'pack-2' }] });
  assert.strictEqual(nb.data.get('slice').works.length, 1);

  // put returns the value, so app/data/*.js can be one expression.
  const value = { a: 1 };
  assert.strictEqual(nb.data.put('other', value), value);
  assert.deepStrictEqual(plain(nb.data.get('other')), { a: 1 });
});

test('data.get works with no document at all', () => {
  const nb = load(['app/core/base.js']); // extras omitted: no window.document
  assert.strictEqual(nb.data.get('slice'), null);
  nb.data.put('slice', { works: [] });
  assert.deepStrictEqual(plain(nb.data.get('slice')), { works: [] });
});

// ---- workshop -------------------------------------------------------------------------------
test('workshop() is false with no flag and true once the flag is set', () => {
  const nb = loadBase();
  assert.strictEqual(nb.workshop(), false);

  nb.data.put('workshop', true);
  assert.strictEqual(nb.workshop(), true);

  // The flag file may carry an object; false in it means an ordinary copy.
  nb.data.put('workshop', { workshop: false });
  assert.strictEqual(nb.workshop(), false);
  nb.data.put('workshop', { workshop: true });
  assert.strictEqual(nb.workshop(), true);
});

test('workshop() is true only for a real yes', () => {
  // No block at all is an ordinary copy.
  assert.strictEqual(loadBase().workshop(), false);

  const nb = loadBase();
  // A set value is not a yes: only boolean true or {workshop: true} turns the practice shelf on.
  [0, 1, '', 'yes', 'true', false, [], { workshop: false }, { workshop: 'yes' }, { workshop: 1 }, {}]
    .forEach((flag) => {
      nb.data.put('workshop', flag);
      assert.strictEqual(nb.workshop(), false, 'workshop() must be false for ' + JSON.stringify(flag));
    });

  nb.data.put('workshop', true);
  assert.strictEqual(nb.workshop(), true);
  nb.data.put('workshop', { workshop: true });
  assert.strictEqual(nb.workshop(), true);
});

test('workshop() reads the packed workshop block', () => {
  const nb = loadBase({ 'nb-workshop': '{"workshop": true}' });
  assert.strictEqual(nb.workshop(), true);
});

// ---- The library's pages, one table (core/base.js) ------------------------------------------
test('library: the three shelves, in order, each with its state, address key and words', () => {
  const lib = nbLib();
  assert.deepStrictEqual(plain(lib.shelfKeys()), ['for_later', 'in_progress', 'completed']);
  assert.deepStrictEqual(plain(lib.shelves.map((s) => [s.key, s.state, s.account])), [
    ['for_later', 'want', 'forLater'], ['in_progress', 'reading', 'inProgress'], ['completed', 'read', 'completed']
  ]);
  lib.shelves.forEach((s) => {
    assert.ok(s.name, s.key + ' has a name');
    assert.ok(/^shelf[A-Z]/.test(s.word), s.key + ' has a strings key');
  });
});

test('library: stateOf and isShelf take only the library\'s own words', () => {
  const lib = nbLib();
  assert.strictEqual(lib.stateOf('in_progress'), 'reading');
  assert.strictEqual(lib.stateOf('holds'), null);
  assert.strictEqual(lib.stateOf('toString'), null);
  assert.strictEqual(lib.stateOf(undefined), null);
  assert.strictEqual(lib.isShelf('completed'), true);
  assert.strictEqual(lib.isShelf('__proto__'), false);
  assert.strictEqual(lib.shelf('nope'), null);
});

test('library: a hold is For Later there; stopped has no shelf', () => {
  const lib = nbLib();
  assert.strictEqual(lib.seenAs('hold'), 'want');
  assert.strictEqual(lib.seenAs('read'), 'read');
  assert.strictEqual(lib.seenAs('stopped'), null);
  assert.strictEqual(lib.shelfOf('want'), 'for_later');
  assert.strictEqual(lib.shelfOf('hold'), 'for_later');
  assert.strictEqual(lib.shelfOf('reading'), 'in_progress');
  assert.strictEqual(lib.shelfOf('stopped'), null);
  assert.strictEqual(lib.shelfOf(null), null);
});

test('library: shelfKeys is a copy, so a caller cannot reorder the table', () => {
  const lib = nbLib();
  const keys = lib.shelfKeys();
  keys.reverse();
  assert.strictEqual(lib.shelfKeys()[0], 'for_later');
});

function nbLib() { return load(['app/core/base.js']).library; }
