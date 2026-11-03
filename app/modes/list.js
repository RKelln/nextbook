'use strict';
// The modes the app shows, in the order it shows them. This file is the manifest and
// nothing else: one line per mode, and the mode itself lives in app/modes/<id>.js.
// The menu of ideas is in docs/modes/, for people and their agents, not for the app.
//
// The starter ships no menu mode on purpose (D16); T4.1 adds the example:
//   Nextbook.modes = ['more-by'];
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  Nextbook.modes = [];
})(window);
