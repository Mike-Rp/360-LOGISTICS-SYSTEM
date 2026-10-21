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
const { BLOCKING_ISSUE_REASONS, hasOpenBlockingIssue } = loaded.exports;

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
