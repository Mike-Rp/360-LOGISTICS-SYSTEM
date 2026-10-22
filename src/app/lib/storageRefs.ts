/* ════════════════════════════════════════════════════════════════════════════
   Stored file references (photos / documents in the private Storage bucket).

   The database stores only a file's PATH inside the bucket, e.g.
     photos/ASN12345/pickup_front_1729512345678.jpg
   A path alone opens nothing. db.ts turns paths into short-lived signed links
   when it loads data, so the screens still receive a normal URL.

   Older rows (before the change) hold a full ~10-year signed link instead; the
   path is part of that link, so both forms are read the same way here.
   Pure helpers — no Supabase calls — so they can be unit-tested (storageRefs.test.cjs).
   ════════════════════════════════════════════════════════════════════════════ */

/** Top-level folders the app uploads into (see DriverInterface uploads + Storage policies). */
const UPLOAD_FOLDERS = ['photos/', 'docs/', 'profiles/'];

/** The path inside `bucket` that a stored value points to, or null if it is not one of ours
 *  (empty, an inline data: image, a stripped placeholder, or some other URL). */
export function storagePathOf(value: unknown, bucket: string): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.startsWith('data:') || v === '[image-data-stripped]') return null;
  if (UPLOAD_FOLDERS.some((f) => v.startsWith(f))) return v;
  const m = v.match(/\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/?#]+)\/([^?#]+)/);
  if (!m) return null;
  let b: string, p: string;
  try { b = decodeURIComponent(m[1]); p = decodeURIComponent(m[2]); } catch { return null; }
  return b === bucket && UPLOAD_FOLDERS.some((f) => p.startsWith(f)) ? p : null;
}

/** What to WRITE to the database for a file value: its path when it is one of ours,
 *  otherwise the value unchanged (inline images are stripped by the caller as before). */
export function storedFileRef<T>(value: T, bucket: string): T | string {
  return storagePathOf(value, bucket) ?? value;
}

/** True when two stored/displayed values point to the same file (link vs path, or two links). */
export function sameStoredFile(a: unknown, b: unknown, bucket: string): boolean {
  const pa = storagePathOf(a, bucket), pb = storagePathOf(b, bucket);
  return pa !== null ? pa === pb : a === b;
}
