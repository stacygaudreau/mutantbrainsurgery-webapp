'use strict';
// Mutation testing: inject plausible bugs into the library one at a time and check
// the test suites catch each one; the library file is always restored.
// Usage: node tools/mutation-test.js   (oracle column needs Windows)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const webapp = path.resolve(__dirname, '..');
const lib = path.join(webapp, 'public/lib/mutantbrain-sysex.js');
const original = fs.readFileSync(lib, 'utf8');

const mutants = [
  ['CV velocity: no VOLTS param', '            out.push([id, PARAM.VOLTS, 0, c.volts]);\n          }', '          }'],
  ['gate chan enable ignores MIDI note', "en[p + 'chan'] = eCc || eNote;", "en[p + 'chan'] = eCc;"],
  ['missing dur reads as DEFAULT', 'else { o.durationType = DURATION.MS; o.duration = readNumber', 'else { o.durationType = DURATION.DEFAULT; o.duration = readNumber'],
  ['maxNote options start at 0', 'o.maxNote = range(1, 127, noteLabel)', 'o.maxNote = range(0, 127, noteLabel)'],
  ['disabled option still submitted', 'if (en[f.name] && !option.disabled) out[f.name] = val;', 'if (en[f.name]) out[f.name] = val;'],
  ['fixed-voltage CV range disabled', "val === '20' || val === '127' ||", "val === '20' ||"],
  ['decoder ignores clock divider', 'else if (v1 === SOURCE.MIDI_TICK || v1 === SOURCE.MIDI_TICK_RUN) o.divider = v2;', ''],
  ['legacy header rejected', '(b[3] !== MANUFACTURER_ID[2] && b[3] !== LEGACY_MANUFACTURER_ID[2])', 'b[3] !== MANUFACTURER_ID[2]'],
  ['label drops dagger', "'Trans. Start/Stop \\u2020'", "'Trans. Start/Stop'"],
  ['omni not rendered', "if (includeDefault && o.chanType === CHAN.OMNI) return 'omni';", ''],
  ['gate cc default 1 (as upstream port)', 'minNote: 0, maxNote: 127, minVel: 0, cc: 0, threshold: 64', 'minNote: 0, maxNote: 127, minVel: 0, cc: 1, threshold: 64'],
  ['scheme/transpose order swapped', "out.push([id, PARAM.PITCH_SCHEME, 0, c.pitchScheme]);\n            out.push([id, PARAM.TRANSPOSE, 0, c.transpose]);", "out.push([id, PARAM.TRANSPOSE, 0, c.transpose]);\n            out.push([id, PARAM.PITCH_SCHEME, 0, c.pitchScheme]);"],
];

const run = (files) => spawnSync(process.execPath, ['--test', ...files], {
  cwd: webapp, encoding: 'utf8', env: { ...process.env, ORACLE_FUZZ: '0.25' },
}).status === 0;

const rows = [];
try {
  for (const [name, from, to] of mutants) {
    const src = original.replace(/\r\n/g, '\n');
    if (!src.includes(from)) { rows.push([name, 'PATTERN NOT FOUND', '']); continue; }
    fs.writeFileSync(lib, src.replace(from, to));
    const unit = run(['test/patches.test.js', 'test/codec.test.js', 'test/form.test.js']);
    const orc = run(['test/oracle.test.js']);
    rows.push([name, unit ? 'survived' : 'KILLED', orc ? 'survived' : 'KILLED']);
  }
} finally {
  fs.writeFileSync(lib, original);
}
console.log('mutant'.padEnd(40), 'unit tests'.padEnd(12), 'oracle tests');
for (const r of rows) console.log(r[0].padEnd(40), r[1].padEnd(12), r[2]);
console.log('restored:', fs.readFileSync(lib, 'utf8') === original);
