const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'reportPdfFilename.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
const { reportPdfPrintTitle } = loaded.exports;

test('all report types use their descriptive print title', () => {
  const time = new Date('2026-11-05T08:45:22Z');
  const names = {
    weekly: 'Weekly-Performance', monthly: 'Monthly-Delivery-Summary',
    utilization: 'Fleet-Driver-Utilization', delay: 'Delay-Issues',
  };
  for (const [type, name] of Object.entries(names)) {
    assert.equal(reportPdfPrintTitle(type, time), `360LOGISTICS_${name}_2026-11-05_164522`);
  }
});

test('Philippine midnight and unique report IDs are reflected safely', () => {
  assert.equal(reportPdfPrintTitle('weekly', new Date('2026-11-05T16:00:01Z'), 'REQ/1'),
    '360LOGISTICS_Weekly-Performance_2026-11-06_000001_REQ1');
  assert.notEqual(reportPdfPrintTitle('weekly', new Date('2026-11-05T08:45:22Z'), 'A'),
    reportPdfPrintTitle('weekly', new Date('2026-11-05T08:45:22Z'), 'B'));
});
