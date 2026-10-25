const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function load(name, imports = {}) {
  const source = ts.transpileModule(readFileSync(join(__dirname, name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((path) => imports[path], module, module.exports);
  return module.exports;
}

const operational = load('assignmentOperational.ts');
const display = load('displayDateTime.ts', { './assignmentOperational': operational });
const ordering = load('completedOrdering.ts');
const timing = load('assignmentTiming.ts');
const dates = load('deliveryDateColumn.ts', {
  './displayDateTime': display,
  './completedOrdering': ordering,
  './assignmentTiming': timing,
});

const assignment = (id, fields = {}) => ({ id, deliveryDate: 'Oct 31, 2026', ...fields });

test('each tab uses its own event date and labels the scheduled context', () => {
  const active = dates.deliveryDateColumn(assignment('active', { deliveryDate: 'Oct 25, 2026' }), 'active');
  assert.equal(dates.deliveryDateHeading('active'), 'Scheduled Delivery');
  assert.deepEqual(active, { date: 'Oct 25, 2026', time: null, scheduled: null });
  assert.equal(dates.deliveryDateHeading('delayed'), 'Scheduled Delivery');
  assert.deepEqual(dates.deliveryDateColumn(assignment('late', { deliveryDate: 'Oct 25, 2026' }), 'delayed'), active);

  const done = dates.deliveryDateColumn(assignment('done', {
    completedAt: 'Oct 20, 04:09 PM', completedEventAt: '2026-10-20T08:09:00Z',
  }), 'completed');
  assert.equal(dates.deliveryDateHeading('completed'), 'Completed Date');
  assert.deepEqual(done, { date: 'Oct 20, 2026', time: '4:09 PM', scheduled: 'Oct 31, 2026' });

  const cancelled = dates.deliveryDateColumn(assignment('cancelled', {
    cancelledAt: '2026-10-21T10:24:00Z',
  }), 'cancelled');
  assert.equal(dates.deliveryDateHeading('cancelled'), 'Cancelled Date');
  assert.deepEqual(cancelled, { date: 'Oct 21, 2026', time: '6:24 PM', scheduled: 'Oct 31, 2026' });
});

test('missing or yearless event timestamps never become scheduled or guessed dates', () => {
  assert.equal(dates.deliveryDateColumn(assignment('done', { completedAt: 'Oct 20, 04:09 PM' }), 'completed').date, '—');
  assert.equal(dates.deliveryDateColumn(assignment('cancelled'), 'cancelled').date, '—');
  assert.equal(dates.matchesDeliveryPeriod(assignment('done', { completedAt: 'Oct 20, 04:09 PM' }), 'completed', 'month', new Date('2026-10-22T00:00:00Z')), false);
});

test('Manila date filters follow the visible date, including the midnight boundary', () => {
  const now = new Date('2026-10-21T16:30:00Z'); // Oct 22 in Manila
  assert.equal(dates.matchesDeliveryPeriod(assignment('active', { deliveryDate: 'Oct 22, 2026' }), 'active', 'today', now), true);
  assert.equal(dates.matchesDeliveryPeriod(assignment('active', { deliveryDate: '10/22/2026' }), 'active', 'today', now), true);
  assert.equal(dates.matchesDeliveryPeriod(assignment('late', { deliveryDate: 'Oct 22, 2026' }), 'delayed', 'today', now), true);
  assert.equal(dates.matchesDeliveryPeriod(assignment('active', { deliveryDate: 'Oct 21, 2026' }), 'active', 'today', now), false);
  assert.equal(dates.matchesDeliveryPeriod(assignment('done', { completedAt: '', completedEventAt: '2026-10-21T16:09:00Z' }), 'completed', 'today', now), true);
  assert.equal(dates.matchesDeliveryPeriod(assignment('cancelled', { cancelledAt: '2026-10-21T15:59:00Z' }), 'cancelled', 'today', now), false);
});

test('cancelled deliveries sort by cancellation audit time with undated history last', () => {
  const rows = [
    assignment('old', { cancelledAt: '2026-10-20T08:00:00Z' }),
    assignment('missing'),
    assignment('new', { cancelledAt: '2026-10-21T08:00:00Z' }),
  ];
  assert.deepEqual(dates.sortCancelledNewestFirst(rows).map((row) => row.id), ['new', 'old', 'missing']);
});
