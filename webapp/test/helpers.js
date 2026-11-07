'use strict';
const fs = require('fs');
const path = require('path');
// The library as shipped: the CommonJS build of src/lib (npm test builds it first).
const MB = require('../build/lib/index.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const PATCHES_DIR = process.env.MB_PATCHES_DIR || path.join(REPO_ROOT, 'patches');
const GENERATED_DIR = path.join(__dirname, 'fixtures', 'generated');

/** Known-good reference .syx files (repo-root patches/). Drop more in and they are tested too. */
function referencePatches() {
  if (!fs.existsSync(PATCHES_DIR)) return [];
  return fs.readdirSync(PATCHES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.syx'))
    .sort()
    .map((f) => ({ name: f, bytes: fs.readFileSync(path.join(PATCHES_DIR, f)) }));
}

/** Deterministic PRNG (mulberry32) so failures are reproducible from the seed. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  return next;
}

/**
 * Random choices a user could make in the web form (disabled options cannot be
 * picked by a user). Source fields are biased towards "enabled" so dependent
 * fields get exercised.
 */
function randomUserValues(r, { density = 0.6 } = {}) {
  const values = {};
  for (const f of MB.Form.FIELDS) {
    const isSrc = f.column.field === 'src';
    if (!isSrc && !r.chance(density)) continue;
    const choices = f.options.filter((o) => !o.disabled);
    if (isSrc && r.chance(0.85)) {
      const nonZero = choices.filter((o) => o.value !== '0');
      values[f.name] = r.pick(nonZero).value;
    } else {
      values[f.name] = r.pick(choices).value;
    }
  }
  return values;
}

const BLOCKS = [1, 11, 12, 13, 14, 21, 22, 23, 24, ...Array.from({ length: 12 }, (_, i) => 31 + i)];
const PARAMS = [1, 2, 3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 98, 99, 100];
const SOURCES = [0, 1, 2, 3, 4, 5, 11, 12, 13, 14, 20, 21, 22, 23, 24, 25, 26, 127];
const INTERESTING = [0, 1, 2, 3, 4, 5, 6, 12, 15, 16, 17, 20, 24, 38, 60, 64, 98, 99, 100, 120, 125, 126, 127];

/**
 * Random but well-framed Mutant Brain SysEx: arbitrary order, duplicates,
 * params the page ignores, odd values (all 7-bit so the file is valid MIDI).
 */
function randomSysex(r, { maxParams = 120 } = {}) {
  const n = r.int(0, maxParams);
  const bytes = [0xF0, 0x00, 0x7F, r.chance(0.1) ? 0x12 : 0x15];
  for (let i = 0; i < n; i++) {
    const block = r.pick(BLOCKS);
    const param = r.chance(0.9) ? r.pick(PARAMS) : r.int(0, 127);
    let v1;
    if (param === 1) v1 = r.chance(0.9) ? r.pick(SOURCES) : r.int(0, 127);
    else if (param === 2) v1 = r.chance(0.9) ? r.int(0, 2) : r.int(0, 127);
    else if (param === 12) v1 = r.chance(0.9) ? r.int(0, 3) : r.int(0, 127);
    else v1 = r.chance(0.7) ? 0 : r.int(0, 127);
    const v2 = r.chance(0.5) ? r.pick(INTERESTING) : r.int(0, 127);
    bytes.push(block, param, v1, v2);
  }
  bytes.push(0xF7);
  return Uint8Array.from(bytes);
}

/**
 * Form option string -> Editor typed value, written independently of the
 * library ("inf" -> "gate", keywords stay, everything else is a number).
 */
function typedValue(fieldName, optionValue) {
  const kind = MB.Form.field(fieldName).column.kind;
  if (kind === 'channel' && (optionValue === 'default' || optionValue === 'omni')) return optionValue;
  if (kind === 'duration' && optionValue === 'inf') return 'gate';
  if (kind === 'duration' && (optionValue === 'retrig' || optionValue === 'default')) return optionValue;
  return Number(optionValue);
}

/** Build an Editor state that shows the given form values (in page order). */
function editorStateFor(values, start = MB.Editor.create()) {
  let state = start;
  for (const f of MB.Form.FIELDS) {
    if (f.name in values) state = MB.Editor.set(state, MB.Editor.refOf(f.name), typedValue(f.name, values[f.name]));
  }
  return state;
}

/** "f0007f15 0102000a ..." for readable assertion diffs. */
function hexGroups(bytes) {
  const h = Buffer.from(bytes).toString('hex');
  return [h.slice(0, 8), ...(h.slice(8, -2).match(/.{8}/g) || []), h.slice(-2)].join(' ');
}

module.exports = {
  MB, REPO_ROOT, PATCHES_DIR, GENERATED_DIR, referencePatches, rng, randomUserValues, randomSysex, hexGroups,
  typedValue, editorStateFor,
};
