'use strict';
// Ported from searchdesk/checks/run.js (MIT, same author).
// Runs one mode's checks with no page. Works two ways:
//   node tools/check-mode.js <id> | --all [--dir <folder>]
//   osascript -l JavaScript tools/check-mode.js <id>          (from the repo root; see tools/check.sh)
// --all on its own checks every mode app/modes/list.js lists. With --dir, --all checks every
// *.js in that folder except the *.check.js files, in name order, because a folder of modes
// (any folder you name) is not in the app's manifest.
// Order: the pure core files, then the data files that are there (including workshop.js, so a
// workshop copy behaves the same), then the manifest, the mode file and its check file. Then
// Nextbook.runModeChecks, plus the rules the browser does not have: a mode file that does
// anything when it loads except call Nextbook.mode({...}) fails, and so does a mode that
// registers itself any other way.
// Exit code: 0 all passed, 1 a check failed, 2 STOP (could not run). This is tooling, not a mode, so the indirect
// eval used in the JXA branch is fine here.

var IS_NODE = typeof process !== 'undefined' && !!process.versions && !!process.versions.node;
// The order app/index.html uses, which is what makes a workshop copy behave the same here.
// core/slice.js joins because runModeChecks needs Nextbook.pool.load(); it is pure too and
// touches no page.
var CORE = ['app/core/base.js', 'app/core/slice.js', 'app/core/score.js', 'app/core/reason.js', 'app/core/links.js',
  'app/core/contract.js', 'app/core/seam.js', 'app/core/store.js'];
var DATA = ['slice', 'tags', 'practice', 'found', 'events', 'workshop']; // app/data/<name>.js, when it is there
var MODES = 'app/modes';
var MANIFEST = 'app/modes/list.js';
var ID_RE = /^[a-z]+(-[a-z]+)*$/; // same rule as tools/check.sh and docs/CONTRACT.md section 2

// The console a mode sees. It is made inside the context, out of the context's own functions,
// so a mode cannot walk console.log.constructor back to the host's process. Its lines are read
// out as JSON: data only, never a host object.
var CONSOLE_BOOT = [
  'var __nbConsoleLines = [];',
  'function __nbConsoleLine(kind) {',
  '  return function () {',
  '    var parts = [];',
  '    for (var i = 0; i < arguments.length; i++) {',
  '      var a = arguments[i];',
  '      try { parts.push(typeof a === "string" ? a : JSON.stringify(a)); }',
  '      catch (e) { parts.push(String(a)); }',
  '    }',
  '    __nbConsoleLines.push(kind + " " + parts.join(" "));',
  '  };',
  '}',
  'var console = { log: __nbConsoleLine("log"), warn: __nbConsoleLine("warn"),',
  '  error: __nbConsoleLine("error"), info: __nbConsoleLine("info"), debug: __nbConsoleLine("debug") };'
].join('\n');

// ---- the parts that differ between node and JXA --------------------------------------------------
function makeHost() {
  if (IS_NODE) {
    var fs = require('fs'), path = require('path'), vm = require('vm');
    var ctx = null;
    return {
      root: function () { return path.resolve(__dirname, '..'); },
      read: function (file) { return fs.readFileSync(file, 'utf8'); },
      exists: function (file) { return fs.existsSync(file); },
      // The real path, so a symlink or a ../ cannot pass for a folder in this repo.
      realpath: function (file) {
        try { return fs.realpathSync(file); } catch (e) { return path.resolve(file); }
      },
      list: function (dir) { return fs.readdirSync(dir).sort(); },
      print: function (line) { console.log(line); },
      exit: function (code) { process.exitCode = code; },
      // A page-less world: the context's global object is `window`, with a console from inside.
      newWorld: function () {
        var w = {};
        w.window = w;
        ctx = vm.createContext(w);
        vm.runInContext(CONSOLE_BOOT, ctx, { filename: 'nextbook-console.js' });
        return w;
      },
      // The console lines, as plain strings. JSON in, JSON out: the host never hands the
      // context a function and never takes one back.
      consoleLines: function () {
        if (!ctx) return [];
        try {
          var json = vm.runInContext('JSON.stringify(__nbConsoleLines)', ctx,
            { filename: 'nextbook-console-read.js' });
          vm.runInContext('__nbConsoleLines.length = 0;', ctx);
          var lines = JSON.parse(json);
          return Array.isArray(lines) ? lines : [];
        } catch (e) { return []; }
      },
      evalFile: function (src, file) { vm.runInContext(src, ctx, { filename: file }); }
    };
  }
  // JXA (osascript -l JavaScript). Unverified on a Mac until T7.1; kept small on purpose.
  ObjC.import('Foundation');
  ObjC.import('stdlib');
  return {
    root: function () { return ObjC.unwrap($.NSFileManager.defaultManager.currentDirectoryPath); },
    read: function (file) { return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(file), $.NSUTF8StringEncoding, null)); },
    exists: function (file) { return $.NSFileManager.defaultManager.fileExistsAtPath($(file)); },
    realpath: function (file) {
      return ObjC.unwrap($.NSString.stringWithString($(file)).stringByResolvingSymlinksInPath);
    },
    list: function (dir) {
      var names = ObjC.unwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError($(dir), null)) || [];
      return names.map(function (n) { return ObjC.unwrap(n); });
    },
    print: function (line) { $.NSFileHandle.fileHandleWithStandardOutput.writeData($(line + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); },
    exit: function (code) { $.exit(code); },
    newWorld: function () { globalThis.window = globalThis; return globalThis; },
    consoleLines: function () { return []; },
    evalFile: function (src) { (0, eval)(src); } // indirect eval runs in the global scope
  };
}

// ---- the one rule the browser does not have -------------------------------------------------------
// A mode file does nothing when it loads except call Nextbook.mode({...}) (CONTRACT.md section 2).
// The file is read the way the browser scans it: comments and the contents of quoted strings are blanked
// out, so a comment or a sentence is not code. What is left outside the one call must be nothing but
// whitespace, semicolons and dead string literals such as 'use strict'.
function spaces(n) { return new Array(n + 1).join(' '); }

function lineOf(text, at) {
  var n = 1;
  for (var i = 0; i < at && i < text.length; i++) if (text.charAt(i) === '\n') n++;
  return n;
}

function snippet(src, at) {
  var start = at, end = at;
  while (start > 0 && src.charAt(start - 1) !== '\n') start--;
  while (end < src.length && src.charAt(end) !== '\n') end++;
  var line = String(src.slice(start, end)).replace(/^\s+|\s+$/g, '');
  return '"' + (line.length > 60 ? line.slice(0, 59) + '\u2026' : line) + '"';
}

// The close of the bracket opened at `open`, or -1 when the file cannot be read that way.
function matchClose(text, open) {
  var stack = [], pairs = { ')': '(', '}': '{', ']': '[' };
  for (var i = open; i < text.length; i++) {
    var c = text.charAt(i);
    if (c === '(' || c === '{' || c === '[') stack.push(c);
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== pairs[c]) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

function modeCallRanges(text) {
  var out = [], re = /Nextbook\s*\.\s*mode\s*\(/g, m;
  while ((m = re.exec(text))) {
    var open = m.index + m[0].length - 1;
    var close = matchClose(text, open);
    if (close < 0) return [];
    out.push([m.index, close + 1]);
    re.lastIndex = close + 1;
  }
  return out;
}

// The first character that is real code: not whitespace, not a semicolon, not a whole quoted string.
function firstCode(text) {
  var i = 0, n = text.length;
  while (i < n) {
    var c = text.charAt(i);
    if (/\s/.test(c) || c === ';') { i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < n && text.charAt(i) !== c) i++;
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

function outsideResults(strip, src) {
  if (typeof strip !== 'function') return [];
  var text = strip(src);
  var ranges = modeCallRanges(text);
  var out = [];

  // No call at all: the mode still registered (runOne only gets here with a def), so it did it
  // some other way: `var m = Nextbook.mode; m({...})`, Nextbook['mode'](...), modeDefs[id] = ...,
  // mode.call(...). Never skip the rule quietly.
  if (!ranges.length) {
    out.push({ ok: false, msg: 'I could not see the Nextbook.mode({...}) call in this file. ' +
      'A mode registers itself with that call, and nothing else.' });
    return out;
  }

  // More than one call registers more than one mode, and the app shows only what it loaded last.
  if (ranges.length > 1) {
    out.push({ ok: false, msg: 'This file calls Nextbook.mode({...}) ' + ranges.length + ' times; ' +
      'the second call is on line ' + lineOf(src, ranges[1][0]) + '. A mode file registers exactly one mode.' });
  }

  var left = text;
  ranges.forEach(function (r) { left = left.slice(0, r[0]) + spaces(r[1] - r[0]) + left.slice(r[1]); });
  var at = firstCode(left);
  if (at < 0) {
    if (ranges.length === 1) {
      out.push({ ok: true, msg: 'The file does nothing when it loads except call Nextbook.mode({...}).' });
    }
  } else {
    out.push({ ok: false, msg: 'There is code outside the one Nextbook.mode({...}) call, on line ' + lineOf(src, at) +
      ': ' + snippet(src, at) + '. A mode file does nothing else when it loads. Put it in logic, or in choose.' });
  }
  return out;
}

// ---- arguments ------------------------------------------------------------------------------------
function parseArgs(args) {
  var out = { id: '', all: false, dir: '', bad: '' };
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === '--all') out.all = true;
    else if (a === '--dir') {
      if (i + 1 >= args.length || args[i + 1].charAt(0) === '-') {
        out.bad = '--dir needs a folder, for example: --dir <folder>';
        break;
      }
      out.dir = args[++i];
    } else if (a.indexOf('--dir=') === 0) {
      out.dir = a.slice(6);
      if (!out.dir) { out.bad = '--dir needs a folder, for example: --dir <folder>'; break; }
    } else if (a.charAt(0) === '-') {
      out.bad = 'I do not know the option "' + a + '". Use a mode id, --all, or --dir <folder>.';
      break;
    } else if (out.id) {
      out.bad = 'Give one mode id.';
      break;
    } else out.id = a;
  }
  if (!out.bad && out.all && out.id) out.bad = 'Use either a mode id or --all, not both.';
  if (!out.bad && !out.all && !out.id) {
    out.bad = 'Give the mode id: lowercase letters a-z and hyphens, for example "more-by", or --all.';
  }
  return out;
}

// ---- the run --------------------------------------------------------------------------------------
function main(args, host) {
  // Throwing out of main is how a STOP stops in both hosts: process.exitCode in node does not.
  function stop(msg) { throw { stop: 'STOP: ' + msg }; }

  var opts = parseArgs(args);
  if (opts.bad) return stop(opts.bad);
  if (opts.id && !ID_RE.test(opts.id)) {
    return stop('The mode id must use only the letters a-z and hyphens, for example "more-by".');
  }

  var root = host.root();
  function abs(rel) { return rel.charAt(0) === '/' ? rel : root + '/' + rel; }

  // The folder has to be in this repo, by its real path: --dir ../outside and an absolute path
  // both fail the same way a missing folder does.
  var dirRel = (opts.dir ? opts.dir.replace(/\/+$/, '') : MODES) || MODES;
  if (!host.exists(abs(dirRel))) return stop('I cannot find the folder ' + dirRel + '. It has to be a folder in this repo.');
  var realRoot = String(host.realpath(root)).replace(/\/+$/, '');
  var realDir = String(host.realpath(abs(dirRel))).replace(/\/+$/, '');
  if (realDir !== realRoot && realDir.indexOf(realRoot + '/') !== 0) {
    return stop('I cannot find the folder ' + dirRel + '. It has to be a folder in this repo.');
  }
  for (var i = 0; i < CORE.length; i++) {
    if (!host.exists(abs(CORE[i]))) return stop('I cannot find ' + CORE[i] + '.');
  }

  var world = host.newWorld();
  try {
    CORE.forEach(function (f) { host.evalFile(host.read(abs(f)), abs(f)); });
  } catch (e) {
    return stop('A core file would not load: ' + (e && e.message ? e.message : String(e)));
  }
  var Nextbook = world.Nextbook;
  if (!Nextbook || typeof Nextbook.runModeChecks !== 'function') {
    return stop('The core did not load: Nextbook.runModeChecks is missing.');
  }

  DATA.forEach(function (name) {
    var rel = 'app/data/' + name + '.js';
    if (!host.exists(abs(rel))) return; // a data file that is missing is fine; found.js and workshop.js often are
    try { host.evalFile(host.read(abs(rel)), abs(rel)); }
    catch (e) { stop(rel + ' would not load: ' + (e && e.message ? e.message : String(e))); }
  });

  // The manifest. --all without --dir is the one run that needs it; a single mode and a folder
  // of modes only read it to warn that the app will not show a mode.
  var listed = [];
  if (opts.all && !opts.dir) {
    if (!host.exists(abs(MANIFEST))) {
      return stop(MANIFEST + ' is missing, so there is nothing to run. In the app, that file is the list of modes.');
    }
    try { host.evalFile(host.read(abs(MANIFEST)), abs(MANIFEST)); }
    catch (e) { return stop(MANIFEST + ' would not load: ' + (e && e.message ? e.message : String(e))); }
    if (!Array.isArray(Nextbook.modes)) {
      return stop(MANIFEST + ' did not set Nextbook.modes to a list, so there is nothing to run. ' +
        'In the app, that file is the list of modes.');
    }
    listed = Nextbook.modes.slice();
    if (!listed.length) {
      host.print('OK --all: no modes are listed in ' + MANIFEST + ' yet, so there was nothing to check.');
      return;
    }
  } else if (!opts.all && host.exists(abs(MANIFEST))) {
    try { host.evalFile(host.read(abs(MANIFEST)), abs(MANIFEST)); }
    catch (e) { return stop(MANIFEST + ' would not load: ' + (e && e.message ? e.message : String(e))); }
    listed = Array.isArray(Nextbook.modes) ? Nextbook.modes.slice() : [];
  }

  var ids;
  if (opts.all && opts.dir) {
    // Every mode file in the folder, in name order. The *.check.js files are checks, not modes.
    ids = host.list(abs(dirRel)).filter(function (name) {
      return /\.js$/.test(name) && !/\.check\.js$/.test(name);
    }).map(function (name) { return name.slice(0, -3); }).sort();
    if (!ids.length) {
      host.print('OK --all: there are no mode files in ' + dirRel + ' yet, so there was nothing to check.');
      return;
    }
  } else if (opts.all) {
    ids = listed.map(String);
  } else {
    ids = [opts.id];
  }

  // Every id, including the manifest's, has to look like a mode id before it becomes a path.
  ids.forEach(function (id) {
    if (!ID_RE.test(id)) {
      stop('The mode id must use only the letters a-z and hyphens, for example "more-by".');
    }
  });

  var pool = null, practice = null;
  try { pool = typeof Nextbook.pool === 'object' && typeof Nextbook.pool.load === 'function' ? Nextbook.pool.load() : null; }
  catch (e) { pool = null; } // runModeChecks turns that into the plain sentence about the list
  try { practice = typeof Nextbook.data === 'object' && typeof Nextbook.data.get === 'function' ? Nextbook.data.get('practice') : null; }
  catch (e) { practice = null; }

  var total = { pass: 0, fail: 0, bad: 0, ran: 0 };
  var strip = Nextbook.contract && typeof Nextbook.contract.strip === 'function' ? Nextbook.contract.strip : null;
  var scan = Nextbook.contract && typeof Nextbook.contract.scan === 'function' ? Nextbook.contract.scan : null;

  function runOne(id) {
    var modeRel = dirRel + '/' + id + '.js';
    var checkRel = dirRel + '/' + id + '.check.js';

    // In --all one broken mode must not hide the rest, but it still gets its own summary line.
    function failedEarly(msg) {
      host.print('FAIL ' + msg);
      host.print('FAILED ' + id + ': 0 passed, 1 failed');
      return { pass: 0, fail: 1, ran: false };
    }

    if (!host.exists(abs(modeRel))) {
      if (!opts.all) return stop('I cannot find ' + modeRel + '.');
      return failedEarly('The app lists "' + id + '" but there is no ' + modeRel + '.');
    }
    if (!host.exists(abs(checkRel))) {
      if (!opts.all) return stop('I cannot find ' + checkRel + '. Write it first: docs/CONTRACT.md section 6.');
      return failedEarly('The app lists "' + id + '" but there is no ' + checkRel + '.');
    }

    try {
      host.evalFile(host.read(abs(modeRel)), abs(modeRel));
      host.evalFile(host.read(abs(checkRel)), abs(checkRel));
    } catch (e) {
      var why = 'A file would not load: ' + (e && e.message ? e.message : String(e));
      if (!opts.all) return stop(why);
      return failedEarly(modeRel + ': ' + why);
    }

    // The mode's own console words come back as data; only the app's own warnings are repeated.
    host.consoleLines().forEach(function (line) {
      if (/^(warn|error) /.test(line)) host.print('WARNING: ' + line.replace(/^\w+\s+/, ''));
    });

    var def = Nextbook.modeDefs ? Nextbook.modeDefs[id] : null;
    if (!def) {
      var msg = 'The file ' + modeRel + ' did not register the id "' + id + '". End it with Nextbook.mode({ id: \'' + id + '\', ... }).';
      if (!opts.all) return stop(msg);
      return failedEarly(msg);
    }

    if (!opts.all && listed.indexOf(id) === -1) {
      host.print('WARNING: This mode is not in ' + MANIFEST + ', so the app will not show it.');
    }

    var pass = 0, fail = 0;
    function say(ok, msg) {
      if (ok) pass++; else fail++;
      host.print((ok ? 'PASS ' : 'FAIL ') + msg);
    }

    outsideResults(strip, host.read(abs(modeRel))).forEach(function (r) { say(r.ok, r.msg); });

    // The functions were scanned by runModeChecks; this reads the whole file as well, so code
    // in the call's argument but in no function (Nextbook.mode((eval('1'), {...}))) is seen.
    if (scan) {
      var covered = typeof Nextbook.contract.scanFeature === 'function'
        ? Nextbook.contract.scanFeature(def).map(function (f) { return f.word; }) : [];
      var elsewhere = scan(host.read(abs(modeRel))).filter(function (f) {
        return covered.indexOf(f.word) === -1;
      });
      if (elsewhere.length) {
        elsewhere.forEach(function (f) { say(false, 'The file scan: ' + f.message); });
      } else {
        say(true, 'The file scan: no words a mode may not use in the file.');
      }
    }

    try {
      var run = Nextbook.runModeChecks(id, {
        mode: def,
        check: Nextbook.checks ? Nextbook.checks[id] : null,
        pool: pool,
        practice: practice
      });
      run.results.forEach(function (r) { say(r.ok, r.msg); });
    } catch (e) {
      say(false, 'The checks stopped with an error: ' + (e && e.message ? e.message : String(e)));
    }

    host.print((fail ? 'FAILED' : 'OK') + ' ' + id + ': ' + pass + ' passed, ' + fail + ' failed');
    return { pass: pass, fail: fail, ran: true };
  }

  ids.forEach(function (id) {
    var one = runOne(String(id));
    if (!one) return;
    total.pass += one.pass;
    total.fail += one.fail;
    if (one.ran) total.ran++;
    if (!one.ran) total.bad++;
  });

  if (!opts.all) { host.exit(total.fail ? 1 : 0); return; }

  // One line other tools can read, the same shape as one mode's: it starts OK or FAILED.
  var head = (total.fail ? 'FAILED' : 'OK') + ' --all: ' + ids.length +
    (ids.length === 1 ? ' mode' : ' modes') + ', ' + total.pass + ' passed, ' + total.fail + ' failed';
  host.print(head);
  host.exit(total.fail ? 1 : 0);
}

// osascript calls run(argv); node calls it below.
function run(argv) {
  var host = makeHost();
  try {
    main(Array.prototype.map.call(argv, String), host);
  } catch (e) {
    if (e && e.stop) { host.print(e.stop); host.exit(2); return; }
    host.print('STOP: The check stopped with an error: ' + (e && e.message ? e.message : String(e)));
    host.exit(2);
  }
}
if (IS_NODE) run(process.argv.slice(2));
