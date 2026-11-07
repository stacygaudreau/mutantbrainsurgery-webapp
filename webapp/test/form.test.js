'use strict';
/**
 * Unit tests for the form layer: render.inc option lists, patch.asp's
 * XAble_* enable rules, browser submission rules and get_sysex.asp ReadForm.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { MB, hexGroups } = require('./helpers');

const { MutantBrainPatch, Form, MutantBrainError } = MB;
const O = Form.OPTIONS;
const values = (opts) => opts.map((o) => o.value);
const labels = (opts) => opts.map((o) => o.label);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof MutantBrainError && e.code === code);

// Golden: what the original site produced for an untouched fresh form
// (captured by executing the original ASP, see oracle.test.js which re-checks it).
const FRESH_FORM_SYSEX = 'f0007f15 01020001 010c010f ' +
  '0b010000 0b020000 0b030000 0b040000 0b050000 0b070000 0b080000 ' +
  '0c010000 0c020000 0c030000 0c040000 0c050000 0c070000 0c080000 ' +
  '0d010000 0d020000 0d030000 0d040000 0d050000 0d070000 0d080000 ' +
  '0e010000 0e020000 0e030000 0e040000 0e050000 0e070000 0e080000 ' +
  '15010000 16010000 17010000 18010000 ' +
  '1f010000 1f0c0100 20010000 200c0100 21010000 210c0100 22010000 220c0100 23010000 230c0100 24010000 240c0100 ' +
  '25010000 250c0100 26010000 260c0100 27010000 270c0100 28010000 280c0100 29010000 290c0100 2a010000 2a0c0100 f7';

// ---------------------------------------------------------------- schema

test('190 fields in original page order with unique names', () => {
  const names = Form.FIELDS.map((f) => f.name);
  assert.equal(names.length, 2 + 4 * 7 + 4 * 7 + 12 * 11);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.slice(0, 9), ['global.chan', 'global.dur', 'in1.src', 'in1.chan', 'in1.prty', 'in1.min_note', 'in1.max_note', 'in1.min_vel', 'in1.bend']);
  assert.deepEqual(names.filter((n) => n.startsWith('cv1.')), ['cv1.src', 'cv1.event', 'cv1.trans', 'cv1.scheme', 'cv1.chan', 'cv1.cc', 'cv1.volts']);
  assert.deepEqual(names.filter((n) => n.startsWith('gt7.')).map((n) => n.split('.')[1]),
    ['src', 'event', 'chan', 'min_note', 'max_note', 'min_vel', 'cc', 'thrs', 'div', 'ofs', 'dur']);
  assert.equal(names[names.length - 1], 'gt12.dur');
  assert.equal(Form.field('cv3.trans').options, O.transpose);
  assert.equal(Form.field('nope'), null);
});

test('sections carry headings, row labels, headers and tooltips for any UI', () => {
  assert.deepEqual(Form.SECTIONS.map((s) => s.title), ['GLOBALS', 'NOTE INPUTS', 'CV OUTPUTS', 'GATE OUTPUTS']);
  const [g, inp, cv, gt] = Form.SECTIONS;
  assert.equal(inp.rowLabel(0), 'Input.1');
  assert.equal(cv.rowLabel(3), 'CV.D');
  assert.equal(gt.rowLabel(11), 'Gate.12');
  assert.deepEqual(g.columns.map((c) => c.header), ['Default Channel', 'Default Trigger']);
  assert.deepEqual(cv.columns.map((c) => c.header), ['CV Source', 'Note input', 'Transpose', 'Scheme', 'Chan', 'CC#', 'Range']);
  assert.deepEqual(gt.columns.filter((c) => c.gapBefore).map((c) => c.field), ['event', 'chan', 'cc', 'div', 'dur']);
  assert.match(inp.columns[0].title, /^Select whether this note input is enabled.*\nYou should disable/s);
  assert.ok(cv.firmwareNote && gt.firmwareNote && !inp.firmwareNote);
  assert.equal(Form.FIRMWARE_URL, 'https://www.ericasynths.lv/hexinverter-mutant-brain-2515/');
});

test('option lists match render.inc exactly (sizes, order, labels)', () => {
  assert.equal(O.channel.length, 18);
  assert.deepEqual(values(O.channel).slice(0, 3), ['default', '1', '2']);
  assert.equal(O.channel[17].value, 'omni');
  assert.equal(O.channel[17].label, '(OMNI)');
  assert.deepEqual(values(O.globalChannel), Array.from({ length: 16 }, (_, i) => String(i + 1)));
  assert.equal(O.globalChannel[9].label, 'Chan.10');

  assert.equal(O.minNote.length, 128);
  assert.deepEqual(labels(O.minNote).slice(0, 3), ['0 C-1', '1 C#-1', '2 D-1']);
  assert.equal(O.minNote[60].label, '60 C4');
  assert.equal(O.minNote[61].label, '61 C#4');
  assert.equal(O.minNote[127].label, '127 G9');
  assert.equal(O.maxNote.length, 127, 'max note starts at 1 - the "(single)" option is never rendered');
  assert.equal(O.maxNote[0].label, '1 C#-1');

  assert.equal(O.minVel.length, 127);
  assert.deepEqual(labels(O.minVel).slice(0, 2), ['(any)', '2']);

  assert.equal(O.cc.length, 127);
  assert.deepEqual(O.cc.filter((o) => o.disabled).map((o) => [o.value, o.label]),
    [['6', 'Data Entry MSB'], ['38', 'Data Entry LSB'], ['98', 'NRPN LSB'], ['99', 'NRPN MSB']]);
  assert.deepEqual(labels(O.cc).slice(0, 3), ['Mod Wheel', 'cc#2', 'cc#3']);

  const ms = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
    '20', '25', '30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80', '85', '90', '95', '100', '105', '110', '115', '120'];
  assert.deepEqual(values(O.globalDuration), ms);
  assert.deepEqual(values(O.gateDuration), ['inf', 'retrig', 'default', ...ms]);
  assert.deepEqual(labels(O.gateDuration).slice(0, 4), ['(gate)', '(retrig)', '(trigger)', '1ms']);

  assert.deepEqual(values(O.transpose), ['100', '88', '76', '75', '74', '73', '72', '71', '70', '69', '68', '67', '66', '65',
    '64', '63', '62', '61', '60', '59', '58', '57', '56', '55', '54', '53', '52', '40', '28']);
  assert.equal(O.transpose[14].label, '(none)');
  assert.equal(O.transpose[15].label, '-1');
  assert.deepEqual(values(O.priority), ['0', '1', '3', '6', '7', '8', '9', '10', '11']);
  assert.deepEqual(values(O.cvSource), ['0', '11', '12', '13', '14', '2', '4', '5', '20', '127']);
  assert.deepEqual(values(O.cvEvent), ['1', '2', '3', '4', '20']);
  assert.deepEqual(values(O.gateSource), ['0', '11', '12', '13', '14', '1', '2', '3', '20', '21', '22', '23', '25', '26']);
  assert.equal(O.gateSource[13].label, 'Trans. Start/Stop \u2020');
  assert.deepEqual(values(O.gateEvent), ['1', '2', '3', '4', '5', '0']);
  assert.deepEqual(values(O.clockDivider), ['3', '4', '6', '8', '9', '12', '16', '18', '24', '32', '36', '48', '72', '96', '1']);
  assert.deepEqual(labels(O.pitchScheme), ['V/Oct', 'Hz/V \u2020', '1.2V/Oct \u2020']);
  assert.equal(O.bendRange.length, 25);
  assert.equal(O.clockOffset.length, 128);
  assert.deepEqual(labels(O.clockOffset).slice(0, 2), ['(none)', '+1']);
  assert.deepEqual(values(O.volts), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.ok(Object.isFrozen(O.cc) && Object.isFrozen(O.cc[0]));
});

// ---------------------------------------------------------------- toFormValues

test('fresh form shows the browser fallbacks for unmatched defaults', () => {
  const v = Form.defaultFormValues();
  assert.equal(Object.keys(v).length, 190);
  assert.equal(v['global.chan'], '1');
  assert.equal(v['global.dur'], '15');
  assert.equal(v['in1.chan'], 'default');
  assert.equal(v['in1.min_vel'], '1', 'model minVel 0 has no option => first option "(any)"');
  assert.equal(v['in1.prty'], '3');
  assert.equal(v['cv1.event'], '1', 'model inputEvent 0 has no option => first');
  assert.equal(v['cv1.trans'], '64');
  assert.equal(v['gt1.cc'], '1', 'model cc 0 has no option => first');
  assert.equal(v['gt1.dur'], 'default');
  assert.equal(v['gt1.div'], '6');
  // returned object is a copy
  v['in1.src'] = '1';
  assert.equal(Form.defaultFormValues()['in1.src'], '0');
});

test('toFormValues: unmatched values fall back to the first option', () => {
  const p = new MutantBrainPatch();
  Object.assign(p.globals, { chanType: 1, chanNumber: 0, durationType: 0, duration: 0 }); // no omni/gate options for globals
  Object.assign(p.inputs[0], { chanType: 0, chanNumber: 0, maxNote: 0, bendRange: 30, priority: 2 });
  Object.assign(p.cvOutputs[0], { source: 3, transpose: 99, volts: 0, pitchScheme: 5 });
  Object.assign(p.gates[0], { durationType: 1, duration: 17, chanType: 7, divider: 5, threshold: 0 });
  const v = p.toFormValues();
  assert.equal(v['global.chan'], '1');
  assert.equal(v['global.dur'], '1');
  assert.equal(v['in1.chan'], 'default');
  assert.equal(v['in1.max_note'], '1');
  assert.equal(v['in1.bend'], '0');
  assert.equal(v['in1.prty'], '0');
  assert.equal(v['cv1.src'], '0', 'CV source 3 (CC negative) has no option on the CV form');
  assert.equal(v['cv1.trans'], '100');
  assert.equal(v['cv1.volts'], '1');
  assert.equal(v['cv1.scheme'], '0');
  assert.equal(v['gt1.dur'], 'inf', '17ms is not an option');
  assert.equal(v['gt1.chan'], 'default');
  assert.equal(v['gt1.div'], '3');
  assert.equal(v['gt1.thrs'], '1');
});

test('toFormValues: channel and duration encodings', () => {
  const p = new MutantBrainPatch();
  Object.assign(p.inputs[0], { chanType: 1, chanNumber: 5 });
  Object.assign(p.inputs[1], { chanType: 0, chanNumber: 16 });
  Object.assign(p.inputs[2], { chanType: 2, chanNumber: 9 });
  Object.assign(p.gates[0], { durationType: 3, duration: 50 });
  Object.assign(p.gates[1], { durationType: 1, duration: 120 });
  Object.assign(p.gates[2], { durationType: 0, duration: 99 });
  const v = p.toFormValues();
  assert.deepEqual([v['in1.chan'], v['in2.chan'], v['in3.chan']], ['omni', '16', 'default']);
  assert.deepEqual([v['gt1.dur'], v['gt2.dur'], v['gt3.dur']], ['retrig', '120', 'inf']);
});

// ---------------------------------------------------------------- enable rules

test('note input: everything but src disabled unless ENABLE', () => {
  const off = Form.enabledFields({});
  const on = Form.enabledFields({ 'in2.src': '1' });
  for (const k of ['chan', 'prty', 'min_note', 'max_note', 'min_vel', 'bend']) {
    assert.equal(off['in2.' + k], false);
    assert.equal(on['in2.' + k], true);
    assert.equal(on['in1.' + k], false);
  }
  assert.equal(off['in2.src'], true);
  assert.equal(off['global.chan'] && off['global.dur'], true);
});

test('CV output enable rules (XAble_CVOutput)', () => {
  const row = (src, event = '1') => {
    const e = Form.enabledFields({ 'cv1.src': src, 'cv1.event': event });
    return ['src', 'event', 'trans', 'scheme', 'chan', 'cc', 'volts'].filter((k) => e['cv1.' + k]).join(',');
  };
  assert.equal(row('0'), 'src');
  assert.equal(row('11', '1'), 'src,event,trans,scheme');
  assert.equal(row('14', '4'), 'src,event,trans,scheme');
  assert.equal(row('12', '20'), 'src,event,volts');
  assert.equal(row('2'), 'src,chan,cc,volts');
  assert.equal(row('4'), 'src,chan,volts');
  assert.equal(row('5'), 'src,chan,volts');
  assert.equal(row('20'), 'src,volts');
  assert.equal(row('127'), 'src,volts');
  assert.equal(row('0', '20'), 'src', 'event value matters only for note-input sources');
});

test('gate output enable rules (XAble_GateOutput)', () => {
  const row = (src) => {
    const e = Form.enabledFields({ 'gt5.src': src });
    return ['src', 'event', 'chan', 'min_note', 'max_note', 'min_vel', 'cc', 'thrs', 'div', 'ofs', 'dur'].filter((k) => e['gt5.' + k]).join(',');
  };
  assert.equal(row('0'), 'src');
  for (const s of ['11', '12', '13', '14']) assert.equal(row(s), 'src,event,dur');
  assert.equal(row('1'), 'src,chan,min_note,max_note,min_vel,dur');
  assert.equal(row('2'), 'src,chan,cc,thrs,dur');
  assert.equal(row('3'), 'src,chan,cc,thrs,dur');
  assert.equal(row('20'), 'src,div,ofs,dur');
  assert.equal(row('21'), 'src,div,ofs,dur');
  for (const s of ['22', '23', '25', '26']) assert.equal(row(s), 'src,dur');
});

// ---------------------------------------------------------------- submission

test('submittedValues omits disabled fields', () => {
  const s = Form.submittedValues({ 'gt1.src': '20', 'gt1.div': '24', 'gt1.cc': '7' });
  assert.equal(s['gt1.div'], '24');
  assert.ok(!('gt1.cc' in s), 'cc disabled for clock source');
  assert.ok(!('in1.chan' in s));
  assert.equal(s['in1.src'], '0');
  assert.equal(Object.keys(Form.submittedValues({})).length, 2 + 4 + 4 + 12, 'fresh form: globals + every src only');
});

test('disabled CC option: shown selected but not submitted (=> saved as 0)', () => {
  const p = new MutantBrainPatch();
  Object.assign(p.cvOutputs[0], { source: 2, cc: 6 });
  Object.assign(p.gates[0], { source: 2, cc: 99 });
  const v = p.toFormValues();
  assert.equal(v['cv1.cc'], '6');
  assert.equal(v['gt1.cc'], '99');
  const s = Form.submittedValues(v);
  assert.ok(!('cv1.cc' in s) && !('gt1.cc' in s));
  const n = p.normalize();
  assert.equal(n.cvOutputs[0].cc, 0);
  assert.equal(n.gates[0].cc, 0);
  // second load: 0 has no option => shows "Mod Wheel" (1)
  assert.equal(n.normalize().cvOutputs[0].cc, 1);
});

test('submittedValues / fromFormValues validate field names and option values', () => {
  throwsCode(() => Form.submittedValues({ 'in9.src': '1' }), 'BAD_FORM_VALUE');
  throwsCode(() => Form.submittedValues({ 'in1.src': '7' }), 'BAD_FORM_VALUE');
  throwsCode(() => MutantBrainPatch.fromFormValues({ 'gt1.src': '1', 'gt1.max_note': '0' }), 'BAD_FORM_VALUE');
  // a bad value in a DISABLED field still must be a real option of that select
  throwsCode(() => Form.submittedValues({ 'gt1.max_note': 'x' }), 'BAD_FORM_VALUE');
  // numbers are accepted and stringified
  assert.equal(MutantBrainPatch.fromFormValues({ 'in1.src': 1 }).inputs[0].source, 1);
});

// ---------------------------------------------------------------- ReadForm

test('fromSubmittedForm: missing fields read as 0 (ASP Empty semantics)', () => {
  const p = MutantBrainPatch.fromSubmittedForm({});
  assert.deepEqual(p.globals, { chanType: 0, chanNumber: 0, durationType: 1, duration: 0 });
  assert.deepEqual(p.inputs[0], { source: 0, chanType: 0, chanNumber: 0, priority: 0, minNote: 0, maxNote: 0, minVel: 0, bendRange: 0 });
  assert.deepEqual(p.gates[0], {
    source: 0, inputEvent: 0, chanType: 0, chanNumber: 0, minNote: 0, maxNote: 0, minVel: 0, cc: 0,
    threshold: 0, divider: 0, offset: 0, durationType: 1, duration: 0,
  });
});

test('fromSubmittedForm: channel and duration keywords', () => {
  const p = MutantBrainPatch.fromSubmittedForm({
    'in1.chan': 'omni', 'in2.chan': 'default', 'in3.chan': '12',
    'gt1.dur': 'inf', 'gt2.dur': 'default', 'gt3.dur': 'retrig', 'gt4.dur': '45',
  });
  assert.deepEqual([p.inputs[0].chanType, p.inputs[0].chanNumber], [1, 0]);
  assert.deepEqual([p.inputs[1].chanType, p.inputs[1].chanNumber], [2, 0]);
  assert.deepEqual([p.inputs[2].chanType, p.inputs[2].chanNumber], [0, 12]);
  assert.deepEqual(p.gates.slice(0, 4).map((g) => [g.durationType, g.duration]), [[0, 0], [2, 0], [3, 0], [1, 45]]);
});

test('fromSubmittedForm rejects values CByte/CLng would choke on', () => {
  for (const bad of ['', 'abc', '-1', '1.5', '256', '1e2', ' 5']) {
    throwsCode(() => MutantBrainPatch.fromSubmittedForm({ 'in1.prty': bad }), 'BAD_FORM_VALUE');
  }
  throwsCode(() => MutantBrainPatch.fromSubmittedForm({ 'bogus.field': '1' }), 'BAD_FORM_VALUE');
});

// ---------------------------------------------------------------- end to end

test('fresh form => same bytes the original site produced', () => {
  assert.equal(hexGroups(MutantBrainPatch.fromFormValues({}).toSysex()), FRESH_FORM_SYSEX);
  assert.equal(hexGroups(MutantBrainPatch.fromFormValues().toSysex()), FRESH_FORM_SYSEX);
  assert.equal(hexGroups(new MutantBrainPatch().normalize().toSysex()), FRESH_FORM_SYSEX);
});

test('a typical user patch end to end', () => {
  const p = MutantBrainPatch.fromFormValues({
    'global.chan': '10', 'global.dur': '25',
    'in1.src': '1', 'in1.chan': '3', 'in1.prty': '9', 'in1.bend': '12',
    'cv1.src': '11', 'cv1.event': '1', 'cv1.trans': '52', 'cv1.scheme': '2',
    'cv2.src': '11', 'cv2.event': '20', 'cv2.volts': '8',
    'cv3.src': '2', 'cv3.chan': 'omni', 'cv3.cc': '74', 'cv3.volts': '3',
    'gt1.src': '11', 'gt1.event': '5', 'gt1.dur': 'retrig',
    'gt2.src': '1', 'gt2.chan': '10', 'gt2.min_note': '36', 'gt2.max_note': '36', 'gt2.min_vel': '100', 'gt2.dur': '10',
    'gt3.src': '21', 'gt3.div': '24', 'gt3.ofs': '12',
  });
  const params = p.toParams().map(String);
  for (const expected of [
    [1, 2, 0, 10], [1, 12, 1, 25],
    [11, 1, 1, 0], [11, 2, 0, 3], [11, 3, 0, 0], [11, 4, 0, 127], [11, 5, 0, 1], [11, 7, 0, 12], [11, 8, 0, 9],
    [21, 1, 11, 1], [21, 16, 0, 2], [21, 14, 0, 52],
    [22, 1, 11, 20], [22, 15, 0, 8],
    [23, 1, 2, 74], [23, 2, 1, 0], [23, 15, 0, 3],
    [31, 1, 11, 5], [31, 12, 3, 0],
    [32, 1, 1, 36], [32, 2, 0, 10], [32, 4, 0, 36], [32, 5, 0, 100], [32, 12, 1, 10],
    [33, 1, 21, 24], [33, 11, 0, 12], [33, 12, 2, 0],
  ]) assert.ok(params.includes(String(expected)), `missing ${expected}`);
  // and it reloads into exactly the same form
  const v = MutantBrainPatch.fromSysex(p.toSysex()).toFormValues();
  assert.equal(v['cv1.trans'], '52');
  assert.equal(v['gt2.min_vel'], '100');
  assert.equal(v['cv3.chan'], 'omni');
});
