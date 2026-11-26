// Ported from searchdesk/core/reply.js (MIT, same author).
'use strict';
// The model seam, docs/ARCHITECTURE.md "The model seam". No keys and no calls: the app
// writes a prompt, the person carries it to any chat, and pastes the answer back. Both
// prompts are built from the list's own words and never from a reason sentence, because a
// reason may name a book on the person's shelf (AGENTS.md rule 1).
//
//   Nextbook.seam.finalistsPrompt(result, profile, pool, shelf) -> { text, excluded }
//     text asks for one line when it offers one candidate, two lines when it offers two or
//     more; excluded is [{id, title}] for candidates left out because the person already has
//     that work (AGENTS.md rule 1, D34).
//   Nextbook.seam.parseFinalists(answer, result, idPattern) -> { kept, dropped, reason }
//   Nextbook.seam.labelsPrompt(text, facets) -> a prompt asking for up to four labels
//   Nextbook.seam.parseLabels(answer, facets) -> { kept, dropped, reason }
//
// kept[i] for finalists is { id, why } (the model's own one sentence, marked as the model's
// on screen); for labels it is a facet key, so a mode only ever receives keys. dropped is
// [{ id, why }] or [{ label, why }]. reason is a plain sentence for the page, or '' when
// there is nothing to say.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};

  var END = 'Answer with two lines. Do not change any files.';
  // One candidate is one line: asking for "two lines" for a single book would be a lie.
  var END_ONE = 'Answer with one line. Do not change any files.';
  // Subjects are up to four lines, one each: the finalists' "two lines" would be wrong here.
  var END_LABELS = 'Answer with up to four lines, one subject on each line. Do not change any files.';
  var MAX_SENTENCE = 300;
  var MAX_KEPT_LABELS = 4;
  var MAX_KEPT_FINALISTS = 2;

  var has = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function cap(s, n) {
    var text = str(s);
    return text.length > n ? text.slice(0, n - 1) + '\u2026' : text;
  }
  function clean(s) { return str(s).replace(/\s+/g, ' ').trim(); }

  // ---- tolerant reading of a pasted answer ---------------------------------------------------
  // Same quotes everywhere, no invisible characters, real line breaks.
  function normalise(text) {
    var s = str(text);
    try { s = s.normalize('NFKC'); } catch (e) { /* an old engine: keep it as it is */ }
    return s
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      .replace(/[\u00A0\u202F\u2007]/g, ' ')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\r\n?|\u2028|\u2029/g, '\n');
  }

  // Leading decoration of an answer line: bullets, blockquotes, list numbers, bold marks.
  var LEAD = /^(?:\s+|>|[-*\u2022\u2023\u25AA\u25E6](?=\s)|\d{1,3}[.)]\s+)+/;

  function cleanLine(line) {
    var s = str(line).replace(/\s+$/, '');
    s = s.replace(LEAD, '');
    s = s.replace(/\*\*|__|`/g, '');           // bold and code marks, never a word
    s = s.trim().replace(/^\|\s*/, '').replace(/\s*\|$/, '');
    s = s.replace(LEAD, '').trim();
    var q = /^"(.*)"[,.]?$/.exec(s);
    if (q && q[1].indexOf('"') < 0) s = q[1];
    return s.trim();
  }

  function trimMarks(s) {
    return str(s).replace(/^[\s"'([{<]+/, '').replace(/[\s"')\]}>,.;:]+$/, '');
  }

  // A sentence keeps its full stop: only quotes and brackets go.
  function trimSentence(s) {
    return str(s).replace(/^[\s"'([{<]+/, '').replace(/[\s"')\]}>]+$/, '').trim();
  }

  // Fenced blocks: [{ lines }]. An unclosed fence runs to the end.
  function findBlocks(text) {
    var blocks = [], cur = null;
    normalise(text).split('\n').forEach(function (l) {
      var m = /^\s*(`{3,}|~{3,})(.*)$/.exec(l);
      if (!cur) {
        if (m) cur = { ch: m[1].charAt(0), len: m[1].length, lines: [] };
      } else if (m && m[1].charAt(0) === cur.ch && m[1].length >= cur.len && !m[2].trim()) {
        blocks.push(cur); cur = null;
      } else {
        cur.lines.push(l);
      }
    });
    if (cur) blocks.push(cur);
    return blocks;
  }

  // Top-level {...} and [...] spans, strings respected.
  function jsonSpans(text) {
    var out = [], i = 0, n = text.length;
    while (i < n) {
      var open = text.charAt(i);
      if (open !== '{' && open !== '[') { i++; continue; }
      var close = open === '{' ? '}' : ']';
      var depth = 0, inStr = false, j = i, closed = false;
      for (; j < n; j++) {
        var ch = text.charAt(j);
        if (inStr) { if (ch === '\\') j++; else if (ch === '"') inStr = false; }
        else if (ch === '"') inStr = true;
        else if (ch === open) depth++;
        else if (ch === close) { depth--; if (depth === 0) { closed = true; break; } }
      }
      if (!closed) break;                          // a cut-off answer is read line by line
      out.push({ text: text.slice(i, j + 1), start: i, end: j + 1 });
      i = j + 1;
    }
    return out;
  }

  function tryJson(text) {
    var variants = [text, text.replace(/,\s*([}\]])/g, '$1')];
    for (var i = 0; i < variants.length; i++) {
      try {
        var v = JSON.parse(variants[i]);
        if (v && typeof v === 'object') return v;
      } catch (e) { /* the next shape */ }
    }
    return null;
  }

  function arrayOf(v, keys) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      for (var i = 0; i < keys.length; i++) if (Array.isArray(v[keys[i]])) return v[keys[i]];
      return [v];
    }
    return [];
  }

  function idOf(o) {
    if (typeof o === 'string') return trimMarks(o);   // a bare id in a JSON array
    if (!o || typeof o !== 'object') return '';
    var keys = ['id', 'pick', 'ref', 'alias', 'work', 'book'];
    for (var i = 0; i < keys.length; i++) if (o[keys[i]] !== undefined && o[keys[i]] !== null) return trimMarks(o[keys[i]]);
    return '';
  }

  function whyOf(o) {
    if (!o || typeof o !== 'object') return '';
    var keys = ['why', 'reason', 'sentence', 'text', 'note', 'because'];
    for (var i = 0; i < keys.length; i++) if (o[keys[i]] !== undefined && o[keys[i]] !== null) return clean(o[keys[i]]);
    return '';
  }

  function labelOfValue(o) {
    if (typeof o === 'string') return clean(o);
    if (!o || typeof o !== 'object') return '';
    var keys = ['label', 'facet', 'subject', 'topic', 'name', 'text'];
    for (var i = 0; i < keys.length; i++) if (o[keys[i]] !== undefined && o[keys[i]] !== null) return clean(o[keys[i]]);
    return '';
  }

  function makePattern(idPattern) {
    var src = str(idPattern) || '^[a-z0-9-]+$';
    try { return new RegExp(src); } catch (e) { return /^[a-z0-9-]+$/; }
  }

  // ---- the six books, read back -----------------------------------------------------------------
  // The answer must name an id from the six. A line is `<id>: <one sentence>`, a bullet, a
  // fenced block or a JSON object; a title, an author, a year or a link in the answer is not
  // an id and is left alone. A word shaped like an id that is not one of the six is dropped
  // and named.
  function idEntries(line, pattern, known) {
    var out = [];
    var s = cleanLine(line);
    if (!s) return out;
    // A table's header and rule rows ("id | why", "---|---") name no book.
    if (/^[-:|\s]+$/.test(s) || /^id\s*[|:]/i.test(s)) return out;
    // The id may carry the book's title in brackets before the separator, as chats like to
    // write it: "oryx (Oryx and Crake): ...". The brackets are dropped, never read as an id.
    var m = /^([^\s|:()\[\]]{1,80})\s*(?:[(\[][^)\]]{0,200}[)\]])?\s*(?::|\||\u2013|\u2014|\s-\s)\s*(.*)$/.exec(s);
    if (m) {
      var id = trimMarks(m[1]);
      // The id may be written with capitals ("W2", "Left-Hand"): the shape check is either
      // the pattern or the real id, matched without case, and parseFinalists puts back the
      // real id's spelling. An id that matches neither is not a candidate at all.
      if (pattern.test(id) || known(id)) out.push({ id: id, why: cap(trimSentence(m[2]), MAX_SENTENCE) });
      return out;
    }
    var lone = trimMarks(s);
    if (lone && known(lone)) out.push({ id: lone, why: '' });
    return out;
  }

  function finalistCandidates(text, pattern, known) {
    var norm = normalise(text);
    var blocks = findBlocks(norm).map(function (b) { return b.lines; });
    var scopes = blocks.concat([norm.split('\n')]);
    var best = [];
    scopes.forEach(function (lines) {
      var joined = lines.join('\n');
      var found = [];
      var cut = joined;
      jsonSpans(joined).forEach(function (span) {
        var v = tryJson(span.text);
        if (!v) return;
        var got = [];
        arrayOf(v, ['picks', 'finalists', 'answers', 'books']).forEach(function (o) {
          var id = idOf(o);
          if (id) got.push({ id: id, why: cap(whyOf(o), MAX_SENTENCE) });
        });
        if (!got.length) return;
        got.forEach(function (e) { found.push(e); });
        cut = cut.slice(0, span.start) + span.text.replace(/[^\n]/g, ' ') + cut.slice(span.end);
      });
      // A known id alone on its line, with its sentence on the next line, is one pick.
      var rows = cut.split('\n');
      for (var r = 0; r < rows.length; r++) {
        var got = idEntries(rows[r], pattern, known);
        if (got.length === 1 && !got[0].why) {
          var n = r + 1;
          while (n < rows.length && !cleanLine(rows[n])) n++;
          if (n < rows.length && !idEntries(rows[n], pattern, known).length) {
            got[0].why = cap(trimSentence(cleanLine(rows[n])), MAX_SENTENCE);
            r = n;
          }
        }
        got.forEach(function (e) { found.push(e); });
      }
      if (found.length > best.length) best = found;
    });
    return best;
  }

  // One true sentence per drop code: an id that is one of the six is never called a book
  // that is not one of the six.
  var FINALIST_SAID = {
    unknown: function (id) { return id + ' is not one of the six books.'; },
    repeat: function (id) { return id + ' is named twice, so only the first was kept.'; },
    third: function (id) { return id + ' is a third book; the answer asked for two.'; },
    noSentence: function (id) { return id + ' has no sentence after it, so there was nothing to keep.'; }
  };

  function parseFinalists(answer, result, idPattern) {
    var picks = result && Array.isArray(result.picks) ? result.picks : [];
    return readPicks(answer, picks, idPattern, MAX_KEPT_FINALISTS, FINALIST_SAID,
      'The answer did not name any of the six books.');
  }

  function readPicks(answer, picks, idPattern, max, SAID, none) {
    var pattern = makePattern(idPattern);
    var valid = Object.create(null), lower = Object.create(null);
    picks.forEach(function (p) {
      var id = p && typeof p.id === 'string' ? p.id : '';
      if (!id) return;
      valid[id] = true;
      var k = id.toLowerCase();
      if (!lower[k]) lower[k] = id;
    });
    function known(id) { return !!valid[id] || !!lower[str(id).toLowerCase()]; }
    function realId(id) {
      var s = trimMarks(id);
      if (valid[s]) return s;
      var k = s.toLowerCase();
      return lower[k] || '';
    }

    var kept = [], dropped = [], seen = Object.create(null);
    finalistCandidates(str(answer), pattern, known).forEach(function (c) {
      var raw = trimMarks(c.id);
      var id = realId(c.id);
      if (!id) { dropped.push({ id: raw, why: (SAID.words && SAID.words.unknown) || 'not one of the six books', code: 'unknown' }); return; }
      if (seen[id]) { dropped.push({ id: id, why: 'named twice', code: 'repeat' }); return; }
      if (kept.length >= max) {
        dropped.push({ id: id, why: (SAID.words && SAID.words.third) || 'more than the two lines asked for', code: 'third' });
        return;
      }
      if (!c.why) {
        dropped.push({ id: id, why: 'no sentence', code: 'noSentence' });
        return;
      }
      seen[id] = true;
      kept.push({ id: id, why: cap(c.why, MAX_SENTENCE) });
    });

    var bits = [];
    dropped.forEach(function (d) {
      var said = SAID[d.code] || SAID.unknown;
      bits.push(said(d.id || 'That pick'));
    });
    if (!kept.length) bits.push(none);
    return { kept: kept, dropped: dropped, reason: bits.join(' ') };
  }

  // ---- labels, read back ------------------------------------------------------------------------
  function labelIndex(facets) {
    var map = Object.create(null), labels = Object.create(null), keys = [];
    function add(text, key) {
      var n = Nextbook.norm(text);
      if (!n || has(map, n)) return;
      map[n] = key;
    }
    if (Array.isArray(facets)) {
      facets.forEach(function (f) {
        var label = labelOfValue(f), key = typeof f === 'string' ? f : (f && (f.facet || f.key)) || label;
        if (!key) return;
        if (!has(labels, key)) { labels[key] = label || key; keys.push(key); }
        add(label || key, key);
        add(key, key);
      });
    } else if (facets && typeof facets === 'object') {
      Object.keys(facets).forEach(function (k) {
        var v = facets[k] && typeof facets[k] === 'object' ? facets[k] : {};
        var label = typeof v.label === 'string' && v.label ? v.label : k;
        if (!has(labels, k)) { labels[k] = label; keys.push(k); }
        add(label, k);
        add(k, k);
        var i = k.indexOf(':');
        if (i >= 0) add(k.slice(i + 1).replace(/-/g, ' '), k);  // "science-fiction" for "science fiction"
      });
    }
    return { map: map, labels: labels, keys: keys };
  }

  // Split a line into the labels it actually contains, before deciding what is missing.
  // `known(piece)` answers whether a trimmed piece is a label in the list.
  // A whole line that is a real label wins (a label may contain a comma or a colon);
  // otherwise "<label>: <why>" keeps only the label; otherwise commas, semicolons and
  // bullets split the line into pieces. The raw line is never a candidate on its own, so a
  // line that produced kept labels cannot also be reported as an unknown label.
  function labelPieces(line, known) {
    var s = cleanLine(line);
    if (!s) return [];
    if (/[:\u2013\u2014|]\s*$/.test(s)) return [];   // "Here are the labels:" is a lead-in, not a label
    var out = [];
    function push(v) {
      var t = trimMarks(v);
      if (!t || t.length > 60 || t.split(/\s+/).length > 7) return;
      if (out.indexOf(t) === -1) out.push(t);
    }
    function isKnown(v) {
      var t = trimMarks(v);
      return !!(t && typeof known === 'function' && known(t));
    }
    var SEP = /^(.{1,60}?)\s*(?::|\u2013|\u2014|\s-\s|\|)\s*\S/;
    if (isKnown(s)) return [s];
    var head = SEP.exec(s);
    if (head && isKnown(head[1])) { push(head[1]); return out; }
    s.split(/[,;]/).forEach(function (piece) {
      var t = trimMarks(piece);
      var h = SEP.exec(t);
      if (h && isKnown(h[1])) push(h[1]);
      else push(t);
    });
    return out;
  }

  function labelCandidates(text, known) {
    var norm = normalise(text);
    var scopes = findBlocks(norm).map(function (b) { return b.lines; }).concat([norm.split('\n')]);
    var best = [];
    scopes.forEach(function (lines) {
      var joined = lines.join('\n');
      var found = [];
      var cut = joined;
      jsonSpans(joined).forEach(function (span) {
        var v = tryJson(span.text);
        if (!v) return;
        var got = [];
        arrayOf(v, ['labels', 'facets', 'subjects', 'topics', 'picks']).forEach(function (o) {
          var label = labelOfValue(o);
          if (label) got.push(label);
        });
        if (!got.length) return;
        got.forEach(function (l) { found.push(l); });
        cut = cut.slice(0, span.start) + span.text.replace(/[^\n]/g, ' ') + cut.slice(span.end);
      });
      cut.split('\n').forEach(function (line) {
        labelPieces(line, known).forEach(function (p) { found.push(p); });
      });
      if (found.length > best.length) best = found;
    });
    return best;
  }

  // One true sentence per drop code: a label that is a real label, dropped for being over
  // the four allowed, is never called "not a label in the list".
  var LABEL_SAID = {
    unknown: function (label) { return label + ' is not a label in the list.'; },
    over: function (label) { return label + ' is a fifth label; the answer asked for four.'; }
  };

  function parseLabels(answer, facets) {
    var index = labelIndex(facets);
    function known(piece) { return !!index.map[Nextbook.norm(piece)]; }
    var kept = [], dropped = [], seen = Object.create(null);
    labelCandidates(str(answer), known).forEach(function (piece) {
      var key = index.map[Nextbook.norm(piece)];
      if (!key) {
        if (dropped.length < 20) dropped.push({ label: piece, why: 'not a label in the list', code: 'unknown' });
        return;
      }
      if (seen[key]) return;
      if (kept.length >= MAX_KEPT_LABELS) {
        dropped.push({ label: piece, why: 'more than the four labels asked for', code: 'over' });
        return;
      }
      seen[key] = true;
      kept.push(key);
    });

    var bits = [];
    dropped.forEach(function (d) {
      var said = LABEL_SAID[d.code] || LABEL_SAID.unknown;
      bits.push(said(d.label));
    });
    if (!kept.length) bits.push('The answer did not name any subject in the list.');
    return { kept: kept, dropped: dropped, reason: bits.join(' ') };
  }

  // ---- the prompts ---------------------------------------------------------------------------------
  function labelFor(facet, pool) {
    var p = pool || {};
    if (typeof p.labelOf === 'function') {
      var said = p.labelOf(facet);
      if (typeof said === 'string' && said) return said;
    }
    return Nextbook.labelFor(facet, p.facets || {});
  }

  function workFacets(work) {
    return Nextbook.workFacets(work);
  }

  function workOf(pool, id) {
    var p = pool || {};
    if (p.byId && p.byId[id]) return p.byId[id];
    var works = p.works || [];
    for (var i = 0; i < works.length; i++) if (works[i] && works[i].id === id) return works[i];
    return null;
  }

  // The profile's strongest five facet labels. Only labels: never a shelf entry's title.
  function topLabels(profile, pool, n) {
    var weights = profile && profile.weights ? profile.weights : {};
    var list = Object.keys(weights).filter(function (f) { return typeof weights[f] === 'number'; });
    list.sort(function (a, b) { return (weights[b] - weights[a]) || (a < b ? -1 : a > b ? 1 : 0); });
    var out = [];
    for (var i = 0; i < list.length && out.length < (n || 5); i++) {
      if (!weights[list[i]]) continue;
      if (list[i].indexOf('series:') === 0) continue;   // a series name points at the books (D46)
      out.push(labelFor(list[i], pool));
    }
    return out;
  }

  var COLUMNS = 'id | title | author | year | subjects | why it fits';

  function candidateLine(pick, profile, pool) {
    var work = workOf(pool, pick.id);
    if (!work) return null;
    var labels = workFacets(work).map(function (f) { return labelFor(f, pool); }).join(', ');
    var facts = '';
    if (typeof Nextbook.factsClause === 'function' && typeof Nextbook.score === 'function') {
      // An author or a series part would name what is on the shelf (D46): left out.
      var parts = Nextbook.score(work, profile || {}, (pool && pool.facets) || {}).parts.filter(function (part) {
        var f = part && typeof part.facet === 'string' ? part.facet : '';
        return f.indexOf('author:') !== 0 && f.indexOf('series:') !== 0;
      });
      facts = Nextbook.factsClause(parts);
    }
    return '- ' + work.id + ' | ' + clean(work.title) + ' | ' + clean(work.author) + ' | ' +
      str(work.year) + ' | ' + labels + ' | ' + (facts || 'from the pile');
  }

  // A work is on the person's shelf when any of its handles, or its own normalised title,
  // meets an entry's. The title is the narrow hole rule 1 must still close: a book typed in
  // that never matched the slice still puts its title in the person's own list (D34).
  function normTitle(v) {
    if (typeof Nextbook.norm === 'function') return Nextbook.norm(v);
    return clean(v).toLowerCase();
  }

  function shelfIndex(shelf) {
    var ids = Object.create(null), groups = Object.create(null),
      records = Object.create(null), titles = Object.create(null);
    function add(o) {
      if (!o || typeof o !== 'object') return;
      var id = str(o.id), gk = str(o.groupKey), rec = str(o.recordId), title = normTitle(o.title);
      if (id) ids[id] = true;
      if (gk) groups[gk] = true;
      if (rec) records[rec] = true;
      if (title) titles[title] = true;
    }
    (Array.isArray(shelf) ? shelf : []).forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      add(entry);
      add(entry.work);
    });
    return { ids: ids, groups: groups, records: records, titles: titles };
  }

  function onPersonShelf(work, index) {
    if (!work) return false;
    var id = str(work.id), gk = str(work.groupKey), rec = str(work.recordId), title = normTitle(work.title);
    return !!((id && index.ids[id]) || (gk && index.groups[gk]) ||
      (rec && index.records[rec]) || (title && index.titles[title]));
  }

  // finalistsPrompt(result, profile, pool, shelf): the candidates as the list's own words,
  // less any candidate the person already has. Never reads pick.why: a reason may name a book
  // on the shelf. The wording counts the candidates it actually wrote: one book is asked for
  // one line, two or more for two. Returns { text, excluded }; with nothing excluded the text
  // is exactly what this prompt has always been.
  function finalistsPrompt(result, profile, pool, shelf) {
    var index = shelfIndex(shelf);
    var picks = result && Array.isArray(result.picks) ? result.picks : [];
    var top = topLabels(profile, pool, 5);
    var candidates = [], excluded = [];
    picks.forEach(function (p) {
      if (!p || typeof p !== 'object') return;   // a null or a string pick is not a book
      var line = candidateLine(p, profile, pool);
      if (!line) return;
      var work = workOf(pool, p.id);
      if (onPersonShelf(work, index)) {
        excluded.push({ id: str(work.id), title: clean(work.title) });
        return;
      }
      candidates.push(line);
    });
    var count = candidates.length;
    var lines = [];
    lines.push(count === 1
      ? 'One of these books could be this person\'s next read. Argue for the one you would pick.'
      : count === 0
        ? 'No books were offered, so there is nothing to argue about.'
        : 'Two of these books could be this person\'s next read. Argue for the two you would pick.');
    lines.push('');
    if (Array.isArray(shelf)) {
      // D46: the shelf as numbers, the same block a mode that asks a chat sends.
      lines.push('What their shelf adds up to (counts only: no titles, no authors):');
      shelfSummary(shelf, pool).lines.forEach(function (l) { lines.push('- ' + l); });
    } else {
      lines.push('What their shelf adds up to: ' + (top.length ? top.join(', ') : 'nothing rated yet'));
    }
    lines.push('');
    lines.push(COLUMNS);
    lines = lines.concat(candidates);
    lines.push('');
    lines.push(count === 1
      ? 'Write exactly one line, for the book you pick, in this shape:'
      : count === 0
        ? 'Write one line for the book you pick, in this shape:'
        : 'Write exactly two lines, one for each book you pick, in this shape:');
    lines.push('<id>: <one sentence>');
    lines.push('');
    lines.push(count >= 2 ? END : END_ONE);
    return { text: lines.join('\n'), excluded: excluded };
  }

  var HEADINGS = {
    topic: 'Subjects', genre: 'Genres', bisac: 'BISAC subjects', section: 'Parts of the library',
    series: 'Series', mood: 'Moods', pace: 'Pace', audience: 'Readers'
  };

  // labelsPrompt(text, facets): the list's own subjects, grouped by kind, from the pool's
  // facet table ({facet: {label, kind}}), an array of labels, or an array of facets. The words
  // are "subjects" throughout, because that is what the app calls them on the page.
  function labelsPrompt(text, facets) {
    var index = labelIndex(facets);
    var byKind = {}, kinds = [];
    index.keys.forEach(function (k) {
      var i = k.indexOf(':');
      var kind = i >= 0 ? k.slice(0, i) : '';
      if (!has(byKind, kind)) { byKind[kind] = []; kinds.push(kind); }
      byKind[kind].push(index.labels[k]);
    });
    kinds.sort(function (a, b) {
      var ia = has(HEADINGS, a) ? Object.keys(HEADINGS).indexOf(a) : 99;
      var ib = has(HEADINGS, b) ? Object.keys(HEADINGS).indexOf(b) : 99;
      return (ia - ib) || (a < b ? -1 : a > b ? 1 : 0);
    });
    var lines = [];
    lines.push('Pick up to four subjects for this text. Use only subjects from the list below, spelled exactly as they are.');
    lines.push('');
    lines.push('The text:');
    lines.push(clean(text) || '(no text)');
    lines.push('');
    lines.push('The subjects:');
    kinds.forEach(function (kind) {
      byKind[kind].sort();
      lines.push((HEADINGS[kind] || 'Other') + ': ' + byKind[kind].join(', '));
    });
    lines.push('');
    lines.push('Write the subjects you pick, one per line, exactly as they are spelled above.');
    lines.push('');
    lines.push(END_LABELS);
    return lines.join('\n');
  }

  // ---- What the shelf adds up to, in numbers (D46) ---------------------------------------------
  // shelfSummary(shelf, pool) -> { lines, rated, small }
  // Counts and the list's own subject words, and never a title, an author or a series name:
  // those name a book. Below SUMMARY_MIN_RATED rated books even the subjects would point at one
  // or two books, so only the counts are written and `small` is true.
  var SUMMARY_MIN_RATED = 3;
  var SUBJECT_KINDS = { topic: true, genre: true, bisac: true };
  var FEEL_KINDS = { mood: true, pace: true };
  var STATE_WORDS = [['read', 'read'], ['reading', 'reading now'], ['want', 'want to read'],
    ['hold', 'on hold'], ['stopped', 'stopped']];
  var RATING_WORDS = [['loved', 'loved'], ['liked', 'liked'], ['ok', 'OK'], ['not-for-me', 'not for me']];
  var FORMAT_SAID = { BK: 'book', EBOOK: 'ebook', EAUDIOBOOK: 'audiobook', LPRINT: 'large print' };
  var AUDIENCE_SAID = { ADULT: 'adult', TEEN: 'teen', CHILDREN: 'children', JUVENILE: 'children' };

  function tally(map, key) { map[key] = (map[key] || 0) + 1; }

  // The strongest n of a tally, most first, then by the words, so the same shelf says the same.
  function topCounts(map, n, wordsOf) {
    var keys = Object.keys(map);
    var said = {};
    keys.forEach(function (k) { said[k] = wordsOf ? wordsOf(k) : k; });
    keys.sort(function (a, b) {
      return (map[b] - map[a]) || (said[a] < said[b] ? -1 : said[a] > said[b] ? 1 : 0);
    });
    return keys.slice(0, n).map(function (k) { return said[k] + ' (' + map[k] + ')'; });
  }

  function facetTally(works, kinds) {
    var out = {};
    works.forEach(function (w) {
      workFacets(w).forEach(function (f) {
        var i = f.indexOf(':');
        if (has(kinds, i >= 0 ? f.slice(0, i) : '')) tally(out, f);
      });
    });
    return out;
  }

  function shelfSummary(shelf, pool) {
    var entries = (Array.isArray(shelf) ? shelf : []).filter(function (e) { return e && typeof e === 'object'; });
    var states = {}, ratings = {}, rated = 0;
    entries.forEach(function (e) {
      if (e.state) tally(states, str(e.state));
      if (e.rating) { tally(ratings, str(e.rating)); rated += 1; }
    });
    var lines = [];
    var stateBits = STATE_WORDS.filter(function (s) { return states[s[0]]; })
      .map(function (s) { return states[s[0]] + ' ' + s[1]; });
    lines.push('Books on their shelf: ' + entries.length + (stateBits.length ? ' (' + stateBits.join(', ') + ')' : '') + '.');
    var ratingBits = RATING_WORDS.filter(function (r) { return ratings[r[0]]; })
      .map(function (r) { return ratings[r[0]] + ' ' + r[1]; });
    lines.push('Their ratings: ' + (ratingBits.length ? ratingBits.join(', ') : 'none yet') + '.');
    if (rated < SUMMARY_MIN_RATED) {
      lines.push('Fewer than ' + SUMMARY_MIN_RATED + ' books are rated, so this gives only the counts.');
      return { lines: lines, rated: rated, small: true };
    }
    function worksWhere(test) {
      return entries.filter(function (e) { return e.work && test(e); }).map(function (e) { return e.work; });
    }
    var good = worksWhere(function (e) { return e.rating === 'loved' || e.rating === 'liked'; });
    var bad = worksWhere(function (e) { return e.rating === 'not-for-me'; });
    var known = worksWhere(function (e) { return e.state !== 'want' && e.state !== 'hold'; });
    function label(f) { return labelFor(f, pool); }
    function add(heading, list) { if (list.length) lines.push(heading + ': ' + list.join(', ') + '.'); }

    add('Subjects in books they loved or liked', topCounts(facetTally(good, SUBJECT_KINDS), 10, label));
    add('Mood and pace of books they loved or liked, where the app has them',
      topCounts(facetTally(good, FEEL_KINDS), 5, label));
    add('Subjects in books they marked not for me', topCounts(facetTally(bad, SUBJECT_KINDS), 6, label));
    var visited = facetTally(known, { section: true });
    add('Parts of the library their books come from', topCounts(visited, 6, label));
    var never = {};
    (typeof Nextbook.sections === 'function' ? Nextbook.sections((pool && pool.works) || [], (pool && pool.facets) || {}) : [])
      .forEach(function (s) { if (!has(visited, s.facet)) never[s.facet] = s.works.length; });
    add('Parts of the library with none of their books', Object.keys(never).sort(function (a, b) {
      return (never[b] - never[a]) || (a < b ? -1 : 1);
    }).slice(0, 6).map(label));
    var formats = {}, audiences = {}, decades = {};
    known.forEach(function (w) {
      (Array.isArray(w.formats) ? w.formats : []).forEach(function (code) {
        tally(formats, FORMAT_SAID[str(code)] || str(code).toLowerCase());
      });
      if (w.audience) tally(audiences, AUDIENCE_SAID[str(w.audience)] || str(w.audience).toLowerCase());
      if (typeof w.year === 'number' && isFinite(w.year)) tally(decades, (Math.floor(w.year / 10) * 10) + 's');
    });
    add('Formats', topCounts(formats, 4));
    add('Readers the books are for', topCounts(audiences, 4));
    add('When the books came out', topCounts(decades, 5));
    return { lines: lines, rated: rated, small: false };
  }

  // ---- A mode that asks a chat (D46) -------------------------------------------------------------
  // askPrompt(ask, shelf, pool) -> { text, summary }
  // `ask` is the checked { question, books } from validate(). The books are the list's own words;
  // the shelf goes in only as shelfSummary's numbers.
  var ASK_MAX_KEPT = 6;
  var END_ASK = 'Answer with up to six lines. Do not change any files.';

  function askLine(work, pool) {
    var labels = workFacets(work).filter(function (f) { return f.indexOf('series:') !== 0; })
      .slice(0, 8).map(function (f) { return labelFor(f, pool); }).join(', ');
    return '- ' + work.id + ' | ' + clean(work.title) + ' | ' + clean(work.author) + ' | ' +
      str(work.year) + ' | ' + labels;
  }

  function askPrompt(ask, shelf, pool) {
    var a = ask || {};
    var summary = shelfSummary(shelf, pool);
    var books = [];
    (Array.isArray(a.books) ? a.books : []).forEach(function (id) {
      var work = workOf(pool, id);
      if (work) books.push(askLine(work, pool));
    });
    var lines = [];
    lines.push(clean(a.question));
    lines.push('');
    lines.push('What their shelf adds up to (counts only: no titles, no authors):');
    summary.lines.forEach(function (l) { lines.push('- ' + l); });
    lines.push('');
    lines.push('The books to choose from:');
    lines.push('id | title | author | year | subjects');
    lines = lines.concat(books);
    lines.push('');
    lines.push('Pick up to six of these books. Use only the ids in this list.');
    lines.push('Write one line for each book you pick, in this shape:');
    lines.push('<id>: <one sentence that says why, from what their shelf adds up to>');
    lines.push('');
    lines.push(END_ASK);
    return { text: lines.join('\n'), summary: summary };
  }

  var ASK_SAID = {
    unknown: function (id) { return id + ' is not one of the books offered.'; },
    repeat: function (id) { return id + ' is named twice, so only the first was kept.'; },
    third: function (id) { return id + ' is more than the six asked for.'; },
    noSentence: function (id) { return id + ' has no sentence after it, so there was nothing to keep.'; },
    words: { unknown: 'not one of the books offered', third: 'more than the six asked for' }
  };

  // parseAsk(answer, ask, idPattern) -> { kept, dropped, reason }: up to six of the offered ids,
  // each with the chat's one sentence. The same reader as the finalists, with six for two.
  function parseAsk(answer, ask, idPattern) {
    var books = ask && Array.isArray(ask.books) ? ask.books : [];
    return readPicks(answer, books.map(function (id) { return { id: id }; }), idPattern,
      ASK_MAX_KEPT, ASK_SAID, 'The answer did not name any of the books offered.');
  }

  Nextbook.seam = {
    available: false,          // no keys, no calls: the person carries the prompt
    end: END,
    endOne: END_ONE,
    endLabels: END_LABELS,
    finalistsPrompt: finalistsPrompt,
    parseFinalists: parseFinalists,
    labelsPrompt: labelsPrompt,
    parseLabels: parseLabels,
    labelIndex: labelIndex,
    shelfSummary: shelfSummary,
    summaryMinRated: SUMMARY_MIN_RATED,
    askPrompt: askPrompt,
    parseAsk: parseAsk,
    endAsk: END_ASK
  };
  Nextbook.finalistsPrompt = finalistsPrompt;
  Nextbook.parseFinalists = parseFinalists;
  Nextbook.labelsPrompt = labelsPrompt;
  Nextbook.parseLabels = parseLabels;
})(window);
