'use strict';
// The shell: the hash router, the find screen (T3.2, T3.3a), the shelf screen (T3.1) and the
// self-test screen (T3.4).
//
//   #find      the default screen: the ways of choosing books in this copy
//   #shelf     the shelf in use, adding books, export, import, friends' shelves
//   #selftest  what this copy has, and the app's own checks run in the browser
//
// Every element is built with Nextbook.h, so catalogue text, an imported file and a typed
// title are only ever text (AGENTS.md, "Safe by construction"). Every user-facing word is in
// Nextbook.strings, added at the bottom of this file; a key another file already set wins.
// The shelf itself lives in core/store.js; nothing here reaches the network.
(function (window) {
  var Nextbook = window.Nextbook = window.Nextbook || {};
  var doc = window.document;

  var booted = false;
  var state = {
    store: null,
    pool: null,
    addQuery: '',
    byName: false,
    message: '',
    route: '',
    exportText: '',
    foundCleared: false,
    // the find screen
    modeId: '',
    modeReady: false,
    inputs: {},
    bookQuery: {},
    seed: 1,
    model: blankModel(),  // the pasted answer, if there is one
    words: {}             // per facets input: the pasted words, the prompt and its answer
  };

  // ---- Words ---------------------------------------------------------------------------------
  // The shell's own keys join the one table in core/base.js. An existing key is left alone,
  // so a later wording change in the table reaches the page without touching this file.
  function addStrings(table) {
    Nextbook.strings = Nextbook.strings || {};
    Object.keys(table).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(Nextbook.strings, k)) Nextbook.strings[k] = table[k];
    });
  }

  function t(key, vars) { return Nextbook.t(key, vars); }

  // ---- Small helpers -------------------------------------------------------------------------
  function h(tag, attrs) {
    return Nextbook.h.apply(null, arguments);
  }

  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function p(text, cls, extra) {
    var attrs = { class: cls || 'nb-text' };
    if (extra) Object.keys(extra).forEach(function (k) { attrs[k] = extra[k]; });
    return h('p', attrs, text);
  }

  function button(test, label, onClick, cls) {
    return h('button', {
      type: 'button',
      class: cls || 'nb-button',
      'data-test': test,
      on: { click: onClick }
    }, label);
  }

  function nowText() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  function todayText() {
    var stamp = nowText();
    return stamp ? stamp.slice(0, 10) : 'today';
  }

  function isWorkshop() {
    try { return Nextbook.workshop() === true; } catch (e) { return false; }
  }

  function countLine(n, oneKey, manyKey, vars) {
    var all = { n: n };
    if (vars) Object.keys(vars).forEach(function (k) { all[k] = vars[k]; });
    return t(n === 1 ? oneKey : manyKey, all);
  }

  function dateOnly(value) {
    var s = typeof value === 'string' ? value : '';
    var cut = s.indexOf('T');
    return cut === -1 ? s : s.slice(0, cut);
  }

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  // ---- The hash router -----------------------------------------------------------------------
  var ROUTES = ['find', 'shelf', 'selftest'];

  function routeName() {
    var raw = '';
    try { raw = String(window.location.hash || ''); } catch (e) { raw = ''; }
    var name = raw.replace(/^#/, '').split('?')[0].toLowerCase();
    return ROUTES.indexOf(name) === -1 ? 'find' : name;
  }

  function go(name) {
    var route = ROUTES.indexOf(name) === -1 ? 'find' : name;
    try {
      window.location.hash = '#' + route;
      if (routeName() === route) render();
    } catch (e) {
      render();
    }
  }

  // ---- The pool, and one book ------------------------------------------------------------------
  function poolResult() {
    if (!state.pool) {
      try { state.pool = Nextbook.pool.load(); } catch (e) {
        state.pool = { ok: false, message: t('missingData'), works: [], byId: {}, byGroupKey: {}, facets: {} };
      }
    }
    return state.pool;
  }

  function workFor(entry) {
    var pool = poolResult();
    if (!entry) return null;
    if (entry.id && pool.byId && pool.byId[entry.id]) return pool.byId[entry.id];
    if (entry.groupKey && pool.byGroupKey && pool.byGroupKey[entry.groupKey]) return pool.byGroupKey[entry.groupKey];
    if (entry.title) {
      try { return Nextbook.pool.match(entry.title, entry.author); } catch (e) { return null; }
    }
    return null;
  }

  function keyForWork(work) {
    if (!work) return '';
    return 'w:' + (work.groupKey || work.id || '');
  }

  function onShelfWork(work) {
    if (!work || !state.store) return false;
    var key = keyForWork(work);
    var entries = [];
    try { entries = state.store.shelf(); } catch (e) { entries = []; }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e) continue;
      if (e.key === key) return true;
      if (work.groupKey && e.groupKey === work.groupKey) return true;
      if (work.id && e.id === work.id) return true;
    }
    return false;
  }

  function library() {
    var slice = Nextbook.data.get('slice');
    return isObj(slice) && isObj(slice.library) ? slice.library : {};
  }

  function linkFor(work) {
    if (!work) return '';
    try { return Nextbook.linkFor(work, library()) || ''; } catch (e) { return ''; }
  }

  // "Subjects: a, b, c." from the work's own facets, at most five. A typed book that matched
  // a work shows these too, which is how a person sees that it was linked.
  function subjectsLine(work) {
    if (!work || !Array.isArray(work.facets)) return '';
    var labels = [], seen = {};
    for (var i = 0; i < work.facets.length && labels.length < 5; i++) {
      var facet = work.facets[i];
      var label = '';
      try { label = Nextbook.pool.labelOf(facet); } catch (e) { label = ''; }
      if (!label || seen[label]) continue;
      seen[label] = true;
      labels.push(label);
    }
    return labels.length ? t('subjectsLine', { list: labels.join(', ') }) : '';
  }

  function byLine(work, entry) {
    var author = (entry && entry.author) || (work && work.author) || '';
    var year = work && work.year ? work.year : '';
    if (!author) return '';
    return year ? t('byLineYear', { author: author, year: year }) : t('byLine', { author: author });
  }

  // ---- The shelf screen -----------------------------------------------------------------------
  function practiceBanner() {
    var store = state.store;
    if (!store) return null;
    var wrap = h('div', { class: 'nb-banner', 'data-test': 'practice-banner' });
    var which = 'practice';
    try { which = store.which(); } catch (e) { which = 'practice'; }

    if (which === 'practice') {
      wrap.appendChild(p(t('practiceBanner'), 'nb-banner-text'));
      // Reset stays in every copy: the banner promises it, so the button must be there. A
      // workshop copy replaces only the switch to the own shelf, with the sentence from T3.1.
      var actions = h('div', { class: 'nb-banner-actions' },
        button('practice-reset', t('resetButton'), resetPractice));
      if (isWorkshop()) {
        wrap.appendChild(p(t('practiceOnly'), 'nb-banner-note'));
      } else {
        actions.appendChild(button('shelf-use-own', t('useOwn'), function () {
          try { store.use('own'); } catch (e) { /* stays on practice */ }
          state.message = '';
          render();
        }));
      }
      wrap.appendChild(actions);
    } else {
      wrap.appendChild(p(t('ownNow'), 'nb-banner-text'));
      wrap.appendChild(h('div', { class: 'nb-banner-actions' },
        button('shelf-use-practice', t('usePractice'), function () {
          try { store.use('practice'); } catch (e) { /* stays on own */ }
          state.message = '';
          render();
        })
      ));
    }
    return wrap;
  }

  function resetPractice() {
    var yes = false;
    try {
      yes = typeof window.confirm === 'function' ? window.confirm(t('resetAsk')) === true : false;
    } catch (e) {
      yes = false;
    }
    if (!yes) return;
    try {
      state.store.practiceReset();
      state.message = t('resetDone');
    } catch (e) {
      state.message = t('shelfBroken');
    }
    render();
  }

  function selectField(test, options, value, label, onChange) {
    var nodes = options.map(function (o) {
      return h('option', { value: o.value }, o.label);
    });
    // The options are children of the select, so base.js can set the chosen value after
    // they exist. A value set before its options would silently show the first one.
    return h('select', {
      class: 'nb-select',
      'data-test': test,
      'aria-label': label,
      value: value === null || value === undefined ? '' : String(value),
      on: { change: function (ev) { onChange(String(ev.target.value || '')); } }
    }, nodes);
  }

  function stateOptions() {
    return [
      { value: 'want', label: t('stateWant') },
      { value: 'reading', label: t('stateReading') },
      { value: 'read', label: t('stateRead') },
      { value: 'stopped', label: t('stateStopped') }
    ];
  }

  function ratingOptions() {
    return [
      { value: '', label: t('ratingNone') },
      { value: 'loved', label: t('ratingLoved') },
      { value: 'liked', label: t('ratingLiked') },
      { value: 'ok', label: t('ratingOk') },
      { value: 'not-for-me', label: t('ratingNot') }
    ];
  }

  function titleNode(work, entry, index) {
    var title = (entry && entry.title) || (work && work.title) || t('untitledBook');
    // A typed book has no work. The entry itself still carries a title and an author, so the
    // link falls back to the library's search for those two words, as the page promises.
    var link = linkFor(work || entry);
    if (!link) return h('strong', { class: 'nb-book-title' }, title);
    return h('a', {
      class: 'nb-book-title',
      href: link,
      'data-test': 'shelf-link-' + index
    }, title);
  }

  function shelfRow(entry, index) {
    var work = workFor(entry);
    var li = h('li', { class: 'nb-book', 'data-book': entry.key || '' });
    var head = h('div', { class: 'nb-book-head' });
    head.appendChild(titleNode(work, entry, index));
    var line = byLine(work, entry);
    if (line) head.appendChild(p(line, 'nb-by'));
    var subjects = subjectsLine(work);
    if (subjects) head.appendChild(p(subjects, 'nb-subjects'));
    if (!work) head.appendChild(p(t('notInList'), 'nb-note'));
    else if (work.found && work.found.query) head.appendChild(p(t('foundFor', { words: work.found.query }), 'nb-note'));

    var controls = h('div', { class: 'nb-controls' });
    controls.appendChild(h('label', { class: 'nb-field' },
      h('span', { class: 'nb-label' }, t('stateLabel')),
      selectField('shelf-state-' + index, stateOptions(), entry.state || 'want', t('stateLabel'),
        function (value) {
          try { state.store.setState(entry.key, value, nowText()); } catch (e) { /* nothing changed */ }
          render();
        })
    ));
    controls.appendChild(h('label', { class: 'nb-field' },
      h('span', { class: 'nb-label' }, t('ratingLabel')),
      selectField('shelf-rating-' + index, ratingOptions(), entry.rating || '', t('ratingLabel'),
        function (value) {
          try { state.store.setRating(entry.key, value || null, nowText()); } catch (e) { /* nothing changed */ }
          render();
        })
    ));
    controls.appendChild(button('shelf-remove-' + index, t('removeButton'), function () {
      try {
        if (state.store.remove(entry.key)) state.message = t('removedBook', { title: entry.title || '' });
      } catch (e) {
        state.message = t('shelfBroken');
      }
      render();
    }, 'nb-button nb-button-quiet'));
    li.appendChild(head);
    li.appendChild(controls);
    return li;
  }

  function bookFromWork(work) {
    return {
      key: keyForWork(work),
      id: work.id === undefined ? null : work.id,
      groupKey: work.groupKey === undefined ? null : work.groupKey,
      title: work.title || '',
      author: work.author || '',
      state: 'want',
      rating: null,
      updated: nowText()
    };
  }

  function addFromWork(work, inList) {
    if (!work || !state.store) return;
    if (onShelfWork(work)) {
      state.message = t('alreadyThere');
      render();
      return;
    }
    try {
      state.store.add(bookFromWork(work));
      // A title-only add that found its one exact title says so, because the page would
      // otherwise look as if it had kept a typed book.
      state.message = inList
        ? t('addedBook', { title: work.title || '' }) + ' ' + t('foundInList')
        : t('addedBook', { title: work.title || '' });
    } catch (e) {
      state.message = t('shelfBroken');
    }
    render();
  }

  function shelfList() {
    var entries = [];
    try { entries = state.store ? state.store.shelf() : []; } catch (e) { entries = []; }
    if (!entries.length) return p(t('shelfEmpty'), 'nb-empty');
    var list = h('ul', { class: 'nb-books', 'data-test': 'shelf-list' });
    entries.forEach(function (entry, i) { list.appendChild(shelfRow(entry, i + 1)); });
    return list;
  }

  // ---- Add a book ------------------------------------------------------------------------------
  function addResults(box, text) {
    clear(box);
    var query = String(text || '').trim();
    if (!query) {
      box.appendChild(p(t('addHint'), 'nb-hint'));
      return;
    }
    var found = [];
    try { found = Nextbook.pool.search(query) || []; } catch (e) { found = []; }
    if (!found.length) box.appendChild(p(t('addNoResults'), 'nb-hint'));
    var limit = Math.min(found.length, 12);
    if (found.length) {
      var list = h('ul', { class: 'nb-books nb-books-compact' });
      for (var i = 0; i < limit; i++) {
        var work = found[i];
        var li = h('li', { class: 'nb-book', 'data-book': work.id || '' });
        var head = h('div', { class: 'nb-book-head' });
        var link = linkFor(work);
        head.appendChild(link
          ? h('a', { class: 'nb-book-title', href: link }, work.title || '')
          : h('strong', { class: 'nb-book-title' }, work.title || ''));
        var line = byLine(work, null);
        if (line) head.appendChild(p(line, 'nb-by'));
        var subjects = subjectsLine(work);
        if (subjects) head.appendChild(p(subjects, 'nb-subjects'));

        var actions = h('div', { class: 'nb-controls' });
        if (onShelfWork(work)) actions.appendChild(p(t('onShelf'), 'nb-tag'));
        else actions.appendChild(button('add-result-' + (i + 1), t('addButton'), function (w) {
          return function () { addFromWork(w); };
        }(work), 'nb-button nb-button-small'));
        li.appendChild(head);
        li.appendChild(actions);
        list.appendChild(li);
      }
      box.appendChild(list);
      if (found.length > limit) box.appendChild(p(t('moreResults', { n: found.length - limit }), 'nb-hint'));
    }
  }

  function clearField(id, placeholder, label, test) {
    return h('label', { class: 'nb-field' },
      h('span', { class: 'nb-label' }, label),
      h('input', {
        id: id,
        class: 'nb-input',
        type: 'text',
        placeholder: placeholder,
        'data-test': test,
        'aria-label': label,
        autocomplete: 'off'
      })
    );
  }

  function addPanel() {
    var wrap = h('section', { class: 'nb-panel', id: 'nb-add' });
    wrap.appendChild(h('h3', t('addHeading')));
    wrap.appendChild(p(t('addHelp'), 'nb-hint'));

    var results = h('div', { class: 'nb-results', id: 'nb-add-results', 'data-test': 'add-results' });

    var form = h('form', {
      class: 'nb-search',
      on: {
        submit: function (ev) {
          ev.preventDefault();
          addResults(results, state.addQuery);
        }
      }
    });
    var input = h('input', {
      id: 'nb-add-search',
      class: 'nb-input nb-input-search',
      type: 'search',
      placeholder: t('addPlaceholder'),
      'data-test': 'add-search',
      'aria-label': t('addPlaceholder'),
      autocomplete: 'off',
      value: state.addQuery,
      on: {
        input: function (ev) {
          state.addQuery = String(ev.target.value || '');
          addResults(results, state.addQuery);
        }
      }
    });
    form.appendChild(input);
    wrap.appendChild(form);
    wrap.appendChild(results);
    addResults(results, state.addQuery);

    var byName = h('div', { class: 'nb-byname' });
    if (!state.byName) {
      byName.appendChild(button('add-by-name', t('addByName'), function () {
        state.byName = true;
        render();
      }, 'nb-button nb-button-quiet'));
    } else {
      byName.appendChild(p(t('addByNameHelp'), 'nb-hint'));
      var nameForm = h('form', {
        class: 'nb-byname-form',
        on: {
          submit: function (ev) {
            ev.preventDefault();
            addTyped(titleInput.value, authorInput.value);
          }
        }
      });
      var titleInput = h('input', {
        id: 'nb-add-title',
        class: 'nb-input',
        type: 'text',
        placeholder: t('addTitle'),
        'data-test': 'add-title',
        'aria-label': t('addTitle'),
        autocomplete: 'off'
      });
      var authorInput = h('input', {
        id: 'nb-add-author',
        class: 'nb-input',
        type: 'text',
        placeholder: t('addAuthor'),
        'data-test': 'add-author',
        'aria-label': t('addAuthor'),
        autocomplete: 'off'
      });
      nameForm.appendChild(h('label', { class: 'nb-field' },
        h('span', { class: 'nb-label' }, t('addTitle')), titleInput));
      nameForm.appendChild(h('label', { class: 'nb-field' },
        h('span', { class: 'nb-label' }, t('addAuthor')), authorInput));
      nameForm.appendChild(button('add-name-submit', t('addNameSubmit'), function () {
        addTyped(titleInput.value, authorInput.value);
      }));
      byName.appendChild(nameForm);
    }
    wrap.appendChild(byName);

    return wrap;
  }

  // Every work whose title is exactly this title, as the list spells it. pool.match needs an
  // author, so a title typed on its own is looked up here instead of becoming a second copy.
  function worksWithTitle(title) {
    var found = [], want = Nextbook.norm(title), out = [];
    try { found = Nextbook.pool.search(title) || []; } catch (e) { found = []; }
    for (var i = 0; i < found.length; i++) {
      if (found[i] && Nextbook.norm(found[i].title) === want) out.push(found[i]);
    }
    return out;
  }

  // A book typed in: linked to a work in the list when the title and author match one, so it
  // gains the work's subjects and its library page; otherwise it is kept by its own key.
  // With no author, one exact title match is taken as that book; none or more than one keeps
  // the book as typed, because guessing between two books of the same name would be wrong.
  function addTyped(title, author) {
    var cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
    var cleanAuthor = String(author || '').replace(/\s+/g, ' ').trim();
    if (!cleanTitle) {
      state.message = t('addNeedTitle');
      render();
      return;
    }
    var work = null;
    var inList = false;
    if (cleanAuthor) {
      try { work = Nextbook.pool.match(cleanTitle, cleanAuthor); } catch (e) { work = null; }
    } else {
      var sameTitle = worksWithTitle(cleanTitle);
      if (sameTitle.length === 1) { work = sameTitle[0]; inList = true; }
    }
    if (work) { addFromWork(work, inList); return; }

    var key = 't:' + Nextbook.norm(cleanTitle) + '|' + Nextbook.norm(cleanAuthor);
    if (state.store) {
      var entries = [];
      try { entries = state.store.shelf(); } catch (e) { entries = []; }
      for (var i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i].key === key) {
          state.message = t('alreadyThere');
          render();
          return;
        }
      }
    }
    try {
      state.store.add({
        key: key,
        id: null,
        groupKey: null,
        title: cleanTitle,
        author: cleanAuthor,
        state: 'want',
        rating: null,
        updated: nowText()
      });
      state.message = t('addedTyped', { title: cleanTitle });
    } catch (e) {
      state.message = t('shelfBroken');
    }
    render();
  }

  // ---- Export, import, friends' shelves --------------------------------------------------------
  function download(text, name) {
    var url = null;
    try {
      if (typeof window.Blob === 'function' && window.URL && typeof window.URL.createObjectURL === 'function') {
        url = window.URL.createObjectURL(new window.Blob([text], { type: 'application/json' }));
        // The anchor is made with h like everything else; only its address is a property,
        // because h() allows a link to http(s) and a shelf file lives in this browser.
        var a = h('a', { class: 'nb-download' });
        a.href = url;
        a.download = name;
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        window.setTimeout(function () {
          try { window.URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
        }, 1000);
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  function exportPanel() {
    var wrap = h('section', { class: 'nb-panel', id: 'nb-export' });
    wrap.appendChild(h('h3', t('exportHeading')));
    wrap.appendChild(p(t('exportHelp'), 'nb-hint'));
    wrap.appendChild(h('div', { class: 'nb-banner-actions' },
      button('shelf-export', t('exportButton'), function () {
        var text = '';
        try { text = state.store.exportShelf(nowText()); } catch (e) {
          state.message = t('shelfBroken');
          render();
          return;
        }
        state.exportText = '';
        if (download(text, 'nextbook-shelf-' + todayText() + '.json')) {
          state.message = t('exportDone');
          render();
          return;
        }
        // No download in this browser: show the text, so the shelf can still be kept.
        state.exportText = text;
        state.message = t('exportCopy');
        render();
      })
    ));
    if (state.exportText) {
      wrap.appendChild(h('textarea', {
        class: 'nb-export-text',
        rows: 12,
        readonly: true,
        'aria-label': t('exportCopy'),
        'data-test': 'shelf-export-text'
      }, state.exportText));
    }
    return wrap;
  }

  function readChosen(input, done) {
    var file = input && input.files && input.files[0];
    if (!file) { done(null); return; }
    try {
      var reader = new window.FileReader();
      reader.onload = function () { done(String(reader.result || '')); };
      reader.onerror = function () { done(null); };
      reader.readAsText(file);
    } catch (e) {
      done(null);
    }
  }

  function reportImport(report) {
    if (!report) return t('importNoFile');
    if (report.error) return report.error;
    var said = t('importReport', { added: report.added, changed: report.changed, kept: report.kept });
    if (report.skipped) said += ' ' + t('importSkipped', { skipped: report.skipped });
    return said;
  }

  function importPanel() {
    var wrap = h('section', { class: 'nb-panel', id: 'nb-import' });
    wrap.appendChild(h('h3', t('importHeading')));
    wrap.appendChild(p(t('importHelp'), 'nb-hint'));
    var input = h('input', {
      class: 'nb-file',
      type: 'file',
      accept: '.json,application/json',
      'data-test': 'shelf-import-file',
      'aria-label': t('importChoose'),
      on: {
        change: function (ev) {
          var chosen = ev.target;
          readChosen(chosen, function (text) {
            if (text === null) { state.message = t('importNoFile'); render(); return; }
            var report = null;
            try { report = state.store.importShelf(text); } catch (e) { report = { error: t('shelfBroken') }; }
            state.message = reportImport(report);
            render();
          });
        }
      }
    });
    wrap.appendChild(h('label', { class: 'nb-field' },
      h('span', { class: 'nb-label' }, t('importChoose')), input));
    return wrap;
  }

  function friendsPanel() {
    var wrap = h('section', { class: 'nb-panel', id: 'nb-friends' });
    wrap.appendChild(h('h3', t('friendsHeading')));
    wrap.appendChild(p(t('friendsHelp'), 'nb-hint'));

    var nameInput = h('input', {
      id: 'nb-friend-name',
      class: 'nb-input',
      type: 'text',
      placeholder: t('friendsNamePlaceholder'),
      'data-test': 'friend-name',
      'aria-label': t('friendsNamePlaceholder'),
      autocomplete: 'off'
    });
    var fileInput = h('input', {
      class: 'nb-file',
      type: 'file',
      accept: '.json,application/json',
      'data-test': 'friend-file',
      'aria-label': t('friendsChoose')
    });
    wrap.appendChild(h('label', { class: 'nb-field' },
      h('span', { class: 'nb-label' }, t('friendsNamePlaceholder')), nameInput));
    wrap.appendChild(h('label', { class: 'nb-field' },
      h('span', { class: 'nb-label' }, t('friendsChoose')), fileInput));
    wrap.appendChild(button('friend-add', t('friendsAdd'), function () {
      readChosen(fileInput, function (text) {
        if (text === null) { state.message = t('importNoFile'); render(); return; }
        var result = null;
        try { result = state.store.addOther(text, nameInput.value); } catch (e) { result = { error: t('shelfBroken') }; }
        if (result && result.error) {
          state.message = result.error;
        } else {
          var name = String(nameInput.value || '').replace(/\s+/g, ' ').trim() || t('aFriend');
          state.message = countLine(result.added, 'friendsAddedOne', 'friendsAdded', { name: name, n: result.added });
        }
        render();
      });
    }));

    var shelves = [];
    try { shelves = state.store.others(); } catch (e) { shelves = []; }
    if (!shelves.length) {
      wrap.appendChild(p(t('friendsEmpty'), 'nb-empty'));
    } else {
      var list = h('ul', { class: 'nb-friends-list', 'data-test': 'friends-list' });
      shelves.forEach(function (shelf, i) {
        var li = h('li', { class: 'nb-friend' });
        li.appendChild(h('span', { class: 'nb-friend-name' }, shelf.name));
        li.appendChild(h('span', { class: 'nb-friend-count' },
          countLine(shelf.entries.length, 'bookCountOne', 'bookCount')));
        li.appendChild(button('friend-remove-' + (i + 1), t('friendsRemove'), function () {
          try {
            state.store.removeOther(shelf.name);
            state.message = t('friendsRemoved', { name: shelf.name });
          } catch (e) {
            state.message = t('shelfBroken');
          }
          render();
        }, 'nb-button nb-button-quiet'));
        list.appendChild(li);
      });
      wrap.appendChild(list);
    }
    return wrap;
  }

  // ---- The found notice ------------------------------------------------------------------------
  function firstFoundWords(found) {
    var works = Array.isArray(found.works) ? found.works : [];
    for (var i = 0; i < works.length; i++) {
      var w = works[i];
      if (isObj(w) && isObj(w.found) && typeof w.found.query === 'string' && w.found.query) return w.found.query;
    }
    return '';
  }

  function foundPanel() {
    if (state.foundCleared) return null;
    var found = Nextbook.data.get('found');
    if (!isObj(found) || !Array.isArray(found.works) || !found.works.length) return null;

    var wrap = h('div', { class: 'nb-found', 'data-test': 'found-notice' });
    var said = false;
    if (Array.isArray(found.searches)) {
      found.searches.forEach(function (search) {
        if (!isObj(search) || typeof search.query !== 'string' || !search.query) return;
        var n = typeof search.works === 'number' ? search.works : 0;
        if (n < 1) return;   // a search that added nothing needs no notice
        wrap.appendChild(p(n === 1
          ? t('booksFoundOne', { words: search.query })
          : t('booksFound', { n: n, words: search.query }), 'nb-found-line'));
        said = true;
      });
    }
    if (!said) {
      var total = found.works.length;
      var words = firstFoundWords(found);
      wrap.appendChild(p(total === 1
        ? t('booksFoundOne', { words: words })
        : t('booksFound', { n: total, words: words }), 'nb-found-line'));
    }
    wrap.appendChild(button('found-clear', t('foundClear'), function () {
      state.foundCleared = true;
      state.message = t('foundCleared');
      render();
    }, 'nb-button nb-button-quiet'));
    return wrap;
  }

  // ---- The find screen (T3.2) -----------------------------------------------------------------
  // The modes as cards, the chosen mode's inputs (every kind in CONTRACT.md section 4, remembered
  // in this browser), its result as cards or as an ordered path, and the model box under it
  // (T3.3a). Everything comes from Nextbook.modes and Nextbook.modeDefs: a listed mode that did
  // not load gets a card of its own, and a mode that throws gets one plain sentence, never a
  // blank page.

  var FORMAT_WORDS = { BK: 'formatBook', EBOOK: 'formatEbook', EAUDIOBOOK: 'formatAudio', LPRINT: 'formatLarge' };

  var INPUT_LABELS = {
    'shelf-book': 'inputLabelShelfBook',
    book: 'inputLabelBook',
    facet: 'inputLabelFacet',
    facets: 'inputLabelFacets',
    text: 'inputLabelText',
    number: 'inputLabelNumber',
    choice: 'inputLabelChoice'
  };

  // validate()'s drop code -> the words for it. The id is always named beside these.
  var DROP_WORDS = {
    unknown: 'dropUnknown',
    repeat: 'dropRepeat',
    shelf: 'dropShelf',
    noWhy: 'dropNoWhy',
    whyLong: 'dropWhyLong',
    whyStock: 'dropWhyStock',
    seventh: 'dropSeventh',
    bad: 'dropBad'
  };

  function blankModel() {
    return { answer: '', checked: false, kept: [], dropped: [], reason: '', sig: '' };
  }

  function loadMode(id) {
    state.modeId = id;
    state.modeReady = true;
    state.inputs = {};
    state.bookQuery = {};
    state.seed = 1;
    state.model = blankModel();
    state.words = {};
    if (!state.store) return;
    try {
      var saved = state.store.inputs(id);
      if (isObj(saved)) state.inputs = saved;
    } catch (e) { /* remembered values are a nicety, not the point */ }
    try {
      var savedSeed = state.store.seed(id);
      if (typeof savedSeed === 'number' && isFinite(savedSeed)) state.seed = savedSeed;
    } catch (e) { /* the first seed is as good as any */ }
  }

  function chooseMode(id) {
    loadMode(id);
    // The choice is remembered the way the inputs and the seed are, so #find opens on it.
    if (state.store) {
      try { state.store.setLastMode(id); } catch (e) { /* the page still works */ }
    }
    state.message = '';
    render();
  }

  function saveInputs(modeId) {
    if (!state.store) return;
    try { state.store.setInputs(modeId, state.inputs); } catch (e) { /* kept in memory */ }
  }

  function storedInput(id) {
    return Object.prototype.hasOwnProperty.call(state.inputs, id) ? state.inputs[id] : undefined;
  }

  function setInputValue(modeId, id, value) {
    if (value === undefined || value === null || value === '') delete state.inputs[id];
    else state.inputs[id] = value;
    saveInputs(modeId);
  }

  // The remembered value, made into the shape `choose` expects. A number and a choice carry
  // their own default, so those have a value before anyone touches the page; everything else
  // asks first. A number is clamped to min/max here as well as on change: a value written by
  // an older page, or a default outside the range, must not reach `choose` unclamped.
  function modeInputValue(spec) {
    var raw = storedInput(spec.id);
    var kind = String(spec.kind || '');
    if (kind === 'number') {
      var n = typeof raw === 'number' ? raw : Number(raw);
      if (raw === undefined || raw === null || raw === '' || !isFinite(n)) {
        var d = spec['default'] !== undefined ? Number(spec['default']) : NaN;
        if (!isFinite(d)) d = spec.min !== undefined ? Number(spec.min) : 1;
        n = isFinite(d) ? d : 1;
      }
      if (spec.min !== undefined && isFinite(Number(spec.min))) n = Math.max(Number(spec.min), n);
      if (spec.max !== undefined && isFinite(Number(spec.max))) n = Math.min(Number(spec.max), n);
      return n;
    }
    if (kind === 'choice') {
      if (typeof raw === 'string' && raw) return raw;
      if (spec['default'] !== undefined) return String(spec['default']);
      return Array.isArray(spec.options) && spec.options[0] ? String(spec.options[0].value) : '';
    }
    if (kind === 'shelf-book') {
      if (isObj(raw) && typeof raw.key === 'string') return raw.key;
      return typeof raw === 'string' ? raw : '';
    }
    if (kind === 'book') {
      if (isObj(raw) && typeof raw.id === 'string') return raw.id;
      return typeof raw === 'string' ? raw : '';
    }
    if (kind === 'facets') {
      if (!Array.isArray(raw)) return [];
      return raw.filter(function (k) { return typeof k === 'string' && k; }).slice(0, 4);
    }
    if (kind === 'text') return typeof raw === 'string' ? raw : '';
    return raw;
  }

  function facetKeys() {
    var pool = poolResult();
    var facets = pool && isObj(pool.facets) ? pool.facets : {};
    return Object.keys(facets).sort(function (a, b) {
      var la = String((facets[a] && facets[a].label) || a).toLowerCase();
      var lb = String((facets[b] && facets[b].label) || b).toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : (a < b ? -1 : a > b ? 1 : 0);
    });
  }

  function facetWords(key) {
    try {
      var said = Nextbook.pool.labelOf(key);
      if (said) return said;
    } catch (e) { /* the key is the last resort */ }
    var cut = String(key).indexOf(':');
    return cut === -1 ? String(key) : String(key).slice(cut + 1).replace(/-/g, ' ');
  }

  // A work search inside a `book` input: type, then press the book you meant. The result box is
  // redrawn on its own, so typing never rebuilds the page or moves the caret.
  function bookResults(box, spec, modeId, query) {
    clear(box);
    var words = String(query || '').trim();
    if (!words) { box.appendChild(p(t('inputSearchHint'), 'nb-hint')); return; }
    var found = [];
    try { found = Nextbook.pool.search(words) || []; } catch (e) { found = []; }
    if (!found.length) { box.appendChild(p(t('addNoResults'), 'nb-hint')); return; }
    var list = h('ul', { class: 'nb-books nb-books-compact' });
    found.slice(0, 8).forEach(function (work, i) {
      var li = h('li', { class: 'nb-book' });
      var head = h('div', { class: 'nb-book-head' },
        h('strong', { class: 'nb-book-title' }, work.title || t('untitledBook')));
      var line = byLine(work, null);
      if (line) head.appendChild(p(line, 'nb-by'));
      li.appendChild(head);
      li.appendChild(h('div', { class: 'nb-controls' },
        button('input-' + spec.id + '-pick-' + (i + 1), t('inputUseBook'), function (w) {
          return function () {
            setInputValue(modeId, spec.id, w.id);
            state.bookQuery[spec.id] = '';
            render();
          };
        }(work), 'nb-button nb-button-small')));
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  // ---- The facets input's "from some words" half (T3.3b) --------------------------------------
  // Inside a facets input only. The person pastes an event, a headline or a wish; the app writes
  // the words to copy (seam.labelsPrompt); the answer comes back and only subjects that exist in
  // this list are kept, as facet keys. The rest are named. Nothing is sent anywhere: the person
  // carries the words to a chat and back, and the mode never sees the chat's words.

  function wordsState(modeId, id) {
    var key = String(modeId) + '|' + String(id);
    if (!isObj(state.words[key])) {
      state.words[key] = {
        open: false, text: '', answer: '', message: '', checked: false,
        ticked: [], unknown: [], over: []
      };
    }
    return state.words[key];
  }

  function wordsPromptFor(text) {
    try { return Nextbook.seam.labelsPrompt(text, poolResult().facets); } catch (e) { return ''; }
  }

  function wordsResultBox(ws, base) {
    var box = h('div', { class: 'nb-words-result' });
    if (ws.message) {
      box.appendChild(p(ws.message, 'nb-note', { role: 'status', 'data-test': base + '-words-said' }));
    }
    if (!ws.checked) return box;
    box.appendChild(p(ws.ticked.length
      ? t('wordsTicked', { list: ws.ticked.join(', ') })
      : t('wordsNoneKept'), 'nb-note', { 'data-test': base + '-words-result' }));
    var said = [];
    if (ws.unknown.length) {
      said.push(ws.unknown.length === 1
        ? t('wordsNoSubject', { name: ws.unknown[0] })
        : t('wordsNoSubjects', { list: ws.unknown.join(', ') }));
    }
    if (ws.over.length) {
      said.push(ws.over.length === 1
        ? t('wordsOverOne', { name: ws.over[0] })
        : t('wordsOverMany', { list: ws.over.join(', ') }));
    }
    if (said.length) {
      box.appendChild(p(said.join(' '), 'nb-dropped', { 'data-test': base + '-words-dropped' }));
    }
    return box;
  }

  // The answer is read by seam.parseLabels and never by the page. A kept subject is a facet key;
  // up to four tick the checkboxes above. A kept subject that does not fit, and a subject the
  // answer invented, are named instead of shown.
  function readWordsAnswer(answer, ws, spec, modeId, facets) {
    ws.message = '';
    ws.checked = false;
    ws.ticked = [];
    ws.unknown = [];
    ws.over = [];
    var text = String(answer || '').trim();
    if (!text) { ws.message = t('modelNeedAnswer'); render(); return; }
    ws.answer = text;
    var parsed = null;
    try { parsed = Nextbook.seam.parseLabels(text, facets); } catch (e) { parsed = null; }
    if (!parsed) { ws.message = t('wordsReadFailed'); render(); return; }

    var picked = modeInputValue(spec).slice();
    var before = picked.join('|');
    (Array.isArray(parsed.kept) ? parsed.kept : []).forEach(function (key) {
      var name = facetWords(key);
      if (picked.indexOf(key) === -1) {
        if (picked.length >= 4) { ws.over.push(name); return; }
        picked.push(key);
      }
      ws.ticked.push(name);
    });
    (Array.isArray(parsed.dropped) ? parsed.dropped : []).forEach(function (drop) {
      var name = drop && drop.label ? String(drop.label) : '';
      if (!name) return;
      if (drop.code === 'over') ws.over.push(name);
      else ws.unknown.push(name);
    });
    if (picked.join('|') !== before) setInputValue(modeId, spec.id, picked);
    ws.checked = true;
    render();
  }

  function wordsPanel(spec, modeId, base, facets) {
    var ws = wordsState(modeId, spec.id);
    var wrap = h('div', { class: 'nb-words' });
    var panelId = 'nb-words-' + String(modeId) + '-' + String(spec.id);
    wrap.appendChild(h('button', {
      type: 'button',
      class: 'nb-button nb-button-quiet nb-button-small nb-words-open',
      'data-test': base + '-words-toggle',
      'aria-expanded': ws.open ? 'true' : 'false',
      'aria-controls': panelId,
      on: { click: function () { ws.open = !ws.open; render(); } }
    }, t('wordsOpen')));

    var panel = h('div', { class: 'nb-words-panel', id: panelId, hidden: !ws.open, 'data-test': base + '-words-panel' });
    wrap.appendChild(panel);
    if (!ws.open) return wrap;

    panel.appendChild(p(t('wordsHint'), 'nb-hint'));
    panel.appendChild(p(t('modelNoSend'), 'nb-hint'));

    var wordsBox = h('textarea', {
      class: 'nb-words-box',
      rows: 4,
      placeholder: t('wordsPlaceholder'),
      'data-test': base + '-words-text',
      'aria-label': t('wordsTextLabel'),
      on: { input: function (ev) { ws.text = String(ev.target.value || ''); refresh(); } }
    }, ws.text);
    panel.appendChild(h('label', { class: 'nb-field' },
      h('span', { class: 'nb-label' }, t('wordsTextLabel')), wordsBox));

    panel.appendChild(h('p', { class: 'nb-label' }, t('modelPromptLabel')));
    var promptBox = h('textarea', {
      class: 'nb-model-prompt',
      rows: 8,
      readonly: true,
      placeholder: t('wordsPromptEmpty'),
      'data-test': base + '-words-prompt',
      'aria-label': t('modelPromptLabel')
    }, ws.text.trim() ? wordsPromptFor(ws.text) : '');
    panel.appendChild(promptBox);

    var copyBtn = button(base + '-words-copy', t('modelCopy'), function () {
      var text = ws.text.trim() ? wordsPromptFor(ws.text) : '';
      if (!text) { ws.message = t('wordsNeedWords'); render(); return; }
      writeClipboard(text, function (ok) {
        ws.message = ok ? t('modelCopied') : t('modelCopyFailed');
        render();
        if (!ok) selectTest(base + '-words-prompt');
      });
    }, 'nb-button nb-button-small');
    copyBtn.disabled = !ws.text.trim();
    panel.appendChild(h('div', { class: 'nb-model-actions' }, copyBtn));

    panel.appendChild(h('p', { class: 'nb-label' }, t('modelAnswerLabel')));
    var answerBox = h('textarea', {
      class: 'nb-words-box',
      rows: 4,
      placeholder: t('modelAnswerPlaceholder'),
      'data-test': base + '-words-answer',
      'aria-label': t('modelAnswerLabel'),
      on: { input: function (ev) { ws.answer = String(ev.target.value || ''); } }
    }, ws.answer);
    panel.appendChild(answerBox);

    panel.appendChild(h('div', { class: 'nb-model-actions' },
      button(base + '-words-check', t('wordsCheck'), function () {
        readWordsAnswer(answerBox.value, ws, spec, modeId, facets);
      })));
    panel.appendChild(wordsResultBox(ws, base));

    // The prompt follows the words as they are typed, without drawing the page again (a redraw
    // would move the caret out of the box).
    function refresh() {
      var text = ws.text.trim();
      promptBox.value = text ? wordsPromptFor(text) : '';
      copyBtn.disabled = !text;
    }
    return wrap;
  }

  function inputBlock(spec, modeId) {
    var kind = String(spec.kind || '');
    var label = typeof spec.label === 'string' && spec.label ? spec.label : t(INPUT_LABELS[kind] || 'inputLabelChoice');
    var base = 'input-' + String(spec.id);
    var wrap = h('div', { class: 'nb-input-block', 'data-test': base + '-block' });

    if (kind === 'shelf-book') {
      var entries = [];
      try { entries = state.store ? state.store.shelf() : []; } catch (e) { entries = []; }
      if (!entries.length) {
        wrap.appendChild(h('span', { class: 'nb-label' }, label));
        wrap.appendChild(p(t('inputNoShelf'), 'nb-note'));
        return wrap;
      }
      var options = [{ value: '', label: t('pickOne') }];
      entries.forEach(function (e) {
        var title = (e && e.title) || t('untitledBook');
        options.push({ value: String((e && e.key) || ''), label: e && e.author ? title + ' ' + t('byLine', { author: e.author }) : title });
      });
      wrap.appendChild(h('label', { class: 'nb-field' },
        h('span', { class: 'nb-label' }, label),
        selectField(base, options, modeInputValue(spec), label, function (chosen) {
          setInputValue(modeId, spec.id, chosen);
          render();
        })));
      return wrap;
    }

    if (kind === 'book') {
      var chosenId = modeInputValue(spec);
      var chosenWork = chosenId ? (poolResult().byId || {})[chosenId] : null;
      var resultsBox = h('div', { class: 'nb-picksearch', 'data-test': base + '-results' });
      var search = h('input', {
        class: 'nb-input',
        type: 'search',
        placeholder: t('inputSearchHint'),
        'data-test': base,
        'aria-label': label,
        autocomplete: 'off',
        value: state.bookQuery[spec.id] || '',
        on: {
          input: function (ev) {
            state.bookQuery[spec.id] = String(ev.target.value || '');
            bookResults(resultsBox, spec, modeId, state.bookQuery[spec.id]);
          }
        }
      });
      wrap.appendChild(h('label', { class: 'nb-field' },
        h('span', { class: 'nb-label' }, label), search));
      wrap.appendChild(resultsBox);
      bookResults(resultsBox, spec, modeId, state.bookQuery[spec.id] || '');
      if (chosenWork) {
        wrap.appendChild(p(t('inputChosen', { title: chosenWork.title || '', author: chosenWork.author || '' }),
          'nb-chosen', { 'data-test': base + '-chosen' }));
      }
      return wrap;
    }

    if (kind === 'facet') {
      var facetOptions = [{ value: '', label: t('pickOne') }].concat(facetKeys().map(function (key) {
        return { value: key, label: facetWords(key) };
      }));
      wrap.appendChild(h('label', { class: 'nb-field' },
        h('span', { class: 'nb-label' }, label),
        selectField(base, facetOptions, modeInputValue(spec), label, function (chosen) {
          setInputValue(modeId, spec.id, chosen);
          render();
        })));
      return wrap;
    }

    if (kind === 'facets') {
      var picked = modeInputValue(spec);
      var keys = facetKeys();
      var field = h('fieldset', { class: 'nb-facets-field' },
        h('legend', { class: 'nb-label' }, label),
        p(t('inputFacetsHint'), 'nb-hint'));
      var grid = h('div', { class: 'nb-facets' });
      if (!keys.length) grid.appendChild(p(t('inputNoFacets'), 'nb-empty'));
      keys.forEach(function (key, i) {
        var checkbox = h('input', {
          type: 'checkbox',
          value: key,
          'data-test': base + '-facet-' + (i + 1),
          on: {
            change: function (ev) {
              var now = modeInputValue(spec).slice();
              var at = now.indexOf(key);
              if (ev.target.checked && at === -1) {
                if (now.length >= 4) {
                  ev.target.checked = false;
                  state.message = t('inputFacetsMax');
                  render();
                  return;
                }
                now.push(key);
              } else if (!ev.target.checked && at !== -1) {
                now.splice(at, 1);
              }
              setInputValue(modeId, spec.id, now.length ? now : undefined);
              render();
            }
          }
        });
        if (picked.indexOf(key) !== -1) checkbox.checked = true;
        grid.appendChild(h('label', { class: 'nb-facet-choice' }, checkbox, h('span', null, facetWords(key))));
      });
      field.appendChild(grid);
      // T3.3b: "From some words" belongs to a facets input, and only when the list has subjects
      // to keep. A mode with no facets input never draws it.
      if (keys.length) field.appendChild(wordsPanel(spec, modeId, base, poolResult().facets));
      wrap.appendChild(field);
      return wrap;
    }

    if (kind === 'text') {
      var textBox = h('input', {
        class: 'nb-input',
        type: 'text',
        'data-test': base,
        'aria-label': label,
        autocomplete: 'off',
        value: modeInputValue(spec),
        on: {
          change: function (ev) {
            setInputValue(modeId, spec.id, String(ev.target.value || '').trim());
            render();
          }
        }
      });
      wrap.appendChild(h('label', { class: 'nb-field' },
        h('span', { class: 'nb-label' }, label), textBox));
      return wrap;
    }

    if (kind === 'number') {
      var numberAttrs = {
        class: 'nb-input nb-input-number',
        type: 'number',
        step: '1',
        'data-test': base,
        'aria-label': label,
        value: String(modeInputValue(spec)),
        on: {
          change: function (ev) {
            var n = Number(ev.target.value);
            if (!isFinite(n)) { setInputValue(modeId, spec.id, undefined); render(); return; }
            if (spec.min !== undefined && isFinite(Number(spec.min))) n = Math.max(Number(spec.min), n);
            if (spec.max !== undefined && isFinite(Number(spec.max))) n = Math.min(Number(spec.max), n);
            setInputValue(modeId, spec.id, n);
            render();
          }
        }
      };
      if (spec.min !== undefined && isFinite(Number(spec.min))) numberAttrs.min = String(spec.min);
      if (spec.max !== undefined && isFinite(Number(spec.max))) numberAttrs.max = String(spec.max);
      wrap.appendChild(h('label', { class: 'nb-field' },
        h('span', { class: 'nb-label' }, label), h('input', numberAttrs)));
      return wrap;
    }

    if (kind === 'choice') {
      var chosen = modeInputValue(spec);
      var group = h('div', { class: 'nb-choices', role: 'group', 'aria-label': label });
      (Array.isArray(spec.options) ? spec.options : []).forEach(function (option, i) {
        var value = String(option && option.value !== undefined ? option.value : '');
        var on = value === String(chosen);
        group.appendChild(h('button', {
          type: 'button',
          class: on ? 'nb-choice nb-choice-on' : 'nb-choice',
          'data-test': base + '-option-' + (i + 1),
          'aria-pressed': on ? 'true' : 'false',
          on: { click: function () { setInputValue(modeId, spec.id, value); render(); } }
        }, String(option && option.label !== undefined ? option.label : value)));
      });
      wrap.appendChild(h('span', { class: 'nb-label' }, label));
      wrap.appendChild(group);
      return wrap;
    }

    wrap.appendChild(p(t('inputUnknownKind', { kind: kind }), 'nb-note'));
    return wrap;
  }

  // The ctx the mode talks to: the pool, the shelf in use, friends' shelves and the events
  // snapshot, plus this mode's seed. Everything is copied inside makeCtx, so a mode cannot
  // change the page's own list.
  function buildCtx(def) {
    var entries = [];
    try { entries = state.store ? state.store.shelf() : []; } catch (e) { entries = []; }
    var others = [];
    try { others = state.store ? state.store.others() : []; } catch (e) { others = []; }
    var events = Nextbook.data.get('events');
    return Nextbook.makeCtx({
      pool: poolResult(),
      shelf: entries,
      others: others,
      events: events,
      seed: state.seed,
      def: def
    });
  }

  // Each input, resolved to what `choose` expects: an entry for a shelf book, a work for a book,
  // facet keys for a facet, the text, the number, the chosen value. `missing` is the first input
  // with no value: choose() is not called until every one has one.
  function inputsFor(def, ctx) {
    var input = {}, missing = null;
    (Array.isArray(def.inputs) ? def.inputs : []).forEach(function (spec) {
      if (!spec || typeof spec !== 'object' || !spec.id) return;
      var kind = String(spec.kind || '');
      var value = modeInputValue(spec);
      var clean = value;
      if (kind === 'shelf-book') {
        var key = typeof value === 'string' ? value : '';
        clean = null;
        for (var i = 0; i < ctx.shelf.length; i++) {
          if (ctx.shelf[i] && ctx.shelf[i].key === key) { clean = ctx.shelf[i]; break; }
        }
      } else if (kind === 'book') {
        clean = value ? ctx.work(value) : null;
      } else if (kind === 'facet') {
        clean = value || null;
      } else if (kind === 'facets') {
        clean = Array.isArray(value) && value.length ? value : null;
      } else if (kind === 'text') {
        clean = value && String(value).trim() ? value : null;
      }
      if (clean === null || clean === undefined || clean === '') {
        if (!missing) missing = spec;
        return;
      }
      input[spec.id] = clean;
    });
    return { input: input, missing: missing };
  }

  function formatWords(formats) {
    if (!Array.isArray(formats) || !formats.length) return '';
    var words = [], seen = {};
    formats.forEach(function (code) {
      var key = String(code || '');
      var word = FORMAT_WORDS[key] ? t(FORMAT_WORDS[key]) : key.toLowerCase();
      if (!word || seen[word]) return;
      seen[word] = true;
      words.push(word);
    });
    return words.length ? t('formatsLine', { list: words.join(', ') }) : '';
  }

  // "Want to read" and "Read it" on a card: the book joins the shelf in use, then the mode runs
  // again, so the six move.
  function addPickToShelf(work, value) {
    if (!state.store || !work) return;
    if (onShelfWork(work)) {
      state.message = t('alreadyThere');
      render();
      return;
    }
    try {
      var entry = bookFromWork(work);
      entry.state = value;
      state.store.add(entry);
      state.message = value === 'read'
        ? t('pickReadAdded', { title: work.title || '' })
        : t('pickWantAdded', { title: work.title || '' });
    } catch (e) {
      state.message = t('shelfBroken');
    }
    render();
  }

  function pickCard(pick, index, ctx) {
    var work = ctx.work(pick.id) || {};
    var card = h('article', { class: 'nb-card', 'data-test': 'pick-' + index, 'data-pick': pick.id });
    var head = h('div', { class: 'nb-card-head' });
    var link = linkFor(work);
    head.appendChild(link
      ? h('a', { class: 'nb-book-title', href: link, 'data-test': 'pick-link-' + index }, work.title || t('untitledBook'))
      : h('strong', { class: 'nb-book-title' }, work.title || t('untitledBook')));
    var line = byLine(work, null);
    if (line) head.appendChild(p(line, 'nb-by'));
    var formats = formatWords(work.formats);
    if (formats) head.appendChild(p(formats, 'nb-formats'));
    card.appendChild(head);
    if (pick.why) card.appendChild(p(pick.why, 'nb-reason'));
    var tags = null;
    try { tags = Nextbook.pool.tagsOf(work); } catch (e) { tags = null; }
    if (tags && tags.note) card.appendChild(p(t('ourNote', { note: tags.note }), 'nb-ournote'));
    if (work.found && work.found.query) card.appendChild(p(t('foundFor', { words: work.found.query }), 'nb-note'));
    card.appendChild(h('div', { class: 'nb-card-actions' },
      button('pick-want-' + index, t('pickWant'), function () { addPickToShelf(work, 'want'); }, 'nb-button nb-button-small'),
      button('pick-read-' + index, t('pickRead'), function () { addPickToShelf(work, 'read'); }, 'nb-button nb-button-small')));
    return card;
  }

  // shape 'list': a grid of cards, under a heading when the mode used `group`.
  // shape 'path': an ordered list, each card under its step words, with an arrow between steps.
  function pickList(picks, ctx, shape) {
    var wrap = h('div', { class: 'nb-picks-wrap', 'data-test': 'pick-list' });
    var index = 0;
    if (shape === 'path') {
      var ol = h('ol', { class: 'nb-path' });
      picks.forEach(function (pick) {
        index += 1;
        var li = h('li', { class: 'nb-path-item' });
        var step = h('div', { class: 'nb-step' },
          h('span', { class: 'nb-step-word' }, pick.step || t('stepWord', { n: index })));
        if (pick.group) step.appendChild(h('span', { class: 'nb-group-word' }, pick.group));
        li.appendChild(step);
        li.appendChild(pickCard(pick, index, ctx));
        ol.appendChild(li);
      });
      wrap.appendChild(ol);
      return wrap;
    }
    var names = [], byGroup = {};
    picks.forEach(function (pick) {
      var name = pick.group || '';
      if (!byGroup[name]) { byGroup[name] = []; names.push(name); }
      byGroup[name].push(pick);
    });
    names.forEach(function (name) {
      if (name) wrap.appendChild(h('h4', { class: 'nb-group' }, name));
      var ul = h('ul', { class: 'nb-picks' });
      byGroup[name].forEach(function (pick) {
        index += 1;
        ul.appendChild(h('li', null, pickCard(pick, index, ctx)));
      });
      wrap.appendChild(ul);
    });
    return wrap;
  }

  function droppedLine(dropped) {
    var bits = dropped.map(function (d) {
      var id = d && d.id ? '"' + d.id + '"' : t('aPick');
      return id + ' ' + t(DROP_WORDS[d && d.code] || 'dropUnknown');
    });
    return countLine(dropped.length, 'findDroppedOne', 'findDroppedMany',
      { n: dropped.length, list: bits.join('; ') });
  }

  function runMode(def, ctx, input) {
    var wrap = h('section', { class: 'nb-find-result', 'data-test': 'find-result' });
    var answer = null;
    try {
      answer = def.choose.call(def, ctx, input);
    } catch (e) {
      wrap.appendChild(p(t('modeCrashed'), 'nb-message nb-message-warn', { 'data-test': 'find-error' }));
      return { node: wrap, picks: [], result: { picks: [] }, sig: '' };
    }
    var v = { picks: [], dropped: [], error: null };
    try {
      v = Nextbook.validate(answer, ctx, def);
    } catch (e) {
      wrap.appendChild(p(t('modeCrashed'), 'nb-message nb-message-warn', { 'data-test': 'find-error' }));
      return { node: wrap, picks: [], result: { picks: [] }, sig: '' };
    }
    var note = answer && typeof answer.note === 'string' ? answer.note.trim() : '';
    if (note) wrap.appendChild(p(note, 'nb-note', { 'data-test': 'find-note' }));
    if (v.error) wrap.appendChild(p(v.error, 'nb-message nb-message-warn', { 'data-test': 'find-error' }));
    if (v.dropped.length) wrap.appendChild(p(droppedLine(v.dropped), 'nb-dropped', { 'data-test': 'find-dropped' }));
    if (v.picks.length) wrap.appendChild(pickList(v.picks, ctx, def.shape === 'path' ? 'path' : 'list'));
    // The one line the app promises under every result (base.js has the same words).
    wrap.appendChild(p(t('libraryLine'), 'nb-hint', { 'data-test': 'find-library-line' }));
    return {
      node: wrap,
      picks: v.picks,
      result: { picks: v.picks },
      sig: v.picks.map(function (p) { return p.id; }).join(',')
    };
  }

  // ---- The model box (T3.3a): a second opinion, by hand ---------------------------------------
  // Nothing is sent anywhere: the app writes the words, the person carries them to a chat, and
  // pastes the answer back. Only a sentence for one of the six is kept, and it is marked as the
  // chat's; every title, author, year and link is still the list's own.

  // After a rebuild, the box is a new element, so the words are selected after render(), not
  // before it (a selection made on the old element dies with it).
  function selectTest(test) {
    try {
      var all = doc.querySelectorAll ? doc.querySelectorAll('[data-test]') : [];
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute('data-test') === test && typeof all[i].focus === 'function') {
          all[i].focus();
          if (typeof all[i].select === 'function') all[i].select();
          return;
        }
      }
    } catch (e) { /* the words are still on the page */ }
  }

  // The clipboard is the one thing the page can hand to the outside, and only on a press. A
  // browser that will not copy says so, and the words stay selected for a manual copy.
  function writeClipboard(text, done) {
    try {
      var nav = window.navigator;
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        nav.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        return;
      }
    } catch (e) { /* no clipboard: say so and select the words */ }
    done(false);
  }

  function copyPrompt(text) {
    writeClipboard(text, function (ok) {
      state.message = ok ? t('modelCopied') : t('modelCopyFailed');
      render();
      if (!ok) selectTest('model-prompt');
    });
  }

  function readAnswer(answer, result, ctx) {
    var text = String(answer || '').trim();
    // A read starts clean: the note from the last answer, and its cards, go first. An empty
    // answer leaves the note that asks for one and nothing else.
    state.model = blankModel();
    state.message = '';
    if (!text) {
      state.message = t('modelNeedAnswer');
      render();
      return;
    }
    var parsed = null;
    try {
      parsed = Nextbook.seam.parseFinalists(text, result, library().idPattern);
    } catch (e) {
      parsed = null;
    }
    var model = blankModel();
    model.answer = text;
    model.sig = (result.picks || []).map(function (p) { return p.id; }).join(',');
    if (parsed) {
      model.checked = true;
      model.kept = Array.isArray(parsed.kept) ? parsed.kept : [];
      model.dropped = Array.isArray(parsed.dropped) ? parsed.dropped : [];
      model.reason = parsed.reason || '';
    }
    state.model = model;
    render();
  }

  function modelResultBox(ctx) {
    var box = h('div', { class: 'nb-model-result', 'data-test': 'model-result' });
    var model = state.model;
    if (!model || !model.checked) return box;
    if (!model.kept.length) {
      box.appendChild(p(t('modelNoPick'), 'nb-note', { 'data-test': 'model-said' }));
    } else {
      model.kept.forEach(function (kept, i) {
        var work = ctx.work(kept.id) || {};
        var card = h('article', { class: 'nb-model-card', 'data-test': 'model-card-' + (i + 1) });
        card.appendChild(p(t('modelFromChat'), 'nb-model-tag'));
        card.appendChild(h('strong', { class: 'nb-book-title' }, work.title || t('untitledBook')));
        var line = byLine(work, null);
        if (line) card.appendChild(p(line, 'nb-by'));
        var link = linkFor(work);
        if (link) {
          card.appendChild(h('a', { class: 'nb-link-line', href: link, 'data-test': 'model-link-' + (i + 1) },
            t('modelLibraryLink')));
        }
        // The chat's own one sentence, and nothing else, is shown as the chat's words.
        card.appendChild(p(t('modelSaidLine', { sentence: kept.why }), 'nb-model-words'));
        box.appendChild(card);
      });
    }
    if (model.dropped.length) {
      box.appendChild(p(t('modelDropped', { said: model.reason }), 'nb-dropped', { 'data-test': 'model-dropped' }));
    }
    return box;
  }

  function modelBox(result, ctx, def) {
    var sec = h('section', { class: 'nb-model', 'data-test': 'model-box' });
    var picks = result && Array.isArray(result.picks) ? result.picks : [];
    // Two ways the box stays closed, and in both the prompt is never built, so no title can
    // reach one. A mode with allowShelf may pick a book that is on the person's shelf, and
    // the prompt is written from the picks (AGENTS.md rule 1): a shelf title must never go
    // into a chat. With no picks there is nothing to argue about.
    if (!picks.length) {
      sec.appendChild(p(t('modelNothing'), 'nb-hint', { 'data-test': 'model-closed' }));
      return sec;
    }
    if (def && def.allowShelf === true) {
      sec.appendChild(p(t('modelShelfClosed'), 'nb-hint', { 'data-test': 'model-closed' }));
      return sec;
    }
    var prompt = '';
    try { prompt = Nextbook.seam.finalistsPrompt(result, ctx.profile(), poolResult()); } catch (e) { prompt = ''; }
    sec.appendChild(h('h3', null, t('modelAsk')));
    sec.appendChild(p(t('modelNoSend'), 'nb-hint'));

    sec.appendChild(p(t('modelPromptLabel'), 'nb-label'));
    var promptBox = h('textarea', {
      class: 'nb-model-prompt',
      rows: 10,
      readonly: true,
      'data-test': 'model-prompt',
      'aria-label': t('modelPromptLabel')
    }, prompt);
    sec.appendChild(promptBox);
    sec.appendChild(h('div', { class: 'nb-model-actions' },
      button('model-copy', t('modelCopy'), function () { copyPrompt(prompt); }, 'nb-button nb-button-small')));

    sec.appendChild(p(t('modelAnswerLabel'), 'nb-label'));
    var answerBox = h('textarea', {
      class: 'nb-model-answer',
      rows: 5,
      placeholder: t('modelAnswerPlaceholder'),
      'data-test': 'model-answer',
      'aria-label': t('modelAnswerLabel'),
      on: { input: function (ev) { state.model.answer = String(ev.target.value || ''); } }
    }, state.model.answer || '');
    sec.appendChild(answerBox);
    sec.appendChild(h('div', { class: 'nb-model-actions' },
      button('model-check', t('modelCheck'), function () {
        // The box on the page is the answer, empty or not: a cleared box must read as an
        // empty answer, not as the last one still held in state.
        readAnswer(answerBox.value === undefined || answerBox.value === null ? '' : String(answerBox.value),
          result, ctx);
      })));
    sec.appendChild(modelResultBox(ctx));
    return sec;
  }

  // ---- Running the chosen mode ----------------------------------------------------------------
  function shuffle() {
    var next = (typeof state.seed === 'number' && isFinite(state.seed) ? state.seed : 0) + 1;
    state.seed = next;
    if (state.store) {
      try { state.store.setSeed(state.modeId, next); } catch (e) { /* the page still mixes */ }
    }
    render();
  }

  function modePanel(def, modeId) {
    var wrap = h('section', { class: 'nb-mode-panel', 'data-test': 'mode-panel' });
    var specs = Array.isArray(def.inputs) ? def.inputs : [];
    if (specs.length) {
      wrap.appendChild(h('h3', t('inputHeading')));
      var box = h('div', { class: 'nb-inputs' });
      specs.forEach(function (spec) {
        if (spec && typeof spec === 'object' && spec.id) box.appendChild(inputBlock(spec, modeId));
      });
      wrap.appendChild(box);
    }
    wrap.appendChild(h('div', { class: 'nb-find-tools' },
      button('find-shuffle', t('shuffleButton'), shuffle, 'nb-button nb-button-quiet'),
      p(t('shuffleHint'), 'nb-hint')));

    var ctx = null, built = null;
    try {
      ctx = buildCtx(def);
      built = inputsFor(def, ctx);
    } catch (e) {
      wrap.appendChild(p(t('modeCrashed'), 'nb-message nb-message-warn', { 'data-test': 'find-error' }));
      return wrap;
    }
    if (built.missing) {
      var label = typeof built.missing.label === 'string' && built.missing.label
        ? built.missing.label
        : t(INPUT_LABELS[built.missing.kind] || 'inputLabelChoice');
      wrap.appendChild(p(t('inputNeeded', { label: label }), 'nb-hint', { 'data-test': 'find-needs-input' }));
      return wrap;
    }
    var out = runMode(def, ctx, built.input);
    wrap.appendChild(out.node);
    // A pasted answer belongs to the six it was written for. If they moved, it is put away.
    if (state.model.sig && state.model.sig !== out.sig) state.model = blankModel();
    // T3.3a: the box is under any result. With no picks it says there is nothing to argue
    // about; with an allowShelf mode it stays closed (a shelf title could be a candidate).
    wrap.appendChild(modelBox(out.result, ctx, def));
    return wrap;
  }

  function findView() {
    var sec = h('section', { class: 'nb-screen', id: 'nb-find', 'data-screen': 'find' });
    sec.appendChild(h('h2', t('findHeading')));
    sec.appendChild(p(t('findIntro'), 'nb-hint'));

    var ids = Array.isArray(Nextbook.modes) ? Nextbook.modes.slice() : [];
    if (!ids.length) {
      sec.appendChild(p(t('noModes'), 'nb-empty'));
      sec.appendChild(button('find-to-shelf', t('findShelfHint'), function () { go('shelf'); }, 'nb-button nb-button-quiet'));
      return sec;
    }

    var defs = Nextbook.modeDefs || {};
    function defOf(id) {
      return Object.prototype.hasOwnProperty.call(defs, id) ? defs[id] : null;
    }
    var firstLoaded = '';
    ids.forEach(function (id) { if (!firstLoaded && defOf(id)) firstLoaded = id; });
    // The first visit opens on the mode chosen last, when that mode is still in the list.
    var remembered = '';
    try { remembered = state.store ? String(state.store.lastMode() || '') : ''; } catch (e) { remembered = ''; }
    if (!state.modeReady || ids.indexOf(state.modeId) === -1) {
      loadMode(ids.indexOf(remembered) !== -1 ? remembered : (firstLoaded || ids[0]));
    }
    // The page draws before the mode files arrive. If the one it chose first did not load and
    // another did, the loaded one is shown; the choice is never a dead card.
    else if (firstLoaded && !defOf(state.modeId)) loadMode(firstLoaded);

    var list = h('ul', { class: 'nb-modes', 'data-test': 'mode-list' });
    ids.forEach(function (id) {
      var def = defOf(id);
      var chosen = state.modeId === id;
      var li = h('li', {
        class: chosen ? 'nb-mode nb-mode-on' : 'nb-mode',
        'data-test': def ? 'mode-card-' + id : 'mode-missing-' + id
      });
      if (!def) {
        // A listed mode whose file is missing: its own card, and the rest of the page carries on.
        li.appendChild(p(t('modeUnknown', { id: id }), 'nb-note'));
        li.appendChild(p(t('modeUnknownHelp'), 'nb-hint'));
      } else {
        li.appendChild(h('h3', null, def.name || id));
        if (def.purpose) li.appendChild(p(def.purpose, 'nb-text'));
        if (chosen) {
          li.appendChild(p(t('modeShowing'), 'nb-tag', { 'data-test': 'mode-current-' + id }));
        } else {
          li.appendChild(button('mode-pick-' + id, t('modeShow'),
            function (want) { return function () { chooseMode(want); }; }(id),
            'nb-button nb-button-small nb-button-quiet'));
        }
      }
      list.appendChild(li);
    });
    sec.appendChild(list);

    var def = state.modeId ? defOf(state.modeId) : null;
    if (def) sec.appendChild(modePanel(def, state.modeId));
    sec.appendChild(button('find-to-shelf', t('findShelfHint'), function () { go('shelf'); }, 'nb-button nb-button-quiet'));
    return sec;
  }

  // ---- The self-test screen --------------------------------------------------------------------
  function statusItem(test, text) {
    return h('li', { class: 'nb-status-line', 'data-test': test }, text);
  }

  function dataStatus() {
    var wrap = h('section', { class: 'nb-panel', id: 'nb-selftest-data' });
    wrap.appendChild(h('h3', t('dataHeading')));
    var list = h('ul', { class: 'nb-status', 'data-test': 'selftest-data' });

    var slice = Nextbook.data.get('slice');
    var tags = Nextbook.data.get('tags');
    var practice = Nextbook.data.get('practice');
    var found = Nextbook.data.get('found');
    var events = Nextbook.data.get('events');
    var pool = poolResult();

    if (isObj(slice) && Array.isArray(slice.works)) {
      var date = dateOnly(slice.fetched);
      list.appendChild(statusItem('selftest-data-slice', date
        ? countLine(slice.works.length, 'dataSliceOne', 'dataSlice', { n: slice.works.length, date: date })
        : t('dataSliceNoDate', { n: slice.works.length })));
    } else {
      list.appendChild(statusItem('selftest-data-slice', t('dataSliceMissing')));
    }

    var tagCount = isObj(tags) && isObj(tags.works) ? Object.keys(tags.works).length : 0;
    list.appendChild(statusItem('selftest-data-tags', tagCount
      ? countLine(tagCount, 'dataTagsOne', 'dataTags', { n: tagCount })
      : t('dataTagsMissing')));

    var practiceCount = isObj(practice) && Array.isArray(practice.entries) ? practice.entries.length : 0;
    list.appendChild(statusItem('selftest-data-practice', practiceCount
      ? countLine(practiceCount, 'dataPracticeOne', 'dataPractice', { n: practiceCount })
      : t('dataPracticeMissing')));

    if (isObj(found) && Array.isArray(found.works) && found.works.length) {
      var foundDate = '';
      if (Array.isArray(found.searches) && found.searches.length) {
        var last = found.searches[found.searches.length - 1];
        if (isObj(last)) foundDate = dateOnly(last.fetched);
      }
      if (!foundDate) foundDate = dateOnly(found.fetched);
      list.appendChild(statusItem('selftest-data-found', foundDate
        ? countLine(found.works.length, 'dataFoundOne', 'dataFound', { n: found.works.length, date: foundDate })
        : t('dataFoundNoDate', { n: found.works.length })));
    } else {
      list.appendChild(statusItem('selftest-data-found', t('dataFoundMissing')));
    }

    var eventCount = isObj(events) && Array.isArray(events.events) ? events.events.length : 0;
    if (eventCount) {
      var eventDate = dateOnly(events.fetched);
      list.appendChild(statusItem('selftest-data-events', eventDate
        ? countLine(eventCount, 'dataEventsOne', 'dataEvents', { n: eventCount, date: eventDate })
        : t('dataEventsNoDate', { n: eventCount })));
    } else {
      list.appendChild(statusItem('selftest-data-events', t('dataEventsMissing')));
    }

    if (pool && pool.ok === false && pool.message) {
      list.appendChild(statusItem('selftest-data-pool', pool.message));
    }
    wrap.appendChild(list);
    return wrap;
  }

  function savingLine() {
    var saving = false;
    try { saving = !!(state.store && state.store.persistent); } catch (e) { saving = false; }
    return h('p', {
      class: saving ? 'nb-status-save' : 'nb-status-nosave',
      'data-test': 'selftest-saving'
    }, saving ? t('savingNow') : t('notSaving'));
  }

  function checkPool() {
    var r = poolResult();
    return {
      ok: r.ok,
      message: r.message,
      works: Array.isArray(r.works) ? r.works : [],
      byId: r.byId || {},
      byGroupKey: r.byGroupKey || {},
      facets: r.facets || {},
      match: Nextbook.pool.match,
      search: Nextbook.pool.search,
      labelOf: Nextbook.pool.labelOf,
      tagsOf: Nextbook.pool.tagsOf,
      sections: Nextbook.pool.sections
    };
  }

  function modeReport(id, def, run) {
    var wrap = h('div', { class: 'nb-run-mode', 'data-mode': id });
    var name = def && def.name ? def.name : id;
    wrap.appendChild(h('h4', t('modeHeading', { name: name, id: id })));
    var pass = run && typeof run.pass === 'number' ? run.pass : 0;
    var fail = run && typeof run.fail === 'number' ? run.fail : 0;
    wrap.appendChild(p(t('modeSummary', { pass: pass, fail: fail }), 'nb-run-summary'));
    var list = h('ul', { class: 'nb-run-results' });
    var results = run && Array.isArray(run.results) ? run.results : [];
    results.forEach(function (result) {
      var ok = !!(result && result.ok);
      list.appendChild(h('li', { class: ok ? 'nb-pass' : 'nb-fail' },
        t(ok ? 'passWord' : 'failWord', { msg: result && result.msg ? result.msg : '' })));
    });
    wrap.appendChild(list);
    return wrap;
  }

  function runChecks() {
    var box = doc.getElementById('nb-selftest-results');
    if (!box) return;
    clear(box);
    var ids = Array.isArray(Nextbook.modes) ? Nextbook.modes.slice() : [];
    if (!ids.length) {
      box.appendChild(p(t('runNoModes'), 'nb-empty'));
      return;
    }
    var pool = checkPool();
    var practice = Nextbook.data.get('practice');
    var failed = 0;
    ids.forEach(function (id) {
      var def = Nextbook.modeDefs ? Nextbook.modeDefs[id] : null;
      var run = null;
      try {
        run = Nextbook.runModeChecks(id, { pool: pool, practice: practice });
      } catch (e) {
        run = { id: id, pass: 0, fail: 1, results: [{ ok: false, msg: t('checkCrashed', { msg: e && e.message ? e.message : String(e) }) }] };
      }
      failed += run && typeof run.fail === 'number' ? run.fail : 0;
      box.appendChild(modeReport(id, def, run));
    });
    box.appendChild(p(failed
      ? (failed === 1 ? t('someFailedOne') : t('someFailed', { n: failed }))
      : t('allPassed'),
      failed ? 'nb-run-total nb-fail' : 'nb-run-total nb-pass', { 'data-test': 'selftest-summary' }));
  }

  function selfTestView() {
    var sec = h('section', { class: 'nb-screen', id: 'nb-selftest', 'data-screen': 'selftest' });
    sec.appendChild(h('h2', t('selftestHeading')));
    sec.appendChild(p(t('selftestIntro'), 'nb-hint'));
    sec.appendChild(dataStatus());
    sec.appendChild(savingLine());

    var modes = h('section', { class: 'nb-panel', id: 'nb-modes-checks' });
    modes.appendChild(h('h3', t('modesHeading')));
    var ids = Array.isArray(Nextbook.modes) ? Nextbook.modes.slice() : [];
    if (!ids.length) modes.appendChild(p(t('runNoModes'), 'nb-hint'));
    modes.appendChild(button('selftest-run', t('runButton'), runChecks));
    modes.appendChild(h('div', { class: 'nb-run-box', id: 'nb-selftest-results', 'data-test': 'selftest-results' }));
    sec.appendChild(modes);
    return sec;
  }

  // ---- Drawing --------------------------------------------------------------------------------
  // The screen is rebuilt from its data on every change, so the element that had the keyboard
  // focus is thrown away with it. Note its data-test before the rebuild and put the focus back
  // on the element that has the same one, so a person can set state, rating and the next book
  // without reaching for the mouse again.
  function focusTest() {
    try {
      var el = doc.activeElement;
      if (!el || el === doc.body || typeof el.getAttribute !== 'function') return '';
      return el.getAttribute('data-test') || '';
    } catch (e) {
      return '';
    }
  }

  function refocus(test) {
    if (!test) return;
    try {
      var all = doc.querySelectorAll ? doc.querySelectorAll('[data-test]') : [];
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute('data-test') === test && typeof all[i].focus === 'function') {
          all[i].focus();
          return;
        }
      }
    } catch (e) { /* focus is a nicety, and the page is already drawn */ }
  }

  function navBar(route) {
    var nav = h('nav', { class: 'nb-nav', 'aria-label': t('navLabel') });
    [['find', 'navFind', 'nav-find'], ['shelf', 'navShelf', 'nav-shelf'], ['selftest', 'navSelftest', 'nav-selftest']]
      .forEach(function (item) {
        nav.appendChild(h('button', {
          type: 'button',
          class: route === item[0] ? 'nb-tab nb-tab-on' : 'nb-tab',
          'data-test': item[2],
          'aria-current': route === item[0] ? 'page' : null,
          on: { click: function () { go(item[0]); } }
        }, t(item[1])));
      });
    return nav;
  }

  function render() {
    if (!doc || typeof doc.getElementById !== 'function') return;
    var root = doc.getElementById('app');
    if (!root) return;
    var route = routeName();
    if (state.route !== route) {
      // A note belongs to the screen that made it. Moving to another screen clears it.
      state.route = route;
      state.message = '';
      state.exportText = '';
    }
    var keepFocus = focusTest();
    clear(root);
    root.appendChild(navBar(route));

    var pool = poolResult();
    if (pool && pool.ok === false) root.appendChild(p(pool.message || t('missingData'), 'nb-message nb-message-warn'));

    if (state.store && !state.store.persistent) {
      root.appendChild(p(t('notSaving'), 'nb-message nb-message-warn', { 'data-test': 'not-saving' }));
    }
    if (state.message) {
      root.appendChild(p(state.message, 'nb-message', { role: 'status' }));
    }

    if (route === 'shelf') root.appendChild(shelfView());
    else if (route === 'selftest') root.appendChild(selfTestView());
    else root.appendChild(findView());
    refocus(keepFocus);
  }

  function shelfView() {
    var sec = h('section', { class: 'nb-screen', id: 'nb-shelf', 'data-screen': 'shelf' });
    if (!state.store) {
      sec.appendChild(p(t('shelfBroken'), 'nb-message nb-message-warn'));
      return sec;
    }
    var banner = practiceBanner();
    if (banner) sec.appendChild(banner);
    var found = foundPanel();
    if (found) sec.appendChild(found);

    sec.appendChild(h('h2', state.store.which() === 'own' ? t('shelfOwnHeading') : t('shelfPracticeHeading')));

    var entries = [];
    try { entries = state.store.shelf(); } catch (e) { entries = []; }
    sec.appendChild(p(countLine(entries.length, 'shelfCountOne', 'shelfCount', { n: entries.length }), 'nb-count'));
    sec.appendChild(shelfList());
    sec.appendChild(addPanel());
    sec.appendChild(exportPanel());
    sec.appendChild(importPanel());
    sec.appendChild(friendsPanel());
    return sec;
  }

  // ---- Loading the modes ----------------------------------------------------------------------
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
      if (guard !== null) { try { window.clearTimeout(guard); } catch (e) { /* ignore */ } }
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
    else guard = window.setTimeout(finish, 15000); // a script that never answers must not hold the app
  }

  // ---- Boot -----------------------------------------------------------------------------------
  function boot() {
    if (booted) return;
    booted = true;
    if (!doc || typeof doc.getElementById !== 'function') return;

    try { state.store = Nextbook.store.open(); } catch (e) { state.store = null; }
    poolResult();

    try {
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('hashchange', function () { render(); });
      }
    } catch (e) { /* no router: the page still draws */ }

    render();
    loadModes(function () { render(); });
  }

  Nextbook.shell = { boot: boot, loadModes: loadModes, render: render, go: go, route: routeName };

  addStrings({
    // nav
    navFind: 'Ways to choose',
    navShelf: 'Shelf',
    navSelftest: 'Self-test',
    navLabel: 'Screens',
    // shelf
    shelfOwnHeading: 'Your own shelf',
    shelfPracticeHeading: 'The practice shelf',
    shelfCount: '{n} books on this shelf.',
    shelfCountOne: '1 book on this shelf.',
    shelfEmpty: 'No books on this shelf yet. Add one below.',
    shelfBroken: 'The shelf did not open. Reload the page and try again.',
    resetButton: 'Reset the practice shelf',
    resetAsk: "Reset the practice shelf? This puts the practice books back as they were. Your own shelf and your friends' shelves are not touched.",
    resetDone: 'The practice shelf is back.',
    useOwn: 'Use my own shelf',
    usePractice: 'Use the practice shelf',
    ownNow: 'You are using your own shelf.',
    // add a book
    addHeading: 'Add a book',
    addHelp: 'Type a title or an author. The list narrows as you type.',
    addPlaceholder: 'Title or author',
    addHint: 'Type a title or an author to search the list.',
    addNoResults: 'No book in the list matches those words.',
    addByName: 'Not in the list? Add it by name',
    addByNameHelp: 'Type the title. Add the author if you know it.',
    addTitle: 'Title',
    addAuthor: 'Author',
    addNameSubmit: 'Add this book',
    addNeedTitle: 'A book needs a title.',
    addButton: 'Add',
    moreResults: '{n} more books match those words. Type more to narrow the list.',
    onShelf: 'On your shelf',
    addedBook: 'Added {title}.',
    foundInList: 'It is in the list.',
    addedTyped: 'Added {title}. It is not in the list, so the link searches the library.',
    alreadyThere: 'That book is already on your shelf.',
    untitledBook: 'A book with no title',
    // the shelf's books
    stateLabel: 'State',
    ratingLabel: 'Rating',
    stateWant: 'Want to read',
    stateReading: 'Reading',
    stateRead: 'Read',
    stateStopped: 'Stopped',
    ratingNone: 'No rating',
    ratingLoved: 'Loved',
    ratingLiked: 'Liked',
    ratingOk: 'OK',
    ratingNot: 'Not for me',
    removeButton: 'Remove',
    removedBook: 'Removed {title}.',
    byLine: 'by {author}',
    byLineYear: 'by {author}, {year}',
    subjectsLine: 'Subjects: {list}.',
    notInList: 'This book is not in the list. The link searches the library by its title and author.',
    foundFor: 'Found for "{words}".',
    // export and import
    exportHeading: 'Save a copy',
    exportHelp: 'This makes a file you can keep, or give to a friend.',
    exportButton: 'Download the shelf file',
    exportDone: 'The shelf file was made.',
    exportCopy: 'This browser could not make a file. Copy this text into a file.',
    importHeading: 'Import a shelf file',
    importHelp: 'This adds a shelf file to the shelf you are using. A newer book wins.',
    importChoose: 'Choose a shelf file',
    importReport: 'Import done: {added} added, {changed} changed, {kept} left as they were.',
    importSkipped: '{skipped} books in the file could not be read. They were left out.',
    importNoFile: 'This browser could not read that file.',
    // friends' shelves
    friendsHeading: "Add a friend's shelf",
    friendsHelp: "A friend's shelf is kept apart. It never changes your own shelf.",
    friendsNamePlaceholder: 'A name for this shelf',
    friendsChoose: 'Choose their shelf file',
    friendsAdd: "Add this friend's shelf",
    friendsAdded: "Added {name}'s shelf, with {n} books.",
    friendsAddedOne: "Added {name}'s shelf, with 1 book.",
    friendsEmpty: "No friends' shelves yet.",
    friendsRemove: 'Remove',
    friendsRemoved: "Removed {name}'s shelf.",
    aFriend: 'A friend',
    // the found notice
    foundClear: 'Clear',
    foundCleared: 'The note is hidden. The books stay in the list.',
    // the find screen
    findHeading: 'Find a book',
    findIntro: 'Each way of choosing books offers up to six books and says why. The ones in this copy are listed here.',
    findShelfHint: 'Go to the shelf',
    modeUnknown: '"{id}" did not load.',
    modeUnknownHelp: 'This one did not load. Ask your helper to run the check.',
    modeShow: 'Show the books',
    modeShowing: 'Showing now',
    inputHeading: 'This way of choosing books needs a few things first:',
    inputNeeded: 'Pick something for "{label}" first.',
    pickOne: 'Choose one',
    inputLabelShelfBook: 'Pick a book from your shelf',
    inputLabelBook: 'Find a book in the list',
    inputLabelFacet: 'Pick a subject',
    inputLabelFacets: 'Pick up to four subjects',
    inputLabelText: 'Type some words',
    inputLabelNumber: 'Pick a number',
    inputLabelChoice: 'Pick one',
    inputUnknownKind: 'This page does not know how to ask for "{kind}".',
    inputNoShelf: 'The shelf is empty. Add a book on the shelf screen first.',
    inputNoFacets: 'The book list has no subjects yet.',
    inputSearchHint: 'Type a title or an author to search the list.',
    inputUseBook: 'Use this book',
    inputChosen: 'Chosen: {title}, by {author}.',
    inputFacetsHint: 'Pick up to four.',
    inputFacetsMax: 'That is four subjects. One was not added.',
    shuffleButton: 'Shuffle',
    shuffleHint: 'The same press gives the same books. Press Shuffle for a new mix.',
    stepWord: 'Step {n}',
    formatsLine: 'Formats: {list}.',
    formatBook: 'book',
    formatEbook: 'e-book',
    formatAudio: 'audiobook',
    formatLarge: 'large print',
    ourNote: 'Our note: {note}',
    pickWant: 'Want to read',
    pickRead: 'Read it',
    pickWantAdded: 'Added {title} to "Want to read".',
    pickReadAdded: 'Added {title} as read. Rate it on the shelf.',
    modeCrashed: 'This way of choosing books stopped with an error. The rest of the page still works.',
    findDroppedOne: 'This way of choosing books named one book it could not show: {list}.',
    findDroppedMany: 'This way of choosing books named {n} books it could not show: {list}.',
    aPick: 'a pick',
    dropUnknown: 'is not in the book list',
    dropRepeat: 'is named twice',
    dropShelf: 'is already on your shelf',
    dropNoWhy: 'has no reason',
    dropWhyLong: 'has a reason that is too long',
    dropWhyStock: 'has a reason that does not say anything',
    dropSeventh: 'is a seventh book, and six is the most',
    dropBad: 'is not a book with an id',
    // the model box, a second opinion
    modelAsk: 'Want a second opinion? Copy this into any AI chat.',
    modelNoSend: 'Nothing is sent from this page. You copy the words, paste them into a chat, and paste the answer back.',
    modelPromptLabel: 'The words to copy',
    modelCopy: 'Copy',
    modelCopied: 'The words were copied.',
    modelCopyFailed: 'This browser did not copy the words. Select the words in the box and copy them.',
    modelAnswerLabel: "Paste the chat's answer here",
    modelAnswerPlaceholder: 'Paste the answer here.',
    modelCheck: 'Read the answer',
    modelNeedAnswer: 'Paste the answer first.',
    modelNothing: 'There are no books here to argue about, so this box stays closed.',
    modelShelfClosed: 'This way of choosing books can pick books already on your shelf, so this box stays closed. Your shelf never goes into a chat.',
    modelNoPick: 'This page could not find a pick in that answer.',
    modelDropped: 'Dropped: {said}',
    modelFromChat: 'From the chat',
    modelSaidLine: 'The chat said: "{sentence}"',
    modelLibraryLink: "Open the library's page",
    // the facets input's "from some words" half
    wordsOpen: 'From some words',
    wordsHint: 'Paste an event, a headline or a wish about what you want to read. This page writes words you can copy into any chat.',
    wordsTextLabel: 'The words you paste',
    wordsPlaceholder: 'Paste an event, a headline or a wish here.',
    wordsPromptEmpty: 'Paste some words above, and the words to copy will appear here.',
    wordsCheck: 'Use the answer',
    wordsNeedWords: 'Paste some words first.',
    wordsReadFailed: 'This page could not read that answer. Try pasting it again.',
    wordsTicked: 'Ticked: {list}.',
    wordsNoneKept: 'The chat did not name any subject in this list.',
    wordsNoSubject: 'This list has no subject called {name}.',
    wordsNoSubjects: 'This list has no subjects called {list}.',
    wordsOverOne: 'You can pick four subjects at most, so {name} was not ticked.',
    wordsOverMany: 'You can pick four subjects at most, so these were not ticked: {list}.',
    // the self-test
    selftestHeading: 'Self-test',
    selftestIntro: 'This page checks the app in your browser. Nothing to install.',
    dataHeading: 'What this copy has',
    dataSlice: 'Book list: {n} books, dated {date}.',
    dataSliceOne: 'Book list: 1 book, dated {date}.',
    dataSliceNoDate: 'Book list: {n} books.',
    dataSliceMissing: 'The book list did not load.',
    dataTags: 'Our own words for {n} books.',
    dataTagsOne: 'Our own words for 1 book.',
    dataTagsMissing: 'This copy has no words for the books.',
    dataPractice: 'Practice shelf: {n} books.',
    dataPracticeOne: 'Practice shelf: 1 book.',
    dataPracticeMissing: 'This copy has no practice shelf.',
    dataFound: 'Books found for you: {n}, dated {date}.',
    dataFoundOne: 'Books found for you: 1, dated {date}.',
    dataFoundNoDate: 'Books found for you: {n}.',
    dataFoundMissing: 'No books found for you in this copy.',
    dataEvents: 'Library events: {n}, dated {date}.',
    dataEventsOne: 'Library events: 1, dated {date}.',
    dataEventsNoDate: 'Library events: {n}.',
    dataEventsMissing: 'No library events in this copy.',
    savingNow: 'This browser is saving your shelf.',
    modesHeading: 'Ways of choosing books',
    runButton: 'Run the checks',
    runNoModes: 'No ways of choosing books are loaded, so there is nothing to check.',
    modeHeading: '{name} ({id})',
    modeSummary: '{pass} passed, {fail} failed.',
    passWord: 'Passed: {msg}',
    failWord: 'Failed: {msg}',
    allPassed: 'All checks passed.',
    someFailed: '{n} checks failed.',
    someFailedOne: '1 check failed.',
    checkCrashed: 'The checks stopped with an error: {msg}'
  });

  // The shell is last in the page, but a build may load it earlier.
  if (doc && typeof doc.getElementById === 'function') {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(window);
