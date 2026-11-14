const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, 'DriverInterface.tsx'), 'utf8');
const cue = source.match(/useEffect\(\(\) => \{\s*const assignment = data\?\.assignment;[\s\S]*?\}, \[screen, driverId, data\?\.assignment\?\.id, data\?\.assignment\?\.taskStatus\]\);/)?.[0];

test('the details cue is scoped to the first view of an Assigned task per driver and assignment', () => {
  assert.ok(cue, 'Missing assignment details cue');
  assert.match(cue, /screen !== 'task' \|\| !assignment \|\| assignment\.taskStatus !== 'Assigned'/);
  assert.match(cue, /360_driver_details_seen:\$\{driverId\}:\$\{assignment\.id\}/);
  assert.match(cue, /sessionStorage\.getItem\(key\)/);
  assert.match(cue, /sessionStorage\.setItem\(key, '1'\)/);
  assert.doesNotMatch(cue, /data\?\.assignment\?\.operationalStage|lastSync|timingNow/);
});

test('the existing accordion opens and scrolls below the sticky header without interrupting editing', () => {
  assert.match(cue, /focused\.matches\('input, textarea, select, \[contenteditable="true"\]'\)/);
  assert.match(cue, /activeDrawer \|\| photoTarget \|\| operationalPhotoTarget/);
  assert.match(cue, /details\.open = true/);
  assert.match(cue, /taskHeaderRef\.current\?\.getBoundingClientRect\(\)\.bottom/);
  assert.match(cue, /prefers-reduced-motion: reduce/);
  assert.match(source, /<details ref=\{deliveryDetailsRef\} className=\{`group rounded-2xl border/);
  assert.match(source, /border-green-500 bg-green-50\/40/);
  assert.match(cue, /setTimeout\(\(\) => setHighlightDeliveryDetails\(false\), 2200\)/);
});
