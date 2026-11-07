'use strict';
/**
 * Checks on the build output (npm test builds first):
 *  - the website bundle only uses ES2017 syntax, so widely supported browsers run it
 *  - the ESM and CommonJS library builds expose the same API, with type declarations
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/** Syntax newer than ES2017 that an older browser would fail to parse. */
function findPostEs2017Syntax(code) {
  const source = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = new Set();
  const visit = (node) => {
    const k = ts.SyntaxKind;
    if (node.flags & ts.NodeFlags.OptionalChain) found.add('optional chaining ?. (ES2020)');
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === k.QuestionQuestionToken) found.add('nullish coalescing ?? (ES2020)');
      if (op === k.QuestionQuestionEqualsToken || op === k.BarBarEqualsToken || op === k.AmpersandAmpersandEqualsToken) {
        found.add('logical assignment (ES2021)');
      }
    }
    if (ts.isSpreadAssignment(node)) found.add('object spread {...x} (ES2018)');
    if (ts.isObjectBindingPattern(node) && node.elements.some((e) => e.dotDotDotToken)) found.add('object rest (ES2018)');
    if (ts.isCatchClause(node) && !node.variableDeclaration) found.add('optional catch binding (ES2019)');
    if (ts.isPrivateIdentifier(node)) found.add('private #fields (ES2022)');
    if (ts.isPropertyDeclaration(node)) found.add('class fields (ES2022)');
    if (ts.isClassStaticBlockDeclaration(node)) found.add('static blocks (ES2022)');
    if (node.kind === k.BigIntLiteral) found.add('BigInt literal (ES2020)');
    if (ts.isForOfStatement(node) && node.awaitModifier) found.add('for await (ES2018)');
    if (ts.isFunctionLike(node) && node.asteriskToken && node.modifiers && node.modifiers.some((m) => m.kind === k.AsyncKeyword)) {
      found.add('async generators (ES2018)');
    }
    if (ts.isNumericLiteral(node) && node.getText(source).includes('_')) found.add('numeric separators (ES2021)');
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
}

test('the syntax checker itself detects newer syntax', () => {
  assert.deepEqual(findPostEs2017Syntax('a?.b; x ?? y; ({...o}); class A { #p = 1 }').sort(), [
    'class fields (ES2022)', 'nullish coalescing ?? (ES2020)', 'object spread {...x} (ES2018)',
    'optional chaining ?. (ES2020)', 'private #fields (ES2022)',
  ]);
  assert.deepEqual(findPostEs2017Syntax('const f = async () => { for (const x of [1]) await x; }; class B { m() {} }'), []);
});

test('website bundle (dist/app.js) only uses ES2017 syntax', () => {
  assert.deepEqual(findPostEs2017Syntax(read('dist/app.js')), []);
});

test('website bundle is self-contained: one script, plus static assets', () => {
  const html = read('dist/index.html');
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ['app.js']);
  for (const f of [
    'index.html', 'style.css', 'app.js', 'img/mutantbrain-black.png', 'img/mutantbrain-black.webp',
    'img/hexinverter-logo.svg', 'img/starfield.svg', 'fonts/noyh_black-webfont.woff2',
  ]) {
    assert.ok(fs.existsSync(path.join(root, 'dist', f)), `dist/${f}`);
  }
  assert.match(read('dist/app.js'), /^\/\*! Mutant Brain Surgery \| CC BY-NC-SA 4\.0/);
});

test('library builds: ESM and CommonJS export the same API, with type declarations', async () => {
  const cjs = require('../build/lib/index.cjs');
  const esm = await import('../build/lib/index.mjs');
  const keys = (m) => Object.keys(m).filter((k) => k !== 'default' && k !== '__esModule').sort();
  assert.deepEqual(keys(esm), keys(cjs));
  for (const name of ['MutantBrainPatch', 'MutantBrainError', 'Form', 'SOURCE', 'PARAM', 'BLOCK', 'CHAN', 'DURATION']) {
    assert.ok(keys(cjs).includes(name), `exports ${name}`);
  }
  const bytes = new esm.MutantBrainPatch().toSysex();
  assert.deepEqual([...cjs.MutantBrainPatch.fromSysex(bytes).toSysex()], [...bytes], 'both builds agree');
  assert.match(read('build/lib/types/index.d.ts'), /export \{ MutantBrainPatch \}/);
  assert.match(read('build/lib/types/MutantBrainPatch.d.ts'), /static fromSysex\(data: ByteInput\): MutantBrainPatch;/);
});

test('public API types: valid usage compiles and misuse does not (test/types)', () => {
  const tsc = require.resolve('typescript/bin/tsc');
  const res = require('child_process').spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.test-types.json')], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const expectations = (read('test/types/editor-types.ts').match(/@ts-expect-error/g) || []).length;
  assert.ok(expectations >= 10, `has compile-time misuse checks (${expectations})`);
});

test('library build only uses ES2017 syntax too', () => {
  assert.deepEqual(findPostEs2017Syntax(read('build/lib/index.cjs')), []);
});
