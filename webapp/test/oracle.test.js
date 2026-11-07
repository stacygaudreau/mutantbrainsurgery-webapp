'use strict';
/**
 * Differential tests: the JavaScript port versus the ORIGINAL ASP code,
 * executed for real under Windows Script Host (tools/asp-oracle). This is the
 * strongest correctness check: any divergence in rendering, enable/disable
 * logic, form submission, decoding or encoding fails here.
 *
 * Skipped automatically when the oracle is unavailable (non-Windows, or the
 * original .asp/.inc files are not next to webapp/).
 *
 * Fuzz volume scales with ORACLE_FUZZ (default 1; e.g. ORACLE_FUZZ=10).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const oracle = require('../tools/asp-oracle/oracle');
const { SimPage } = require('../tools/asp-oracle/browser-sim');
const { MB, referencePatches, rng, randomUserValues, randomSysex, hexGroups } = require('./helpers');

const { MutantBrainPatch, Form } = MB;
const available = oracle.isAvailable();
const SCALE = Math.max(0.1, Number(process.env.ORACLE_FUZZ) || 1);
const N_FORMS = Math.round(2000 * SCALE);
const N_SYSEX = Math.round(400 * SCALE);
const opts = { skip: available ? false : 'ASP oracle unavailable (needs Windows cscript.exe + original ASP files)' };

/** Run an oracle pipeline over `list` in batches (keeps memory flat at large ORACLE_FUZZ). */
async function inBatches(list, size, run, check) {
  for (let start = 0; start < list.length; start += size) {
    const batch = list.slice(start, start + size);
    const results = await run(batch);
    results.forEach((res, j) => check(res, start + j));
  }
}

function diffKeys(a, b) {
  return Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).map((k) => `${k}: oracle=${a[k]} port=${b[k]}`);
}

test('oracle: the original source needed exactly one compile fix', opts, () => {
  // sysex.inc line "//Const NRPVH_SRC_MIDICONT = 24" is a VBScript syntax error
  // ("Expected statement"); the oracle treats it as the comment it was meant to be.
  assert.deepEqual(oracle.fixes().map((f) => f.replace(/\s+/g, ' ')), [
    'sysex.inc: commented out invalid VBScript line "//Const NRPVH_SRC_MIDICONT = 24"',
  ]);
});

test('schema: every <select> of patch.asp matches Form.FIELDS exactly', opts, async () => {
  const page = new SimPage(await oracle.freshPageHtml());
  assert.deepEqual(page.selects.map((s) => s.name), Form.FIELDS.map((f) => f.name), 'field names and page order');
  for (const s of page.selects) {
    const f = Form.field(s.name);
    assert.deepEqual(
      s.options.map((o) => [o.value, o.label, o.disabled]),
      f.options.map((o) => [o.value, o.label, !!o.disabled]),
      `options of ${s.name}`,
    );
  }
});

test('fresh page: displayed values, enabled fields and saved bytes match', opts, async () => {
  const page = new SimPage(await oracle.freshPageHtml());
  assert.deepEqual(diffKeys(page.values(), Form.defaultFormValues()), []);
  assert.deepEqual(diffKeys(page.enabled(), Form.enabledFields({})), []);
  const [res] = await oracle.submitUserForm([{}]);
  assert.deepEqual(res.submission, Form.submittedValues({}));
  assert.equal(hexGroups(MutantBrainPatch.fromFormValues({}).toSysex()), hexGroups(res.bytes));
});

test('get_sysex.asp: download headers, and its stray whitespace is the only extra output', opts, async () => {
  const [res] = await oracle.submitUserForm([{}]);
  assert.equal(res.headers['content-type'], 'application/octet-stream');
  assert.equal(res.headers['content-disposition'], `attachment; filename=${MB.DEFAULT_FILENAME}`);
  // The original page wrote the line breaks around its <% %> blocks into the
  // download too (with the server's LF files: "\n" + sysex + "\n\n\n"). The
  // reference .syx files are clean F0..F7, and so is the port's output.
  assert.match(res.strayText, /^[\r\n]+$/);
  const start = res.raw.indexOf(0xF0);
  const end = res.raw.lastIndexOf(0xF7);
  assert.match(res.raw.subarray(0, start).toString('latin1'), /^[\r\n]+$/, 'only line breaks before F0');
  assert.match(res.raw.subarray(end + 1).toString('latin1'), /^[\r\n]+$/, 'only line breaks after F7');
  assert.deepEqual(res.raw.subarray(start, end + 1), res.bytes);
  assert.equal(res.bytes[0], 0xF0);
  assert.equal(res.bytes[res.bytes.length - 1], 0xF7);
});

test('reference patches: rendering, enable state and load+save are identical', opts, async () => {
  const refs = referencePatches();
  const results = await oracle.loadAndSave(refs.map((r) => r.bytes));
  results.forEach((res, i) => {
    const name = refs[i].name;
    const patch = MutantBrainPatch.fromSysex(refs[i].bytes);
    assert.equal(res.page.error, false, `${name} loads without error`);
    assert.deepEqual(diffKeys(res.page.values(), patch.toFormValues()), [], `${name} form values`);
    assert.deepEqual(diffKeys(res.page.enabled(), Form.enabledFields(patch.toFormValues())), [], `${name} enabled`);
    assert.equal(hexGroups(patch.normalize().toSysex()), hexGroups(res.bytes), `${name} load+save bytes`);
  });
});

test(`fuzz: ${N_FORMS} random user forms => identical enable state, submission and SysEx`, opts, async () => {
  const r = rng(20250101);
  const inputs = Array.from({ length: N_FORMS }, (_, i) => randomUserValues(r, { density: [0.2, 0.6, 1][i % 3] }));
  await inBatches(inputs, 1000, (b) => oracle.submitUserForm(b), (res, i) => {
    const ctx = `form case ${i}: ${JSON.stringify(inputs[i])}`;
    assert.deepEqual(diffKeys(res.page.enabled(), Form.enabledFields(inputs[i])), [], ctx);
    assert.deepEqual(res.submission, Form.submittedValues(inputs[i]), ctx);
    assert.equal(hexGroups(MutantBrainPatch.fromFormValues(inputs[i]).toSysex()), hexGroups(res.bytes), ctx);
  });
});

test(`fuzz: ${N_SYSEX} random .syx uploads => identical form, enable state and re-saved SysEx`, opts, async () => {
  const r = rng(424242);
  const files = Array.from({ length: N_SYSEX }, () => Buffer.from(randomSysex(r)));
  let quirkHits = 0;
  await inBatches(files, 200, (b) => oracle.loadAndSave(b), (res, i) => {
    const ctx = `sysex case ${i}: ${hexGroups(files[i])}`;
    const patch = MutantBrainPatch.fromSysex(files[i]);
    const shown = patch.toFormValues();
    assert.equal(res.page.error, false, ctx);
    assert.deepEqual(diffKeys(res.page.values(), shown), [], ctx);
    assert.deepEqual(diffKeys(res.page.enabled(), Form.enabledFields(shown)), [], ctx);
    assert.equal(hexGroups(patch.normalize().toSysex()), hexGroups(res.bytes), ctx);
    if (Object.entries(Form.submittedValues(shown)).length !== Object.values(Form.enabledFields(shown)).filter(Boolean).length) quirkHits++;
  });
  assert.ok(quirkHits > 0, 'fuzz should exercise the "selected disabled option" quirk');
});

test('second-generation fuzz: re-uploading the oracle\'s own saved files', opts, async () => {
  const r = rng(99);
  const files = Array.from({ length: Math.round(100 * SCALE) }, () => Buffer.from(randomSysex(r)));
  const firstSaves = [];
  await inBatches(files, 200, (b) => oracle.loadAndSave(b), (res) => firstSaves.push(res.bytes));
  await inBatches(firstSaves, 200, (b) => oracle.loadAndSave(b), (res, i) => {
    const port = MutantBrainPatch.fromSysex(firstSaves[i]).normalize().toSysex();
    assert.equal(hexGroups(port), hexGroups(res.bytes), `case ${i}`);
  });
});

test('error parity: the port rejects exactly the files the original rejected', opts, async () => {
  const H = [0xF0, 0x00, 0x7F, 0x15];
  const cases = {
    'empty file': [],
    'foreign sysex (Yamaha)': [0xF0, 0x43, 0x10, 0x4C, 0x00, 0xF7],
    'wrong device id': [0xF0, 0x00, 0x7F, 0x16, 0xF7],
    'not sysex': [0x90, 0x3C, 0x7F],
    'header only, no F7': H,
    'missing F7 after params': [...H, 1, 2, 0, 5],
    'truncated param': [...H, 1, 2, 0],
    'unknown block 0x02': [...H, 2, 1, 0, 0, 0xF7],
    'unknown block 0x2B (gate 13)': [...H, 0x2B, 1, 0, 0, 0xF7],
    'no params': [...H, 0xF7],
    'legacy id 00 7F 12': [0xF0, 0x00, 0x7F, 0x12, 1, 2, 0, 3, 0xF7],
    'junk after F7': [...H, 1, 2, 0, 3, 0xF7, 0x01, 0x02, 0x03],
    'F7 inside a param': [...H, 11, 3, 0, 0xF7, 0xF7],
    'unknown params only': [...H, 1, 99, 9, 9, 21, 98, 0, 1, 31, 3, 0, 7, 0xF7],
  };
  const names = Object.keys(cases);
  const results = await oracle.loadPagesRaw(names.map((n) => Buffer.from(cases[n])));
  results.forEach((res, i) => {
    const name = names[i];
    const oracleRejects = res.status !== 'OK' || res.page.error;
    let portError = null;
    try { MutantBrainPatch.fromSysex(cases[name]); } catch (e) { portError = e; }
    assert.equal(!!portError, oracleRejects, `${name}: oracle ${res.status} ${res.page && res.page.error ? 'error-message' : ''}, port ${portError && portError.code}`);
    if (!portError) {
      assert.deepEqual(diffKeys(res.page.values(), MutantBrainPatch.fromSysex(cases[name]).toFormValues()), [], name);
    }
  });
});
