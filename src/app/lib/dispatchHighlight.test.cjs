const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'dispatchHighlight.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', source)(moduleUnderTest, moduleUnderTest.exports);
const { advanceDispatchHighlight, dispatchHighlightPage } = moduleUnderTest.exports;

test('targets the exact assignment ID on its filtered page', () => {
  const ids = ['old-1', 'old-2', 'old-3', 'old-4', 'old-5', 'old-6', 'new-actual-id'];
  assert.equal(dispatchHighlightPage('new-actual-id', ids, 6), 2);
  assert.equal(dispatchHighlightPage('old-2', ids, 6), 1);
});

test('does not substitute an existing assignment when a filter hides the new ID', () => {
  assert.equal(dispatchHighlightPage('new-actual-id', ['old-assigned-id'], 6), null);
});

test('polling and reorder still target the same assignment ID', () => {
  assert.equal(dispatchHighlightPage('new-actual-id', ['other', 'new-actual-id', 'older'], 6), 1);
  assert.equal(dispatchHighlightPage('new-actual-id', ['new-actual-id', 'other', 'older'], 6), 1);
});

test('hold fades after its timer, then clears; reduced motion clears directly', () => {
  const hold = { id: 'new-actual-id', phase: 'hold' };
  const fade = advanceDispatchHighlight(hold, hold);
  assert.deepEqual(fade, { id: 'new-actual-id', phase: 'fade' });
  assert.equal(advanceDispatchHighlight(fade, fade), null);
  assert.equal(advanceDispatchHighlight(hold, hold, true), null);
});

test('an old timer cannot change a newer dispatch highlight', () => {
  const old = { id: 'old-id', phase: 'hold' };
  const newer = { id: 'new-actual-id', phase: 'hold' };
  assert.equal(advanceDispatchHighlight(newer, old), newer);
  assert.equal(advanceDispatchHighlight(newer, { id: newer.id, phase: 'fade' }), newer);
});
