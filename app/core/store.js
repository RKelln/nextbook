'use strict';
// Two shelves in localStorage, never mixed. A shelf never leaves this browser.
// Stub for T0.1; the real work is T2.7 and T2.8.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  var PREFIX = 'nb:';

  Nextbook.store = Nextbook.store || {
    get: function (key) {
      try {
        var raw = window.localStorage.getItem(PREFIX + String(key));
        return raw === null ? null : JSON.parse(raw);
      } catch (e) { return null; }         // private mode, a full disk, broken JSON
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(PREFIX + String(key), JSON.stringify(value));
        return true;
      } catch (e) { return false; }
    },
    remove: function (key) {
      try { window.localStorage.removeItem(PREFIX + String(key)); return true; }
      catch (e) { return false; }
    }
  };
})(window);
