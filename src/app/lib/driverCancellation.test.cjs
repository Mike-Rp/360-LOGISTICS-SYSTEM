const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'driverCancellation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
const { unacknowledgedDriverCancellations, afterCancellationAcknowledged } = loaded.exports;

test('only this driver’s unacknowledged cancelled assignments appear', () => {
  const rows = [
    { id: 'A', driver_id: 'driver-a', state: 'cancelled', cancel_reason: 'Route changed', cancelled_at: '2026-10-23T12:00:00Z' },
    { id: 'B', driver_id: 'driver-b', state: 'cancelled', cancel_reason: 'Private reason' },
    { id: 'C', driver_id: 'driver-a', state: 'active' },
    { id: 'D', driver_id: 'driver-a', state: 'cancelled', cancel_acknowledged_at: '2026-10-23T13:00:00Z' },
  ];
  assert.deepEqual(unacknowledgedDriverCancellations(rows, 'driver-a'), [
    { id: 'A', reason: 'Route changed', cancelledAt: '2026-10-23T12:00:00Z' },
  ]);
  assert.deepEqual(unacknowledgedDriverCancellations(rows, 'driver-b'), [
    { id: 'B', reason: 'Private reason', cancelledAt: null },
  ]);
});

test('multiple outstanding notices remain deterministic and retain real missing values', () => {
  const rows = [
    { id: 'new', driver_id: 'd', state: 'cancelled', cancelled_at: '2026-10-23T12:00:00Z' },
    { id: 'old', driver_id: 'd', state: 'cancelled', cancelled_at: '2026-10-22T12:00:00Z', cancel_reason: 'Customer request' },
  ];
  assert.deepEqual(unacknowledgedDriverCancellations(rows, 'd').map((notice) => notice.id), ['old', 'new']);
  rows[1].cancel_acknowledged_at = '2026-10-23T13:00:00Z';
  assert.deepEqual(unacknowledgedDriverCancellations(rows, 'd'), [
    { id: 'new', reason: null, cancelledAt: '2026-10-23T12:00:00Z' },
  ]);
});

test('acknowledgment removes only the saved notice after persistence succeeds', async () => {
  const notices = [{ id: 'first' }, { id: 'second' }];
  let writeCompleted = false;
  const result = await afterCancellationAcknowledged(notices, 'first', async () => {
    await Promise.resolve();
    writeCompleted = true;
  });
  assert.equal(writeCompleted, true);
  assert.deepEqual(result, [{ id: 'second' }]);
  assert.equal(notices.length, 2);
});

test('failed acknowledgment leaves the original notice available on the next load', async () => {
  const notices = unacknowledgedDriverCancellations([
    { id: 'still-here', driver_id: 'd', state: 'cancelled', cancel_reason: 'Rescheduled' },
  ], 'd');
  await assert.rejects(afterCancellationAcknowledged(notices, 'still-here', async () => {
    throw new Error('RLS denied');
  }), /RLS denied/);
  assert.equal(notices[0].id, 'still-here');
});
