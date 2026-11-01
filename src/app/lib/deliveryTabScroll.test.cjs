const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'deliveryTabScroll.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', code)(loaded, loaded.exports);
const { revealSelectedDeliveryTab } = loaded.exports;

test('reveals an off-screen selected tab using only the tab strip', () => {
  const calls = [];
  let item = { left: 260, right: 360 };
  const strip = { querySelector: () => ({ getBoundingClientRect: () => item }), getBoundingClientRect: () => ({ left: 20, right: 300 }), scrollBy: value => calls.push(value) };
  revealSelectedDeliveryTab(strip);
  assert.deepEqual(calls, [{ left: 60, behavior: 'auto' }]);
  item = { left: -15, right: 80 }; revealSelectedDeliveryTab(strip);
  assert.deepEqual(calls[1], { left: -35, behavior: 'auto' });
  item = { left: 25, right: 120 }; revealSelectedDeliveryTab(strip);
  assert.equal(calls.length, 2);
  strip.querySelector = () => null; revealSelectedDeliveryTab(strip); revealSelectedDeliveryTab(null);
  assert.equal(calls.length, 2);
});
