'use strict';
// The pool: the books the app knows about, and how they are read.
//
// It joins three data files into one list. `slice` is the starting list; `tags` are our own
// words for a work (mood, pace, a note); `found` is what a person's helper fetched because
// they asked. Nothing here touches the page, the clock or the network.
//
// The public API (docs/ARCHITECTURE.md "The data files", docs/BUILD.md T2.2):
//
//   Nextbook.pool.load()            -> {ok: true, works, byId, byGroupKey, facets}
//                                    | {ok: false, message}  (a plain sentence, never a throw)
//   Nextbook.pool.match(title, author) -> the work those name, or null
//   Nextbook.pool.search(text)      -> works whose title, author or facets match the words
//   Nextbook.pool.sections()        -> [{facet, label, works: [...]}]
//   Nextbook.pool.labelOf(facet)    -> the words for a facet, '' when unknown
//   Nextbook.pool.tagsOf(work)      -> {mood, pace, note} or null
//
// The methods other than load() load the data themselves if they are asked first, so a
// caller can never get a throw for asking about a list that did not arrive.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};

  var FOUND_SCHEMA = 'nextbook/found-1';
  var TAGS_SCHEMA = 'nextbook/tags-1';

  // The same rule the data was built with (adapters/pack/pack_to_slice.py and
  // adapters/bibliocommons/normalise.py): surname plus the first initial, and a surname
  // particle stays with the surname. "Ursula K. Le Guin" -> "le guin, u".
  var SUFFIXES = { jr: 1, 'jr.': 1, sr: 1, 'sr.': 1, ii: 1, iii: 1, iv: 1 };
  var PARTICLES = {
    le: 1, la: 1, van: 1, von: 1, de: 1, del: 1, della: 1, der: 1, di: 1,
    du: 1, da: 1, dos: 1, das: 1, bin: 1, ibn: 1
  };

  // The loaded pool. `loaded` is true after one attempt, so a broken file is read once and
  // the app carries on with an empty list rather than retrying on every lookup.
  var state = {
    loaded: false,
    ok: false,
    message: '',
    works: [],
    byId: {},
    byGroupKey: {},
    byTitle: {},
    facets: {},
    tags: {},
    haystack: []
  };

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function str(v) {
    return typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : '');
  }

  function clone(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; }
  }

  function norm(text) {
    if (typeof Nextbook.norm === 'function') return String(Nextbook.norm(text) || '');
    // A pool asked for before base.js: the same reading, in the small.
    return String(text === null || text === undefined ? '' : text)
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(the|a|an) /, '');
  }

  function kindOf(facet) {
    var key = str(facet);
    var i = key.indexOf(':');
    return i === -1 ? key : key.slice(0, i);
  }

  function slugOf(text) {
    return String(text === null || text === undefined ? '' : text)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function words(slug) {
    return String(slug === null || slug === undefined ? '' : slug).replace(/-/g, ' ');
  }

  function capitalise(s) {
    var t = String(s === null || s === undefined ? '' : s);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  // The words for a facet with no dictionary entry. The dictionary normally supplies every
  // label; this only keeps a hand-made pool readable and never invents a catalogue fact.
  function fallbackLabel(facet) {
    var key = str(facet);
    var i = key.indexOf(':');
    var kind = i === -1 ? '' : key.slice(0, i);
    var slug = words(i === -1 ? key : key.slice(i + 1));
    if (kind === 'mood') return slug + ' books';
    if (kind === 'pace') return 'a ' + slug + ' pace';
    if (kind === 'section') return 'the ' + slug + ' shelves';
    if (kind === 'series') return capitalise(slug) + ' series';
    if (kind === 'audience') return slug + ' readers';
    return slug;
  }

  // The spellings of an author that the data's authorKey may use, best first.
  function authorKeys(name) {
    var raw = String(name === null || name === undefined ? '' : name);
    var out = [];
    var add = function (k) { if (k && out.indexOf(k) === -1) out.push(k); };

    var spaced = raw.replace(/\s+/g, ' ').trim();
    if (!spaced) return out;

    if (spaced.indexOf(',') !== -1) {
      // "Le Guin, Ursula K., 1929-2018" -> surname before the comma, first initial after it.
      var comma = spaced.indexOf(',');
      var last = spaced.slice(0, comma).replace(/[.\s]+$/, '').toLowerCase();
      var first = spaced.slice(comma + 1).trim();
      if (last) add(last + (first ? ', ' + first.charAt(0).toLowerCase() : ''));
    } else {
      var tokens = spaced.split(' ');
      while (tokens.length > 1 && has(SUFFIXES, tokens[tokens.length - 1].toLowerCase())) tokens.pop();
      if (tokens.length) {
        var index = tokens.length - 1;
        var parts = [tokens[index].replace(/[.\s]+$/, '')];
        while (index - 1 >= 1 && has(PARTICLES, tokens[index - 1].toLowerCase())) {
          index -= 1;
          parts.unshift(tokens[index].replace(/[.\s]+$/, ''));
        }
        var surname = parts.join(' ').toLowerCase();
        var initial = tokens[0].charAt(0).toLowerCase();
        add(initial ? surname + ', ' + initial : surname);
      }
    }
    // A work built without an authorKey (a hand-made test, a typed import) keeps the whole
    // name as its key, so compare that spelling too.
    add(norm(spaced));
    return out;
  }

  // ---- tags -> mood:/pace: facets -------------------------------------------------------------
  // tags.json is keyed by groupKey: {mood: [...], pace: "...", note: "..."}. A mood becomes
  // "mood:quiet" with the words "quiet books"; a pace becomes "pace:slow", "a slow pace".
  function tagFacets(tag) {
    var out = [];
    if (!isObj(tag)) return out;
    var moods = Array.isArray(tag.mood) ? tag.mood : (tag.mood ? [tag.mood] : []);
    for (var i = 0; i < moods.length; i++) {
      var m = slugOf(moods[i]);
      if (m && out.indexOf('mood:' + m) === -1) out.push('mood:' + m);
    }
    var paces = Array.isArray(tag.pace) ? tag.pace : (tag.pace ? [tag.pace] : []);
    for (var j = 0; j < paces.length; j++) {
      var p = slugOf(paces[j]);
      if (p && out.indexOf('pace:' + p) === -1) out.push('pace:' + p);
    }
    return out;
  }

  function tagLabel(facet) {
    var key = str(facet);
    var kind = kindOf(key);
    var slug = words(key.slice(key.indexOf(':') + 1));
    if (kind === 'mood') return slug + ' books';
    if (kind === 'pace') return 'a ' + slug + ' pace';
    return fallbackLabel(key);
  }

  // ---- load -----------------------------------------------------------------------------------
  function missingMessage() {
    if (typeof Nextbook.t === 'function') {
      try {
        var said = Nextbook.t('missingData');
        if (typeof said === 'string' && said) return said;
      } catch (e) { /* fall through */ }
    }
    return 'The book list did not load. The rest of the app still works.';
  }

  function reset() {
    state.works = [];
    // Bare objects: a title or a groupKey can be any string, and one of them might be
    // "__proto__". A map with no prototype cannot be changed by its own keys.
    state.byId = Object.create(null);
    state.byGroupKey = Object.create(null);
    state.byTitle = Object.create(null);
    state.facets = Object.create(null);
    state.tags = Object.create(null);
    state.haystack = [];
    state.message = '';
    state.ok = false;
  }

  function fail() {
    reset();
    state.loaded = true;
    state.ok = false;
    state.message = missingMessage();
    return { ok: false, message: state.message };
  }

  // A found record of a book already in the list: the slice's entry stays, and the record's
  // own facts are folded in. Facets are joined; the record wins on what only it knows.
  // The record's own addresses (its record id, the catalogue's groupKey) are indexed too,
  // so a shelf brought in from the library lands on this work and not on nothing.
  function enrich(target, record) {
    var seen = {};
    var facets = target.facets || (target.facets = []);
    for (var i = 0; i < facets.length; i++) seen[facets[i]] = true;
    var theirs = Array.isArray(record.facets) ? record.facets : [];
    for (var j = 0; j < theirs.length; j++) {
      if (typeof theirs[j] !== 'string' || !theirs[j] || seen[theirs[j]]) continue;
      seen[theirs[j]] = true;
      facets.push(theirs[j]);
    }
    var recordId = str(record.recordId) || str(record.id);
    if (recordId) {
      target.recordId = recordId;
      if (!has(state.byId, recordId)) state.byId[recordId] = target;
    }
    var recordGroupKey = str(record.groupKey);
    if (recordGroupKey && !has(state.byGroupKey, recordGroupKey)) state.byGroupKey[recordGroupKey] = target;
    if (Array.isArray(record.formats)) target.formats = record.formats.slice();
    if (str(record.callNumber)) target.callNumber = record.callNumber;
    if (str(record.contentType)) target.contentType = record.contentType;
    if (str(record.subtitle) && !target.subtitle) target.subtitle = record.subtitle;
    return target;
  }

  // Do two records name the same author? A key is trusted when both sides have one and the
  // two agree; otherwise the names are compared as the pool compares names. A found record
  // with no key, or with the key in another spelling ("Le Guin, Ursula K."), must enrich the
  // slice work it matches rather than join as a second copy of the same book.
  function sameAuthor(a, b) {
    var ka = str(a && a.authorKey);
    var kb = str(b && b.authorKey);
    if (ka && kb && norm(ka) === norm(kb)) return true;
    var na = norm(a && a.author);
    var nb = norm(b && b.author);
    return !!na && na === nb;
  }

  // AGENTS.md rule 4: never store publisher blurbs. find.py refuses to write such a field;
  // the loader is the second fence, for a hand-made or edited file. Field names are matched
  // in any case, at the top level of a work.
  var UNSTORED = { description: 1, jacket: 1, rating: 1 };

  function dropUnstored(work) {
    var keys = Object.keys(work);
    for (var i = 0; i < keys.length; i++) {
      if (has(UNSTORED, keys[i].toLowerCase())) delete work[keys[i]];
    }
  }

  function addWork(work) {
    if (!isObj(work)) return null;
    var copy = clone(work);
    if (!isObj(copy)) return null;
    dropUnstored(copy);
    if (!Array.isArray(copy.facets)) copy.facets = [];
    state.works.push(copy);
    if (str(copy.id) && !has(state.byId, str(copy.id))) state.byId[str(copy.id)] = copy;
    if (str(copy.groupKey) && !has(state.byGroupKey, str(copy.groupKey))) state.byGroupKey[str(copy.groupKey)] = copy;
    var t = norm(copy.title);
    if (t) {
      if (!has(state.byTitle, t)) state.byTitle[t] = [];
      state.byTitle[t].push(copy);
    }
    return copy;
  }

  function load() {
    reset();
    try {
      var slice = Nextbook.data.get('slice');
      if (!isObj(slice) || !Array.isArray(slice.works)) return fail();

      var tags = Nextbook.data.get('tags');
      var tagWorks = isObj(tags) && isObj(tags.works) &&
        (!has(tags, 'schema') || tags.schema === TAGS_SCHEMA) ? tags.works : null;

      var found = Nextbook.data.get('found');
      var foundOk = isObj(found) && Array.isArray(found.works) &&
        (!has(found, 'schema') || found.schema === FOUND_SCHEMA);

      // 1. The slice, as written.
      var labels = {};
      var i;
      var sliceFacets = isObj(slice.facets) ? slice.facets : {};
      Object.keys(sliceFacets).forEach(function (key) {
        var f = sliceFacets[key];
        if (!isObj(f)) return;
        labels[key] = { label: str(f.label) || fallbackLabel(key), kind: str(f.kind) || kindOf(key) };
      });
      // A separate index for the starting list: a found record only ever enriches a slice
      // work, never another found record (two catalogue records of one book are two works,
      // each with its own groupKey).
      var sliceByTitle = Object.create(null);
      for (i = 0; i < slice.works.length; i++) {
        var work = addWork(slice.works[i]);
        if (!work) continue;
        var asTitle = norm(work.title);
        if (asTitle) {
          if (!has(sliceByTitle, asTitle)) sliceByTitle[asTitle] = [];
          sliceByTitle[asTitle].push(work);
        }
        if (tagWorks && str(work.groupKey) && isObj(tagWorks[work.groupKey])) {
          state.tags[work.groupKey] = clone(tagWorks[work.groupKey]) || {};
        }
      }

      // 2. Found books: a record of a book already here enriches it; anything else joins.
      if (foundOk) {
        var foundFacets = isObj(found.facets) ? found.facets : {};
        Object.keys(foundFacets).forEach(function (key) {
          if (has(labels, key)) return; // the slice's own words win
          var f = foundFacets[key];
          if (!isObj(f)) return;
          labels[key] = { label: str(f.label) || fallbackLabel(key), kind: str(f.kind) || kindOf(key) };
        });

        for (i = 0; i < found.works.length; i++) {
          var record = found.works[i];
          if (!isObj(record)) continue;
          var titleKey = norm(record.title);
          var hit = null;
          var sameTitle = titleKey && has(sliceByTitle, titleKey) ? sliceByTitle[titleKey] : [];
          for (var k = 0; k < sameTitle.length; k++) {
            if (sameAuthor(sameTitle[k], record)) {
              hit = sameTitle[k];
              break;
            }
          }
          if (hit) { enrich(hit, record); continue; }

          var added = addWork(record);
          if (!added) continue;
          if (!isObj(added.found)) {
            added.found = { query: isObj(record.found) ? str(record.found.query) : str(record.found) };
          }
        }
      }

      // 3. Tags, on whatever work carries that groupKey. Our own words win over a label
      //    already in the dictionary, because mood and pace are ours to name.
      var tagKeys = Object.keys(state.tags).sort();
      for (i = 0; i < tagKeys.length; i++) {
        var gk = tagKeys[i];
        var target = has(state.byGroupKey, gk) ? state.byGroupKey[gk] : null;
        if (!target) continue;
        var extra = tagFacets(state.tags[gk]);
        for (var j = 0; j < extra.length; j++) {
          var facet = extra[j];
          if (target.facets.indexOf(facet) === -1) target.facets.push(facet);
          labels[facet] = { label: tagLabel(facet), kind: kindOf(facet) };
        }
      }

      // 4. The dictionary: every label above, and a count of the works that carry it.
      var counts = {};
      for (i = 0; i < state.works.length; i++) {
        var facets = state.works[i].facets || [];
        var counted = {};
        for (var n = 0; n < facets.length; n++) {
          var f = facets[n];
          if (typeof f !== 'string' || !f || counted[f]) continue;
          counted[f] = true;
          counts[f] = (counts[f] || 0) + 1;
        }
      }
      var keys = Object.keys(labels);
      Object.keys(counts).forEach(function (key) { if (keys.indexOf(key) === -1) keys.push(key); });
      keys.sort();
      for (i = 0; i < keys.length; i++) {
        var labelKey = keys[i];
        var known = labels[labelKey] || {};
        state.facets[labelKey] = {
          label: str(known.label) || fallbackLabel(labelKey),
          kind: str(known.kind) || kindOf(labelKey),
          works: counts[labelKey] || 0
        };
      }

      // 5. The search text for the add box: title, subtitle, author, and the facet words.
      state.haystack = state.works.map(function (w) {
        var texts = [str(w.title), str(w.subtitle), str(w.author)];
        var list = Array.isArray(w.facets) ? w.facets : [];
        for (var m = 0; m < list.length; m++) {
          var f = list[m];
          texts.push(words(str(f).replace(/^[a-z]+:/, '')));
          if (state.facets[f] && state.facets[f].label) texts.push(state.facets[f].label);
        }
        return norm(texts.join(' '));
      });

      state.loaded = true;
      state.ok = true;
      return {
        ok: true,
        works: state.works,
        byId: state.byId,
        byGroupKey: state.byGroupKey,
        facets: state.facets
      };
    } catch (e) {
      return fail();
    }
  }

  function ensure() {
    if (!state.loaded) load();
    return state.ok;
  }

  // ---- the API --------------------------------------------------------------------------------
  function match(title, author) {
    if (!ensure()) return null;
    var t = norm(title);
    var a = str(author).trim();
    if (!t || !a) return null;
    var keys = authorKeys(a);
    var list = has(state.byTitle, t) ? state.byTitle[t] : [];
    for (var i = 0; i < list.length; i++) {
      var work = list[i];
      var key = str(work.authorKey);
      if (key ? keys.indexOf(key) !== -1 : norm(work.author) === norm(a)) return work;
    }
    return null;
  }

  function search(text) {
    if (!ensure()) return [];
    var wordsIn = norm(text).split(' ').filter(function (w) { return !!w; });
    if (!wordsIn.length) return [];
    var out = [];
    for (var i = 0; i < state.works.length; i++) {
      var hay = state.haystack[i] || '';
      var all = true;
      for (var j = 0; j < wordsIn.length; j++) {
        if (hay.indexOf(wordsIn[j]) === -1) { all = false; break; }
      }
      if (all) out.push(state.works[i]);
    }
    return out;
  }

  function sections() {
    if (!ensure()) return [];
    var groups = {};
    var order = [];
    for (var i = 0; i < state.works.length; i++) {
      var work = state.works[i];
      var facets = work.facets || [];
      for (var j = 0; j < facets.length; j++) {
        var f = facets[j];
        if (kindOf(f) !== 'section') continue;
        if (!groups[f]) {
          groups[f] = { facet: f, label: labelOf(f), works: [] };
          order.push(f);
        }
        if (groups[f].works.indexOf(work) === -1) groups[f].works.push(work);
      }
    }
    order.sort();
    var out = [];
    for (var k = 0; k < order.length; k++) {
      var group = groups[order[k]];
      group.works.sort(function (a, b) {
        var x = str(a.id);
        var y = str(b.id);
        return x < y ? -1 : x > y ? 1 : 0;
      });
      out.push(group);
    }
    return out;
  }

  function labelOf(facet) {
    if (!ensure()) return '';
    var key = str(facet);
    if (!key) return '';
    var entry = state.facets[key];
    return entry && typeof entry.label === 'string' ? entry.label : '';
  }

  function tagsOf(work) {
    if (!ensure()) return null;
    var key = typeof work === 'string' ? work : str(work && work.groupKey);
    if (!key || !has(state.tags, key)) return null;
    var tag = state.tags[key];
    if (!isObj(tag)) return null;
    var moods = Array.isArray(tag.mood) ? tag.mood.slice() : (tag.mood ? [tag.mood] : []);
    return {
      mood: moods,
      pace: Array.isArray(tag.pace) ? tag.pace.slice() : (tag.pace || ''),
      note: str(tag.note)
    };
  }

  Nextbook.pool = {
    load: load,
    match: match,
    search: search,
    sections: sections,
    labelOf: labelOf,
    tagsOf: tagsOf
  };

  // core/score.js asks for this when a reason needs the words for a facet.
  Nextbook.labelOf = labelOf;
})(window);
