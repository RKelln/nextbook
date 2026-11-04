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

  // A work's catalogue record id: its own recordId (a pack work a find enriched), or, for a
  // book a find brought in, its id, which is the record id (core/slice.js keeps it once).
  function recordIdOf(w) {
    if (str(w.recordId)) return str(w.recordId);
    return w.found && typeof w.found === 'object' ? str(w.id) : '';
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
    var recordId = recordIdOf(w);

    // A real catalogue record id has its own template, so a list whose own ids are not record
    // ids (the pack: recordUrl is null) still links a found book straight to its record.
    var recordIdUrl = str(lib.recordIdUrl) || recordUrl;
    if (recordId && recordIdUrl) return fill(recordIdUrl, '{id}', encodeURIComponent(recordId));
    if (recordUrl && str(w.id)) {
      return fill(recordUrl, '{id}', encodeURIComponent(str(w.id)));
    }
    var query = queryFor(w);
    if (!searchUrl || !query) return '';
    return fill(searchUrl, '{q}', encodeQuery(query));
  }

  // The path part of an absolute address on the library's own host: what the sign-in page's
  // return address takes. '' for anything that is not an http(s) address with a path.
  function pathOf(url) {
    var m = /^https?:\/\/[^\/?#]+(\/[^#]*)$/.exec(str(url));
    return m ? m[1] : '';
  }

  // The library's sign-in page, set to land on one of its own pages afterwards. The person
  // signs in there, as themselves; this page never sees the card or the password, and never
  // knows whether they are signed in (docs/DESIGN.md, "Holds"). '' when the library has no
  // sign-in template or the path is not a path.
  function signInTo(path, library) {
    var lib = library || {};
    var account = lib.account && typeof lib.account === 'object' ? lib.account : {};
    var template = str(account.signIn);
    var where = str(path);
    if (!template || where.charAt(0) !== '/' || where.charAt(1) === '/') return '';
    return fill(template, '{path}', encodeURIComponent(where));
  }

  // accountLink(library, 'holds' | 'forLater' | 'checkedOut') -> sign in, then that page.
  function accountLink(library, which) {
    var lib = library || {};
    var account = lib.account && typeof lib.account === 'object' ? lib.account : {};
    if (!Object.prototype.hasOwnProperty.call(account, which) || which === 'signIn') return '';
    return signInTo(account[which], lib);
  }

  // holdLink(work, library) -> sign in, then the book's own record page, where Place hold is.
  // Only for a book with a real record id; '' for anything else (it has no record page yet,
  // and its link is a search). Never a link into the hold form itself: the library's
  // robots.txt disallows that path, and the hold is the person's own click.
  function holdLink(entryOrWork, library) {
    var w = entryOrWork || {};
    if (!recordIdOf(w)) return '';
    return signInTo(pathOf(linkFor(w, library)), library);
  }

  Nextbook.links.linkFor = linkFor;
  Nextbook.links.accountLink = accountLink;
  Nextbook.links.holdLink = holdLink;
  Nextbook.links.signInTo = signInTo;
  Nextbook.links.encodeQuery = encodeQuery;
  Nextbook.links.queryFor = queryFor;
  Nextbook.linkFor = linkFor; // a mode's check loads one file, so the short name helps
})(window);
