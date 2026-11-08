'use strict';
/**
 * Tests for the brands: the same app as several websites (tools/brands.mjs).
 * Every brand folder must be complete, its page must have everything the app
 * script needs, and its theme must define every variable the shared base.css
 * uses. (Each built site's look is checked in the browser tests.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const brands = () => import('../tools/brands.mjs');

/** Element ids src/app/main.ts looks up (it throws at start-up if one is missing). */
function idsTheAppNeeds() {
  const main = read('src', 'app', 'main.ts');
  const ids = new Set([...main.matchAll(/(?:byId(?:<\w+>)?|getElementById)\('([\w-]+)'\)/g)].map((m) => m[1]));
  // `slot-${section.key}` is optional (sections without a slot go to #sections); check the one the layout uses
  ids.add('slot-globals');
  return [...ids].sort();
}

/** CSS custom properties a stylesheet uses without a fallback, and those it defines. */
const usedVars = (css) => new Set([...css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1]));
const definedVars = (css) => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

test('there are the two brands, and the default is Mutant Brain Surgery', async () => {
  const { listBrands, DEFAULT_BRAND } = await brands();
  assert.deepEqual(listBrands(), ['cvocd', 'mutantbrain']);
  assert.equal(DEFAULT_BRAND, 'mutantbrain');
});

test('every brand folder is complete, with a valid brand.json', async () => {
  const { listBrands, brandConfig } = await brands();
  for (const brand of listBrands()) {
    for (const f of ['brand.json', 'head.html', 'header.html', 'hero.html', 'theme.css']) {
      assert.ok(fs.existsSync(path.join(root, 'brands', brand, f)), `brands/${brand}/${f}`);
    }
    const config = brandConfig(brand);
    assert.deepEqual(Object.keys(config).sort(), ['description', 'firmwareUrl', 'product', 'themeColor', 'title']);
    assert.match(config.firmwareUrl, /^https:\/\//);
    assert.match(config.themeColor, /^#[0-9a-f]{6}$/i);
  }
});

test('each brand page: slots filled in, every element the app needs, brand values in place', async () => {
  const { listBrands, renderPage, brandConfig } = await brands();
  const ids = idsTheAppNeeds();
  assert.ok(ids.length >= 15, `found the app's ids (${ids.join(', ')})`);
  for (const brand of listBrands()) {
    const html = renderPage(brand);
    const config = brandConfig(brand);
    assert.doesNotMatch(html, /\{\{|\}\}/, `${brand}: no unfilled slots`);
    for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `${brand}: #${id}`);
    assert.match(html, new RegExp(`<title>${config.title.replace(/\./g, '\\.')}</title>`), `${brand}: title`);
    assert.ok(html.includes(`<body data-firmware-url="${config.firmwareUrl}">`), `${brand}: firmware link`);
    assert.ok(html.includes(`Open a ${config.product} SysEx file`), `${brand}: product name in the intro`);
    assert.ok(html.includes(read('brands', brand, 'hero.html').trimEnd()), `${brand}: hero partial`);
    assert.ok(html.includes(read('brands', brand, 'header.html').trimEnd()), `${brand}: header partial`);
    assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ['app.js']);
    assert.deepEqual([...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !/^https:/.test(h)), ['style.css']);
  }
});

test('the editor markup is the same for every brand (only the slots differ)', async () => {
  const { listBrands, renderPage } = await brands();
  const editor = (html) => html.slice(html.indexOf('<main class="page">')).replace(/Open a [^<]+? SysEx file/, '');
  const [first, ...rest] = listBrands();
  for (const brand of rest) assert.equal(editor(renderPage(brand)), editor(renderPage(first)), brand);
});

test('each theme defines every variable the shared base.css uses', async () => {
  const { listBrands } = await brands();
  const base = read('site', 'base.css');
  const needed = [...usedVars(base)].filter((v) => !definedVars(base).has(v));
  assert.ok(needed.includes('--page') && needed.includes('--loaded'), 'found the variables base.css uses');
  for (const brand of listBrands()) {
    const theme = definedVars(read('brands', brand, 'theme.css'));
    assert.deepEqual(needed.filter((v) => !theme.has(v)), [], `brands/${brand}/theme.css defines them all`);
  }
});

test('the build output is the rendered page and base.css + theme.css', async () => {
  const { listBrands, renderPage, renderStyles } = await brands();
  for (const brand of listBrands()) {
    assert.equal(read('dist', brand, 'index.html'), renderPage(brand), `dist/${brand}/index.html`);
    const css = read('dist', brand, 'style.css');
    assert.equal(css, renderStyles(brand));
    assert.ok(css.indexOf(read('site', 'base.css')) === 0, `${brand}: base first`);
    assert.ok(css.endsWith(read('brands', brand, 'theme.css')), `${brand}: theme last`);
    // brand source files are not published, assets are
    for (const f of ['brand.json', 'head.html', 'header.html', 'hero.html', 'theme.css']) {
      assert.ok(!fs.existsSync(path.join(root, 'dist', brand, f)), `dist/${brand}/${f} not published`);
    }
    assert.ok(fs.existsSync(path.join(root, 'dist', brand, 'img')), `dist/${brand}/img`);
  }
});

test('build options: every brand by default, or one brand by flag or BRAND, optionally to any folder', async () => {
  const { buildOptions } = await brands();
  const os = require('os');
  const dist = (b) => path.join(root, 'dist', b);
  const sites = (o) => o.sites.map((s) => [s.brand, s.out]);

  assert.deepEqual(sites(buildOptions([], {})), [['cvocd', dist('cvocd')], ['mutantbrain', dist('mutantbrain')]]);
  assert.equal(buildOptions([], {}).all, true);
  for (const [argv, env] of [[['--brand', 'cvocd'], {}], [['--brand=cvocd'], {}], [[], { BRAND: 'cvocd' }], [['--brand', 'cvocd'], { BRAND: 'mutantbrain' }]]) {
    const o = buildOptions(argv, env);
    assert.deepEqual(sites(o), [['cvocd', dist('cvocd')]], JSON.stringify({ argv, env }));
    assert.equal(o.all, false);
  }
  // --out: relative to the caller's folder; a new folder, or one holding a previous build
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-out-'));
  try {
    assert.deepEqual(sites(buildOptions(['--brand', 'cvocd', '--out', 'public'], {}, tmp)), [['cvocd', path.join(tmp, 'public')]]);
    fs.mkdirSync(path.join(tmp, 'site'));
    fs.writeFileSync(path.join(tmp, 'site', 'index.html'), '');
    fs.writeFileSync(path.join(tmp, 'site', 'app.js'), '');
    assert.deepEqual(sites(buildOptions(['--brand=mutantbrain', '--out=site'], {}, tmp)), [['mutantbrain', path.join(tmp, 'site')]]);
    // never a folder with other things in it, the project, or a folder containing the project
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'keep me');
    assert.throws(() => buildOptions(['--brand', 'cvocd', '--out', '.'], {}, tmp), /not empty and not a previous build/);
    assert.throws(() => buildOptions(['--brand', 'cvocd', '--out', root], {}), /contains the project/);
    assert.throws(() => buildOptions(['--brand', 'cvocd', '--out', path.dirname(root)], {}), /contains the project/);
    assert.throws(() => buildOptions(['--brand', 'cvocd', '--out', 'src'], {}, root), /not empty and not a previous build/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // mistakes
  assert.throws(() => buildOptions(['--brand', 'nope'], {}), /unknown brand "nope" \(have: cvocd, mutantbrain\)/);
  assert.throws(() => buildOptions([], { BRAND: 'nope' }), /unknown brand "nope"/);
  assert.throws(() => buildOptions(['--out', 'x'], {}), /--out needs --brand/);
  assert.throws(() => buildOptions(['--brand'], {}), /--brand needs a value/);
  assert.throws(() => buildOptions(['--brand', '--out', 'x'], {}), /--brand needs a value/);
  assert.throws(() => buildOptions(['--colour', 'red'], {}), /unknown option --colour/);
});

test('mistakes in a brand are reported clearly', async () => {
  const { brandConfig } = await brands();
  assert.throws(() => brandConfig('no-such-brand'), /ENOENT/);
  const { siteDir } = require('../tools/serve');
  assert.throws(() => siteDir('no-such-brand'), /unknown brand "no-such-brand" \(have: cvocd, mutantbrain\)/);
  assert.equal(siteDir(), path.join(root, 'dist', 'mutantbrain'));
});
