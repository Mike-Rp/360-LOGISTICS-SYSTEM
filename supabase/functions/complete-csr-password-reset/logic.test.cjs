// REQ-006 — unit tests for the complete-csr-password-reset decision logic.
// Run: node --test supabase/functions/complete-csr-password-reset/logic.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');

function loadTypeScript(file) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(require, module, module.exports);
  return module.exports;
}

const logic = loadTypeScript(join(__dirname, 'logic.ts'));

const TOKEN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';
const HASH = createHash('sha256').update(TOKEN).digest('hex');
const PASSWORD = 'n3w-Passw0rd';

/* A fake database + Auth that behaves like the real one: one claim per token. */
function fakeBackend({ tokenHash = HASH, auth = () => ({ ok: true }), finishFails = 0 } = {}) {
  const state = { claimed: false, completed: false, released: 0, finishCalls: 0, password: null, logs: [], calls: [] };
  const deps = {
    async claim(h) {
      state.calls.push(['claim', h]);
      if (h !== tokenHash || state.claimed || state.completed) return null;
      state.claimed = true;
      return { requestId: 'req-1', userId: 'user-1' };
    },
    async setPassword(userId, pw) {
      state.calls.push(['setPassword', userId]);
      const r = auth(pw);
      if (r instanceof Error) throw r;
      if (r.ok) state.password = pw;
      return r;
    },
    async release(id, h) { state.calls.push(['release', id, h]); state.released++; state.claimed = false; },
    async finish(id, h) {
      state.calls.push(['finish', id, h]); state.finishCalls++;
      if (state.finishCalls <= finishFails) throw new Error('db down');
      state.completed = true;
    },
    log(event, detail) { state.logs.push([event, detail]); },
  };
  return { deps, state };
}

test('sha256Hex matches the database encoding (hex of SHA-256 of the token text)', async () => {
  assert.equal(await logic.sha256Hex(TOKEN), HASH);
  assert.equal(await logic.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('valid token + password: claims, changes the password, completes the request', async () => {
  const { deps, state } = fakeBackend();
  const r = await logic.completeReset({ token: TOKEN, newPassword: PASSWORD }, deps);
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.equal(state.password, PASSWORD);
  assert.equal(state.completed, true);
  assert.deepEqual(state.calls.map((c) => c[0]), ['claim', 'setPassword', 'finish']);
  assert.equal(state.calls[0][1], HASH, 'only the hash is sent to the database');
});

test('the raw token and password never reach the database calls or the logs', async () => {
  const { deps, state } = fakeBackend({ auth: () => ({ ok: false, definitive: false, code: 'unexpected' }) });
  await logic.completeReset({ token: TOKEN, newPassword: PASSWORD }, deps);
  const dbCalls = JSON.stringify(state.calls.filter((c) => c[0] !== 'setPassword'));
  const logs = JSON.stringify(state.logs);
  for (const secret of [TOKEN, PASSWORD]) {
    assert.equal(dbCalls.includes(secret), false);
    assert.equal(logs.includes(secret), false);
  }
});

test('a used token cannot be used again', async () => {
  const { deps } = fakeBackend();
  assert.equal((await logic.completeReset({ token: TOKEN, newPassword: PASSWORD }, deps)).status, 200);
  const again = await logic.completeReset({ token: TOKEN, newPassword: 'another-pass' }, deps);
  assert.deepEqual(again, { status: 400, body: { error: 'reset_link_invalid_or_expired' } });
});

test('two simultaneous requests with one token: exactly one changes the password', async () => {
  const { deps, state } = fakeBackend();
  const results = await Promise.all([
    logic.completeReset({ token: TOKEN, newPassword: 'first-pass' }, deps),
    logic.completeReset({ token: TOKEN, newPassword: 'second-pass' }, deps),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal(state.calls.filter((c) => c[0] === 'setPassword').length, 1);
});

test('wrong, random or malformed tokens fail with the same generic error', async () => {
  const { deps, state } = fakeBackend();
  const generic = { status: 400, body: { error: 'reset_link_invalid_or_expired' } };
  assert.deepEqual(await logic.completeReset({ token: 'f'.repeat(64), newPassword: PASSWORD }, deps), generic);
  assert.deepEqual(await logic.completeReset({ token: 'not-a-token', newPassword: PASSWORD }, deps), generic);
  assert.deepEqual(await logic.completeReset({ token: TOKEN.toUpperCase(), newPassword: PASSWORD }, deps), generic);
  assert.equal(state.calls.filter((c) => c[0] === 'setPassword').length, 0);
});

test('password policy is enforced server-side before the token is claimed', async () => {
  const { deps, state } = fakeBackend();
  const err = async (pw) => (await logic.completeReset({ token: TOKEN, newPassword: pw }, deps)).body.error;
  assert.equal(await err(''), 'password_too_short');
  assert.equal(await err('      '), 'password_too_short');
  assert.equal(await err('abc12'), 'password_too_short');
  assert.equal(await err('x'.repeat(73)), 'password_too_long');
  assert.equal(await err('é'.repeat(37)), 'password_too_long', '74 bytes in UTF-8');
  assert.equal(state.calls.length, 0, 'nothing claimed for a rejected password');
});

test('malformed requests are rejected', async () => {
  const { deps } = fakeBackend();
  for (const body of [null, [], 'x', 42, {}, { token: TOKEN }, { newPassword: PASSWORD }, { token: 1, newPassword: PASSWORD }]) {
    assert.deepEqual(await logic.completeReset(body, deps), { status: 400, body: { error: 'invalid_request' } });
  }
});

test('Auth refuses the password (4xx): claim released, same link can be retried', async () => {
  let weak = true;
  const { deps, state } = fakeBackend({ auth: () => (weak ? { ok: false, definitive: true, code: 'weak_password' } : { ok: true }) });
  const first = await logic.completeReset({ token: TOKEN, newPassword: PASSWORD }, deps);
  assert.deepEqual(first, { status: 400, body: { error: 'weak_password' } });
  assert.equal(state.released, 1);
  assert.equal(state.completed, false);
  weak = false;
  const second = await logic.completeReset({ token: TOKEN, newPassword: 'Stronger-Passw0rd!' }, deps);
  assert.equal(second.status, 200);
});

test('unknown Auth failure (network/5xx): link stays used, no release, OPM must copy a new link', async () => {
  const { deps, state } = fakeBackend({ auth: () => new Error('timeout') });
  const r = await logic.completeReset({ token: TOKEN, newPassword: PASSWORD }, deps);
  assert.deepEqual(r, { status: 502, body: { error: 'reset_failed' } });
  assert.equal(state.released, 0);
  const retry = await logic.completeReset({ token: TOKEN, newPassword: PASSWORD }, deps);
  assert.equal(retry.body.error, 'reset_link_invalid_or_expired');
});

test('finish is retried once; password change still reported as done', async () => {
  const a = fakeBackend({ finishFails: 1 });
  assert.equal((await logic.completeReset({ token: TOKEN, newPassword: PASSWORD }, a.deps)).status, 200);
  assert.equal(a.state.finishCalls, 2);
  assert.equal(a.state.completed, true);

  const b = fakeBackend({ finishFails: 5 });
  assert.equal((await logic.completeReset({ token: TOKEN, newPassword: PASSWORD }, b.deps)).status, 200);
  assert.equal(b.state.finishCalls, 2);
  assert.deepEqual(b.state.logs.map((l) => l[0]), ['finish_failed', 'finish_failed']);
});
