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
  assert.equal(adminHref('Deliveries', undefined, 'active', undefined, 'today'), '/deliveries?tab=active&view=today');
  assert.equal(adminHref('Deliveries', undefined, 'active', undefined, 'all'), '/deliveries?tab=active');
  assert.equal(adminHref('Deliveries', undefined, 'active', undefined, 'month'), '/deliveries?tab=active&period=month');
  assert.equal(adminHref('Deliveries', undefined, 'delayed', undefined, 'today'), '/deliveries?tab=delayed&period=today');
  assert.equal(adminHref('Monitor', { review: true }), '/dispatch?review=true');
});

test('shortcut, manual filters, legacy links, and other tabs restore the same visible period', () => {
  const { deliveriesRouteFromUrl } = loaded.exports;
  const route = (query) => deliveriesRouteFromUrl(new URL(`https://example.test/deliveries${query}`));
  assert.deepEqual(route('?tab=delayed'), { tab: 'delayed', period: 'all' });
  assert.deepEqual(route('?tab=active&view=delayed'), { tab: 'delayed', period: 'all' });
  assert.deepEqual(route('?tab=active&view=today'), { tab: 'active', period: 'today' });
  assert.deepEqual(route('?tab=active&period=today'), { tab: 'active', period: 'today' });
  assert.deepEqual(route('?tab=active'), { tab: 'active', period: 'all' });
  assert.deepEqual(route('?tab=active&period=month'), { tab: 'active', period: 'month' });
  assert.deepEqual(route('?tab=completed&period=today&assignment=ASN43090'), { tab: 'completed', period: 'today' });
  assert.deepEqual(route('?tab=cancelled'), { tab: 'cancelled', period: 'all' });
  assert.deepEqual(route('?tab=delayed&period=year'), { tab: 'delayed', period: 'year' });
});

test('Today, Show all active, and browser history keep URL and filter selection together', () => {
  const previousWindow = global.window;
  const visits = [];
  global.window = {
    location: new URL('https://example.test/dashboard'),
    history: {
      state: {},
      pushState(state, _title, href) {
        this.state = state;
        global.window.location = new URL(href, global.window.location);
        visits.push(global.window.location.href);
      },
    },
    dispatchEvent() {},
  };
  try {
    const { pushAdminNavigation, deliveriesRouteFromUrl } = loaded.exports;
    pushAdminNavigation('Deliveries', undefined, 'active', 'today');
    assert.equal(global.window.location.pathname + global.window.location.search, '/deliveries?tab=active&view=today');
    assert.deepEqual(deliveriesRouteFromUrl(global.window.location), { tab: 'active', period: 'today' });
    pushAdminNavigation('Deliveries', undefined, 'active', undefined, 'all');
    assert.equal(global.window.location.pathname + global.window.location.search, '/deliveries?tab=active');
    assert.deepEqual(deliveriesRouteFromUrl(global.window.location), { tab: 'active', period: 'all' });
    global.window.location = new URL(visits[0]); // Browser Back restores this URL.
    assert.deepEqual(deliveriesRouteFromUrl(global.window.location), { tab: 'active', period: 'today' });
  } finally {
    global.window = previousWindow;
  }
});
