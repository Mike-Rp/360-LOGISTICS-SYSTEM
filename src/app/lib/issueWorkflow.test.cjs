const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'issueWorkflow.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
const { BLOCKING_ISSUE_REASONS, hasOpenBlockingIssue, getBlockingIssueSummary } = loaded.exports;

test('existing Report a Problem choices are treated as blocking', () => {
  assert.deepEqual(BLOCKING_ISSUE_REASONS, [
    'Cargo damaged in transit', 'Wrong delivery address', 'Customer refused delivery',
    'Vehicle breakdown', 'Cargo lost or missing', 'Accident / road incident',
  ]);
  for (const reason of BLOCKING_ISSUE_REASONS) {
    assert.equal(hasOpenBlockingIssue({ taskStatus: 'In Transit', issueReason: reason }), true);
  }
  assert.equal(hasOpenBlockingIssue({ taskStatus: 'In Transit', issueReason: 'Custom safety concern' }), true);
});

test('an issue marker on a preserved stage is recognized for the temporary UI pause', () => {
  const assignment = { taskStatus: 'In Transit', issueReason: 'Vehicle breakdown' };
  assert.equal(hasOpenBlockingIssue(assignment), true);
  assert.equal(assignment.taskStatus, 'In Transit');
});

test('legacy failed and cancelled deliveries do not offer issue resumption', () => {
  assert.equal(hasOpenBlockingIssue({ taskStatus: 'Failed / Issue', issueReason: 'Vehicle breakdown' }), false);
  assert.equal(hasOpenBlockingIssue({ taskStatus: 'Cancelled', issueReason: 'Vehicle breakdown' }), false);
});

test('Dispatch summary keeps the operational stage separate from a confirmed open blocking issue', () => {
  for (const stage of ['Assigned', 'At Pickup', 'Loading', 'In Transit', 'Delivered']) {
    const assignment = {
      taskStatus: stage,
      openIssue: { id: 7, reason: 'Cargo damaged in transit', reportedByName: 'Driver', reportedAt: '2026-11-11T00:00:00Z' },
    };
    assert.deepEqual(getBlockingIssueSummary(assignment), { reason: 'Cargo damaged in transit' });
    assert.equal(assignment.taskStatus, stage);
  }
});

test('only affected assignments receive a blocking summary; resolved and nonblocking issues do not', () => {
  const assignments = [
    { id: 'normal', taskStatus: 'Assigned' },
    { id: 'blocked', taskStatus: 'Assigned', openIssue: { id: 7, reason: 'Vehicle breakdown' } },
    { id: 'resolved', taskStatus: 'Assigned' },
    { id: 'delayed', taskStatus: 'In Transit', delayReports: [{ reason: 'Traffic' }] },
    { id: 'cancelled', taskStatus: 'Cancelled', issueReason: 'Old issue' },
  ];
  assert.deepEqual(assignments.filter((a) => getBlockingIssueSummary(a)).map((a) => a.id), ['blocked']);
  assert.equal(getBlockingIssueSummary({ taskStatus: 'Assigned', openIssue: { reason: '   ' } }).reason, null);
});

test('legacy blocking markers use their actual reason and clear after a verified refresh', () => {
  const before = { taskStatus: 'At Pickup', issueReason: 'Wrong delivery address' };
  const after = { taskStatus: 'At Pickup' };
  assert.deepEqual(getBlockingIssueSummary(before), { reason: 'Wrong delivery address' });
  assert.equal(getBlockingIssueSummary(after), null);
});

test('Dispatch card renders both stage and blocking indicator without adding action controls', () => {
  const card = readFileSync(join(__dirname, '../components/admin/DriversManagement.tsx'), 'utf8');
  assert.match(card, /const blockingIssue = getBlockingIssueSummary\(a\)/);
  assert.match(card, /<DispatchStatusBadge assignment=\{a\} \/>/);
  assert.match(card, /blockingIssue && <span[^>]*>[\s\S]*?Blocking Issue/);
  assert.match(card, /blockingIssue && <div className="mt-3 flex min-w-0/);
  assert.match(card, /assignment\.openIssue && !isViewOnly/);
});

const { getUnresolvedCancelledIssue, issueReportStatus } = loaded.exports;

test('a cancelled delivery with a still-open issue is reported as cancelled because of the issue', () => {
  const open = { id: 1, status: 'open', issueType: 'Accident / road incident' };
  const done = { id: 2, status: 'resolved', issueType: 'Vehicle breakdown' };
  assert.equal(getUnresolvedCancelledIssue({ taskStatus: 'Cancelled', issues: [done, open] }), open);
  assert.equal(getUnresolvedCancelledIssue({ taskStatus: 'Cancelled', issues: [done] }), null);
  assert.equal(getUnresolvedCancelledIssue({ taskStatus: 'Cancelled' }), null);
  assert.equal(getUnresolvedCancelledIssue({ taskStatus: 'In Transit', issues: [open] }), null);
});

test('report status uses only words the system already has', () => {
  assert.equal(issueReportStatus('resolved', false), 'Resolved');
  assert.equal(issueReportStatus('resolved', true), 'Resolved');
  assert.equal(issueReportStatus('open', false), 'Ongoing');
  assert.equal(issueReportStatus('open', true), 'Cancelled');
});

test('the Delay & Issues report and the Cancelled tab use the shared rules', () => {
  const reports = readFileSync(join(__dirname, '../components/admin/Reports.tsx'), 'utf8');
  assert.match(reports, /issueReportStatus\(issue\.status, isCancelled\)/);
  assert.match(reports, /buildDelayRows\(assignments, completed, cancelled\)/);
  const table = readFileSync(join(__dirname, '../components/admin/DeliveryTable.tsx'), 'utf8');
  assert.match(table, /getUnresolvedCancelledIssue\(a\)/);
  assert.match(table, /getUnresolvedCancelledIssue\(cancelledDetails\)/);
});
