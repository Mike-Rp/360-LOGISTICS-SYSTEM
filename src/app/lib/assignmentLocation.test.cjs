const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function loadTypeScript(file, resolve = require) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(resolve, module, module.exports);
  return module.exports;
}

const loc = loadTypeScript(join(__dirname, 'assignmentLocation.ts'));

/* Real-world points: Makati (pickup) → Pasay (delivery). Note longitude ≈ 121,
   which is out of latitude range — so a reversed pair cannot slip through. */
const MAKATI = { latitude: 14.554729, longitude: 121.024445 };
const PASAY  = { latitude: 14.537752, longitude: 120.98 };

const created = {
  destination: 'Makati City → 1 Ayala Ave, Makati', destinationArea: 'Pasay City',
  pickupLocation: '6750 Ayala Ave, Makati City', pickupLatitude: MAKATI.latitude, pickupLongitude: MAKATI.longitude,
  deliveryLocation: 'SM Mall of Asia, Pasay City', deliveryLatitude: PASAY.latitude, deliveryLongitude: PASAY.longitude,
};

test('create: exact stops become the new columns', () => {
  assert.deepEqual(loc.locationColumnsForRow(created), {
    pickup_latitude: 14.554729, pickup_longitude: 121.024445,
    delivery_location: 'SM Mall of Asia, Pasay City',
    delivery_latitude: 14.537752, delivery_longitude: 120.98,
  });
});

test('read: the same address and coordinates come back unchanged (round trip)', () => {
  const row = { pickup_location: created.pickupLocation, ...loc.locationColumnsForRow(created) };
  assert.deepEqual(loc.locationFieldsFromRow(row), {
    pickupLatitude: MAKATI.latitude, pickupLongitude: MAKATI.longitude,
    deliveryLocation: 'SM Mall of Asia, Pasay City',
    deliveryLatitude: PASAY.latitude, deliveryLongitude: PASAY.longitude,
  });
});

test('read: numeric strings from the API are accepted, garbage is not', () => {
  const f = loc.locationFieldsFromRow({ pickup_latitude: '14.5', pickup_longitude: '121', delivery_latitude: 'abc', delivery_longitude: '120' });
  assert.equal(f.pickupLatitude, 14.5);
  assert.equal(f.pickupLongitude, 121);
  assert.equal(f.deliveryLatitude, null);
  assert.equal(f.deliveryLongitude, null);
});

test('Mapbox [longitude, latitude] is converted by position, not reversed', () => {
  assert.deepEqual(loc.fromMapboxPosition([121.024445, 14.554729]), MAKATI);
  assert.equal(loc.fromMapboxPosition([14.554729, 121.024445]), null, 'reversed Philippine pair has latitude 121 → rejected');
  assert.equal(loc.fromMapboxPosition(null), null);
  assert.equal(loc.fromMapboxPosition([121]), null);
});

test('edit: replacing pickup / delivery coordinates is a valid edit', () => {
  assert.equal(loc.invalidLocationEdit({ pickupLocation: 'New pickup', pickupLatitude: 14.6, pickupLongitude: 121.05 }), null);
  assert.equal(loc.invalidLocationEdit({ deliveryLocation: 'New drop', deliveryLatitude: 14.5, deliveryLongitude: 121.0 }), null);
  assert.equal(loc.invalidLocationEdit({ pickupLatitude: null, pickupLongitude: null }), null, 'clearing both is allowed');
  assert.equal(loc.invalidLocationEdit({ remarks: 'no location change' }), null);
});

test('validation: out-of-range, NaN, Infinity, strings and half pairs are rejected', () => {
  assert.match(loc.invalidLocationEdit({ pickupLatitude: 150, pickupLongitude: 121 }), /latitude/);
  assert.match(loc.invalidLocationEdit({ deliveryLatitude: 14.5, deliveryLongitude: 300 }), /longitude/);
  assert.match(loc.invalidLocationEdit({ pickupLatitude: NaN, pickupLongitude: 121 }), /latitude/);
  assert.match(loc.invalidLocationEdit({ pickupLatitude: 14.5, pickupLongitude: Infinity }), /longitude/);
  assert.match(loc.invalidLocationEdit({ pickupLatitude: '14.5', pickupLongitude: 121 }), /latitude/);
  assert.match(loc.invalidLocationEdit({ pickupLatitude: 14.5 }), /together/);
  assert.match(loc.invalidLocationEdit({ pickupLatitude: 14.5, pickupLongitude: null }), /together/);
});

test('create: an invalid pair is dropped, never written half-way', () => {
  const cols = loc.locationColumnsForRow({ ...created, pickupLatitude: 150, deliveryLongitude: NaN });
  assert.equal('pickup_latitude' in cols, false);
  assert.equal('pickup_longitude' in cols, false);
  assert.equal(cols.delivery_location, 'SM Mall of Asia, Pasay City', 'the address itself is still saved');
  assert.equal('delivery_latitude' in cols, false);
  assert.equal('delivery_longitude' in cols, false);
});

test('create: coordinates are never sent without the address they belong to', () => {
  const cols = loc.locationColumnsForRow({ pickupLocation: '  ', pickupLatitude: 14.5, pickupLongitude: 121,
                                           deliveryLatitude: 14.5, deliveryLongitude: 121 });
  assert.deepEqual(cols, {});
});

test('historical: an older assignment without the new columns still loads (all null)', () => {
  const oldRow = { id: 'ASN00001', pickup_location: 'Warehouse 3', destination: 'Laguna → Imus, Cavite' };
  assert.deepEqual(loc.locationFieldsFromRow(oldRow), {
    pickupLatitude: null, pickupLongitude: null, deliveryLocation: null, deliveryLatitude: null, deliveryLongitude: null,
  });
});

test('historical: nothing new is written for assignments without exact stops', () => {
  assert.deepEqual(loc.locationColumnsForRow({ pickupLocation: 'Warehouse 3' }), {});
  assert.deepEqual(loc.locationColumnsForRow({}), {});
});
