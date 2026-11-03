'use strict';
// The shell: draws the page and loads every mode named in Nextbook.modes with a
// <script> tag, the way searchdesk/core/desk.js does. A mode file that is missing,
// or a .check.js that is missing, is skipped and the app keeps going.
// Stub for T0.1; the real work is T3.2, T3.4 and the mode checks.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  var doc = window.document;
  var booted = false;

  function warn(msg) {
    try { window.console.warn(msg); } catch (e) { /* no console */ }
  }

  function validId(id) {
    return typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id);
  }

  // One <script src>, in list order. A file that is not there calls onerror, not an
  // exception, so a missing mode never stops the boot.
  function loadScript(src, onDone) {
    var s = doc.createElement('script');
    s.async = false;               // keeps the list order
    s.onload = onDone;
    s.onerror = onDone;
    s.src = src;
    doc.head.appendChild(s);
    return s;
  }

  // Loads modes/<id>.js (unless it already registered) and modes/<id>.check.js for
  // each id in Nextbook.modes. Calls done() once every script has loaded or failed.
  function loadModes(done) {
    var ids = Array.isArray(Nextbook.modes) ? Nextbook.modes.slice() : [];
    var left = 0;
    var finished = false;
    var guard = null;

    function finish() {
      if (finished) return;
      finished = true;
      if (guard !== null) { try { clearTimeout(guard); } catch (e) { /* ignore */ } }
      done();
    }
    function one() { if (--left === 0) finish(); }

    ids.forEach(function (id) {
      if (!validId(id)) {
        warn('nextbook: "' + String(id) + '" in the mode list is not a usable id, so it is skipped.');
        return;
      }
      var known = Object.prototype.hasOwnProperty.call(Nextbook.modeDefs, id);
      var wants = known ? 1 : 2;   // the mode (unless already here) and its check
      left += wants;
      if (!known) {
        loadScript('modes/' + id + '.js', function () {
          if (!Nextbook.modeDefs[id]) Nextbook.missing(id);
          one();
        });
      }
      loadScript('modes/' + id + '.check.js', one);
    });

    if (left === 0) finish();
    else guard = setTimeout(finish, 15000); // a script that never answers must not hold the app
  }

  function line(text, id) {
    return Nextbook.h('p', { id: id, class: 'nb-line' }, [text]);
  }

  // Draws the page, then loads the modes. Safe to call twice.
  function boot() {
    if (booted) return;
    booted = true;

    var root = doc.getElementById('app');
    var slice = Nextbook.data.get('slice');
    if (root) {
      while (root.firstChild) root.removeChild(root.firstChild);
      root.appendChild(line(slice ? Nextbook.strings.shelfLoaded : Nextbook.strings.missingData, 'nb-status'));
      root.appendChild(line('', 'nb-modes'));
    }

    loadModes(function () {
      var box = doc.getElementById('nb-modes');
      if (box) {
        box.textContent = Nextbook.modes.length
          ? Nextbook.strings.modesLoaded + Nextbook.modes.join(', ')
          : Nextbook.strings.noModes;
      }
      if (Nextbook.missingIds.length) {
        if (root) root.appendChild(line(Nextbook.strings.missingMode, 'nb-missing'));
      }
    });
  }

  Nextbook.shell = { boot: boot, loadModes: loadModes };

  // The shell is last in the page, but a build may load it earlier.
  if (doc && typeof doc.getElementById === 'function') {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(window);
