const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const load = (name) => {
  const source = ts.transpileModule(readFileSync(join(__dirname, name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
  return loaded.exports;
};

const { driverHelpGuides, searchDriverHelpGuides } = load('driverHelpGuides.ts');

test('English and Filipino have the same driver-only guides with actionable steps', () => {
  const en = driverHelpGuides('en');
  const fil = driverHelpGuides('fil');
  assert.deepEqual(en.map((guide) => guide.id), fil.map((guide) => guide.id));
  assert.equal(en.length, 8);
  for (const guide of [...en, ...fil]) {
    assert.ok(guide.title && guide.category && guide.steps.length >= 3);
    assert.ok(guide.steps.every((step) => step.length > 10));
    assert.doesNotMatch(`${guide.title} ${guide.steps.join(' ')}`, /register (a )?(driver|truck)|workspace settings|dispatch assignment/i);
  }
});

test('search matches driver titles, keywords and steps in the selected language', () => {
  assert.deepEqual(searchDriverHelpGuides('en', '  DOCUMENT  ').map((guide) => guide.id).includes('documents'), true);
  assert.deepEqual(searchDriverHelpGuides('en', 'pin').map((guide) => guide.id), ['account']);
  assert.deepEqual(searchDriverHelpGuides('fil', 'pagkaantala').map((guide) => guide.id), ['delays']);
  assert.deepEqual(searchDriverHelpGuides('fil', 'walang-match'), []);
  assert.equal(searchDriverHelpGuides('en', '').length, driverHelpGuides('en').length);
});

test('Driver Menu opens help in the existing drawer without changing the current screen', () => {
  const source = readFileSync(join(__dirname, 'DriverInterface.tsx'), 'utf8');
  assert.match(source, /onClick=\{\(\) => setActiveDrawer\('help'\)\}/);
  assert.match(source, /activeDrawer === 'help'[\s\S]*?<DriverHelpContent \/>/);
  assert.doesNotMatch(source.match(/activeDrawer === 'help'[\s\S]*?<DriverHelpContent \/>/)[0], /setScreen\(/);
});
