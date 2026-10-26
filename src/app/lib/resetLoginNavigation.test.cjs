const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'resetLoginNavigation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { resetLoginHref, isResetLoginIntent, clearResetTokenFromHistory } = moduleForTest.exports;

test('only the reset-flow staff login URL requests explicit login presentation', () => {
  assert.equal(resetLoginHref, '/login?account=staff&intent=reset-password');
  assert.equal(isResetLoginIntent(new URL(resetLoginHref, 'https://example.test')), true);
  for (const path of ['/login?account=staff', '/login?account=driver&intent=reset-password',
    '/dashboard?account=staff&intent=reset-password', '/login?account=staff&intent=other']) {
    assert.equal(isResetLoginIntent(new URL(path, 'https://example.test')), false, path);
  }
});

test('leaving a reset link removes its token from the current history entry', () => {
  const calls = [];
  global.window = {
    location: { pathname: '/reset-password', search: '?token=private-value' },
    history: { state: { previous: true }, replaceState: (...args) => calls.push(args) },
  };
  try {
    clearResetTokenFromHistory();
    assert.deepEqual(calls, [[{ previous: true }, '', '/reset-password']]);
    window.location.search = '';
    clearResetTokenFromHistory();
    assert.equal(calls.length, 1);
  } finally {
    delete global.window;
  }
});
