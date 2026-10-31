const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const load = (file, requireImpl = require) => {
  const source = ts.transpileModule(readFileSync(join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(requireImpl, mod, mod.exports);
  return mod.exports;
};
const philippineMobile = load('philippineMobile.ts');
const { delegationStatus, delegationScopeLabel, accessActive, formatWindowLength, checkCoverageWindow, toLocalInputValue,
  normalizeContactPhone, formatContactPhone } = load('fleetDelegation.ts', (id) => id === './philippineMobile' ? philippineMobile : require(id));

const NOW = new Date('2026-11-10T12:00:00').getTime();
const HOUR = 3_600_000;
const iso = (offsetHours) => new Date(NOW + offsetHours * HOUR).toISOString();

test('status follows the window and a revoke wins over everything', () => {
  assert.equal(delegationStatus({ startsAt: iso(1), endsAt: iso(48), revokedAt: null }, NOW), 'scheduled');
  assert.equal(delegationStatus({ startsAt: iso(-1), endsAt: iso(48), revokedAt: null }, NOW), 'active');
  assert.equal(delegationStatus({ startsAt: iso(-48), endsAt: iso(-1), revokedAt: null }, NOW), 'ended');
  assert.equal(delegationStatus({ startsAt: iso(-48), endsAt: iso(0), revokedAt: null }, NOW), 'ended');   // the end instant is already over
  assert.equal(delegationStatus({ startsAt: iso(-1), endsAt: iso(48), revokedAt: iso(-0.5) }, NOW), 'revoked');
  assert.equal(delegationStatus({ startsAt: iso(1), endsAt: iso(48), revokedAt: iso(-0.5) }, NOW), 'revoked');
});

test('scope label names exactly what was granted', () => {
  assert.equal(delegationScopeLabel({ canResetPin: true, canRegister: false }), 'Reset driver PINs');
  assert.equal(delegationScopeLabel({ canResetPin: false, canRegister: true }), 'Register drivers & trucks');
  assert.equal(delegationScopeLabel({ canResetPin: true, canRegister: true }), 'Reset driver PINs + Register drivers & trucks');
});

test('access is active only while the end is still ahead', () => {
  assert.equal(accessActive(iso(1), NOW), true);
  assert.equal(accessActive(iso(0), NOW), false);
  assert.equal(accessActive(iso(-1), NOW), false);
  assert.equal(accessActive(null, NOW), false);
  assert.equal(accessActive('not a date', NOW), false);
});

test('window length is readable and has no ceiling', () => {
  assert.equal(formatWindowLength(14 * 24 * HOUR), '14 days');
  assert.equal(formatWindowLength(24 * HOUR), '1 day');
  assert.equal(formatWindowLength(14 * 24 * HOUR + 6 * HOUR), '14 days 6 hours');
  assert.equal(formatWindowLength(6 * HOUR), '6 hours');
  assert.equal(formatWindowLength(90 * 60_000), '1 hour 30 minutes');
  assert.equal(formatWindowLength(45 * 60_000), '45 minutes');
  assert.equal(formatWindowLength(400 * 24 * HOUR), '400 days');
});

test('the form window mirrors the database rules', () => {
  const ok = checkCoverageWindow('2026-11-10T12:00', '2026-11-24T18:00', NOW);
  assert.equal(ok.ok, true);
  assert.equal(ok.length, '14 days 6 hours');
  assert.equal(checkCoverageWindow('', '2026-11-24T18:00', NOW).ok, false);
  assert.equal(checkCoverageWindow('2026-11-10T12:00', '', NOW).ok, false);
  assert.equal(checkCoverageWindow('2026-11-12T12:00', '2026-11-11T12:00', NOW).ok, false);   // end before start
  assert.equal(checkCoverageWindow('2026-11-12T12:00', '2026-11-12T12:00', NOW).ok, false);   // empty window
  assert.equal(checkCoverageWindow('2026-11-01T12:00', '2026-11-05T12:00', NOW).ok, false);   // already over
  assert.equal(checkCoverageWindow('garbage', '2026-11-24T18:00', NOW).ok, false);
  // a start in the past is fine as long as the end is ahead ("starts now")
  assert.equal(checkCoverageWindow('2026-11-10T11:00', '2026-11-11T11:00', NOW).ok, true);
});

test('datetime-local value is zero-padded browser-local time', () => {
  assert.equal(toLocalInputValue(new Date(2026, 0, 5, 7, 4)), '2026-01-05T07:04');
  assert.equal(toLocalInputValue(new Date(2026, 10, 24, 18, 0)), '2026-11-24T18:00');
});

test('contact number accepts common Philippine mobile formats and stores the local form', () => {
  for (const raw of ['09171234567', '0917 123 4567', '+63 917 123 4567', '639171234567', '+63-917-123-4567', ' 9171234567 ']) {
    assert.equal(normalizeContactPhone(raw), '09171234567', raw);
  }
});

test('contact number rejects anything that is not a Philippine mobile number', () => {
  for (const raw of ['', '   ', 'not a number', '12345', '0817 123 4567', '+1 917 123 4567', '09171234567890', '0917-ABC-4567']) {
    assert.equal(normalizeContactPhone(raw), null, raw);
  }
});

test('contact number is shown the way a driver reads it', () => {
  assert.equal(formatContactPhone('09171234567'), '0917 123 4567');
  assert.equal(formatContactPhone('0938'), '0938');   // anything unexpected is left alone
});
