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
const { getDeliveryTimingStatus, getPickupTimingStatus, getDispatchTimingNotices, getDashboardSchedule } = moduleForTest.exports;

test('Dashboard schedule uses the Manila day and the earliest future unstarted pickup', () => {
  const now = new Date('2026-10-25T23:00:00Z'); // Oct 26, 7 AM in Manila
  const item = (id, deliveryDate, pickedUpDate, pickupTime, extras = {}) => ({
    id, taskStatus: 'Assigned', deliveryDate, pickedUpDate, pickupTime, ...extras,
  });
  const schedule = getDashboardSchedule([
    item('later', 'Oct 26, 2026', 'Oct 26, 2026', '1:00 PM'),
    item('next', '2026-10-26', 'Oct 26, 2026', '10:30 AM'),
    item('past', 'Oct 26, 2026', 'Oct 26, 2026', '6:30 AM'),
    item('arrived', 'Oct 26, 2026', 'Oct 26, 2026', '8:00 AM', { operationalStage: 'pickup_arrived' }),
    item('cancelled', 'Oct 26, 2026', 'Oct 26, 2026', '9:00 AM', { taskStatus: 'Cancelled' }),
    item('tomorrow', 'Oct 27, 2026', 'Oct 27, 2026', '8:00 AM'),
  ], now);
  assert.equal(schedule.scheduledToday, 4);
  assert.equal(new Date(schedule.nextPickupAt).toISOString(), '2026-10-26T02:30:00.000Z');
  assert.deepEqual(getDashboardSchedule([item('past', 'Oct 26, 2026', 'Oct 26, 2026', '6:30 AM')], now), {
    scheduledToday: 1, nextPickupAt: null,
  });
});

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

test('REQ-002 server timestamps take precedence over older status-photo clocks', () => {
  const delivered = {
    ...assignment('Delivered', 'Oct 15, 2026', '2:00 PM', 'Oct 15, 2026, 01:00 PM'),
    unloadingCompletedAt: '2026-10-15T08:35:00Z',
  };
  assert.equal(getDeliveryTimingStatus(delivered)?.label, 'Delivered late · 2 hours');
  const pickedUp = {
    ...pickupAssignment('Picked Up', 'Oct 16, 2026, 12:30 AM'),
    departedAt: '2026-10-16T01:21:00Z',
  };
  assert.equal(getPickupTimingStatus(pickedUp)?.label, 'Picked up late · 8 hours 21 minutes');
});

test('cancelled, failed, future and invalid records do not warn', () => {
  const after = at('2026-10-20T00:00:00Z');
  assert.equal(getDeliveryTimingStatus(assignment('Cancelled'), after), null);
  assert.equal(getDeliveryTimingStatus(assignment('Failed / Issue'), after), null);
  assert.equal(getDeliveryTimingStatus(assignment('Assigned', 'Oct 30, 2026'), after), null);
  assert.equal(getDeliveryTimingStatus(assignment('Assigned', 'Feb 30, 2026'), after), null);
});

const pickupAssignment = (taskStatus, timestamp) => ({
  ...assignment(taskStatus, 'Oct 17, 2026', '2:00 PM'),
  pickedUpDate: 'Oct 16, 2026', pickupTime: '1:00 AM',
  statusPhotos: timestamp ? { 'Picked Up': { timestamp } } : {},
});

test('assigned pickup becomes overdue only after its scheduled Philippine time', () => {
  const item = pickupAssignment('Assigned');
  assert.equal(getPickupTimingStatus(item, at('2026-10-15T17:00:00Z')), null);
  assert.equal(getPickupTimingStatus(item, at('2026-10-15T17:45:00Z'))?.label, 'Pickup overdue · 45 minutes');
  assert.equal(getPickupTimingStatus(item, at('2026-10-15T20:00:00Z'))?.label, 'Pickup overdue · 3 hours');
  assert.match(getPickupTimingStatus(item, at('2026-10-15T20:00:00Z'))?.scheduledPickup ?? '', /Oct 16, 2026.*1:00 AM/);
});

test('photo evidence turns an active pickup warning into historical late timing', () => {
  const late = pickupAssignment('Picked Up', 'Oct 16, 2026, 09:21 AM');
  assert.equal(getPickupTimingStatus(late, at('2026-10-20T00:00:00Z'))?.label, 'Picked up late · 8 hours 21 minutes');
  assert.equal(getPickupTimingStatus({ ...late, taskStatus: 'In Transit' })?.kind, 'picked_up_late');
  assert.equal(getPickupTimingStatus({ ...late, taskStatus: 'Delivered' })?.kind, 'picked_up_late');
  assert.equal(getPickupTimingStatus(pickupAssignment('Picked Up', 'Oct 16, 2026, 12:59 AM')), null);
  assert.equal(getPickupTimingStatus(pickupAssignment('Picked Up')), null);
  assert.equal(getPickupTimingStatus(pickupAssignment('Cancelled', 'Oct 16, 2026, 09:21 AM')), null);
});

test('Dispatch prioritizes active delivery overdue over pickup overdue', () => {
  const item = { ...pickupAssignment('Assigned'), deliveryDate: 'Oct 16, 2026', eta: '2:00 AM' };
  const beforeDelivery = getDispatchTimingNotices(item, at('2026-10-15T17:30:00Z'));
  assert.equal(beforeDelivery.delivery, null);
  assert.equal(beforeDelivery.pickup?.kind, 'pickup_overdue');
  const afterDelivery = getDispatchTimingNotices(item, at('2026-10-15T19:00:00Z'));
  assert.equal(afterDelivery.delivery?.kind, 'overdue');
  assert.equal(afterDelivery.pickup, null);
});
