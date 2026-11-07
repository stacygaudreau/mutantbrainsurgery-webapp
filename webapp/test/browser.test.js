'use strict';
/**
 * End-to-end tests of the static site in a real browser (Playwright driving
 * the locally installed Chrome, or Edge). Real file uploads, real downloads.
 *
 * Skipped when playwright-core is not installed or no Chrome/Edge is found.
 * Override the browser with MB_BROWSER_CHANNEL=chrome|msedge|chromium.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../tools/serve');
const { MB, referencePatches, GENERATED_DIR, hexGroups } = require('./helpers');

const { MutantBrainPatch, Form } = MB;

let chromium = null;
try { ({ chromium } = require('playwright-core')); } catch { /* optional dev dependency */ }

let browser = null;
let server = null;
let baseUrl = null;
let skipReason = chromium ? null : 'playwright-core not installed (npm install)';

test.before(async () => {
  if (!chromium) return;
  const channels = process.env.MB_BROWSER_CHANNEL ? [process.env.MB_BROWSER_CHANNEL] : ['chrome', 'msedge', 'chromium'];
  for (const channel of channels) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* try next */ }
  }
  if (!browser) { skipReason = 'no Chrome/Edge found for Playwright'; return; }
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

// note: playwright-core < 1.5x leaked a TargetClosedError after downloads in Edge; use >= 1.64
test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

/** Fresh page; fails the test on any console error, page error or failed request. */
async function openPage(t, viewport) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: viewport || { width: 1280, height: 900 } });
  // hermetic: external resources (Google Fonts) get an empty response, so the
  // tests run offline and fonts fall back to the local stacks
  await context.route((url) => !url.href.startsWith(baseUrl), (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(baseUrl);
  await page.waitForFunction(() => window.MutantBrainApp);
  t.after(async () => {
    await context.close();
    assert.deepEqual(problems, [], 'no browser errors');
  });
  return page;
}

const domValues = (page) => page.evaluate(() => {
  const v = {};
  document.querySelectorAll('#sysex select').forEach((s) => { v[s.name] = s.value; });
  return v;
});
const domEnabled = (page) => page.evaluate(() => {
  const v = {};
  document.querySelectorAll('#sysex select').forEach((s) => { v[s.name] = !s.disabled; });
  return v;
});
/** What the BROWSER itself would submit for the form (native FormData rules). */
const nativeFormData = (page) => page.evaluate(() => Object.fromEntries(new FormData(document.getElementById('sysex'))));

async function upload(page, name, bytes) {
  await page.setInputFiles('#file', { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
}
async function waitLoaded(page, name) {
  await page.waitForFunction((n) => document.getElementById('load-status').textContent === `Loaded ${n}`, name);
}
async function downloadSysex(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button.go')]);
  assert.equal(dl.suggestedFilename(), 'mutantbrain.syx');
  const file = path.join(os.tmpdir(), `mb-dl-${process.pid}-${Math.random().toString(36).slice(2)}.syx`);
  await dl.saveAs(file);
  const bytes = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return bytes;
}

const skip = () => skipReason;

test('renders every field with exactly the library schema', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  assert.equal(await page.title(), 'Mutant Brain Surgery');
  assert.equal(await page.textContent('h2'), 'SysEx Patch Builder for the Mutant Brain Eurorack Module');
  const selects = await page.evaluate(() => [...document.querySelectorAll('#sysex select')].map((s) => ({
    name: s.name, options: [...s.options].map((o) => [o.value, o.textContent, o.disabled]),
  })));
  assert.deepEqual(selects.map((s) => s.name), Form.FIELDS.map((f) => f.name));
  for (const s of selects) {
    assert.deepEqual(s.options, Form.field(s.name).options.map((o) => [o.value, o.label, !!o.disabled]), s.name);
  }
  // setting names with descriptions: column headings, or row names in the single-item (globals) pane
  const headers = await page.evaluate(() => [...document.querySelectorAll('table.grid td[title]')].map((td) => td.textContent));
  assert.equal(headers.length, Form.SECTIONS.reduce((n, s) => n + s.columns.length, 0));
  assert.equal(await page.evaluate(() => document.querySelector('img.logo').naturalWidth > 0), true, 'logo loads');
  const links = await page.evaluate(() => [...document.querySelectorAll('.note a')].map((a) => a.href));
  assert.deepEqual(links, [Form.FIRMWARE_URL, Form.FIRMWARE_URL], 'firmware note under CV and gate sections');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('button.go')).position), 'static');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.actions')).position), 'sticky', 'download bar stays in reach');
});

test('fresh page: values, enabled state and downloaded file match the original site', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  assert.deepEqual(await domValues(page), Form.defaultFormValues());
  assert.deepEqual(await domEnabled(page), Form.enabledFields({}));
  assert.deepEqual(await nativeFormData(page), Form.submittedValues({}));
  const bytes = await downloadSysex(page);
  assert.equal(hexGroups(bytes), hexGroups(MutantBrainPatch.fromFormValues({}).toSysex()));
});

test('uploading each reference patch, then downloading, gives the original site\'s output', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  for (const { name, bytes } of referencePatches()) {
    await upload(page, name, bytes);
    await waitLoaded(page, name);
    const patch = MutantBrainPatch.fromSysex(bytes);
    assert.deepEqual(await domValues(page), patch.toFormValues(), `${name} values`);
    assert.deepEqual(await domEnabled(page), Form.enabledFields(patch.toFormValues()), `${name} enabled`);
    assert.deepEqual(await nativeFormData(page), Form.submittedValues(patch.toFormValues()), `${name} native FormData`);
    const out = await downloadSysex(page);
    assert.equal(hexGroups(out), hexGroups(patch.normalize().toSysex()), `${name} download`);
    if (name !== 'AlesisNitro.syx') assert.equal(hexGroups(out), hexGroups(bytes), `${name} unchanged`);
  }
});

test('generated fixtures through the real DOM (form fixtures + upload fixtures)', async (t) => {
  if (skip()) return t.skip(skip());
  const manifest = JSON.parse(fs.readFileSync(path.join(GENERATED_DIR, 'manifest.json'), 'utf8'));
  const page = await openPage(t);
  for (const f of manifest.fixtures) {
    const golden = fs.readFileSync(path.join(GENERATED_DIR, f.file));
    if (f.kind === 'form') {
      // start from scratch, then make the user's selections (each fires 'change')
      await page.click('#reset');
      await page.evaluate((values) => {
        for (const [name, value] of Object.entries(values)) {
          const s = document.getElementById(name);
          s.value = value;
          s.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, f.values);
      assert.deepEqual(await nativeFormData(page), Form.submittedValues(f.values), `${f.file} native FormData`);
    } else {
      await upload(page, f.input, fs.readFileSync(path.join(GENERATED_DIR, f.input)));
      await waitLoaded(page, f.input);
    }
    const built = await page.evaluate(() => Array.from(window.MutantBrainApp.buildSysex()));
    assert.equal(hexGroups(built), hexGroups(golden), f.file);
  }
});

test('a user really clicking through the dropdowns', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  assert.equal(await page.isDisabled('select[name="in1.chan"]'), true);
  await page.selectOption('select[name="in1.src"]', '1');
  assert.equal(await page.isDisabled('select[name="in1.chan"]'), false, 'enabling the input enables its fields');
  await page.selectOption('select[name="in1.chan"]', '3');
  await page.selectOption('select[name="in1.prty"]', { label: '2 note chord' });
  await page.selectOption('select[name="cv1.src"]', { label: 'Note input #1' });
  await page.selectOption('select[name="cv1.trans"]', { label: '-1oct' });
  await page.selectOption('select[name="cv2.src"]', { label: 'Note input #1' });
  await page.selectOption('select[name="cv2.event"]', { label: 'Most recent note velocity' });
  assert.equal(await page.isDisabled('select[name="cv2.trans"]'), true, 'velocity CV has no transpose');
  await page.selectOption('select[name="gt1.src"]', { label: 'Clock Tick' });
  await page.selectOption('select[name="gt1.div"]', { label: '1/4' });
  await page.selectOption('select[name="gt1.dur"]', { label: '(retrig)' });
  const expected = MutantBrainPatch.fromFormValues({
    'in1.src': '1', 'in1.chan': '3', 'in1.prty': '9', 'cv1.src': '11', 'cv1.trans': '52',
    'cv2.src': '11', 'cv2.event': '20', 'gt1.src': '20', 'gt1.div': '24', 'gt1.dur': 'retrig',
  }).toSysex();
  assert.equal(hexGroups(await downloadSysex(page)), hexGroups(expected));
});

test('selected-but-disabled CC option is not submitted by the real browser either', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  await upload(page, 'cc6.syx', [0xF0, 0x00, 0x7F, 0x15, 21, 1, 2, 6, 0xF7]);
  await waitLoaded(page, 'cc6.syx');
  assert.equal(await page.inputValue('select[name="cv1.cc"]'), '6');
  assert.equal(await page.isDisabled('select[name="cv1.cc"]'), false);
  const fd = await nativeFormData(page);
  assert.equal(fd['cv1.src'], '2');
  assert.ok(!('cv1.cc' in fd), 'browser omits a select whose selected option is disabled');
  const out = MutantBrainPatch.parseParams(await downloadSysex(page));
  assert.deepEqual(out.find((p) => p[0] === 21 && p[1] === 1), [21, 1, 2, 0]);
});

test('bad files show the error and leave the form alone; a good file clears it', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  const ref = referencePatches()[1];
  await upload(page, ref.name, ref.bytes);
  await waitLoaded(page, ref.name);
  const before = await domValues(page);
  for (const [name, bytes] of [['yamaha.syx', [0xF0, 0x43, 0x10, 0x4C, 0xF7]], ['cut.syx', [0xF0, 0x00, 0x7F, 0x15, 1, 2]], ['empty.syx', []]]) {
    await upload(page, name, bytes);
    await page.waitForSelector('#load-error:not([hidden])');
    assert.match(await page.textContent('#load-error'), /ERROR IN SYSEX FILE - NOT LOADED!!/);
    assert.deepEqual(await domValues(page), before, `${name} leaves form unchanged`);
  }
  await upload(page, ref.name, ref.bytes);
  await waitLoaded(page, ref.name);
  assert.equal(await page.isHidden('#load-error'), true);
  await page.click('#reset');
  assert.deepEqual(await domValues(page), Form.defaultFormValues(), 'Clear All resets the form');
});

test('choosing a file loads it immediately; choosing the same file again reloads it', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  assert.equal(await page.locator('#load').count(), 0, 'no separate Load button');
  const ref = referencePatches()[0];
  const expected = MutantBrainPatch.fromSysex(ref.bytes).toFormValues();
  // the visible "Choose a .syx file..." button is a <label> for the hidden input
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('label[for="file"]')]);
  await chooser.setFiles({ name: ref.name, mimeType: 'application/octet-stream', buffer: ref.bytes });
  await waitLoaded(page, ref.name);
  assert.deepEqual(await domValues(page), expected);
  await page.selectOption('select[name="global.chan"]', '3'); // user edits...
  await page.evaluate(() => { document.getElementById('load-status').textContent = ''; });
  await upload(page, ref.name, ref.bytes); // ...then picks the very same file again
  await waitLoaded(page, ref.name);
  assert.deepEqual(await domValues(page), expected, 'same file re-loaded');
});

test('phone width: page itself does not scroll sideways (tables scroll in place)', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t, { width: 375, height: 800 });
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  assert.ok(scrollWidth <= innerWidth, `page width ${scrollWidth} > viewport ${innerWidth}`);
});
