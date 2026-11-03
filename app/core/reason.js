'use strict';
// Ported from kit/seed_src/app/discovery.js (MIT, same author).
// The reason sentence: every pick carries one, and it names its evidence — a subject,
// an author, or a book on the shelf. docs/ARCHITECTURE.md "Reasons". Pure.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};

  var MAX = 200;                       // characters, the contract's ceiling (CONTRACT.md 3)
  var STOCK = /a\s+small\s+match/i;    // the phrase the contract check rejects

  function chars(text) {
    var s = String(text == null ? '' : text);
    return typeof Array.from === 'function' ? Array.from(s) : s.split('');
  }

  function length(text) {
    return chars(text).length;
  }

  function clean(label) {
    return String(label == null ? '' : label).trim().replace(/[\s.,;:]+$/, '');
  }

  function isAuthorPart(part) {
    return !!part && typeof part.facet === 'string' && part.facet.indexOf('author:') === 0;
  }

  // The strongest positive parts first; ties by facet, so the sentence is repeatable.
  function positives(parts) {
    var out = [];
    var list = parts || [];
    for (var i = 0; i < list.length; i++) {
      var part = list[i];
      if (!part || typeof part.facet !== 'string') continue;
      if (!(part.weight > 0)) continue;
      out.push(part);
    }
    out.sort(function (a, b) {
      return (b.weight - a.weight) || (a.facet < b.facet ? -1 : a.facet > b.facet ? 1 : 0);
    });
    return out;
  }

  function weightOfEntry(entry) {
    if (typeof Nextbook.weightOf === 'function') {
      try { return Nextbook.weightOf(entry); } catch (e) { /* fall through */ }
    }
    return 0;
  }

  // The shelf entry that best explains a facet: the heaviest one, then by title, so the
  // sentence names the same book every time.
  function evidenceFor(part, opts) {
    var evidence = opts && opts.evidence;
    if (!evidence || !part || !part.facet) return null;
    var list = evidence[part.facet];
    if (!list || !list.length) return null;
    var best = null;
    var bestWeight = -Infinity;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      var w = weightOfEntry(entry);
      var title = String(entry.title || '');
      if (w > bestWeight || (w === bestWeight && best && title < String(best.title || ''))) {
        best = entry;
        bestWeight = w;
      }
    }
    return best;
  }

  // "which you loved", "which you read", "which you are reading".
  function pastTense(entry) {
    if (!entry) return 'read';
    if (entry.rating === 'loved') return 'loved';
    if (entry.rating === 'liked') return 'liked';
    if (entry.rating === 'ok') return 'rated ok';
    if (entry.rating === 'not-for-me') return 'did not like';
    if (entry.state === 'reading') return 'are reading';
    if (entry.state === 'stopped') return 'stopped reading';
    if (entry.state === 'want') return 'want to read';
    return 'read';
  }

  function negativeSentence(opts) {
    var because = clean(opts && opts.because);
    return 'Not much like your shelf, which is the point' + (because ? ': ' + because : '') + '.';
  }

  // The four shapes in ARCHITECTURE.md, in the order the doc gives them.
  function sentence(parts, opts) {
    var good = positives(parts);
    var facets = [];
    var author = null;
    for (var i = 0; i < good.length; i++) {
      if (isAuthorPart(good[i])) {
        if (!author) author = good[i];
      } else {
        facets.push(good[i]);
      }
    }
    if (author && (!facets.length || author.weight >= facets[0].weight)) {
      return 'You rated ' + clean(author.label) + ' well already.';
    }
    if (facets.length >= 2) {
      return 'Matches books about ' + clean(facets[0].label) + ' and ' + clean(facets[1].label) +
             ' on your shelf.';
    }
    if (facets.length === 1) {
      var entry = evidenceFor(facets[0], opts);
      if (entry && entry.title) {
        return 'Shares the ' + clean(facets[0].label) + ' with ' + String(entry.title) +
               ', which you ' + pastTense(entry) + '.';
      }
      return 'Matches books about ' + clean(facets[0].label) + ' on your shelf.';
    }
    if (opts && opts.negative) return negativeSentence(opts);
    return '';
  }

  // Keep the longest sentence that fits: drop the second facet first, then cut. A reason
  // over 200 characters would be rejected by isReason, and every pick needs one.
  function fit(text, parts, opts) {
    if (length(text) <= MAX) return text;
    var facets = [];
    var good = positives(parts);
    for (var i = 0; i < good.length; i++) if (!isAuthorPart(good[i])) facets.push(good[i]);
    if (facets.length > 1) {
      var shorter = sentence([facets[0]], opts);
      if (shorter && length(shorter) <= MAX) return shorter;
    }
    var c = chars(text);
    return c.slice(0, MAX - 1).join('') + '\u2026';   // 199 characters and an ellipsis
  }

  function reason(parts, opts) {
    var text = sentence(parts, opts);
    if (!text) return '';
    return fit(text, parts, opts);
  }

  // A reason is a sentence a person can read: not empty, not the stock phrase, and not
  // longer than the contract allows.
  function isReason(text) {
    if (typeof text !== 'string') return false;
    var t = text.trim();
    if (!t) return false;
    if (length(t) > MAX) return false;
    if (STOCK.test(t)) return false;
    return true;
  }

  // The same evidence in words for a model prompt. It reads parts only: never the shelf,
  // never evidence, so no book on the shelf can be named (AGENTS.md rule 1).
  function factsClause(parts) {
    var good = positives(parts);
    if (!good.length) return '';
    if (isAuthorPart(good[0])) return 'matches other books by ' + clean(good[0].label);
    var labels = [];
    for (var i = 0; i < good.length && labels.length < 2; i++) {
      if (isAuthorPart(good[i])) continue;
      labels.push(clean(good[i].label));
    }
    if (!labels.length) return '';
    return 'matches books about ' + labels[0] + (labels[1] ? ' and ' + labels[1] : '');
  }

  Nextbook.reason = reason;
  Nextbook.isReason = isReason;
  Nextbook.factsClause = factsClause;
  Nextbook.reasonMax = MAX;
})(window);
