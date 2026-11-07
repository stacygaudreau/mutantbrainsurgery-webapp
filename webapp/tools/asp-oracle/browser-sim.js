'use strict';
/**
 * Minimal browser simulation for the HTML rendered by the ORIGINAL patch.asp.
 *
 * It reproduces exactly the browser behaviours the old site depended on:
 *   1. <select> displayed value: the LAST option carrying `selected`, else the
 *      first non-disabled option (HTML "selectedness setting algorithm").
 *   2. The page's own inline <script> blocks (XAble_Input / XAble_CVOutput /
 *      XAble_GateOutput) are executed verbatim against a fake DOM, so field
 *      enable/disable state comes from the original JavaScript.
 *   3. Form submission: disabled <select>s are not submitted, and a select whose
 *      selected <option> is disabled submits nothing (HTML form data set rules).
 */
const vm = require('vm');

const ENTITIES = { '&dagger;': '\u2020', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': '\u00a0' };
const decodeEntities = (s) => s.replace(/&[a-z]+;/g, (e) => (e in ENTITIES ? ENTITIES[e] : e));

/** Parse every <select> of the rendered page. */
function parseSelects(html) {
  const selects = [];
  const selRe = /<select name="([^"]*)" id="([^"]*)">([\s\S]*?)<\/select>/g;
  let m;
  while ((m = selRe.exec(html))) {
    const [, name, id, inner] = m;
    if (name !== id) throw new Error(`select name/id mismatch: ${name} vs ${id}`);
    const options = [];
    const optRe = /<option value="([^"]*)"((?: selected| disabled)*)>([\s\S]*?)<\/option>/g;
    let o;
    while ((o = optRe.exec(inner))) {
      options.push({
        value: o[1],
        label: decodeEntities(o[3]),
        selected: o[2].includes(' selected'),
        disabled: o[2].includes(' disabled'),
      });
    }
    // sanity: every <option in the select must have been parsed
    const count = (inner.match(/<option/g) || []).length;
    if (count !== options.length) throw new Error(`could not parse all options of ${name}`);
    let idx = -1;
    options.forEach((op, i) => { if (op.selected) idx = i; });
    if (idx === -1) idx = options.findIndex((op) => !op.disabled);
    selects.push({ name, options, selectedIndex: idx });
  }
  return selects;
}

function parseScripts(html) {
  const out = [];
  const re = /<script language="javascript">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/**
 * A loaded page: fake DOM + original scripts executed.
 */
// many pages share identical HTML (every fuzzed form starts from the fresh page):
// parse once, share the (read-only) option lists
let lastHtml = null;
let lastSelects = null;
function parseSelectsCached(html) {
  if (html !== lastHtml) { lastSelects = parseSelects(html); lastHtml = html; }
  return lastSelects;
}

class SimPage {
  constructor(html) {
    this.error = /ERROR IN SYSEX FILE - NOT LOADED!!/.test(html);
    this.selects = parseSelectsCached(html);
    this.byName = new Map();
    this.elements = this.selects.map((s) => {
      const el = {
        id: s.name,
        options: s.options,
        selectedIndex: s.selectedIndex,
        disabled: false,
        onchange: null,
        get value() { return this.selectedIndex >= 0 ? this.options[this.selectedIndex].value : ''; },
        set value(v) {
          // browser semantics: picks the first option with that value, else none
          this.selectedIndex = this.options.findIndex((op) => op.value === String(v));
        },
      };
      this.byName.set(s.name, el);
      return el;
    });
    const document = {
      forms: [{}, {}],
      getElementById: (id) => this.byName.get(id) || null,
    };
    const ctx = vm.createContext({ document });
    for (const code of parseScripts(html)) vm.runInContext(code, ctx);
  }

  /** Values as displayed (what select.value returns). */
  values() {
    const v = {};
    for (const el of this.elements) v[el.id] = el.value;
    return v;
  }

  /** Enabled state per field, as set by the original page JavaScript. */
  enabled() {
    const v = {};
    for (const el of this.elements) v[el.id] = !el.disabled;
    return v;
  }

  /** Simulate the user picking values, firing each changed select's onchange. */
  setValues(values) {
    for (const [name, val] of Object.entries(values)) {
      const el = this.byName.get(name);
      if (!el) throw new Error(`no such field ${name}`);
      el.value = val;
      if (el.selectedIndex === -1) throw new Error(`field ${name} has no option ${val}`);
    }
    // a real user edits one field at a time and each edit fires onchange; the
    // XAble functions are pure functions of current values, so firing them all
    // once at the end yields the same final state.
    for (const el of this.elements) if (el.onchange) el.onchange.call(el);
  }

  /** The name/value pairs a browser would POST to get_sysex.asp. */
  submission() {
    const out = {};
    for (const el of this.elements) {
      if (el.disabled || el.selectedIndex < 0) continue;
      const op = el.options[el.selectedIndex];
      if (op.disabled) continue;
      out[el.id] = op.value;
    }
    return out;
  }
}

module.exports = { SimPage, parseSelects, decodeEntities };
