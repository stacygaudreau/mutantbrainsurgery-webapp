'use strict';
/**
 * Mutation testing: inject plausible bugs into the library source one at a
 * time, rebuild, and check that the test suites catch each one. Every source
 * file is restored afterwards (also on error).
 *
 * Usage: node tools/mutation-test.js   (the oracle column needs Windows)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const webapp = path.resolve(__dirname, '..');
const src = (file) => path.join(webapp, 'src/lib', file);

/** [description, file, original text, mutated text] */
const MUTANTS = [
  ['CV velocity: no VOLTS param', 'sysex.ts',
    '} else if (cv.inputEvent === CV_EVENT_VELOCITY) {\n      params.push(volts);', '} else if (cv.inputEvent === CV_EVENT_VELOCITY) {'],
  ['gate chan enable ignores MIDI note', 'form/rules.ts', "set(p, ['chan'], isCc || isNote);", "set(p, ['chan'], isCc);"],
  ['missing dur reads as DEFAULT', 'form/submit.ts',
    'return { durationType: DURATION.MS, duration: readNumber(name, raw) };',
    'return { durationType: DURATION.DEFAULT, duration: readNumber(name, raw) };'],
  ['maxNote options start at 0', 'form/options.ts', 'maxNote: freeze(numberRange(1, 127, noteLabel))', 'maxNote: freeze(numberRange(0, 127, noteLabel))'],
  ['disabled option still submitted', 'form/submit.ts', 'if (enabled[f.name] && !selected.disabled)', 'if (enabled[f.name])'],
  ['fixed-voltage CV range disabled', 'form/rules.ts', "['2', '4', '5', '20', '127']", "['2', '4', '5', '20']"],
  ['decoder ignores clock divider', 'sysex.ts', '      else if (isClockSource(value1)) gate.divider = value2;\n', ''],
  ['legacy header rejected', 'sysex.ts',
    'return sameBytes(id, MANUFACTURER_ID) || sameBytes(id, LEGACY_MANUFACTURER_ID);',
    'return sameBytes(id, MANUFACTURER_ID) || (false && sameBytes(id, LEGACY_MANUFACTURER_ID));'],
  ['label drops dagger', 'form/options.ts', '[26, `Trans. Start/Stop ${DAGGER}`]', "[26, 'Trans. Start/Stop']"],
  ['omni not rendered', 'form/display.ts', "  if (!isGlobal && item.chanType === CHAN.OMNI) return 'omni';\n", ''],
  ['gate cc default 1 (as upstream port)', 'model.ts', '    cc: 0,\n', '    cc: 1,\n'],
  ['scheme/transpose order swapped', 'sysex.ts',
    'params.push([block, PARAM.PITCH_SCHEME, 0, cv.pitchScheme], [block, PARAM.TRANSPOSE, 0, cv.transpose]);',
    'params.push([block, PARAM.TRANSPOSE, 0, cv.transpose], [block, PARAM.PITCH_SCHEME, 0, cv.pitchScheme]);'],
  // Editor API
  ['editor: changed items not frozen', 'editor/editor.ts',
    '  writeFieldValue(item, f, optionValue);\n  Object.freeze(item);', '  writeFieldValue(item, f, optionValue);'],
  ['editor: no-op set returns a new state', 'editor/editor.ts',
    '  if (shownFieldValue(state, f) === optionValue) return state;\n', ''],
  ['editor: "(gate)" mapped to retrig', 'editor/schema.ts', "if (optionValue === 'inf') return 'gate';", "if (optionValue === 'inf') return 'retrig';"],
  ['editor: reserved CC selectable', 'editor/editor.ts',
    'if (optionValue === null || !option || option.disabled)', 'if (optionValue === null || !option)'],
  ['editor: dagger left in labels', 'editor/schema.ts',
    'label: needsNewerFirmware ? o.label.slice(0, -DAGGER.length).trim() : o.label,', 'label: o.label,'],
  ['editor: toSysex skips the site rules', 'editor/editor.ts',
    'return toPatch(state).toSysex();', 'return new MutantBrainPatch(state).toSysex();'],
];

const run = (args) => spawnSync(process.execPath, args, {
  cwd: webapp, encoding: 'utf8', env: { ...process.env, ORACLE_FUZZ: '0.25' },
}).status === 0;
const build = () => run(['tools/build.mjs']);
const passes = (files) => run(['--test', ...files]);

const originals = new Map();
const rows = [];
try {
  for (const [name, file, from, to] of MUTANTS) {
    const fullPath = src(file);
    if (!originals.has(fullPath)) originals.set(fullPath, fs.readFileSync(fullPath, 'utf8'));
    const original = originals.get(fullPath).replace(/\r\n/g, '\n');
    if (!original.includes(from)) { rows.push([name, 'PATTERN NOT FOUND', '']); continue; }
    fs.writeFileSync(fullPath, original.replace(from, to));
    if (!build()) { rows.push([name, 'KILLED (build)', 'KILLED (build)']); }
    else {
      const unit = passes(['test/patches.test.js', 'test/codec.test.js', 'test/form.test.js', 'test/generated.test.js', 'test/editor.test.js']);
      const oracle = passes(['test/oracle.test.js']);
      rows.push([name, unit ? 'survived' : 'KILLED', oracle ? 'survived' : 'KILLED']);
    }
    fs.writeFileSync(fullPath, originals.get(fullPath));
  }
} finally {
  for (const [fullPath, text] of originals) fs.writeFileSync(fullPath, text);
  build();
}
console.log('mutant'.padEnd(40), 'unit tests'.padEnd(18), 'oracle tests');
for (const r of rows) console.log(r[0].padEnd(40), r[1].padEnd(18), r[2]);
const restored = [...originals].every(([p, t]) => fs.readFileSync(p, 'utf8') === t);
console.log('sources restored:', restored);
