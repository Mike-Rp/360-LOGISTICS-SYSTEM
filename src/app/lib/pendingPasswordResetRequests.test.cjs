const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'pendingPasswordResetRequests.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { pendingPasswordResetRequests, pageForPasswordResetRequest } = moduleForTest.exports;

test('only real pending request IDs become review actions, once per ID', () => {
  const request = (id, status) => ({ id, status, requestedAt: '2026-10-26T08:00:00Z' });
  const records = [request('one', 'pending'), request('one', 'pending'), request('two', 'approved'),
    request('three', 'rejected'), request('four', 'completed'), request('five', 'expired'),
    request('', 'pending'), request('six', 'pending')];
  assert.deepEqual(pendingPasswordResetRequests(records).map((item) => item.id), ['one', 'six']);
  assert.deepEqual(pendingPasswordResetRequests(records).map((item) => item.id), ['one', 'six']);
  assert.equal(pendingPasswordResetRequests(records.filter((item) => item.status !== 'pending')).length, 0);
});

test('request targeting locates the exact row across review pages', () => {
  const requests = Array.from({ length: 23 }, (_, index) => ({ id: `request-${index + 1}` }));
  assert.equal(pageForPasswordResetRequest(requests, 'request-1', 10), 1);
  assert.equal(pageForPasswordResetRequest(requests, 'request-11', 10), 2);
  assert.equal(pageForPasswordResetRequest(requests, 'request-23', 10), 3);
  assert.equal(pageForPasswordResetRequest(requests, 'missing', 10), null);
});
