const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function load(file, resolve = require) {
  const source = ts.transpileModule(readFileSync(join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(resolve, module, module.exports);
  return module.exports;
}

const colors = load('../data/statusColors.ts');
const types = load('../data/assignmentTypes.ts', id => {
  assert.equal(id, './statusColors');
  return colors;
});
const operational = load('assignmentOperational.ts');
const timing = load('assignmentTiming.ts');
const issues = load('issueWorkflow.ts');
const workflow = load('assignmentWorkflow.ts', id => {
  if (id === './assignmentTiming') return timing;
  if (id === '../data/statusColors') return colors;
  assert.equal(id, '../data/assignmentTypes');
  return types;
});
const dispatch = load('dispatchStatusFilter.ts', id => {
  if (id === './assignmentOperational') return operational;
  if (id === './assignmentWorkflow') return workflow;
  assert.equal(id, './issueWorkflow');
  return issues;
});

const record = (id, taskStatus, operationalStage, documents = []) => ({
  id, taskStatus, operationalStage, documents,
});

test('status options cover only supported Dispatch card labels', () => {
  assert.deepEqual(dispatch.DISPATCH_STATUS_OPTIONS, [
    'Assigned', 'At Pickup', 'Picked Up', 'Loading', 'In Transit', 'Arrived',
    'Unloading', 'Delivered', 'Awaiting Documents', 'Under Review',
    'Needs Correction', 'Failed / Issue',
  ]);
});

test('filter matches the operational badge shown on a Dispatch card', () => {
  const loading = record('A', 'Assigned', 'loading');
  assert.equal(dispatch.getDispatchCardStatus(loading), 'Loading');
  assert.equal(dispatch.matchesDispatchStatus(loading, 'Loading'), true);
  assert.equal(dispatch.matchesDispatchStatus(loading, 'Assigned'), false);
});

test('document review status and classification can filter together', () => {
  const docs = types.DOCUMENT_TYPES.map(type => ({ type, uploaded: true, docStatus: 'pending' }));
  const assignments = [
    { ...record('A', 'Delivered', null, docs), classification: 'Wing Van' },
    { ...record('B', 'Delivered', null, docs), classification: 'Flatbed Truck' },
    { ...record('C', 'Assigned', null), classification: 'Wing Van' },
  ];
  const matching = (status, classification) => assignments.filter(a =>
    dispatch.matchesDispatchStatus(a, status)
    && (!classification || a.classification === classification));
  assert.deepEqual(matching('Under Review', 'Wing Van').map(a => a.id), ['A']);
  assert.deepEqual(matching('', 'Wing Van').map(a => a.id), ['A', 'C']);
  assert.deepEqual(matching('Assigned', '').map(a => a.id), ['C']);
  assert.deepEqual(matching('Failed / Issue', 'Wing Van'), []);
});

test('Failed / Issue includes open blocking issues without changing delivery stages', () => {
  for (const [stage, operationalStage] of [
    ['Assigned', null], ['Assigned', 'at_pickup'], ['Assigned', 'loading'], ['Assigned', 'in_transit'],
  ]) {
    const assignment = {
      ...record('A', stage, operationalStage),
      openIssue: { id: 9, reason: 'Accident / road incident' },
    };
    assert.equal(dispatch.matchesDispatchStatus(assignment, 'Failed / Issue'), true);
    assert.notEqual(dispatch.getDispatchCardStatus(assignment), 'Failed / Issue');
  }
});

test('Failed / Issue excludes healthy and resolved assignments but retains legacy failures', () => {
  assert.equal(dispatch.matchesDispatchStatus(record('healthy', 'Assigned', null), 'Failed / Issue'), false);
  assert.equal(dispatch.matchesDispatchStatus(record('resolved', 'Assigned', null), 'Failed / Issue'), false);
  assert.equal(dispatch.matchesDispatchStatus(record('failed', 'Failed / Issue', null), 'Failed / Issue'), true);
  assert.equal(dispatch.matchesDispatchStatus({ ...record('delayed', 'Assigned', null), delayReports: [{ reason: 'Traffic' }] }, 'Failed / Issue'), false);
});

test('Failed / Issue still combines with classification and other status filters retain stage matching', () => {
  const assignments = [
    { ...record('blocked-wing', 'Assigned', null), classification: 'Wing Van', openIssue: { reason: 'Vehicle breakdown' } },
    { ...record('blocked-flatbed', 'Assigned', null), classification: 'Flatbed Truck', openIssue: { reason: 'Vehicle breakdown' } },
    { ...record('healthy-wing', 'Assigned', null), classification: 'Wing Van' },
  ];
  const matching = (status, classification) => assignments.filter(a =>
    dispatch.matchesDispatchStatus(a, status) && a.classification === classification).map(a => a.id);
  assert.deepEqual(matching('Failed / Issue', 'Wing Van'), ['blocked-wing']);
  assert.deepEqual(matching('Assigned', 'Wing Van'), ['blocked-wing', 'healthy-wing']);
});

test('a failed issue-data load does not replace the last verified assignments with an empty result', () => {
  const db = readFileSync(join(__dirname, 'db.ts'), 'utf8');
  const ui = readFileSync(join(__dirname, '../components/admin/DriversManagement.tsx'), 'utf8');
  assert.match(db, /fetchAll\('assignment_issues',[\s\S]*?\),\s*fetchAll\('notifications'/);
  assert.match(ui, /visibleAssignments\.length === 0 \? \([\s\S]*?availabilityError \? \(/);
  assert.match(ui, /Could not verify current assignments and issues\./);
});
