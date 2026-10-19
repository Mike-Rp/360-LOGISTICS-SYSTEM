/* ── REQ-005: exact pickup / delivery locations ────────────────────────────────
   Pure helpers used by db.ts to move the Mapbox-selected stops between the app's
   Assignment fields and the assignments table columns. No network, no Supabase —
   so they can be unit-tested (assignmentLocation.test.cjs).

   The database is the real guard (CHECK constraints + edit_assignment()); these
   helpers only make sure the browser never sends something that would silently
   turn into the wrong value — e.g. NaN, which JSON.stringify turns into null. */

export interface LatLng { latitude: number; longitude: number }

export const isLatitude  = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -90  && v <= 90;
export const isLongitude = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

/** Both halves valid → the pair; anything else (missing half, NaN, out of range) → null. */
export function coordinatePair(latitude: unknown, longitude: unknown): LatLng | null {
  return isLatitude(latitude) && isLongitude(longitude) ? { latitude, longitude } : null;
}

/** Mapbox geometry.coordinates is [longitude, latitude] — convert by position, never by guess. */
export function fromMapboxPosition(position: readonly [number, number] | readonly number[] | null | undefined): LatLng | null {
  if (!position || position.length < 2) return null;
  return coordinatePair(position[1], position[0]);
}

type Row = Record<string, unknown>;

const asNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Database row → Assignment fields. A half-present or invalid pair reads back as null. */
export function locationFieldsFromRow(r: Row) {
  const pickup   = coordinatePair(asNumber(r.pickup_latitude),   asNumber(r.pickup_longitude));
  const delivery = coordinatePair(asNumber(r.delivery_latitude), asNumber(r.delivery_longitude));
  const deliveryLocation = typeof r.delivery_location === 'string' && r.delivery_location.trim() ? r.delivery_location : null;
  return {
    pickupLatitude:    pickup?.latitude    ?? null,
    pickupLongitude:   pickup?.longitude   ?? null,
    deliveryLocation,
    deliveryLatitude:  delivery?.latitude  ?? null,
    deliveryLongitude: delivery?.longitude ?? null,
  };
}

interface LocationFields {
  pickupLocation?: string | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  deliveryLocation?: string | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
}

/** Assignment fields → the extra columns to write for a new/changed row.
    Only present, valid values are included, so nothing is sent for assignments
    that have no exact stops (all older ones, and Dispatch until the frontend sends
    them) — the row looks exactly as it did before REQ-005. Coordinates are only
    sent alongside the address they belong to; an invalid pair is dropped
    rather than saved half-way. */
export function locationColumnsForRow(a: LocationFields): Row {
  const cols: Row = {};
  const pickup = coordinatePair(a.pickupLatitude, a.pickupLongitude);
  if (pickup && a.pickupLocation?.trim()) {
    cols.pickup_latitude  = pickup.latitude;
    cols.pickup_longitude = pickup.longitude;
  }
  if (a.deliveryLocation?.trim()) {
    cols.delivery_location = a.deliveryLocation;
    const delivery = coordinatePair(a.deliveryLatitude, a.deliveryLongitude);
    if (delivery) {
      cols.delivery_latitude  = delivery.latitude;
      cols.delivery_longitude = delivery.longitude;
    }
  }
  return cols;
}

/** Checks an edit before it is sent to edit_assignment(). Returns a reason, or null if fine.
    null for both halves of a pair means "clear the coordinates" and is allowed. */
export function invalidLocationEdit(e: LocationFields): string | null {
  for (const stop of ['pickup', 'delivery'] as const) {
    const latKey = `${stop}Latitude` as const, lngKey = `${stop}Longitude` as const;
    const hasLat = latKey in e, hasLng = lngKey in e;
    if (!hasLat && !hasLng) continue;
    if (hasLat !== hasLng) return `${stop}: latitude and longitude must be sent together`;
    const lat = e[latKey], lng = e[lngKey];
    if (lat === null && lng === null) continue;
    if (lat === null || lng === null) return `${stop}: latitude and longitude must be cleared together`;
    if (!isLatitude(lat))  return `${stop}: latitude must be a finite number from -90 to 90`;
    if (!isLongitude(lng)) return `${stop}: longitude must be a finite number from -180 to 180`;
  }
  return null;
}
