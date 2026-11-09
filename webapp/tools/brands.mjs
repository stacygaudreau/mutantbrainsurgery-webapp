/**
 * Brands: the same patch builder app under different branding, one website each.
 *
 *   site/index.html   the page, shared: the editor markup with {{slots}}
 *   site/base.css     shared layout and components, driven by CSS variables
 *   brands/<name>/    one folder per brand:
 *     brand.json      { title (site name), pageTitle (for search results),
 *                       shortName (home screen, max 12 chars), description,
 *                       themeColor, product, firmwareUrl, url (public address),
 *                       socialImageAlt, author, authorUrl,
 *                       supportUrl, supportLabel (the "Found a bug?" link) }
 *     head.html       extra <head> tags (icons, fonts) -> {{> head}}
 *     header.html     the top bar                      -> {{> header}}
 *     hero.html       heading and product image        -> {{> hero}}
 *     theme.css       variables, fonts, colours, brand decoration
 *     img/, fonts/    assets, copied as they are (img/social.png: link preview)
 *     favicon.*, apple-touch-icon.png   icons, copied as they are
 *     art/            sources of the preview image and icons (not published;
 *                     rendered by tools/make-brand-images.mjs)
 *
 * A brand's site is built to dist/<name>/: index.html, style.css (base.css +
 * theme.css), robots.txt, sitemap.xml, site.webmanifest, _headers (site/_headers)
 * and the assets (a brand may add a _redirects file);
 * tools/build.mjs adds app.js. Adding a brand is adding a folder.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_DIR = join(root, 'site');
export const BRANDS_DIR = join(root, 'brands');
export const DIST_DIR = join(root, 'dist');

/** The brand whose site is the default (served by `npm run serve`, deployed by Firebase). */
export const DEFAULT_BRAND = 'mutantbrain';

const CONFIG_KEYS = [
  'title', 'pageTitle', 'shortName', 'description', 'themeColor', 'product', 'firmwareUrl',
  'url', 'socialImageAlt', 'author', 'authorUrl', 'supportUrl', 'supportLabel',
];
/** Computed values put into the page as they are (not HTML-escaped). */
const RAW_VALUES = new Set(['jsonLd']);
const PARTIALS = ['head', 'header', 'hero'];
/** Files of a brand folder that make the page rather than being copied to the site. */
const SOURCE_FILES = new Set(['brand.json', 'theme.css', 'art', ...PARTIALS.map((p) => `${p}.html`)]);

/** Names of all brands (folders in brands/). */
export function listBrands() {
  return readdirSync(BRANDS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A site's public address: http(s), no trailing slash. */
export function checkSiteUrl(url, where = 'url') {
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(url)) throw new Error(`${where}: "${url}" is not an http(s) address`);
  return url.replace(/\/+$/, '');
}

/** A brand's settings, checked: every key present and a non-empty string. */
export function brandConfig(name) {
  const file = join(BRANDS_DIR, name, 'brand.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of CONFIG_KEYS) {
    if (typeof config[key] !== 'string' || !config[key]) throw new Error(`${file}: "${key}" must be a non-empty string`);
  }
  const unknown = Object.keys(config).filter((k) => !CONFIG_KEYS.includes(k));
  if (unknown.length) throw new Error(`${file}: unknown key(s) ${unknown.join(', ')}`);
  config.url = checkSiteUrl(config.url, `${file}: "url"`);
  checkSiteUrl(config.authorUrl, `${file}: "authorUrl"`);
  checkSiteUrl(config.supportUrl, `${file}: "supportUrl"`);
  if ([...config.shortName].length > 12) throw new Error(`${file}: "shortName" is over 12 characters (home screens cut it off)`);
  return config;
}

/**
 * The page for a brand: site/index.html with {{value}} (HTML-escaped) and
 * {{> partial}} filled in; partials may use {{value}} too (but not partials).
 * `url` replaces brand.json's public address (a site deployed somewhere else).
 */
export function renderPage(name, { url } = {}) {
  const config = siteConfig(name, url);
  const values = {
    ...config,
    // a version of the preview image, so a changed image gets a new address and
    // link preview services fetch it again instead of using their cache
    socialImageVersion: contentVersion(join(BRANDS_DIR, name, 'img', 'social.png')),
    // JSON in a <script>: "<" escaped so the text can never close the element
    jsonLd: JSON.stringify(structuredData(config)).replace(/</g, '\\u003c'),
  };
  const slot = /\{\{\s*(>\s*)?([\w-]+)\s*\}\}/g;
  const fillValues = (text, where) => text.replace(slot, (match, partial, key) => {
    if (partial) throw new Error(`${where}: partials can't include partials ({{> ${key}}})`);
    if (!(key in values)) throw new Error(`${where}: unknown value {{${key}}}`);
    return RAW_VALUES.has(key) ? values[key] : escapeHtml(values[key]);
  });
  const template = readFileSync(join(SITE_DIR, 'index.html'), 'utf8');
  const html = template.replace(slot, (match, partial, key) => {
    if (partial) {
      if (!PARTIALS.includes(key)) throw new Error(`site/index.html: unknown partial {{> ${key}}}`);
      const text = readFileSync(join(BRANDS_DIR, name, `${key}.html`), 'utf8').replace(/\s+$/, '');
      return fillValues(text, `brands/${name}/${key}.html`);
    }
    return fillValues(match, 'site/index.html');
  });
  if (/\{\{|\}\}/.test(html)) throw new Error(`brand ${name}: page still has {{ }} after filling in`);
  return html;
}

/** A brand's settings for a site at `url` (default: brand.json's). */
function siteConfig(name, url) {
  const config = brandConfig(name);
  if (url) config.url = checkSiteUrl(url, '--url');
  return config;
}

/** schema.org description of the site, for search engines. */
export function structuredData(config) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: config.title,
    alternateName: config.pageTitle,
    description: config.description,
    url: `${config.url}/`,
    image: `${config.url}/img/social.png`,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any (web browser)',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Organization', name: config.author, url: config.authorUrl },
    license: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  };
}

/** robots.txt: crawl everything, and where the sitemap is. */
export function renderRobots(name, { url } = {}) {
  const config = siteConfig(name, url);
  return `User-agent: *\nAllow: /\n\nSitemap: ${config.url}/sitemap.xml\n`;
}

/** sitemap.xml: the site's one page. */
export function renderSitemap(name, { url } = {}) {
  const config = siteConfig(name, url);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${escapeHtml(config.url)}/</loc></url>\n` +
    '</urlset>\n';
}

/** site.webmanifest: name, colours and icons for "add to home screen". */
export function renderManifest(name, { url } = {}) {
  const config = siteConfig(name, url);
  const theme = readFileSync(join(BRANDS_DIR, name, 'theme.css'), 'utf8');
  const page = (theme.match(/--page:\s*(#[0-9a-fA-F]{3,8})/) || [])[1] || config.themeColor;
  return JSON.stringify({
    name: config.title,
    short_name: config.shortName,
    description: config.description,
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: page,
    theme_color: config.themeColor,
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }, null, 2) + '\n';
}

/** Short version code of a file's contents (changes whenever the file does). */
export function contentVersion(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
}

/** The stylesheet for a brand: the shared base, then the brand's theme. */
export function renderStyles(name) {
  const base = readFileSync(join(SITE_DIR, 'base.css'), 'utf8');
  const theme = readFileSync(join(BRANDS_DIR, name, 'theme.css'), 'utf8');
  return `${base}\n/* ==== brands/${name}/theme.css ==== */\n\n${theme}`;
}

/** Write a brand's site (without app.js) to `out` (default dist/<name>/); returns that folder. */
export function buildBrandSite(name, out = join(DIST_DIR, name), { url } = {}) {
  mkdirSync(out, { recursive: true });
  for (const entry of readdirSync(join(BRANDS_DIR, name))) {
    if (!SOURCE_FILES.has(entry)) cpSync(join(BRANDS_DIR, name, entry), join(out, entry), { recursive: true });
  }
  cpSync(join(SITE_DIR, '_headers'), join(out, '_headers')); // response headers for hosts that read them
  writeFileSync(join(out, 'index.html'), renderPage(name, { url }));
  writeFileSync(join(out, 'robots.txt'), renderRobots(name, { url }));
  writeFileSync(join(out, 'sitemap.xml'), renderSitemap(name, { url }));
  writeFileSync(join(out, 'site.webmanifest'), renderManifest(name, { url }));
  writeFileSync(join(out, 'style.css'), renderStyles(name));
  return out;
}

/** Throw unless `name` is a brand. */
export function checkBrand(name) {
  if (!listBrands().includes(name)) throw new Error(`unknown brand "${name}" (have: ${listBrands().join(', ')})`);
  return name;
}

/**
 * Which sites to build, from the command line and environment:
 *   (nothing)                  every brand, to dist/<brand>/
 *   --brand cvocd | BRAND=cvocd   just that brand, to dist/cvocd/
 *   --brand cvocd --out site   just that brand, to ./site (for hosts that publish a fixed folder)
 *   --brand cvocd --url https://example.com   just that brand, for that address
 *                              (link previews need it; default: brand.json's url)
 * `--name value` and `--name=value` both work; --brand wins over BRAND, --url over SITE_URL.
 * `cwd` is where a relative --out is resolved (npm sets INIT_CWD to the caller's folder).
 */
export function buildOptions(argv = [], env = {}, cwd = process.cwd()) {
  const value = (name) => {
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === `--${name}`) {
        if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`);
        return argv[i + 1];
      }
      if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
    }
    return undefined;
  };
  const known = new Set(['--brand', '--out', '--url']);
  for (const arg of argv) {
    if (arg.startsWith('--') && !known.has(arg.split('=')[0])) throw new Error(`unknown option ${arg} (use --brand <name>, --out <folder> and --url <address>)`);
  }
  const brand = value('brand') || env.BRAND || undefined;
  const out = value('out');
  if (out && !brand) throw new Error('--out needs --brand (one site per folder)');
  const url = value('url') || env.SITE_URL || undefined;
  if (url && !brand) throw new Error('--url needs --brand (each site has its own address)');
  const brands = brand ? [checkBrand(brand)] : listBrands();
  const sites = brands.map((name) => ({
    brand: name,
    out: out ? resolve(cwd, out) : join(DIST_DIR, name),
    ...(url ? { url: checkSiteUrl(url, '--url') } : {}),
  }));
  for (const site of sites) checkOutputFolder(site.out);
  return { brands, sites, all: !brand };
}

/**
 * A folder the build may replace: one that doesn't exist yet, is empty, or
 * holds a previous build of a site (index.html + app.js). Never the project
 * itself or a folder containing it.
 */
export function checkOutputFolder(dir) {
  const project = resolve(dirname(SITE_DIR));
  const target = resolve(dir);
  const rel = relative(target, project);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error(`refusing to build into ${target}: it contains the project`);
  if (!existsSync(target)) return target;
  const entries = readdirSync(target);
  const previousBuild = entries.includes('index.html') && entries.includes('app.js');
  if (entries.length && !previousBuild) throw new Error(`refusing to replace ${target}: it is not empty and not a previous build`);
  return target;
}
