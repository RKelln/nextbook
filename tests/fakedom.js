'use strict';
// A very small DOM: just enough for core/shell.js to draw its screens in a vm, so a test can
// click, type and read the result without a browser. It is not a browser and does not pretend
// to be one: no layout, no CSS, no events the shell does not use. Elements keep attributes,
// child nodes, listeners, `value` (a plain property, as a browser's input has) and `focus()`,
// which moves document.activeElement, so the focus fix can be checked by machine.
//
// AGENTS.md keeps app elements safe; this file is test-only scaffolding and never ships.

function createDocument() {
  var doc = {
    readyState: 'complete',
    activeElement: null,
    listeners: {},
  };

  function makeElement(tag) {
    var el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      childNodes: [],
      parentNode: null,
      ownerDocument: doc,
      attributes: {},
      listeners: {},
      value: '',
      selectedIndex: 0,
    };

    el.appendChild = function (child) {
      if (!child) return child;
      child.parentNode = el;
      el.childNodes.push(child);
      return child;
    };
    el.removeChild = function (child) {
      var i = el.childNodes.indexOf(child);
      if (i !== -1) el.childNodes.splice(i, 1);
      child.parentNode = null;
      return child;
    };
    el.setAttribute = function (name, value) { el.attributes[String(name)] = String(value); };
    el.getAttribute = function (name) {
      var key = String(name);
      return Object.prototype.hasOwnProperty.call(el.attributes, key) ? el.attributes[key] : null;
    };
    el.hasAttribute = function (name) { return el.getAttribute(name) !== null; };
    el.addEventListener = function (name, fn) {
      (el.listeners[String(name)] = el.listeners[String(name)] || []).push(fn);
    };
    el.removeEventListener = function (name, fn) {
      var list = el.listeners[String(name)] || [];
      var i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    };
    el.dispatch = function (name, event) {
      var seen = event || { type: String(name), target: el, preventDefault: function () {} };
      (el.listeners[String(name)] || []).forEach(function (fn) { fn(seen); });
    };
    el.click = function () { el.dispatch('click'); };
    el.focus = function () { doc.activeElement = el; };
    el.blur = function () { if (doc.activeElement === el) doc.activeElement = doc.body; };
    el.querySelectorAll = function (selector) { return collect(el, selector); };

    Object.defineProperty(el, 'firstChild', {
      get: function () { return el.childNodes.length ? el.childNodes[0] : null; },
    });
    Object.defineProperty(el, 'children', {
      get: function () { return el.childNodes.filter(function (c) { return c.nodeType === 1; }); },
    });
    Object.defineProperty(el, 'options', {
      get: function () {
        return el.childNodes.filter(function (c) { return c.nodeType === 1 && c.tagName === 'OPTION'; });
      },
    });
    Object.defineProperty(el, 'textContent', {
      get: function () {
        return el.childNodes.map(function (c) {
          return c && typeof c.textContent === 'string' ? c.textContent : '';
        }).join('');
      },
      set: function (value) {
        el.childNodes = [];
        if (value !== undefined && value !== null && String(value) !== '') {
          el.appendChild(doc.createTextNode(value));
        }
      },
    });

    return el;
  }

  function collect(node, selector) {
    var out = [];
    var want = String(selector);
    var named = /^\[([a-zA-Z0-9:-]+)\]$/.exec(want);
    function visit(n) {
      if (!n || n.nodeType !== 1) return;
      if (want === '[data-test]' && n.getAttribute('data-test') !== null) out.push(n);
      else if (named && n.getAttribute(named[1]) !== null) out.push(n);
      else if (want.charAt(0) === '#' && n.getAttribute('id') === want.slice(1)) out.push(n);
      else if (want.charAt(0) === '.' && n.getAttribute('class') !== null &&
        (' ' + n.getAttribute('class') + ' ').indexOf(' ' + want.slice(1) + ' ') !== -1) out.push(n);
      (n.childNodes || []).forEach(function (c) { if (c && c.nodeType === 1) visit(c); });
    }
    (node.childNodes || []).forEach(visit);
    return out;
  }

  doc.createElement = function (tag) { return makeElement(tag); };
  doc.createTextNode = function (text) {
    return { nodeType: 3, textContent: String(text), parentNode: null };
  };
  doc.documentElement = makeElement('html');
  doc.head = makeElement('head');
  doc.body = makeElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  doc.getElementById = function (id) {
    var found = collect(doc.documentElement, '#' + String(id));
    return found.length ? found[0] : null;
  };
  doc.querySelectorAll = function (selector) { return collect(doc.documentElement, selector); };
  doc.addEventListener = function (name, fn) {
    (doc.listeners[String(name)] = doc.listeners[String(name)] || []).push(fn);
  };

  return doc;
}

function all(root, selector) { return root.querySelectorAll(selector); }

function byTest(root, test) {
  var hits = all(root, '[data-test]').filter(function (el) {
    return el.getAttribute('data-test') === test;
  });
  return hits.length ? hits[0] : null;
}

function withPrefix(root, prefix) {
  return all(root, '[data-test]').filter(function (el) {
    return el.getAttribute('data-test').indexOf(prefix) === 0;
  });
}

function formAround(el) {
  var node = el;
  while (node && node.tagName !== 'FORM') node = node.parentNode;
  return node;
}

function submit(el) {
  var form = formAround(el);
  if (!form) throw new Error('no form around this element');
  form.dispatch('submit', { type: 'submit', target: form, preventDefault: function () {} });
  return form;
}

module.exports = { createDocument, all, byTest, withPrefix, formAround, submit };
