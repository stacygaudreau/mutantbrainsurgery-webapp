#!/usr/bin/env node
'use strict';
/**
 * Minimal static server for local preview of a built brand site (dist/<brand>/).
 *   npm run serve                   -> builds, then Mutant Brain Surgery at http://127.0.0.1:8765/
 *   npm run serve:cvocd             -> builds, then the CV.OCD site at http://127.0.0.1:8766/
 *   node tools/serve.js cvocd 9000  -> any brand, any port (after npm run build)
 * Also used by test/browser.test.js.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BRAND = 'mutantbrain';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.gif': 'image/gif', '.png': 'image/png', '.json': 'application/json', '.ts': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

/** Built site folder of a brand. */
function siteDir(brand = DEFAULT_BRAND) {
  if (!fs.existsSync(path.join(ROOT, 'brands', brand))) {
    const known = fs.readdirSync(path.join(ROOT, 'brands')).join(', ');
    throw new Error(`unknown brand "${brand}" (have: ${known})`);
  }
  return path.join(ROOT, 'dist', brand);
}

function createServer(brand) {
  const PUBLIC = siteDir(brand);
  return http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { p = '/'; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.resolve(PUBLIC, '.' + p);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(file));
  });
}

if (require.main === module) {
  // arguments in any order: a number is the port, anything else the brand
  const args = process.argv.slice(2);
  const port = Number(args.find((a) => /^\d+$/.test(a))) || 8765;
  const brand = args.find((a) => !/^\d+$/.test(a)) || DEFAULT_BRAND;
  createServer(brand).listen(port, '127.0.0.1', () => console.log(`${brand} site at http://127.0.0.1:${port}/`));
}

module.exports = { createServer, siteDir, DEFAULT_BRAND };
