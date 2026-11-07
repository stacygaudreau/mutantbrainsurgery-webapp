'use strict';
/**
 * Golden-fixture tests (run on any OS). The fixtures in fixtures/generated were
 * produced by the ORIGINAL ASP code (npm run fixtures, Windows only), so these
 * tests pin the port to the original behaviour without needing the oracle.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MB, GENERATED_DIR, hexGroups } = require('./helpers');

const { MutantBrainPatch, Form } = MB;
const manifestPath = path.join(GENERATED_DIR, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { fixtures: [] };
const read = (f) => fs.readFileSync(path.join(GENERATED_DIR, f));
const diff = (a, base) => Object.fromEntries(Object.entries(a).filter(([k, v]) => base[k] !== v));

test('fixture manifest is present and covers forms and uploads', () => {
  assert.ok(manifest.fixtures.length >= 80, 'run `npm run fixtures` on Windows to regenerate');
  assert.ok(manifest.fixtures.some((f) => f.kind === 'form') && manifest.fixtures.some((f) => f.kind === 'load'));
  assert.deepEqual(manifest.freshFormValues, Form.defaultFormValues(), 'fresh form identical to the original page');
});

test('fixtures cover every source type of every row kind', () => {
  const seen = { cv: new Set(), gt: new Set(), dur: new Set(), prty: new Set(), div: new Set() };
  for (const f of manifest.fixtures) {
    const p = MutantBrainPatch.fromSysex(read(f.file));
    p.cvOutputs.forEach((c) => seen.cv.add(String(c.source)));
    p.gates.forEach((g) => { seen.gt.add(String(g.source)); seen.dur.add(String(g.durationType)); if (g.source === 20 || g.source === 21) seen.div.add(String(g.divider)); });
    p.inputs.forEach((n) => { if (n.source) seen.prty.add(String(n.priority)); });
  }
  for (const o of Form.OPTIONS.cvSource) assert.ok(seen.cv.has(o.value), `cv source ${o.label}`);
  for (const o of Form.OPTIONS.gateSource) assert.ok(seen.gt.has(o.value), `gate source ${o.label}`);
  for (const o of Form.OPTIONS.priority) assert.ok(seen.prty.has(o.value), `priority ${o.label}`);
  for (const o of Form.OPTIONS.clockDivider) assert.ok(seen.div.has(o.value), `divider ${o.label}`);
  assert.deepEqual([...seen.dur].sort(), ['0', '1', '2', '3']);
});

for (const f of manifest.fixtures) {
  test(`${f.file}: ${f.description}`, () => {
    const golden = read(f.file);
    if (f.kind === 'form') {
      assert.equal(hexGroups(MutantBrainPatch.fromFormValues(f.values).toSysex()), hexGroups(golden), 'form => bytes');
    } else {
      const input = read(f.input);
      const patch = MutantBrainPatch.fromSysex(input);
      assert.deepEqual(diff(patch.toFormValues(), manifest.freshFormValues), f.shownOnUpload, 'form shown after upload');
      assert.equal(hexGroups(patch.normalize().toSysex()), hexGroups(golden), 'upload + save => bytes');
    }
    // uploading the generated file again
    const reloaded = MutantBrainPatch.fromSysex(golden);
    const shown = reloaded.toFormValues();
    assert.deepEqual(diff(shown, manifest.freshFormValues), f.shownWhenUploaded, 'form shown when re-uploaded');
    assert.deepEqual(diff(Form.enabledFields(shown), Form.enabledFields({})), f.enabledWhenUploaded, 'enabled fields when re-uploaded');
    const resave = reloaded.normalize().toSysex();
    if (f.resaveIdentical) assert.equal(hexGroups(resave), hexGroups(golden), 're-save is identical');
    else assert.equal(hexGroups(resave), hexGroups(read(f.resaveFile)), 're-save matches the original site');
  });
}
