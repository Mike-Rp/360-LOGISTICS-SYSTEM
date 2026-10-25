const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = ts.transpileModule(readFileSync(join(__dirname, 'LimitedTextCounter.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { LimitedTextCounter, STANDARD_REMARK_LIMIT, validRequiredLimitedText, withinTextLimit } = moduleForTest.exports;

test('255-character validation covers empty, whitespace, and paste-sized values', () => {
  assert.equal(STANDARD_REMARK_LIMIT, 255);
  assert.equal(validRequiredLimitedText(''), false);
  assert.equal(validRequiredLimitedText('   '), false);
  assert.equal(validRequiredLimitedText('a'.repeat(255)), true);
  assert.equal(validRequiredLimitedText('a'.repeat(256)), false);
  assert.equal(withinTextLimit('a'.repeat(255)), true);
  assert.equal(withinTextLimit('a'.repeat(256)), false);
});

test('live counter renders the current length and near-limit states', () => {
  const render = (length) => renderToStaticMarkup(React.createElement(LimitedTextCounter, { value: 'a'.repeat(length) }));
  assert.match(render(0), />0\/255</);
  assert.match(render(229), /text-muted-foreground.*>229\/255</);
  assert.match(render(230), /text-amber-600.*>230\/255</);
  assert.match(render(255), /text-amber-700.*>255\/255</);
  assert.match(renderToStaticMarkup(React.createElement(LimitedTextCounter, { value: 'a'.repeat(150), max: 150 })), /text-amber-700.*>150\/150</);
});
