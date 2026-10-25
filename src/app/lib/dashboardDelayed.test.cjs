const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'dashboardDelayed.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
const { isDashboardDelayedAssignment } = loaded.exports;

test('delayed destination uses the existing Dashboard card criteria', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const assignment = (taskStatus, deliveryDate, delayReports = []) => ({ taskStatus, deliveryDate, delayReports });
  assert.equal(isDashboardDelayedAssignment(assignment('Assigned', '', [{ reason: 'Traffic' }]), now), true);
  assert.equal(isDashboardDelayedAssignment(assignment('Picked Up', '10/24/2026'), now), true);
  assert.equal(isDashboardDelayedAssignment(assignment('Assigned', '10/27/2026'), now), false);
  assert.equal(isDashboardDelayedAssignment(assignment('Delivered', '10/24/2026', [{ reason: 'Traffic' }]), now), false);
  assert.equal(isDashboardDelayedAssignment(assignment('Cancelled', '10/24/2026'), now), false);
});
