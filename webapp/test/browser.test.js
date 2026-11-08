'use strict';
/**
 * End-to-end tests of the static site in a real browser (Playwright driving
 * the locally installed Chrome, or Edge). Real file uploads, real downloads.
 *
 * The page edits a PatchDocument in memory. Each test does something on the
 * page, does the same with the library here in Node, and checks that the
 * page's document equals the library's and that every control shows it.
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
const { MB, referencePatches, GENERATED_DIR, hexGroups, typedValue, rng } = require('./helpers');

const { MutantBrainPatch, Form, Editor, PatchDocument } = MB;

let chromium = null;
try { ({ chromium } = require('playwright-core')); } catch { /* optional dev dependency */ }

let browser = null;
let server = null;
let baseUrl = null;
/** The CV.OCD site (dist/cvocd/): the same app with other branding. */
let cvocdServer = null;
let cvocdUrl = null;
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
  cvocdServer = createServer('cvocd');
  await new Promise((resolve) => cvocdServer.listen(0, '127.0.0.1', resolve));
  cvocdUrl = `http://127.0.0.1:${cvocdServer.address().port}/`;
});

// note: playwright-core < 1.5x leaked a TargetClosedError after downloads in Edge; use >= 1.64
test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (cvocdServer) await new Promise((resolve) => cvocdServer.close(resolve));
});

/** Fresh page; fails the test on any console error, page error or failed request. */
async function openPage(t, viewport, siteUrl = baseUrl) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: viewport || { width: 1280, height: 900 } });
  // hermetic: external resources (Google Fonts) get an empty response, so the
  // tests run offline and fonts fall back to the local stacks
  await context.route((url) => !url.href.startsWith(siteUrl), (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(siteUrl);
  await page.waitForFunction(() => window.MutantBrainApp);
  t.after(async () => {
    await context.close();
    assert.deepEqual(problems, [], 'no browser errors');
  });
  return page;
}

// ---------------------------------------------------------------------------
// What the page shows, and what it holds in memory
// ---------------------------------------------------------------------------

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
/** The page's PatchDocument (as plain data). */
const pageDocument = (page) => page.evaluate(() => window.MutantBrainApp.document());

/** Option value each dropdown should show for a state: the Editor value as a string. */
const shownValues = (state) => Object.fromEntries(Editor.view(state).fields.map((f) => [f.id, String(f.value)]));
const shownEnabled = (state) => Object.fromEntries(Editor.view(state).fields.map((f) => [f.id, f.enabled]));
/** A form value of the original site as the option value of the page's dropdown. */
const optionValue = (name, formValue) => String(typedValue(name, formValue));

/** The page holds `expected` and every control shows it. */
async function assertPageShows(page, expected, label = '') {
  const doc = await pageDocument(page);
  assert.equal(doc.name, expected.name, `${label} name`);
  assert.equal(doc.modified, expected.modified, `${label} modified`);
  assert.deepEqual(doc.patch, JSON.parse(JSON.stringify(expected.patch)), `${label} settings`);
  assert.deepEqual(await domValues(page), shownValues(expected.patch), `${label} dropdown values`);
  assert.deepEqual(await domEnabled(page), shownEnabled(expected.patch), `${label} enabled dropdowns`);
  assert.equal(await page.inputValue('#patch-name'), expected.name, `${label} name field`);
  const intro = await page.evaluate(() => [...document.querySelectorAll('.loader__body > p:not(.status)')].filter((p) => !p.hidden).map((p) => p.textContent));
  const loaded = (await paneState(page)).loaded;
  assert.deepEqual(intro, [loaded
    ? 'Editing patch. Download it to save it, or create a new patch to start over.'
    : 'Open a Mutant Brain SysEx file to edit it, or start a new patch from scratch!'], `${label} intro`);
}

async function upload(page, name, bytes) {
  await page.setInputFiles('#file', { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
}
/** The patch pane's title, and whether it shows a loaded file (teal pane and name box). */
const paneState = (page) => page.evaluate(() => ({
  title: document.getElementById('patch-title').textContent,
  loaded: document.getElementById('patch-pane').classList.contains('loader--loaded'),
}));
/** Wait until the file is open: an unmodified document named after it, and the pane says "Patch Loaded". */
const waitOpened = (page, fileName) => page.waitForFunction((name) => {
  const doc = window.MutantBrainApp.document();
  return doc.name === name && !doc.modified && document.getElementById('patch-pane').classList.contains('loader--loaded');
}, PatchDocument.nameFromFileName(fileName));

/** Press "Generate SysEx"; returns the downloaded file's name and bytes. */
async function download(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button.go')]);
  const file = path.join(os.tmpdir(), `mb-dl-${process.pid}-${Math.random().toString(36).slice(2)}.syx`);
  await dl.saveAs(file);
  const bytes = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return { fileName: dl.suggestedFilename(), bytes };
}

/** Pick options the way a user does (each fires 'change'), in order. */
const pickOnPage = (page, picks) => page.evaluate((list) => {
  for (const [name, value] of list) {
    const s = document.getElementById(name);
    s.value = value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, picks);

/** The same picks with the library. */
function pickInNode(doc, picks) {
  for (const [name, value] of picks) {
    const ref = Editor.refOf(name);
    const option = Editor.view(doc.patch).get(ref).options.find((o) => String(o.value) === value);
    doc = PatchDocument.setValue(doc, ref, option.value);
  }
  return doc;
}

const skip = () => skipReason;

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

test('renders every field with exactly the library schema', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  assert.equal(await page.textContent('h2'), 'SysEx Patch Builder for the Mutant Brain Eurorack Module');
  const selects = await page.evaluate(() => [...document.querySelectorAll('#sysex select')].map((s) => ({
    name: s.name, options: [...s.options].map((o) => [o.value, o.textContent, o.disabled]),
  })));
  assert.deepEqual(selects.map((s) => s.name), Form.FIELDS.map((f) => f.name));
  const view = Editor.view(Editor.create());
  for (const s of selects) {
    // option i is the Editor's option i, labelled as on the original site
    const editorOptions = view.get(Editor.refOf(s.name)).options;
    assert.deepEqual(s.options.map((o) => o[0]), editorOptions.map((o) => String(o.value)), `${s.name} values`);
    assert.deepEqual(s.options.map((o) => [o[1], o[2]]), Form.field(s.name).options.map((o) => [o.label, !!o.disabled]), `${s.name} labels`);
  }
  // setting names with descriptions: column headings, or row names in the single-item (globals) pane
  const headers = await page.evaluate(() => [...document.querySelectorAll('table.grid td[title]')].map((td) => td.textContent));
  assert.equal(headers.length, Form.SECTIONS.reduce((n, s) => n + s.columns.length, 0));
  assert.equal(await page.evaluate(() => document.querySelector('img.logo').naturalWidth > 0), true, 'logo loads');
  const links = await page.evaluate(() => [...document.querySelectorAll('.note a')].map((a) => a.href));
  assert.deepEqual(links, [Form.FIRMWARE_URL], 'one firmware note');
  // the hover tip and the firmware note: untitled panes side by side after the settings,
  // equal height, the pair centred in the page column; the settings panes have no notes
  const layout = await page.evaluate(() => {
    const row = document.querySelector('#sections > .notes');
    const box = (e) => e.getBoundingClientRect();
    const column = box(document.querySelector('#sections'));
    const panes = [...row.children].map((s) => ({ label: s.getAttribute('aria-label'), titled: !!s.querySelector('.info-panel__header'), box: box(s) }));
    return {
      last: row === document.querySelector('#sections').lastElementChild,
      panes: panes.map((p) => [p.label, p.titled]),
      sameTop: Math.abs(panes[0].box.top - panes[1].box.top) < 1,
      sameHeight: Math.abs(panes[0].box.height - panes[1].box.height) < 1,
      centred: Math.abs((panes[0].box.left - column.left) - (column.right - panes[1].box.right)) < 1.5,
      notesInSettings: document.querySelectorAll('#sections > section .note, #sections > section .hint, .pane-row:not(.notes) .hint').length,
    };
  });
  assert.deepEqual(layout, { last: true, panes: [['Tip', false], ['Firmware note', false]], sameTop: true, sameHeight: true, centred: true, notesInSettings: 0 });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('button.go')).position), 'static');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.actions')).position), 'sticky', 'download bar stays in reach');
  // the patch panel
  // buttons: an icon beside the text
  for (const [sel, text, icon] of [['#open', 'Open', 'i-open'], ['#new', 'New', 'i-new'], ['#reset', 'Clear', 'i-clear'], ['button.go', 'Download SysEx', 'i-save'], ['#rename', '', 'i-pencil']]) {
    const b = await page.evaluate((s) => {
      const node = document.querySelector(s);
      const svg = node.querySelector('svg.icon');
      const box = svg.getBoundingClientRect();
      return { text: node.textContent.trim(), icon: svg.querySelector('use').getAttribute('href'), w: box.width, h: box.height };
    }, sel);
    assert.equal(b.text, text, sel);
    assert.equal(b.icon, `#${icon}`, `${sel} icon`);
    assert.ok(b.w >= 16 && b.w <= 32 && b.w === b.h, `${sel} icon is square and 16-32px (${b.w}x${b.h})`);
  }
  assert.equal(await page.getAttribute('#rename', 'aria-label'), 'Edit patch name');
  assert.equal(await page.getAttribute('label[for="file"]', 'id'), 'open');
  assert.equal(await page.textContent('label[for="patch-name"]'), 'Patch name');
  assert.equal(await page.locator('#load').count(), 0, 'no separate Load button');
  assert.equal(await page.locator('#load-status').count(), 0, 'no status line');
  assert.deepEqual(await paneState(page), { title: 'Load Patch', loaded: false });
  const border = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).borderTopColor, sel);
  const before = [await border('#patch-pane'), await border('.field__input')];
  await upload(page, referencePatches()[0].name, referencePatches()[0].bytes);
  await waitOpened(page, referencePatches()[0].name);
  assert.deepEqual(await paneState(page), { title: 'Patch Loaded', loaded: true });
  const after = [await border('#patch-pane'), await border('.field__input')];
  assert.equal(after[0], 'rgb(70, 173, 185)', 'teal pane border');
  assert.equal(after[1], after[0], 'name box border matches the pane');
  assert.notDeepEqual(after, before);
});

test('fresh page: a new, unmodified patch; downloads what the original site did', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  const doc = PatchDocument.create();
  await assertPageShows(page, doc, 'fresh');
  assert.deepEqual(await domValues(page), Object.fromEntries(Object.entries(Form.defaultFormValues()).map(([n, v]) => [n, optionValue(n, v)])),
    'same choices as a fresh page of the original site');
  assert.equal(await page.title(), 'New Patch - Mutant Brain Surgery');
  const { fileName, bytes } = await download(page);
  assert.equal(fileName, 'New Patch.syx');
  assert.equal(hexGroups(bytes), hexGroups(MutantBrainPatch.fromFormValues({}).toSysex()));
});

test('opening each reference patch, then saving it, gives the original site\'s output', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  for (const { name, bytes } of referencePatches()) {
    await upload(page, name, bytes);
    await waitOpened(page, name);
    const doc = PatchDocument.open(name, bytes);
    await assertPageShows(page, doc, name);
    const out = await download(page);
    assert.equal(out.fileName, PatchDocument.fileName(doc), `${name} file name`);
    assert.equal(hexGroups(out.bytes), hexGroups(MutantBrainPatch.fromSysex(bytes).normalize().toSysex()), `${name} download`);
    if (name !== 'AlesisNitro.syx') assert.equal(hexGroups(out.bytes), hexGroups(bytes), `${name} unchanged`);
    assert.equal((await pageDocument(page)).modified, false, `${name} saved`);
  }
});

test('generated fixtures through the real DOM (form fixtures + upload fixtures)', async (t) => {
  if (skip()) return t.skip(skip());
  const manifest = JSON.parse(fs.readFileSync(path.join(GENERATED_DIR, 'manifest.json'), 'utf8'));
  const page = await openPage(t);
  for (const f of manifest.fixtures) {
    const golden = fs.readFileSync(path.join(GENERATED_DIR, f.file));
    let expected;
    if (f.kind === 'form') {
      // new patch, then the user's selections in page order
      await page.click('#new');
      const picks = Object.entries(f.values).map(([name, value]) => [name, optionValue(name, value)]);
      await pickOnPage(page, picks);
      expected = pickInNode(PatchDocument.create(), picks);
    } else {
      await upload(page, f.input, fs.readFileSync(path.join(GENERATED_DIR, f.input)));
      await waitOpened(page, f.input);
      expected = PatchDocument.open(f.input, fs.readFileSync(path.join(GENERATED_DIR, f.input)));
    }
    await assertPageShows(page, expected, f.file);
    assert.equal(hexGroups(PatchDocument.toSysex(await pageDocument(page))), hexGroups(golden), f.file);
  }
});

test('every dropdown edits its own setting of the document', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  const r = rng(0xF1E1D);
  for (let round = 0; round < 4; round++) {
    // every field once, in random order, each set to an option a user can pick
    const names = Form.FIELDS.map((f) => f.name).sort(() => r() - 0.5);
    let expected = PatchDocument.create();
    await page.click('#new');
    for (const name of names) {
      const options = Editor.view(expected.patch).get(Editor.refOf(name)).options.filter((o) => !o.disabled);
      const pick = [name, String(r.pick(options).value)];
      expected = pickInNode(expected, [pick]);
      await pickOnPage(page, [pick]);
    }
    await assertPageShows(page, expected, `round ${round}`);
  }
  // one setting at a time: only that setting of the document changes
  const fresh = PatchDocument.create();
  for (const name of ['global.chan', 'in3.max_note', 'cv4.trans', 'gt12.dur', 'gt7.thrs']) {
    await page.click('#new');
    const current = Editor.get(fresh.patch, Editor.refOf(name));
    const options = Editor.view(fresh.patch).get(Editor.refOf(name)).options.filter((o) => !o.disabled && o.value !== current);
    const value = String(options[options.length - 1].value);
    await pickOnPage(page, [[name, value]]);
    const doc = await pageDocument(page);
    assert.equal(String(Editor.get(doc.patch, Editor.refOf(name))), value, name);
    const changed = Editor.view(doc.patch).fields.filter((f) => String(f.value) !== shownValues(fresh.patch)[f.id]).map((f) => f.id);
    assert.deepEqual(changed, [name], `${name} changes nothing else`);
    assert.equal(doc.modified, true);
  }
});

test('a user really clicking through the dropdowns', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  assert.equal(await page.isDisabled('select[name="in1.chan"]'), true);
  await page.selectOption('select[name="in1.src"]', '1');
  assert.equal(await page.isDisabled('select[name="in1.chan"]'), false, 'enabling the input enables its fields');
  assert.equal(await page.title(), '• New Patch - Mutant Brain Surgery', 'title marks unsaved changes');
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
  const values = {
    'in1.src': '1', 'in1.chan': '3', 'in1.prty': '9', 'cv1.src': '11', 'cv1.trans': '52',
    'cv2.src': '11', 'cv2.event': '20', 'gt1.src': '20', 'gt1.div': '24', 'gt1.dur': 'retrig',
  };
  await assertPageShows(page, pickInNode(PatchDocument.create(), Object.entries(values).map(([n, v]) => [n, optionValue(n, v)])));
  const out = await download(page);
  assert.equal(hexGroups(out.bytes), hexGroups(MutantBrainPatch.fromFormValues(values).toSysex()));
  assert.equal((await pageDocument(page)).modified, false, 'saved');
  assert.equal(await page.title(), 'New Patch - Mutant Brain Surgery');
});

test('selected-but-disabled CC option is shown but saved as 0, like the original site', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  await upload(page, 'cc6.syx', [0xF0, 0x00, 0x7F, 0x15, 21, 1, 2, 6, 0xF7]);
  await waitOpened(page, 'cc6.syx');
  assert.equal(await page.inputValue('select[name="cv1.cc"]'), '6');
  assert.equal(await page.isDisabled('select[name="cv1.cc"]'), false);
  const out = MutantBrainPatch.parseParams((await download(page)).bytes);
  assert.deepEqual(out.find((p) => p[0] === 21 && p[1] === 1), [21, 1, 2, 0]);
});

// ---------------------------------------------------------------------------
// The patch panel
// ---------------------------------------------------------------------------

test('bad files show the error and leave the document alone; a good file clears it', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  const ref = referencePatches()[1];
  await upload(page, ref.name, ref.bytes);
  await waitOpened(page, ref.name);
  await page.selectOption('select[name="global.chan"]', '4'); // an unsaved edit
  const before = await pageDocument(page);
  for (const [name, bytes] of [['yamaha.syx', [0xF0, 0x43, 0x10, 0x4C, 0xF7]], ['cut.syx', [0xF0, 0x00, 0x7F, 0x15, 1, 2]], ['empty.syx', []]]) {
    await upload(page, name, bytes);
    await page.waitForSelector('#load-error:not([hidden])');
    assert.match(await page.textContent('#load-error'), /ERROR IN SYSEX FILE - NOT LOADED!!/);
    assert.deepEqual(await pageDocument(page), before, `${name} leaves the document unchanged`);
    assert.deepEqual(await domValues(page), shownValues(before.patch), `${name} leaves the form unchanged`);
  }
  await upload(page, ref.name, ref.bytes);
  await waitOpened(page, ref.name);
  assert.equal(await page.isHidden('#load-error'), true);
});

test('Open Patch: the button opens the file picker; choosing a file opens it, again too', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  const ref = referencePatches()[0];
  const expected = PatchDocument.open(ref.name, ref.bytes);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open')]);
  await chooser.setFiles({ name: ref.name, mimeType: 'application/octet-stream', buffer: ref.bytes });
  await waitOpened(page, ref.name);
  await assertPageShows(page, expected, 'opened');
  await page.selectOption('select[name="global.chan"]', '3'); // user edits...
  assert.equal((await pageDocument(page)).modified, true);
  await upload(page, ref.name, ref.bytes); // ...then picks the very same file again
  await waitOpened(page, ref.name);
  await assertPageShows(page, expected, 're-opened');
  // keyboard: the button is focusable, and Enter or Space clicks the file input
  // (checked on the input itself: Playwright's file-chooser event can miss a
  // keyboard-opened picker when the machine is busy)
  await page.evaluate(() => {
    window.fileInputClicks = 0;
    document.getElementById('file').addEventListener('click', (e) => { window.fileInputClicks++; e.preventDefault(); });
  });
  await page.focus('#open');
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  assert.equal(await page.evaluate(() => window.fileInputClicks), 2, 'Enter and Space open the picker');
});

test('New Patch: fresh settings and a new name, ready to type', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  const ref = referencePatches()[0];
  await upload(page, ref.name, ref.bytes);
  await waitOpened(page, ref.name);
  await page.selectOption('select[name="global.chan"]', '3');
  await page.click('#new');
  await assertPageShows(page, PatchDocument.create(), 'new');
  assert.deepEqual(await paneState(page), { title: 'Load Patch', loaded: false }, 'a new patch is not a loaded file');
  // the name is selected, so typing replaces it
  assert.equal(await page.evaluate(() => document.activeElement.id), 'patch-name');
  await page.keyboard.type('Kick & Snare');
  await assertPageShows(page, PatchDocument.rename(PatchDocument.create(), 'Kick & Snare'), 'typed name');
  const out = await download(page);
  assert.equal(out.fileName, 'Kick & Snare.syx');
  assert.equal(hexGroups(out.bytes), hexGroups(PatchDocument.toSysex(PatchDocument.create())));
});

test('Clear All: fresh settings, same name', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  const ref = referencePatches()[1];
  await upload(page, ref.name, ref.bytes);
  await waitOpened(page, ref.name);
  await page.click('#reset');
  const expected = PatchDocument.clear(PatchDocument.open(ref.name, ref.bytes));
  await assertPageShows(page, expected, 'cleared');
  assert.equal(expected.name, ref.name.replace(/\.syx$/i, ''));
  assert.deepEqual(await paneState(page), { title: 'Patch Loaded', loaded: true }, 'still the loaded file');
  const out = await download(page);
  assert.equal(out.fileName, ref.name);
  assert.equal(hexGroups(out.bytes), hexGroups(MutantBrainPatch.fromFormValues({}).toSysex()));
});

test('the name field renames the patch; the download is named after it', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  let expected = PatchDocument.create();
  for (const [name, fileName] of [['Lead', 'Lead.syx'], ['my/kit: v2', 'my-kit- v2.syx'], ['', 'New Patch.syx'], ['bass.syx', 'bass.syx']]) {
    await page.fill('#patch-name', name);
    expected = PatchDocument.rename(expected, name);
    await assertPageShows(page, expected, JSON.stringify(name));
    assert.equal((await download(page)).fileName, fileName, JSON.stringify(name));
  }
  // renaming does not discard edits, and is not an edit of the settings
  await page.selectOption('select[name="global.chan"]', '5');
  await page.fill('#patch-name', 'Edited');
  const doc = await pageDocument(page);
  assert.equal(doc.modified, true);
  assert.equal(Editor.get(doc.patch, { section: 'globals', control: 'channel' }), 5);
});

test('the name reads as text until edited: click or pencil to edit, Enter to finish, Escape to undo', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t);
  const editing = () => page.evaluate(() => document.activeElement.id === 'patch-name');
  const boxFill = () => page.evaluate(() => getComputedStyle(document.querySelector('.field__input')).backgroundColor);
  await page.mouse.move(0, 0);
  assert.equal(await editing(), false);
  assert.equal(await boxFill(), 'rgba(0, 0, 0, 0)', 'no fill while showing the name');
  // pencil: edit with the whole name selected, so typing replaces it
  await page.click('#rename');
  assert.equal(await editing(), true);
  assert.notEqual(await boxFill(), 'rgba(0, 0, 0, 0)', 'editor fill while editing');
  assert.deepEqual(await page.evaluate(() => { const i = document.getElementById('patch-name'); return [i.selectionStart, i.selectionEnd]; }), [0, 'New Patch'.length]);
  await page.keyboard.type('Bassline');
  await page.keyboard.press('Enter');
  assert.equal(await editing(), false, 'Enter finishes editing');
  assert.equal((await pageDocument(page)).name, 'Bassline');
  // Enter does not submit the form (no download)
  let downloads = 0;
  page.on('download', () => downloads++);
  // clicking the name edits it too; Escape puts the name back
  await page.click('#patch-name');
  assert.equal(await editing(), true);
  await page.keyboard.press('End');
  await page.keyboard.type(' 2');
  assert.equal((await pageDocument(page)).name, 'Bassline 2', 'renames as you type');
  await page.keyboard.press('Escape');
  assert.equal(await editing(), false);
  assert.equal((await pageDocument(page)).name, 'Bassline', 'Escape undoes this edit');
  assert.equal(await page.inputValue('#patch-name'), 'Bassline');
  // clicking elsewhere finishes too
  await page.click('#rename');
  await page.keyboard.type('Lead');
  await page.click('h1');
  assert.equal(await editing(), false);
  assert.equal((await pageDocument(page)).name, 'Lead');
  assert.equal(downloads, 0);
});

// ---------------------------------------------------------------------------
// The CV.OCD site: the same app, branded for Sixty Four Pixels
// ---------------------------------------------------------------------------

test('CV.OCD site: its own branding, and the same patch editing', async (t) => {
  if (skip()) return t.skip(skip());
  const page = await openPage(t, undefined, cvocdUrl);
  assert.equal(await page.title(), 'New Patch - CV.OCD Patch Builder');
  assert.equal(await page.textContent('h1'), 'cv.ocd');
  for (const img of ['img.logo', 'img.topbar__logo']) {
    assert.equal(await page.evaluate((s) => document.querySelector(s).naturalWidth > 0, img), true, `${img} loads`);
  }
  assert.equal(await page.getAttribute('img.topbar__logo', 'alt'), 'Sixty Four Pixels');
  assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /hexinverter|mutant brain/i);
  // the firmware note links to the CV.OCD firmware
  const links = await page.evaluate(() => [...document.querySelectorAll('.note a')].map((a) => a.href));
  assert.deepEqual(links, ['https://github.com/hotchk155/cvocd.a']);
  // every field is there, and opening / editing / downloading works as on the other site
  assert.equal(await page.locator('#sysex select').count(), Form.FIELDS.length);
  const ref = referencePatches()[0];
  await upload(page, ref.name, ref.bytes);
  await waitOpened(page, ref.name);
  await assertPageShows(page, PatchDocument.open(ref.name, ref.bytes), 'opened');
  await page.selectOption('select[name="global.chan"]', '7');
  const expected = PatchDocument.set(PatchDocument.open(ref.name, ref.bytes), { section: 'globals', control: 'channel' }, 7);
  await assertPageShows(page, expected, 'edited');
  const out = await download(page);
  assert.equal(out.fileName, ref.name);
  assert.equal(hexGroups(out.bytes), hexGroups(PatchDocument.toSysex(expected)));
});

test('both brands: keyboard focus on a dropdown shows the focus ring', async (t) => {
  if (skip()) return t.skip(skip());
  // the theme's `select:focus` (border colour) must not cancel the shared focus-visible outline
  for (const [brand, url] of [['mutantbrain', baseUrl], ['cvocd', cvocdUrl]]) {
    const page = await openPage(t, undefined, url);
    const outline = () => page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { name: document.activeElement.name, style: s.outlineStyle, width: s.outlineWidth };
    });
    await page.click('select[name="global.chan"]');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab'); // to the next dropdown, by keyboard
    const ring = await outline();
    assert.equal(ring.name, 'global.dur', `${brand}: Tab moved to the next setting`);
    assert.deepEqual([ring.style, ring.width], ['solid', '2px'], `${brand}: keyboard focus ring`);
  }
});

test('both brands: on a touch phone the hover tip pane is hidden; with a mouse it shows', async (t) => {
  if (skip()) return t.skip(skip());
  const { devices } = require('playwright-core');
  for (const [brand, url] of [['mutantbrain', baseUrl], ['cvocd', cvocdUrl]]) {
    for (const [name, options, shown] of [['Pixel 5', devices['Pixel 5'], false], ['iPhone 13', devices['iPhone 13'], false], ['desktop', { viewport: { width: 1280, height: 800 } }, true]]) {
      const context = await browser.newContext(options);
      t.after(() => context.close());
      await context.route((u) => !u.href.startsWith(url), (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('.notes'));
      const r = await page.evaluate(() => ({
        touch: matchMedia('(hover: none)').matches,
        tip: document.querySelector('.info-panel.tip').getBoundingClientRect().height > 0,
        firmware: document.querySelector('.info-panel.firmware').getBoundingClientRect().height > 0,
      }));
      assert.equal(r.touch, !shown, `${brand} ${name}: emulated as ${shown ? 'mouse' : 'touch'}`);
      assert.equal(r.tip, shown, `${brand} ${name}: tip pane ${shown ? 'shown' : 'hidden'}`);
      assert.equal(r.firmware, true, `${brand} ${name}: firmware note always shown`);
    }
  }
});

test('both brands: the download bar stays on the bottom edge, also at the end of the page', async (t) => {
  if (skip()) return t.skip(skip());
  for (const [brand, url] of [['mutantbrain', baseUrl], ['cvocd', cvocdUrl]]) {
    for (const width of [1280, 375]) {
      const page = await openPage(t, { width, height: 800 }, url);
      const gapBelowBar = (where) => page.evaluate((w) => {
        window.scrollTo(0, w === 'end' ? document.documentElement.scrollHeight : document.documentElement.scrollHeight / 2);
        return window.innerHeight - document.querySelector('.actions').getBoundingClientRect().bottom;
      }, where);
      assert.ok(Math.abs(await gapBelowBar('middle')) < 0.5, `${brand} ${width}px: on the bottom edge mid-page`);
      // at the end it rests at its place in the page: nothing below it (≤1px of sub-pixel rounding)
      const end = await gapBelowBar('end');
      assert.ok(end >= -0.5 && end <= 1, `${brand} ${width}px: ${end}px below the bar at the end of the page`);
    }
  }
});

test('both brands, phone widths down to 280px: the page never scrolls sideways (tables scroll in place)', async (t) => {
  if (skip()) return t.skip(skip());
  // 280 = Galaxy Fold, 320 = iPhone SE (1st gen), 360 = small Android, 375/390/414 = common iPhones
  for (const [brand, url] of [['mutantbrain', baseUrl], ['cvocd', cvocdUrl]]) {
    const page = await openPage(t, { width: 414, height: 800 }, url);
    for (const width of [280, 300, 320, 340, 360, 375, 390, 414]) {
      await page.setViewportSize({ width, height: 800 });
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sticking = [...document.querySelectorAll('body *')]
          .filter((e) => !e.closest('.scroll') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > vw + 0.5)
          .map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}`);
        return { scrollWidth: document.documentElement.scrollWidth, vw, sticking: sticking.slice(0, 5) };
      });
      assert.ok(r.scrollWidth <= r.vw, `${brand} at ${width}px: page is ${r.scrollWidth}px wide (${r.sticking.join(', ')})`);
      // New and Clear: equal widths, each inside the pane
      const [a, b] = await page.evaluate(() => ['#new', '#reset'].map((s) => document.querySelector(s).getBoundingClientRect().width));
      assert.ok(Math.abs(a - b) < 1, `${brand} at ${width}px: New and Clear are the same width (${a} vs ${b})`);
    }
  }
});
