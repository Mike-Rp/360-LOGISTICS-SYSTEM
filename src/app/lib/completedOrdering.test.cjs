const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'completedOrdering.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(
  () => ({ parseStoredTimestamp: value => Number.isFinite(Date.parse(value)) ? new Date(value) : null }),
  loaded, loaded.exports,
);

test('completed records sort by final completion time, with missing times last', () => {
  const records = [
    { id: 'ASN86830', completedAt: '2026-10-20T16:09:00Z', createdAt: '2026-10-21T00:00:00Z' },
    { id: 'legacy', completedAt: '' },
    { id: 'ASN43090', completedAt: '2026-10-20T19:37:00Z' },
    { id: 'ASN73945', completedAt: '2026-10-20T16:50:00Z' },
  ];
  assert.deepEqual(loaded.exports.sortCompletedNewestFirst(records).map(record => record.id),
    ['ASN43090', 'ASN73945', 'ASN86830', 'legacy']);
  assert.equal(records[0].id, 'ASN86830');
});

test('the full completion audit timestamp wins over a yearless label', () => {
  const records = [
    { id: 'older', completedAt: 'Oct 22, 04:00 PM', completedEventAt: '2025-10-22T08:00:00Z' },
    { id: 'newer', completedAt: 'Oct 20, 04:09 PM', completedEventAt: '2026-10-20T08:09:00Z' },
    { id: 'no-year', completedAt: 'Oct 21, 01:00 PM' },
  ];
  assert.deepEqual(loaded.exports.sortCompletedNewestFirst(records).map(record => record.id),
    ['newer', 'older', 'no-year']);
});
