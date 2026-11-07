#!/usr/bin/env node
'use strict';
/**
 * Minimal static server for local preview of the built site in dist/.
 *   npm run serve            -> builds, then http://127.0.0.1:8765/
 *   node tools/serve.js 9000 -> http://127.0.0.1:9000/ (after npm run build)
 * Also used by test/browser.test.js.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.resolve(__dirname, '../dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.gif': 'image/gif', '.png': 'image/png', '.json': 'application/json', '.ts': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function createServer() {
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
  const port = Number(process.argv[2]) || 8765;
  createServer().listen(port, '127.0.0.1', () => console.log(`Mutant Brain Surgery at http://127.0.0.1:${port}/`));
}

module.exports = { createServer };
