const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'driverNotificationNavigation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
const { driverNotificationDestination: destination, canOpenDocumentReview } = loaded.exports;

test('dispatch and issue alerts open only their matching current assignment', () => {
  assert.equal(destination('driver_dispatched', 'ASN-1', 'ASN-1', [], []), 'task');
  assert.equal(destination('driver_issue_resolved', 'ASN-1', 'ASN-1', [], []), 'task');
  assert.equal(destination('driver_dispatched', 'ASN-2', 'ASN-1', [], []), 'unavailable');
});

test('historical alerts use the matching completed or cancelled row', () => {
  assert.equal(destination('driver_dispatched', 'ASN-2', 'ASN-1', ['ASN-2'], []), 'completed');
  assert.equal(destination('driver_cancelled', 'ASN-3', 'ASN-1', [], ['ASN-3']), 'cancelled');
  assert.equal(destination('driver_cancelled', 'ASN-1', 'ASN-1', [], []), 'unavailable');
});

test('missing and foreign assignment IDs cannot open another assignment', () => {
  assert.equal(destination('driver_dispatched', null, 'ASN-1', [], []), 'unavailable');
  assert.equal(destination('driver_issue_resolved', 'OTHER', 'ASN-1', ['ASN-2'], ['ASN-3']), 'unavailable');
});

test('review shortcuts focus only the exact reviewed document on the current assignment', () => {
  const docs = [
    { type: 'Proof of Delivery', uploaded: true, docStatus: 'rejected' },
    { type: 'Sales Invoice', uploaded: true, docStatus: 'approved' },
    { type: 'Dispatch Slip', uploaded: true, docStatus: 'pending' },
  ];
  assert.equal(canOpenDocumentReview('ASN-1', 'ASN-1', 'Proof of Delivery', docs), true);
  assert.equal(canOpenDocumentReview('ASN-1', 'ASN-1', 'Sales Invoice', docs), true);
  assert.equal(canOpenDocumentReview('ASN-1', 'ASN-2', 'Proof of Delivery', docs), false);
  assert.equal(canOpenDocumentReview('ASN-1', 'ASN-1', 'Dispatch Slip', docs), false);
  assert.equal(canOpenDocumentReview('ASN-1', 'ASN-1', 'Bill of Lading', docs), false);
});
