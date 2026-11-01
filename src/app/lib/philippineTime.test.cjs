const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

// Each worker gets a real, independent device timezone, including DST zones.
// It runs the actual helpers and RPC argument mapping with an in-memory RPC stub.
function scenario(directory) {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const cache = new Map();
  function load(file, overrides = {}) {
    const full = path.resolve(directory, file);
    if (cache.has(full)) return cache.get(full);
    const source = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} };
    cache.set(full, mod.exports);
    new Function('require', 'module', 'exports', source)((id) => id in overrides ? overrides[id]
      : id.startsWith('.') ? load(path.resolve(path.dirname(full), `${id}.ts`)) : require(id), mod, mod.exports);
    cache.set(full, mod.exports);
    return mod.exports;
  }
  const time = load('philippineTime.ts');
  const fleet = load('fleetDelegation.ts');
  const unavailable = load('unavailability.ts');
  const now = Date.parse('2030-03-01T00:00:00+08:00');
  const checked = fleet.checkNewCoverageWindow('2030-03-10T10:30', '2030-03-10T11:45', now);
  assert.equal(checked.ok, true);
  assert.equal(checked.startsAt.toISOString(), '2030-03-10T02:30:00.000Z');
  assert.equal(checked.endsAt.toISOString(), '2030-03-10T03:45:00.000Z');
  assert.equal(checked.length, '1 hour 15 minutes');
  assert.equal(fleet.toLocalInputValue(checked.startsAt), '2030-03-10T10:30');
  assert.match(time.formatPhilippineTimestamp('2030-03-10T02:30:00Z'), /Mar 10, 2030.*10:30\s?AM PHT/);
  assert.equal(time.formatPhilippineTimestamp('2030-03-10T10:30:00+08:00'), time.formatPhilippineTimestamp('2030-03-10T02:30:00Z'));
  assert.equal(fleet.accessActive(checked.endsAt.toISOString(), checked.endsAt.getTime() - 1), true);
  assert.equal(fleet.accessActive(checked.endsAt.toISOString(), checked.endsAt.getTime()), false);

  for (const wall of ['2026-03-08T02:30', '2026-11-01T01:30', '2026-03-29T02:30', '2026-10-25T02:30', '2026-04-05T02:30', '2026-10-04T02:30']) {
    const instant = time.parsePhilippineInputValue(wall);
    assert.equal(instant.toISOString(), new Date(`${wall}+08:00`).toISOString());
    assert.equal(time.toPhilippineInputValue(instant), wall, 'foreign DST gaps/repeated hours must not alter a PHT entry');
  }

  assert.equal(time.philippineDateKey(new Date('2030-12-31T15:59:59Z')), '2030-12-31');
  assert.equal(time.philippineDateKey(new Date('2030-12-31T16:00:00Z')), '2031-01-01');
  const midnight = Date.parse('2030-12-31T16:05:00Z');
  assert.equal(fleet.checkNewCoverageWindow('2030-12-31T23:30', '2031-01-02T08:00', midnight).ok, false);
  assert.equal(fleet.checkNewCoverageWindow('2031-01-01T00:01', '2031-01-02T08:00', midnight).ok, true);
  for (const day of ['2030-01-01', '2030-03-10', '2030-11-03']) {
    assert.equal(time.philippineDateKey(time.parsePhilippineInputValue(`${day}T00:00`)), day);
    assert.equal(time.persistedTimestamp(day), null, 'a calendar-only string is not an instant');
  }
  const endOfDay = '2031-01-01T00:00:00+08:00';
  assert.equal(unavailable.describeReturn(endOfDay, new Date('2030-12-31T23:59:00+08:00')), 'until end of today (PHT)');
  assert.equal(unavailable.describeReturn(endOfDay, new Date('2031-01-01T00:01:00+08:00')), 'until end of Dec 31 (PHT)');
  const driver = unavailable.checkUnavailabilityForm({ kind: 'driver', reason: 'leave', note: '', returnValue: '2030-03-10T17:00', nowMs: now });
  const truck = unavailable.checkUnavailabilityForm({ kind: 'truck', reason: '', note: 'Repair', returnValue: '2030-03-10T17:00', nowMs: now });
  for (const result of [driver, truck]) {
    assert.equal(result.ok, true);
    assert.equal(result.expectedReturn.toISOString(), '2030-03-10T09:00:00.000Z');
    assert.match(unavailable.describeReturn(result.expectedReturn.toISOString()), /Mar 10, 5:00\s?PM PHT/);
  }
  assert.equal(truck.reason, 'maintenance');
  const saved = '2030-03-10T09:00:37.123Z';
  const noteEdit = unavailable.checkUnavailabilityForm({ kind: 'truck', reason: 'maintenance', note: 'Updated note',
    returnValue: fleet.toLocalInputValue(new Date(saved)), originalReturnAt: saved, nowMs: now });
  assert.equal(noteEdit.expectedReturn.toISOString(), saved);
  const changed = unavailable.checkUnavailabilityForm({ kind: 'truck', reason: 'maintenance', note: '',
    returnValue: '2030-03-10T18:00', originalReturnAt: saved, nowMs: now });
  assert.equal(changed.expectedReturn.toISOString(), '2030-03-10T10:00:00.000Z');

  for (const value of ['', 'garbage', '2030-02-30T12:00', '2030-02-29T12:00', '2030-13-01T12:00', '2030-01-01T24:00', '2030-01-01T12:60', '2030-01-01', '2030-01-01T12:00Z']) {
    assert.equal(time.parsePhilippineInputValue(value), null, value);
  }
  assert.ok(time.parsePhilippineInputValue('2028-02-29T12:00'));
  for (const value of [undefined, null, '', 'bad', '2030-02-30T12:00:00Z', '2030-01-01', '2030-01-01T12:00']) {
    assert.equal(time.formatPhilippineTimestamp(value), 'Not available');
  }
  assert.equal(time.toPhilippineInputValue(new Date('bad')), '');
  assert.equal(unavailable.describeReturn('bad'), 'return date not set');
  assert.equal(unavailable.checkUnavailabilityForm({ kind: 'driver', reason: 'leave', note: '', returnValue: '', nowMs: now }).expectedReturn, null);
  assert.equal(fleet.checkCoverageWindow('', '', now).ok, false);

  const calls = [];
  const db = load('db.ts', {
    './supabaseClient': { supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } } },
    '../data/assignmentRoute': {}, '../data/assignmentTypes': { DOCUMENT_TYPES: [] }, './assignmentLocation': {},
    './storageRefs': {}, './driverHistory': {}, './resetPasswordFeedback': {},
  });
  return (async () => {
    await db.grantFleetDelegation({ csrId: 'test-csr', startsAt: checked.startsAt, endsAt: checked.endsAt,
      canResetPin: false, canRegister: true, contactPhone: null });
    await db.markDriverUnavailable('test-driver', { reason: 'leave', note: '', expectedReturn: driver.expectedReturn });
    await db.markTruckMaintenance('test-truck', { note: 'Repair', expectedReturn: truck.expectedReturn });
    await db.updateUnavailability('test-period', { note: 'Updated note', expectedReturn: noteEdit.expectedReturn });
    assert.equal(calls[0].args.p_starts_at, '2030-03-10T02:30:00.000Z');
    assert.equal(calls[0].args.p_ends_at, '2030-03-10T03:45:00.000Z');
    assert.equal(calls[1].args.p_expected_return, '2030-03-10T09:00:00.000Z');
    assert.equal(calls[2].args.p_expected_return, '2030-03-10T09:00:00.000Z');
    assert.equal(calls[3].args.p_expected_return, saved);
  })();
}

for (const zone of ['Asia/Manila', 'UTC', 'America/Los_Angeles', 'Europe/Berlin', 'Australia/Sydney']) {
  test(`PHT coverage, return dates, midnight and RPC instants stay consistent on a ${zone} device`, () => {
    const result = spawnSync(process.execPath, ['-e', `(${scenario.toString()})(process.argv[1]).catch((error) => { console.error(error); process.exitCode = 1; });`, __dirname], {
      env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
