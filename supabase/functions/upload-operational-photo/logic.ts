// Duplicate operational-photo detection + trusted save — the decision logic.
// Kept free of Deno/npm imports so it can be unit-tested with Node
// (logic.test.cjs). index.ts wires it to Supabase.
//
// The whole point of running this server-side: the hash is computed here,
// from the bytes this function actually receives — never from anything the
// client claims about its own photo. See the migration this ships with for
// why a client-side-only check would not be trustworthy.

export const MAX_BODY_BYTES = 8 * 1024 * 1024; // ~6MB binary after base64 overhead

export const OPERATIONAL_PHOTO_CATEGORIES = [
  'pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear',
  'pretrip_front', 'pretrip_left', 'pretrip_right', 'pretrip_rear',
  'loading_before', 'loading_after', 'unloading_before', 'unloading_after',
] as const;
export type OperationalPhotoCategory = typeof OPERATIONAL_PHOTO_CATEGORIES[number];

export type UploadError = 'invalid_request' | 'not_authorized' | 'duplicate_photo' | 'upload_failed';

export interface UploadResult {
  status: number;
  body: { ok: true; url: string } | { error: UploadError };
}

export interface ParsedInput {
  assignmentId: string;
  category: OperationalPhotoCategory;
  photoDataUrl: string;
  takenAt: string;
  location: string | null;
  lat: number | null;
  lng: number | null;
  gpsAccuracyM: number | null;
  gpsObservedAt: string | null;
  source: 'camera' | 'gallery';
  captureObservedAt: string | null;
}

/** Decodes the data: URL the client sends. Rejects anything that isn't a plausible image. */
export function decodeDataUrl(dataUrl: unknown): { bytes: Uint8Array; contentType: string } | null {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([^;,]*);base64,([\s\S]*)$/);
  if (!m) return null;
  const contentType = m[1] || 'image/jpeg';
  if (!contentType.startsWith('image/')) return null;
  let bin: string;
  try { bin = atob(m[2]); } catch { return null; }
  if (bin.length === 0) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

export function validateRequest(body: unknown): { ok: true; input: ParsedInput } | { ok: false; error: UploadError } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'invalid_request' };
  const b = body as Record<string, unknown>;
  if (typeof b.assignmentId !== 'string' || !b.assignmentId.trim()) return { ok: false, error: 'invalid_request' };
  if (typeof b.category !== 'string' || !(OPERATIONAL_PHOTO_CATEGORIES as readonly string[]).includes(b.category)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (typeof b.photoDataUrl !== 'string' || !b.photoDataUrl) return { ok: false, error: 'invalid_request' };
  if (b.source !== 'camera' && b.source !== 'gallery') return { ok: false, error: 'invalid_request' };
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    ok: true,
    input: {
      assignmentId: b.assignmentId.trim(), category: b.category as OperationalPhotoCategory,
      photoDataUrl: b.photoDataUrl, takenAt: str(b.takenAt) ?? '',
      location: str(b.location), lat: num(b.lat), lng: num(b.lng),
      gpsAccuracyM: num(b.gpsAccuracyM), gpsObservedAt: str(b.gpsObservedAt),
      source: b.source, captureObservedAt: str(b.captureObservedAt),
    },
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

export interface SavedPhotoFields {
  assignmentId: string; category: string; url: string; fileHash: string; takenAt: string;
  location: string | null; lat: number | null; lng: number | null;
  gpsAccuracyM: number | null; gpsObservedAt: string | null;
  source: string; captureObservedAt: string | null;
}

export interface UploadDeps {
  /** RLS-backed: must only ever resolve a row the calling driver actually owns. Null = not theirs/not found. */
  getOwnAssignment(assignmentId: string): Promise<{ driverId: string } | null>;
  /** True if ANY operational photo, by any driver, already carries this exact hash. */
  hashExists(hash: string): Promise<boolean>;
  uploadFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  saveRow(fields: SavedPhotoFields): Promise<void>;
}

export async function handleUpload(body: unknown, deps: UploadDeps): Promise<UploadResult> {
  const parsed = validateRequest(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const { input } = parsed;

  const decoded = decodeDataUrl(input.photoDataUrl);
  if (!decoded) return { status: 400, body: { error: 'invalid_request' } };

  const assignment = await deps.getOwnAssignment(input.assignmentId);
  if (!assignment) return { status: 403, body: { error: 'not_authorized' } };

  const hash = await sha256Hex(decoded.bytes);
  if (await deps.hashExists(hash)) return { status: 409, body: { error: 'duplicate_photo' } };

  const ext = decoded.contentType === 'image/png' ? 'png' : 'jpg';
  const path = `photos/${input.assignmentId}/${input.category}_${Date.now()}.${ext}`;

  try {
    await deps.uploadFile(path, decoded.bytes, decoded.contentType);
    await deps.saveRow({
      assignmentId: input.assignmentId, category: input.category, url: path, fileHash: hash,
      takenAt: input.takenAt, location: input.location, lat: input.lat, lng: input.lng,
      gpsAccuracyM: input.gpsAccuracyM, gpsObservedAt: input.gpsObservedAt,
      source: input.source, captureObservedAt: input.captureObservedAt,
    });
  } catch {
    return { status: 500, body: { error: 'upload_failed' } };
  }

  return { status: 200, body: { ok: true, url: path } };
}
