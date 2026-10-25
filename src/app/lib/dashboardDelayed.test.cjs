const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function load(name, imports = {}) {
  const source = ts.transpileModule(readFileSync(join(__dirname, name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', source)((path) => imports[path], loaded, loaded.exports);
  return loaded.exports;
}
const timing = load('assignmentTiming.ts');
const { isDashboardDelayedAssignment } = load('dashboardDelayed.ts', { './assignmentTiming': timing });

const now = new Date('2026-10-26T02:00:00Z'); // Oct 26, 10 AM Manila
const assignment = (fields = {}) => ({
  taskStatus: 'Assigned', deliveryDate: 'Oct 27, 2026', eta: '5:00 PM',
  pickedUpDate: 'Oct 26, 2026', pickupTime: '9:00 AM',
  delayReports: [], statusPhotos: {}, ...fields,
});

test('unresolved pickup and delivery deadlines qualify; a report alone does not', () => {
  const report = [{ type: 'pickup', reason: 'Traffic', reportedAt: 'Oct 26, 2026, 9:05 AM' }];
  assert.equal(isDashboardDelayedAssignment(assignment(), now), true);
  assert.equal(isDashboardDelayedAssignment(assignment({ delayReports: report }), now), true);
  const arrived = assignment({ delayReports: report, pickupArrivedAt: 'Oct 26, 2026, 9:10 AM', operationalStage: 'pickup_arrived' });
  assert.equal(timing.getPickupTimingStatus(arrived, now)?.kind, 'picked_up_late');
  assert.equal(isDashboardDelayedAssignment(arrived, now), false);
  assert.equal(isDashboardDelayedAssignment(assignment({ taskStatus: 'In Transit', deliveryDate: 'Oct 25, 2026' }), now), true);
  assert.equal(isDashboardDelayedAssignment(assignment({ taskStatus: 'Assigned', pickedUpDate: 'Oct 27, 2026' }), now), false);
});

test('completed, physically delivered, and cancelled assignments are excluded', () => {
  for (const taskStatus of ['Delivered', 'Cancelled', 'Failed / Issue']) {
    assert.equal(isDashboardDelayedAssignment(assignment({ taskStatus, deliveryDate: 'Oct 25, 2026' }), now), false);
  }
});

test('Dashboard count and Delayed tab filtering use the same predicate', () => {
  const rows = [assignment(), assignment({ pickupArrivedAt: 'Oct 26, 2026, 9:10 AM' }),
    assignment({ taskStatus: 'In Transit', deliveryDate: 'Oct 25, 2026' })];
  const dashboardCount = rows.filter((row) => isDashboardDelayedAssignment(row, now)).length;
  const delayedTabRows = rows.filter((row) => isDashboardDelayedAssignment(row, now));
  assert.equal(dashboardCount, delayedTabRows.length);
  assert.equal(delayedTabRows.length, 2);
});
