'use strict';
/**
 * Tests for PatchDocument, the in-memory patch an app edits: its name, its
 * settings and whether they changed since it was created, opened or saved.
 * The settings are an Editor state (verified in editor.test.js and, through
 * the Form layer, against the original site), so these tests check the
 * document's own rules and that its output equals the Editor's and the
 * original site's.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { MB, referencePatches, rng, randomSysex, randomUserValues, hexGroups, typedValue } = require('./helpers');

const { PatchDocument, Editor, MutantBrainPatch, MutantBrainError, DEFAULT_PATCH_NAME, PATCH_FILE_EXTENSION } = MB;
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof MutantBrainError && e.code === code);
const sameSettings = (a, b) => assert.equal(hexGroups(Editor.toSysex(a)), hexGroups(Editor.toSysex(b)));
const GATE1_MIN_NOTE = { section: 'gates', index: 0, control: 'minNote' };
const IN1_SOURCE = { section: 'inputs', index: 0, control: 'source' };

/** Apply form values one by one, the way the page does when a user picks them. */
function pick(doc, formValues) {
  for (const [name, value] of Object.entries(formValues)) {
    doc = PatchDocument.setValue(doc, Editor.refOf(name), typedValue(name, value));
  }
  return doc;
}

/** A document whose settings differ from a fresh patch. */
const edited = (name = 'edited') => PatchDocument.set(PatchDocument.create(name), GATE1_MIN_NOTE, 38);

function assertDocument(doc) {
  assert.ok(Object.isFrozen(doc), 'document is frozen');
  assert.deepEqual(Object.keys(doc).sort(), ['modified', 'name', 'patch']);
  assert.equal(typeof doc.name, 'string');
  assert.equal(typeof doc.modified, 'boolean');
  assert.ok(Object.isFrozen(doc.patch), 'settings are frozen');
}

test('exports', () => {
  assert.equal(DEFAULT_PATCH_NAME, 'New Patch');
  assert.equal(PATCH_FILE_EXTENSION, '.syx');
  assert.ok(Object.isFrozen(PatchDocument));
});

test('create: a fresh, unmodified patch', () => {
  const doc = PatchDocument.create();
  assertDocument(doc);
  assert.equal(doc.name, DEFAULT_PATCH_NAME);
  assert.equal(doc.modified, false);
  assert.deepEqual(doc.patch, Editor.create());
  assert.equal(PatchDocument.create('Drums').name, 'Drums');
  assert.equal(hexGroups(PatchDocument.toSysex(doc)), hexGroups(MutantBrainPatch.fromFormValues({}).toSysex()),
    'a new patch saves what a fresh page of the original site did');
});

test('open: settings from the bytes, name from the file name', () => {
  const patches = referencePatches();
  assert.ok(patches.length > 0, 'reference patches present');
  for (const { name, bytes } of patches) {
    const doc = PatchDocument.open(name, bytes);
    assertDocument(doc);
    assert.equal(doc.name, name.replace(/\.syx$/i, ''));
    assert.equal(doc.modified, false);
    assert.deepEqual(doc.patch, Editor.fromSysex(bytes), name);
    assert.equal(hexGroups(PatchDocument.toSysex(doc)), hexGroups(MutantBrainPatch.fromSysex(bytes).normalize().toSysex()), name);
    if (name !== 'AlesisNitro.syx') assert.equal(hexGroups(PatchDocument.toSysex(doc)), hexGroups(bytes), `${name} unchanged`);
  }
  // accepts the same inputs as the Editor
  const { bytes } = patches[0];
  const fromArray = PatchDocument.open('a.syx', Array.from(bytes));
  const fromBuffer = PatchDocument.open('a.syx', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  sameSettings(fromArray.patch, fromBuffer.patch);
});

test('nameFromFileName: base name without the .syx extension', () => {
  const cases = [
    ['Roland TR-08.syx', 'Roland TR-08'],
    ['DRUMS.SYX', 'DRUMS'],
    ['C:\\Users\\me\\Patches\\bass.syx', 'bass'],
    ['/home/me/patches/lead.syx', 'lead'],
    ['patch.mid', 'patch.mid'],
    ['twice.syx.syx', 'twice.syx'],
    ['  spaced  .syx', 'spaced'],
    ['.syx', DEFAULT_PATCH_NAME],
    ['', DEFAULT_PATCH_NAME],
    ['folder/', DEFAULT_PATCH_NAME],
  ];
  for (const [fileName, name] of cases) {
    assert.equal(PatchDocument.nameFromFileName(fileName), name, fileName);
    assert.equal(PatchDocument.open(fileName, Editor.toSysex(Editor.create())).name, name, `open ${fileName}`);
  }
});

test('open: a bad file throws and creates no document', () => {
  throwsCode(() => PatchDocument.open('yamaha.syx', [0xF0, 0x43, 0x10, 0x4C, 0xF7]), 'BAD_HEADER');
  throwsCode(() => PatchDocument.open('cut.syx', [0xF0, 0x00, 0x7F, 0x15, 1, 2]), 'TRUNCATED');
  throwsCode(() => PatchDocument.open('odd.syx', [0xF0, 0x00, 0x7F, 0x15, 2, 1, 0, 0, 0xF7]), 'UNKNOWN_BLOCK');
  throwsCode(() => PatchDocument.open('text.syx', 'nope'), 'BAD_INPUT');
});

test('set / setValue: change one setting and mark the document modified', () => {
  const doc = PatchDocument.create('Bass');
  const next = PatchDocument.set(doc, GATE1_MIN_NOTE, 38);
  assertDocument(next);
  assert.notEqual(next, doc);
  assert.equal(next.modified, true);
  assert.equal(next.name, 'Bass');
  assert.equal(Editor.get(next.patch, GATE1_MIN_NOTE), 38);
  assert.deepEqual(next.patch, Editor.set(doc.patch, GATE1_MIN_NOTE, 38), 'same as editing the Editor state');
  // the original is untouched
  assert.equal(doc.modified, false);
  assert.deepEqual(doc.patch, Editor.create());
  // setting the current value is not a change
  assert.equal(PatchDocument.set(next, GATE1_MIN_NOTE, 38), next);
  assert.equal(PatchDocument.setValue(doc, GATE1_MIN_NOTE, Editor.get(doc.patch, GATE1_MIN_NOTE)), doc);
  // setting it back is still a change since the last save
  assert.equal(PatchDocument.set(next, GATE1_MIN_NOTE, Editor.get(doc.patch, GATE1_MIN_NOTE)).modified, true);
});

test('set: invalid values and references throw, leaving the document as it was', () => {
  const doc = PatchDocument.create();
  const snapshot = JSON.stringify(doc);
  assert.throws(() => PatchDocument.set(doc, GATE1_MIN_NOTE, 1000), MutantBrainError);
  assert.throws(() => PatchDocument.setValue(doc, GATE1_MIN_NOTE, 'omni'), MutantBrainError);
  throwsCode(() => PatchDocument.setValue(doc, { section: 'gates', index: 12, control: 'minNote' }, 1), 'BAD_FIELD_REF');
  throwsCode(() => PatchDocument.setValue(doc, { section: 'leds', index: 0, control: 'minNote' }, 1), 'BAD_FIELD_REF');
  assert.equal(JSON.stringify(doc), snapshot);
});

test('rename: changes the name only, and is not a change of settings', () => {
  const doc = PatchDocument.create();
  const renamed = PatchDocument.rename(doc, 'Lead');
  assertDocument(renamed);
  assert.equal(renamed.name, 'Lead');
  assert.equal(renamed.patch, doc.patch, 'settings shared, not copied');
  assert.equal(renamed.modified, false);
  assert.equal(doc.name, DEFAULT_PATCH_NAME, 'original keeps its name');
  assert.equal(PatchDocument.rename(renamed, 'Lead'), renamed, 'same name: same document');
  const changed = edited();
  assert.equal(PatchDocument.rename(changed, 'x').modified, true, 'keeps the modified flag');
  // the name is kept as typed (even empty); only the file name is cleaned up
  assert.equal(PatchDocument.rename(doc, '').name, '');
  assert.equal(PatchDocument.rename(doc, ' a/b ').name, ' a/b ');
});

test('clear: fresh settings, same name', () => {
  const doc = PatchDocument.open('Kit 1.syx', referencePatches()[0].bytes);
  const cleared = PatchDocument.clear(doc);
  assertDocument(cleared);
  assert.equal(cleared.name, 'Kit 1');
  assert.deepEqual(cleared.patch, Editor.create());
  assert.equal(cleared.modified, true);
  assert.equal(doc.name, 'Kit 1');
  assert.deepEqual(doc.patch, Editor.fromSysex(referencePatches()[0].bytes), 'original untouched');
  // clear differs from create only in the name (and the modified flag)
  sameSettings(cleared.patch, PatchDocument.create().patch);
  // already fresh: nothing to clear
  const fresh = PatchDocument.create('Kit 2');
  assert.equal(PatchDocument.clear(fresh), fresh);
  assert.equal(PatchDocument.clear(cleared), cleared);
});

test('fileName: the name made safe for any file system, plus .syx', () => {
  const cases = [
    ['Roland TR-08', 'Roland TR-08.syx'],
    ['drums.syx', 'drums.syx'],
    ['drums.SYX', 'drums.syx'],
    ['a/b\\c:d*e?f"g<h>i|j', 'a-b-c-d-e-f-g-h-i-j.syx'],
    ['  padded  ', 'padded.syx'],
    ['tab\there\nnewline', 'tabherenewline.syx'],
    ['...hidden', 'hidden.syx'],
    ['', 'New Patch.syx'],
    ['   ', 'New Patch.syx'],
    ['.syx', 'New Patch.syx'],
    ['Ünïcödé 🎛', 'Ünïcödé 🎛.syx'],
    ['x'.repeat(300), `${'x'.repeat(120)}.syx`],
  ];
  for (const [name, fileName] of cases) {
    assert.equal(PatchDocument.fileName(PatchDocument.rename(PatchDocument.create(), name)), fileName, JSON.stringify(name));
  }
  // a saved file opens under the same name it was saved with (for names that are already safe)
  for (const name of ['Roland TR-08', 'My kit (v2)', 'bass.v1']) {
    const doc = PatchDocument.rename(PatchDocument.create(), name);
    assert.equal(PatchDocument.nameFromFileName(PatchDocument.fileName(doc)), name);
  }
});

test('save: file name and bytes, and the document marked saved', () => {
  const doc = PatchDocument.rename(edited(), 'My kit');
  const saved = PatchDocument.save(doc);
  assert.ok(Object.isFrozen(saved));
  assert.deepEqual(Object.keys(saved).sort(), ['bytes', 'document', 'fileName']);
  assert.equal(saved.fileName, 'My kit.syx');
  assert.ok(saved.bytes instanceof Uint8Array);
  assert.equal(hexGroups(saved.bytes), hexGroups(Editor.toSysex(doc.patch)));
  assertDocument(saved.document);
  assert.equal(saved.document.modified, false);
  assert.equal(saved.document.name, doc.name);
  assert.equal(saved.document.patch, doc.patch);
  assert.equal(doc.modified, true, 'original still marked modified');
  const unmodified = PatchDocument.create();
  assert.equal(PatchDocument.save(unmodified).document, unmodified, 'nothing to mark');
  // saving twice gives the same bytes; the bytes are a fresh copy each time
  const again = PatchDocument.save(saved.document);
  assert.equal(hexGroups(again.bytes), hexGroups(saved.bytes));
  again.bytes[0] = 0;
  assert.equal(PatchDocument.toSysex(doc)[0], 0xF0);
});

/** The values of the settings that are in use (disabled ones are saved as 0, as the original site did). */
const enabledValues = (state) => Object.fromEntries(Editor.view(state).fields.filter((f) => f.enabled).map((f) => [f.id, f.value]));

test('save then open: same name, same settings in use, same bytes', () => {
  const r = rng(0xD0C);
  for (let i = 0; i < 40; i++) {
    const doc = PatchDocument.rename(pick(PatchDocument.create(), randomUserValues(r)), `patch ${i}`);
    const { fileName, bytes } = PatchDocument.save(doc);
    const reopened = PatchDocument.open(fileName, bytes);
    assert.equal(reopened.name, doc.name);
    assert.equal(reopened.modified, false);
    // the original site does not send the volts range for BPM / fixed voltage CVs: it reopens as the default
    const before = enabledValues(doc.patch);
    const after = enabledValues(reopened.patch);
    const freshVolts = Editor.get(Editor.create(), { section: 'cvOutputs', index: 0, control: 'volts' });
    for (const id of Object.keys(before)) {
      if (id.endsWith('.volts') && before[id] !== after[id]) assert.equal(after[id], freshVolts, `patch ${i} ${id}`);
      else assert.equal(after[id], before[id], `patch ${i} ${id}`);
    }
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), `patch ${i} same settings in use`);
    assert.equal(hexGroups(PatchDocument.save(reopened).bytes), hexGroups(bytes), `patch ${i} saves the same again`);
  }
  // a value left in a setting that is not in use is not saved
  const hidden = PatchDocument.set(PatchDocument.create(), { section: 'inputs', index: 0, control: 'minNote' }, 40);
  assert.equal(Editor.isEnabled(hidden.patch, { section: 'inputs', index: 0, control: 'minNote' }), false);
  const reopened = PatchDocument.open('x.syx', PatchDocument.save(hidden).bytes);
  assert.notEqual(Editor.get(reopened.patch, { section: 'inputs', index: 0, control: 'minNote' }), 40);
  assert.equal(hexGroups(PatchDocument.save(hidden).bytes), hexGroups(PatchDocument.save(PatchDocument.create()).bytes));
});

test('picking values one by one saves what the original site sent for them', () => {
  const r = rng(0x5173);
  for (let i = 0; i < 150; i++) {
    const values = randomUserValues(r);
    const doc = pick(PatchDocument.create(), values);
    assert.equal(hexGroups(PatchDocument.toSysex(doc)), hexGroups(MutantBrainPatch.fromFormValues(values).toSysex()), `case ${i}`);
  }
});

test('opening any file saves what loading it into the original site and saving did', () => {
  const r = rng(0x0FE7);
  for (let i = 0; i < 150; i++) {
    const bytes = randomSysex(r);
    let doc;
    try { doc = PatchDocument.open('random.syx', bytes); } catch (e) {
      assert.ok(e instanceof MutantBrainError);
      assert.throws(() => MutantBrainPatch.fromSysex(bytes), MutantBrainError, 'rejected by the codec too');
      continue;
    }
    assert.equal(hexGroups(PatchDocument.toSysex(doc)), hexGroups(MutantBrainPatch.fromSysex(bytes).normalize().toSysex()), `case ${i}`);
  }
});

test('random editing sessions keep the document rules', () => {
  const r = rng(0xED17);
  const refs = Editor.schema.sections.flatMap((s) => Array.from({ length: s.count }, (_, i) => Editor.fieldsOf(s.key, i)).flat());
  const patches = referencePatches();
  for (let session = 0; session < 20; session++) {
    let doc = PatchDocument.create();
    // a simple model of what the document should be
    let name = DEFAULT_PATCH_NAME;
    let settings = Editor.create();
    let savedSettings = settings;
    for (let step = 0; step < 60; step++) {
      const before = doc;
      const action = r.int(0, 9);
      if (action <= 5) {
        const ref = r.pick(refs);
        const option = r.pick(Editor.view(doc.patch).get(ref).options.filter((o) => !o.disabled)); // what a user can pick
        doc = PatchDocument.setValue(doc, ref, option.value);
        settings = Editor.setValue(settings, ref, option.value);
      } else if (action === 6) {
        name = `name ${r.int(0, 3)}`;
        doc = PatchDocument.rename(doc, name);
      } else if (action === 7) {
        doc = PatchDocument.clear(doc);
        settings = Editor.create();
      } else if (action === 8) {
        const saved = PatchDocument.save(doc);
        assert.equal(saved.fileName, PatchDocument.fileName(doc));
        doc = saved.document;
        savedSettings = settings;
      } else if (patches.length) {
        const p = r.pick(patches);
        doc = PatchDocument.open(p.name, p.bytes);
        name = p.name.replace(/\.syx$/i, '');
        settings = savedSettings = Editor.fromSysex(p.bytes);
      }
      assertDocument(doc);
      assert.equal(doc.name, name);
      assert.deepEqual(doc.patch, settings);
      // modified: false right after create/open/save; otherwise set exactly when the settings changed
      if (action === 8 || action === 9) assert.equal(doc.modified, false);
      else if (JSON.stringify(doc.patch) !== JSON.stringify(before.patch)) assert.equal(doc.modified, true);
      else assert.equal(doc.modified, before.modified);
      if (!doc.modified) assert.equal(hexGroups(Editor.toSysex(doc.patch)), hexGroups(Editor.toSysex(savedSettings)));
      assert.equal(hexGroups(PatchDocument.toSysex(doc)), hexGroups(Editor.toSysex(settings)));
    }
  }
});

test('documents are never mutated', () => {
  const doc = PatchDocument.create();
  assert.throws(() => { 'use strict'; doc.name = 'x'; }, TypeError);
  assert.throws(() => { 'use strict'; doc.modified = true; }, TypeError);
  assert.throws(() => { 'use strict'; doc.patch.gates[0].minNote = 1; }, TypeError);
});

test('serialize / deserialize: the whole document comes back, as it was', () => {
  const r = rng(0x5e71a1);
  const patches = referencePatches();
  for (let i = 0; i < 120; i++) {
    let doc = i % 3 === 0 && patches.length ? PatchDocument.open(r.pick(patches).name, r.pick(patches).bytes) : PatchDocument.create(`patch ${i}`);
    doc = pick(doc, randomUserValues(r));
    // values in settings that are switched off survive too (a .syx would save them as 0)
    doc = PatchDocument.set(doc, { section: 'inputs', index: 3, control: 'minNote' }, r.int(0, 127));
    if (r.chance(0.3)) doc = PatchDocument.save(doc).document;
    if (r.chance(0.3)) doc = PatchDocument.rename(doc, `name "with" <odd> characters ✓ ${i}`);
    const text = PatchDocument.serialize(doc);
    assert.equal(typeof text, 'string');
    const back = PatchDocument.deserialize(text);
    assertDocument(back);
    assert.equal(back.name, doc.name, `doc ${i} name`);
    assert.equal(back.modified, doc.modified, `doc ${i} modified`);
    assert.deepEqual(back.patch, doc.patch, `doc ${i} settings`);
    assert.equal(hexGroups(PatchDocument.toSysex(back)), hexGroups(PatchDocument.toSysex(doc)), `doc ${i} bytes`);
  }
  const saved = JSON.parse(PatchDocument.serialize(PatchDocument.create()));
  assert.deepEqual(Object.keys(saved), ['format', 'version', 'name', 'modified', 'patch']);
  assert.equal(saved.format, 'mutantbrain-patch-document');
  assert.equal(saved.version, 1);
});

test('deserialize: anything but a saved document is rejected (BAD_DOCUMENT)', () => {
  const good = JSON.parse(PatchDocument.serialize(PatchDocument.create()));
  const variant = (change) => { const d = JSON.parse(JSON.stringify(good)); change(d); return JSON.stringify(d); };
  const bad = [
    'not json',
    '',
    'null',
    '42',
    '[]',
    variant((d) => { d.format = 'something-else'; }),
    variant((d) => { delete d.format; }),
    variant((d) => { d.version = 2; }),
    variant((d) => { d.name = 5; }),
    variant((d) => { d.modified = 'yes'; }),
    variant((d) => { delete d.patch; }),
    variant((d) => { d.patch = 'patch'; }),
    variant((d) => { d.patch.gates.pop(); }),
    variant((d) => { d.patch.inputs.push(d.patch.inputs[0]); }),
    variant((d) => { delete d.patch.globals; }),
    variant((d) => { d.patch.globals.extra = 1; }),
    variant((d) => { delete d.patch.cvOutputs[2].volts; }),
    variant((d) => { d.patch.gates[3].minNote = 128; }),
    variant((d) => { d.patch.gates[3].minNote = -1; }),
    variant((d) => { d.patch.gates[3].minNote = 1.5; }),
    variant((d) => { d.patch.gates[3].minNote = '36'; }),
    variant((d) => { d.patch.gates[3] = null; }),
  ];
  for (const text of bad) throwsCode(() => PatchDocument.deserialize(text), 'BAD_DOCUMENT');
  // the good one still works
  assert.equal(PatchDocument.deserialize(JSON.stringify(good)).name, DEFAULT_PATCH_NAME);
});
