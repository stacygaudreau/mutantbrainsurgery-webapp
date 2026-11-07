'use strict';
/** Unit tests for the SysEx codec layer (sysex.inc WriteSysex / ReadSysex port). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { MB, rng, randomSysex, hexGroups } = require('./helpers');

const { MutantBrainPatch, MutantBrainError, SOURCE, CHAN, DURATION, PARAM } = MB;
const HEADER = [0xF0, 0x00, 0x7F, 0x15];
const syx = (...params) => Uint8Array.from([...HEADER, ...params.flat(), 0xF7]);
const paramsFor = (patch, block) => patch.toParams().filter((p) => p[0] === block);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof MutantBrainError && e instanceof Error && e.code === code);

// ---------------------------------------------------------------- module shape

test('module exposes the codec API and constants', () => {
  assert.equal(typeof MutantBrainPatch, 'function');
  assert.equal(typeof MutantBrainPatch.fromSysex, 'function');
  assert.deepEqual([...MB.MANUFACTURER_ID], [0x00, 0x7F, 0x15]);
  assert.equal(MB.NUM_INPUTS, 4);
  assert.equal(MB.NUM_CVS, 4);
  assert.equal(MB.NUM_GATES, 12);
  assert.ok(Object.isFrozen(MB) && Object.isFrozen(MB.SOURCE));
  assert.equal(MB.DEFAULT_FILENAME, 'mutantbrain.syx');
});

test('works as a browser global (UMD) when no module system exists', () => {
  const vm = require('vm');
  const fs = require('fs');
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../public/lib/mutantbrain-sysex.js'), 'utf8'), ctx);
  const G = ctx.MutantBrainSysex;
  assert.ok(G && typeof G.MutantBrainPatch === 'function');
  assert.equal(G.MutantBrainPatch.fromSysex(new G.MutantBrainPatch().toSysex()).toSysex().length, 4 + 58 * 4 + 1);
});

test('works with ESM import (Node CommonJS interop)', async () => {
  const mod = await import('../public/lib/mutantbrain-sysex.js');
  assert.equal(typeof mod.default.MutantBrainPatch, 'function');
});

// ---------------------------------------------------------------- defaults

test('constructor defaults mirror sysex.inc Class_Initialize', () => {
  const p = new MutantBrainPatch();
  assert.deepEqual(p.globals, { chanType: CHAN.SPECIFIC, chanNumber: 1, durationType: DURATION.MS, duration: 15 });
  assert.equal(p.inputs.length, 4);
  assert.equal(p.cvOutputs.length, 4);
  assert.equal(p.gates.length, 12);
  assert.deepEqual(p.inputs[0], { source: 0, chanType: 2, chanNumber: 0, priority: 3, minNote: 0, maxNote: 127, minVel: 0, bendRange: 3 });
  assert.deepEqual(p.cvOutputs[0], { source: 0, inputEvent: 0, transpose: 64, chanType: 2, chanNumber: 0, cc: 1, volts: 5, pitchScheme: 0 });
  assert.deepEqual(p.gates[0], {
    source: 0, inputEvent: 1, chanType: 2, chanNumber: 0, minNote: 0, maxNote: 127, minVel: 0, cc: 0,
    threshold: 64, divider: 6, offset: 0, durationType: 2, duration: 0,
  });
  // rows are independent objects
  p.inputs[0].source = 1;
  assert.equal(p.inputs[1].source, 0);
  assert.equal(new MutantBrainPatch().inputs[0].source, 0);
});

test('can be called without new', () => {
  assert.ok(MutantBrainPatch() instanceof MutantBrainPatch); // eslint-disable-line new-cap
});

// ---------------------------------------------------------------- encoding

test('encodes the default patch: framing, order, length', () => {
  const b = new MutantBrainPatch().toSysex();
  assert.ok(b instanceof Uint8Array);
  assert.deepEqual([...b.subarray(0, 4)], HEADER);
  assert.equal(b[b.length - 1], 0xF7);
  // 2 global + 4x7 input + 4x1 cv + 12x2 gate = 58 params
  assert.equal(b.length, 4 + 58 * 4 + 1);
  const blocks = new MutantBrainPatch().toParams().map((p) => p[0]);
  const order = [...new Set(blocks)];
  assert.deepEqual(order, [1, 11, 12, 13, 14, 21, 22, 23, 24, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]);
});

test('globals encode CHAN then GATE_DUR', () => {
  const p = new MutantBrainPatch();
  Object.assign(p.globals, { chanType: 0, chanNumber: 10, durationType: 1, duration: 25 });
  assert.deepEqual(paramsFor(p, 1), [[1, 2, 0, 10], [1, 12, 1, 25]]);
});

test('note inputs always encode all 7 params in order', () => {
  const p = new MutantBrainPatch();
  Object.assign(p.inputs[2], { source: 1, chanType: 0, chanNumber: 3, priority: 9, minNote: 36, maxNote: 60, minVel: 10, bendRange: 12 });
  assert.deepEqual(paramsFor(p, 13), [[13, 1, 1, 0], [13, 2, 0, 3], [13, 3, 0, 36], [13, 4, 0, 60], [13, 5, 0, 10], [13, 7, 0, 12], [13, 8, 0, 9]]);
});

test('CV output params depend on source and event', () => {
  const cases = [
    [{ source: 11, inputEvent: 1, pitchScheme: 2, transpose: 76 }, [[21, 1, 11, 1], [21, 16, 0, 2], [21, 14, 0, 76]]],
    [{ source: 14, inputEvent: 4 }, [[21, 1, 14, 4], [21, 16, 0, 0], [21, 14, 0, 64]]],
    [{ source: 12, inputEvent: 20, volts: 8 }, [[21, 1, 12, 20], [21, 15, 0, 8]]],
    [{ source: 13, inputEvent: 0 }, [[21, 1, 13, 0]]],          // event not 1-4/20: src only
    [{ source: 13, inputEvent: 5 }, [[21, 1, 13, 5]]],
    [{ source: 2, cc: 74, chanType: 1, chanNumber: 0, volts: 3 }, [[21, 1, 2, 74], [21, 2, 1, 0], [21, 15, 0, 3]]],
    [{ source: 3, cc: 7 }, [[21, 1, 3, 7], [21, 2, 2, 0], [21, 15, 0, 5]]],
    [{ source: 4, chanType: 0, chanNumber: 16 }, [[21, 1, 4, 0], [21, 2, 0, 16], [21, 15, 0, 5]]],
    [{ source: 5, volts: 1 }, [[21, 1, 5, 0], [21, 2, 2, 0], [21, 15, 0, 1]]],
    [{ source: 20, volts: 8 }, [[21, 1, 20, 0]]],               // BPM: range NOT sent (original behaviour)
    [{ source: 127, volts: 2 }, [[21, 1, 127, 0]]],             // Fixed voltage: range NOT sent
    [{ source: 0 }, [[21, 1, 0, 0]]],
  ];
  for (const [cfg, expected] of cases) {
    const p = new MutantBrainPatch();
    Object.assign(p.cvOutputs[0], cfg);
    assert.deepEqual(paramsFor(p, 21), expected, JSON.stringify(cfg));
  }
});

test('gate output params depend on source; duration always last', () => {
  const cases = [
    [{ source: 11, inputEvent: 0 }, [[31, 1, 11, 0]]],
    [{ source: 1, minNote: 36, chanType: 0, chanNumber: 10, maxNote: 38, minVel: 64 }, [[31, 1, 1, 36], [31, 2, 0, 10], [31, 4, 0, 38], [31, 5, 0, 64]]],
    [{ source: 2, cc: 64, chanType: 1, threshold: 100 }, [[31, 1, 2, 64], [31, 2, 1, 0], [31, 13, 0, 100]]],
    [{ source: 3, cc: 1 }, [[31, 1, 3, 1], [31, 2, 2, 0], [31, 13, 0, 64]]],
    [{ source: 20, divider: 24, offset: 12 }, [[31, 1, 20, 24], [31, 11, 0, 12]]],
    [{ source: 21, divider: 1 }, [[31, 1, 21, 1], [31, 11, 0, 0]]],
    [{ source: 22 }, [[31, 1, 22, 0]]],
    [{ source: 23 }, [[31, 1, 23, 0]]],
    [{ source: 25 }, [[31, 1, 25, 0]]],
    [{ source: 26 }, [[31, 1, 26, 0]]],
    [{ source: 0 }, [[31, 1, 0, 0]]],
  ];
  for (const [cfg, expected] of cases) {
    for (const dur of [[0, 0], [1, 40], [2, 0], [3, 0]]) {
      const p = new MutantBrainPatch();
      Object.assign(p.gates[0], cfg, { durationType: dur[0], duration: dur[1] });
      assert.deepEqual(paramsFor(p, 31), [...expected, [31, 12, ...dur]], JSON.stringify(cfg));
    }
  }
});

test('gate 12 / cv D / input 4 use the last block ids', () => {
  const p = new MutantBrainPatch();
  p.gates[11].source = SOURCE.MIDI_RUN;
  p.cvOutputs[3].source = SOURCE.MIDI_BEND;
  p.inputs[3].source = 1;
  assert.deepEqual(paramsFor(p, 42), [[42, 1, 22, 0], [42, 12, 2, 0]]);
  assert.equal(paramsFor(p, 24)[0][2], 4);
  assert.equal(paramsFor(p, 14)[0][2], 1);
});

test('encoder rejects values that are not 7-bit integers', () => {
  for (const bad of [128, 255, -1, 1.5, NaN, Infinity, '5', null, undefined]) {
    const p = new MutantBrainPatch();
    p.inputs[0].minNote = bad;
    throwsCode(() => p.toSysex(), 'INVALID_VALUE');
  }
  // a bad value in a field that is not transmitted does not matter
  const p = new MutantBrainPatch();
  p.cvOutputs[0].volts = 999; // source disabled => volts not sent
  assert.doesNotThrow(() => p.toSysex());
});

test('INVALID_VALUE message names the block and param', () => {
  const p = new MutantBrainPatch();
  p.gates[4].duration = 200;
  p.gates[4].durationType = 1;
  assert.throws(() => p.toSysex(), /gt5 GATE_DUR/);
});

// ---------------------------------------------------------------- decoding

test('decodes the simplest valid file (no params) to defaults', () => {
  const p = MutantBrainPatch.fromSysex(syx());
  assert.deepEqual(p.toJSON(), new MutantBrainPatch().toJSON());
});

test('accepts Uint8Array, Buffer, ArrayBuffer, DataView and number[]', () => {
  const bytes = syx([1, 2, 0, 7]);
  const forms = [bytes, Buffer.from(bytes), bytes.buffer.slice(0), new DataView(bytes.buffer), [...bytes]];
  for (const f of forms) assert.equal(MutantBrainPatch.fromSysex(f).globals.chanNumber, 7);
  // a view into a larger buffer must respect its offset
  const big = new Uint8Array(100);
  big.set(bytes, 10);
  assert.equal(MutantBrainPatch.fromSysex(big.subarray(10, 10 + bytes.length)).globals.chanNumber, 7);
});

test('rejects non-byte input', () => {
  for (const bad of [null, undefined, 'F0007F15F7', 42, {}, [0xF0, 300], [0xF0, -1], [0xF0, 1.5]]) {
    throwsCode(() => MutantBrainPatch.fromSysex(bad), 'BAD_INPUT');
  }
});

test('BAD_HEADER for anything that is not a Mutant Brain SysEx', () => {
  const bad = [[], [0xF0], [0xF0, 0, 0x7F], [0xF1, 0, 0x7F, 0x15, 0xF7], [0xF0, 1, 0x7F, 0x15, 0xF7],
    [0xF0, 0, 0x7E, 0x15, 0xF7], [0xF0, 0, 0x7F, 0x16, 0xF7], [0xF0, 0x43, 0x10, 0x4C, 0xF7]];
  for (const b of bad) throwsCode(() => MutantBrainPatch.fromSysex(b), 'BAD_HEADER');
});

test('legacy manufacturer id 00 7F 12 is accepted on load, re-saved as 00 7F 15', () => {
  const p = MutantBrainPatch.fromSysex([0xF0, 0, 0x7F, 0x12, 1, 2, 0, 5, 0xF7]);
  assert.equal(p.globals.chanNumber, 5);
  assert.deepEqual([...p.toSysex().subarray(0, 4)], HEADER);
});

test('MISSING_END and TRUNCATED framing errors', () => {
  throwsCode(() => MutantBrainPatch.fromSysex(HEADER), 'MISSING_END');
  throwsCode(() => MutantBrainPatch.fromSysex([...HEADER, 1, 2, 0, 5]), 'MISSING_END');
  throwsCode(() => MutantBrainPatch.fromSysex([...HEADER, 1, 2, 0]), 'TRUNCATED');
  throwsCode(() => MutantBrainPatch.fromSysex([...HEADER, 1, 2, 0, 5, 1, 0xF7]), 'TRUNCATED');
});

test('UNKNOWN_BLOCK for block ids the module does not have', () => {
  for (const block of [0, 2, 10, 15, 20, 25, 30, 43, 100, 127]) {
    throwsCode(() => MutantBrainPatch.fromSysex(syx([block, 1, 0, 0])), 'UNKNOWN_BLOCK');
  }
});

test('bytes after F7 are ignored; F7 only terminates at a param boundary', () => {
  const p = MutantBrainPatch.fromSysex([...syx([1, 2, 0, 9]), 0xF0, 0x99, 0x12]);
  assert.equal(p.globals.chanNumber, 9);
  // F7 inside a param is data (the original parser behaved the same way)
  const q = MutantBrainPatch.fromSysex(syx([11, 3, 0, 0xF7]));
  assert.equal(q.inputs[0].minNote, 0xF7);
  throwsCode(() => q.toSysex(), 'INVALID_VALUE');
});

test('unknown params for a known block are ignored', () => {
  const p = MutantBrainPatch.fromSysex(syx([1, 99, 5, 5], [11, 9, 1, 1], [21, 98, 0, 70], [21, 99, 0, 60], [31, 3, 0, 50], [31, 100, 1, 1]));
  assert.deepEqual(p.toJSON(), new MutantBrainPatch().toJSON());
});

test('later params override earlier ones', () => {
  const p = MutantBrainPatch.fromSysex(syx([1, 2, 0, 3], [1, 2, 1, 0]));
  assert.deepEqual([p.globals.chanType, p.globals.chanNumber], [1, 0]);
});

test('decoding SRC sets the source-dependent secondary value', () => {
  const p = MutantBrainPatch.fromSysex(syx(
    [21, 1, 12, 20], [22, 1, 2, 33], [23, 1, 3, 44], [24, 1, 4, 55],
    [31, 1, 13, 5], [32, 1, 1, 61], [33, 1, 2, 62], [34, 1, 3, 63], [35, 1, 20, 24], [36, 1, 21, 96], [37, 1, 22, 99],
    [11, 1, 1, 77],
  ));
  assert.deepEqual([p.cvOutputs[0].source, p.cvOutputs[0].inputEvent], [12, 20]);
  assert.deepEqual([p.cvOutputs[1].source, p.cvOutputs[1].cc], [2, 33]);
  assert.deepEqual([p.cvOutputs[2].source, p.cvOutputs[2].cc], [3, 44]);
  assert.deepEqual([p.cvOutputs[3].source, p.cvOutputs[3].cc, p.cvOutputs[3].inputEvent], [4, 1, 0]); // v2 ignored
  assert.deepEqual([p.gates[0].source, p.gates[0].inputEvent], [13, 5]);
  assert.deepEqual([p.gates[1].source, p.gates[1].minNote], [1, 61]);
  assert.deepEqual([p.gates[2].source, p.gates[2].cc], [2, 62]);
  assert.deepEqual([p.gates[3].source, p.gates[3].cc], [3, 63]);
  assert.deepEqual([p.gates[4].source, p.gates[4].divider], [20, 24]);
  assert.deepEqual([p.gates[5].source, p.gates[5].divider], [21, 96]);
  assert.deepEqual([p.gates[6].source, p.gates[6].divider, p.gates[6].cc], [22, 6, 0]); // v2 ignored
  assert.deepEqual([p.inputs[0].source, p.inputs[0].minNote], [1, 0]); // input SRC v2 ignored
});

test('decodes every other param into the right field', () => {
  const p = MutantBrainPatch.fromSysex(syx(
    [1, 12, 3, 0], [12, 2, 1, 0], [12, 3, 0, 10], [12, 4, 0, 20], [12, 5, 0, 30], [12, 7, 0, 12], [12, 8, 0, 11],
    [22, 2, 0, 16], [22, 15, 0, 7], [22, 16, 0, 1], [22, 14, 0, 28],
    [40, 2, 0, 4], [40, 4, 0, 90], [40, 5, 0, 91], [40, 12, 1, 120], [40, 11, 0, 23], [40, 13, 0, 127],
  ));
  assert.deepEqual([p.globals.durationType, p.globals.duration], [3, 0]);
  assert.deepEqual(p.inputs[1], { source: 0, chanType: 1, chanNumber: 0, priority: 11, minNote: 10, maxNote: 20, minVel: 30, bendRange: 12 });
  assert.deepEqual(p.cvOutputs[1], { source: 0, inputEvent: 0, transpose: 28, chanType: 0, chanNumber: 16, cc: 1, volts: 7, pitchScheme: 1 });
  const g = p.gates[9];
  assert.deepEqual([g.chanType, g.chanNumber, g.maxNote, g.minVel, g.durationType, g.duration, g.offset, g.threshold], [0, 4, 90, 91, 1, 120, 23, 127]);
});

test('parseParams returns raw groups without interpretation', () => {
  assert.deepEqual(MutantBrainPatch.parseParams(syx([1, 2, 0, 5], [99, 1, 2, 3])), [[1, 2, 0, 5], [99, 1, 2, 3]]);
});

test('applyParam is chainable and can build a patch incrementally', () => {
  const p = new MutantBrainPatch().applyParam(1, PARAM.CHAN, 0, 4).applyParam(31, PARAM.SRC, SOURCE.MIDI_NOTE, 40);
  assert.equal(p.globals.chanNumber, 4);
  assert.equal(p.gates[0].minNote, 40);
});

// ---------------------------------------------------------------- properties

test('property: encode(decode(x)) is a fixed point for any decodable random SysEx', () => {
  const r = rng(0xC0FFEE);
  for (let i = 0; i < 2000; i++) {
    const bytes = randomSysex(r);
    const once = MutantBrainPatch.fromSysex(bytes).toSysex();
    const twice = MutantBrainPatch.fromSysex(once).toSysex();
    assert.equal(hexGroups(twice), hexGroups(once), `seed case ${i}`);
  }
});

test('property: repeated load+save reaches a fixed point after at most 2 passes', () => {
  // Not always after 1 pass, faithfully to the original site: a CC that is one
  // of the disabled dropdown options (6/38/98/99) is shown selected but not
  // submitted => saved as 0; on the next load 0 has no option => shows 1.
  // (See form.test.js "disabled CC option" and the oracle differential tests.)
  const r = rng(12345);
  let needSecondPass = 0;
  for (let i = 0; i < 1000; i++) {
    const n1 = MutantBrainPatch.fromSysex(randomSysex(r)).normalize().toSysex();
    const n2 = MutantBrainPatch.fromSysex(n1).normalize().toSysex();
    const n3 = MutantBrainPatch.fromSysex(n2).normalize().toSysex();
    assert.equal(hexGroups(n3), hexGroups(n2), `case ${i}`);
    if (hexGroups(n2) !== hexGroups(n1)) {
      needSecondPass++;
      // the only first-pass instability is a MIDI-CC cc going 0 -> 1
      const diff = MutantBrainPatch.parseParams(n1).map((p, k) => [p, MutantBrainPatch.parseParams(n2)[k]])
        .filter(([a, b]) => String(a) !== String(b));
      for (const [a, b] of diff) {
        assert.deepEqual([a[1], a[3], b[3]], [1, 0, 1], `unexpected instability ${a} -> ${b}`);
        assert.ok(a[2] === 2 || a[2] === 3, 'source is MIDI CC');
      }
    }
  }
  assert.ok(needSecondPass > 0, 'generator should hit the disabled-CC case');
});

test('property: once normalized, a patch survives load+save unchanged', () => {
  const r = rng(777);
  for (let i = 0; i < 1000; i++) {
    const stable = MutantBrainPatch.fromSysex(MutantBrainPatch.fromSysex(randomSysex(r)).normalize().toSysex()).normalize();
    assert.equal(hexGroups(stable.normalize().toSysex()), hexGroups(stable.toSysex()), `case ${i}`);
  }
});

test('JSON round trip, clone independence, encodesSameAs', () => {
  const p = MutantBrainPatch.fromSysex(syx([31, 1, 1, 36], [21, 1, 11, 1], [1, 2, 0, 10]));
  const json = JSON.parse(JSON.stringify(p));
  const q = MutantBrainPatch.fromJSON(json);
  assert.deepEqual(q.toJSON(), p.toJSON());
  assert.ok(q.encodesSameAs(p));
  const c = p.clone();
  c.gates[0].minNote = 40;
  assert.equal(p.gates[0].minNote, 36);
  assert.ok(!c.encodesSameAs(p));
  // partial / junk JSON keeps defaults
  assert.deepEqual(MutantBrainPatch.fromJSON({ gates: [{ source: 22, bogus: 1 }], inputs: 'x' }).gates[0].source, 22);
  assert.deepEqual(MutantBrainPatch.fromJSON(null).toJSON(), new MutantBrainPatch().toJSON());
});
