'use strict';
// T8.8a: reading a shelf page the person saved from the library's own site. The page is
// HTML (a browser's "Save page as") or the JSON that page carries. Nothing here reads the
// page, storage, a clock or the network: text in, plain objects out, in the shape
// `Nextbook.merge.plan` takes (app/core/merge.js).
//
//   Nextbook.libraryShelf.read(page, {now})
//     -> {ok, entries, works, complete, pages, problems, error, seen}
//
//   Nextbook.libraryShelf.combine(list)
//     -> the same, from several saved pages of one shelf (docs/ARCHITECTURE.md, "The edges":
//        a shelf is 25 books a page, so a long shelf is several files)
//
// THE ONE SECURITY RULE OF THIS FILE (docs/DATA.md, "A person's own shelf page"): the same
// file holds the person's card barcode, name, email, a session id and an auth token. So this
// reader looks at exactly two things, `entities.shelves` and the `briefInfo` of the records
// those items point at (`entities.bibs[metadataId].briefInfo`), and at nothing under
// `users`, `accounts`, `auth`, `borrowing` or any other key. A work is built field by field
// from a list (see `workOf`), never copied whole, so a field this file does not name cannot
// come out. tests/library-shelf.test.js puts all five decoys in the fixture and fails if any
// of them appears anywhere in the output.
//
// The facet rules are a port of adapters/bibliocommons/normalise.py, with the tables from
// adapters/bibliocommons/config.json. Where each rule comes from is said at the function.
// Rule 9 there ("drop a facet only one work carries") is deliberately NOT ported: it is a
// rule over a whole slice, and this reader sees one shelf page at a time, so every topic is
// kept even when only one book on this page carries it.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.libraryShelf = Nextbook.libraryShelf || {};

  // The reader's words join the one table, like the store's, the merge's and the CSV
  // reader's do. Grade 6: short sentences, no jargon.
  function addStrings(table) {
    Nextbook.strings = Nextbook.strings || {};
    Object.keys(table).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(Nextbook.strings, k)) Nextbook.strings[k] = table[k];
    });
  }
  addStrings({
    libraryShelfNotPage: 'This file does not look like a page saved from the library. ' +
      'Save the shelf page itself, not a link to it.',
    libraryShelfIsSearch: 'This is a search page, not one of your shelves. Open your shelf at the library, '
      + 'save that page, and choose it here.',
    libraryShelfUnreadable: 'This file could not be read. Save the shelf page again from the library.',
    libraryShelfNoTitle: 'A book on the {shelf} shelf (id {id}) has no title, so it was left out.',
    libraryShelfUnknownShelf: '{title} (id {id}): the page says its shelf is "{shelf}", which is ' +
      'not a shelf this app knows, so it was left out.',
    libraryShelfNoRecord: '{title}: the page has no record for this book, so it was left out.'
  });

  function t(key, vars) {
    return typeof Nextbook.t === 'function' ? Nextbook.t(key, vars) : String(key);
  }

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function str(x) { return typeof x === 'string' ? x : ''; }

  function arr(x) { return Array.isArray(x) ? x : []; }

  // Same spelling as the rest of the app (base.js, norm). A missing base.js falls back to a
  // plain lower case, so this file still loads on its own.
  function normText(value) {
    if (typeof Nextbook.norm === 'function') return Nextbook.norm(value);
    return String(value === null || value === undefined ? '' : value).toLowerCase();
  }

  function collapse(text) {
    return String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
  }

  // ---- the library's shelf words -------------------------------------------------------------
  // docs/DATA.md: `shelf` is for_later, in_progress or completed; `rating` is out of 10
  // (stars times two) and 0 means not rated. The state is ours, from the table in
  // docs/ARCHITECTURE.md, "Lining up with the library's own shelves".
  var SHELF_STATE = { for_later: 'want', in_progress: 'reading', completed: 'read' };
  var SHELF_ORDER = ['for_later', 'in_progress', 'completed'];
  // How far along a state is. Used only to pick between two editions of one work: completed
  // beats reading, reading beats want. "stopped" cannot come from the library.
  var STATE_RANK = { want: 1, reading: 2, read: 3 };

  var FROM = 'library-shelf';

  // 9 and 10 are loved, 7 and 8 liked, 5 and 6 ok, 1 to 4 not-for-me, 0 is not rated. The
  // same table as merge.js and import.js, repeated because a reader may load without them.
  function bucketOf10(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
    if (n >= 9) return 'loved';
    if (n >= 7) return 'liked';
    if (n >= 5) return 'ok';
    return 'not-for-me';
  }

  // Ten out of ten, or a numeric string from a hand-edited file. Anything else is 0, which
  // is the library's own word for "not rated".
  function rating10Of(raw) {
    if (typeof raw === 'number' && isFinite(raw)) return raw;
    if (typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim())) return Number(raw.trim());
    return 0;
  }

  function dateOf(raw) {
    var s = str(raw).trim();
    return s || null;
  }

  function isbnOf(list) {
    var values = arr(list);
    for (var i = 0; i < values.length; i++) {
      var s = String(values[i] === null || values[i] === undefined ? '' : values[i]).replace(/[\s-]/g, '');
      if (/^[0-9X]{10,13}$/i.test(s)) return s;
    }
    return '';
  }

  function yearOf(raw) {
    var head = str(raw).slice(0, 4);
    return /^\d{4}$/.test(head) ? Number(head) : null;
  }

  // ---- the adapter's facet rules, in JS ------------------------------------------------------
  // Ported from adapters/bibliocommons/normalise.py; the tables are copied from
  // adapters/bibliocommons/config.json so a shelf page and a catalogue record from the same
  // library land on the same facets, and so a pack book and an imported book share a shelf.

  // config.json "dewey_labels": the ten hundreds, with the words the app shows.
  var DEWEY_LABELS = {
    '000': 'general works (000s)',
    '100': 'the philosophy shelves (100s)',
    '200': 'the religion shelves (200s)',
    '300': 'the shelves about people and society (300s)',
    '400': 'the language shelves (400s)',
    '500': 'the science shelves (500s)',
    '600': 'the shelves about how things are made (600s)',
    '700': 'the art shelves (700s)',
    '800': 'the literature shelves (800s)',
    '900': 'the history shelves (900s)'
  };

  // config.json "fiction_shelves": a call number that starts with a class made of letters.
  var FICTION_SHELVES = [
    { words: ['SCIENCE FICTION'], key: 'science-fiction', label: 'the science fiction shelves' },
    { words: ['FANTASY'], key: 'fantasy', label: 'the fantasy shelves' },
    { words: ['MYSTERY'], key: 'mystery', label: 'the mystery shelves' },
    { words: ['HORROR'], key: 'horror', label: 'the horror shelves' },
    { words: ['ROMANCE'], key: 'romance', label: 'the romance shelves' },
    { words: ['FICTION', 'FIC'], key: 'fiction', label: 'the fiction shelves' }
  ];

  // config.json "form_subdivisions", longest first, so "Juvenile fiction" is tried before
  // "Fiction" (normalise.py sorts by length the same way).
  var FORM_SUBDIVISIONS = [
    'Juvenile fiction', 'Juvenile literature', 'Comic books, strips, etc',
    'Criticism and interpretation', 'Fiction', 'History', 'Biography', 'Drama', 'Poetry'
  ].sort(function (a, b) { return b.length - a.length; });

  // config.json "genre_words" and "dropped_genres". `Fiction` and `Literature` alone say
  // nothing about a book (every fiction work has them), so they are dropped as genres --
  // but a `Fiction` heading is still used for the fiction shelf below.
  function setOf(list) {
    var out = {};
    for (var i = 0; i < list.length; i++) out[String(list[i]).toLowerCase()] = true;
    return out;
  }
  var GENRE_WORDS = setOf([
    'Fiction', 'Literature', 'Science Fiction', 'Fantasy', 'Fantasy Fiction', 'Thriller',
    'Mystery', 'Horror', 'Romance', 'Mythology', 'Young Adult Fiction', 'Juvenile Fiction',
    'Comic and Graphic Books', 'Graphic Novels', 'Historical Fiction', 'Suspense',
    'Adventure', 'Humorous Fiction', 'Short Stories', 'Poetry', 'Drama', 'Biography',
    'Nonfiction', 'Non-fiction', 'Folklore', 'Fairy Tales'
  ]);
  var DROPPED_GENRES = setOf(['Fiction', 'Literature']);

  var MARKS = /[\u0300-\u036f]/g;

  // normalise.py, slug(): lower case, accents folded, apostrophes gone, words joined by "-".
  function slug(text) {
    var s = String(text === null || text === undefined ? '' : text);
    if (typeof s.normalize === 'function') s = s.normalize('NFKD').replace(MARKS, '');
    // Python encodes to ascii with "ignore", so a letter it cannot fold is dropped, not
    // guessed at.
    s = s.replace(/[^\x00-\x7f]/g, '');
    s = s.toLowerCase().replace(/['\u2019]/g, '');
    s = s.replace(/[^a-z0-9]+/g, '-');
    return s.replace(/^-+|-+$/g, '');
  }

  // ---- author names (normalise.py, author_display / author_key) ------------------------------
  var DATE_PART = /^\d{3,4}\s*(?:[-\u2013\u2014]\s*(?:\d{3,4}|[A-Za-z]+)?)?\.?$/;
  var PARENTHETICAL = /\([^)]*\)/g;
  // Surname particles a catalogue sometimes files after the given names
  // ("Guin, Ursula K. Le").
  var PARTICLES = setOf([
    'le', 'la', 'de', 'van', 'von', 'der', 'den', 'da', 'di', 'du', 'des', 'del',
    'della', 'al', 'el', 'bin', 'ibn', 'ten', 'ter', 'af', 'av'
  ]);

  function nameParts(name) {
    var text = collapse(String(name === null || name === undefined ? '' : name).replace(PARENTHETICAL, ''));
    if (!text) return [];
    return text.split(',').map(function (part) { return part.trim(); }).filter(function (part) { return !!part; });
  }

  // "Le Guin, Ursula K., 1929-2018" -> "Ursula K. Le Guin".
  function authorDisplay(name) {
    var parts = nameParts(name).filter(function (part) { return !DATE_PART.test(part); });
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(1).concat([parts[0]]).join(' ');
  }

  function particleSplit(last, first) {
    if (!last || !first) return [last, first];
    if (last.split(' ').length !== 1) return [last, first];
    var words = first.split(' ');
    if (words.length < 2) return [last, first];
    var tail = words[words.length - 1].replace(/^\.+|\.+$/g, '').toLowerCase();
    if (!has(PARTICLES, tail)) return [last, first];
    return [[words[words.length - 1], last].join(' '), words.slice(0, -1).join(' ')];
  }

  // "Golub, L. (Leon)" -> "golub, l"; "Ursula K. Le Guin" -> "le guin, u".
  function authorKeyOf(name) {
    var parts = nameParts(name);
    if (!parts.length) return '';
    var last;
    var first;
    if (parts.length >= 2) {
      var split = particleSplit(parts[0], parts[1]);
      last = split[0];
      first = split[1];
    } else {
      var words = parts[0].split(' ');
      last = words[words.length - 1];
      first = words.length > 1 ? words[0] : '';
    }
    last = String(last || '').replace(/[.\s]+$/, '').toLowerCase();
    var initial = first ? first.charAt(0).toLowerCase() : '';
    return initial ? last + ', ' + initial : last;
  }

  // rule 1: a heading that names an author of the work, or "<Last>, <First>, <year>-".
  var AUTHOR_HEADING = /^[^,]+,\s*[^,]+,\s*\d{3,4}\s*(?:[-\u2013\u2014]|\s*$)/;

  function isAuthorHeading(text, authors) {
    if (AUTHOR_HEADING.test(text)) return true;
    var key = authorKeyOf(text);
    if (!key) return false;
    for (var i = 0; i < authors.length; i++) {
      if (authorKeyOf(authors[i]) === key) return true;
    }
    return false;
  }

  // rule 3: "FICTION / Science Fiction / X bisacsh" -> bisac:science-fiction.
  function bisacFacet(heading) {
    var text = collapse(heading);
    if (!/ bisacsh$/i.test(text)) return null;
    var body = text.slice(0, text.length - ' bisacsh'.length).trim().replace(/\.+$/, '').trim();
    var levels = body.split('/').map(function (level) {
      return level.trim().replace(/\.+$/, '').trim();
    }).filter(function (level) { return !!level; });
    if (!levels.length) return null;
    var chosen = levels.length > 1 ? levels[1] : levels[0];
    if (chosen.toLowerCase() === 'general') chosen = levels[0];
    if (!chosen) return null;
    return ['bisac:' + slug(chosen), chosen.toLowerCase()];
  }

  // rule 4: strip a trailing form word; what is left is the topic.
  function topicFacet(heading) {
    var text = collapse(heading).replace(/\.+$/, '').trim();
    if (!text) return null;
    var lowered = text.toLowerCase();
    for (var i = 0; i < FORM_SUBDIVISIONS.length; i++) {
      var form = FORM_SUBDIVISIONS[i];
      if (lowered.slice(-form.length) !== form.toLowerCase()) continue;
      var rest = text.slice(0, text.length - form.length).replace(/^[\s,;:.]+|[\s,;:.]+$/g, '');
      if (!rest) return null; // a form word on its own is not a topic
      return ['topic:' + slug(rest), rest.toLowerCase()];
    }
    var key = slug(text);
    return key ? ['topic:' + key, text.toLowerCase()] : null;
  }

  // rule 5: a heading that is exactly a known genre word.
  function genreFacet(heading) {
    var text = collapse(heading).replace(/\.+$/, '').trim();
    var folded = text.toLowerCase();
    if (!text || !has(GENRE_WORDS, folded) || has(DROPPED_GENRES, folded)) return null;
    return ['genre:' + slug(text), text.toLowerCase()];
  }

  // rules 1 to 5 over one list of headings. Returns {facet: label}.
  function headingFacets(headings, authors) {
    var found = {};
    for (var i = 0; i < headings.length; i++) {
      var text = collapse(headings[i]);
      if (!text) continue;
      if (isAuthorHeading(text, authors)) continue;
      if (/ fast$/i.test(text)) continue; // rule 2: the "fast" twin of another heading
      var bare = text.replace(/\.+$/, '').trim().toLowerCase();
      if (has(GENRE_WORDS, bare)) {
        var genre = genreFacet(text);
        if (genre) found[genre[0]] = genre[1];
        continue;
      }
      var pair = bisacFacet(text) || topicFacet(text);
      if (pair) found[pair[0]] = pair[1];
    }
    return found;
  }

  // rule 6: "813.54 L2453.109" -> section:800; "SCIENCE FICTION LEG" -> section:science-fiction.
  function sectionFromCallNumber(callNumber) {
    var text = collapse(callNumber).toUpperCase();
    if (!text || text.indexOf('ON ORDER') !== -1) return null;
    var dewey = /^(\d{3})/.exec(text);
    if (dewey) return 'section:' + dewey[1].charAt(0) + '00';

    var tokens = text.split(' ');
    var best = null; // {words, key}
    for (var i = 0; i < FICTION_SHELVES.length; i++) {
      var shelf = FICTION_SHELVES[i];
      for (var a = 0; a < shelf.words.length; a++) {
        var words = shelf.words[a].split(' ');
        if (!words.length) continue;
        for (var start = 0; start + words.length <= tokens.length; start++) {
          if (tokens.slice(start, start + words.length).join(' ') !== words.join(' ')) continue;
          if (!best || words.length > best.words) best = { words: words.length, key: shelf.key };
          break;
        }
      }
    }
    return best ? 'section:' + best.key : null;
  }

  // The words for a section key: the ten Dewey labels from config.json "dewey_labels", and
  // the fiction shelves from "fiction_shelves". The pool's dictionary normally supplies every
  // label; this one answers for a book the slice has never seen.
  function sectionLabel(section) {
    var key = String(section === null || section === undefined ? '' : section).replace(/^section:/, '');
    if (has(DEWEY_LABELS, key)) return DEWEY_LABELS[key];
    for (var i = 0; i < FICTION_SHELVES.length; i++) {
      if (FICTION_SHELVES[i].key === key) return FICTION_SHELVES[i].label;
    }
    return '';
  }

  // The adapter reads a section from the call number only. A shelf-page record often has
  // none (an e-book has no shelf address), so two small additions give one anyway: a
  // "Fiction" heading -- a word rule 5 drops as a genre, because it explains nothing -- and
  // the catalogue's own `contentType`. Both say "fiction shelves" and nothing more, which is
  // what a record with no call number can honestly support.
  function sectionOf(brief, headings, authors) {
    var fromCallNumber = sectionFromCallNumber(brief.callNumber);
    if (fromCallNumber) return fromCallNumber;
    for (var i = 0; i < headings.length; i++) {
      if (isAuthorHeading(collapse(headings[i]), authors)) continue;
      if (collapse(headings[i]).replace(/\.+$/, '').trim().toLowerCase() === 'fiction') return 'section:fiction';
    }
    if (str(brief.contentType).toUpperCase() === 'FICTION') return 'section:fiction';
    return null;
  }

  // The subject words the library actually gave, cleaned: whitespace collapsed, a trailing
  // period gone, author headings and "fast" twins dropped. This is not a facet list; it is
  // what the record said, for a screen that wants to name it.
  function subjectsOf(headings, authors) {
    var out = [];
    var seen = {};
    for (var i = 0; i < headings.length; i++) {
      var text = collapse(headings[i]).replace(/\.+$/, '').trim();
      if (!text || isAuthorHeading(text, authors) || / fast$/i.test(text)) continue;
      var key = text.toLowerCase();
      if (has(seen, key)) continue;
      seen[key] = true;
      out.push(text);
    }
    return out;
  }

  // ---- one work from one record ---------------------------------------------------------------
  // Field by field from briefInfo, so `description`, `jacket` and `rating` from the page cannot
  // ride along (AGENTS.md rule 4; docs/DATA.md says to drop them). The list is exactly what
  // the app needs to score a book that is not in the slice (app/core/slice.js).
  function workOf(brief, recordId) {
    var headings = arr(brief.subjectHeadings).map(function (h) { return String(h === null || h === undefined ? '' : h); });
    var authors = arr(brief.authors);
    var facets = headingFacets(headings, authors);

    // Every `genreForm` value is a genre (normalise.py, genre_facets).
    var forms = arr(brief.genreForm);
    for (var i = 0; i < forms.length; i++) {
      var text = collapse(forms[i]).replace(/\.+$/, '').trim();
      if (!text || has(DROPPED_GENRES, text.toLowerCase())) continue;
      facets['genre:' + slug(text)] = text.toLowerCase();
    }

    var section = sectionOf(brief, headings, authors);
    if (section) facets[section] = sectionLabel(section);

    var keys = Object.keys(facets).sort();
    return {
      id: recordId,
      groupKey: str(brief.groupKey) || null,
      title: collapse(brief.title),
      author: authors.length ? authorDisplay(authors[0]) : '',
      authorKey: authors.length ? authorKeyOf(authors[0]) : '',
      year: yearOf(brief.publicationDate),
      isbn: isbnOf(brief.isbns),
      subjects: subjectsOf(headings, authors),
      sections: section ? [section] : [],
      facets: keys
    };
  }

  // ---- finding the state in a saved page ------------------------------------------------------
  var SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

  function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function isState(x) {
    return isObj(x) && isObj(x.entities);
  }

  // One script's body, or the whole text, as a state. A page may wrap the JSON as
  // `window.__STATE__ = {...};`, so the braces are tried too -- by slicing the text and
  // parsing it with JSON.parse, never by running it. Nothing on the page becomes code.
  function stateOfBody(raw) {
    var body = str(raw).trim();
    if (!body) return null;
    var parsed = parseJson(body);
    if (!isState(parsed)) {
      var open = body.indexOf('{');
      var close = body.lastIndexOf('}');
      if (open === -1 || close <= open) return null;
      parsed = parseJson(body.slice(open, close + 1));
    }
    return isState(parsed) ? parsed : null;
  }

  function stateOf(page) {
    if (isObj(page)) return isState(page) ? page : null;
    var text = str(page);
    if (!text) return null;
    var match;
    SCRIPT_BLOCK.lastIndex = 0;
    while ((match = SCRIPT_BLOCK.exec(text)) !== null) {
      var found = stateOfBody(match[1]);
      if (found) return found;
    }
    return stateOfBody(text);
  }

  // ---- the shelves on the page ----------------------------------------------------------------
  // `entities.shelves.<userId>` maps a shelf item id to one item. `shelfSearch` sits beside
  // the person's map and carries the page's own totals; it is picked out separately.
  function shelfItemMaps(shelves) {
    var out = [];
    var keys = Object.keys(shelves);
    for (var i = 0; i < keys.length; i++) {
      var map = shelves[keys[i]];
      if (!isObj(map)) continue;
      var inner = Object.keys(map);
      for (var j = 0; j < inner.length; j++) {
        var value = map[inner[j]];
        if (isObj(value) && typeof value.shelf === 'string') { out.push(map); break; }
      }
    }
    return out;
  }

  function sortItemIds(keys) {
    return keys.slice().sort(function (a, b) {
      var x = Number(a);
      var y = Number(b);
      if (isFinite(x) && isFinite(y) && a !== '' && b !== '') return x - y;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  function itemsOf(shelves) {
    var maps = shelfItemMaps(shelves);
    var out = [];
    for (var i = 0; i < maps.length; i++) {
      var keys = sortItemIds(Object.keys(maps[i]));
      for (var j = 0; j < keys.length; j++) {
        var item = maps[i][keys[j]];
        if (!isObj(item) || typeof item.shelf !== 'string') continue;
        out.push({ itemId: keys[j], item: item });
      }
    }
    // Shelf order, then item order: a page read in the order the person would see it.
    out.sort(function (a, b) {
      var sa = SHELF_ORDER.indexOf(a.item.shelf);
      var sb = SHELF_ORDER.indexOf(b.item.shelf);
      if (sa === -1) sa = SHELF_ORDER.length;
      if (sb === -1) sb = SHELF_ORDER.length;
      return sa - sb;
    });
    return out;
  }

  // The page's own totals: `entities.shelves.shelfSearch.summary`, one entry per shelf. A
  // number is a count; an object may say count, page and pages under any of the names below
  // (a saved page has been seen with `total` and `perPage` beside `page`). Nothing here
  // guesses: a shelf the page does not mention has no count, and then it cannot be complete.
  function numberFrom(obj, names) {
    for (var i = 0; i < names.length; i++) {
      var value = has(obj, names[i]) ? obj[names[i]] : null;
      if (typeof value === 'number' && isFinite(value)) return value;
      if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
    }
    return null;
  }

  function statedFor(summary, shelf) {
    if (!isObj(summary) || !has(summary, shelf)) return null;
    var raw = summary[shelf];
    if (typeof raw === 'number' && isFinite(raw)) return { count: raw, page: null, pages: null };
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return { count: Number(raw.trim()), page: null, pages: null };
    if (!isObj(raw)) return null;
    var count = numberFrom(raw, ['count', 'total', 'totalResults', 'total_count']);
    var page = numberFrom(raw, ['page', 'currentPage', 'pageNumber', 'page_num']);
    var pages = numberFrom(raw, ['pages', 'totalPages', 'pageCount', 'total_pages']);
    if (count === null && page === null && pages === null) return null;
    return { count: count, page: page, pages: pages };
  }

  function summaryOf(shelves) {
    var search = isObj(shelves.shelfSearch) ? shelves.shelfSearch : null;
    if (!search) return null;
    if (isObj(search.summary)) return search.summary;
    // A page whose shelfSearch is the summary itself.
    return search;
  }

  function emptyPages() {
    var out = {};
    for (var i = 0; i < SHELF_ORDER.length; i++) {
      out[SHELF_ORDER[i]] = { page: null, pages: null, count: null, got: 0 };
    }
    return out;
  }

  function emptyComplete() {
    var out = {};
    for (var i = 0; i < SHELF_ORDER.length; i++) out[SHELF_ORDER[i]] = false;
    return out;
  }

  // A saved page carries no shelf totals: measured on a real page (RESEARCH.md, 2026-11-04) the
  // state has `entities.shelves.<user>` and no `shelfSearch` and no `meta`, so "how many books
  // are on this shelf" is simply not in the file. That is not the same as "you saved part of it".
  // `unknown` says which shelves we were not told about, and the merge keeps quiet about those
  // instead of telling a person their shelf was not fully saved when it may well have been.
  function emptyUnknown() {
    var out = {};
    for (var i = 0; i < SHELF_ORDER.length; i++) out[SHELF_ORDER[i]] = true;
    return out;
  }

  // ---- the records the items point at ---------------------------------------------------------
  function briefOf(bibs, recordId) {
    if (!isObj(bibs) || !recordId || !has(bibs, recordId)) return null;
    var bib = bibs[recordId];
    if (!isObj(bib)) return null;
    if (isObj(bib.briefInfo)) return bib.briefInfo;
    // A page whose bib is already the brief.
    if (typeof bib.title === 'string') return bib;
    return null;
  }

  function recordIdOf(item) {
    return str(item.metadataId) || str(item.id);
  }

  function authorOf(brief, item) {
    var authors = arr(brief && brief.authors);
    for (var i = 0; i < authors.length; i++) {
      var name = authorDisplay(authors[i]);
      if (name) return name;
    }
    var listed = arr(item && item.authors);
    for (var j = 0; j < listed.length; j++) {
      var text = collapse(listed[j]);
      if (text) return text;
    }
    return '';
  }

  // The key the app uses (merge.js, keyFor): the library's own groupKey when there is one,
  // so two editions of one work share a key, else title and author normalised.
  function keyFor(groupKey, title, author) {
    if (groupKey) return 'w:' + groupKey;
    var name = normText(title);
    if (!name) return '';
    return 't:' + name + '|' + normText(author);
  }

  // ---- editions ---------------------------------------------------------------------------------
  // The library shelf may hold the e-book and the app the paper copy, so two items can be one
  // work. They become one entry with the furthest-along state (docs/ARCHITECTURE.md, "The
  // edges"). A rating rides with the edition that got furthest; when that one is unrated, the
  // first edition that has a rating fills it in, so a loved e-book beside an unrated re-read
  // does not lose its stars.
  function mergeEditions(list) {
    var best = list[0];
    var bestRank = -1;
    var i;
    for (i = 0; i < list.length; i++) {
      var rank = has(STATE_RANK, list[i].state) ? STATE_RANK[list[i].state] : 0;
      if (rank > bestRank) { bestRank = rank; best = list[i]; }
    }
    var rating = best.rating;
    var rating10 = best.rating10;
    if (rating === null) {
      for (i = 0; i < list.length; i++) {
        if (list[i].rating === null) continue;
        rating = list[i].rating;
        rating10 = list[i].rating10;
        break;
      }
    }
    return {
      key: best.key,
      id: best.id,
      groupKey: best.groupKey,
      title: best.title,
      author: best.author,
      isbn: best.isbn,
      shelf: best.shelf,
      state: best.state,
      rating: rating,
      rating10: rating10,
      dateAdded: best.dateAdded,
      from: FROM
    };
  }

  function groupBy(list, keyOf) {
    var order = [];
    var groups = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var key = keyOf(list[i]);
      if (!key) continue;
      if (!has(groups, key)) { groups[key] = []; order.push(key); }
      groups[key].push(list[i]);
    }
    return order.map(function (key) { return groups[key]; });
  }

  // ---- works: one per work, the union over its editions (normalise.py, rule 8) -----------------
  // The record id comes from the preferred format: BK, then LPRINT, then EBOOK, then
  // EAUDIOBOOK, then anything (config-free table from normalise.py, FORMAT_PREFERENCE).
  var FORMAT_RANK = { BK: 0, LPRINT: 1, EBOOK: 2, EAUDIOBOOK: 3 };

  function formatRank(brief) {
    var format = str(brief.format).toUpperCase();
    return has(FORMAT_RANK, format) ? FORMAT_RANK[format] : 4;
  }

  function union(into, from) {
    for (var i = 0; i < from.length; i++) {
      if (into.indexOf(from[i]) === -1) into.push(from[i]);
    }
    return into;
  }

  function workGroups(items) {
    var groups = Object.create(null);
    var order = [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i];
      if (!entry.work) continue;
      var key = entry.work.groupKey ? 'g:' + entry.work.groupKey : 'id:' + entry.work.id;
      if (!has(groups, key)) { groups[key] = { work: null, rank: 99, list: [] }; order.push(key); }
      var group = groups[key];
      group.list.push(entry.work);
      var rank = formatRank(entry.brief || {});
      if (rank < group.rank) { group.rank = rank; group.work = entry.work; }
    }
    return order.map(function (key) {
      var group = groups[key];
      var head = null;
      for (var j = 0; j < group.list.length; j++) {
        if (group.list[j] === group.work) { head = group.list[j]; break; }
      }
      if (!head) head = group.list[0];
      // The preferred format gives id, title and author; the first record that has a fact
      // gives the rest (normalise.py, work_from).
      var work = {
        id: head.id,
        groupKey: head.groupKey,
        title: head.title,
        author: head.author,
        authorKey: head.authorKey,
        year: head.year,
        isbn: head.isbn,
        subjects: head.subjects.slice(),
        sections: head.sections.slice(),
        facets: head.facets.slice()
      };
      for (var k = 0; k < group.list.length; k++) {
        var other = group.list[k];
        if (other === head) continue;
        if (!work.title && other.title) work.title = other.title;
        if (!work.author && other.author) { work.author = other.author; work.authorKey = other.authorKey; }
        if (work.year === null) work.year = other.year;
        if (!work.isbn) work.isbn = other.isbn;
        union(work.subjects, other.subjects);
        union(work.sections, other.sections);
        union(work.facets, other.facets);
      }
      work.facets.sort();
      work.sections.sort();
      return work;
    });
  }

  // ---- read -----------------------------------------------------------------------------------
  function readState(state) {
    var entities = state.entities;
    var shelves = isObj(entities.shelves) ? entities.shelves : {};
    var bibs = isObj(entities.bibs) ? entities.bibs : {};
    var summary = summaryOf(shelves);
    var items = itemsOf(shelves);

    var got = { for_later: 0, in_progress: 0, completed: 0 };
    var raw = [];
    var problems = [];
    var doubtful = false; // an item naming a shelf we do not know
    var i;

    for (i = 0; i < items.length; i++) {
      var itemId = items[i].itemId;
      var item = items[i].item;
      var shelf = item.shelf;
      var recordId = recordIdOf(item);
      var brief = briefOf(bibs, recordId);
      var title = collapse(brief ? brief.title : '') || collapse(item.title);

      if (!has(SHELF_STATE, shelf)) {
        // The row's shelf is exactly what could not be read, so no shelf can be called
        // whole: the merge must not read an absent book as gone (import.js does the same).
        doubtful = true;
        problems.push(t('libraryShelfUnknownShelf', {
          title: title || 'A book',
          id: itemId,
          shelf: shelf || ''
        }));
        continue;
      }

      if (!title || !normText(title)) {
        problems.push(t('libraryShelfNoTitle', { shelf: shelf.replace(/_/g, ' '), id: itemId }));
        continue;
      }

      if (!brief) {
        problems.push(t('libraryShelfNoRecord', { title: title }));
        continue;
      }

      var rating10 = rating10Of(item.rating);
      var author = authorOf(brief, item);
      var groupKey = str(brief.groupKey) || null;
      raw.push({
        brief: brief,
        work: workOf(brief, recordId),
        entry: {
          key: keyFor(groupKey, title, author),
          id: recordId || null,
          groupKey: groupKey,
          title: title,
          author: author,
          isbn: isbnOf(brief.isbns),
          shelf: shelf,
          state: SHELF_STATE[shelf],
          rating: bucketOf10(rating10),
          rating10: rating10,
          dateAdded: dateOf(item.dateAdded),
          from: FROM
        }
      });
      got[shelf] += 1;
    }

    var entries = groupBy(raw.map(function (row) { return row.entry; }), function (entry) {
      return entry.key;
    }).map(mergeEditions);

    var works = workGroups(raw);
    var pages = emptyPages();
    for (i = 0; i < SHELF_ORDER.length; i++) {
      var name = SHELF_ORDER[i];
      var stated = statedFor(summary, name);
      pages[name] = {
        page: stated ? stated.page : null,
        pages: stated ? stated.pages : null,
        count: stated ? stated.count : null,
        got: got[name]
      };
    }

    // `complete` is "this page alone covers the shelf". With no stated count it cannot be
    // said, so it is false: a missing number is not a whole shelf.
    var complete = emptyComplete();
    var unknown = emptyUnknown();
    for (i = 0; i < SHELF_ORDER.length; i++) {
      var shelfName = SHELF_ORDER[i];
      unknown[shelfName] = doubtful || pages[shelfName].count === null;
      complete[shelfName] = !doubtful &&
        pages[shelfName].count !== null && pages[shelfName].got >= pages[shelfName].count;
    }

    return {
      entries: entries, works: works, complete: complete, unknown: unknown,
      pages: pages, problems: problems, items: items.length
    };
  }

  function read(page, opts) {
    var options = isObj(opts) ? opts : {};
    var result = {
      ok: false,
      entries: [],
      works: [],
      complete: emptyComplete(),
      unknown: emptyUnknown(),
      pages: emptyPages(),
      problems: [],
      error: '',
      seen: str(options.now)
    };

    try {
      var state = stateOf(page);
      if (!state) {
        result.error = t('libraryShelfNotPage');
        return result;
      }
      var built = readState(state);
      // A search page carries the same `entities` with results in `bibs` and nothing on a shelf.
      // Reading it would say "0 books" as if the shelf were empty, so it is refused instead.
      var bibCount = isObj(state.entities.bibs) ? Object.keys(state.entities.bibs).length : 0;
      if (built.items === 0 && bibCount > 0) {
        result.error = t('libraryShelfIsSearch');
        return result;
      }
      result.ok = true;
      result.entries = built.entries;
      result.works = built.works;
      result.complete = built.complete;
      result.unknown = built.unknown;
      result.pages = built.pages;
      result.problems = built.problems;
      return result;
    } catch (e) {
      // A hand-edited file can be anything. It is said plainly, never thrown.
      return {
        ok: false,
        entries: [],
        works: [],
        complete: emptyComplete(),
        unknown: emptyUnknown(),
        pages: emptyPages(),
        problems: [],
        error: t('libraryShelfUnreadable'),
        seen: str(options.now)
      };
    }
  }

  // ---- combine: several saved pages of one shelf -----------------------------------------------
  // A shelf is 25 books a page (docs/DATA.md), so a long shelf is several files. Each result
  // keeps entries in the shape merge.plan takes, so the pages are added up here: entries
  // deduped by key with the furthest state, works unioned by groupKey, and a shelf complete
  // only when the saved pages cover it -- every page of it, or enough items to reach its
  // stated count. The same page saved twice is counted once, by its own page number.
  function combine(list) {
    var results = arr(list).filter(function (r) { return isObj(r) && Array.isArray(r.entries); });
    var out = {
      ok: false,
      entries: [],
      works: [],
      complete: emptyComplete(),
      unknown: emptyUnknown(),
      pages: emptyPages(),
      problems: [],
      error: '',
      seen: ''
    };

    if (!results.length) {
      out.error = t('libraryShelfNotPage');
      return out;
    }

    var anyOk = false;
    var firstError = '';
    var perShelf = Object.create(null);
    for (var i = 0; i < SHELF_ORDER.length; i++) {
      perShelf[SHELF_ORDER[i]] = { byPage: Object.create(null), loose: 0, count: null, pages: null };
    }

    var entries = [];
    var works = [];
    var problems = [];
    var seen = '';

    for (var r = 0; r < results.length; r++) {
      var result = results[r];
      if (result.ok !== false) anyOk = true;
      if (!firstError && typeof result.error === 'string' && result.error) firstError = result.error;
      if (typeof result.seen === 'string' && result.seen > seen) seen = result.seen;
      entries = entries.concat(result.entries);
      works = works.concat(result.works);

      var said = Array.isArray(result.problems) ? result.problems : [];
      for (var p = 0; p < said.length; p++) {
        if (problems.indexOf(said[p]) === -1) problems.push(said[p]);
      }

      var pages = isObj(result.pages) ? result.pages : {};
      for (var s = 0; s < SHELF_ORDER.length; s++) {
        var shelf = SHELF_ORDER[s];
        var stated = isObj(pages[shelf]) ? pages[shelf] : null;
        if (!stated) continue;
        var mine = perShelf[shelf];
        var count = typeof stated.count === 'number' && isFinite(stated.count) ? stated.count : null;
        if (count !== null) mine.count = mine.count === null ? count : Math.max(mine.count, count);
        var total = typeof stated.pages === 'number' && isFinite(stated.pages) ? stated.pages : null;
        if (total !== null) mine.pages = mine.pages === null ? total : Math.max(mine.pages, total);
        var gotHere = typeof stated.got === 'number' && isFinite(stated.got) ? stated.got : 0;
        if (typeof stated.page === 'number' && isFinite(stated.page)) {
          // The same page saved twice is not two pages of reading; and a page saved while
          // looking at another shelf carries a total but none of that shelf's items, which
          // must not erase the items the shelf's own page did carry.
          var before = has(mine.byPage, stated.page) ? mine.byPage[stated.page] : 0;
          mine.byPage[stated.page] = Math.max(before, gotHere);
        } else {
          mine.loose += gotHere;
        }
      }
    }

    var combinedEntries = groupBy(entries, function (entry) { return str(entry.key); }).map(mergeEditions);
    var combinedWorks = groupBy(works, function (work) {
      if (work.groupKey) return 'g:' + work.groupKey;
      return work.id ? 'id:' + work.id : '';
    }).map(function (group) {
      var head = group[0];
      var work = {
        id: head.id,
        groupKey: head.groupKey,
        title: head.title,
        author: head.author,
        authorKey: head.authorKey,
        year: head.year,
        isbn: head.isbn,
        subjects: arr(head.subjects).slice(),
        sections: arr(head.sections).slice(),
        facets: arr(head.facets).slice()
      };
      for (var j = 1; j < group.length; j++) {
        if (!work.title && group[j].title) work.title = group[j].title;
        if (!work.author && group[j].author) work.author = group[j].author;
        if (work.year === null || work.year === undefined) work.year = group[j].year;
        if (!work.isbn) work.isbn = group[j].isbn;
        union(work.subjects, arr(group[j].subjects));
        union(work.sections, arr(group[j].sections));
        union(work.facets, arr(group[j].facets));
      }
      work.facets.sort();
      work.sections.sort();
      return work;
    });

    for (var k = 0; k < SHELF_ORDER.length; k++) {
      var name = SHELF_ORDER[k];
      var shelfPages = perShelf[name];
      var numbers = Object.keys(shelfPages.byPage).map(Number).sort(function (a, b) { return a - b; });
      var readCount = shelfPages.loose;
      for (var n = 0; n < numbers.length; n++) readCount += shelfPages.byPage[numbers[n]];

      out.pages[name] = {
        page: numbers.length === 1 ? numbers[0] : null,
        pages: shelfPages.pages,
        count: shelfPages.count,
        got: readCount
      };

      var covered = shelfPages.pages !== null && shelfPages.pages > 0 && numbers.length > 0;
      for (var q = 1; covered && q <= shelfPages.pages; q++) {
        if (numbers.indexOf(q) === -1) covered = false;
      }
      out.complete[name] = shelfPages.count !== null &&
        (readCount >= shelfPages.count || covered);
      // No saved page said how many books this shelf has, so nothing can be said about
      // whether the set is whole — and the merge must not claim it was partly saved.
      out.unknown[name] = shelfPages.count === null;
    }

    out.ok = anyOk;
    out.entries = combinedEntries;
    out.works = combinedWorks;
    out.problems = problems;
    out.seen = seen;
    out.error = anyOk ? '' : (firstError || t('libraryShelfNotPage'));
    return out;
  }

  Nextbook.libraryShelf.read = read;
  Nextbook.libraryShelf.combine = combine;
  Nextbook.libraryShelf.sectionLabel = sectionLabel;
})(window);
