'use strict';
// T8.9a: reading a Goodreads or StoryGraph export. A file export is whole, so every shelf
// arrives at once (unlike a saved shelf page). Nothing here reads the page, storage, a clock
// or a random number: text in, plain objects out, in the shape `Nextbook.merge.plan` takes.
//
//   Nextbook.csv.rows(text)              -> [[cell, ...], ...]
//   Nextbook.csv.parse(text, shape)      -> {entries, works, complete, problems}
//   Nextbook.csv.goodreads(text)         -> the same, with the Goodreads columns
//   Nextbook.csv.storygraph(text)        -> the same, with the StoryGraph columns
//
// `shape` is {from, columns, shelves}: `columns` names the header for each field we use, and
// `shelves` maps the site's shelf word to one of our four states. A row that cannot be read
// is named in `problems`, never dropped in silence.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.csv = Nextbook.csv || {};

  // The reader's words join the one table, like the merge's do.
  function addStrings(table) {
    Nextbook.strings = Nextbook.strings || {};
    Object.keys(table).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(Nextbook.strings, k)) Nextbook.strings[k] = table[k];
    });
  }
  addStrings({
    importNoTitle: 'Row {row} has no title, so it was left out.',
    importUnknownShelf: 'Row {row} ({title}): "{shelf}" is not a shelf this app knows, so the row was left out.',
    importBadRating: 'Row {row} ({title}): "{rating}" is not a number, so the row was left out.'
  });

  function t(key, vars) {
    return typeof Nextbook.t === 'function' ? Nextbook.t(key, vars) : String(key);
  }

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function str(x) { return typeof x === 'string' ? x : ''; }

  // Same spelling as the rest of the app (base.js, norm). A missing base.js falls back to a
  // plain lower case, so this file still loads on its own.
  function normText(value) {
    if (typeof Nextbook.norm === 'function') return Nextbook.norm(value);
    return String(value === null || value === undefined ? '' : value).toLowerCase();
  }

  // The app's four buckets, from a number out of ten. This is the table in merge.js, repeated
  // here because a reader may be loaded without the merge. 9 and 10 are loved, 7 and 8 liked,
  // 5 and 6 ok, 1 to 4 not-for-me. 4.5 stars is 9/10, the nearer bucket when the app's own
  // thresholds settle the tie (there is no "half loved").
  function bucketOf10(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
    if (n >= 9) return 'loved';
    if (n >= 7) return 'liked';
    if (n >= 5) return 'ok';
    return 'not-for-me';
  }

  // The library-style shelf word that goes with each state. "stopped" has no shelf at the
  // library, so it carries none; the state is what the app reads.
  // "hold" is on For Later as far as the library's shelves go: a hold is not a shelf.
  var SHELF_OF_STATE = { want: 'for_later', hold: 'for_later', reading: 'in_progress', read: 'completed', stopped: '' };

  // ---- The CSV reader ------------------------------------------------------------------------
  // Comma separated, quoted fields, "" inside a quoted field, newlines inside a quoted field,
  // CRLF or LF, a UTF-8 BOM, and ragged rows padded to the widest row. No library.
  function rows(text) {
    if (typeof text !== 'string' || !text) return [];
    var s = text;
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // a UTF-8 BOM is not a character of the file

    var out = [];
    var row = [];
    var field = '';
    var quoted = false;
    var touched = false; // has this row a delimiter, a quote or a character?
    var i = 0;
    var n = s.length;

    while (i < n) {
      var c = s.charAt(i);

      if (quoted) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') {
            field += '"'; // a doubled quote is one quote
            touched = true;
            i += 2;
            continue;
          }
          quoted = false; // the closing quote
          touched = true;
          i += 1;
          continue;
        }
        field += c; // commas and newlines are ordinary inside quotes
        touched = true;
        i += 1;
        continue;
      }

      if (c === '"' && field === '') {
        quoted = true; // a quote opens a field only at its start
        touched = true;
        i += 1;
        continue;
      }

      if (c === ',') {
        row.push(field);
        field = '';
        touched = true;
        i += 1;
        continue;
      }

      if (c === '\r' || c === '\n') {
        if (c === '\r' && s.charAt(i + 1) === '\n') i += 1;
        if (touched) {
          row.push(field);
          out.push(row);
        }
        row = [];
        field = '';
        touched = false;
        i += 1;
        continue;
      }

      field += c;
      touched = true;
      i += 1;
    }

    if (touched) {
      row.push(field);
      out.push(row);
    }

    // Ragged rows are padded to the widest, so a short row never reads as a missing column
    // by accident: it reads as an empty cell.
    var width = 0;
    var r;
    for (r = 0; r < out.length; r++) {
      if (out[r].length > width) width = out[r].length;
    }
    for (r = 0; r < out.length; r++) {
      while (out[r].length < width) out[r].push('');
    }
    return out;
  }

  // A header is matched without case or surrounding space, so "Date Added" and "date added"
  // are the same column. A name that is not there reads as an empty cell.
  function headerAt(header) {
    var at = Object.create(null);
    for (var i = 0; i < header.length; i++) {
      var name = String(header[i] === null || header[i] === undefined ? '' : header[i])
        .replace(/^\ufeff/, '').trim().toLowerCase();
      if (name && !has(at, name)) at[name] = i;
    }
    return at;
  }

  function columnAt(at, names) {
    var list = Array.isArray(names) ? names : [names];
    for (var i = 0; i < list.length; i++) {
      var key = String(list[i] === null || list[i] === undefined ? '' : list[i]).trim().toLowerCase();
      if (key && has(at, key)) return at[key];
    }
    return -1;
  }

  function cell(row, at, names) {
    var i = columnAt(at, names);
    if (i < 0 || i >= row.length) return '';
    return row[i] === null || row[i] === undefined ? '' : String(row[i]);
  }

  // Goodreads writes an ISBN as ="0439023483": the wrapper and quotes are not part of it. A
  // 13-digit number is kept as it is; hyphens and spaces are not part of a number either.
  function isbnOf(raw) {
    var s = str(raw).trim();
    if (!s) return '';
    s = s.replace(/^=/, '');
    s = s.replace(/^"/, '').replace(/"$/, '');
    s = s.replace(/[\s-]/g, '').toUpperCase();
    return /^[0-9X]{10,13}$/.test(s) ? s : '';
  }

  // An empty rating is "not rated". A number outside 0 to 5, or anything that is not a
  // number, is a problem: the reader will not guess what the file meant.
  function ratingOf(raw) {
    var s = str(raw).trim();
    if (!s) return { rating: null, rating10: 0 };
    if (!/^\d+(?:\.\d+)?$/.test(s)) return { bad: s };
    var stars = Number(s);
    if (!isFinite(stars) || stars > 5) return { bad: s };
    if (stars <= 0) return { rating: null, rating10: 0 };
    var ten = Math.round(stars * 2);
    return { rating: bucketOf10(ten), rating10: ten };
  }

  function keyOf(title, author) {
    return 't:' + normText(title) + '|' + normText(author);
  }

  function emptyResult() {
    return {
      entries: [],
      works: [],
      complete: { for_later: true, in_progress: true, completed: true },
      problems: []
    };
  }

  // A shelf is only complete if every row that named it could be read. A row left out may
  // have been a book the library still holds, so that shelf can no longer be called whole:
  // the merge must not read an absent book as gone. A shelf word we do not know puts every
  // shelf in doubt, because the row's shelf is exactly what we could not read.
  function noteIncomplete(complete, shelves, shelfWord) {
    var state = has(shelves, shelfWord) ? shelves[shelfWord] : null;
    if (state === 'stopped') return; // the library has no such shelf, so none is in doubt
    var shelf = state ? SHELF_OF_STATE[state] : '';
    if (shelf) {
      complete[shelf] = false;
      return;
    }
    complete.for_later = false;
    complete.in_progress = false;
    complete.completed = false;
  }

  function parse(text, shape) {
    var spec = isObj(shape) ? shape : {};
    var from = str(spec.from);
    var columns = isObj(spec.columns) ? spec.columns : {};
    var shelves = isObj(spec.shelves) ? spec.shelves : {};
    var result = emptyResult();

    var table = rows(text);
    if (!table.length) return result;

    var at = headerAt(table[0]);
    var r;
    for (r = 1; r < table.length; r++) {
      var row = table[r];
      var line = r + 1; // the header is row 1, so the first book is row 2
      var title = cell(row, at, columns.title).trim();
      var author = cell(row, at, columns.author).trim();
      var shelfRaw = cell(row, at, columns.shelf).trim();
      var shelfWord = shelfRaw.toLowerCase();

      if (!title || !normText(title)) {
        noteIncomplete(result.complete, shelves, shelfWord);
        result.problems.push(t('importNoTitle', { row: line }));
        continue;
      }

      if (!has(shelves, shelfWord)) {
        noteIncomplete(result.complete, shelves, shelfWord);
        result.problems.push(t('importUnknownShelf', { row: line, title: title, shelf: shelfRaw }));
        continue;
      }
      var state = shelves[shelfWord];

      var rating = ratingOf(cell(row, at, columns.rating));
      if (has(rating, 'bad')) {
        noteIncomplete(result.complete, shelves, shelfWord);
        result.problems.push(t('importBadRating', { row: line, title: title, rating: rating.bad }));
        continue;
      }

      var isbn = isbnOf(cell(row, at, columns.isbn13)) || isbnOf(cell(row, at, columns.isbn));
      var dateAdded = cell(row, at, columns.dateAdded).trim() || null;
      var key = keyOf(title, author);

      // The row as the app's shelf takes it. `id` and `groupKey` stay null: a file export
      // carries no record id for this library, and none is invented.
      result.entries.push({
        key: key,
        id: null,
        groupKey: null,
        title: title,
        author: author,
        shelf: SHELF_OF_STATE[state] || '',
        state: state,
        rating: rating.rating,
        rating10: rating.rating10,
        dateAdded: dateAdded,
        isbn: isbn,
        from: from
      });

      // The same row as a work, so a later match can fill in a record id. Only the fields a
      // match needs; nothing here claims to be a catalogue record.
      result.works.push({
        key: key,
        groupKey: null,
        title: title,
        author: author,
        isbn: isbn,
        from: from
      });
    }

    return result;
  }

  var GOODREADS = {
    from: 'goodreads',
    columns: {
      title: ['Title'],
      author: ['Author'],
      rating: ['My Rating'],
      shelf: ['Exclusive Shelf'],
      isbn: ['ISBN'],
      isbn13: ['ISBN13'],
      dateAdded: ['Date Added']
    },
    shelves: {
      read: 'read',
      'currently-reading': 'reading',
      'to-read': 'want'
    }
  };

  var STORYGRAPH = {
    from: 'storygraph',
    columns: {
      title: ['Title'],
      author: ['Authors', 'Author'],
      rating: ['Star Rating'],
      shelf: ['Read Status'],
      isbn: ['ISBN/UID', 'ISBN'],
      isbn13: [],
      dateAdded: ['Date Added']
    },
    shelves: {
      read: 'read',
      'currently-reading': 'reading',
      'to-read': 'want',
      // The library has no such shelf, but the person does. This is our "stopped".
      'did-not-finish': 'stopped',
      // StoryGraph shipped "Paused" in December 2024: started, set aside, not given up on.
      // That is in progress, not a did-not-finish, so it keeps the book and its shelf.
      paused: 'reading'
    }
  };

  function goodreads(text) { return parse(text, GOODREADS); }

  function storygraph(text) { return parse(text, STORYGRAPH); }

  Nextbook.csv.rows = rows;
  Nextbook.csv.parse = parse;
  Nextbook.csv.goodreads = goodreads;
  Nextbook.csv.storygraph = storygraph;
})(window);
