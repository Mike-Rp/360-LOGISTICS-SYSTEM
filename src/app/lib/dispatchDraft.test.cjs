const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'dispatchDraft.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', source)(moduleUnderTest, moduleUnderTest.exports);
const { hasUnsavedDispatchDetails } = moduleUnderTest.exports;

const emptyDraft = () => ({
  driverId: '', truckId: '', originArea: '', pickupLocation: '', destinationArea: '',
  deliveryLocation: '', company: '', pickupDate: '', deliveryDate: '', pickupTime: '',
  eta: '', remarks: '', pickupDateInvalid: false, deliveryDateInvalid: false,
});

test('opening an empty dispatch form needs no discard confirmation', () => {
  assert.equal(hasUnsavedDispatchDetails(emptyDraft()), false);
});

test('every editable field, including both schedule steps, protects the draft', () => {
  for (const field of Object.keys(emptyDraft())) {
    const draft = emptyDraft();
    draft[field] = field.endsWith('Invalid') ? true : 'entered value';
    assert.equal(hasUnsavedDispatchDetails(draft), true, field);
  }
});

test('restoring edited fields to their initial values clears dirty state', () => {
  const draft = emptyDraft();
  draft.driverId = 'driver-1';
  draft.pickupDate = '2026-10-24';
  assert.equal(hasUnsavedDispatchDetails(draft), true);
  draft.driverId = '';
  draft.pickupDate = '';
  assert.equal(hasUnsavedDispatchDetails(draft), false);
});
