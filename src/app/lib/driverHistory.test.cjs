const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'driverHistory.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
const { cancelledHistoryForDriver } = loaded.exports;

const row = (id, driver_id, state, cancelled_at, extra = {}) => ({
  id, driver_id, state, cancelled_at, truck_plate: 'ABC 123', driver_name: 'Driver',
  company: 'Client', pickup_location: 'Pickup', delivery_location: 'Delivery',
  delivery_date: '2026-10-26', cancel_reason: 'Office rescheduled the delivery', ...extra,
});

test('only the signed-in driver’s cancelled rows enter cancelled history', () => {
  const history = cancelledHistoryForDriver([
    row('own-cancelled', 'driver-a', 'cancelled', '2026-10-26T02:00:00Z'),
    row('other-cancelled', 'driver-b', 'cancelled', '2026-10-26T03:00:00Z'),
    row('own-completed', 'driver-a', 'completed', null),
    row('own-active', 'driver-a', 'active', null),
  ], 'driver-a');
  assert.deepEqual(history.map((item) => item.id), ['own-cancelled']);
});

test('acknowledged cancellations remain in history with persisted detail', () => {
  const history = cancelledHistoryForDriver([
    row('acknowledged', 'driver-a', 'cancelled', '2026-10-25T10:30:00Z', {
      cancel_acknowledged_at: '2026-10-25T11:00:00Z',
    }),
  ], 'driver-a');
  assert.equal(history.length, 1);
  assert.equal(history[0].cancelReason, 'Office rescheduled the delivery');
  assert.equal(history[0].pickupLocation, 'Pickup');
  assert.equal(history[0].deliveryLocation, 'Delivery');
});

test('valid cancellation instants sort newest first; missing dates stay unavailable', () => {
  const history = cancelledHistoryForDriver([
    row('old', 'driver-a', 'cancelled', '2026-10-24T08:00:00Z'),
    row('unknown', 'driver-a', 'cancelled', null),
    row('new', 'driver-a', 'cancelled', '2026-10-26T08:00:00+08:00'),
  ], 'driver-a');
  assert.deepEqual(history.map((item) => item.id), ['new', 'old', 'unknown']);
  assert.equal(history[2].cancelledAt, null);
});
