#!/usr/bin/env node
'use strict';
/**
 * Generates golden .syx fixtures using the ORIGINAL ASP code as ground truth
 * (tools/asp-oracle, needs Windows). Output: test/fixtures/generated/
 *
 *   form-*.syx    what get_sysex.asp produced for a filled-in form
 *   load-*.in.syx / load-*.out.syx
 *                 a file uploaded to patch.asp and what pressing the button
 *                 produced afterwards
 *   manifest.json form values used, and what the original page displayed
 *                 when each generated file was uploaded again
 *
 * test/generated.test.js then checks the port against these on any OS.
 * Re-run with: npm run fixtures
 */
const fs = require('fs');
const path = require('path');
const oracle = require('./asp-oracle/oracle');
const { SimPage } = require('./asp-oracle/browser-sim');
const { MB, rng, randomUserValues, randomSysex, GENERATED_DIR } = require('../test/helpers');

const { Form } = MB;
const rows = (prefix, n, fn) => Object.assign({}, ...Array.from({ length: n }, (_, i) => fn(`${prefix}${i + 1}.`, i)));

// ------------------------------------------------------------------ curated forms
const FORMS = [
  ['globals-chan16-dur120', 'Global default channel 16, default trigger 120ms', { 'global.chan': '16', 'global.dur': '120' }],
  ['globals-chan1-dur1', 'Global default channel 1, default trigger 1ms', { 'global.chan': '1', 'global.dur': '1' }],
  ['inputs-priorities-a', 'Four inputs: last/lowest/highest/2-note-cycle priority', rows('in', 4, (p, i) => ({ [p + 'src']: '1', [p + 'chan']: String(i + 1), [p + 'prty']: ['0', '1', '3', '6'][i] }))],
  ['inputs-priorities-b', 'Four inputs: 3/4-note cycle, 2/3-note chord', rows('in', 4, (p, i) => ({ [p + 'src']: '1', [p + 'prty']: ['7', '8', '9', '10'][i] }))],
  ['inputs-chord4-omni', 'Input 1: 4-note chord on OMNI, bend +/-24', { 'in1.src': '1', 'in1.chan': 'omni', 'in1.prty': '11', 'in1.bend': '24' }],
  ['inputs-keyboard-split', 'Split: input 1 notes 0-59 chan 2, input 2 notes 60-127 chan 2, min velocity 64',
    { 'in1.src': '1', 'in1.chan': '2', 'in1.min_note': '0', 'in1.max_note': '59', 'in1.min_vel': '64', 'in2.src': '1', 'in2.chan': '2', 'in2.min_note': '60', 'in2.max_note': '127', 'in2.bend': '0' }],
  ['inputs-disabled-with-values', 'Values chosen then input disabled: nothing but src is sent',
    { 'in3.chan': '9', 'in3.prty': '10', 'in3.min_note': '12', 'in3.bend': '7', 'in3.src': '0' }],
  ['cv-note-pitch', 'CV A-D: note pitch 1-4 of inputs 1-4, transposes and schemes',
    { ...rows('in', 4, (p) => ({ [p + 'src']: '1' })), ...rows('cv', 4, (p, i) => ({ [p + 'src']: String(11 + i), [p + 'event']: String(i + 1), [p + 'trans']: ['100', '28', '64', '71'][i], [p + 'scheme']: ['0', '1', '2', '0'][i] })) }],
  ['cv-velocity', 'CV A/B: velocity of inputs 1/2, range 1V and 8V',
    { 'in1.src': '1', 'in2.src': '1', 'cv1.src': '11', 'cv1.event': '20', 'cv1.volts': '1', 'cv2.src': '12', 'cv2.event': '20', 'cv2.volts': '8' }],
  ['cv-midi-cc', 'CV A-D: MIDI CC on omni/default/chan 5/chan 16, CCs 1/7/74/127, ranges 2-8V',
    rows('cv', 4, (p, i) => ({ [p + 'src']: '2', [p + 'chan']: ['omni', 'default', '5', '16'][i], [p + 'cc']: ['1', '7', '74', '127'][i], [p + 'volts']: ['2', '4', '6', '8'][i] }))],
  ['cv-bend-aftertouch', 'CV A: pitch bend chan 3 5V, CV B: aftertouch default chan 1V',
    { 'cv1.src': '4', 'cv1.chan': '3', 'cv1.volts': '5', 'cv2.src': '5', 'cv2.volts': '1' }],
  ['cv-bpm-fixed', 'CV A: BPM to CV, CV B: fixed voltage (the range is NOT sent by the original site)',
    { 'cv1.src': '20', 'cv1.volts': '3', 'cv2.src': '127', 'cv2.volts': '7' }],
  ['gates-note-input-events', 'Gates 1-6: note input events first/second/third/fourth/any on/all off',
    rows('gt', 6, (p, i) => ({ [p + 'src']: String(11 + (i % 4)), [p + 'event']: ['1', '2', '3', '4', '5', '0'][i], [p + 'dur']: 'inf' }))],
  ['gates-midi-note-ranges', 'Gates 1-4: MIDI note single/range, chan specific/omni/default, velocity thresholds',
    { 'gt1.src': '1', 'gt1.chan': '10', 'gt1.min_note': '36', 'gt1.max_note': '36',
      'gt2.src': '1', 'gt2.chan': 'omni', 'gt2.min_note': '0', 'gt2.max_note': '127', 'gt2.min_vel': '100',
      'gt3.src': '1', 'gt3.min_note': '60', 'gt3.max_note': '72', 'gt3.min_vel': '2',
      'gt4.src': '1', 'gt4.chan': '1', 'gt4.min_note': '127', 'gt4.max_note': '1' }],
  ['gates-cc-thresholds', 'Gates 1-4: CC above/below threshold, thresholds 1/64/127, channels',
    { 'gt1.src': '2', 'gt1.cc': '64', 'gt1.thrs': '64', 'gt2.src': '3', 'gt2.cc': '64', 'gt2.thrs': '64',
      'gt3.src': '2', 'gt3.cc': '1', 'gt3.thrs': '1', 'gt3.chan': 'omni', 'gt4.src': '3', 'gt4.cc': '127', 'gt4.thrs': '127', 'gt4.chan': '16' }],
  ['gates-clock-dividers-a', 'Gates 1-12: clock tick, first 12 dividers',
    rows('gt', 12, (p, i) => ({ [p + 'src']: '20', [p + 'div']: Form.OPTIONS.clockDivider[i].value }))],
  ['gates-clock-dividers-b', 'Gates 1-3: clock tick+run, last 3 dividers, tick offsets',
    rows('gt', 3, (p, i) => ({ [p + 'src']: '21', [p + 'div']: Form.OPTIONS.clockDivider[12 + i].value, [p + 'ofs']: ['1', '23', '127'][i] }))],
  ['gates-transport', 'Gates 1-4: transport run/restart/stop/start-stop',
    rows('gt', 4, (p, i) => ({ [p + 'src']: ['22', '23', '25', '26'][i] }))],
  ['gates-durations', 'Gates 1-8 (MIDI note): gate/retrig/default/1/14/15/20/120ms',
    rows('gt', 8, (p, i) => ({ [p + 'src']: '1', [p + 'min_note']: String(36 + i), [p + 'max_note']: String(36 + i), [p + 'dur']: ['inf', 'retrig', 'default', '1', '14', '15', '20', '120'][i] }))],
  ['gates-disabled-with-values', 'Values chosen then gate disabled: only src and (1,0) duration are sent',
    { 'gt5.cc': '7', 'gt5.dur': 'retrig', 'gt5.div': '96', 'gt5.src': '0' }],
  ['full-poly-4voice', 'Full 4-voice poly: 4 inputs (4-note cycle), pitch CVs, gate per voice, clock + transport',
    { 'global.chan': '1', ...rows('in', 4, (p) => ({ [p + 'src']: '1', [p + 'chan']: 'default', [p + 'prty']: '8' })),
      ...rows('cv', 4, (p, i) => ({ [p + 'src']: String(11 + i), [p + 'event']: '1' })),
      ...rows('gt', 4, (p, i) => ({ [p + 'src']: String(11 + i), [p + 'event']: '1', [p + 'dur']: 'inf' })),
      'gt5.src': '20', 'gt5.div': '24', 'gt6.src': '22', 'gt7.src': '23' }],
  ['full-paraphonic-chord', 'Input 1 as 4-note chord driving CV A-D pitches 1-4 and velocity gates',
    { 'in1.src': '1', 'in1.prty': '11', ...rows('cv', 4, (p, i) => ({ [p + 'src']: '11', [p + 'event']: String(i + 1) })),
      ...rows('gt', 4, (p, i) => ({ [p + 'src']: '11', [p + 'event']: String(i + 1) })), 'gt5.src': '11', 'gt5.event': '5', 'gt6.src': '11', 'gt6.event': '0' }],
  ['everything-max', 'Every enabled field at its last option',
    Object.fromEntries(Form.FIELDS.map((f) => [f.name, f.options.filter((o) => !o.disabled).slice(-1)[0].value]))],
];

// ------------------------------------------------------------------ uploads
const H = [0xF0, 0x00, 0x7F, 0x15];
const LOADS = [
  ['legacy-device-id', 'File with the legacy device id 00 7F 12: accepted, re-saved with 00 7F 15',
    [0xF0, 0x00, 0x7F, 0x12, 1, 2, 0, 3, 11, 1, 1, 0, 11, 2, 1, 0, 21, 1, 11, 1, 0xF7]],
  ['cc-disabled-option', 'CV A on CC 6 (a disabled dropdown option): shown selected but not submitted => saved as CC 0',
    [...H, 21, 1, 2, 6, 21, 2, 0, 1, 31, 1, 2, 99, 0xF7]],
  ['cv-cc-negative', 'CV source 3 (CC negative) has no CV dropdown option => form shows "(disable)"',
    [...H, 22, 1, 3, 10, 22, 2, 0, 2, 0xF7]],
  ['unmatched-values', 'Values with no dropdown option (17ms, max note 0, min vel 0) fall back to the first option',
    [...H, 11, 1, 1, 0, 11, 4, 0, 0, 11, 5, 0, 0, 31, 1, 1, 40, 31, 12, 1, 17, 1, 12, 0, 0, 0xF7]],
  ['params-only-header', 'No parameters at all: every field keeps its default', [...H, 0xF7]],
  ['out-of-order-duplicates', 'Parameters out of order with duplicates: the last one wins',
    [...H, 31, 12, 0, 0, 1, 2, 0, 4, 31, 1, 20, 12, 1, 2, 0, 7, 31, 1, 21, 24, 0xF7]],
  ['unknown-params', 'Unknown parameter ids (calibration, split, glide, save) are ignored',
    [...H, 1, 100, 0, 1, 11, 9, 0, 60, 21, 98, 0, 70, 21, 99, 0, 60, 21, 17, 0, 10, 31, 3, 0, 50, 0xF7]],
];

async function main() {
  if (!oracle.isAvailable()) {
    console.error('The ASP oracle needs Windows (cscript.exe) and the original .asp/.inc files next to webapp/.');
    process.exit(1);
  }
  const r = rng(0x5EED);
  const forms = [...FORMS];
  for (let i = 0; i < 40; i++) forms.push([`random-${String(i + 1).padStart(2, '0')}`, `Seeded random form #${i + 1}`, randomUserValues(r, { density: 0.5 })]);
  const loads = [...LOADS];
  for (let i = 0; i < 20; i++) loads.push([`random-${String(i + 1).padStart(2, '0')}`, `Seeded random upload #${i + 1}`, [...randomSysex(r, { maxParams: 80 })]]);

  fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
  fs.mkdirSync(GENERATED_DIR, { recursive: true });

  const fresh = new SimPage(await oracle.freshPageHtml());
  const freshValues = fresh.values();
  const freshEnabled = fresh.enabled();
  const diff = (obj, base) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => base[k] !== v));

  const submitted = await oracle.submitUserForm(forms.map((f) => f[2]));
  const loaded = await oracle.loadAndSave(loads.map((l) => Buffer.from(l[2])));
  const outputs = [...submitted.map((s) => s.bytes), ...loaded.map((l) => l.bytes)];
  // upload every generated output once more: what does the page show, and what does re-saving give?
  const reloaded = await oracle.loadAndSave(outputs);

  const manifest = {
    about: 'Golden fixtures produced by the ORIGINAL Mutant Brain Surgery ASP code (executed under Windows Script Host by tools/asp-oracle). Regenerate with `npm run fixtures`.',
    freshFormValues: freshValues,
    fixtures: [],
  };
  const record = (base, i, extra) => {
    const re = reloaded[i];
    const out = outputs[i];
    const entry = {
      ...extra,
      shownWhenUploaded: diff(re.page.values(), freshValues),
      enabledWhenUploaded: diff(re.page.enabled(), freshEnabled),
      resaveIdentical: Buffer.compare(re.bytes, out) === 0,
    };
    if (!entry.resaveIdentical) {
      entry.resaveFile = `${base}.resave.syx`;
      fs.writeFileSync(path.join(GENERATED_DIR, entry.resaveFile), re.bytes);
    }
    manifest.fixtures.push(entry);
  };
  forms.forEach(([name, description, values], i) => {
    const file = `form-${name}.syx`;
    fs.writeFileSync(path.join(GENERATED_DIR, file), outputs[i]);
    record(`form-${name}`, i, { kind: 'form', file, description, values });
  });
  loads.forEach(([name, description, bytes], j) => {
    const i = forms.length + j;
    const input = `load-${name}.in.syx`;
    const file = `load-${name}.out.syx`;
    fs.writeFileSync(path.join(GENERATED_DIR, input), Buffer.from(bytes));
    fs.writeFileSync(path.join(GENERATED_DIR, file), outputs[i]);
    record(`load-${name}`, i, {
      kind: 'load', input, file, description,
      shownOnUpload: diff(loaded[j].page.values(), freshValues),
    });
  });
  fs.writeFileSync(path.join(GENERATED_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  const unstable = manifest.fixtures.filter((f) => !f.resaveIdentical).map((f) => f.file);
  console.log(`wrote ${manifest.fixtures.length} fixtures to ${path.relative(process.cwd(), GENERATED_DIR)}`);
  console.log(`files that change when re-saved by the original site: ${unstable.length ? unstable.join(', ') : 'none'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
