const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'reportHistoryPaging.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
const { reportPageOffset, reportTotalPages, clampReportPage } = loaded.exports;

test('first, middle and last report pages have correct offsets', () => {
  assert.equal(reportPageOffset(1, 10), 0);
  assert.equal(reportPageOffset(2, 10), 10);
  assert.equal(reportPageOffset(25, 10), 240);
  assert.equal(reportTotalPages(250, 10), 25);
});

test('empty, partial and exact pages have correct totals', () => {
  for (const [total, pages] of [[0, 1], [9, 1], [10, 1], [11, 2], [20, 2]]) {
    assert.equal(reportTotalPages(total, 10), pages);
  }
});

test('pages outside the available history clamp to valid pages', () => {
  assert.equal(clampReportPage(9, 11, 10), 2);
  assert.equal(clampReportPage(2, 10, 10), 1);
  assert.equal(clampReportPage(0, 0, 10), 1);
});
