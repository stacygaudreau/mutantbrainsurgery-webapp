#!/usr/bin/env node
/**
 * Build:
 *   dist/        the website: public/ + app.js (src/app bundled with the library,
 *                compiled down to ES2017 so it runs in widely supported browsers)
 *   build/lib/   the reusable library: index.mjs (ESM), index.cjs (CommonJS),
 *                types/*.d.ts, for use in other projects (e.g. the desktop app)
 *
 * Run via `npm run build` (which type-checks first).
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => join(root, ...parts);

/** Browsers the website must run in (all support ES2017). */
export const BROWSER_TARGETS = ['es2017', 'chrome61', 'edge79', 'firefox60', 'safari12', 'ios12'];

const banner = '/*! Mutant Brain Surgery | CC BY-NC-SA 4.0 | based on CV.OCD by Jason Hotchkiss */';

rmSync(at('dist'), { recursive: true, force: true });
rmSync(at('build'), { recursive: true, force: true });

// Website
cpSync(at('public'), at('dist'), { recursive: true });
await build({
  entryPoints: [at('src/app/main.ts')],
  outfile: at('dist/app.js'),
  bundle: true,
  format: 'iife',
  target: BROWSER_TARGETS,
  minify: true,
  sourcemap: true,
  banner: { js: banner },
  logLevel: 'warning',
});

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

console.log('built dist/ (website) and build/lib/ (library)');
