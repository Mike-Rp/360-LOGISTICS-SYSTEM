const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'donutTooltipPosition.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { positionDonutTooltip } = moduleForTest.exports;

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const base = {
  chart: rect(310, 615, 502, 807),
  card: rect(282, 523, 898, 821),
  legend: rect(518, 615, 878, 790),
  tooltip: { width: 190, height: 82 },
  viewport: { width: 954, height: 1005 },
};

test('right-side hover avoids both the donut center and adjacent legend', () => {
  const result = positionDonutTooltip({ ...base, anchor: { x: 470, y: 685 } });
  assert.deepEqual(result, { left: 696, top: 523 });
});

test('left-side hover uses nearby free space when available', () => {
  const result = positionDonutTooltip({
    chart: rect(400, 240, 592, 432), card: rect(100, 150, 900, 470),
    legend: rect(650, 240, 880, 440), anchor: { x: 430, y: 310 },
    tooltip: { width: 150, height: 82 }, viewport: { width: 1024, height: 768 },
  });
  assert.deepEqual(result, { left: 240, top: 269 });
});

test('narrow screen places the detail above the chart within viewport margins', () => {
  const result = positionDonutTooltip({
    chart: rect(64, 420, 256, 612), card: rect(16, 340, 304, 900),
    legend: rect(16, 630, 304, 800), anchor: { x: 225, y: 475 },
    tooltip: { width: 190, height: 82 }, viewport: { width: 320, height: 900 },
  });
  assert.deepEqual(result, { left: 118, top: 328 });
  assert.ok(result.left + 190 <= 308);
  assert.ok(result.top + 82 < 420);
});
