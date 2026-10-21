const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'driverCompletion.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
const { observeDriverCompletion } = loaded.exports;

test('historical completed deliveries seed silently on initial load', () => {
  const first = observeDriverCompletion(null, null, [{ id: 'old', completedAt: 'yesterday' }]);
  assert.equal(first.newlyCompleted, null);
  const second = observeDriverCompletion(first.snapshot, null, [{ id: 'old', completedAt: 'yesterday' }]);
  assert.equal(second.newlyCompleted, null);
});

test('the previously active assignment announces completion once', () => {
  const first = observeDriverCompletion(null, 'ASN1', []);
  const completed = [{ id: 'ASN1', completedAt: '2026-10-21T01:42:00Z' }];
  const second = observeDriverCompletion(first.snapshot, null, completed);
  assert.deepEqual(second.newlyCompleted, completed[0]);
  assert.equal(observeDriverCompletion(second.snapshot, null, completed).newlyCompleted, null);
});

test('non-completed status changes and a temporary archive gap do not announce completion', () => {
  const first = observeDriverCompletion(null, 'ASN1', []);
  assert.equal(observeDriverCompletion(first.snapshot, 'ASN1', []).newlyCompleted, null);
  const gap = observeDriverCompletion(first.snapshot, null, []);
  assert.equal(gap.newlyCompleted, null);
  assert.equal(observeDriverCompletion(gap.snapshot, null, [{ id: 'ASN1', completedAt: 'now' }]).newlyCompleted?.id, 'ASN1');
});
