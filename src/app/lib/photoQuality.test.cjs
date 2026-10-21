const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'photoQuality.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
const { assessImagePixels, hasVehicleDetection } = loaded.exports;

const pixels = (width, height, valueAt) => {
  const values = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    values[i] = values[i + 1] = values[i + 2] = valueAt(x, y);
    values[i + 3] = 255;
  }
  return values;
};

test('dark and uniformly blurred images fail before vehicle detection', () => {
  assert.equal(assessImagePixels(pixels(20, 20, () => 10), 20, 20), 'dark');
  assert.equal(assessImagePixels(pixels(20, 20, () => 120), 20, 20), 'blurry');
  assert.equal(assessImagePixels(pixels(20, 20, (x, y) => (x + y) % 2 ? 20 : 230), 20, 20), null);
});

test('small background vehicles and weak car detections do not pass', () => {
  assert.equal(hasVehicleDetection([{ class: 'truck', score: 0.9, bbox: [0, 0, 10, 10] }], 100, 100), false);
  assert.equal(hasVehicleDetection([{ class: 'car', score: 0.69, bbox: [0, 0, 60, 60] }], 100, 100), false);
  assert.equal(hasVehicleDetection([{ class: 'car', score: 0.9, bbox: [0, 0, 40, 40] }], 100, 100), false);
  assert.equal(hasVehicleDetection([{ class: 'person', score: 0.99, bbox: [0, 0, 100, 100] }], 100, 100), false);
});

test('large truck and bus detections pass; car requires stricter limits', () => {
  assert.equal(hasVehicleDetection([{ class: 'truck', score: 0.55, bbox: [0, 0, 40, 40] }], 100, 100), true);
  assert.equal(hasVehicleDetection([{ class: 'bus', score: 0.55, bbox: [0, 0, 40, 40] }], 100, 100), true);
  assert.equal(hasVehicleDetection([{ class: 'car', score: 0.70, bbox: [0, 0, 50, 50] }], 100, 100), true);
});
