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
    for (const f of ['brand.json', 'head.html', 'header.html', 'hero.html', 'theme.css',
      'favicon.ico', 'apple-touch-icon.png', 'img/social.png', 'art/social.html', 'art/icon.html']) {
      assert.ok(fs.existsSync(path.join(root, 'brands', brand, f)), `brands/${brand}/${f}`);
    }
    const config = brandConfig(brand);
    assert.deepEqual(Object.keys(config).sort(), ['author', 'authorUrl', 'description', 'firmwareUrl', 'pageTitle', 'product', 'shortName', 'socialImageAlt', 'supportLabel', 'supportUrl', 'themeColor', 'title', 'url']);
    assert.ok([...config.shortName].length <= 12, `${brand}: shortName fits a home screen`);
    assert.match(config.firmwareUrl, /^https:\/\//);
    assert.match(config.url, /^https:\/\/[^/]+$/, `${brand}: url is https, no trailing slash`);
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
    assert.ok(html.includes(`<title>${config.pageTitle}</title>`), `${brand}: title`);
    assert.ok(html.includes(`data-firmware-url="${config.firmwareUrl}"`), `${brand}: firmware link`);
    assert.ok(html.includes(`data-support-url="${config.supportUrl}" data-support-label="${config.supportLabel}"`), `${brand}: bug report link`);
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
    for (const f of ['brand.json', 'head.html', 'header.html', 'hero.html', 'theme.css', 'art']) {
      assert.ok(!fs.existsSync(path.join(root, 'dist', brand, f)), `dist/${brand}/${f} not published`);
    }
    assert.ok(fs.existsSync(path.join(root, 'dist', brand, 'img')), `dist/${brand}/img`);
  }
});

/** Width and height of a PNG (from its IHDR chunk). */
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

test('link previews and icons: absolute social tags, and every linked file exists at the right size', async () => {
  const { listBrands, brandConfig, contentVersion } = await brands();
  for (const brand of listBrands()) {
    const { url, title, description, socialImageAlt } = brandConfig(brand);
    const version = contentVersion(path.join(root, 'brands', brand, 'img', 'social.png'));
    assert.match(version, /^[0-9a-f]{10}$/);
    const html = read('dist', brand, 'index.html');
    const meta = (attr, key) => (html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`)) || [])[1];
    const unescape = (s) => s && s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.equal(unescape(meta('property', 'og:title')), title, `${brand}: og:title`);
    assert.equal(unescape(meta('property', 'og:description')), description, `${brand}: og:description`);
    assert.equal(meta('property', 'og:url'), `${url}/`, `${brand}: og:url`);
    // absolute, and versioned by content so a new image isn't served from preview caches
    assert.equal(meta('property', 'og:image'), `${url}/img/social.png?v=${version}`, `${brand}: og:image`);
    assert.equal(unescape(meta('property', 'og:image:alt')), socialImageAlt, `${brand}: og:image:alt`);
    assert.equal(meta('name', 'twitter:card'), 'summary_large_image', `${brand}: twitter card`);
    assert.ok(html.includes(`<link rel="canonical" href="${url}/">`), `${brand}: canonical`);
    assert.doesNotMatch(html, /href="data:/, `${brand}: no placeholder icon`);
    // the preview image is the size the tags say
    const social = fs.readFileSync(path.join(root, 'dist', brand, 'img', 'social.png'));
    assert.deepEqual(pngSize(social), [Number(meta('property', 'og:image:width')), Number(meta('property', 'og:image:height'))], `${brand}: social.png size`);
    assert.ok(social.length < 1024 * 1024, `${brand}: social.png under 1 MB (${social.length} bytes)`);
    // every icon the page links to is in the build
    const icons = [...html.matchAll(/<link rel="(icon|apple-touch-icon)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    assert.ok(icons.some(([rel, href]) => rel === 'icon' && href === 'favicon.ico'), `${brand}: favicon.ico linked`);
    assert.ok(icons.some(([rel]) => rel === 'apple-touch-icon'), `${brand}: apple touch icon linked`);
    for (const [, href] of icons) assert.ok(fs.existsSync(path.join(root, 'dist', brand, href)), `dist/${brand}/${href}`);
    assert.deepEqual(pngSize(fs.readFileSync(path.join(root, 'dist', brand, 'apple-touch-icon.png'))), [180, 180], `${brand}: apple touch icon 180px`);
    // favicon.ico: an icon file with 16, 32 and 48 px images
    const ico = fs.readFileSync(path.join(root, 'dist', brand, 'favicon.ico'));
    assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], `${brand}: favicon.ico header`);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + 16 * i));
    assert.deepEqual(sizes, [16, 32, 48], `${brand}: favicon.ico sizes`);
  }
});

test('site metadata: titles, robots.txt, sitemap, web app manifest and structured data', async () => {
  const { listBrands, brandConfig, renderRobots, renderSitemap, renderManifest } = await brands();
  for (const brand of listBrands()) {
    const config = brandConfig(brand);
    const dist = (f) => read('dist', brand, f);
    const html = dist('index.html');
    // titles: the long one for search results, the site name for the app's tab title, the short one for home screens
    assert.ok(html.includes(`<title>${config.pageTitle}</title>`), `${brand}: <title>`);
    assert.ok(html.includes(`<meta name="application-name" content="${config.title}">`), `${brand}: application-name`);
    assert.ok(html.includes(`<meta name="apple-mobile-web-app-title" content="${config.shortName}">`), `${brand}: home screen name`);
    // robots.txt allows everything and points at the sitemap, which lists the page
    assert.equal(dist('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${config.url}/sitemap.xml\n`);
    assert.match(dist('sitemap.xml'), new RegExp(`<loc>${config.url.replace(/\./g, '\\.')}/</loc>`));
    // the manifest is linked, valid, and its icons exist at their stated sizes
    assert.ok(html.includes('<link rel="manifest" href="site.webmanifest">'), `${brand}: manifest linked`);
    const manifest = JSON.parse(dist('site.webmanifest'));
    assert.equal(manifest.name, config.title);
    assert.equal(manifest.short_name, config.shortName);
    assert.equal(manifest.theme_color, config.themeColor);
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    for (const icon of manifest.icons) {
      const png = fs.readFileSync(path.join(root, 'dist', brand, icon.src));
      assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes, `${brand}: ${icon.src}`);
    }
    // structured data: valid JSON, describing this site
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.equal(ld['@type'], 'WebApplication');
    assert.equal(ld.url, `${config.url}/`);
    assert.equal(ld.author.name, config.author);
    // static host rules (Cloudflare, Netlify): headers for every site, and the old .asp redirects for Mutant Brain
    assert.equal(dist('_headers'), read('site', '_headers'), `${brand}: _headers`);
    assert.match(dist('_headers'), /^\/\*\n  X-Content-Type-Options: nosniff$/m);
    if (brand === 'mutantbrain') assert.match(dist('_redirects'), /^\/patch\.asp\s+\/\s+301$/m);
    // all of them follow --url
    const other = { url: 'https://patches.example.com' };
    assert.match(renderRobots(brand, other), /Sitemap: https:\/\/patches\.example\.com\/sitemap\.xml/);
    assert.match(renderSitemap(brand, other), /<loc>https:\/\/patches\.example\.com\/<\/loc>/);
    assert.equal(JSON.parse(renderManifest(brand, other)).name, config.title);
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
  // --url (or SITE_URL): another public address for one brand's link previews
  assert.equal(buildOptions(['--brand', 'cvocd', '--url', 'https://patches.example.com/'], {}).sites[0].url, 'https://patches.example.com');
  assert.equal(buildOptions(['--brand=cvocd'], { SITE_URL: 'https://x.example' }).sites[0].url, 'https://x.example');
  assert.equal(buildOptions(['--brand', 'cvocd'], {}).sites[0].url, undefined, 'default: the url in brand.json');
  assert.throws(() => buildOptions(['--url', 'https://x.example'], {}), /--url needs --brand/);
  assert.throws(() => buildOptions(['--brand', 'cvocd', '--url', 'example.com'], {}), /not an http\(s\) address/);
});

test('mistakes in a brand are reported clearly', async () => {
  const { brandConfig } = await brands();
  assert.throws(() => brandConfig('no-such-brand'), /ENOENT/);
  const { siteDir } = require('../tools/serve');
  assert.throws(() => siteDir('no-such-brand'), /unknown brand "no-such-brand" \(have: cvocd, mutantbrain\)/);
  assert.equal(siteDir(), path.join(root, 'dist', 'mutantbrain'));
});
