const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleForTest = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    (name) => dependencies[name] ?? require(name), moduleForTest, moduleForTest.exports,
  );
  return moduleForTest.exports;
}

const operational = load('assignmentOperational.ts');
const { getPhotoEvidenceDetails, selectOperationalPhoto } = load('photoEvidenceDetails.ts', {
  './assignmentOperational': operational,
});
const value = (rows, label) => rows.find((row) => row.label === label)?.value;

test('complete camera metadata is formatted from the selected saved photo in Manila time', () => {
  const photo = {
    url: 'front.jpg', timestamp: 'Oct 23, 2026 · 4:33 PM', location: 'Makati City',
    coords: { lat: 14.55473, lng: 121.02445 }, gpsAccuracyM: 15.24,
    source: 'camera', uploadedAt: '2026-10-23T08:33:00Z',
    gpsObservedAt: '2026-10-23T08:32:00Z', captureObservedAt: '2026-10-23T08:31:00Z',
  };
  const { rows, locationNote } = getPhotoEvidenceDetails(photo);
  assert.equal(value(rows, 'Recorded Location'), 'Makati City');
  assert.equal(value(rows, 'GPS Coordinates'), '14.55473, 121.02445');
  assert.equal(value(rows, 'GPS Accuracy'), '±15.2 meters');
  assert.equal(value(rows, 'Photo Source'), 'Camera');
  assert.match(value(rows, 'Uploaded At'), /Oct 23, 2026.*4:33 PM/);
  assert.match(value(rows, 'GPS Checked At'), /Oct 23, 2026.*4:32 PM/);
  assert.match(value(rows, 'Photo Received by App'), /Oct 23, 2026.*4:31 PM/);
  assert.equal(locationNote, 'Device location recorded during upload.');
});

test('coordinates alone are shown as the recorded location without an invented address', () => {
  const { rows } = getPhotoEvidenceDetails({ url: 'left.jpg', timestamp: '', location: 'Location unavailable',
    coords: { lat: 14.5, lng: 121 }, source: 'gallery' });
  assert.equal(value(rows, 'Recorded Location'), '14.50000, 121.00000');
  assert.equal(value(rows, 'GPS Coordinates'), undefined);
  assert.equal(value(rows, 'GPS Accuracy'), 'Not available');
});

test('gallery and legacy records never claim original camera provenance', () => {
  const gallery = getPhotoEvidenceDetails({ url: 'gallery.jpg', timestamp: '', location: 'Quezon City',
    source: 'gallery', captureObservedAt: '2026-10-23T08:30:00Z' });
  assert.equal(value(gallery.rows, 'Photo Source'), 'Gallery');
  assert.equal(value(gallery.rows, 'Photo Received by App'), undefined);
  assert.match(gallery.locationNote, /not the original photo location/);

  const legacy = getPhotoEvidenceDetails({ url: 'legacy.jpg', timestamp: '', location: '' });
  assert.equal(value(legacy.rows, 'Recorded Location'), 'Location unavailable');
  assert.equal(value(legacy.rows, 'GPS Accuracy'), 'Not available');
  assert.equal(value(legacy.rows, 'Photo Source'), 'Not available');
  assert.equal(value(legacy.rows, 'Uploaded At'), 'Not available');
  assert.equal(legacy.locationNote, null);
});

test('preview selection carries each assignment and angle with its own photo record', () => {
  const front = { url: 'front.jpg', timestamp: '', location: 'Makati City' };
  const left = { url: 'left.jpg', timestamp: '', location: 'Pasay City' };
  const first = selectOperationalPhoto('ASN1', 'pickup_front', 'At Pickup · Front', front);
  const second = selectOperationalPhoto('ASN1', 'pickup_left', 'At Pickup · Left Side', left);
  assert.deepEqual([first.assignmentId, first.slotKey, first.title], ['ASN1', 'pickup_front', 'At Pickup · Front']);
  assert.equal(first.photo, front);
  assert.equal(second.photo, left);
  assert.equal(value(getPhotoEvidenceDetails(second.photo).rows, 'Recorded Location'), 'Pasay City');
});
