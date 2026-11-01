const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

// Run the actual data loader with an in-memory PostgREST read boundary. No live client,
// credentials, storage calls or database writes are used by these tests.
function loadModule(file, imports = {}) {
  const code = ts.transpileModule(readFileSync(join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (!(id in imports)) throw new Error(`Unexpected test import: ${id}`);
    return imports[id];
  }, mod, mod.exports);
  return mod.exports;
}

const philippineTime = loadModule('philippineTime.ts', { './assignmentTiming': loadModule('assignmentTiming.ts') });
const { driverState, truckState } = loadModule('unavailability.ts', { './philippineTime': philippineTime });
function fixture() {
  const rows = {
    drivers: [
      { id: 'driver-a', name: 'Driver A', phone: '+639171234567', status: 'Pending' },
      { id: 'driver-b', name: 'Driver B', phone: '+639171234568', status: 'Pending' },
    ],
    trucks: [
      { id: 'truck-a', plate_number: 'TEST A', status: 'Available' },
      { id: 'truck-b', plate_number: 'TEST B', status: 'Available' },
    ],
    current_unavailability: [
      { id: 'period-a', driver_id: 'driver-a', reason: 'leave', note: 'Saved driver reason',
        expected_return_at: '2026-11-10T09:00:00Z', since: '2026-11-01T00:00:00Z' },
      { id: 'period-b', truck_id: 'truck-a', reason: 'maintenance', note: 'Saved truck reason',
        expected_return_at: null, since: '2026-11-01T00:00:00Z' },
    ],
  };
  const failures = new Map();
  const read = [];
  const supabase = { from(table) {
    return {
      select() { return this; },
      order() { return this; },
      async range() {
        read.push(table);
        if (failures.has(table)) return { data: null, error: failures.get(table) };
        return { data: rows[table] ?? [], error: null };
      },
    };
  } };
  const db = loadModule('db.ts', {
    './supabaseClient': { supabase },
    '../data/assignmentTypes': { DOCUMENT_TYPES: [] },
    '../data/assignmentRoute': { destinationAreaEnabled: false },
    './assignmentLocation': { locationColumnsForRow: () => ({}) },
    './storageRefs': { storagePathOf: () => null },
    './driverHistory': {},
    './resetPasswordFeedback': {},
    './teamMemberValidation': {},
  });
  return { db, rows, failures, read };
}

test('successful availability lookup preserves driver/truck status, reason and return evidence', async () => {
  const { db, rows } = fixture();
  const data = await db.loadAdminData();
  assert.equal(driverState(data.drivers[0]), 'unavailable');
  assert.equal(truckState(data.trucks[0]), 'unavailable');
  assert.equal(data.drivers[0].unavailable.note, 'Saved driver reason');
  assert.equal(data.drivers[0].unavailable.expectedReturnAt, rows.current_unavailability[0].expected_return_at);
  assert.equal(data.trucks[0].unavailable.reason, 'maintenance');
  assert.equal(data.trucks[0].unavailable.expectedReturnAt, null);
  assert.equal(driverState(data.drivers[1]), 'available');
  assert.equal(truckState(data.trucks[1]), 'available');
});

test('a successful empty availability lookup genuinely permits available resources', async () => {
  const { db, rows } = fixture();
  rows.current_unavailability = [];
  const data = await db.loadAdminData();
  assert.ok(data.drivers.every((driver) => !driver.unavailable && driverState(driver) === 'available'));
  assert.ok(data.trucks.every((truck) => !truck.unavailable && truckState(truck) === 'available'));
});

test('a failed availability lookup rejects instead of returning a verified empty result', async () => {
  const { db, failures } = fixture();
  failures.set('current_unavailability', { code: '42P01', message: 'Missing view' });
  await assert.rejects(db.loadAdminData(), db.AvailabilityLookupError);
});

test('successful driver and truck reads cannot publish an unverified snapshot', async () => {
  const { db, failures, read } = fixture();
  failures.set('current_unavailability', { message: 'Read denied' });
  let published;
  await assert.rejects(async () => { published = await db.loadAdminData(); }, db.AvailabilityLookupError);
  assert.ok(read.includes('drivers'));
  assert.ok(read.includes('trucks'));
  assert.equal(published, undefined);
});

test('retry after failure returns verified data, including a later successful empty result', async () => {
  const { db, failures, rows } = fixture();
  failures.set('current_unavailability', { message: 'Temporary outage' });
  await assert.rejects(db.loadAdminData(), db.AvailabilityLookupError);
  failures.clear();
  const recovered = await db.loadAdminData();
  assert.equal(driverState(recovered.drivers[0]), 'unavailable');
  rows.current_unavailability = [];
  const cleared = await db.loadAdminData();
  assert.equal(driverState(cleared.drivers[0]), 'available');
  assert.equal(truckState(cleared.trucks[0]), 'available');
});

test('failed refresh preserves the last snapshot and its unavailable/available distinctions', async () => {
  const { db, failures } = fixture();
  let displayed = await db.loadAdminData();
  const previous = displayed;
  const before = structuredClone(previous);
  failures.set('current_unavailability', { message: 'Temporary outage' });
  await assert.rejects(async () => { displayed = await db.loadAdminData(); }, db.AvailabilityLookupError);
  assert.equal(displayed, previous);
  assert.deepEqual(displayed, before);
  assert.equal(driverState(displayed.drivers[0]), 'unavailable');
  assert.equal(truckState(displayed.trucks[0]), 'unavailable');
  assert.equal(driverState(displayed.drivers[1]), 'available');
  // A failed refresh must not reset the loader's last-good diff baseline either.
  await db.syncAdminData(displayed);
});

function renderAdminAvailability(overrides = {}) {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const captured = [];
  const children = ['Sidebar', 'Header', 'NotificationToastContainer', 'KPICards', 'DeliveryTable',
    'DeliveryStatusBoard', 'Charts', 'DocumentArchive', 'DriversManagement', 'Reports', 'AccountsPanel',
    'SettingsPanel', 'HelpPanel', 'WorkspaceSettingsPanel', 'dashboard/DashboardHome', 'AdminContentSkeleton'];
  const imports = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '../../lib/adminNavigation': { adminPageFromUrl: () => 'Monitor' },
    '../../lib/staffPermissions': { canDispatchAssignments: () => true, canManageFleetAccounts: () => false },
    '../../lib/notificationEvents': {},
    '../../lib/notificationSound': { notificationSoundEnabled: () => false },
    '../../lib/useMyFleetDelegation': { useMyFleetDelegation: () => ({}) },
  };
  for (const child of children) imports[`./${child}`] = { default: (props) => { captured.push({ child, props }); return null; } };
  imports['./Sidebar'].MobileTopBar = () => null;
  const { default: AdminDashboard } = loadModule('../components/admin/AdminDashboard.tsx', imports);
  const previousWindow = global.window;
  const previousStorage = global.localStorage;
  global.window = { location: { search: '' } };
  global.localStorage = { getItem: () => null };
  try {
    const retry = () => {};
    const html = renderToStaticMarkup(React.createElement(AdminDashboard, {
      initialLoading: false, contentLoading: false, availabilityError: true,
      drivers: [], trucks: [], assignments: [], completed: [], cancelled: [],
      notifications: [], activityLog: [], archivedDrivers: [], archivedTrucks: [],
      activeNav: 'Monitor', adminRole: 'csr', onRetryLoad: retry,
      ...overrides,
    }));
    return { html, captured, retry };
  } finally { global.window = previousWindow; global.localStorage = previousStorage; }
}

test('the admin shell identifies stale fleet data across routes and exposes Retry', () => {
  for (const activeNav of ['Accounts', 'Dashboard', 'Monitor']) {
    const { html, captured, retry } = renderAdminAvailability({ activeNav });
    assert.match(html, /Availability is unverified/);
    assert.match(html, /last successful load/);
    assert.match(html, />Retry<\/button>/);
    if (activeNav === 'Monitor') {
      const monitor = captured.find((entry) => entry.child === 'DriversManagement');
      assert.equal(monitor.props.availabilityError, true);
      assert.equal(monitor.props.onRetryAvailability, retry);
    }
  }
});

test('retry is visibly busy and disabled during refresh; successful recovery clears the warning', () => {
  const retrying = renderAdminAvailability({ contentLoading: true }).html;
  assert.match(retrying, /<button[^>]*disabled=""[^>]*>Retrying…<\/button>/);
  const recovered = renderAdminAvailability({ availabilityError: false }).html;
  assert.doesNotMatch(recovered, /Availability is unverified|>Retry<\/button>/);
});
