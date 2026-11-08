#!/usr/bin/env node
/**
 * Build:
 *   dist/<brand>/  one website per brand (see tools/brands.mjs): the page,
 *                  style.css and assets, plus app.js (src/app bundled with the
 *                  library, compiled down to ES2017 so it runs in widely
 *                  supported browsers). Every brand runs the same app.js.
 *   build/lib/     the reusable library: index.mjs (ESM), index.cjs (CommonJS),
 *                  types/*.d.ts, for use in other projects (e.g. the desktop app)
 *
 * Run via `npm run build` (which type-checks first). To build one site for
 * deploying, name the brand, and optionally where it goes:
 *   npm run build -- --brand cvocd               -> dist/cvocd/
 *   npm run build -- --brand cvocd --out public  -> ./public
 *   BRAND=cvocd npm run build                    -> dist/cvocd/ (for hosts set up with env vars)
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIST_DIR, buildBrandSite, buildOptions } from './brands.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => join(root, ...parts);

/** Browsers the website must run in (all support ES2017). */
export const BROWSER_TARGETS = ['es2017', 'chrome61', 'edge79', 'firefox60', 'safari12', 'ios12'];

const banner = '/*! Mutant Brain Surgery | CC BY-NC-SA 4.0 | based on CV.OCD by Jason Hotchkiss */';

let options;
try {
  options = buildOptions(process.argv.slice(2), process.env, process.env.INIT_CWD || process.cwd());
} catch (error) {
  console.error(`build: ${error.message}`);
  process.exit(1);
}

if (options.all) {
  rmSync(DIST_DIR, { recursive: true, force: true });
  rmSync(at('dist-cvocd'), { recursive: true, force: true }); // older build layout
}
rmSync(at('build'), { recursive: true, force: true });

// Websites: one per brand, all running the same app.js
for (const site of options.sites) {
  rmSync(site.out, { recursive: true, force: true }); // checked by buildOptions: empty or a previous build
  const out = buildBrandSite(site.brand, site.out);
  await build({
    entryPoints: [at('src/app/main.ts')],
    outfile: join(out, 'app.js'),
    bundle: true,
    format: 'iife',
    target: BROWSER_TARGETS,
    minify: true,
    sourcemap: true,
    banner: { js: banner },
    logLevel: 'warning',
  });
}

// Library (readable output, ES2017 as well so any consumer can use it as-is)
for (const [format, file] of [['esm', 'index.mjs'], ['cjs', 'index.cjs']]) {
  await build({
    entryPoints: [at('src/lib/index.ts')],
    outfile: at('build/lib', file),
    bundle: true,
    format,
    platform: 'neutral',
    target: 'es2017',
    sourcemap: true,
    banner: { js: banner },
    logLevel: 'warning',
  });
}

// Library type declarations
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [
  tsc, '-p', at('tsconfig.lib.json'),
  '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--outDir', at('build/lib/types'),
], { stdio: 'inherit' });

const shown = (dir) => (dir.startsWith(root) ? dir.slice(root.length + 1).replace(/\\/g, '/') + '/' : dir);
console.log(`built ${options.sites.map((s) => `${s.brand} -> ${shown(s.out)}`).join(', ')} (websites) and build/lib/ (library)`);
