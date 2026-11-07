'use strict';
/**
 * Tests against the known-valid, known-working .syx files in <repo>/patches.
 * Every .syx dropped into that folder automatically gets the generic checks.
 * The five original files additionally get hand-written semantic expectations
 * derived by reading their bytes (independent of the codec implementation).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { MB, referencePatches, hexGroups } = require('./helpers');

const { MutantBrainPatch, SOURCE, CHAN, DURATION } = MB;
const patches = referencePatches();

/**
 * Files that do NOT re-save byte-identically, with the exact expected
 * difference. AlesisNitro.syx was made by an older version of the site: its
 * velocity-CV outputs carry no "volts" (range) parameter. The current site
 * code (verified by executing the original VBScript, see oracle.test.js)
 * writes [cv, VOLTS(15), 0, volts] after each velocity CV source, so
 * re-saving adds those four params with the default range 5V.
 */
const KNOWN_RESAVE_DIFFERENCES = {
  'AlesisNitro.syx': (params) => params.flatMap((p) =>
    (p[0] >= 21 && p[0] <= 24 && p[1] === 1 && p[3] === 20 ? [p, [p[0], 15, 0, 5]] : [p])),
};

test('reference patches folder is present and non-empty', () => {
  assert.ok(patches.length >= 5, `expected the reference .syx files, found ${patches.length}`);
});

for (const { name, bytes } of patches) {
  test(`${name}: valid Mutant Brain SysEx framing`, () => {
    assert.equal(bytes[0], 0xF0, 'starts with F0');
    assert.deepEqual([...bytes.subarray(1, 4)], [0x00, 0x7F, 0x15], 'manufacturer id 00 7F 15');
    assert.equal(bytes[bytes.length - 1], 0xF7, 'ends with F7');
    assert.equal((bytes.length - 5) % 4, 0, 'body is whole 4-byte params');
    for (let i = 1; i < bytes.length - 1; i++) assert.ok(bytes[i] < 0x80, `data byte ${i} is 7-bit`);
  });

  test(`${name}: decodes, and every param is one the codec writes`, () => {
    const params = MutantBrainPatch.parseParams(bytes);
    assert.equal(params.length, (bytes.length - 5) / 4);
    const patch = MutantBrainPatch.fromSysex(bytes);
    // re-encoding must keep every param of the file (the codec may add some)
    const re = patch.toParams().map(String);
    for (const p of params) assert.ok(re.includes(String(p)), `param ${p} survives re-encoding`);
  });

  test(`${name}: load into form + save reproduces the file`, () => {
    const patch = MutantBrainPatch.fromSysex(bytes);
    const resaved = patch.normalize().toSysex();
    const expectDiff = KNOWN_RESAVE_DIFFERENCES[name];
    if (!expectDiff) {
      assert.equal(hexGroups(resaved), hexGroups(bytes));
      // and the direct encode (no form round trip) is identical too
      assert.equal(hexGroups(patch.toSysex()), hexGroups(bytes));
    } else {
      const expected = expectDiff(MutantBrainPatch.parseParams(bytes));
      assert.deepEqual(MutantBrainPatch.parseParams(resaved), expected);
      // re-saving the re-saved file is then stable
      assert.equal(hexGroups(MutantBrainPatch.fromSysex(resaved).normalize().toSysex()), hexGroups(resaved));
    }
  });
}

// ---------------------------------------------------------------- semantics

const byName = Object.fromEntries(patches.map((p) => [p.name, MutantBrainPatch.fromSysex(p.bytes)]));
const has = (n) => (byName[n] ? test : test.skip);

function assertGlobals(p) {
  assert.deepEqual(p.globals, { chanType: CHAN.SPECIFIC, chanNumber: 10, durationType: DURATION.MS, duration: 15 });
}
function assertDisabledInput(n) {
  assert.deepEqual(n, { source: 0, chanType: 0, chanNumber: 0, priority: 0, minNote: 0, maxNote: 0, minVel: 0, bendRange: 0 });
}
function assertNoteGate(g, note, chanType = CHAN.DEFAULT, chanNumber = 0) {
  assert.equal(g.source, SOURCE.MIDI_NOTE);
  assert.equal(g.minNote, note);
  assert.equal(g.maxNote, note);
  assert.equal(g.minVel, 1);
  assert.equal(g.chanType, chanType);
  assert.equal(g.chanNumber, chanNumber);
  assert.equal(g.durationType, DURATION.DEFAULT);
}
function assertClockGate(g) {
  assert.equal(g.source, SOURCE.MIDI_TICK);
  assert.equal(g.divider, 6); // 1/16
  assert.equal(g.offset, 0);
  assert.equal(g.durationType, DURATION.DEFAULT);
}

for (const [file, notes] of [
  ['Roland TR-08.syx', [36, 37, 43, 47, 50, 37, 39, 56, 49, 46, 42]],
  ['Roland TR-09.syx', [36, 38, 43, 47, 50, 37, 39, 42, 46, 49, 51]],
]) {
  has(file)(`${file}: drum map - gates 1-11 MIDI notes, gate 12 clock`, () => {
    const p = byName[file];
    assertGlobals(p);
    p.inputs.forEach(assertDisabledInput);
    p.cvOutputs.forEach((c) => assert.equal(c.source, SOURCE.DISABLE));
    notes.forEach((note, i) => assertNoteGate(p.gates[i], note));
    assertClockGate(p.gates[11]);
    const fv = p.toFormValues();
    assert.equal(fv['gt1.min_note'], '36');
    assert.equal(fv['gt12.div'], '6');
    assert.equal(fv['in1.src'], '0');
  });
}

has('Default (Mutant Brain).syx')('Default (Mutant Brain).syx: 4 voices + 8 drum gates on chan 10', () => {
  const p = byName['Default (Mutant Brain).syx'];
  assertGlobals(p);
  p.inputs.forEach((n, i) => assert.deepEqual(n, {
    source: 1, chanType: CHAN.SPECIFIC, chanNumber: i + 1, priority: 3, minNote: 0, maxNote: 127, minVel: 1, bendRange: 3,
  }));
  p.cvOutputs.forEach((c, i) => {
    assert.equal(c.source, SOURCE.INPUT1 + i);
    assert.equal(c.inputEvent, 1);
    assert.equal(c.pitchScheme, 0);
    assert.equal(c.transpose, 64);
  });
  for (let i = 0; i < 4; i++) {
    assert.equal(p.gates[i].source, SOURCE.INPUT1 + i);
    assert.equal(p.gates[i].inputEvent, 1);
    assert.equal(p.gates[i].durationType, DURATION.GATE);
  }
  [60, 62, 64, 65, 67, 69, 71, 72].forEach((note, i) => assertNoteGate(p.gates[4 + i], note, CHAN.SPECIFIC, 10));
});

has('Korg Electribe ESX.syx')('Korg Electribe ESX.syx: 2 voices, clock, 9 drum gates', () => {
  const p = byName['Korg Electribe ESX.syx'];
  assertGlobals(p);
  [0, 1].forEach((i) => assert.deepEqual(p.inputs[i], {
    source: 1, chanType: CHAN.SPECIFIC, chanNumber: i + 1, priority: 0, minNote: 0, maxNote: 127, minVel: 1, bendRange: 0,
  }));
  [2, 3].forEach((i) => assertDisabledInput(p.inputs[i]));
  assert.equal(p.cvOutputs[0].source, SOURCE.INPUT1);
  assert.equal(p.cvOutputs[1].source, SOURCE.INPUT2);
  assert.equal(p.cvOutputs[2].source, SOURCE.DISABLE);
  assert.equal(p.cvOutputs[3].source, SOURCE.DISABLE);
  assert.equal(p.gates[0].source, SOURCE.INPUT1);
  assert.equal(p.gates[1].source, SOURCE.INPUT2);
  assert.equal(p.gates[0].durationType, DURATION.GATE);
  assertClockGate(p.gates[2]);
  [36, 38, 40, 41, 43, 42, 46, 49, 51].forEach((note, i) => assertNoteGate(p.gates[3 + i], note));
});

has('AlesisNitro.syx')('AlesisNitro.syx: velocity CVs, 10 drum gates, 2 disabled gates', () => {
  const p = byName['AlesisNitro.syx'];
  assertGlobals(p);
  assert.deepEqual(p.inputs[0], {
    source: 1, chanType: CHAN.SPECIFIC, chanNumber: 10, priority: 0, minNote: 0, maxNote: 1, minVel: 1, bendRange: 0,
  });
  [1, 2, 3].forEach((i) => assertDisabledInput(p.inputs[i]));
  p.cvOutputs.forEach((c) => {
    assert.equal(c.source, SOURCE.INPUT1);
    assert.equal(c.inputEvent, MB.CV_EVENT_VELOCITY);
    assert.equal(c.volts, 5, 'not in file: default range 5V');
  });
  [24, 26, 36, 33, 31, 37, 39, 34, 32, 30].forEach((note, i) => assertNoteGate(p.gates[i], note));
  for (const g of [p.gates[10], p.gates[11]]) {
    assert.equal(g.source, SOURCE.DISABLE);
    assert.deepEqual([g.durationType, g.duration], [DURATION.MS, 0], 'disabled gate: duration not submitted => (1,0)');
  }
});
