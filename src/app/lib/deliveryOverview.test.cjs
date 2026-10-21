const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function loadTypeScript(file, resolve = require) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(resolve, module, module.exports);
  return module.exports;
}

const colors = loadTypeScript(join(__dirname, '../data/statusColors.ts'));
const data = loadTypeScript(join(__dirname, '../data/assignmentTypes.ts'), id => {
  assert.equal(id, './statusColors');
  return colors;
});
const timing = loadTypeScript(join(__dirname, 'assignmentTiming.ts'));
const workflow = loadTypeScript(join(__dirname, 'assignmentWorkflow.ts'), id => {
  if (id === './assignmentTiming') return timing;
  if (id === '../data/statusColors') return colors;
  assert.equal(id, '../data/assignmentTypes');
  return data;
});
const ordering = loadTypeScript(join(__dirname, 'recordOrdering.ts'));
const overview = loadTypeScript(join(__dirname, 'deliveryOverview.ts'), id => {
  if (id === './assignmentWorkflow') return workflow;
  if (id === './assignmentTiming') return timing;
  assert.equal(id, './recordOrdering');
  return ordering;
});

const docs = (status, count = data.DOCUMENT_TYPES.length) =>
  data.DOCUMENT_TYPES.slice(0, count).map(type => ({ type, uploaded: true, docStatus: status }));
const record = (id, taskStatus, createdAt, documents = []) => ({ id, taskStatus, createdAt, documents });
const now = new Date('2026-10-16T04:00:00Z'); // October 16 at noon in Manila.
const totals = bars => bars.reduce((result, bar) => {
  for (const status of workflow.ASSIGNMENT_DISPLAY_STATUSES) result[status] += bar.counts[status];
  return result;
}, overview.emptyOverviewCounts());

test('the overview series includes every supported display status exactly once', () => {
  assert.deepEqual([...workflow.ASSIGNMENT_DISPLAY_STATUSES], [
    'Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Awaiting Documents',
    'Under Review', 'Needs Correction', 'Completed', 'Failed / Issue', 'Cancelled',
  ]);
  assert.deepEqual(Object.keys(workflow.assignmentDisplayStatusChartColors).sort(),
    [...workflow.ASSIGNMENT_DISPLAY_STATUSES].sort());
});

test('current status mix covers the full workflow, real issue status, and cancelled archive', () => {
  const active = [
    record('assigned', 'Assigned', '2026-10-16T01:00:00Z'),
    record('picked', 'Picked Up', '2026-10-16T01:00:00Z'),
    record('transit', 'In Transit', '2026-10-16T01:00:00Z'),
    record('delivered', 'Delivered', '2026-10-16T01:00:00Z'),
    record('awaiting', 'Delivered', '2026-10-16T01:00:00Z', docs('approved', 1)),
    record('review', 'Delivered', '2026-10-16T01:00:00Z', docs('pending')),
    record('correction', 'Delivered', '2026-10-16T01:00:00Z', [
      { ...docs('pending', 1)[0], docStatus: 'rejected' },
    ]),
    record('ready', 'Delivered', '2026-10-16T01:00:00Z', docs('approved')),
    record('issue', 'Failed / Issue', '2026-10-16T01:00:00Z'),
  ];
  const completed = [{ ...record('complete', 'Delivered', '2026-10-16T01:00:00Z', docs('approved')), completedAt: 'Oct 16, 2026' }];
  const cancelled = [record('cancelled', 'Cancelled', '2026-10-16T01:00:00Z')];
  const counts = totals(overview.buildOverviewBars(active, completed, cancelled, 'today', now));
  // Approved active work remains Delivered until the explicit archive action.
  for (const status of workflow.ASSIGNMENT_DISPLAY_STATUSES) {
    assert.equal(counts[status], status === 'Awaiting Documents' ? 2 : 1, status);
  }
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 11);
});

test('an older assignment updated today appears under its current status', () => {
  const active = [record('picked-yesterday', 'Picked Up', '2026-10-15T01:00:00Z')];
  const cancelled = [record('cancelled-yesterday', 'Cancelled', '2026-10-15T01:00:00Z')];
  const notifications = [{ assignmentId: 'picked-yesterday', createdAt: '2026-10-16T01:30:00Z' }];
  const activity = [{ assignmentId: 'cancelled-yesterday', timestamp: '2026-10-16T02:00:00Z' }];
  const today = totals(overview.buildOverviewBars(active, [], cancelled, 'today', now, false, notifications, activity));
  assert.equal(today['Picked Up'], 1);
  assert.equal(today.Cancelled, 1);
  const week = totals(overview.buildOverviewBars(active, [], cancelled, 'week', now, false, notifications, activity));
  assert.equal(week['Picked Up'], 1);
  assert.equal(week.Cancelled, 1);
  const all = totals(overview.buildOverviewBars(active, [], cancelled, 'all', now));
  assert.equal(all['Picked Up'], 1);
  assert.equal(all.Cancelled, 1);
});

test('status transitions replace the old category, and overlapping records count once', () => {
  const assigned = record('same-id', 'Assigned', '2026-10-15T01:00:00Z');
  const picked = { ...assigned, taskStatus: 'Picked Up' };
  const notification = [{ assignmentId: 'same-id', createdAt: '2026-10-16T01:30:00Z' }];
  const before = totals(overview.buildOverviewBars([assigned], [], [], 'today', now, false, notification));
  const after = totals(overview.buildOverviewBars([picked], [], [], 'today', now, false, notification));
  assert.equal(before.Assigned, 1);
  assert.equal(after.Assigned, 0);
  assert.equal(after['Picked Up'], 1);
  const cancellation = [{ assignmentId: 'same-id', timestamp: '2026-10-16T02:00:00Z' }];
  const cancelled = totals(overview.buildOverviewBars([picked], [], [{ ...assigned, taskStatus: 'Cancelled' }], 'today', now, false, notification, cancellation));
  assert.equal(cancelled['Picked Up'], 0);
  assert.equal(cancelled.Cancelled, 1);
  assert.equal(Object.values(cancelled).reduce((sum, count) => sum + count, 0), 1);
});

test('records without trustworthy activity time appear only in All Time', () => {
  const active = [record('no-date', 'Picked Up', undefined)];
  assert.equal(totals(overview.buildOverviewBars(active, [], [], 'today', now))['Picked Up'], 0);
  assert.equal(totals(overview.buildOverviewBars(active, [], [], 'all', now))['Picked Up'], 1);
});

test('All Time groups activity by Manila month, retains empty months and undated records', () => {
  const active = [
    record('january', 'Assigned', '2026-01-31T15:59:00Z'),
    record('april', 'In Transit', '2026-04-03T01:00:00Z'),
    record('undated', 'Picked Up', undefined),
  ];
  const completed = [{ ...record('february', 'Delivered', '2026-01-31T16:00:00Z', docs('approved')), completedAt: 'Feb 1, 2026' }];
  const bars = overview.buildOverviewBars(active, completed, [], 'all', now);
  assert.deepEqual(bars.map(bar => bar.key), ['2026-01', '2026-02', '2026-03', '2026-04', 'undated']);
  assert.equal(bars[0].counts.Assigned, 1);
  assert.equal(bars[1].counts.Completed, 1);
  assert.equal(bars[2].counts['In Transit'], 0);
  assert.equal(bars[3].counts['In Transit'], 1);
  assert.equal(bars[4].counts['Picked Up'], 1);
});

test('status photo evidence can date a workflow change when its notification is missing', () => {
  const active = [{
    ...record('picked', 'Picked Up', '2026-10-15T01:00:00Z'),
    statusPhotos: { 'Picked Up': { timestamp: 'Oct 16, 2026, 09:21 AM' } },
  }];
  assert.equal(totals(overview.buildOverviewBars(active, [], [], 'today', now))['Picked Up'], 1);
});

test('later document activity moves a delivered assignment into the selected day only once', () => {
  const active = [record('review', 'Delivered', '2026-10-14T01:00:00Z', docs('pending'))];
  const notifications = [{ assignmentId: 'review', createdAt: '2026-10-16T02:00:00Z' }];
  const counts = totals(overview.buildOverviewBars(active, [], [], 'today', now, false, notifications));
  assert.equal(counts['Under Review'], 1);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 1);
});

test('the newest activity determines the week, month, and year bucket', () => {
  const active = [record('old', 'In Transit', '2025-12-01T01:00:00Z')];
  const notifications = [{ assignmentId: 'old', createdAt: '2026-10-16T01:00:00Z' }];
  for (const period of ['week', 'month', 'year']) {
    assert.equal(totals(overview.buildOverviewBars(active, [], [], period, now, false, notifications))['In Transit'], 1);
  }
});

test('today uses Manila calendar boundaries for all statuses', () => {
  const active = [
    record('yesterday', 'Picked Up', '2026-10-15T15:59:00Z'),
    record('today', 'Picked Up', '2026-10-15T16:01:00Z'),
  ];
  const cancelled = [record('cancelled-today', 'Cancelled', '2026-10-15T16:01:00Z')];
  const counts = totals(overview.buildOverviewBars(active, [], cancelled, 'today', now));
  assert.equal(counts['Picked Up'], 1);
  assert.equal(counts.Cancelled, 1);
});
