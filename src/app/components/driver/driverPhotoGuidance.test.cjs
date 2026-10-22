const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'driverPhotoGuidance.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = { exports: {} };
new Function('module', 'exports', source)(moduleExports, moduleExports.exports);
const { getRequiredPhotoProgress } = moduleExports.exports;

const keys = ['pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear'];

test('pickup guidance starts at the first missing saved photo', () => {
  assert.deepEqual(getRequiredPhotoProgress(keys, {}), { captured: 0, total: 4, nextMissing: 'pickup_front' });
  assert.deepEqual(getRequiredPhotoProgress(keys, {
    pickup_front: { url: 'saved-front' }, pickup_left: { url: 'saved-left' },
  }), { captured: 2, total: 4, nextMissing: 'pickup_right' });
});

test('out-of-order captures and unsaved local photos never advance incorrectly', () => {
  assert.deepEqual(getRequiredPhotoProgress(keys, {
    pickup_rear: { url: 'saved-rear' }, pickup_front: { url: '' },
  }), { captured: 1, total: 4, nextMissing: 'pickup_front' });
  assert.deepEqual(getRequiredPhotoProgress(keys, Object.fromEntries(keys.map(key => [key, { url: key }]))),
    { captured: 4, total: 4, nextMissing: null });
});
