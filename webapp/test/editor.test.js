'use strict';
/**
 * Tests for the Editor API (the typed, immutable layer for building UIs such
 * as a React desktop app). The Form layer is verified against the original ASP
 * site (oracle.test.js), so here the Editor is checked against the Form layer
 * plus its own guarantees: typing, canonical state, immutability, validation.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { MB, referencePatches, rng, randomSysex, randomUserValues, hexGroups, typedValue, editorStateFor } = require('./helpers');

const { Editor, Form, MutantBrainPatch, MutantBrainError, CHAN, DURATION } = MB;
const ref = (section, index, control) => (section === 'globals' ? { section, control } : { section, index, control });
/** Every field of every item, section by section. */
const allRefs = () => Editor.schema.sections.flatMap((s) =>
  Array.from({ length: s.count }, (_, i) => Editor.fieldsOf(s.key, i)).flat());
const controlInfo = (section, control) => Editor.schema.section(section).controls.find((c) => c.control === control);
const bytesOf = (state) => hexGroups(Editor.toSysex(state));
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof MutantBrainError && e.code === code);

/** Expected view values for form values, mapped to typed values. */
const typedValues = (formValues) => {
  const out = {};
  for (const [name, v] of Object.entries(formValues)) out[name] = typedValue(name, v);
  return out;
};
const viewValues = (state) => {
  const out = {};
  for (const f of Editor.view(state).fields) out[f.id] = f.value;
  return out;
};
const viewEnabled = (state) => {
  const out = {};
  for (const f of Editor.view(state).fields) out[f.id] = f.enabled;
  return out;
};
const isDeepFrozen = (state) =>
  Object.isFrozen(state) && Object.isFrozen(state.globals) &&
  ['inputs', 'cvOutputs', 'gates'].every((k) => Object.isFrozen(state[k]) && state[k].every(Object.isFrozen));

function deepFreeze(data) {
  Object.freeze(data.globals);
  for (const k of ['inputs', 'cvOutputs', 'gates']) { data[k].forEach(Object.freeze); Object.freeze(data[k]); }
  return Object.freeze(data);
}

// ===========================================================================
// Schema: what the module has
// ===========================================================================

test('schema: sections with names, item counts and item names (no layout)', () => {
  assert.deepEqual(Editor.schema.sections.map((s) => [s.key, s.name, s.count, s.controls.length]), [
    ['globals', 'Global settings', 1, 2],
    ['inputs', 'Note inputs', 4, 7],
    ['cvOutputs', 'CV outputs', 4, 7],
    ['gates', 'Gate outputs', 12, 11],
  ]);
  const items = (key) => Array.from({ length: Editor.schema.section(key).count }, (_, i) => Editor.schema.section(key).itemName(i));
  assert.deepEqual(items('globals'), ['Global settings']);
  assert.deepEqual(items('inputs'), ['Input 1', 'Input 2', 'Input 3', 'Input 4']);
  assert.deepEqual(items('cvOutputs'), ['CV A', 'CV B', 'CV C', 'CV D']);
  assert.deepEqual(items('gates').slice(0, 2).concat(items('gates').slice(-1)), ['Gate 1', 'Gate 2', 'Gate 12']);
  for (const s of Editor.schema.sections) {
    assert.equal(Editor.schema.section(s.key), s);
    assert.deepEqual(Object.keys(s).sort(), ['controls', 'count', 'itemName', 'key', 'name'], 'nothing layout-specific');
  }
  assert.ok(Object.isFrozen(Editor.schema) && Object.isFrozen(Editor.schema.sections) && Object.isFrozen(Editor.schema.sections[3].controls));
  throwsCode(() => Editor.schema.section('leds'), 'BAD_FIELD_REF');
});

test('schema: the settings of each kind of item', () => {
  const controls = (key) => Editor.schema.section(key).controls.map((c) => c.control);
  assert.deepEqual(controls('globals'), ['channel', 'duration']);
  assert.deepEqual(controls('inputs'), ['source', 'channel', 'priority', 'minNote', 'maxNote', 'minVel', 'bendRange']);
  assert.deepEqual(controls('cvOutputs'), ['source', 'inputEvent', 'transpose', 'pitchScheme', 'channel', 'cc', 'volts']);
  assert.deepEqual(controls('gates'),
    ['source', 'inputEvent', 'channel', 'minNote', 'maxNote', 'minVel', 'cc', 'threshold', 'divider', 'offset', 'duration']);
});

test('fieldsOf / idOf / refOf: every field of every item, each exactly once', () => {
  const refs = allRefs();
  assert.equal(refs.length, Form.FIELDS.length);
  assert.deepEqual(refs.map(Editor.idOf).sort(), Form.FIELDS.map((f) => f.name).sort(), 'all fields, no duplicates');
  for (const r of refs) {
    assert.deepEqual(Editor.refOf(Editor.idOf(r)), r, 'refOf(idOf(ref)) round-trips');
    assert.ok(Object.isFrozen(r));
  }
  assert.deepEqual(Editor.fieldsOf('globals'), [{ section: 'globals', control: 'channel' }, { section: 'globals', control: 'duration' }]);
  assert.deepEqual(Editor.fieldsOf('gates', 2).map(Editor.idOf).slice(0, 3), ['gt3.src', 'gt3.event', 'gt3.chan']);
  assert.ok(Editor.fieldsOf('cvOutputs', 3).every((r) => r.section === 'cvOutputs' && r.index === 3));
  for (const [section, index] of [['gates', 12], ['inputs', -1], ['cvOutputs', 1.5], ['leds', 0]]) {
    throwsCode(() => Editor.fieldsOf(section, index), 'BAD_FIELD_REF');
  }
});

test('index means which input/output, not a position: Gate 3 is index 2 everywhere', () => {
  let s = Editor.set(Editor.create(), ref('gates', 2, 'source'), 1);
  s = Editor.set(s, ref('gates', 2, 'minNote'), 40);
  assert.equal(s.gates[2].minNote, 40, 'state.gates[2] is Gate 3');
  assert.equal(Editor.schema.section('gates').itemName(2), 'Gate 3');
  assert.equal(Editor.idOf(ref('gates', 2, 'minNote')), 'gt3.min_note');
  const sent = MutantBrainPatch.parseParams(Editor.toSysex(s)).filter((p) => p[0] === 33);
  assert.deepEqual(sent[0], [33, 1, 1, 40], 'Gate 3 is SysEx block 33');
});

test('controls: readable metadata (name, abbreviation, plain description, group)', () => {
  for (const section of Editor.schema.sections) {
    const formSection = Form.SECTIONS.find((s) => s.key === section.key);
    section.controls.forEach((c, i) => {
      assert.ok(c.name && c.name.length > 2, `${section.key}.${c.control} has a name`);
      assert.equal(c.abbreviation, formSection.columns[i].header);
      assert.ok(c.description.length > 10 && !c.description.includes('\n'), 'one-paragraph description');
      assert.ok(!/mapings|be be/.test(c.description), 'original typos fixed');
      assert.ok(c.group);
      assert.deepEqual(Object.keys(c).sort(), ['abbreviation', 'control', 'description', 'group', 'name', 'options']);
    });
  }
  const gates = Editor.schema.section('gates').controls;
  assert.deepEqual(gates.filter((c) => c.group === 'clock').map((c) => c.name), ['Clock rate', 'Clock offset']);
  assert.equal(controlInfo('gates', 'divider').abbreviation, 'Ck.Rate');
});

test('options: typed values that mirror the form options exactly', () => {
  for (const section of Editor.schema.sections) {
    const formSection = Form.SECTIONS.find((s) => s.key === section.key);
    section.controls.forEach((c, i) => {
      const formOptions = formSection.columns[i].options;
      const id = Form.fieldName(formSection, 0, formSection.columns[i]);
      assert.equal(c.options.length, formOptions.length);
      c.options.forEach((o, j) => {
        assert.equal(o.value, typedValue(id, formOptions[j].value), `${id} option ${j}`);
        assert.equal(o.disabled, !!formOptions[j].disabled);
        assert.equal(o.label + (o.needsNewerFirmware ? ' †' : ''), formOptions[j].label, 'label = form label minus the dagger');
      });
    });
  }
  const opts = (s, control) => controlInfo(s, control).options;
  assert.deepEqual(opts('gates', 'channel').map((o) => o.value), ['default', ...Array.from({ length: 16 }, (_, i) => i + 1), 'omni']);
  assert.deepEqual(opts('globals', 'channel').map((o) => o.value), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(opts('gates', 'duration').slice(0, 4).map((o) => o.value), ['gate', 'retrig', 'default', 1]);
  assert.ok(opts('globals', 'duration').every((o) => typeof o.value === 'number'));
  assert.ok(opts('gates', 'minNote').every((o) => typeof o.value === 'number'));
});

test('options: firmware flag and reserved CCs are structured data', () => {
  const flagged = [];
  const disabled = [];
  for (const s of Editor.schema.sections) {
    for (const c of s.controls) {
      for (const o of c.options) {
        assert.ok(!o.label.includes('†'), 'no dagger left in labels');
        if (o.needsNewerFirmware) flagged.push(`${s.key}.${c.control}=${o.value}:${o.label}`);
        if (o.disabled) disabled.push(`${s.key}.${c.control}=${o.value}`);
      }
    }
  }
  assert.deepEqual([...new Set(flagged)].sort(), [
    'cvOutputs.pitchScheme=1:Hz/V', 'cvOutputs.pitchScheme=2:1.2V/Oct', 'gates.source=26:Trans. Start/Stop',
  ]);
  assert.deepEqual([...new Set(disabled)].sort(), [
    'cvOutputs.cc=38', 'cvOutputs.cc=6', 'cvOutputs.cc=98', 'cvOutputs.cc=99',
    'gates.cc=38', 'gates.cc=6', 'gates.cc=98', 'gates.cc=99',
  ]);
});

// ===========================================================================
// Creating states
// ===========================================================================

test('create(): the fresh form, deep-frozen, producing the original site\'s bytes', () => {
  const state = Editor.create();
  assert.ok(isDeepFrozen(state));
  assert.deepEqual(viewValues(state), typedValues(Form.defaultFormValues()));
  assert.deepEqual(viewEnabled(state), Form.enabledFields({}));
  assert.equal(bytesOf(state), hexGroups(MutantBrainPatch.fromFormValues({}).toSysex()));
  // canonical: values that had no option now hold what the form shows
  assert.equal(state.inputs[0].minVel, 1, 'minVel 0 -> "(any)" = 1');
  assert.equal(state.gates[0].cc, 1);
  assert.equal(state.cvOutputs[0].inputEvent, 1);
  assert.notEqual(Editor.create(), state, 'each call returns a new state');
});

test('fromSysex(): reference patches load like on the original site', () => {
  for (const { name, bytes } of referencePatches()) {
    const patch = MutantBrainPatch.fromSysex(bytes);
    const state = Editor.fromSysex(bytes);
    assert.ok(isDeepFrozen(state));
    assert.deepEqual(viewValues(state), typedValues(patch.toFormValues()), `${name} values`);
    assert.deepEqual(viewEnabled(state), Form.enabledFields(patch.toFormValues()), `${name} enabled`);
    assert.equal(bytesOf(state), hexGroups(patch.normalize().toSysex()), `${name} bytes`);
    if (name !== 'AlesisNitro.syx') assert.equal(bytesOf(state), hexGroups(bytes), `${name} unchanged`);
  }
});

test('fromSysex(): invalid data throws the codec errors', () => {
  throwsCode(() => Editor.fromSysex([0xF0, 0x43, 0, 0, 0xF7]), 'BAD_HEADER');
  throwsCode(() => Editor.fromSysex([0xF0, 0, 0x7F, 0x15, 1, 2]), 'TRUNCATED');
  throwsCode(() => Editor.fromSysex([0xF0, 0, 0x7F, 0x15, 2, 1, 0, 0, 0xF7]), 'UNKNOWN_BLOCK');
  throwsCode(() => Editor.fromSysex('nope'), 'BAD_INPUT');
});

test('fromPatch(): canonicalises without touching its input', () => {
  const data = new MutantBrainPatch().toJSON();
  data.gates[0] = { ...data.gates[0], source: 2, cc: 0, durationType: DURATION.MS, duration: 17 };
  data.cvOutputs[0] = { ...data.cvOutputs[0], source: 3 }; // CC-negative: no CV option
  const snapshot = JSON.stringify(data);
  const state = Editor.fromPatch(deepFreeze(data));
  assert.equal(JSON.stringify(data), snapshot, 'input untouched');
  assert.equal(state.gates[0].cc, 1, 'cc 0 -> first option');
  assert.deepEqual([state.gates[0].durationType, state.gates[0].duration], [DURATION.GATE, 0], '17ms -> "(gate)"');
  assert.equal(state.cvOutputs[0].source, 0, 'unsupported CV source -> "(disable)"');
  assert.deepEqual(Editor.fromPatch(state), state, 'idempotent');
});

test('canonical invariant: the raw state always holds exactly what the controls show', () => {
  const r = rng(31337);
  const check = (state) => {
    const view = Editor.view(state);
    for (const f of view.fields) {
      const item = f.ref.section === 'globals' ? state.globals : state[f.ref.section][f.ref.index];
      if (f.ref.control === 'channel') {
        const expected = f.value === 'default' ? [CHAN.DEFAULT, 0] : f.value === 'omni' ? [CHAN.OMNI, 0] : [CHAN.SPECIFIC, f.value];
        assert.deepEqual([item.chanType, item.chanNumber], expected, f.id);
      } else if (f.ref.control === 'duration') {
        const expected = { gate: [DURATION.GATE, 0], retrig: [DURATION.RETRIG, 0], default: [DURATION.DEFAULT, 0] }[f.value]
          || [DURATION.MS, f.value];
        assert.deepEqual([item.durationType, item.duration], expected, f.id);
      } else {
        assert.equal(item[f.ref.control], f.value, f.id);
      }
      assert.ok(f.options.some((o) => o.value === f.value), `${f.id} value is one of its options`);
    }
  };
  check(Editor.create());
  for (let i = 0; i < 300; i++) check(Editor.fromSysex(randomSysex(r)));
});

// ===========================================================================
// Changing states
// ===========================================================================

test('set(): typed values land in the raw model', () => {
  let s = Editor.create();
  s = Editor.set(s, ref('gates', 4, 'channel'), 'omni');
  assert.deepEqual([s.gates[4].chanType, s.gates[4].chanNumber], [CHAN.OMNI, 0]);
  s = Editor.set(s, ref('gates', 4, 'channel'), 10);
  assert.deepEqual([s.gates[4].chanType, s.gates[4].chanNumber], [CHAN.SPECIFIC, 10]);
  s = Editor.set(s, ref('gates', 4, 'channel'), 'default');
  assert.deepEqual([s.gates[4].chanType, s.gates[4].chanNumber], [CHAN.DEFAULT, 0]);
  for (const [value, expected] of [['gate', [0, 0]], ['retrig', [3, 0]], ['default', [2, 0]], [45, [1, 45]]]) {
    s = Editor.set(s, ref('gates', 4, 'duration'), value);
    assert.deepEqual([s.gates[4].durationType, s.gates[4].duration], expected, String(value));
  }
  s = Editor.set(s, ref('globals', 0, 'duration'), 120);
  assert.deepEqual([s.globals.durationType, s.globals.duration], [DURATION.MS, 120]);
  s = Editor.set(s, ref('cvOutputs', 3, 'transpose'), 52);
  assert.equal(s.cvOutputs[3].transpose, 52);
  assert.equal(Editor.get(s, ref('cvOutputs', 3, 'transpose')), 52);
  assert.equal(Editor.get(s, ref('gates', 4, 'duration')), 45);
});

test('set(): immutable, frozen, shares every unchanged item, same object when nothing changes', () => {
  const before = Editor.create();
  const snapshot = JSON.stringify(before);
  const after = Editor.set(before, ref('gates', 2, 'source'), 20);
  assert.equal(JSON.stringify(before), snapshot, 'previous state untouched');
  assert.notEqual(after, before);
  assert.ok(isDeepFrozen(after));
  assert.notEqual(after.gates, before.gates);
  assert.notEqual(after.gates[2], before.gates[2]);
  after.gates.forEach((gate, i) => { if (i !== 2) assert.equal(gate, before.gates[i], `gate ${i + 1} shared`); });
  assert.equal(after.globals, before.globals);
  assert.equal(after.inputs, before.inputs);
  assert.equal(after.cvOutputs, before.cvOutputs);

  assert.equal(Editor.set(after, ref('gates', 2, 'source'), 20), after, 'same value -> same state object');
  const g = Editor.set(after, ref('globals', 0, 'channel'), 7);
  assert.notEqual(g.globals, after.globals);
  assert.equal(g.gates, after.gates);
  assert.throws(() => { 'use strict'; g.gates[0].minNote = 1; }, TypeError, 'states cannot be mutated');
});

test('set(): a disabled control can still be set, and its value is used once it applies', () => {
  let s = Editor.create();
  assert.equal(Editor.isEnabled(s, ref('gates', 0, 'cc')), false);
  s = Editor.set(s, ref('gates', 0, 'cc'), 74);
  s = Editor.set(s, ref('gates', 0, 'threshold'), 100);
  assert.equal(Editor.get(s, ref('gates', 0, 'cc')), 74);
  const disabledBytes = Editor.toSysex(s);
  assert.equal(bytesOf(s), hexGroups(MutantBrainPatch.fromFormValues({}).toSysex()), 'not sent while disabled');
  s = Editor.set(s, ref('gates', 0, 'source'), 2);
  assert.equal(Editor.isEnabled(s, ref('gates', 0, 'cc')), true);
  assert.notEqual(hexGroups(Editor.toSysex(s)), hexGroups(disabledBytes));
  assert.deepEqual(MutantBrainPatch.parseParams(Editor.toSysex(s)).filter((p) => p[0] === 31),
    [[31, 1, 2, 74], [31, 2, 2, 0], [31, 13, 0, 100], [31, 12, 2, 0]]);
});

test('set(): rejects invalid references with BAD_FIELD_REF', () => {
  const s = Editor.create();
  const bad = [
    null, 'gt1.src', {}, { section: 'leds', index: 0, control: 'source' },
    { section: 'gates', index: 12, control: 'source' }, { section: 'gates', index: -1, control: 'source' },
    { section: 'gates', index: 1.5, control: 'source' }, { section: 'gates', index: '1', control: 'source' },
    { section: 'gates', control: 'source' }, { section: 'inputs', index: 0, control: 'cc' },
    { section: 'globals', control: 'source' }, { section: 'cvOutputs', index: 0, control: 'duration' },
  ];
  for (const r of bad) throwsCode(() => Editor.set(s, r, 1), 'BAD_FIELD_REF');
  throwsCode(() => Editor.refOf('gt13.src'), 'BAD_FIELD_REF');
  throwsCode(() => Editor.idOf({ section: 'inputs', index: 4, control: 'source' }), 'BAD_FIELD_REF');
});

test('set(): rejects values that are not selectable options with BAD_FORM_VALUE', () => {
  const s = Editor.create();
  const bad = [
    [ref('gates', 0, 'minNote'), '36'], [ref('gates', 0, 'minNote'), 36.5], [ref('gates', 0, 'minNote'), 128],
    [ref('gates', 0, 'minNote'), -1], [ref('gates', 0, 'maxNote'), 0], [ref('cvOutputs', 0, 'volts'), 9],
    [ref('gates', 0, 'cc'), 6], [ref('cvOutputs', 1, 'cc'), 99], // reserved CCs are not selectable
    [ref('globals', 0, 'channel'), 'default'], [ref('globals', 0, 'channel'), 'omni'], [ref('globals', 0, 'channel'), 17],
    [ref('globals', 0, 'duration'), 'gate'], [ref('gates', 0, 'duration'), 16], [ref('gates', 0, 'duration'), 'omni'],
    [ref('gates', 0, 'channel'), 'gate'], [ref('gates', 0, 'source'), 24], [ref('inputs', 0, 'priority'), 2],
    [ref('gates', 0, 'source'), null], [ref('gates', 0, 'source'), undefined], [ref('gates', 0, 'source'), NaN],
  ];
  for (const [r, v] of bad) throwsCode(() => Editor.set(s, r, v), 'BAD_FORM_VALUE');
});

test('setValue(): same behaviour as set(), driven generically from the view\'s own options', () => {
  const r = rng(5150);
  let viaSet = Editor.create();
  let viaSetValue = Editor.create();
  for (let i = 0; i < 400; i++) {
    const f = r.pick(Editor.view(viaSetValue).fields);
    const option = r.pick(f.options.filter((o) => !o.disabled));
    viaSet = Editor.set(viaSet, f.ref, option.value);
    viaSetValue = Editor.setValue(viaSetValue, f.ref, option.value);
    assert.deepEqual(viaSetValue, viaSet);
  }
  assert.equal(bytesOf(viaSetValue), bytesOf(viaSet));
  throwsCode(() => Editor.setValue(viaSet, ref('globals', 0, 'channel'), 'omni'), 'BAD_FORM_VALUE');
  throwsCode(() => Editor.setValue(viaSet, ref('gates', 0, 'cc'), 6), 'BAD_FORM_VALUE');
  throwsCode(() => Editor.setValue(viaSet, { section: 'gates', index: 99, control: 'cc' }, 1), 'BAD_FIELD_REF');
});

// ===========================================================================
// Equivalence with the (oracle-verified) form layer
// ===========================================================================

test('fuzz: random edit sequences match the form layer step by step', () => {
  const r = rng(424243);
  const selectable = Form.FIELDS.map((f) => [f.name, f.options.filter((o) => !o.disabled).map((o) => o.value)]);
  for (let seq = 0; seq < 150; seq++) {
    let state = Editor.create();
    const values = Form.defaultFormValues();
    for (let step = 0; step < 40; step++) {
      // bias towards source fields so dependent fields switch on and off
      const pool = r.chance(0.3) ? selectable.filter(([n]) => n.endsWith('.src')) : selectable;
      const [name, options] = r.pick(pool);
      const v = r.pick(options);
      values[name] = v;
      state = Editor.set(state, Editor.refOf(name), typedValue(name, v));
    }
    assert.deepEqual(viewValues(state), typedValues(values), `seq ${seq} values`);
    assert.deepEqual(viewEnabled(state), Form.enabledFields(values), `seq ${seq} enabled`);
    assert.equal(bytesOf(state), hexGroups(MutantBrainPatch.fromFormValues(values).toSysex()), `seq ${seq} bytes`);
  }
});

test('fuzz: random .syx files load and save exactly like the form layer', () => {
  const r = rng(777001);
  for (let i = 0; i < 500; i++) {
    const bytes = randomSysex(r);
    const patch = MutantBrainPatch.fromSysex(bytes);
    const state = Editor.fromSysex(bytes);
    assert.deepEqual(viewValues(state), typedValues(patch.toFormValues()), `case ${i} values`);
    assert.equal(bytesOf(state), hexGroups(patch.normalize().toSysex()), `case ${i} bytes`);
    // then a few edits, mirrored on the form values
    const values = patch.toFormValues();
    const edits = randomUserValues(r, { density: 0.05 });
    let edited = state;
    for (const [name, v] of Object.entries(edits)) {
      values[name] = v;
      edited = Editor.set(edited, Editor.refOf(name), typedValue(name, v));
    }
    assert.equal(bytesOf(edited), hexGroups(MutantBrainPatch.fromFormValues(values).toSysex()), `case ${i} edited bytes`);
  }
});

test('fuzz: Editor.toPatch is the patch actually sent, and reloads to the same bytes', () => {
  const r = rng(2024);
  for (let i = 0; i < 200; i++) {
    const state = editorStateFor(randomUserValues(r));
    const patch = Editor.toPatch(state);
    assert.ok(patch instanceof MutantBrainPatch);
    assert.equal(hexGroups(patch.toSysex()), bytesOf(state));
    assert.equal(bytesOf(Editor.fromSysex(Editor.toSysex(state))), bytesOf(state), 'save -> load -> save is stable');
  }
});

test('toPatch(): settings that do not apply are sent as 0, like the original site', () => {
  let s = Editor.create();
  s = Editor.set(s, ref('inputs', 1, 'channel'), 5); // input 2 stays disabled
  const sent = Editor.toPatch(s);
  assert.deepEqual([sent.inputs[1].chanType, sent.inputs[1].chanNumber], [0, 0]);
  assert.deepEqual([s.inputs[1].chanType, s.inputs[1].chanNumber], [CHAN.SPECIFIC, 5], 'kept in the editor state');
});

// ===========================================================================
// Reading states
// ===========================================================================

test('view(), field(), get() and isEnabled() agree', () => {
  const r = rng(99);
  for (let i = 0; i < 30; i++) {
    const state = editorStateFor(randomUserValues(r));
    const view = Editor.view(state);
    assert.ok(Object.isFrozen(view) && Object.isFrozen(view.fields));
    for (const f of view.fields) {
      assert.equal(view.get(f.ref), f);
      assert.equal(Editor.get(state, f.ref), f.value);
      assert.equal(Editor.isEnabled(state, f.ref), f.enabled);
      assert.deepEqual(Editor.field(state, f.ref), f);
      assert.equal(f.id, Editor.idOf(f.ref));
      assert.equal(f.options, f.info.options);
    }
  }
});

// ===========================================================================
// Usage as React state
// ===========================================================================

test('works as React-style state: a pure reducer with reference-equality updates', () => {
  const reducer = (state, action) => {
    switch (action.type) {
      case 'load': return Editor.fromSysex(action.bytes);
      case 'set': return Editor.set(state, action.ref, action.value);
      case 'reset': return Editor.create();
      default: return state;
    }
  };
  const viewCache = new WeakMap(); // stands in for useMemo([state])
  const memoView = (state) => {
    if (!viewCache.has(state)) viewCache.set(state, Editor.view(state));
    return viewCache.get(state);
  };

  const ref0 = referencePatches()[0];
  let state = reducer(undefined, { type: 'load', bytes: ref0.bytes });
  const v1 = memoView(state);
  const same = reducer(state, { type: 'set', ref: ref('gates', 0, 'source'), value: Editor.get(state, ref('gates', 0, 'source')) });
  assert.equal(same, state, 'no-op update keeps the same state, so React skips the re-render');
  assert.equal(memoView(same), v1);

  const next = reducer(state, { type: 'set', ref: ref('gates', 11, 'source'), value: 22 });
  assert.notEqual(next, state);
  assert.equal(next.gates[0], state.gates[0], 'memoised components for the other gates can skip rendering');
  assert.equal(memoView(next).get(ref('gates', 11, 'source')).value, 22);
  assert.equal(memoView(next).get(ref('gates', 11, 'divider')).enabled, false);

  state = reducer(next, { type: 'reset' });
  assert.equal(bytesOf(state), bytesOf(Editor.create()));
  assert.ok(JSON.parse(JSON.stringify(next)), 'state is plain JSON-serialisable data');
});
