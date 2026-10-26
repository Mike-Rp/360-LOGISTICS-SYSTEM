const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'passwordFormError.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { validatePasswordForm, passwordUpdateError } = moduleForTest.exports;

test('local validation identifies only the field requiring correction', () => {
  assert.deepEqual(validatePasswordForm('', 'StrongPass123', 'StrongPass123'),
    { field: 'current', message: 'Enter your current password.' });
  assert.deepEqual(validatePasswordForm('old', 'short', 'short'),
    { field: 'new', message: 'New password must be at least 8 characters.' });
  assert.deepEqual(validatePasswordForm('old', 'StrongPass123', 'DifferentPass123'),
    { field: 'confirm', message: 'New passwords do not match.' });
  assert.equal(validatePasswordForm('old', 'StrongPass123', 'StrongPass123'), null);
});

test('backend password errors distinguish input errors from session and network failures', () => {
  assert.equal(passwordUpdateError('wrong_current').field, 'current');
  assert.equal(passwordUpdateError('same_password').field, 'new');
  assert.equal(passwordUpdateError('weak_password').field, 'new');
  assert.equal(passwordUpdateError('not_signed_in').field, 'general');
  assert.equal(passwordUpdateError('network').field, 'general');
  assert.equal(passwordUpdateError('wrong_current').message, 'Your current password is incorrect.');
});
