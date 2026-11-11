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

const timing = load('../../lib/assignmentTiming.ts');
const pht = load('../../lib/philippineTime.ts', { './assignmentTiming': timing });
const { withExpectedReturnDate: withDate, withExpectedReturnTime: withTime, expectedReturnError, isAtOrBeforeMinMonth } = load('expectedReturnValue.ts', { '../../lib/philippineTime': pht });
const { checkUnavailabilityForm } = load('../../lib/unavailability.ts', { './philippineTime': pht });
const check = (returnValue, kind = 'truck', nowMs = Date.parse('2026-11-10T12:00:00+08:00')) => checkUnavailabilityForm({ kind, reason: kind === 'truck' ? 'maintenance' : 'sick', note: '', returnValue, nowMs });

test('date then time retains the existing optional submission contract in PHT', () => {
  const dateOnly = withDate('', '2026-11-11');
  assert.equal(dateOnly, '2026-11-11T');
  assert.match(check(dateOnly).errors.returnAt, /valid/);
  const complete = withTime(dateOnly, '00:30');
  assert.equal(complete, '2026-11-11T00:30');
  assert.equal(check(complete).expectedReturn.toISOString(), '2026-11-10T16:30:00.000Z');
  assert.equal(check(complete, 'driver').expectedReturn.toISOString(), '2026-11-10T16:30:00.000Z');
});

test('the current Philippine month is the last reachable previous-month boundary', () => {
  assert.equal(isAtOrBeforeMinMonth(2026, 8, '2026-11-11'), true); // September
  assert.equal(isAtOrBeforeMinMonth(2026, 9, '2026-11-11'), true); // October
  assert.equal(isAtOrBeforeMinMonth(2026, 10, '2026-11-11'), true); // November
  assert.equal(isAtOrBeforeMinMonth(2026, 11, '2026-11-11'), false); // December
  assert.equal(isAtOrBeforeMinMonth(2027, 0, '2026-11-11'), false);
});

test('time first remains incomplete until a date is chosen', () => {
  const timeOnly = withTime('', '17:45');
  assert.equal(timeOnly, 'T17:45');
  assert.match(check(timeOnly).errors.returnAt, /valid/);
  assert.equal(withDate(timeOnly, '2026-11-12'), '2026-11-12T17:45');
});

test('calendar Clear removes both optional parts; empty return remains valid', () => {
  assert.equal(withDate('2026-11-12T17:45', ''), '');
  assert.equal(withTime('', ''), '');
  assert.equal(check('').expectedReturn, null);
  assert.equal(check('', 'driver').expectedReturn, null);
});

test('invalid or half-typed date does not silently become an empty optional return', () => {
  const bad = withDate('2026-11-12T17:45', '', true);
  assert.equal(bad, 'invalid');
  assert.match(check(bad).errors.returnAt, /valid/);
});

test('both mark dialogs use the compact shared controls and Philippine minimum date; edit and coverage remain unchanged', () => {
  const source = readFileSync(join(__dirname, 'UnavailabilityDialog.tsx'), 'utf8');
  assert.match(source, /useExpectedReturnPicker = mode === 'mark'/);
  assert.match(source, /useExpectedReturnPicker \? <div className="grid min-w-0 grid-cols-2 gap-2"[\s\S]*?<DateField[\s\S]*?<TimeField[\s\S]*?: <input id="unavailable-return" type="datetime-local"/);
  assert.match(source, /popoverSide="top"/);
  assert.match(source, /minIso=\{todayPht\} calendarToday=\{todayPht\} restrictToday constrainMinMonth/);
  assert.match(source, /const submittedAt = Date\.now\(\);[\s\S]*?checkUnavailabilityForm\(\{ kind, reason: isDriver \? reason : 'maintenance', note, returnValue, originalReturnAt: initial\?\.expectedReturnAt, nowMs: submittedAt \}\)/);
  const fields = readFileSync(join(__dirname, 'ScheduleFields.tsx'), 'utf8');
  assert.match(fields, /const today = constrainMinMonth \? philippineDateKey\(new Date\(\)\) : calendarToday \?\? todayIso\(\);[\s\S]*?const effectiveMinIso = constrainMinMonth/);
  assert.match(fields, /disabled=\{constrainMinMonth && atMinMonth\} aria-label="Previous month"/);
  assert.match(fields, /const disabled = \(!!min && cell < min\)/);
});

test('incomplete, invalid, and past expected returns get clear inline messages', () => {
  const dateOnly = withDate('', '2026-11-11');
  const timeOnly = withTime('', '17:45');
  assert.equal(expectedReturnError(dateOnly, check(dateOnly).errors.returnAt), 'Please select both a date and time, or leave both empty.');
  assert.equal(expectedReturnError(timeOnly, check(timeOnly).errors.returnAt), 'Please select both a date and time, or leave both empty.');
  assert.equal(expectedReturnError('invalid', check('invalid').errors.returnAt), 'Enter a valid return date and time.');
  const past = '2026-11-09T12:00';
  const nowMs = Date.parse('2026-11-10T12:00:00+08:00');
  assert.equal(expectedReturnError(past, check(past).errors.returnAt, nowMs), 'Please select today or a future date.');
  assert.equal(expectedReturnError(past, check(past, 'driver').errors.returnAt, nowMs), 'Please select today or a future date.');
});

test('today requires a strictly future Philippine time in both dialogs', () => {
  const nowMs = Date.parse('2026-11-11T15:30:00+08:00');
  for (const kind of ['driver', 'truck']) {
    for (const time of ['14:00', '15:30']) {
      const value = `2026-11-11T${time}`;
      assert.equal(check(value, kind, nowMs).ok, false);
      assert.equal(expectedReturnError(value, check(value, kind, nowMs).errors.returnAt, nowMs), 'Expected return must be later than the current Philippine time.');
    }
    assert.equal(check('2026-11-11T16:00', kind, nowMs).ok, true);
    assert.equal(check('2026-11-12T09:00', kind, nowMs).ok, true);
    assert.equal(check('', kind, nowMs).ok, true);
  }
});

test('past dates, missing halves, and invalid dates cannot be submitted', () => {
  const nowMs = Date.parse('2026-11-11T15:30:00+08:00');
  for (const kind of ['driver', 'truck']) {
    for (const value of ['2026-11-10T23:59', '2026-11-12T', 'T09:00', '2026-02-30T10:00']) {
      assert.equal(check(value, kind, nowMs).ok, false);
    }
  }
  assert.equal(withDate('2026-11-10T23:59', ''), '');
  assert.equal(check(withDate('2026-11-10T23:59', ''), 'truck', nowMs).ok, true);
});

test('Philippine midnight changes today and a previously valid selection becomes invalid', () => {
  const before = Date.parse('2026-11-11T23:59:00+08:00');
  const after = Date.parse('2026-11-12T00:01:00+08:00');
  const value = '2026-11-12T00:00';
  assert.equal(pht.philippineDateKey(new Date(before)), '2026-11-11');
  assert.equal(pht.philippineDateKey(new Date(after)), '2026-11-12');
  assert.equal(check(value, 'driver', before).ok, true);
  assert.equal(check(value, 'driver', after).ok, false);
  assert.equal(expectedReturnError(value, check(value, 'driver', after).errors.returnAt, after), 'Expected return must be later than the current Philippine time.');
});

test('foreign device timezone does not change the Philippine return instant or validation', () => {
  const original = process.env.TZ;
  try {
    const nowMs = Date.parse('2026-11-11T15:30:00+08:00');
    const result = [];
    for (const zone of ['Asia/Manila', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      result.push({
        today: pht.philippineDateKey(new Date(nowMs)),
        past: check('2026-11-11T15:30', 'truck', nowMs).ok,
        future: check('2026-11-11T16:00', 'truck', nowMs).expectedReturn?.toISOString(),
      });
    }
    assert.deepEqual(result[0], result[1]);
    assert.deepEqual(result[0], { today: '2026-11-11', past: false, future: '2026-11-11T08:00:00.000Z' });
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
