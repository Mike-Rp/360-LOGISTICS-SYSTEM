const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'assignmentOperational.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
const { getAdminOperationalProgress, formatOperationalDuration, formatOperationalStamp, OPERATIONAL_PHOTO_GROUPS } = loaded.exports;

const item = (taskStatus, operationalStage = null, extra = {}) => ({ taskStatus, operationalStage, ...extra });

test('admin stage follows persisted operational progress and keeps terminal status separate', () => {
  assert.deepEqual([item('Assigned'), item('Assigned', 'pickup_arrived'), item('Picked Up', 'loading'),
    item('Picked Up', 'loaded'), item('In Transit'), item('In Transit', 'destination_arrived'),
    item('In Transit', 'unloading'), item('Delivered', 'unloaded')]
    .map(a => getAdminOperationalProgress(a).index), [0, 1, 2, 2, 3, 4, 5, 6]);
  assert.equal(getAdminOperationalProgress(item('Cancelled', 'loading')).badge, null);
  assert.equal(getAdminOperationalProgress(item('Delivered', 'unloaded')).badge, null);
});

test('admin view exposes incomplete second status writes rather than relabeling them', () => {
  const departed = getAdminOperationalProgress(item('Picked Up', null, { departedAt: '2026-10-19T00:00:00Z' }));
  assert.equal(departed.badge, null);
  assert.match(departed.syncWarning, /In Transit status has not synced/);
  const unloaded = getAdminOperationalProgress(item('In Transit', 'unloaded'));
  assert.equal(unloaded.badge, null);
  assert.match(unloaded.syncWarning, /Delivered status has not synced/);
});

test('duration and Philippine timestamp use real server times', () => {
  assert.equal(formatOperationalDuration('2026-10-18T17:55:00Z', '2026-10-18T18:03:00Z'), '8 min');
  assert.equal(formatOperationalDuration('2026-10-18T17:55:00Z', '2026-10-18T17:55:30Z'), '<1 min');
  assert.equal(formatOperationalDuration('2026-10-18T17:55:00Z', '2026-10-18T17:54:00Z'), null);
  assert.match(formatOperationalStamp('2026-10-18T17:55:00Z'), /Oct 19, 2026.*1:55 AM/);
  assert.equal(formatOperationalStamp(null), null);
});

test('photo categories remain distinct from formal documents', () => {
  const keys = OPERATIONAL_PHOTO_GROUPS.flatMap(group => group.slots.map(([key]) => key));
  assert.equal(new Set(keys).size, 12);
  assert.ok(keys.includes('loading_after'));
  assert.ok(keys.includes('pretrip_rear'));
});
