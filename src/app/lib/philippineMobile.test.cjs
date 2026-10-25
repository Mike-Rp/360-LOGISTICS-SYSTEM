const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'philippineMobile.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
const { parsePhilippineMobile } = loaded.exports;

test('supported stored formats share one display, subscriber copy, and call target', () => {
  for (const stored of ['+639111222333', '09111222333', '9111222333', '+63 911 122 2333']) {
    assert.deepEqual(parsePhilippineMobile(stored), {
      subscriber: '9111222333',
      display: '+63 9111222333',
      international: '+639111222333',
    });
  }
});

test('invalid or overlong stored values cannot become shortened copy or call targets', () => {
  for (const stored of ['', '—', '0911122233', '08111222333', '+6391112223334', 'abc09111222333', '+09111222333']) {
    assert.equal(parsePhilippineMobile(stored), null, stored);
  }
});
