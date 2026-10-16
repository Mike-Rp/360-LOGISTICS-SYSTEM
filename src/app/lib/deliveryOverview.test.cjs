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

const data = loadTypeScript(join(__dirname, '../data/assignmentTypes.ts'));
const timing = loadTypeScript(join(__dirname, 'assignmentTiming.ts'));
const workflow = loadTypeScript(join(__dirname, 'assignmentWorkflow.ts'), id => {
  if (id === './assignmentTiming') return timing;
  assert.equal(id, '../data/assignmentTypes');
  return data;
});
const ordering = loadTypeScript(join(__dirname, 'recordOrdering.ts'));
const overview = loadTypeScript(join(__dirname, 'deliveryOverview.ts'), id => {
  if (id === './assignmentWorkflow') return workflow;
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
    record('issue', 'Failed / Issue', '2026-10-16T01:00:00Z'),
  ];
  const completed = [{ ...record('complete', 'Delivered', '2026-10-16T01:00:00Z', docs('approved')), completedAt: 'Oct 16, 2026' }];
  const cancelled = [record('cancelled', 'Cancelled', '2026-10-16T01:00:00Z')];
  const counts = totals(overview.buildOverviewBars(active, completed, cancelled, 'today', now));
  // Physical Delivered immediately enters the document workflow when six docs
  // are required, so the standalone Delivered display status can legitimately be 0.
  for (const status of workflow.ASSIGNMENT_DISPLAY_STATUSES) {
    assert.equal(counts[status], status === 'Delivered' ? 0 : status === 'Awaiting Documents' ? 2 : 1, status);
  }
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 10);
});

test('creation date filters every status alike; All Time includes older Picked Up work', () => {
  const active = [record('picked-yesterday', 'Picked Up', '2026-10-15T01:00:00Z')];
  const cancelled = [record('cancelled-today', 'Cancelled', '2026-10-16T01:00:00Z')];
  const today = totals(overview.buildOverviewBars(active, [], cancelled, 'today', now));
  assert.equal(today['Picked Up'], 0);
  assert.equal(today.Cancelled, 1);
  const week = totals(overview.buildOverviewBars(active, [], cancelled, 'week', now));
  assert.equal(week['Picked Up'], 1);
  assert.equal(week.Cancelled, 1);
  const all = totals(overview.buildOverviewBars(active, [], cancelled, 'all', now));
  assert.equal(all['Picked Up'], 1);
  assert.equal(all.Cancelled, 1);
});

test('status transitions replace the old category, and overlapping records count once', () => {
  const assigned = record('same-id', 'Assigned', '2026-10-16T01:00:00Z');
  const picked = { ...assigned, taskStatus: 'Picked Up' };
  const before = totals(overview.buildOverviewBars([assigned], [], [], 'all', now));
  const after = totals(overview.buildOverviewBars([picked], [], [], 'all', now));
  assert.equal(before.Assigned, 1);
  assert.equal(after.Assigned, 0);
  assert.equal(after['Picked Up'], 1);
  const cancelled = totals(overview.buildOverviewBars([picked], [], [{ ...assigned, taskStatus: 'Cancelled' }], 'all', now));
  assert.equal(cancelled['Picked Up'], 0);
  assert.equal(cancelled.Cancelled, 1);
  assert.equal(Object.values(cancelled).reduce((sum, count) => sum + count, 0), 1);
});

test('records without trustworthy creation time appear only in All Time', () => {
  const active = [record('no-date', 'Picked Up', undefined)];
  assert.equal(totals(overview.buildOverviewBars(active, [], [], 'today', now))['Picked Up'], 0);
  assert.equal(totals(overview.buildOverviewBars(active, [], [], 'all', now))['Picked Up'], 1);
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
