const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'adminNavigation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);

test('workspace audit actions target the existing shipment, document, and summary views', () => {
  const { adminHref } = loaded.exports;
  assert.equal(adminHref('Monitor', { assignmentId: 'ASN73945', activityKey: 'cancelled' }),
    '/dispatch?assignment=ASN73945&activity=cancelled');
  assert.equal(adminHref('Documents', { assignmentId: 'ASN73945', docType: 'Proof of Delivery' }),
    '/documents?assignment=ASN73945&document=Proof+of+Delivery');
  assert.equal(adminHref('Deliveries', { assignmentId: 'ASN43090', summary: true }, 'completed'),
    '/deliveries?assignment=ASN43090&summary=true&tab=completed');
});
