#!/usr/bin/env node
/**
 * Generates brands/mutantbrain/img/starfield.svg: a seamless, tileable field of small
 * stars for the hero background (deterministic, so re-running gives the same file).
 *   node tools/make-starfield.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200;
const H = 700;
let seed = 0x5eed5;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r1 = (n) => Math.round(n * 10) / 10;

const stars = [];
// many faint specks, fewer brighter stars, a handful with a soft glow
for (let i = 0; i < 260; i++) stars.push({ x: rand() * W, y: rand() * H, r: 0.35 + rand() * 0.55, o: 0.15 + rand() * 0.35 });
for (let i = 0; i < 55; i++) stars.push({ x: rand() * W, y: rand() * H, r: 0.8 + rand() * 0.7, o: 0.45 + rand() * 0.4 });
const glows = [];
for (let i = 0; i < 7; i++) glows.push({ x: rand() * W, y: rand() * H, r: 1.3 + rand() * 0.6 });

// draw stars near an edge again on the opposite side, so the tile repeats seamlessly
const wrapped = [];
for (const s of [...stars, ...glows]) {
  for (const dx of [-W, 0, W]) {
    for (const dy of [-H, 0, H]) {
      const x = s.x + dx;
      const y = s.y + dy;
      if (x > -6 && x < W + 6 && y > -6 && y < H + 6) wrapped.push({ ...s, x, y });
    }
  }
}

const tint = () => ['#ffffff', '#dfe9ff', '#ffe9ef', '#d8f4f7'][Math.floor(rand() * 4)];
const body = wrapped
  .map((s) => (s.o === undefined
    ? `<circle cx="${r1(s.x)}" cy="${r1(s.y)}" r="${r1(s.r * 4)}" fill="url(#g)"/><circle cx="${r1(s.x)}" cy="${r1(s.y)}" r="${r1(s.r)}" fill="#fff"/>`
    : `<circle cx="${r1(s.x)}" cy="${r1(s.y)}" r="${r1(s.r)}" fill="${tint()}" fill-opacity="${r1(s.o * 10) / 10}"/>`))
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  '<defs><radialGradient id="g"><stop offset="0" stop-color="#cfefff" stop-opacity=".55"/><stop offset="1" stop-color="#cfefff" stop-opacity="0"/></radialGradient></defs>' +
  body + '</svg>\n';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'brands', 'mutantbrain', 'img', 'starfield.svg');
writeFileSync(out, svg);
console.log(`wrote ${out} (${svg.length} bytes, ${wrapped.length} stars)`);
