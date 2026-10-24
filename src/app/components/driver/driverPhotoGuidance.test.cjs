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
const { completedPhotoGroup, getNextRequiredAction, getNextRequiredPhoto, getRequiredPhotoProgress } = moduleExports.exports;

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

test('each actionable stage guides to its first missing persisted photo', () => {
  assert.equal(getNextRequiredPhoto('pickup', {}), 'pickup_front');
  assert.equal(getNextRequiredPhoto('pickup', {
    pickup_front: { url: 'saved' }, pickup_right: { url: 'saved' },
  }), 'pickup_left');
  const pickupComplete = Object.fromEntries(keys.map(key => [key, { url: key }]));
  assert.equal(getNextRequiredPhoto('pickup', pickupComplete), 'loading_before');
  assert.equal(getNextRequiredPhoto('loading', {}), 'loading_after');
  assert.equal(getNextRequiredPhoto('pretrip', {}), 'pretrip_front');
  assert.equal(getNextRequiredPhoto('arrived', {}), 'unloading_before');
  assert.equal(getNextRequiredPhoto('unloading', {}), 'unloading_after');
  assert.equal(getNextRequiredPhoto('in_transit', {}), null);
  assert.equal(getNextRequiredPhoto('delivered', {}), null);
});

test('group-completion guidance runs only for the final newly saved slot', () => {
  const firstThree = Object.fromEntries(keys.slice(0, 3).map(key => [key, { url: key }]));
  assert.equal(completedPhotoGroup(keys, firstThree, 'pickup_rear'), true);
  assert.equal(completedPhotoGroup(keys, firstThree, 'pickup_front'), false);
  assert.equal(completedPhotoGroup(keys, { ...firstThree, pickup_rear: { url: 'saved' } }, 'pickup_rear'), false);
  assert.equal(completedPhotoGroup(keys, firstThree, 'loading_before'), false);
});

test('documents are guided only when delivery unlocks a genuinely missing upload', () => {
  const required = ['Proof of Delivery', 'Dispatch Slip'];
  const oneUploaded = [{ type: 'Proof of Delivery', uploaded: true }];
  assert.equal(getNextRequiredAction('unloading', {}, oneUploaded, required), 'unloading_after');
  assert.equal(getNextRequiredAction('in_transit', {}, oneUploaded, required), null);
  assert.equal(getNextRequiredAction('delivered', {}, oneUploaded, required), 'documents');
  assert.equal(getNextRequiredAction('delivered', {}, [
    ...oneUploaded, { type: 'Dispatch Slip', uploaded: true },
  ], required), null);
});
