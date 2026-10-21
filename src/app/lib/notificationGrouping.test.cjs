const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'notificationGrouping.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { groupNotifications } = moduleForTest.exports;

const now = new Date('2026-10-22T10:00:00Z'); // Oct 22, 6 PM in Manila
const notification = (id, createdAt, timestamp = 'Oct 22, 02:29 AM') => ({ id, createdAt, timestamp });
const ids = (group) => group.items.map((item) => item.id);

test('groups in Today, Yesterday, Earlier order and sorts newest first before limiting', () => {
  const items = [
    notification('old', '2026-10-20T08:00:00Z'),
    notification('yesterday', '2026-10-21T11:17:00Z'),
    notification('today-early', '2026-10-21T17:15:00Z'),
    notification('today-late', '2026-10-21T18:29:00Z'),
  ];
  const groups = groupNotifications(items, now);
  assert.deepEqual(groups.map((group) => group.label), ['Today', 'Yesterday', 'Earlier']);
  assert.deepEqual(groups.map(ids), [['today-late', 'today-early'], ['yesterday'], ['old']]);
  assert.deepEqual(groupNotifications(items, now, 2).map(ids), [['today-late', 'today-early']]);
});

test('omits empty groups and does not use a yearless display label for grouping', () => {
  const todayOnly = groupNotifications([notification('today', '2026-10-22T02:29:00+08:00')], now);
  assert.deepEqual(todayOnly.map((group) => group.label), ['Today']);
  const olderOnly = groupNotifications([
    notification('old', '2026-10-20T08:00:00Z'),
    notification('yesterday', '2026-10-21T11:17:00Z'),
  ], now);
  assert.deepEqual(olderOnly.map((group) => group.label), ['Yesterday', 'Earlier']);
  assert.deepEqual(groupNotifications([], now), []);
});

test('uses Manila day boundaries and moves Today to Yesterday after midnight', () => {
  const item = notification('near-midnight', '2026-10-22T15:59:00Z');
  assert.equal(groupNotifications([item], new Date('2026-10-22T15:59:30Z'))[0].label, 'Today');
  assert.equal(groupNotifications([item], new Date('2026-10-22T16:00:30Z'))[0].label, 'Yesterday');
  assert.equal(groupNotifications([notification('after', '2026-10-22T16:01:00Z')], new Date('2026-10-22T16:02:00Z'))[0].label, 'Today');
});

test('sorts by full timestamp down to milliseconds and preserves input order for exact ties', () => {
  const groups = groupNotifications([
    notification('earlier-second', '2026-10-22T02:29:00.001Z'),
    notification('tie-a', '2026-10-22T02:29:00.999Z'),
    notification('tie-b', '2026-10-22T02:29:00.999Z'),
    notification('later-second', '2026-10-22T02:29:01.000Z'),
  ], now);
  assert.deepEqual(ids(groups[0]), ['later-second', 'tie-a', 'tie-b', 'earlier-second']);
});
