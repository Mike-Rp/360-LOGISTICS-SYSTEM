const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'resetPasswordFeedback.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { normalizeCsrPasswordResetError, resetPasswordFeedback, validateResetPassword, clearResetPasswordFeedback } = moduleForTest.exports;

test('the client preserves an explicit password_reused response', () => {
  assert.equal(normalizeCsrPasswordResetError('password_reused'), 'password_reused');
  assert.deepEqual(resetPasswordFeedback('password_reused'), {
    field: 'new', message: 'Your new password must be different from your current password.',
  });
  assert.deepEqual(resetPasswordFeedback('unexpected_backend_code'), resetPasswordFeedback('reset_failed'));
});

test('existing reset errors identify the responsible field', () => {
  for (const code of ['password_too_short', 'password_too_long', 'weak_password']) {
    assert.equal(resetPasswordFeedback(code).field, 'new');
  }
  for (const code of ['reset_link_invalid_or_expired', 'invalid_request', 'reset_failed']) {
    assert.equal(resetPasswordFeedback(code).field, 'general');
  }
});

test('local validation preserves the existing limits and targets confirmation mismatch', () => {
  assert.deepEqual(validateResetPassword('', ''), { field: 'new', message: 'Enter a new password.' });
  assert.deepEqual(validateResetPassword('short', 'short'), { field: 'new', message: 'Password is too short.' });
  assert.deepEqual(validateResetPassword('é'.repeat(37), 'é'.repeat(37)), { field: 'new', message: 'Password is too long.' });
  assert.deepEqual(validateResetPassword('valid-new', 'different'), { field: 'confirm', message: 'Passwords do not match.' });
  assert.equal(validateResetPassword('valid-new', 'valid-new'), null);
});

test('editing only the affected input clears a recoverable error', () => {
  const reused = resetPasswordFeedback('password_reused');
  assert.equal(clearResetPasswordFeedback(reused, 'confirm'), reused);
  assert.equal(clearResetPasswordFeedback(reused, 'new'), null);
  const mismatch = validateResetPassword('valid-new', 'different');
  assert.equal(clearResetPasswordFeedback(mismatch, 'new'), mismatch);
  assert.equal(clearResetPasswordFeedback(mismatch, 'confirm'), null);
});
