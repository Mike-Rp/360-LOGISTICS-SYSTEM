const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = readFileSync(join(__dirname, 'mainModuleScroll.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports);
const { moveMainModuleScroll } = loaded.exports;

test('each different sidebar module starts at the top without smooth scrolling', () => {
  const main = { scrollTop: 740 };
  const positions = new Map();
  for (const [from, to] of [
    ['Dashboard', 'Monitor'], ['Monitor', 'Deliveries'],
    ['Deliveries', 'Reports'], ['Reports', 'Accounts'],
  ]) {
    moveMainModuleScroll(main, from, to, positions, false);
    assert.equal(main.scrollTop, 0, `${to} should open at the top`);
    main.scrollTop = 400;
  }
  assert.equal(positions.get('Dashboard'), 740);
  assert.equal(positions.get('Reports'), 400);
});

test('same-module actions do not change scroll, and history restores the prior module', () => {
  const main = { scrollTop: 500 };
  const positions = new Map();
  moveMainModuleScroll(main, 'Dashboard', 'Dashboard', positions, false);
  assert.equal(main.scrollTop, 500);
  assert.equal(positions.size, 0);

  moveMainModuleScroll(main, 'Dashboard', 'Reports', positions, false);
  main.scrollTop = 260;
  moveMainModuleScroll(main, 'Reports', 'Dashboard', positions, true);
  assert.equal(main.scrollTop, 500);
  moveMainModuleScroll(main, 'Dashboard', 'Reports', positions, true);
  assert.equal(main.scrollTop, 260);
  moveMainModuleScroll(main, 'Reports', 'Dashboard', positions, false);
  assert.equal(main.scrollTop, 0, 'a fresh sidebar visit starts at the top');
});

test('a long page keeps its captured position even if new content clamps the scroll container', () => {
  const main = { scrollTop: 0 };
  const positions = new Map();
  moveMainModuleScroll(main, 'Dashboard', 'Reports', positions, false, 900);
  assert.equal(positions.get('Dashboard'), 900);
  moveMainModuleScroll(main, 'Reports', 'Dashboard', positions, true);
  assert.equal(main.scrollTop, 900);
});

test('staff shell applies the helper to its actual main scroller only when the module changes', () => {
  const shell = readFileSync(join(__dirname, '../components/admin/AdminDashboard.tsx'), 'utf8');
  assert.match(shell, /<main ref=\{mainRef\}/);
  assert.match(shell, /if \(previous !== activeNav && mainRef\.current\)/);
  assert.match(shell, /window\.addEventListener\('popstate', onModuleNavigation\)/);
  assert.doesNotMatch(shell, /window\.scrollTo\(/);
});
