#!/usr/bin/env node
/**
 * Renders each brand's images from the HTML in brands/<name>/art/ (needs
 * Chrome or Edge and playwright-core; run after changing the art):
 *
 *   art/social.html -> img/social.png        1200x630 link preview (Open Graph / Twitter)
 *   art/icon.html   -> favicon.ico           16, 32 and 48 px
 *                      favicon.png           32 px
 *                      apple-touch-icon.png  180 px, square corners (iOS rounds it)
 *                      icon-192.png, icon-512.png   web app manifest icons
 *
 *   node tools/make-brand-images.mjs [brand ...]
 *
 * The art pages may use web fonts; each is rendered once its fonts have loaded.
 * The results are committed with the brand, so a build needs no browser.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { BRANDS_DIR, checkBrand, listBrands } from './brands.mjs';

const brands = process.argv.slice(2).length ? process.argv.slice(2).map(checkBrand) : listBrands();

/** An .ico holding PNG images (supported by every browser since IE Vista-era). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const browser = await (async () => {
  for (const channel of ['chrome', 'msedge']) {
    // greyscale text smoothing: subpixel (LCD) smoothing leaves colour fringes in images
    try { return await chromium.launch({ channel, headless: true, args: ['--disable-lcd-text'] }); } catch { /* try the next */ }
  }
  throw new Error('make-brand-images needs Chrome or Edge installed');
})();

/** Screenshot an art page at a size (transparent where the page is). */
async function render(file, width, height, query = '') {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href + query, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.complete || new Promise((r) => { img.onload = img.onerror = r; })));
  });
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } });
  await context.close();
  return png;
}

try {
  for (const brand of brands) {
    const dir = join(BRANDS_DIR, brand);
    const art = (f) => join(dir, 'art', f);
    const made = [];
    if (existsSync(art('social.html'))) {
      writeFileSync(join(dir, 'img', 'social.png'), await render(art('social.html'), 1200, 630));
      made.push('img/social.png');
    }
    if (existsSync(art('icon.html'))) {
      const sizes = [16, 32, 48];
      const pngs = [];
      for (const size of sizes) pngs.push({ size, data: await render(art('icon.html'), size, size) });
      writeFileSync(join(dir, 'favicon.ico'), ico(pngs));
      writeFileSync(join(dir, 'favicon.png'), pngs.find((p) => p.size === 32).data);
      writeFileSync(join(dir, 'apple-touch-icon.png'), await render(art('icon.html'), 180, 180, '?square'));
      // web app manifest icons ("add to home screen")
      for (const size of [192, 512]) writeFileSync(join(dir, `icon-${size}.png`), await render(art('icon.html'), size, size));
      made.push('favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png');
    }
    console.log(`${brand}: ${made.join(', ') || 'no art/'}`);
  }
} finally {
  await browser.close();
}
