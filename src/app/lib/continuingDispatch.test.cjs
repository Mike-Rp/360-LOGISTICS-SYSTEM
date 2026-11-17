const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const types = ['Proof of Delivery', 'Receiving Acknowledgement Report', 'Dispatch Slip',
  'Sales Invoice', 'Bill of Lading', 'Waybill / Delivery Receipt'];
const source = ts.transpileModule(readFileSync(join(__dirname, 'continuingDispatch.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', source)(mod, mod.exports, (name) => {
  if (name === '../data/assignmentTypes') return { DOCUMENT_TYPES: types };
  if (name === './completedOrdering') return { completionTime: (item) => Date.parse(item.completedEventAt) || null };
  if (name === './assignmentWorkflow') return { getAssignmentDocumentProgress: (item) => ({
    allApproved: types.every((type) => {
      const docs = item.documents.filter((doc) => doc.type === type && doc.uploaded);
      return docs.length > 0 && docs.every((doc) => doc.docStatus === 'approved');
    }),
  }) };
  throw new Error(`Unexpected import ${name}`);
});
const { continuationCandidate, latestRecordedPhotoLocation } = mod.exports;

const completed = (overrides = {}) => ({
  id: 'ASN10000', driverId: 'd1', driverName: 'Driver One', truckId: 't1', truckPlate: 'ABC 1234',
  taskStatus: 'Delivered', completedAt: 'Nov 1, 2026', completedEventAt: '2026-11-01T08:00:00Z',
  documents: types.map((type) => ({ type, uploaded: true, docStatus: 'approved' })), ...overrides,
});
const snapshot = (source, overrides = {}) => ({
  completed: [source], active: [], cancelled: [],
  drivers: [{ id: 'd1', name: 'Driver One' }],
  trucks: [{ id: 't1', status: 'Available' }], ...overrides,
});

test('only officially completed sources with all six approved documents qualify', () => {
  const source = completed();
  assert.equal(continuationCandidate(source, snapshot(source)), true);
  assert.equal(continuationCandidate(completed({ taskStatus: 'Assigned' }), snapshot(source)), false);
  assert.equal(continuationCandidate(completed({ completedEventAt: null }), snapshot(source)), false);
  assert.equal(continuationCandidate(completed({ documents: source.documents.slice(1) }), snapshot(source)), false);
  assert.equal(continuationCandidate(completed({ documents: source.documents.map((doc, i) => i ? doc : { ...doc, docStatus: 'pending' }) }), snapshot(source)), false);
  assert.equal(continuationCandidate(completed({ documents: [...source.documents, { ...source.documents[0], docStatus: 'pending' }] }), snapshot(source)), false);
});

test('busy, unavailable, archived or missing resources are not offered', () => {
  const source = completed();
  assert.equal(continuationCandidate(source, snapshot(source, { active: [{ driverId: 'd1', truckId: 'other' }] })), false);
  assert.equal(continuationCandidate(source, snapshot(source, { active: [{ driverId: 'other', truckId: 't1' }] })), false);
  assert.equal(continuationCandidate(source, snapshot(source, { drivers: [] })), false);
  assert.equal(continuationCandidate(source, snapshot(source, { drivers: [{ id: 'd1', unavailable: { id: 'u1' } }] })), false);
  assert.equal(continuationCandidate(source, snapshot(source, { trucks: [{ id: 't1', status: 'Assigned' }] })), false);
  assert.equal(continuationCandidate(source, snapshot(source, { trucks: [{ id: 't1', status: 'Available', archivedAt: '2026-11-02' }] })), false);
});

test('historical sources cannot be reused after a later assignment for either resource', () => {
  const source = completed();
  const newer = completed({ id: 'ASN20000', driverId: 'd1', truckId: 't2', completedEventAt: '2026-11-02T08:00:00Z' });
  assert.equal(continuationCandidate(source, snapshot(source, { completed: [source, newer] })), false);
  assert.equal(continuationCandidate(source, snapshot(source, { cancelled: [{ driverId: 'd1', truckId: 't2', createdAt: '2026-11-02T08:00:00Z' }] })), false);
});

test('historical photo evidence is labeled only when a GPS observation exists', () => {
  const source = completed({ statusPhotos: { Delivered: { location: 'Naga', coords: { lat: 13.6, lng: 123.2 }, gpsObservedAt: '2026-11-01T07:00:00Z' } } });
  assert.deepEqual(latestRecordedPhotoLocation(source), { location: 'Naga', observedAt: '2026-11-01T07:00:00Z' });
  assert.equal(latestRecordedPhotoLocation(completed()), null);
});

test('component locks both resources and blocks unsupported continuing submission', () => {
  const component = readFileSync(join(__dirname, '../components/admin/DriversManagement.tsx'), 'utf8');
  assert.match(component, /dispatchMode === 'continuing'.*\? <div aria-label=\{`Locked driver:/s);
  assert.match(component, /dispatchMode === 'continuing'.*\? <div aria-label=\{`Locked truck:/s);
  assert.match(component, /if \(dispatchMode === 'continuing'\) \{\s*setTaskErrors\(\(previous\) => \(\{ \.\.\.previous, submit:/);
  assert.match(component, /disabled=\{dispatchMode === 'continuing' \|\| taskSaving/);
  assert.match(component, /mode === 'new' \? 'New Dispatch' : 'Continuing Dispatch'/);
});
