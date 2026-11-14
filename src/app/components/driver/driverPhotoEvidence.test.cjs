const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'driverPhotoEvidence.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
const { galleryPhotoMetadata, gpsAccuracyLevel, isCurrentPhotoLocationRequest, isPhotoLocationStale, savedPhotoMetadata } = loaded.exports;

test('gallery evidence does not claim a fresh capture or current device location', () => {
  assert.deepEqual(galleryPhotoMetadata('saved-path'), {
    url: 'saved-path', timestamp: '', location: '',
  });
});

test('reported GPS radius is classified only when valid', () => {
  assert.equal(gpsAccuracyLevel(50), 'good');
  assert.equal(gpsAccuracyLevel(51), 'approximate');
  assert.equal(gpsAccuracyLevel(100), 'approximate');
  assert.equal(gpsAccuracyLevel(101), 'low');
  assert.equal(gpsAccuracyLevel(null), null);
  assert.equal(gpsAccuracyLevel(-1), null);
});

test('Gallery uses the successful Storage upload time; Camera retains its app-observed time', () => {
  const pending = { url: 'preview', timestamp: '', location: 'Santa Rosa', coords: { lat: 14.3, lng: 121.1 } };
  const uploadedAt = '2026-10-22T11:30:00.000Z';
  assert.deepEqual(savedPhotoMetadata(pending, 'gallery', 'stored/gallery', uploadedAt), {
    ...pending, url: 'stored/gallery', timestamp: uploadedAt,
    source: 'gallery', captureObservedAt: null,
  });
  assert.deepEqual(savedPhotoMetadata({ ...pending, timestamp: '2026-10-22T11:25:00.000Z' }, 'camera', 'stored/camera', uploadedAt), {
    ...pending, url: 'stored/camera', timestamp: '2026-10-22T11:25:00.000Z',
    source: 'camera', captureObservedAt: '2026-10-22T11:25:00.000Z',
  });
});

test('a late GPS result cannot populate a retaken photo or supersede a newer refresh', () => {
  assert.equal(isCurrentPhotoLocationRequest(2, 4, 2, 4), true);
  assert.equal(isCurrentPhotoLocationRequest(1, 4, 2, 4), false);
  assert.equal(isCurrentPhotoLocationRequest(2, 3, 2, 4), false);
});

test('preview GPS freshness uses the actual reading time', () => {
  const now = Date.parse('2026-10-24T08:00:00.000Z');
  assert.equal(isPhotoLocationStale('2026-10-24T07:59:00.000Z', now), false);
  assert.equal(isPhotoLocationStale('2026-10-24T07:54:59.000Z', now), true);
  assert.equal(isPhotoLocationStale('2026-10-24T08:02:00.000Z', now), true);
  assert.equal(isPhotoLocationStale('invalid', now), true);
  assert.equal(isPhotoLocationStale(null, now), false);
});

test('a photo cannot be uploaded without a fresh device location, and there is no way to skip it', () => {
  const screen = readFileSync(join(__dirname, 'DriverInterface.tsx'), 'utf8');
  const words = readFileSync(join(__dirname, 'driverI18n.tsx'), 'utf8');
  assert.doesNotMatch(screen, /withoutLocation|continueWithoutLocation|locationOmitted/);
  assert.doesNotMatch(words, /continueWithoutLocation|locationOmitted/);
  // the confirm button needs coordinates and a fresh reading, for camera and gallery photos alike
  assert.match(screen, /const canSubmitPrimary = canConfirm && !locationStale && !!meta\?\.coords;/);
  // and confirmPhoto itself refuses (not just the disabled button)
  assert.match(screen, /if \(!meta\.coords\) \{\s*setLocationError\(true\);\s*return;\s*\}/);
  // the saved photo always carries the measured accuracy/time, never an emptied location
  assert.match(screen, /gpsAccuracyM: gpsAccuracy,\s*gpsObservedAt: locationObservedAt,/);
  assert.match(words, /Location is required to upload a photo/);
  assert.match(words, /Kailangan ang lokasyon para makapag-upload ng litrato/);
});

test('the server also refuses a photo without a location, and the driver screen shows the location message for it', () => {
  const screen = readFileSync(join(__dirname, 'DriverInterface.tsx'), 'utf8');
  const db = readFileSync(join(__dirname, '../../lib/db.ts'), 'utf8');
  assert.match(db, /class LocationRequiredError extends Error/);
  assert.match(db, /if \(code === 'location_required'\) throw new LocationRequiredError\(\);/);
  assert.match(screen, /err instanceof LocationRequiredError \? t\('photo\.locationError'\)/);
  assert.match(screen, /error instanceof DuplicatePhotoError \|\| error instanceof LocationRequiredError\) throw error;/);
});
