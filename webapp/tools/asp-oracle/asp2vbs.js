'use strict';
/**
 * Converts the original Classic ASP sources into plain VBScript that Windows
 * Script Host (cscript.exe) can run, so the ORIGINAL code can serve as a test
 * oracle for the JavaScript port.
 *
 * Conversion follows how ASP itself compiles a page:
 *   - `<!--#include file="x"-->` is a textual include
 *   - text outside `<% %>` becomes Response.Write "<text>"
 *   - `<%= expr %>` becomes Response.Write (expr)
 *   - `<% code %>` is copied verbatim
 *
 * The include files (sysex.inc, render.inc) contain only definitions (Const,
 * Dim, Function, Class), so they are returned separately as `defs` and
 * executed once; the page body is returned as `body` and executed per request.
 *
 * The ONLY semantic patch applied: sysex.inc contains a line starting with `//`
 * (`//Const NRPVH_SRC_MIDICONT = 24`), which is a VBScript compile error. It is
 * turned into a `'` comment, which is plainly what the author intended.
 */
const fs = require('fs');
const path = require('path');

const INCLUDE_RE = /<!--\s*#include\s+file\s*=\s*"([^"]+)"\s*-->/gi;

function readSource(file) {
  // ASP sources are plain ASCII/ANSI; normalise nothing (line endings matter
  // only inside text segments, which are reproduced verbatim).
  return fs.readFileSync(file, 'latin1');
}

/** Split ASP source into segments of {type: 'text'|'code'|'expr', value}. */
function tokenize(src) {
  const segs = [];
  let pos = 0;
  while (pos < src.length) {
    const open = src.indexOf('<%', pos);
    if (open === -1) {
      segs.push({ type: 'text', value: src.slice(pos) });
      break;
    }
    if (open > pos) segs.push({ type: 'text', value: src.slice(pos, open) });
    const close = src.indexOf('%>', open + 2);
    if (close === -1) throw new Error('Unterminated <% block');
    let inner = src.slice(open + 2, close);
    if (inner.startsWith('=')) segs.push({ type: 'expr', value: inner.slice(1) });
    else segs.push({ type: 'code', value: inner });
    pos = close + 2;
  }
  return segs;
}

/** VBScript string-literal expression for arbitrary text (handles newlines). */
function vbsStringExpr(text) {
  const parts = [];
  let cur = '';
  const flush = () => { parts.push('"' + cur.replace(/"/g, '""') + '"'); cur = ''; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\r' && text[i + 1] === '\n') { flush(); parts.push('vbCrLf'); i++; }
    else if (c === '\r') { flush(); parts.push('vbCr'); }
    else if (c === '\n') { flush(); parts.push('vbLf'); }
    else if (c === '\t') { flush(); parts.push('vbTab'); }
    else cur += c;
  }
  flush();
  return parts.filter((p) => p !== '""').join(' & ') || '""';
}

function fixCode(code, fixes, where) {
  return code.replace(/^([ \t]*)\/\/(.*)$/gm, (m, indent, rest) => {
    fixes.push(`${where}: commented out invalid VBScript line "//${rest.trim()}"`);
    return `${indent}'//${rest}`;
  });
}

function segmentsToVbs(segs, fixes, where) {
  const out = [];
  for (const s of segs) {
    if (s.type === 'text') {
      if (s.value.length) out.push('Response.Write ' + vbsStringExpr(s.value));
    } else if (s.type === 'expr') {
      out.push('Response.Write (' + s.value.trim() + ')');
    } else {
      out.push(fixCode(s.value, fixes, where));
    }
  }
  return out.join('\r\n');
}

/**
 * Convert one ASP page.
 * @returns {{defs: string, body: string, fixes: string[]}}
 */
function convertPage(pageFile) {
  const dir = path.dirname(pageFile);
  const fixes = [];
  const defs = [];
  const seen = new Set();
  const src = readSource(pageFile).replace(INCLUDE_RE, (m, inc) => {
    const incFile = path.join(dir, inc.trim());
    if (!seen.has(incFile)) {
      seen.add(incFile);
      const segs = tokenize(readSource(incFile));
      const stray = segs.filter((s) => s.type !== 'code' && s.value.trim() !== '');
      if (stray.length) throw new Error(`${inc}: include has non-code content; oracle assumes definitions only`);
      // whitespace-only text inside an include would be written to output by ASP;
      // keep it faithfully in the body at the include position
      const ws = segs.filter((s) => s.type === 'text').map((s) => s.value).join('');
      defs.push(segs.filter((s) => s.type === 'code').map((s) => fixCode(s.value, fixes, inc)).join('\r\n'));
      return ws;
    }
    return '';
  });
  return { defs: defs.join('\r\n'), body: segmentsToVbs(tokenize(src), fixes, path.basename(pageFile)), fixes };
}

module.exports = { convertPage, tokenize, vbsStringExpr };
