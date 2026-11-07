'use strict';
/**
 * Test oracle: executes the ORIGINAL Classic ASP code (patch.asp,
 * get_sysex.asp, sysex.inc, render.inc) under Windows Script Host and returns
 * exactly what IIS would have sent, so the JavaScript port is verified against
 * the real thing rather than against a re-reading of it.
 *
 * Requires Windows with cscript.exe + VBScript (present on Windows 10/11).
 * `isAvailable()` lets test suites skip cleanly elsewhere.
 *
 * All calls are batched and spread over parallel cscript processes:
 *   renderPatchPage([sysexBytes|null, ...]) -> Promise<[{html, status}]>          (patch.asp)
 *   getSysex([formFields, ...])             -> Promise<[{bytes, strayText, ...}]> (get_sysex.asp)
 *
 * Browser-level pipelines (see browser-sim.js):
 *   loadPages(sysexList)     upload each .syx to patch.asp -> SimPage[]
 *   loadAndSave(sysexList)   upload, then press "Gimme that SysEx" -> bytes
 *   submitUserForm(list)     fresh page, user picks values, submit -> bytes
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { convertPage } = require('./asp2vbs');
const { SimPage } = require('./browser-sim');

// The original site's sources: MB_ASP_ROOT, else <repo>/old_asp_app, else the repo root.
const REPO_ROOT = path.resolve(__dirname, '../../..');
const ASP_ROOT = process.env.MB_ASP_ROOT ||
  [path.join(REPO_ROOT, 'old_asp_app'), REPO_ROOT].find((dir) => fs.existsSync(path.join(dir, 'sysex.inc'))) ||
  REPO_ROOT;
const HARNESS = path.join(__dirname, 'harness.vbs');
const WORKERS = Math.max(1, Math.min(8, Number(process.env.ORACLE_WORKERS) || os.cpus().length || 1));

const tmpRoot = () => process.env.ORACLE_TMP || os.tmpdir();

let _available;
function isAvailable() {
  if (_available !== undefined) return _available;
  _available = false;
  if (process.platform !== 'win32') return false;
  if (!fs.existsSync(path.join(ASP_ROOT, 'sysex.inc')) || !fs.existsSync(path.join(ASP_ROOT, 'patch.asp'))) return false;
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(tmpRoot(), 'mbchk-'));
    const f = path.join(dir, 't.vbs');
    fs.writeFileSync(f, 'WScript.Echo "ok"\r\n');
    _available = execFileSync('cscript', ['//nologo', f], { encoding: 'latin1' }).trim() === 'ok';
  } catch { _available = false; } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  return _available;
}

let _converted;
function converted() {
  if (_converted) return _converted;
  const patch = convertPage(path.join(ASP_ROOT, 'patch.asp'));
  const get = convertPage(path.join(ASP_ROOT, 'get_sysex.asp'));
  if (!patch.defs.includes(get.defs)) throw new Error('get_sysex.asp includes something patch.asp does not');
  _converted = { patch, get, fixes: [...new Set([...patch.fixes, ...get.fixes])] };
  return _converted;
}

const hex = (s) => Buffer.from(String(s), 'latin1').toString('hex');

/** Build a multipart/form-data body exactly as a browser posts the upload form. */
function multipartBody(fileBytes, filename = 'patch.syx') {
  const boundary = '----WebKitFormBoundaryMutantBrainOracle';
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n', 'latin1'),
    Buffer.from(fileBytes),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
  ]);
}

function runChunk(jobs) {
  const c = converted();
  const dir = fs.mkdtempSync(path.join(tmpRoot(), 'mboracle-'));
  const defsFile = path.join(dir, 'defs.vbs');
  fs.writeFileSync(defsFile, c.patch.defs, 'latin1'); // patch.asp includes sysex.inc + render.inc (superset)
  fs.writeFileSync(path.join(dir, 'patch.vbs'), c.patch.body, 'latin1');
  fs.writeFileSync(path.join(dir, 'get.vbs'), c.get.body, 'latin1');
  const lines = [`DEFS ${defsFile}`, `PAGE patch ${path.join(dir, 'patch.vbs')}`, `PAGE get ${path.join(dir, 'get.vbs')}`];
  jobs.forEach((job, i) => {
    lines.push(`JOB ${job.page} ${path.join(dir, `out${i}.txt`)}`);
    for (const [k, v] of Object.entries(job.form || {})) lines.push(`F ${hex(k)} ${hex(v)}`);
    for (const [k, v] of Object.entries(job.query || {})) lines.push(`Q ${hex(k)} ${hex(v)}`);
    if (job.body) lines.push(`B ${Buffer.from(job.body).toString('hex')}`);
    lines.push('RUN');
  });
  const jobsFile = path.join(dir, 'jobs.txt');
  fs.writeFileSync(jobsFile, lines.join('\r\n') + '\r\n', 'latin1');
  return new Promise((resolve, reject) => {
    execFile('cscript', ['//nologo', HARNESS, jobsFile], { encoding: 'latin1', maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
      try {
        if (err) throw new Error(`cscript failed: ${err.message}\n${stdout}\n${stderr}`);
        resolve(jobs.map((job, i) => parseOutput(fs.readFileSync(path.join(dir, `out${i}.txt`), 'latin1'))));
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

/** Run jobs [{page:'patch'|'get', form?, query?, body?}] across parallel cscript workers. */
async function runJobs(jobs) {
  if (!isAvailable()) throw new Error('ASP oracle unavailable (needs Windows cscript.exe and the original ASP sources)');
  if (!jobs.length) return [];
  const per = Math.ceil(jobs.length / WORKERS);
  const chunks = [];
  for (let i = 0; i < jobs.length; i += per) chunks.push(jobs.slice(i, i + per));
  return (await Promise.all(chunks.map(runChunk))).flat();
}

function parseOutput(txt) {
  const res = { chunks: [], headers: {}, status: null };
  let pos = 0;
  const dec = (h) => Buffer.from(h, 'hex');
  while (pos < txt.length) {
    let eol = txt.indexOf('\r\n', pos);
    if (eol === -1) eol = txt.length;
    const line = txt.slice(pos, eol);
    pos = eol + 2;
    if (!line) continue;
    const [tag, a = '', b = ''] = line.split(' ');
    if (tag === 'T') {
      const len = Number(a);
      res.chunks.push({ text: true, data: Buffer.from(txt.slice(pos, pos + len), 'latin1') });
      pos += len + 2;
    } else if (tag === 'B') res.chunks.push({ text: false, data: dec(a) });
    else if (tag === 'H') res.headers[dec(a).toString('latin1').toLowerCase()] = dec(b).toString('latin1');
    else if (tag === 'OK') res.status = 'OK';
    else if (tag === 'ERR') res.status = `ERR ${a} ${dec(b).toString('latin1')}`;
    else throw new Error(`unparseable oracle output line: ${line.slice(0, 80)}`);
  }
  if (!res.status) throw new Error('oracle output incomplete');
  return res;
}

/** patch.asp with an optional uploaded .syx (null = plain page visit). */
async function renderPatchPage(sysexList) {
  const jobs = sysexList.map((syx) => (syx == null
    ? { page: 'patch' }
    : { page: 'patch', query: { file: 'true' }, body: multipartBody(syx) }));
  return (await runJobs(jobs)).map((r) => ({
    status: r.status,
    html: Buffer.concat(r.chunks.map((c) => c.data)).toString('latin1'),
  }));
}

/**
 * get_sysex.asp for submitted form fields. `bytes` is the SysEx message (all
 * BinaryWrite output); `strayText` is the Response.Write text the .asp file
 * ALSO emits around the binary (literal whitespace outside its <% %>).
 */
async function getSysex(formList) {
  return (await runJobs(formList.map((form) => ({ page: 'get', form })))).map((r) => ({
    status: r.status,
    headers: r.headers,
    bytes: Buffer.concat(r.chunks.filter((c) => !c.text).map((c) => c.data)),
    strayText: Buffer.concat(r.chunks.filter((c) => c.text).map((c) => c.data)).toString('latin1'),
    raw: Buffer.concat(r.chunks.map((c) => c.data)),
  }));
}

function assertOk(r, what) {
  if (r.status !== 'OK') throw new Error(`${what}: original ASP raised a runtime error (${r.status})`);
  return r;
}

/**
 * Upload each .syx to patch.asp. Returns [{status, page}] where page is a
 * SimPage (null if the ASP crashed, i.e. IIS would have sent an HTTP 500).
 */
async function loadPagesRaw(sysexList) {
  return (await renderPatchPage(sysexList)).map((r) => ({
    status: r.status,
    page: r.status === 'OK' ? new SimPage(r.html) : null,
  }));
}

/** Upload each .syx to patch.asp and return the simulated pages (throws on a 500). */
async function loadPages(sysexList) {
  return (await renderPatchPage(sysexList)).map((r, i) => new SimPage(assertOk(r, `patch.asp #${i}`).html));
}

/** Upload -> rendered form -> "Gimme that SysEx" -> bytes, for each .syx. */
async function loadAndSave(sysexList) {
  const pages = await loadPages(sysexList);
  return (await getSysex(pages.map((p) => p.submission()))).map((r, i) => ({
    page: pages[i],
    ...assertOk(r, `get_sysex.asp #${i}`),
  }));
}

let _freshHtml;
async function freshPageHtml() {
  if (!_freshHtml) {
    const [fresh] = await renderPatchPage([null]);
    _freshHtml = assertOk(fresh, 'patch.asp (fresh)').html;
  }
  return _freshHtml;
}

/** Fresh page, user selects `values` (partial map), submit -> bytes. */
async function submitUserForm(valuesList) {
  const html = await freshPageHtml();
  const pages = valuesList.map((v) => { const p = new SimPage(html); p.setValues(v); return p; });
  return (await getSysex(pages.map((p) => p.submission()))).map((r, i) => ({
    page: pages[i],
    submission: pages[i].submission(),
    ...assertOk(r, `get_sysex.asp #${i}`),
  }));
}

module.exports = {
  isAvailable, renderPatchPage, getSysex, loadPages, loadPagesRaw, loadAndSave, submitUserForm, freshPageHtml,
  multipartBody, fixes: () => converted().fixes, ASP_ROOT, WORKERS,
};
