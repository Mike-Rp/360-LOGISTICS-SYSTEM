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
const workflow = load('assignmentWorkflow.ts', id => {
  if (id === './assignmentTiming') return timing;
  if (id === '../data/statusColors') return colors;
  assert.equal(id, '../data/assignmentTypes');
  return types;
});
const dispatch = load('dispatchStatusFilter.ts', id => {
  if (id === './assignmentOperational') return operational;
  assert.equal(id, './assignmentWorkflow');
  return workflow;
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
