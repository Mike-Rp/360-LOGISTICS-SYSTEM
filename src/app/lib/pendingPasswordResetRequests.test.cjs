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
const { pageForPasswordResetRequest } = moduleForTest.exports;

test('request targeting locates the exact row across review pages', () => {
  const requests = Array.from({ length: 23 }, (_, index) => ({ id: `request-${index + 1}` }));
  assert.equal(pageForPasswordResetRequest(requests, 'request-1', 10), 1);
  assert.equal(pageForPasswordResetRequest(requests, 'request-11', 10), 2);
  assert.equal(pageForPasswordResetRequest(requests, 'request-23', 10), 3);
  assert.equal(pageForPasswordResetRequest(requests, 'missing', 10), null);
});
