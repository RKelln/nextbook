'use strict';
// Out to the library's own page for a book. The app decides; the library owns the record.
// The URL templates live in the slice (library.recordUrl, library.searchUrl), never here, so
// this file knows no library's name and the app stays library-generic (D10).
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.links = Nextbook.links || {};

  function str(v) {
    return typeof v === 'string' && v ? v : (typeof v === 'number' ? String(v) : '');
  }

  // A query for a search page: encodeURIComponent, with spaces as + because that is what the
  // catalogue's search box puts in the address bar. & and # are encoded, so a title can never
  // end the query value or start a fragment.
  function encodeQuery(text) {
    return encodeURIComponent(String(text)).replace(/%20/g, '+');
  }

  // The words a typed book is searched by: its title and its author.
  function queryFor(work) {
    var w = work || {};
    return [str(w.title), str(w.author)].filter(function (p) { return !!p; }).join(' ');
  }

  function fill(template, token, value) {
    return String(template).split(token).join(value);
  }

  // linkFor(entryOrWork, library) -> an absolute URL, or '' when the library has no template.
  //   record: the work has a recordId, or an id while library.recordUrl is set (a found work's
  //           id is its record id; a pack work's id is a pack id and its recordUrl is null).
  //   search: everything else (a pack work, a typed book, an entry with no id).
  function linkFor(entryOrWork, library) {
    var w = entryOrWork || {};
    var lib = library || {};
    var recordUrl = str(lib.recordUrl);
    var searchUrl = str(lib.searchUrl);
    var recordId = str(w.recordId);

    if (recordUrl && (recordId || str(w.id))) {
      return fill(recordUrl, '{id}', encodeURIComponent(recordId || str(w.id)));
    }
    var query = queryFor(w);
    if (!searchUrl || !query) return '';
    return fill(searchUrl, '{q}', encodeQuery(query));
  }

  Nextbook.links.linkFor = linkFor;
  Nextbook.links.encodeQuery = encodeQuery;
  Nextbook.links.queryFor = queryFor;
  Nextbook.linkFor = linkFor; // a mode's check loads one file, so the short name helps
})(window);
