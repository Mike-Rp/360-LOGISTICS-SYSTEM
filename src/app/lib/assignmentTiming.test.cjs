const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'assignmentTiming.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { getDeliveryTimingStatus } = moduleForTest.exports;

const assignment = (taskStatus, deliveryDate = 'Oct 15, 2026', eta = '2:00 PM', timestamp) => ({
  taskStatus, deliveryDate, eta,
  statusPhotos: timestamp ? { Delivered: { timestamp } } : {},
});
const at = iso => new Date(iso);

test('active workflow statuses warn only after the ETA in Philippine time', () => {
  for (const status of ['Assigned', 'Picked Up', 'In Transit']) {
    assert.equal(getDeliveryTimingStatus(assignment(status), at('2026-10-15T06:00:00Z')), null);
    assert.equal(getDeliveryTimingStatus(assignment(status), at('2026-10-15T08:10:00Z')).label, 'Overdue · 2 hours');
    assert.deepEqual(getDeliveryTimingStatus(assignment(status), at('2026-10-15T08:10:00Z')).duration, { value: 2, unit: 'hour' });
  }
});

test('date-only schedules stay on time through their calendar day', () => {
  const item = assignment('Assigned', 'Oct 15, 2026', '');
  assert.equal(getDeliveryTimingStatus(item, at('2026-10-15T15:59:59Z')), null);
  assert.equal(getDeliveryTimingStatus(item, at('2026-10-15T16:00:00Z')).label, 'Overdue · 1 day');
  assert.deepEqual(getDeliveryTimingStatus(item, at('2026-10-15T16:00:00Z')).duration, { value: 1, unit: 'day' });
  assert.equal(getDeliveryTimingStatus(item, at('2026-10-16T16:00:00Z')).label, 'Overdue · 2 days');
});

test('delivered evidence determines historical lateness, not document completion', () => {
  const late = assignment('Delivered', 'Oct 15, 2026', '2:00 PM', 'Oct 15, 2026, 04:35 PM');
  assert.deepEqual(getDeliveryTimingStatus(late, at('2026-10-20T00:00:00Z'))?.kind, 'delivered_late');
  assert.equal(getDeliveryTimingStatus(late)?.label, 'Delivered late · 2 hours');
  assert.equal(getDeliveryTimingStatus(assignment('Delivered', 'Oct 15, 2026', '2:00 PM', 'Oct 15, 2026, 01:30 PM')), null);
  assert.equal(getDeliveryTimingStatus(assignment('Delivered')), null); // Historical record without a physical delivery timestamp.
  assert.equal(getDeliveryTimingStatus(assignment('Delivered', 'Oct 15, 2026', '', 'Oct 15, 2026, 11:59 PM')), null);
  assert.equal(getDeliveryTimingStatus(assignment('Delivered', 'Oct 15, 2026', '', 'Oct 16, 2026, 12:01 AM'))?.label, 'Delivered late · 1 day');
});

test('cancelled, failed, future and invalid records do not warn', () => {
  const after = at('2026-10-20T00:00:00Z');
  assert.equal(getDeliveryTimingStatus(assignment('Cancelled'), after), null);
  assert.equal(getDeliveryTimingStatus(assignment('Failed / Issue'), after), null);
  assert.equal(getDeliveryTimingStatus(assignment('Assigned', 'Oct 30, 2026'), after), null);
  assert.equal(getDeliveryTimingStatus(assignment('Assigned', 'Feb 30, 2026'), after), null);
});
