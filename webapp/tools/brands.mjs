/**
 * Brands: the same patch builder app under different branding, one website each.
 *
 *   site/index.html   the page, shared: the editor markup with {{slots}}
 *   site/base.css     shared layout and components, driven by CSS variables
 *   brands/<name>/    one folder per brand:
 *     brand.json      { title, description, themeColor, product, firmwareUrl }
 *     head.html       extra <head> tags (fonts)        -> {{> head}}
 *     header.html     the top bar                      -> {{> header}}
 *     hero.html       heading and product image        -> {{> hero}}
 *     theme.css       variables, fonts, colours, brand decoration
 *     img/, fonts/    assets, copied as they are
 *
 * A brand's site is built to dist/<name>/: index.html, style.css (base.css +
 * theme.css) and the assets; tools/build.mjs adds app.js. Adding a brand is
 * adding a folder.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_DIR = join(root, 'site');
export const BRANDS_DIR = join(root, 'brands');
export const DIST_DIR = join(root, 'dist');

/** The brand whose site is the default (served by `npm run serve`, deployed by Firebase). */
export const DEFAULT_BRAND = 'mutantbrain';

const CONFIG_KEYS = ['title', 'description', 'themeColor', 'product', 'firmwareUrl'];
const PARTIALS = ['head', 'header', 'hero'];
/** Files of a brand folder that make the page rather than being copied to the site. */
const SOURCE_FILES = new Set(['brand.json', 'theme.css', ...PARTIALS.map((p) => `${p}.html`)]);

/** Names of all brands (folders in brands/). */
export function listBrands() {
  return readdirSync(BRANDS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A brand's settings, checked: every key present and a non-empty string. */
export function brandConfig(name) {
  const file = join(BRANDS_DIR, name, 'brand.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of CONFIG_KEYS) {
    if (typeof config[key] !== 'string' || !config[key]) throw new Error(`${file}: "${key}" must be a non-empty string`);
  }
  const unknown = Object.keys(config).filter((k) => !CONFIG_KEYS.includes(k));
  if (unknown.length) throw new Error(`${file}: unknown key(s) ${unknown.join(', ')}`);
  return config;
}

/** The page for a brand: site/index.html with {{value}} (HTML-escaped) and {{> partial}} filled in. */
export function renderPage(name) {
  const config = brandConfig(name);
  const template = readFileSync(join(SITE_DIR, 'index.html'), 'utf8');
  const html = template.replace(/\{\{\s*(>\s*)?([\w-]+)\s*\}\}/g, (match, partial, key) => {
    if (partial) {
      if (!PARTIALS.includes(key)) throw new Error(`site/index.html: unknown partial {{> ${key}}}`);
      return readFileSync(join(BRANDS_DIR, name, `${key}.html`), 'utf8').replace(/\s+$/, '');
    }
    if (!CONFIG_KEYS.includes(key)) throw new Error(`site/index.html: unknown value {{${key}}}`);
    return escapeHtml(config[key]);
  });
  if (/\{\{|\}\}/.test(html)) throw new Error(`brand ${name}: page still has {{ }} after filling in`);
  return html;
}

/** The stylesheet for a brand: the shared base, then the brand's theme. */
export function renderStyles(name) {
  const base = readFileSync(join(SITE_DIR, 'base.css'), 'utf8');
  const theme = readFileSync(join(BRANDS_DIR, name, 'theme.css'), 'utf8');
  return `${base}\n/* ==== brands/${name}/theme.css ==== */\n\n${theme}`;
}

/** Write a brand's site (without app.js) to `out` (default dist/<name>/); returns that folder. */
export function buildBrandSite(name, out = join(DIST_DIR, name)) {
  mkdirSync(out, { recursive: true });
  for (const entry of readdirSync(join(BRANDS_DIR, name))) {
    if (!SOURCE_FILES.has(entry)) cpSync(join(BRANDS_DIR, name, entry), join(out, entry), { recursive: true });
  }
  writeFileSync(join(out, 'index.html'), renderPage(name));
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
 * `--name value` and `--name=value` both work; --brand wins over BRAND.
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
  const known = new Set(['--brand', '--out']);
  for (const arg of argv) {
    if (arg.startsWith('--') && !known.has(arg.split('=')[0])) throw new Error(`unknown option ${arg} (use --brand <name> and --out <folder>)`);
  }
  const brand = value('brand') || env.BRAND || undefined;
  const out = value('out');
  if (out && !brand) throw new Error('--out needs --brand (one site per folder)');
  const brands = brand ? [checkBrand(brand)] : listBrands();
  const sites = brands.map((name) => ({ brand: name, out: out ? resolve(cwd, out) : join(DIST_DIR, name) }));
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
