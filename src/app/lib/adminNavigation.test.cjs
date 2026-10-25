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
  assert.equal(adminHref('Deliveries', undefined, 'completed'), '/deliveries?tab=completed');
});

test('a newly dispatched card uses the existing assignment route with focus-only intent', () => {
  assert.equal(loaded.exports.adminHref('Monitor', { assignmentId: 'ASN21630', focusOnly: true }),
    '/dispatch?assignment=ASN21630&focus=true');
});

test('Dashboard actions point to explicit Deliveries tabs and scoped active views', () => {
  const { adminHref } = loaded.exports;
  assert.equal(adminHref('Deliveries', undefined, 'active'), '/deliveries?tab=active');
  assert.equal(adminHref('Deliveries', undefined, 'completed'), '/deliveries?tab=completed');
  assert.equal(adminHref('Deliveries', undefined, 'delayed'), '/deliveries?tab=delayed');
  assert.equal(adminHref('Deliveries', undefined, 'active', 'today'), '/deliveries?tab=active&view=today');
  assert.equal(adminHref('Monitor', { review: true }), '/dispatch?review=true');
});

test('canonical, legacy, Today, completed, and cancelled URLs select the correct tab', () => {
  const { deliveriesRouteFromUrl } = loaded.exports;
  const route = (query) => deliveriesRouteFromUrl(new URL(`https://example.test/deliveries${query}`));
  assert.deepEqual(route('?tab=delayed'), { tab: 'delayed', view: null });
  assert.deepEqual(route('?tab=active&view=delayed'), { tab: 'delayed', view: null });
  assert.deepEqual(route('?tab=active&view=today'), { tab: 'active', view: 'today' });
  assert.deepEqual(route('?tab=completed&assignment=ASN43090'), { tab: 'completed', view: null });
  assert.deepEqual(route('?tab=cancelled'), { tab: 'cancelled', view: null });
});
