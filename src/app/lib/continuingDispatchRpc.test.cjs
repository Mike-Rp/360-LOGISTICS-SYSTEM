const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const code = ts.transpileModule(readFileSync(join(__dirname, 'db.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(response = { data: true, error: null }) {
  const calls = [];
  const supabase = { async rpc(name, args) { calls.push({ name, args }); return response; } };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === './supabaseClient') return { supabase };
    if (id === '../data/assignmentTypes') return { DOCUMENT_TYPES: [] };
    if (id === '../data/assignmentRoute') return { destinationAreaEnabled: false };
    if (id === './assignmentLocation') return { locationColumnsForRow: () => ({}) };
    if (id === './storageRefs') return { storagePathOf: () => null };
    if (['./driverHistory', './resetPasswordFeedback', './teamMemberValidation'].includes(id)) return {};
    throw new Error(`Unexpected import: ${id}`);
  }, mod, mod.exports);
  return { db: mod.exports, calls };
}

const input = {
  driverId: 'driver-1', truckId: 'truck-1', destination: 'A → B', destinationArea: 'B',
  company: 'Test', pickupLocation: 'Pickup', deliveryLocation: 'Delivery',
  pickupTime: '09:00 AM', pickedUpDate: 'Nov 19, 2026',
  scheduledArrivalTime: '02:00 PM', deliveryDate: 'Nov 19, 2026', remarks: '',
};

test('missing server capability keeps Continuing Dispatch unavailable', async () => {
  const { db, calls } = fixture({ data: null, error: { code: 'PGRST202', message: 'missing function' } });
  assert.equal(await db.continuingDispatchAvailable(), false);
  assert.deepEqual(calls, [{ name: 'continuing_dispatch_capability', args: undefined }]);
});

test('a deployed capability must explicitly return true', async () => {
  const { db } = fixture({ data: false, error: null });
  assert.equal(await db.continuingDispatchAvailable(), false);
  const ready = fixture();
  assert.equal(await ready.db.continuingDispatchAvailable(), true);
});

test('continuing submission sends source ID and original resource IDs to its dedicated RPC', async () => {
  const { db, calls } = fixture({ data: 'ASN12345', error: null });
  assert.equal(await db.dispatchContinuingAssignment('ASN00001', input, true), 'ASN12345');
  assert.equal(calls[0].name, 'dispatch_continuing_assignment');
  assert.equal(calls[0].args.p_source_id, 'ASN00001');
  assert.equal(calls[0].args.p_fields.driver_id, 'driver-1');
  assert.equal(calls[0].args.p_fields.truck_id, 'truck-1');
  assert.equal(calls[0].args.p_fields.scheduled_arrival_time, '02:00 PM');
  assert.equal(calls[0].args.p_operational_review_confirmed, true);
  assert.equal(calls[0].args.p_fields.continuation_source_id, undefined);
});

test('normal dispatch retains its existing RPC and payload contract', async () => {
  const { db, calls } = fixture({ data: 'ASN98765', error: null });
  assert.equal(await db.dispatchAssignment(input), 'ASN98765');
  assert.equal(calls[0].name, 'dispatch_assignment');
  assert.equal(calls[0].args.p_fields.driver_id, 'driver-1');
  assert.equal(calls[0].args.p_fields.scheduled_arrival_time, '02:00 PM');
  assert.equal(calls[0].args.p_source_id, undefined);
});

test('source rejection remains an error, never a successful dispatch', async () => {
  const { db } = fixture({ data: null, error: { code: '22023', message: 'source_stale' } });
  await assert.rejects(db.dispatchContinuingAssignment('ASN00001', input, true), { code: 'source_stale' });
});

test('source document rejection keeps its specific error code', async () => {
  const { db } = fixture({ data: null, error: { code: '22023', message: 'source_documents_not_approved' } });
  await assert.rejects(db.dispatchContinuingAssignment('ASN00001', input, true), { code: 'source_documents_not_approved' });
});

test('missing operational review cannot call the continuing RPC', async () => {
  const { db, calls } = fixture();
  await assert.rejects(db.dispatchContinuingAssignment('ASN00001', input, false), { code: 'operational_review_required' });
  assert.equal(calls.length, 0);
});
