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
  if (name === './philippineAddress') return { PSGC_REGIONS: require('../data/psgcIndex.json').regions };
  throw new Error(`Unexpected import ${name}`);
});
const { continuationCandidate, latestRecordedPhotoLocation, suggestedPickupRegionCode, canSuggestPickupRegion } = mod.exports;

const completed = (overrides = {}) => ({
  id: 'ASN10000', driverId: 'd1', driverName: 'Driver One', truckId: 't1', truckPlate: 'ABC 1234',
  taskStatus: 'Delivered', completedAt: 'Nov 1, 2026', completedEventAt: '2026-11-01T08:00:00Z',
  createdAt: '2026-10-30T08:00:00Z',
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
  assert.equal(continuationCandidate(completed({ createdAt: undefined }), snapshot(source)), false);
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
  const newer = completed({ id: 'ASN20000', driverId: 'd1', truckId: 't2', createdAt: '2026-10-31T08:00:00Z' });
  assert.equal(continuationCandidate(source, snapshot(source, { completed: [source, newer] })), false);
  assert.equal(continuationCandidate(source, snapshot(source, { completed: [source, completed({ id: 'ASN30000', driverId: 'd2', truckId: 't1', createdAt: '2026-10-31T08:00:00Z' })] })), false);
  assert.equal(continuationCandidate(source, snapshot(source, { cancelled: [{ driverId: 'd1', truckId: 't2', createdAt: '2026-11-02T08:00:00Z' }] })), false);
});

test('historical photo evidence is labeled only when a GPS observation exists', () => {
  const source = completed({ statusPhotos: { Delivered: { location: 'Naga', coords: { lat: 13.6, lng: 123.2 }, gpsObservedAt: '2026-11-01T07:00:00Z' } } });
  assert.deepEqual(latestRecordedPhotoLocation(source), { location: 'Naga', observedAt: '2026-11-01T07:00:00Z' });
  assert.equal(latestRecordedPhotoLocation(completed()), null);
});

test('pickup region suggestion uses unambiguous PSGC destination parents', () => {
  assert.equal(suggestedPickupRegionCode('Santa Rosa, Laguna', null), '0400000000');
  assert.equal(suggestedPickupRegionCode('Dasmariñas, Cavite', null), '0400000000');
  assert.equal(suggestedPickupRegionCode('Quezon City, National Capital Region (NCR)', null), '1300000000');
  assert.equal(suggestedPickupRegionCode(null,
    'Warehouse A, Balibago, Santa Rosa City, Laguna, Region IV-A (CALABARZON)'), '0400000000');
  assert.equal(suggestedPickupRegionCode(null, 'Warehouse A', 'Santa Rosa, Laguna'), '0400000000');
  assert.equal(suggestedPickupRegionCode('City of Calamba, Laguna',
    'Warehouse A, Barandal, City of Calamba, Laguna, Region IV-A (CALABARZON)'), '0400000000');
  assert.equal(suggestedPickupRegionCode('Santa Rosa', null), null);
  assert.equal(suggestedPickupRegionCode(null, null), null);
  assert.equal(suggestedPickupRegionCode('Santa Rosa, Laguna', 'Warehouse, Quezon City, National Capital Region (NCR)'), null);
  assert.equal(suggestedPickupRegionCode('Santa Rosa, Laguna', null, 'Quezon City, National Capital Region (NCR)'), null);
  assert.equal(suggestedPickupRegionCode(null, 'City of Calamba, Bulacan, Region IV-A (CALABARZON)'), null);
});

test('only an untouched pickup or prior suggestion can be prefilled', () => {
  const empty = { regionCode: '', provinceCode: '', cityCode: '', barangayCode: '' };
  assert.equal(canSuggestPickupRegion(empty, '', false, false), true);
  assert.equal(canSuggestPickupRegion({ ...empty, regionCode: '0400000000' }, '', false, true), true);
  assert.equal(canSuggestPickupRegion({ ...empty, regionCode: '0400000000' }, '', false, false), false);
  assert.equal(canSuggestPickupRegion(empty, 'Warehouse A', false, false), false);
  assert.equal(canSuggestPickupRegion({ ...empty, provinceCode: '0403400000' }, '', false, true), false);
  assert.equal(canSuggestPickupRegion(empty, '', true, false), false);
});

test('component locks both resources and gates submission on server support and CSR review', () => {
  const component = readFileSync(join(__dirname, '../components/admin/DriversManagement.tsx'), 'utf8');
  assert.match(component, /dispatchMode === 'continuing'.*\? <div aria-label=\{`Locked driver:/s);
  assert.match(component, /dispatchMode === 'continuing'.*\? <div aria-label=\{`Locked truck:/s);
  assert.match(component, /continuingDispatchAvailable\(\)/);
  assert.match(component, /continuingCapability !== 'ready' \|\| !operationalReviewConfirmed/);
  assert.match(component, /const latest = await loadAdminData\(\)/);
  assert.match(component, /dispatchContinuingAssignment\(previousAssignmentId, input, operationalReviewConfirmed\)/);
  assert.match(component, /disabled=\{taskSaving[\s\S]*dispatchMode === 'continuing'[\s\S]*continuingCapability !== 'ready'/);
  assert.match(component, /setOperationalReviewConfirmed\(false\)/);
  assert.match(component, /mode === 'new' \? 'New Dispatch' : 'Continuing Dispatch'/);
  assert.match(component, /onChange=\{selectPreviousAssignment\}/);
  assert.match(component, /setPickupGeo\(\{ \.\.\.EMPTY_GEO_SELECTION, regionCode: regionCode \?\? '' \}\)/);
  assert.match(component, /setCurrentLocationConfirmed\(false\)/);
  assert.match(component, /checked=\{currentLocationConfirmed && operationalReviewConfirmed\}/);
  assert.match(component, /setCurrentLocationConfirmed\(event\.target\.checked\); setOperationalReviewConfirmed\(event\.target\.checked\)/);
  assert.match(component, /Current location unverified/);
  assert.doesNotMatch(component, /Live Location/);
});

test('Step 2 places a collapsed, expandable review after schedule and remarks', () => {
  const component = readFileSync(join(__dirname, '../components/admin/DriversManagement.tsx'), 'utf8');
  const step = component.slice(component.indexOf('STEP 2 — Schedule'));
  assert.ok(step.indexOf('dispatch-pickup-date') < step.indexOf('Review trip details'));
  assert.ok(step.indexOf('>Remarks</FieldLabel>') < step.indexOf('Review trip details'));
  assert.ok(step.indexOf('Review trip details') < step.indexOf('checked={currentLocationConfirmed && operationalReviewConfirmed}'));
  assert.ok(step.indexOf('checked={currentLocationConfirmed && operationalReviewConfirmed}') < step.indexOf("'Dispatch Truck'"));
  assert.match(step, /tripReviewOpen && <div id="continuing-trip-review"/);
  assert.match(step, /aria-expanded=\{tripReviewOpen\}/);
  assert.doesNotMatch(step, /New schedule:.*—/);
  assert.equal(suggestedPickupRegionCode('Alicia, Bohol', null) === suggestedPickupRegionCode('Santa Rosa, Laguna', null), false);
});

test('previous assignment card keeps photo evidence behind an accessible disclosure', () => {
  const component = readFileSync(join(__dirname, '../components/admin/DriversManagement.tsx'), 'utf8');
  const card = component.slice(component.indexOf('{previousAssignment && <section'), component.indexOf('{(continuingCapability ===', component.indexOf('{previousAssignment && <section')));
  assert.match(card, /\{previousAssignment\.id\}/);
  assert.match(card, />Completed</);
  assert.match(card, /\{previousAssignment\.driverName\}/);
  assert.match(card, /\{previousAssignment\.truckPlate\}/);
  assert.match(card, /previousAssignment\.destinationArea/);
  assert.match(card, /aria-expanded=\{locationDetailsOpen\}/);
  assert.match(card, /locationDetailsOpen && <div id="previous-assignment-location-details"/);
  assert.match(card, /View location details/);
  assert.match(card, /Hide location details/);
  assert.match(component, /const selectPreviousAssignment = \(id: string\) => \{\s*setLocationDetailsOpen\(false\)/);
});
