const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function load(file, imports = {}) {
  const source = ts.transpileModule(readFileSync(join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => imports[id], mod, mod.exports);
  return mod.exports;
}
const philippineTime = load('philippineTime.ts', { './assignmentTiming': load('assignmentTiming.ts') });
const { reasonLabel, driverState, truckState, describeReturn, describeUnavailability, openEndedFor, checkUnavailabilityForm, DRIVER_REASONS } = load('unavailability.ts', { './philippineTime': philippineTime });

const NOW = new Date('2026-11-10T12:00:00+08:00');
const NOW_MS = NOW.getTime();
const DAY = 86_400_000;
const at = (y, m, d, h = 0, min = 0) => new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}+08:00`).toISOString();

test('reasons have plain labels, and maintenance is the truck reason', () => {
  assert.deepEqual(DRIVER_REASONS.map((r) => r.value), ['sick', 'leave', 'emergency', 'no_show', 'other']);
  assert.equal(reasonLabel('sick'), 'Sick');
  assert.equal(reasonLabel('leave'), 'Vacation / Leave');
  assert.equal(reasonLabel('no_show'), 'No-show');
  assert.equal(reasonLabel('maintenance'), 'Maintenance');
});

test('a driver or truck is unavailable first, then on delivery, then available', () => {
  const u = { id: '1', reason: 'sick', note: '', expectedReturnAt: null, since: at(2026, 11, 9, 8) };
  assert.equal(driverState({ status: 'Pending' }), 'available');
  assert.equal(driverState({ status: 'Complete' }), 'available');
  assert.equal(driverState({ status: 'Assigned' }), 'onDelivery');
  assert.equal(driverState({ status: 'Pending', unavailable: u }), 'unavailable');
  assert.equal(truckState({ status: 'Available' }), 'available');
  assert.equal(truckState({ status: 'Assigned' }), 'onDelivery');
  assert.equal(truckState({ status: 'Available', unavailable: { ...u, reason: 'maintenance' } }), 'unavailable');
});

test('the return is described for people: a time, end of day, or not set', () => {
  assert.equal(describeReturn(null, NOW), 'return date not set');
  assert.equal(describeReturn('not a date', NOW), 'return date not set');
  assert.match(describeReturn(at(2026, 11, 13, 17, 0), NOW), /^until Nov 13, 5:00\s?PM PHT$/);
  assert.equal(describeUnavailability({ reason: 'emergency', expectedReturnAt: null }, NOW), 'Emergency · return date not set');
});

test('a stored midnight closes the previous day: "end of today" on that day, its date afterwards', () => {
  const midnight = at(2026, 11, 11, 0, 0);                                          // how a no-show for Nov 10 is stored
  assert.equal(describeReturn(midnight, new Date('2026-11-10T15:30+08:00')), 'until end of today (PHT)');
  assert.equal(describeReturn(midnight, new Date('2026-11-12T09:00+08:00')), 'until end of Nov 10 (PHT)');
});

test('an open-ended period shows how long it has run once it passes a day', () => {
  assert.equal(openEndedFor({ expectedReturnAt: null, since: new Date(NOW_MS - 3 * 3_600_000).toISOString() }, NOW_MS), null);
  assert.equal(openEndedFor({ expectedReturnAt: null, since: new Date(NOW_MS - DAY).toISOString() }, NOW_MS), '1 day');
  assert.equal(openEndedFor({ expectedReturnAt: null, since: new Date(NOW_MS - 5.5 * DAY).toISOString() }, NOW_MS), '5 days');
  assert.equal(openEndedFor({ expectedReturnAt: at(2026, 11, 20), since: new Date(NOW_MS - 5 * DAY).toISOString() }, NOW_MS), null);
});

test('driver form: reason required, "Other" needs a note, note and return are checked', () => {
  const base = { kind: 'driver', reason: 'sick', note: '', returnValue: '', nowMs: NOW_MS };
  const ok = checkUnavailabilityForm(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, 'sick');
  assert.equal(ok.expectedReturn, null);

  assert.deepEqual(checkUnavailabilityForm({ ...base, reason: '' }).errors, { reason: 'Choose a reason.' });
  assert.deepEqual(checkUnavailabilityForm({ ...base, reason: 'vacation' }).errors, { reason: 'Choose a reason.' });
  assert.match(checkUnavailabilityForm({ ...base, reason: 'other' }).errors.note, /note/);
  assert.match(checkUnavailabilityForm({ ...base, reason: 'other', note: '   ' }).errors.note, /note/);
  assert.equal(checkUnavailabilityForm({ ...base, reason: 'other', note: 'jury duty' }).ok, true);
  assert.match(checkUnavailabilityForm({ ...base, note: 'x'.repeat(201) }).errors.note, /200/);
  assert.equal(checkUnavailabilityForm({ ...base, note: 'x'.repeat(200) }).ok, true);
});

test('return time must be a real time in the future, or empty', () => {
  const base = { kind: 'driver', reason: 'leave', note: '', nowMs: NOW_MS };
  assert.equal(checkUnavailabilityForm({ ...base, returnValue: '2026-11-14T08:00' }).ok, true);
  assert.equal(checkUnavailabilityForm({ ...base, returnValue: '2026-11-14T08:00' }).expectedReturn.toISOString(), '2026-11-14T00:00:00.000Z');
  assert.match(checkUnavailabilityForm({ ...base, returnValue: '2026-11-10T11:00' }).errors.returnAt, /future/);
  assert.match(checkUnavailabilityForm({ ...base, returnValue: '2026-11-10T12:00' }).errors.returnAt, /future/);
  assert.match(checkUnavailabilityForm({ ...base, returnValue: 'garbage' }).errors.returnAt, /valid/);
});

test('truck form: the reason is always maintenance', () => {
  const r = checkUnavailabilityForm({ kind: 'truck', reason: '', note: 'brakes', returnValue: '', nowMs: NOW_MS });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'maintenance');
  assert.equal(r.note, 'brakes');
  assert.equal(checkUnavailabilityForm({ kind: 'truck', reason: 'sick', note: '', returnValue: '', nowMs: NOW_MS }).reason, 'maintenance');
});
