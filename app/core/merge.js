'use strict';
// Bringing the library's shelf in: the pure three-way merge (ARCHITECTURE.md, "Bringing in
// the library's shelf"). Nothing here reads the page, storage or a clock; the caller passes
// the import the reader produced, the shelf in use and `now` (an ISO string).
//
// Each entry that came from the library remembers what the library said last time, in
// `library` (called B below). On an import there are three values per work:
//
//   B  the library's last word, from entry.library
//   L  what the library says now, from the reader's entry
//   A  what the person has here, from the app's own entry
//
// States and ratings are compared through the table in "Lining up with the library's own
// shelves", ratings in buckets: 5 = loved, 4 = liked, 3 = ok, 1 to 2 = not-for-me. The exact
// rating out of 10 is kept in B (`rating10`) but never compared, so 9 and 10 agree.
//
//   Nextbook.merge.plan(brought, ours, {now, practice})
//     -> {entries, report, tidy, choose, refusals}
//
// `entries` is the shelf as it should be after the import. `tidy` rows are for "Tidy up at
// the library"; `choose` rows are for "Which is right?". `report` counts are ready to turn
// into the sentence on the shelf screen.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.merge = Nextbook.merge || {};

  var STATES = { want: 1, reading: 1, read: 1, stopped: 1 };
  var RATINGS = { loved: 1, liked: 1, ok: 1, 'not-for-me': 1 };
  var SHELF_STATE = { for_later: 'want', in_progress: 'reading', completed: 'read' };
  var STATE_SHELF = { want: 'for_later', reading: 'in_progress', read: 'completed' };
  var SHELF_WORD = { for_later: 'For Later', in_progress: 'In Progress', completed: 'Completed' };
  var SHELF_ORDER = ['for_later', 'in_progress', 'completed'];

  // The merge's own words join the one table, like the store's do, so a later screen can
  // move them without touching this file.
  function addStrings(table) {
    Nextbook.strings = Nextbook.strings || {};
    Object.keys(table).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(Nextbook.strings, k)) Nextbook.strings[k] = table[k];
    });
  }
  addStrings({
    importPracticeRefused: 'The practice shelf does not take a real import. Do this at home, on your own shelf.',
    importPartialShelf: 'Your {shelf} shelf was not fully saved, so nothing was taken off it.'
  });

  function t(key, vars) {
    return typeof Nextbook.t === 'function' ? Nextbook.t(key, vars) : String(key);
  }

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function str(x) { return typeof x === 'string' ? x : ''; }

  function clone(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; }
  }

  // A book without a library id is matched on its title and author, the same spelling the
  // rest of the app uses (base.js, norm).
  function normText(value) {
    if (typeof Nextbook.norm === 'function') return Nextbook.norm(value);
    return String(value === null || value === undefined ? '' : value).toLowerCase();
  }

  function normKey(title, author) {
    var name = normText(title);
    if (!name) return '';
    return name + '|' + normText(author);
  }

  function stateOfShelf(shelf) {
    return typeof shelf === 'string' && has(SHELF_STATE, shelf) ? SHELF_STATE[shelf] : null;
  }

  function shelfOfState(state) {
    return typeof state === 'string' && has(STATE_SHELF, state) ? STATE_SHELF[state] : null;
  }

  // 10 = five stars, 8 = four, 6 = three, 4 and 1 = one or two. 0 is "not rated".
  function bucketOf10(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
    if (n >= 9) return 'loved';
    if (n >= 7) return 'liked';
    if (n >= 5) return 'ok';
    return 'not-for-me';
  }

  // The whole-star value used only when the file gives no number out of 10 at all.
  function tenOfBucket(rating) {
    if (rating === 'loved') return 10;
    if (rating === 'liked') return 8;
    if (rating === 'ok') return 6;
    if (rating === 'not-for-me') return 2;
    return 0;
  }

  // How far along a state is, for choosing between two editions of one work. "stopped" is
  // never furthest: the library has no such shelf, so it only ever comes from here.
  function rankOf(state) {
    if (state === 'read') return 3;
    if (state === 'reading') return 2;
    if (state === 'want') return 1;
    return 0;
  }

  // A from an app entry: state and rating are ours already.
  function sideOfEntry(entry) {
    return {
      state: isObj(entry) && has(STATES, entry.state) ? entry.state : null,
      rating: isObj(entry) && has(RATINGS, entry.rating) ? entry.rating : null
    };
  }

  // L from a reader entry. The reader lines the shelf up already (state/rating), but a file
  // may also carry the library's own words (`shelf`, `rating10`), so both are understood.
  function sideOfLibrary(entry) {
    var state = has(STATES, entry.state) ? entry.state : null;
    if (state === null) state = stateOfShelf(entry.shelf);
    var rating = has(RATINGS, entry.rating) ? entry.rating : null;
    if (rating === null) rating = bucketOf10(entry.rating10);
    return { state: state, rating: rating };
  }

  // B. An entry that has no shelf and no number was never brought in; it is not a memory.
  function hasMemory(lib) {
    return isObj(lib) && (typeof lib.shelf === 'string' || typeof lib.rating10 === 'number');
  }

  function sideOfMemory(lib) {
    return {
      state: stateOfShelf(lib.shelf),
      rating: bucketOf10(lib.rating10)
    };
  }

  function sameSide(a, b) {
    return a.state === b.state && a.rating === b.rating;
  }

  // One work from the reader may be several editions: the library shelf can hold the e-book
  // and the paper copy. They become one entry with the furthest-along state; completed beats
  // reading, reading beats want. A rating rides with the edition that got furthest, and a
  // later edition's rating fills in when that one is unrated.
  function mergeEditions(items) {
    var best = items[0];
    var bestRank = -1;
    var i;
    for (i = 0; i < items.length; i++) {
      var rank = rankOf(sideOfLibrary(items[i]).state);
      if (rank > bestRank) { bestRank = rank; best = items[i]; }
    }
    var side = sideOfLibrary(best);
    var rating10 = typeof best.rating10 === 'number' && isFinite(best.rating10) ? best.rating10 : null;
    if (side.rating === null) {
      for (i = 0; i < items.length; i++) {
        var other = sideOfLibrary(items[i]);
        if (other.rating !== null) {
          side.rating = other.rating;
          rating10 = typeof items[i].rating10 === 'number' && isFinite(items[i].rating10)
            ? items[i].rating10 : null;
          break;
        }
      }
    }
    return {
      key: str(best.key),
      id: best.id === undefined ? null : best.id,
      groupKey: str(best.groupKey) || null,
      title: str(best.title),
      author: str(best.author),
      from: str(best.from) || 'library-shelf',
      shelf: str(best.shelf) || shelfOfState(side.state),
      state: side.state,
      rating: side.rating,
      rating10: rating10,
      dateAdded: str(best.dateAdded) || null
    };
  }

  function workIdOf(x) {
    if (typeof x.groupKey === 'string' && x.groupKey) return 'g:' + x.groupKey;
    if (typeof x.key === 'string' && x.key) return 'k:' + x.key;
    var name = normText(x.title);
    if (name) return 't:' + name + '|' + normText(x.author);
    return '';
  }

  function groupLibrary(entries) {
    var groups = [];
    var at = Object.create(null);
    var i;
    for (i = 0; i < entries.length; i++) {
      if (!isObj(entries[i])) continue;
      var id = workIdOf(entries[i]);
      if (!id) continue;
      if (!has(at, id)) { at[id] = groups.length; groups.push([]); }
      groups[at[id]].push(entries[i]);
    }
    var out = [];
    for (i = 0; i < groups.length; i++) out.push(mergeEditions(groups[i]));
    return out;
  }

  function push(map, key, value) {
    if (typeof key !== 'string' || !key) return;
    if (!map[key]) map[key] = [];
    map[key].push(value);
  }

  function indexOurs(mine) {
    var index = { group: Object.create(null), key: Object.create(null), norm: Object.create(null) };
    for (var i = 0; i < mine.length; i++) {
      var entry = mine[i];
      if (!isObj(entry)) continue;
      push(index.group, str(entry.groupKey), i);
      push(index.key, str(entry.key), i);
      push(index.norm, normKey(entry.title, entry.author), i);
    }
    return index;
  }

  function firstFree(list, used) {
    if (!list) return -1;
    for (var i = 0; i < list.length; i++) {
      if (!used[list[i]]) return list[i];
    }
    return -1;
  }

  // Match on groupKey first, never on the record id: the library's paper copy and the app's
  // e-book are one work. A typed or found book with no groupKey falls back to title + author.
  function findOurs(index, work, used) {
    var at = firstFree(index.group[work.groupKey || ''], used);
    if (at !== -1) return at;
    at = firstFree(index.key[work.key || ''], used);
    if (at !== -1) return at;
    return firstFree(index.norm[normKey(work.title, work.author)], used);
  }

  function markWork(seen, work) {
    if (work.groupKey) seen['g:' + work.groupKey] = true;
    if (work.key) seen['k:' + work.key] = true;
    var name = normKey(work.title, work.author);
    if (name) seen['t:' + name] = true;
  }

  function workPresent(seen, entry) {
    if (entry.groupKey && seen['g:' + entry.groupKey]) return true;
    if (entry.key && seen['k:' + entry.key]) return true;
    var name = normKey(entry.title, entry.author);
    return !!(name && seen['t:' + name]);
  }

  function keyFor(work) {
    if (work.key) return work.key;
    if (work.groupKey) return 'w:' + work.groupKey;
    var name = normText(work.title);
    return name ? 't:' + name + '|' + normText(work.author) : '';
  }

  // The exact number out of 10 is kept when the file has one. When it does not, the number
  // already remembered is kept if it still falls in the same bucket, so an unchanged 9 does
  // not get flattened to 10 just because the reader only carried the bucket.
  function exactRating10(work, old) {
    if (typeof work.rating10 === 'number' && isFinite(work.rating10)) return work.rating10;
    if (work.rating === null) return 0;
    if (isObj(old) && typeof old.rating10 === 'number' && bucketOf10(old.rating10) === work.rating) {
      return old.rating10;
    }
    return tenOfBucket(work.rating);
  }

  // B after this import. Whatever the person decides, the library's latest word replaces the
  // old one, so the same difference is never asked about twice. Unknown keys on the old
  // memory ride along, as the store's merge does with whole entries.
  function memoryOf(old, work, now, keepIgnore) {
    var mem = isObj(old) ? clone(old) : {};
    if (!isObj(mem)) mem = {};
    mem.shelf = work.shelf;
    mem.rating10 = exactRating10(work, old);
    mem.dateAdded = work.dateAdded || (isObj(old) ? str(old.dateAdded) : '') || null;
    mem.seen = now;
    delete mem.gone;
    mem.ignore = keepIgnore ? clone(old.ignore) : null;
    return mem;
  }

  // "Leave it" is remembered as {at, here: {state, rating}} on the side that was left. The
  // row comes back when either side moves: the library side is compared with B (not with the
  // stamp's date or with `seen`, which every import moves), and the here side with the
  // remembered state and rating.
  function ignored(entry, old) {
    if (!isObj(old) || !old.ignore) return false;
    var stamp = old.ignore;
    if (isObj(stamp) && isObj(stamp.here)) {
      var here = sideOfEntry(entry);
      return stamp.here.state === here.state && stamp.here.rating === here.rating;
    }
    // An older stamp with no snapshot can only say when it was left. ISO strings compare as
    // text; a full timestamp with an offset may tie, which errs towards not nagging.
    if (typeof stamp === 'string' && typeof entry.updated === 'string') return entry.updated <= stamp;
    return false;
  }

  function rowFor(entry, work, why) {
    return {
      key: str(entry.key),
      title: str(entry.title),
      author: str(entry.author),
      here: {
        state: has(STATES, entry.state) ? entry.state : null,
        rating: has(RATINGS, entry.rating) ? entry.rating : null
      },
      library: {
        shelf: work.shelf || null,
        rating: work.rating === undefined ? null : work.rating
      },
      why: why
    };
  }

  function whyFor(here, there) {
    // The library has no "stopped" shelf. An app "stopped" beside the library's live shelf is
    // information, not an error: it is still on their shelf over there.
    if (here.state === 'stopped' && there.state !== null && there.state !== 'stopped') return 'stopped';
    return 'changed-here';
  }

  function entryFromLibrary(work, now) {
    return {
      key: keyFor(work),
      id: work.id,
      groupKey: work.groupKey,
      state: work.state,
      rating: work.rating,
      updated: now,
      title: work.title,
      author: work.author,
      from: work.from,
      library: memoryOf(null, work, now, false)
    };
  }

  // One work that is already here, against the library's word now. Returns nothing; the entry
  // is changed in place.
  function applyLibrary(entry, work, now, report, tidy, choose) {
    var here = sideOfEntry(entry);
    var there = { state: work.state, rating: work.rating };
    var old = isObj(entry.library) ? entry.library : null;
    var remembered = hasMemory(old);
    var leftAlone = false;

    if (!remembered) {
      // Row 8: first import and the book is already here (from the slice or typed in). Ours
      // is A with no B, so a disagreement behaves as "changed in both".
      if (!sameSide(here, there)) {
        choose.push(rowFor(entry, work, 'changed-both'));
        report.kept += 1;
      }
    } else {
      var memory = sideOfMemory(old);
      var changedHere = !sameSide(here, memory);
      var changedThere = !sameSide(there, memory);

      if (changedThere && !changedHere) {
        // Row 2: the library moved and we did not. Follow it quietly.
        entry.state = work.state;
        entry.rating = work.rating;
        report.updated += 1;
      } else if (changedThere && changedHere) {
        if (sameSide(here, there)) {
          // Row 5: both moved the same way. Nothing to do.
        } else {
          // Row 4: both moved, differently. Keep ours for now and ask.
          choose.push(rowFor(entry, work, 'changed-both'));
          report.kept += 1;
        }
      } else if (changedHere) {
        // Row 3: we moved, the library did not. Keep ours and list it for tidying up, unless
        // the person already said "Leave it" and neither side has moved since.
        if (ignored(entry, old)) {
          leftAlone = true;
          report.ignored += 1;
        } else {
          tidy.push(rowFor(entry, work, whyFor(here, there)));
          report.kept += 1;
        }
      }
    }

    entry.library = memoryOf(old, work, now, leftAlone);
    // The entry as a whole is newer: its memory has moved. The store's clash rule keeps the
    // newer whole entry, so without this an import would lose B on the next store.add.
    if (now) entry.updated = now;
  }

  function plan(brought, ours, opts) {
    var options = isObj(opts) ? opts : {};
    var now = str(options.now);
    var mine = clone(Array.isArray(ours) ? ours : []);
    if (!Array.isArray(mine)) mine = [];

    var report = { added: 0, updated: 0, kept: 0, gone: 0, ignored: 0 };
    var tidy = [];
    var choose = [];
    var refusals = [];

    // The practice shelf is for trying things with no consequences; a real reading history
    // does not belong there, especially not on a shared library computer.
    if (options.practice) {
      refusals.push(t('importPracticeRefused'));
      return { entries: mine, report: report, tidy: tidy, choose: choose, refusals: refusals };
    }

    var source = isObj(brought) ? brought : {};
    var complete = isObj(source.complete) ? source.complete : {};
    var library = groupLibrary(Array.isArray(source.entries) ? source.entries : []);
    var index = indexOurs(mine);
    var used = Object.create(null);
    var seen = Object.create(null);
    var i;

    for (i = 0; i < library.length; i++) markWork(seen, library[i]);

    // A partial shelf is not a removal announcement. Say so once per unfinished shelf, so the
    // screen can ask for the other pages instead of quietly dropping books.
    for (i = 0; i < SHELF_ORDER.length; i++) {
      var name = SHELF_ORDER[i];
      if (has(complete, name) && complete[name] !== true) {
        refusals.push(t('importPartialShelf', { shelf: SHELF_WORD[name] }));
      }
    }

    var original = mine.length;

    for (i = 0; i < library.length; i++) {
      var work = library[i];
      var at = findOurs(index, work, used);
      if (at === -1) {
        // Row 1: new at the library, not here.
        mine.push(entryFromLibrary(work, now));
        report.added += 1;
        continue;
      }
      used[at] = true;
      applyLibrary(mine[at], work, now, report, tidy, choose);
    }

    // Rows 6 and 7: books here that the reader did not bring. A memory means the library had
    // it last time, so its absence is news only from a shelf that was fully saved.
    for (i = 0; i < original; i++) {
      if (used[i]) continue;
      var entry = mine[i];
      if (!isObj(entry) || !hasMemory(entry.library)) continue; // row 7: never at the library
      if (workPresent(seen, entry)) continue; // a second edition of a work the library does have
      var shelf = entry.library.shelf;
      if (!has(SHELF_STATE, shelf) || complete[shelf] !== true) continue; // partial: no gone

      var leftAlone = ignored(entry, entry.library);
      var goneMemory = clone(entry.library) || {};
      goneMemory.seen = now;
      goneMemory.gone = true;
      goneMemory.ignore = leftAlone ? clone(entry.library.ignore) : null;
      entry.library = goneMemory;
      if (now) entry.updated = now;
      report.gone += 1;
      if (leftAlone) {
        report.ignored += 1;
      } else {
        tidy.push(rowFor(entry, { shelf: shelf, rating: bucketOf10(entry.library.rating10) }, 'gone'));
      }
    }

    return { entries: mine, report: report, tidy: tidy, choose: choose, refusals: refusals };
  }

  Nextbook.merge.plan = plan;
})(window);
