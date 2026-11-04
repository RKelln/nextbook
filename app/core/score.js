'use strict';
// Ported from kit/seed_src/app/discovery.js (MIT, same author).
// The scoring core: what a shelf adds up to, and a number for a book against it.
// Pure, and the shapes are docs/ARCHITECTURE.md "The scoring core". No page, no
// storage, no dates, no random. Every function is exported on window.Nextbook.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};

  // One table in one place, so a participant can change it and see what moves.
  // A facet key is '<kind>:<slug>', for example 'topic:wizards' or 'section:500'.
  var KINDS = Object.create(null);
  KINDS.topic = 1;
  KINDS.genre = 1;
  KINDS.bisac = 0.75;
  KINDS.series = 1.5;
  KINDS.mood = 1;
  KINDS.pace = 0.5;
  KINDS.section = 0.5;
  KINDS.audience = 0;

  function kindOf(facet) {
    var key = String(facet == null ? '' : facet);
    var i = key.indexOf(':');
    return i === -1 ? key : key.slice(0, i);
  }

  // An unknown kind counts as a plain subject, so a new kind in the data still scores.
  function kindWeight(facet) {
    var kind = kindOf(facet);
    return Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : 1;
  }

  // docs/ARCHITECTURE.md "Weights", one row per shelf entry. The order is the table's:
  // "not for me" wins over any state, and a "want" is a wish, not evidence.
  function weightOf(entry) {
    if (!entry) return 0;
    var rating = entry.rating || null;
    var state = entry.state || null;
    if (rating === 'not-for-me') return -2;   // any state
    if (state === 'want') return 0;           // a wish, not evidence
    if (state === 'hold') return 0;           // on hold at the library: still a wish
    if (rating === 'loved') return 3;
    if (rating === 'liked') return 2;
    if (rating === 'ok') return 1;
    if (state === 'read') return 1;           // read with no rating
    if (state === 'reading') return 0.5;
    if (state === 'stopped') return -1;       // stopped with no rating
    return 0;
  }

  // A work's facets, without repeats, in the work's own order.
  function workFacets(work) {
    var out = [];
    if (!work || !work.facets) return out;
    var list = typeof work.facets === 'string' ? [work.facets] : work.facets;
    var seen = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (typeof f !== 'string' || !f) continue;
      if (seen[f]) continue;
      seen[f] = true;
      out.push(f);
    }
    return out;
  }

  function authorKeyOf(work) {
    if (!work) return '';
    if (work.authorKey) return String(work.authorKey);
    if (work.author && typeof Nextbook.norm === 'function') {
      try { return String(Nextbook.norm(work.author)); } catch (e) { /* fall through */ }
    }
    return String(work.author || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function words(slug) {
    return String(slug == null ? '' : slug).replace(/-/g, ' ');
  }

  function capitalise(s) {
    var t = String(s == null ? '' : s);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  // The words for a facet. The slice carries the real labels (slice.facets[facet].label),
  // and ctx.labelOf reads them; the fallback below only keeps this file usable on its own,
  // in a test, and never invents a catalogue fact.
  function labelFor(facet, facets) {
    var key = String(facet == null ? '' : facet);
    if (facets && facets[key] && typeof facets[key].label === 'string' && facets[key].label) {
      return facets[key].label;
    }
    if (typeof Nextbook.labelOf === 'function') {
      try {
        var said = Nextbook.labelOf(key);
        if (typeof said === 'string' && said && said !== key) return said;
      } catch (e) { /* fall through to our own words */ }
    }
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

  // What the shelf adds up to. Each entry adds its weight to every facet of its work
  // and to its author; negative weights are kept, because they are evidence too.
  // `rated` counts the entries that are evidence: a shelf of "not for me" books is
  // still a rated shelf, and a book typed in that the list does not have is not.
  function profile(entries) {
    var out = { weights: {}, authors: {}, evidence: {}, rated: 0 };
    var list = entries || [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      var w = weightOf(entry);
      if (!w) continue;
      var work = entry.work;
      if (!work) continue;                    // nothing to hang facets on
      var facets = workFacets(work);
      // A work with no facets still counts: it is evidence for its author, and `rated`
      // counts evidence. Only the facet weights and the facet evidence have nothing to add.
      out.rated += 1;
      for (var j = 0; j < facets.length; j++) {
        var f = facets[j];
        out.weights[f] = (out.weights[f] || 0) + w;
        if (!out.evidence[f]) out.evidence[f] = [];
        out.evidence[f].push(entry);
      }
      var key = authorKeyOf(work);
      if (key) out.authors[key] = (out.authors[key] || 0) + w;
    }
    return out;
  }

  // parts are the contributions the score is made of, sorted strongest first and then by
  // facet, so the same shelf always gives the same sentence. The facet contributions are
  // divided by sqrt(number of the work's facets): a heavily catalogued work must not win
  // on label count alone (the first draft divided by the count, which punished well-
  // catalogued books too hard). The author is 2 x its weight, as its own part.
  // Negative parts are kept: they explain a low score.
  function score(work, p, facets) {
    var parts = [];
    var fs = workFacets(work);
    var root = fs.length ? Math.sqrt(fs.length) : 1;
    var weights = (p && p.weights) || {};
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i];
      var w = weights[f];
      if (!w) continue;
      var contribution = w * kindWeight(f);
      if (!contribution) continue;
      parts.push({ facet: f, label: labelFor(f, facets), weight: contribution / root });
    }
    var key = authorKeyOf(work);
    var authorWeight = (p && p.authors && key) ? (p.authors[key] || 0) : 0;
    if (authorWeight) {
      parts.push({
        facet: 'author:' + key,
        label: (work && work.author) || key,
        weight: 2 * authorWeight
      });
    }
    parts.sort(function (a, b) {
      return (b.weight - a.weight) || (a.facet < b.facet ? -1 : a.facet > b.facet ? 1 : 0);
    });
    var total = 0;
    for (var k = 0; k < parts.length; k++) total += parts[k].weight;
    return { score: total, parts: parts };
  }

  // Two works, not a shelf: the same weighted overlap, symmetric. The count divisor is
  // the geometric mean of the two facet counts, so it does not matter which is `a`.
  function similar(a, b) {
    var fa = workFacets(a);
    var fb = workFacets(b);
    var inB = Object.create(null);
    for (var i = 0; i < fb.length; i++) inB[fb[i]] = true;
    var shared = [];
    for (var j = 0; j < fa.length; j++) {
      if (inB[fa[j]]) shared.push(fa[j]);
    }
    shared.sort(function (x, y) {
      return (kindWeight(y) - kindWeight(x)) || (x < y ? -1 : x > y ? 1 : 0);
    });
    var sum = 0;
    for (var k = 0; k < shared.length; k++) sum += kindWeight(shared[k]);
    var denom = Math.sqrt((fa.length || 1) * (fb.length || 1));
    return { score: sum / denom, shared: shared };
  }

  // A ranking, with the tie rule the contract names: the same shelf gives the same six.
  function rank(works, p, facets) {
    var out = [];
    var list = works || [];
    for (var i = 0; i < list.length; i++) {
      var s = score(list[i], p, facets);
      out.push({ id: list[i].id, work: list[i], score: s.score, parts: s.parts });
    }
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return out;
  }

  // The parts of the library: works grouped by their section facet, in facet and then
  // id order, so the same list always groups the same way.
  function sections(works, facets) {
    var groups = Object.create(null);
    var order = [];
    var list = works || [];
    for (var i = 0; i < list.length; i++) {
      var work = list[i];
      if (!work) continue;
      var fs = workFacets(work);
      for (var j = 0; j < fs.length; j++) {
        var f = fs[j];
        if (kindOf(f) !== 'section') continue;
        if (!groups[f]) {
          groups[f] = { facet: f, label: labelFor(f, facets), works: [] };
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
        var x = String(a.id || '');
        var y = String(b.id || '');
        return x < y ? -1 : x > y ? 1 : 0;
      });
      out.push(group);
    }
    return out;
  }

  Nextbook.kindWeights = KINDS;
  Nextbook.kindOf = kindOf;
  Nextbook.kindWeight = kindWeight;
  Nextbook.weightOf = weightOf;
  Nextbook.workFacets = workFacets;
  Nextbook.labelFor = labelFor;
  Nextbook.profile = profile;
  Nextbook.score = score;
  Nextbook.similar = similar;
  Nextbook.rank = rank;
  Nextbook.sections = sections;
})(window);
