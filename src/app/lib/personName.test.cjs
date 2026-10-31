const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'personName.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { isValidPersonName } = moduleForTest.exports;

test('ordinary and Filipino names are accepted, including Ñ and accents', () => {
  for (const name of ['Sofia Petrov', 'Juan dela Cruz', 'Peña', 'Niño', 'PEÑAFLORIDA', 'Ñandú', 'José Rizal',
    "Ma. Cristina O'Brien", 'Anne-Marie', ' Padded Name ']) {
    assert.equal(isValidPersonName(name), true, name);
  }
});

test('digits, symbols, emoji and a non-letter start are rejected', () => {
  for (const name of ['', '   ', 'test244#', '123456', 'John@Doe', 'Ann_Lee', 'A/B', 'Name!', 'Tom 🚚', '.Dot', "'Quote", '-Dash',
    '<script>', 'Juan;DROP', 'a'.repeat(101)]) {
    assert.equal(isValidPersonName(name), false, name);
  }
});
