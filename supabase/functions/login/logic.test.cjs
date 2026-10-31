// Login lockout — unit tests for the `login` Edge Function's decision logic.
// Run: node --test supabase/functions/login/logic.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'logic.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { login, validateRequest } = moduleForTest.exports;

const SESSION = { access_token: 'a', refresh_token: 'r' };

/* A fake that mirrors the database rule: 5 failures lock for 300 s; a lock rejects all. */
function fakeBackend({ password = 'right', lockedFor = 0, lockCheckFails = false, recordFails = false, successFails = false, signInKind = null } = {}) {
  const state = { failures: 0, locked: lockedFor, signIns: 0, cleared: 0, logs: [] };
  const deps = {
    async lockSeconds() { if (lockCheckFails) throw new Error('db'); return state.locked; },
    async signIn(_email, pw) {
      state.signIns += 1;
      if (signInKind) return { ok: false, kind: signInKind };
      return pw === password ? { ok: true, session: SESSION } : { ok: false, kind: 'invalid' };
    },
    async recordFailure() {
      if (recordFails) throw new Error('db');
      state.failures += 1;
      if (state.failures >= 5) state.locked = 300;
      return state.locked;
    },
    async recordSuccess() { if (successFails) throw new Error('db'); state.failures = 0; state.cleared += 1; },
    log(event) { state.logs.push(event); },
  };
  return { state, deps };
}
const attempt = (deps, pw = 'wrong') => login({ email: 'Staff@Example.com', password: pw }, deps);

test('request validation: shape, normalised email, bounds', () => {
  assert.deepEqual(validateRequest({ email: ' A@B.CO ', password: 'x' }), { ok: true, email: 'a@b.co', password: 'x' });
  for (const bad of [null, [], 'x', {}, { email: 'a@b.co' }, { password: 'x' }, { email: 1, password: 'x' },
    { email: 'a@b.co', password: '' }, { email: 'ab', password: 'x' },
    { email: 'a'.repeat(321), password: 'x' }, { email: 'a@b.co', password: 'p'.repeat(201) }]) {
    assert.deepEqual(validateRequest(bad), { ok: false });
  }
});

test('a correct password signs in, returns the session and clears the counter', async () => {
  const { state, deps } = fakeBackend();
  const result = await attempt(deps, 'right');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { session: SESSION });
  assert.equal(state.cleared, 1);
});

test('failures 1-4 are plain invalid credentials; the 5th locks for 5 minutes', async () => {
  const { state, deps } = fakeBackend();
  for (let i = 1; i <= 4; i++) {
    const result = await attempt(deps);
    assert.equal(result.status, 401, `failure ${i}`);
    assert.deepEqual(result.body, { error: 'invalid_credentials' });
  }
  const fifth = await attempt(deps);
  assert.equal(fifth.status, 429);
  assert.deepEqual(fifth.body, { error: 'locked', retryAfterSeconds: 300 });
  assert.equal(state.failures, 5);
});

test('while locked, even the right password is refused and Auth is never asked', async () => {
  const { state, deps } = fakeBackend({ lockedFor: 120 });
  const result = await attempt(deps, 'right');
  assert.equal(result.status, 429);
  assert.deepEqual(result.body, { error: 'locked', retryAfterSeconds: 120 });
  assert.equal(state.signIns, 0);
  assert.equal(state.failures, 0);
});

test('a success before the 5th failure resets the count', async () => {
  const { state, deps } = fakeBackend();
  for (let i = 0; i < 4; i++) await attempt(deps);
  assert.equal((await attempt(deps, 'right')).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await attempt(deps)).status, 401);
  assert.equal(state.failures, 4);
});

test('if the lock cannot be checked, the login is refused (fails closed)', async () => {
  const { state, deps } = fakeBackend({ lockCheckFails: true });
  const result = await attempt(deps, 'right');
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: 'server' });
  assert.equal(state.signIns, 0);
  assert.deepEqual(state.logs, ['lock_check_failed']);
});

test('a failure that cannot be counted still reports a normal wrong password', async () => {
  const { deps } = fakeBackend({ recordFails: true });
  const result = await attempt(deps);
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: 'invalid_credentials' });
});

test('failing to clear the counter never fails a successful login', async () => {
  const { state, deps } = fakeBackend({ successFails: true });
  const result = await attempt(deps, 'right');
  assert.equal(result.status, 200);
  assert.deepEqual(state.logs, ['record_success_failed']);
});

test('Auth rate limits and outages are not counted as failed attempts', async () => {
  for (const [kind, status, error] of [['rate_limited', 429, 'rate_limited'], ['error', 502, 'server']]) {
    const { state, deps } = fakeBackend({ signInKind: kind });
    const result = await attempt(deps);
    assert.equal(result.status, status);
    assert.deepEqual(result.body, { error });
    assert.equal(state.failures, 0);
  }
});

test('a malformed request is rejected before anything else happens', async () => {
  const { state, deps } = fakeBackend();
  const result = await login({ email: 'a@b.co' }, deps);
  assert.equal(result.status, 400);
  assert.equal(state.signIns, 0);
});
