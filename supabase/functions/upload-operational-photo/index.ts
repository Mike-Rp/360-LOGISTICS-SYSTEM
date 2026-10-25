// @ts-nocheck — this file runs on Deno (npm: imports, the Deno global), which the
// project's TypeScript check (src/ only) doesn't cover.
//
// Duplicate operational-photo detection + trusted save.
// Called by the signed-in Driver app via supabase.functions.invoke(), which
// forwards the driver's own Authorization header automatically.
//
// Runs with the service-role key (SUPABASE_SERVICE_ROLE_KEY, injected by
// Supabase into every Edge Function, never reaches the browser) ONLY for the
// duplicate lookup (must see every driver's photos, not just the caller's)
// and the trusted write. The caller's own identity/ownership check instead
// uses a client scoped to the CALLER's JWT, so it is governed by the same
// RLS the rest of the app already trusts — this function cannot see or act
// on an assignment that isn't the caller's own.
import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { handleUpload, MAX_BODY_BYTES, type UploadDeps, type SavedPhotoFields } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const BUCKET = 'make-ee4d169c-media'; // must match src/app/lib/db.ts's BUCKET

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Browser origins allowed to call this function, e.g.
//   https://360logisticsph.site,http://localhost:5173
const allowedOrigins = (Deno.env.get('PHOTO_UPLOAD_ALLOWED_ORIGINS') ?? '')
  .split(',').map((o) => o.trim()).filter(Boolean);

function headers(origin: string | null): Headers {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origin && allowedOrigins.includes(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
  }
  return h;
}

const reply = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== 'POST') return reply(405, { error: 'invalid_request' }, origin);

  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) return reply(401, { error: 'not_authorized' }, origin);

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return reply(400, { error: 'invalid_request' }, origin);
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: 'invalid_request' }, origin);
  }

  const deps: UploadDeps = {
    async getOwnAssignment(assignmentId) {
      // Scoped to the caller's own JWT — RLS (assignments_select) means this can
      // only ever resolve a row that's actually theirs, same guarantee the rest
      // of the app relies on everywhere else.
      const { data, error } = await callerClient.from('assignments').select('driver_id')
        .eq('id', assignmentId).maybeSingle();
      if (error) {
        console.error(JSON.stringify({ fn: 'upload-operational-photo', event: 'get_own_assignment_failed', detail: error.message }));
        throw error;
      }
      return data?.driver_id ? { driverId: data.driver_id as string } : null;
    },
    async hashExists(hash) {
      const { data, error } = await admin.from('status_photos').select('assignment_id').eq('file_hash', hash).limit(1);
      if (error) {
        console.error(JSON.stringify({ fn: 'upload-operational-photo', event: 'hash_exists_failed', detail: error.message }));
        throw error;
      }
      return !!data?.length;
    },
    async uploadFile(path, bytes, contentType) {
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
      if (error) {
        console.error(JSON.stringify({ fn: 'upload-operational-photo', event: 'upload_failed', detail: error.message }));
        throw error;
      }
    },
    async saveRow(fields: SavedPhotoFields) {
      const { error } = await admin.from('status_photos').upsert({
        assignment_id: fields.assignmentId, status: fields.category, url: fields.url, file_hash: fields.fileHash,
        taken_at: fields.takenAt, location: fields.location ?? '', lat: fields.lat, lng: fields.lng,
        gps_accuracy_m: fields.gpsAccuracyM, gps_observed_at: fields.gpsObservedAt,
        source: fields.source, capture_observed_at: fields.captureObservedAt,
      }, { onConflict: 'assignment_id,status' });
      if (error) {
        console.error(JSON.stringify({ fn: 'upload-operational-photo', event: 'save_row_failed', detail: error.message }));
        throw error;
      }
    },
  };

  try {
    const result = await handleUpload(body, deps);
    return reply(result.status, result.body, origin);
  } catch (err) {
    // Supabase client errors (Postgrest/Storage) are often plain objects, not
    // real Error instances — pull out whatever fields they actually carry.
    const e = err as Record<string, unknown> | null;
    console.error(JSON.stringify({
      fn: 'upload-operational-photo', event: 'unexpected_error',
      detail: e?.message ?? String(err), code: e?.code, details: e?.details, hint: e?.hint, name: e?.name,
    }));
    return reply(500, { error: 'upload_failed' }, origin);
  }
});
