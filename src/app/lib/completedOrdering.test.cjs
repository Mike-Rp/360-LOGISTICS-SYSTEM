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

test('driver history sorts real completion instants before filtering and pagination', () => {
  const records = [
    { id: 'ASN80630', completedAt: 'Oct 20, 04:00 PM', completedEventAt: '2026-10-20T08:00:00Z', company: 'Acme' },
    { id: 'unknown', completedAt: 'Oct 20, 04:00 PM', company: 'Acme' },
    { id: 'ASN56038', completedAt: 'Nov 2, 09:00 AM', completedEventAt: '2026-11-02T01:00:00Z', company: 'Acme' },
    { id: 'same-day-later', completedAt: 'Nov 2, 10:00 AM', completedEventAt: '2026-11-02T02:00:00Z', company: 'Other' },
  ];
  const filtered = records.filter(record => record.company === 'Acme');
  assert.deepEqual(loaded.exports.sortCompletedNewestFirst(filtered).map(record => record.id),
    ['ASN56038', 'ASN80630', 'unknown']);
  assert.deepEqual(loaded.exports.sortCompletedNewestFirst(records).slice(0, 2).map(record => record.id),
    ['same-day-later', 'ASN56038']);
});

test('recent completed scope includes all of today and yesterday, newest first, without the five-row preview limit', () => {
  const now = new Date(2026, 10, 20, 12);
  const stamp = (day, hour) => new Date(2026, 10, day, hour).toISOString();
  const records = [
    { id: 'old', completedAt: stamp(18, 23), completedEventAt: stamp(18, 23) },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `today-${i}`, completedAt: stamp(20, i + 1), completedEventAt: stamp(20, i + 1) })),
    { id: 'yesterday', completedAt: stamp(19, 8), completedEventAt: stamp(19, 8) },
    { id: 'missing', completedAt: '' },
  ];
  const recent = loaded.exports.recentCompletedDeliveries(records, now);
  assert.deepEqual(recent.map(({ assignment }) => assignment.id),
    ['today-5', 'today-4', 'today-3', 'today-2', 'today-1', 'today-0', 'yesterday']);
  assert.equal(records[0].id, 'old');
  assert.deepEqual(loaded.exports.recentCompletedDeliveries([...records, {
    id: 'new-completion', completedAt: stamp(20, 11), completedEventAt: stamp(20, 11),
  }], now).map(({ assignment }) => assignment.id)[0], 'new-completion');
});

test('recent scope uses the same completion label for membership and full completion event for ordering', () => {
  const now = new Date(2026, 10, 20, 12);
  const recent = loaded.exports.recentCompletedDeliveries([
    { id: 'created-today-but-completed-earlier', createdAt: '2026-11-20T01:00:00Z',
      completedAt: new Date(2026, 10, 18, 9).toISOString(), completedEventAt: new Date(2026, 10, 18, 9).toISOString() },
    { id: 'latest', completedAt: new Date(2026, 10, 20, 9).toISOString(), completedEventAt: new Date(2026, 10, 20, 10).toISOString() },
    { id: 'earlier', completedAt: new Date(2026, 10, 20, 8).toISOString(), completedEventAt: new Date(2026, 10, 20, 8).toISOString() },
  ], now);
  assert.deepEqual(recent.map(({ assignment }) => assignment.id), ['latest', 'earlier']);
});
