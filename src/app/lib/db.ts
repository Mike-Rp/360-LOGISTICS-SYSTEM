/* ════════════════════════════════════════════════════════════════════════════
   Data layer — every call to Supabase lives in this one file.

   It replaces the old edge function (supabase/functions/server). The browser
   now talks straight to Postgres with the signed-in user's session; what each
   user may read or write is enforced by the RLS policies + triggers in
   supabase/migrations, NOT by code here. So nothing in this file is a security
   boundary — it only shapes data.

   Two jobs:
   1. LOAD  — read the relational tables and rebuild the same objects the React
              screens already use (Assignment, LocalDriver, ...).
   2. SAVE  — the admin screens still edit plain arrays in App state. syncAdminData()
              compares those arrays with what was last loaded and writes ONLY the
              rows/columns that changed (instead of rewriting everything).
   ════════════════════════════════════════════════════════════════════════════ */

import { supabase } from './supabaseClient';
import { DOCUMENT_TYPES } from '../data/assignmentTypes';
import { destinationAreaEnabled } from '../data/assignmentRoute';
import { locationFieldsFromRow, locationColumnsForRow, invalidLocationEdit } from './assignmentLocation';
import { storagePathOf, storedFileRef, sameStoredFile } from './storageRefs';
import type {
  Assignment, AssignmentDoc, CompletedTask, LocalDriver, LocalTruck, AppNotification,
  AdminActivityEntry, AdminRole, StatusPhoto, DelayReport, TeamMember,
} from '../data/assignmentTypes';

export const BUCKET = 'make-ee4d169c-media';

type Row = Record<string, any>;

/* ── small helpers ───────────────────────────────────────────────────────── */

/* Same rule the old server (and the SQL function normalise_mobile) used. */
export function normaliseMobile(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) return '0' + digits.slice(2);
  return digits;
}

/* Drivers sign in through Supabase Auth with a synthetic email + PIN-derived password.
   MUST match public.driver_login_email() / sync_driver_login() in the migration. */
export const driverLoginEmail    = (phone: string) => `d${normaliseMobile(phone)}@drivers.360logistics.ph`;
export const driverLoginPassword = (pin: string)   => `360pin-${pin}`;

/* Images are uploaded to Storage; if that failed the UI falls back to a base64 data URL.
   Never store those in the database (kept from the old server's stripBase64). */
const isInlineImage = (s: unknown) => typeof s === 'string' && (s.startsWith('data:') || s === '[image-data-stripped]');
function stripBase64<T>(v: T): T {
  if (typeof v === 'string') return (v.startsWith('data:') ? '[image-data-stripped]' : v) as unknown as T;
  return v;
}

/* ── Photo / document links ──
   The database stores a file's PATH (storageRefs.ts), never a link. When data is loaded,
   paths become signed links that work for one hour — created through Storage's own
   security rules, so only current staff or the owning driver can get one. Links are
   cached and renewed 10 minutes before they expire, so pictures do not reload on every
   poll. (Older rows still hold a 10-year link; it is read as its path and re-signed.) */
const SIGNED_LINK_SECONDS = 60 * 60;
const RENEW_BEFORE_MS = 10 * 60 * 1000;
const signedLinks = new Map<string, { url: string; expiresAt: number }>();

/** What to save in the database for a photo/document value: its path, never a link. */
const fileRefToStore = <T,>(v: T) => storedFileRef(stripBase64(v), BUCKET);

/** Make sure every file referenced by `values` has a current short-lived link cached. */
async function signStoredFiles(values: unknown[]): Promise<void> {
  const now = Date.now();
  const need = [...new Set(values.map((v) => storagePathOf(v, BUCKET)).filter((p): p is string => !!p))]
    .filter((p) => { const c = signedLinks.get(p); return !c || c.expiresAt - now < RENEW_BEFORE_MS; });
  if (!need.length) return;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(need, SIGNED_LINK_SECONDS);
  if (error) { console.warn('[storage] could not create file links:', error); return; }
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) signedLinks.set(item.path, { url: item.signedUrl, expiresAt: now + SIGNED_LINK_SECONDS * 1000 });
  }
}

/** The link the screens show for a stored value ('' if the file could not be signed). */
function displayUrl(value: unknown): string {
  const path = storagePathOf(value, BUCKET);
  if (!path) return typeof value === 'string' ? value : '';
  return signedLinks.get(path)?.url ?? '';
}

const timeLabel = () =>
  new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* PostgREST returns at most 1000 rows per request, so page through big tables. */
async function fetchAll(table: string, order: Array<[string, boolean]>): Promise<Row[]> {
  const PAGE = 1000;
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select('*');
    for (const [col, asc] of order) q = q.order(col, { ascending: asc });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
   AUTH
   ════════════════════════════════════════════════════════════════════════════ */

export interface StaffSession {
  id: string; email: string; name: string; role: AdminRole; isOm: boolean; isDemo: boolean;
  avatarPath: string | null;
}
/** What update_own_display_name / set_own_avatar_path return — merge into the
    existing StaffSession (isOm/isDemo don't change from these calls). */
type OwnProfileUpdate = Pick<StaffSession, 'id' | 'email' | 'name' | 'role' | 'avatarPath'>;
export type LoginErrorCode = 'invalid_credentials' | 'no_access' | 'network' | 'server' | 'rate_limited';
export class LoginError extends Error {
  code: LoginErrorCode;
  constructor(code: LoginErrorCode) { super(code); this.code = code; }
}
export type AppSession =
  | { kind: 'staff';  staff: StaffSession }
  | { kind: 'driver'; driver: { id: string; name: string } }
  | null;

const toStaff = (p: Row): StaffSession => ({
  id: p.id, email: p.email, name: p.name ?? '', role: p.role as AdminRole, isOm: p.role === 'opm', isDemo: !!p.is_demo,
  avatarPath: p.avatar_path ?? null,
});

async function fetchProfile(uid: string): Promise<Row | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data;
}
async function fetchOwnDriver(uid: string): Promise<{ id: string; name: string } | null> {
  /* select('*') rather than naming archived_at, so this keeps working before the archive migration is applied */
  const { data, error } = await supabase.from('drivers').select('*').eq('auth_user_id', uid).maybeSingle();
  if (error) throw error;
  if (!data || data.archived_at) return null;     // archived drivers can't sign in (their login is also removed)
  return { id: data.id, name: data.name };
}

/* Single active session: every sign-out ends only THIS browser's session. The default
   (scope 'global') would end all of the account's sessions — a device that was replaced
   by a newer login would then also log out the newer device. */
const signOutThisDevice = () => {
  signedLinks.clear();            // the next account on this browser gets its own links
  return supabase.auth.signOut({ scope: 'local' });
};

/* Right after a successful sign-in: ask the database for this session's status. Being the
   newest, it is 'current', and the database removes the account's older sessions, so the
   previous device's refresh token dies now instead of at its next poll. Fire-and-forget,
   like touch_last_active — it must never block or fail a login. */
function endOlderSessions(): void {
  void supabase.rpc('my_session_status').then(
    ({ error }) => { if (error) console.warn('[my_session_status] could not end older sessions:', error); },
    (err: unknown) => { console.warn('[my_session_status] request failed:', err); },
  );
}

function loginFailure(error: { status?: number; code?: string }): LoginError {
  if (error.status === 429) return new LoginError('rate_limited');
  if (error.status && error.status >= 500) return new LoginError('server');
  if (error.status === 400 || error.status === 401 || error.code === 'invalid_credentials') {
    return new LoginError('invalid_credentials');
  }
  return new LoginError('network');
}

/* Admin / Operation Manager / CSR / Viewer — one path for all of them now. */
export async function signInStaff(email: string, password: string): Promise<StaffSession> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.user) throw loginFailure(error ?? {});
  let profile: Row | null;
  try { profile = await fetchProfile(data.user.id); }
  catch { await signOutThisDevice(); throw new LoginError('network'); }
  if (!profile || profile.status !== 'active') {
    await signOutThisDevice();              // valid login but not a staff account (e.g. a driver, or removed)
    throw new LoginError('no_access');
  }
  endOlderSessions();
  /* Fire-and-forget: stamping "last active" must never block or fail a login.
     The .catch() is required — without it a rejection here surfaces as an
     unhandled promise rejection instead of a log line. */
  /* Two-argument .then, not .catch(): rpc() returns a PostgrestFilterBuilder, which is a
     thenable without a .catch method. The first handler covers a returned error, the
     second an outright rejection (e.g. the network dropped). */
  void supabase.rpc('touch_last_active').then(
    ({ error }) => { if (error) console.warn('[touch_last_active] could not stamp last-active time:', error); },
    (err: unknown) => { console.warn('[touch_last_active] request failed:', err); },
  );
  return toStaff(profile);
}

/* mobile10 = the 10 digits after +63, e.g. "9171234567" */
export async function signInDriver(mobile10: string, pin: string): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: driverLoginEmail('+63' + mobile10), password: driverLoginPassword(pin),
  });
  if (error || !data.user) throw loginFailure(error ?? {});
  let driver: { id: string; name: string } | null;
  try { driver = await fetchOwnDriver(data.user.id); }
  catch { await signOutThisDevice(); throw new LoginError('network'); }
  if (!driver) { await signOutThisDevice(); throw new LoginError('no_access'); }
  endOlderSessions();
  return driver;
}

/* On page refresh: is there a saved session, and whose is it? Only signs out when the
   answer is definitely "nobody"; a network error just throws so the caller can retry. */
export async function restoreSession(): Promise<AppSession> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const profile = await fetchProfile(user.id);
  if (profile && profile.status === 'active') return { kind: 'staff', staff: toStaff(profile) };
  const driver = await fetchOwnDriver(user.id);
  if (driver) return { kind: 'driver', driver };
  await signOutThisDevice();
  return null;
}

/* Logout button: ends this device's session only (see signOutThisDevice). */
export const signOut = () => signOutThisDevice();

/* ── REQ-012: own profile (name / avatar) ──
   Both RPCs are SECURITY DEFINER and act only on the caller's own row
   (auth.uid()); they return the updated {id, email, name, role, avatarPath},
   which the caller merges into the existing StaffSession (isOm/isDemo stay
   as they were — these calls never change role or status). */
export async function updateOwnDisplayName(name: string): Promise<OwnProfileUpdate> {
  const { data, error } = await supabase.rpc('update_own_display_name', { p_name: name });
  if (error) throw new Error(error.message);
  return data as OwnProfileUpdate;
}

async function setOwnAvatarPathRpc(path: string | null): Promise<OwnProfileUpdate> {
  const { data, error } = await supabase.rpc('set_own_avatar_path', { p_avatar_path: path });
  if (error) throw new Error(error.message);
  return data as OwnProfileUpdate;
}

/** Upload a new avatar (same fixed path every time, so this replaces in place —
    no separate cleanup needed), persist the pointer, and return the updated profile
    plus the FRESH signed URL — the path string itself never changes on a replace,
    so callers must use this returned URL directly rather than waiting on some
    path-changed effect, which would never fire for a same-path replacement. */
export async function uploadOwnAvatar(uid: string, dataUrl: string): Promise<OwnProfileUpdate & { avatarUrl: string }> {
  const path = `profiles/${uid}/avatar.jpg`;
  const avatarUrl = await uploadImage(dataUrl, path);
  const profile = await setOwnAvatarPathRpc(path);
  return { ...profile, avatarUrl };
}

/** Remove the current avatar: delete the stored file, then clear the pointer.
    If the delete fails, the pointer is left alone rather than claiming removal succeeded. */
export async function removeOwnAvatar(path: string): Promise<OwnProfileUpdate> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
  return setOwnAvatarPathRpc(null);
}

/** Resolve a stored avatar path to a short-lived display URL, reusing the same
    signed-link cache/renewal as every other stored file (REQ-010). */
export async function resolveAvatarUrl(path: string | null): Promise<string> {
  if (!path) return '';
  await signStoredFiles([path]);
  return displayUrl(path);
}

/** Same, for several accounts at once (e.g. the Team Members list) — one batched
    signing call instead of one request per row. Keyed by path, not account id,
    since that's what the caller already has on each TeamMember. */
export async function resolveAvatarUrls(paths: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (!unique.length) return new Map();
  await signStoredFiles(unique);
  return new Map(unique.map((p) => [p, displayUrl(p)]));
}

/* ── Single active session ──
   'current'    this browser's login is the account's newest — keep going
   'replaced'   the same account signed in on another device → show the message, sign out here
   'signed_out' the session no longer exists (PIN/password reset, account removed)
   'unknown'    could not tell (offline, or the database part is not installed yet) —
                never log anyone out for this; just try again on the next poll. */
export type SessionStatus = 'current' | 'replaced' | 'signed_out' | 'unknown';

function sessionIdOf(accessToken: string | undefined): string | null {
  try {
    const payload = accessToken!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).session_id ?? null;
  } catch { return null; }
}

export async function checkSessionStatus(): Promise<SessionStatus> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = sessionIdOf((await supabase.auth.getSession()).data.session?.access_token);
    if (!before) return 'signed_out';
    const { data, error } = await supabase.rpc('my_session_status');
    if (error) return 'unknown';
    /* Re-entering a password (edit/cancel confirmation, password change) signs in again in
       THIS browser, i.e. starts a newer session here. If that happened while we were asking,
       the answer was about the old session — ask again with the current one. */
    const after = sessionIdOf((await supabase.auth.getSession()).data.session?.access_token);
    if (after !== before) continue;
    return data === 'current' || data === 'replaced' || data === 'signed_out' ? data : 'unknown';
  }
  return 'unknown';
}

/* After 'replaced' / 'signed_out': clear this device's stored login without touching
   the account's other (newer) session. */
export const endThisDeviceSession = () => signOutThisDevice();

export type PasswordErrorCode = 'wrong_current' | 'same_password' | 'weak_password' | 'not_signed_in' | 'network';
export class PasswordError extends Error {
  code: PasswordErrorCode;
  constructor(code: PasswordErrorCode) { super(code); this.code = code; }
}

/* Change the signed-in user's own password (Settings → Security).
   Supabase's updateUser() alone would accept ANY new password from an open browser session, so we first
   prove the person knows the current one by signing in again with it. */
export async function changeOwnPassword(current: string, next: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) throw new PasswordError('not_signed_in');

  const check = await supabase.auth.signInWithPassword({ email, password: current });
  if (check.error) {
    const bad = check.error.status === 400 || check.error.status === 401 || (check.error as any).code === 'invalid_credentials';
    throw new PasswordError(bad ? 'wrong_current' : 'network');
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    const code = (error as any).code as string | undefined;
    if (code === 'same_password') throw new PasswordError('same_password');
    if (code === 'weak_password') throw new PasswordError('weak_password');
    throw new PasswordError('network');
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   ROW <-> OBJECT MAPPING (shared by admin + driver)
   ════════════════════════════════════════════════════════════════════════════ */

const docFromRow = (r: Row): AssignmentDoc => ({
  type: r.type, uploaded: !!r.uploaded, docStatus: r.doc_status,
  ...(r.file_url ? { fileUrl: displayUrl(r.file_url) } : {}),
  ...(r.reject_reason ? { rejectReason: r.reject_reason } : {}),
});
const photoFromRow = (r: Row): StatusPhoto => ({
  url: displayUrl(r.url), timestamp: r.taken_at ?? '', location: r.location ?? '',
  ...(r.lat != null && r.lng != null ? { coords: { lat: r.lat, lng: r.lng } } : {}),
  ...(r.gps_accuracy_m != null ? { gpsAccuracyM: r.gps_accuracy_m } : {}),
  ...(r.gps_observed_at ? { gpsObservedAt: r.gps_observed_at } : {}),
  ...(r.source ? { source: r.source } : {}),
  ...(r.capture_observed_at ? { captureObservedAt: r.capture_observed_at } : {}),
  ...(r.uploaded_at ? { uploadedAt: r.uploaded_at } : {}),
});
const delayFromRow = (r: Row): DelayReport => ({ type: r.type, reason: r.reason, reportedAt: r.reported_at ?? '' });

function assignmentFromRow(r: Row, docs: Row[], photos: Row[], delays: Row[], issues: Row[] = []): Assignment {
  const openIssueRow = issues.find((i) => i.status === 'open' && i.is_blocking);
  return {
    id: r.id, driverName: r.driver_name ?? '', driverId: r.driver_id ?? '',
    truckPlate: r.truck_plate ?? '', truckId: r.truck_id ?? '',
    destination: r.destination ?? '', destinationArea: r.destination_area ?? null, company: r.company ?? '',
    pickupLocation: r.pickup_location ?? '', pickupTime: r.pickup_time ?? '', pickedUpDate: r.picked_up_date ?? '',
    /* REQ-005 exact stops — null on older assignments (and before the migration is applied) */
    ...locationFieldsFromRow(r),
    eta: r.eta ?? '', ata: r.ata ?? '', deliveryDate: r.delivery_date ?? '', remarks: r.remarks ?? '',
    taskStatus: r.task_status, assignedAt: r.assigned_at ?? '',
    operationalStage: r.operational_stage ?? null,
    pickupArrivedAt: r.pickup_arrived_at ?? null,
    loadingStartedAt: r.loading_started_at ?? null,
    loadingCompletedAt: r.loading_completed_at ?? null,
    loadingRemark: r.loading_remark ?? null,
    unloadingRemark: r.unloading_remark ?? null,
    cancelReason: r.cancel_reason ?? null,
    departedAt: r.departed_at ?? null,
    destinationArrivedAt: r.destination_arrived_at ?? null,
    unloadingStartedAt: r.unloading_started_at ?? null,
    unloadingCompletedAt: r.unloading_completed_at ?? null,
    documents: [...docs].sort((a, b) => a.position - b.position).map(docFromRow),
    ...(photos.length ? { statusPhotos: Object.fromEntries(photos.map((p) => [p.status, photoFromRow(p)])) } : {}),
    ...(r.issue_reason ? { issueReason: r.issue_reason } : {}),
    ...(openIssueRow ? { openIssue: {
      id: openIssueRow.id, reason: openIssueRow.reason,
      reportedByName: openIssueRow.reported_by_name, reportedAt: openIssueRow.reported_at,
    } } : {}),
    ...(delays.length ? { delayReports: [...delays].sort((a, b) => a.id - b.id).map(delayFromRow) } : {}),
    ...(r.driver_acknowledged_at ? { driverAcknowledgedAt: r.driver_acknowledged_at } : {}),
    ...(r.cancel_acknowledged_at ? { cancelAcknowledgedAt: r.cancel_acknowledged_at } : {}),
    ...(r.created_at ? { createdAt: r.created_at } : {}),
  };
}

const groupBy = (rows: Row[], col: string) => {
  const m = new Map<string, Row[]>();
  for (const r of rows) { const k = r[col]; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
};

/* ════════════════════════════════════════════════════════════════════════════
   ADMIN — LOAD
   ════════════════════════════════════════════════════════════════════════════ */

export interface AdminData {
  drivers: LocalDriver[]; trucks: LocalTruck[];
  assignments: Assignment[]; completed: CompletedTask[]; cancelled: Assignment[];
  notifications: AppNotification[]; activityLog: AdminActivityEntry[];
}

/* Archived drivers/trucks come back SEPARATELY and are never part of AdminData, so the
   auto-save (syncAdminData) can't edit or delete them — they change only via archive_*(). */
export interface ArchivedData { archivedDrivers: LocalDriver[]; archivedTrucks: LocalTruck[] }

/* Read only the database's creation metadata after an existing local save succeeds. */
export async function readRecordCreationTimes(table: 'assignments' | 'drivers', ids: string[]): Promise<Array<{ id: string; createdAt: string }>> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from(table).select('id, created_at').in('id', ids);
  if (error) throw error;
  return (data ?? []).filter((row) => typeof row.created_at === 'string')
    .map((row) => ({ id: row.id, createdAt: row.created_at }));
}

export async function loadAdminData(): Promise<AdminData & ArchivedData> {
  const [driverRows, pinRows, truckRows, asnRows, docRows, photoRows, delayRows, issueRows, notifRows, actRows] = await Promise.all([
    fetchAll('drivers',              [['created_at', true], ['id', true]]),
    fetchAll('driver_pins',          [['driver_id', true]]),
    fetchAll('trucks',               [['id', true]]),
    fetchAll('assignments',          [['created_at', true], ['id', true]]),
    fetchAll('assignment_documents', [['assignment_id', true], ['type', true]]),
    fetchAll('status_photos',        [['assignment_id', true], ['status', true]]),
    fetchAll('delay_reports',        [['id', true]]),
    fetchAll('assignment_issues',    [['reported_at', false]]),
    fetchAll('notifications',        [['created_at', false], ['id', false]]),
    fetchAll('activity_log',         [['ts', false], ['id', false]]),
  ]);
  await signStoredFiles([...docRows.map((r) => r.file_url), ...photoRows.map((r) => r.url), ...notifRows.map((r) => r.photo_url)]);

  const pins = new Map(pinRows.map((p) => [p.driver_id as string, p.pin as string]));
  const allDrivers: LocalDriver[] = driverRows.map((r) => ({
    id: r.id, name: r.name, phone: r.phone, truckNumber: r.truck_number ?? '', status: r.status,
    currentLocation: r.current_location ?? '—', deliveriesToday: r.deliveries_today ?? 0,
    rating: Number(r.rating ?? 0),
    ...(pins.has(r.id) ? { pin: pins.get(r.id) } : {}),
    ...(r.shift ? { shift: r.shift } : {}),
    ...(r.archived_at ? { archivedAt: r.archived_at } : {}),
    ...(r.created_at ? { createdAt: r.created_at } : {}),
  }));
  const allTrucks: LocalTruck[] = truckRows.map((r) => ({
    id: r.id, plateNumber: r.plate_number, status: r.status,
    ...(r.classification ? { classification: r.classification } : {}),
    ...(r.capacity ? { capacity: r.capacity } : {}),
    ...(r.archived_at ? { archivedAt: r.archived_at } : {}),
  }));
  const drivers         = allDrivers.filter((d) => !d.archivedAt);
  const trucks          = allTrucks.filter((t)  => !t.archivedAt);
  const archivedDrivers = allDrivers.filter((d) => !!d.archivedAt);
  const archivedTrucks  = allTrucks.filter((t)  => !!t.archivedAt);

  const docsBy = groupBy(docRows, 'assignment_id');
  const photosBy = groupBy(photoRows, 'assignment_id');
  const delaysBy = groupBy(delayRows, 'assignment_id');
  const issuesBy = groupBy(issueRows, 'assignment_id');
  const build = (r: Row) => assignmentFromRow(r, docsBy.get(r.id) ?? [], photosBy.get(r.id) ?? [], delaysBy.get(r.id) ?? [], issuesBy.get(r.id) ?? []);

  const completionActivityByAssignment = new Map<string, Row>();
  for (const entry of actRows) {
    if (entry.type === 'task_completed' && entry.assignment_id && !completionActivityByAssignment.has(entry.assignment_id)) {
      completionActivityByAssignment.set(entry.assignment_id, entry);
    }
  }
  const assignments = asnRows.filter((r) => r.state === 'active').map(build);
  /* REQ-013: completed_at_utc is server-stamped inside complete_assignment() and is the
     trustworthy instant now — prefer it. Fall back to the activity_log lookup only for
     rows completed before this column existed. */
  const completed: CompletedTask[] = asnRows.filter((r) => r.state === 'completed')
    .map((r) => ({ ...build(r), completedAt: r.completed_at ?? '', completedEventAt: r.completed_at_utc ?? completionActivityByAssignment.get(r.id)?.ts ?? null }));
  const cancelActivityByAssignment = new Map<string, Row>();
  for (const entry of actRows) {
    if (entry.type === 'task_cancelled' && entry.assignment_id && !cancelActivityByAssignment.has(entry.assignment_id)) {
      cancelActivityByAssignment.set(entry.assignment_id, entry);
    }
  }
  const cancelled = asnRows.filter((r) => r.state === 'cancelled').map((r) => {
    const audit = cancelActivityByAssignment.get(r.id);
    return {
      ...build(r),
      cancelledBy: audit?.member_name ?? audit?.admin_email ?? null,
      /* REQ-013: assignments.cancelled_at is server-stamped inside cancel_assignment() —
         prefer it, same fallback reasoning as completedEventAt above. */
      cancelledAt: r.cancelled_at ?? audit?.ts ?? null,
    };
  });

  const notifications: AppNotification[] = notifRows.map((r) => ({
    id: r.id, type: r.type, message: r.message ?? '', assignmentId: r.assignment_id,
    driverName: r.driver_name ?? '', truckPlate: r.truck_plate ?? '', read: !!r.read, timestamp: r.time_label ?? '',
    ...(r.created_at ? { createdAt: r.created_at } : {}),
    ...(r.doc_type ? { docType: r.doc_type } : {}),
    ...(r.status_update ? { statusUpdate: r.status_update } : {}),
    ...(r.photo_url ? { photoUrl: displayUrl(r.photo_url) } : {}),
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.navigate_to ? { navigateTo: r.navigate_to } : {}),
  }));

  const activityLog: AdminActivityEntry[] = actRows.map((r) => ({
    id: r.id, type: r.type, timestamp: r.ts,
    ...(r.admin_email ? { adminEmail: r.admin_email } : {}),
    ...(r.admin_role ? { adminRole: r.admin_role } : {}),
    ...(r.driver_name ? { driverName: r.driver_name } : {}),
    ...(r.truck_plate ? { truckPlate: r.truck_plate } : {}),
    ...(r.assignment_id ? { assignmentId: r.assignment_id } : {}),
    ...(r.doc_type ? { docType: r.doc_type } : {}),
    ...(r.reject_reason ? { rejectReason: r.reject_reason } : {}),
    ...(r.destination ? { destination: r.destination } : {}),
    ...(r.company ? { company: r.company } : {}),
    ...(r.member_name ? { memberName: r.member_name } : {}),
    ...(r.member_email ? { memberEmail: r.member_email } : {}),
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.changes ? { changes: r.changes } : {}),
  }));

  const data: AdminData = { drivers, trucks, assignments, completed, cancelled, notifications, activityLog };
  snapshot = flatten(data);        // remember what the database looks like right now (active records only)
  return { ...data, archivedDrivers, archivedTrucks };
}

/* ════════════════════════════════════════════════════════════════════════════
   ADMIN — SAVE (diff against the last load)
   ════════════════════════════════════════════════════════════════════════════ */

/* "Flat" = the state expressed as table rows, keyed by primary key. Comparing two Flats
   tells us exactly which rows to insert / update / delete. */
interface Flat {
  drivers: Map<string, Row>; trucks: Map<string, Row>; assignments: Map<string, Row>;
  docs: Map<string, Row>; photos: Map<string, Row>; delays: Map<string, string>;   // assignment id -> JSON of its list
  notifications: Map<string, Row>; activity: Map<string, Row>;
  logins: Map<string, string>;                                                     // driver id -> "phone|pin"
}
let snapshot: Flat | null = null;

const key2 = (a: string, b: string) => `${a} ${b}`;

function flatten(d: AdminData): Flat {
  const f: Flat = {
    drivers: new Map(), trucks: new Map(), assignments: new Map(), docs: new Map(), photos: new Map(),
    delays: new Map(), notifications: new Map(), activity: new Map(), logins: new Map(),
  };
  const driverIds = new Set(d.drivers.map((x) => x.id));
  const truckIds  = new Set(d.trucks.map((x) => x.id));

  for (const x of d.drivers) {
    f.drivers.set(x.id, {
      id: x.id, name: x.name, phone: x.phone, truck_number: x.truckNumber ?? '', status: x.status,
      current_location: x.currentLocation ?? '—', deliveries_today: x.deliveriesToday ?? 0,
      rating: x.rating ?? 0, shift: x.shift ?? null,
    });
    if (x.pin) f.logins.set(x.id, `${x.phone}|${x.pin}`);
  }
  for (const x of d.trucks) {
    f.trucks.set(x.id, {
      id: x.id, plate_number: x.plateNumber, status: x.status,
      classification: x.classification ?? null, capacity: x.capacity ?? null,
    });
  }

  const addAssignment = (a: Assignment, state: 'active' | 'completed' | 'cancelled', completedAt?: string) => {
    f.assignments.set(a.id, {
      id: a.id,
      // an assignment may outlive its driver/truck (history) — the foreign key must not dangle
      driver_id: driverIds.has(a.driverId) ? a.driverId : null,
      driver_name: a.driverName ?? '',
      truck_id: truckIds.has(a.truckId) ? a.truckId : null,
      truck_plate: a.truckPlate ?? '', destination: a.destination ?? '',
      ...(destinationAreaEnabled ? { destination_area: a.destinationArea ?? null } : {}),
      company: a.company ?? '',
      pickup_location: a.pickupLocation ?? '', pickup_time: a.pickupTime ?? '', picked_up_date: a.pickedUpDate ?? '',
      /* REQ-005: only sent when present and valid — rows without exact stops are unchanged */
      ...locationColumnsForRow(a),
      eta: a.eta ?? '', ata: a.ata ?? '', delivery_date: a.deliveryDate ?? '', remarks: a.remarks ?? '',
      task_status: a.taskStatus, assigned_at: a.assignedAt ?? '',
      issue_reason: a.issueReason ?? null, driver_acknowledged_at: a.driverAcknowledgedAt ?? null,
      state, completed_at: completedAt ?? null,
    });
    (a.documents ?? []).forEach((doc, i) => {
      f.docs.set(key2(a.id, doc.type), {
        assignment_id: a.id, type: doc.type, position: i, uploaded: !!doc.uploaded,
        doc_status: doc.docStatus ?? 'pending', file_url: fileRefToStore(doc.fileUrl ?? null), reject_reason: doc.rejectReason ?? null,
      });
    });
    for (const [status, p] of Object.entries(a.statusPhotos ?? {})) {
      f.photos.set(key2(a.id, status), {
        assignment_id: a.id, status, url: fileRefToStore(p.url), taken_at: p.timestamp ?? '', location: p.location ?? '',
        lat: p.coords?.lat ?? null, lng: p.coords?.lng ?? null,
        gps_accuracy_m: p.gpsAccuracyM ?? null, gps_observed_at: p.gpsObservedAt ?? null,
        source: p.source ?? null, capture_observed_at: p.captureObservedAt ?? null,
      });
    }
    if (a.delayReports?.length) {
      f.delays.set(a.id, JSON.stringify(a.delayReports.map((r) => ({ type: r.type, reason: r.reason, reported_at: r.reportedAt ?? '' }))));
    }
  };
  d.assignments.forEach((a) => addAssignment(a, 'active'));
  d.completed.forEach((a)   => addAssignment(a, 'completed', a.completedAt));
  d.cancelled.forEach((a)   => addAssignment(a, 'cancelled'));

  for (const n of d.notifications) {
    f.notifications.set(n.id, {
      id: n.id, type: n.type, message: n.message ?? '', assignment_id: n.assignmentId ?? '',
      driver_name: n.driverName ?? '', truck_plate: n.truckPlate ?? '', doc_type: n.docType ?? null,
      status_update: n.statusUpdate ?? null, photo_url: fileRefToStore(n.photoUrl ?? null), reason: n.reason ?? null,
      read: !!n.read, time_label: n.timestamp ?? '', navigate_to: n.navigateTo ?? null,
    });
  }
  for (const e of d.activityLog) {
    f.activity.set(e.id, {
      id: e.id, type: e.type, ts: e.timestamp, admin_email: e.adminEmail ?? null, admin_role: e.adminRole ?? null,
      driver_name: e.driverName ?? null, truck_plate: e.truckPlate ?? null, assignment_id: e.assignmentId ?? null,
      doc_type: e.docType ?? null, reject_reason: e.rejectReason ?? null, destination: e.destination ?? null,
      company: e.company ?? null, member_name: e.memberName ?? null, member_email: e.memberEmail ?? null,
    });
  }
  return f;
}

const changedColumns = (a: Row, b: Row): Row | null => {
  const out: Row = {};
  for (const k of Object.keys(b)) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) out[k] = b[k];
  return Object.keys(out).length ? out : null;
};

const unique = (e: { code?: string }) => e.code === '23505';
const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/* Insert new rows, update changed columns of existing rows, delete removed rows — for ONE table.
   `prev` (the snapshot) is updated as each step succeeds, so a failure part-way is retried
   from exactly where it stopped on the next save. */
async function syncTable(
  table: string, keyCols: string[], prev: Map<string, Row>, next: Map<string, Row>,
  opts: { insertOnly?: boolean; noDelete?: boolean } = {},
): Promise<void> {
  const keyOf = (r: Row) => (keyCols.length === 1 ? String(r[keyCols[0]]) : key2(r[keyCols[0]], r[keyCols[1]]));
  const match = (q: any, r: Row) => keyCols.reduce((acc, c) => acc.eq(c, r[c]), q);

  const inserts: Row[] = [];
  const updates: Array<{ row: Row; changes: Row }> = [];
  for (const [k, row] of next) {
    const old = prev.get(k);
    if (!old) inserts.push(row);
    else if (!opts.insertOnly) { const changes = changedColumns(old, row); if (changes) updates.push({ row, changes }); }
  }

  /* inserts — a duplicate (row already exists in the database) falls back to an update */
  for (const batch of chunk(inserts, 200)) {
    const { error } = opts.insertOnly
      ? await supabase.from(table).upsert(batch, { onConflict: keyCols.join(','), ignoreDuplicates: true })
      : await supabase.from(table).insert(batch);
    if (!error) { batch.forEach((r) => prev.set(keyOf(r), r)); continue; }
    if (!unique(error)) throw new Error(`${table}: ${error.message}`);
    for (const r of batch) {                                    // one by one to find the duplicate(s)
      const one = await supabase.from(table).insert(r);
      if (one.error && !unique(one.error)) throw new Error(`${table}: ${one.error.message}`);
      if (one.error) {
        const rest = Object.fromEntries(Object.entries(r).filter(([c]) => !keyCols.includes(c)));
        const up = await match(supabase.from(table).update(rest), r);
        if (up.error) throw new Error(`${table}: ${up.error.message}`);
      }
      prev.set(keyOf(r), r);
    }
  }

  /* updates — only the columns that changed, so a stale copy of everything else can't overwrite it */
  for (const { row, changes } of updates) {
    const { data, error } = await match(supabase.from(table).update(changes), row).select(keyCols[0]);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) {                                        // row vanished meanwhile — write it whole
      const ins = await supabase.from(table).insert(row);
      if (ins.error) throw new Error(`${table}: ${ins.error.message}`);
    }
    prev.set(keyOf(row), row);
  }

  /* deletes */
  if (!opts.noDelete) {
    const gone = [...prev.keys()].filter((k) => !next.has(k));
    if (gone.length && next.size === 0 && prev.size > 5) {
      throw new Error(`${table}: refusing to delete all ${prev.size} rows in one save (state looks empty)`);
    }
    for (const batch of chunk(gone, 100)) {
      const { error } = await supabase.from(table).delete().in(keyCols[0], batch);
      if (error) throw new Error(`${table}: ${error.message}`);
      batch.forEach((k) => prev.delete(k));
    }
  }
}

let saveQueue: Promise<void> = Promise.resolve();

/* Read actions save immediately and share the existing queue. Never insert or delete notifications here. */
export function markNotificationsRead(ids: string[]): Promise<void> {
  const run = async () => {
    for (const batch of chunk([...new Set(ids)], 200)) {
      const { data, error } = await supabase.from('notifications').update({ read: true }).in('id', batch).select('id');
      if (error) throw error;
      for (const row of data ?? []) {
        const stored = snapshot?.notifications.get(row.id);
        if (stored) stored.read = true;
      }
      if (data?.length !== batch.length) {
        throw new Error('Some notification read states could not be saved.');
      }
    }
  };
  const result = saveQueue.then(run);
  saveQueue = result.catch(() => undefined);
  return result;
}

/* Save the admin screens' state. Calls are queued so two saves never overlap. */
export function syncAdminData(data: AdminData): Promise<void> {
  const run = async () => {
    if (!snapshot) return;                       // nothing loaded yet — never write from an empty state
    const prev = snapshot;
    const next = flatten(data);
    // A stale queued auto-save must not mark an already-read notification unread again.
    next.notifications.forEach((row, id) => {
      if (prev.notifications.get(id)?.read) row.read = true;
    });

    await syncTable('trucks',  ['id'], prev.trucks,  next.trucks,  { noDelete: true });
    await syncTable('drivers', ['id'], prev.drivers, next.drivers, { noDelete: true });

    /* Driver LOGINS: creating a driver, changing a phone number or regenerating a PIN must also
       update the Supabase Auth user. That needs privileged access to the auth schema, so it is done
       by the sync_driver_login() database function (which checks the caller is admin/csr). */
    for (const [id, sig] of next.logins) {
      if (prev.logins.get(id) === sig) continue;
      const drv = data.drivers.find((x) => x.id === id);
      if (!drv?.pin || !/^\d{4}$/.test(drv.pin)) continue;
      const { error } = await supabase.rpc('sync_driver_login', { p_driver_id: id, p_phone: drv.phone, p_pin: drv.pin });
      if (error) {
        throw new Error(error.message.includes('email_exists')
          ? `The mobile number ${drv.phone} is already used by another driver.`
          : `driver login: ${error.message}`);
      }
      prev.logins.set(id, sig);
    }

    await syncTable('assignments',          ['id'],                       prev.assignments, next.assignments, { noDelete: true });
    await syncTable('assignment_documents', ['assignment_id', 'type'],    prev.docs,        next.docs,        { noDelete: true });
    await syncTable('status_photos',        ['assignment_id', 'status'],  prev.photos,      next.photos,      { noDelete: true });

    /* delay reports have no id of their own — replace an assignment's whole list when it changed */
    for (const [aid, json] of next.delays) {
      if (prev.delays.get(aid) === json) continue;
      const del = await supabase.from('delay_reports').delete().eq('assignment_id', aid);
      if (del.error) throw new Error(`delay_reports: ${del.error.message}`);
      const rows = (JSON.parse(json) as Row[]).map((r) => ({ ...r, assignment_id: aid }));
      const ins = await supabase.from('delay_reports').insert(rows);
      if (ins.error) throw new Error(`delay_reports: ${ins.error.message}`);
      prev.delays.set(aid, json);
    }

    await syncTable('notifications', ['id'], prev.notifications, next.notifications);
    await syncTable('activity_log',  ['id'], prev.activity,      next.activity, { insertOnly: true, noDelete: true });

    /* deletions last: children first, then parents (assignment delete cascades to its documents/photos/delays) */
    await syncTable('assignments', ['id'], prev.assignments, next.assignments, { noDelete: false });
    for (const k of [...prev.docs.keys()])   if (!next.assignments.has(prev.docs.get(k)!.assignment_id))   prev.docs.delete(k);
    for (const k of [...prev.photos.keys()]) if (!next.assignments.has(prev.photos.get(k)!.assignment_id)) prev.photos.delete(k);
    for (const k of [...prev.delays.keys()]) if (!next.assignments.has(k)) prev.delays.delete(k);
    await syncTable('drivers', ['id'], prev.drivers, next.drivers, { noDelete: false });   // removing a driver also removes their login (DB trigger)
    for (const k of [...prev.logins.keys()]) if (!next.drivers.has(k)) prev.logins.delete(k);
    await syncTable('trucks',  ['id'], prev.trucks,  next.trucks,  { noDelete: false });
  };
  const result = saveQueue.then(run);
  saveQueue = result.catch(() => undefined);     // a failed save must not block the next one
  return result;
}

/* ════════════════════════════════════════════════════════════════════════════
   ADMIN — EDIT / CANCEL AN ASSIGNMENT (Monitor → View Details)
   These do NOT go through syncAdminData. The database functions edit_assignment()
   and cancel_assignment() check "is it still Assigned?" and write in one step, so a
   stale tab can't change a delivery the driver already picked up. They also write
   the audit-log row themselves. The caller reloads the data afterwards.
   ════════════════════════════════════════════════════════════════════════════ */

export type AssignmentActionErrorCode =
  | 'wrong_password' | 'reauth_required' | 'not_editable' | 'not_cancellable' | 'loading_completed'
  | 'driver_busy' | 'truck_unavailable' | 'no_changes' | 'not_authorized' | 'not_deployed' | 'invalid' | 'network'
  | 'already_archived' | 'truck_busy'
  | 'already_completed' | 'not_completable' | 'documents_not_approved' | 'driver_archived' | 'truck_archived'
  | 'already_resolved' | 'assignment_not_active';
export class AssignmentActionError extends Error {
  code: AssignmentActionErrorCode;
  constructor(code: AssignmentActionErrorCode, detail?: string) { super(detail ?? code); this.code = code; }
}

/* Re-enter-password check before an edit: signs in again as the CURRENT user.
   The password only goes to Supabase Auth — it is never stored or logged here. */
export async function verifyOwnPassword(password: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) throw new AssignmentActionError('not_authorized');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const bad = error.status === 400 || error.status === 401 || (error as any).code === 'invalid_credentials';
    throw new AssignmentActionError(bad ? 'wrong_password' : 'network');
  }
}

/* Editable fields, in the stored (display) formats the rest of the app uses */
export interface AssignmentEdit {
  driverId?: string; truckId?: string; destination?: string; destinationArea?: string; company?: string; pickupLocation?: string;
  pickupTime?: string; pickedUpDate?: string; eta?: string; deliveryDate?: string; remarks?: string;
}
/* REQ-005 exact stops — kept separate so existing `Required<AssignmentEdit>` form state
   is unaffected. Send latitude + longitude together (numbers, or both null to clear).
   Changing pickupLocation / deliveryLocation without its coordinates clears the old ones. */
export interface AssignmentLocationEdit {
  deliveryLocation?: string;
  pickupLatitude?: number | null; pickupLongitude?: number | null;
  deliveryLatitude?: number | null; deliveryLongitude?: number | null;
}
const EDIT_COLUMNS: Record<keyof (AssignmentEdit & AssignmentLocationEdit), string> = {
  driverId: 'driver_id', truckId: 'truck_id', destination: 'destination',
  destinationArea: 'destination_area', company: 'company',
  pickupLocation: 'pickup_location', pickupTime: 'pickup_time', pickedUpDate: 'picked_up_date',
  eta: 'eta', deliveryDate: 'delivery_date', remarks: 'remarks',
  deliveryLocation: 'delivery_location',
  pickupLatitude: 'pickup_latitude', pickupLongitude: 'pickup_longitude',
  deliveryLatitude: 'delivery_latitude', deliveryLongitude: 'delivery_longitude',
};

/* The functions raise short codes like 'not_editable' — turn them back into a typed error */
function actionFailure(error: { message?: string; code?: string }): AssignmentActionError {
  const m = error.message ?? '';
  const known: AssignmentActionErrorCode[] = [
    'wrong_password', 'loading_completed', 'reauth_required', 'not_editable', 'not_cancellable', 'driver_busy', 'truck_unavailable', 'no_changes', 'not_authorized',
    'already_archived', 'truck_busy',
    'already_completed', 'not_completable', 'documents_not_approved', 'driver_archived', 'truck_archived',
    'already_resolved', 'assignment_not_active',
  ];
  for (const c of known) if (m.includes(c)) return new AssignmentActionError(c, m);
  if (error.code === 'PGRST202') return new AssignmentActionError('not_deployed', m);   // function missing: migration not applied
  if (error.code === '22023' || error.code === 'P0002') return new AssignmentActionError('invalid', m);
  return new AssignmentActionError('network', m);
}

export async function editAssignment(id: string, changes: AssignmentEdit & AssignmentLocationEdit, reason: string): Promise<void> {
  /* Catch NaN / half pairs here: JSON.stringify would turn NaN into null and silently clear */
  const badLocation = invalidLocationEdit(changes);
  if (badLocation) throw new AssignmentActionError('invalid', badLocation);
  const payload = Object.fromEntries(
    Object.entries(changes).map(([k, v]) => [EDIT_COLUMNS[k as keyof (AssignmentEdit & AssignmentLocationEdit)], v]),
  );
  const { error } = await supabase.rpc('edit_assignment', { p_id: id, p_changes: payload, p_reason: reason });
  if (error) throw actionFailure(error);
}

/* Fresh password verification, stage check, cancellation and audit happen in one
   database transaction. Never use the legacy one/two-argument overloads. */
export async function cancelAssignment(id: string, reason: string, password: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_assignment', {
    p_id: id, p_reason: reason.trim(), p_password: password,
  });
  if (error) throw actionFailure(error);
}

/* ── Dispatch / complete (Monitor → Assign Task, View Details → Mark Complete) ──
   One database call each: dispatch_assignment() locks the driver and truck, re-checks both
   are free, then creates the assignment + its 6 document slots, marks driver/truck Assigned
   and logs task_assigned. complete_assignment() checks Delivered + all 6 documents approved,
   then archives it, frees driver/truck and logs task_completed. All or nothing.
   Like edit/cancel, these do NOT go through syncAdminData — the caller reloads afterwards.
   The database makes the assignment id (ASN + 5 digits) and returns it. */
export interface NewAssignment {
  driverId: string; truckId: string; destination: string; destinationArea: string; company: string;
  pickupLocation: string; deliveryLocation?: string; pickupTime?: string; pickedUpDate?: string;
  eta?: string; deliveryDate?: string; remarks?: string;
}
const DISPATCH_COLUMNS: Record<keyof NewAssignment, string> = {
  driverId: 'driver_id', truckId: 'truck_id', destination: 'destination', destinationArea: 'destination_area',
  company: 'company', pickupLocation: 'pickup_location', deliveryLocation: 'delivery_location',
  pickupTime: 'pickup_time', pickedUpDate: 'picked_up_date', eta: 'eta', deliveryDate: 'delivery_date', remarks: 'remarks',
};

export async function dispatchAssignment(input: NewAssignment): Promise<string> {
  const payload = Object.fromEntries(Object.entries(input)
    .filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => [DISPATCH_COLUMNS[k as keyof NewAssignment], v]));
  const { data, error } = await supabase.rpc('dispatch_assignment', { p_fields: payload });
  if (error) throw actionFailure(error);
  return data as string;
}

/** Returns the completedAt label the database saved. */
export async function completeAssignment(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('complete_assignment', { p_id: id });
  if (error) throw actionFailure(error);
  return data as string;
}

/* ── Accounts: archive instead of delete, and new PIN ──
   archive_driver() and reset_driver_pin() refuse unless the admin re-entered their password
   in the last 5 minutes (verifyOwnPassword right before). All three write their own changes;
   the caller reloads afterwards. */
export async function archiveDriver(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_driver', { p_driver_id: id });
  if (error) throw actionFailure(error);
}

export async function archiveTruck(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_truck', { p_truck_id: id });
  if (error) throw actionFailure(error);
}

export async function resetDriverPin(id: string, pin: string): Promise<void> {
  const { error } = await supabase.rpc('reset_driver_pin', { p_driver_id: id, p_pin: pin });
  if (error) throw actionFailure(error);
}

/* Wipe everything except accounts + the audit log (the "reset all data" button). */
export async function resetAllData(): Promise<void> {
  const { error } = await supabase.rpc('reset_all_data');
  if (error) throw new Error(error.message);
  if (snapshot) {
    snapshot.drivers.clear(); snapshot.trucks.clear(); snapshot.assignments.clear(); snapshot.docs.clear();
    snapshot.photos.clear(); snapshot.delays.clear(); snapshot.notifications.clear(); snapshot.logins.clear();
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   TEAM MEMBERS (Operation Manager only — enforced by RLS + the RPC functions)
   ════════════════════════════════════════════════════════════════════════════ */

const memberFromRow = (r: Row): TeamMember => ({
  id: r.id, name: r.name ?? '', email: r.email,
  role: r.role, status: r.status, invitedAt: r.invited_at, ...(r.last_active ? { lastActive: r.last_active } : {}),
  avatarPath: r.avatar_path ?? null,
});

export async function listTeamMembers(): Promise<TeamMember[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from('profiles').select('*').eq('role', 'csr')
      .order('invited_at').order('id').range(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return rows.map(memberFromRow);
}

/** Sets no password — create_team_member() generates a random, never-returned
 * throwaway one and instead issues a one-time setup link (reusing REQ-006's
 * reset-link machinery), so a password never has to be relayed out-of-band. */
export async function createTeamMember(input: { name: string; email: string; role: 'csr' }): Promise<TeamMember & { setupToken: string }> {
  const { data, error } = await supabase.rpc('create_team_member', {
    p_name: input.name, p_email: input.email, p_role: input.role,
  });
  if (error) {
    if (error.message.includes('email_exists')) throw new Error('A member with that email already exists');
    if (error.message.includes('not_authorized')) throw new Error('Only the Operation Manager can add team members.');
    throw new Error(error.message);
  }
  const row = data as Row;
  return { ...memberFromRow({ ...row, invited_at: row.invitedAt }), setupToken: row.setupToken as string };
}

export async function archiveTeamMember(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_team_member', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function restoreTeamMember(id: string): Promise<void> {
  const { error } = await supabase.rpc('restore_team_member', { p_id: id });
  if (error) throw new Error(error.message);
}

export interface CsrPasswordResetRequest {
  id: string;
  userId: string;
  email: string;
  requestedAt: string;
  expiresAt: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'expired';
}

export async function requestCsrPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.rpc('request_csr_password_reset', { p_email: email.trim().toLowerCase() });
  if (error) throw new Error('Could not submit the request. Please try again later.');
}

export async function listCsrPasswordResetRequests(): Promise<CsrPasswordResetRequest[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from('csr_password_reset_requests')
      .select('id,user_id,requested_email,requested_at,status,expires_at')
      .order('requested_at', { ascending: false }).order('id').range(from, from + 499);
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        throw new Error('Password reset requests are unavailable. Check the REQ-006 database setup.');
      }
      throw new Error(error.message);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return rows.map((row) => ({
    id: row.id, userId: row.user_id, email: row.requested_email,
    requestedAt: row.requested_at, expiresAt: row.expires_at,
    status: row.status as CsrPasswordResetRequest['status'],
  }));
}

export async function reviewCsrPasswordReset(id: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('review_csr_password_reset', { p_id: id, p_approve: approve });
  if (error) throw new Error(error.message);
}

export async function createCsrPasswordResetLink(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_csr_password_reset_link', { p_id: id });
  if (error) {
    const code = ['request_not_approved', 'request_expired', 'member_not_eligible', 'reset_in_progress', 'not_authorized']
      .find((candidate) => error.message.includes(candidate));
    throw new Error(code ?? 'reset_link_failed');
  }
  if (typeof data !== 'string' || !/^[0-9a-f]{64}$/.test(data)) throw new Error('reset_link_failed');
  return data;
}

export type CsrPasswordResetErrorCode =
  | 'reset_link_invalid_or_expired' | 'password_too_short' | 'password_too_long'
  | 'weak_password' | 'invalid_request' | 'reset_failed';

const resetErrorCodes: CsrPasswordResetErrorCode[] = [
  'reset_link_invalid_or_expired', 'password_too_short', 'password_too_long',
  'weak_password', 'invalid_request', 'reset_failed',
];

export async function completeCsrPasswordReset(token: string, newPassword: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('complete-csr-password-reset', {
    body: { token, newPassword },
  });
  if (!error && data?.ok === true) return;
  let code = data?.error;
  if (error && 'context' in error && error.context instanceof Response) {
    try { code = (await error.context.json())?.error; } catch { /* keep generic feedback */ }
  }
  throw new Error(resetErrorCodes.includes(code) ? code : 'reset_failed');
}

/* ════════════════════════════════════════════════════════════════════════════
   DRIVER
   ════════════════════════════════════════════════════════════════════════════ */

export interface DriverViewData {
  driver: { id: string; name: string; phone: string; status: string; currentLocation: string };
  assignment: Assignment | null;
  completedHistory: Array<{ id: string; destination: string; destinationArea?: string | null; company: string; deliveryDate: string; completedAt: string; truckPlate: string; taskStatus: string }>;
  /** Most recent cancelled assignment the driver hasn't dismissed yet, or null. */
  cancelledNotice: { id: string; reason: string | null; cancelledAt: string } | null;
}

/* The driver's active job (or the latest finished one, so documents can still be uploaded)
   plus their delivery history. RLS already limits every query to this driver's own rows. */
export async function loadDriverData(driverId: string): Promise<DriverViewData> {
  const [drv, asn] = await Promise.all([
    supabase.from('drivers').select('*').eq('id', driverId).maybeSingle(),
    supabase.from('assignments').select('*').eq('driver_id', driverId),
  ]);
  if (drv.error) throw drv.error;
  if (asn.error) throw asn.error;
  if (!drv.data) throw new Error('Driver not found');

  const rows = asn.data ?? [];
  const live = rows.filter((r) => r.state === 'active');
  const isTerminal = (s: string) => s === 'Delivered' || s === 'Failed / Issue' || s === 'Cancelled';
  const active   = live.find((r) => !isTerminal(r.task_status));
  const terminal = live.filter((r) => r.task_status === 'Delivered' || r.task_status === 'Failed / Issue')
    .sort((a, b) => (b.assigned_at ?? '').localeCompare(a.assigned_at ?? ''))[0];
  const chosen = active ?? terminal ?? null;

  let assignment: Assignment | null = null;
  if (chosen) {
    const [docs, photos, delays, issues] = await Promise.all([
      supabase.from('assignment_documents').select('*').eq('assignment_id', chosen.id),
      supabase.from('status_photos').select('*').eq('assignment_id', chosen.id),
      supabase.from('delay_reports').select('*').eq('assignment_id', chosen.id),
      supabase.from('assignment_issues').select('*').eq('assignment_id', chosen.id),
    ]);
    for (const r of [docs, photos, delays, issues]) if (r.error) throw r.error;
    await signStoredFiles([...(docs.data ?? []).map((r) => r.file_url), ...(photos.data ?? []).map((r) => r.url)]);
    assignment = assignmentFromRow(chosen, docs.data ?? [], photos.data ?? [], delays.data ?? [], issues.data ?? []);
  }

  const completedHistory = rows.filter((r) => r.state === 'completed')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    .map((r) => ({
      id: r.id, destination: r.destination, destinationArea: r.destination_area ?? null,
      company: r.company, deliveryDate: r.delivery_date,
      completedAt: r.completed_at ?? '', truckPlate: r.truck_plate, taskStatus: r.task_status,
    }));

  const unacknowledgedCancellation = rows.filter((r) => r.state === 'cancelled' && !r.cancel_acknowledged_at)
    .sort((a, b) => (b.cancelled_at ?? '').localeCompare(a.cancelled_at ?? ''))[0];
  const cancelledNotice = unacknowledgedCancellation
    ? { id: unacknowledgedCancellation.id, reason: unacknowledgedCancellation.cancel_reason ?? null, cancelledAt: unacknowledgedCancellation.cancelled_at ?? '' }
    : null;

  return {
    driver: { id: drv.data.id, name: drv.data.name, phone: drv.data.phone, status: drv.data.status, currentLocation: drv.data.current_location ?? '—' },
    assignment, completedHistory, cancelledNotice,
  };
}

/* Read a completed delivery only when its driver opens it. Keep the driver ID in
   the query as well as relying on RLS, so history cannot be widened by the UI. */
export async function loadDriverCompletedDelivery(driverId: string, assignmentId: string): Promise<(CompletedTask & {
  documents: Array<AssignmentDoc & { uploadedAt?: string }>;
}) | null> {
  const { data: row, error } = await supabase.from('assignments').select('*')
    .eq('id', assignmentId).eq('driver_id', driverId).eq('state', 'completed').maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const { data: docs, error: docsError } = await supabase.from('assignment_documents').select('*')
    .eq('assignment_id', assignmentId);
  if (docsError) throw docsError;
  await signStoredFiles((docs ?? []).map((d) => d.file_url));
  return {
    ...assignmentFromRow(row, docs ?? [], [], []),
    completedAt: row.completed_at ?? '',
    documents: (docs ?? []).sort((a, b) => a.position - b.position).map((doc) => ({
      ...docFromRow(doc),
      ...(doc.uploaded_at ? { uploadedAt: doc.uploaded_at as string } : {}),
    })),
  };
}

/** REQ-002 validates ownership, order, required photos, and timestamps on the server.
 * `remark` is only used by finish_loading/finish_unloading — ignored by every other
 * transition — and is write-once: there's no path to edit it after it's set. */
export async function advanceDriverStage(assignmentId: string, transition: string, remark?: string): Promise<void> {
  const { error } = await supabase.rpc('advance_driver_stage', {
    p_assignment_id: assignmentId, p_transition: transition, p_remark: remark?.trim() || null,
  });
  if (error) throw error;
}

/** REQ-008: the real issue lifecycle, replacing the old issue_reason/
 * task_status='Failed / Issue' path. The server derives the blocking
 * classification and validates issueType — never set task_status here. */
export async function reportAssignmentIssue(
  assignmentId: string, issueType: string, reason: string, idempotencyKey?: string,
): Promise<void> {
  const { error } = await supabase.rpc('report_assignment_issue', {
    p_assignment_id: assignmentId, p_issue_type: issueType, p_reason: reason,
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) throw error;
}

/** CSR/admin only — the server re-checks can_write() regardless of what the UI allows. */
export async function resolveAssignmentIssue(issueId: number, resolutionNote?: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_assignment_issue', {
    p_issue_id: issueId, p_resolution_note: resolutionNote?.trim() || null,
  });
  if (error) throw actionFailure(error);
}

/** REQ-007: a persistent, publicly-verifiable Report ID. admin/CSR only —
 * server-stamps generated_at/generated_by, never trusts the client for those. */
export async function issueReport(input: {
  reportType: 'weekly' | 'monthly' | 'delay' | 'utilization';
  periodStart?: string | null; periodEnd?: string | null;
  rowCount: number; rowDigest?: string | null;
}): Promise<{ id: string; generatedAt: string }> {
  const { data, error } = await supabase.rpc('issue_report', {
    p_report_type: input.reportType, p_period_start: input.periodStart ?? null, p_period_end: input.periodEnd ?? null,
    p_row_count: input.rowCount, p_row_digest: input.rowDigest ?? null,
  });
  if (error) throw error;
  const row = data as { id: string; generatedAt: string };
  return { id: row.id, generatedAt: row.generatedAt };
}

export interface VerifiedReport {
  id: string; reportType: string; generatedByName: string; generatedAt: string;
  periodStart: string | null; periodEnd: string | null; rowCount: number;
}

/** Public lookup — no session required (anon may execute). Returns null when the ID is unknown. */
export async function verifyReport(id: string): Promise<VerifiedReport | null> {
  const { data, error } = await supabase.rpc('verify_report', { p_id: id });
  if (error) throw error;
  return (data as VerifiedReport | null) ?? null;
}

export interface IssuedReportSummary {
  id: string; reportType: string; generatedByName: string; generatedAt: string;
  periodStart: string | null; periodEnd: string | null; rowCount: number;
}

/** Staff only (is_staff() — read access, same as other staff-visible history). */
export async function listIssuedReports(limit = 20): Promise<IssuedReportSummary[]> {
  const { data, error } = await supabase.rpc('list_issued_reports', { p_limit: limit });
  if (error) throw error;
  return (data as Row[] ?? []).map((r) => ({
    id: r.id, reportType: r.report_type, generatedByName: r.generated_by_name, generatedAt: r.generated_at,
    periodStart: r.report_period_start ?? null, periodEnd: r.report_period_end ?? null, rowCount: r.row_count,
  }));
}

/* Everything a driver may change (the database triggers enforce it — see guard_* in the migration):
   status / issue reason / acknowledgement, photos, delay reports, new document files, + a notification. */
export async function driverUpdate(
  driverName: string, assignmentId: string, updates: Partial<Assignment>, notif?: Record<string, any>,
): Promise<void> {
  /* photos first, so the status change never points at a photo that failed to save */
  if (updates.statusPhotos) {
    const rows = Object.entries(updates.statusPhotos)
      .filter(([, p]) => !isInlineImage(p.url))
      .map(([status, p]) => ({
        assignment_id: assignmentId, status, url: fileRefToStore(p.url), taken_at: p.timestamp ?? '', location: p.location ?? '',
        lat: p.coords?.lat ?? null, lng: p.coords?.lng ?? null,
        gps_accuracy_m: p.gpsAccuracyM ?? null, gps_observed_at: p.gpsObservedAt ?? null,
        source: p.source ?? null, capture_observed_at: p.captureObservedAt ?? null,
      }));
    if (rows.length) {
      const { error } = await supabase.from('status_photos').upsert(rows, { onConflict: 'assignment_id,status' });
      if (error) throw new Error(`photos: ${error.message}`);
    }
  }

  const cols: Row = {};
  if (updates.taskStatus            !== undefined) cols.task_status = updates.taskStatus;
  if (updates.issueReason           !== undefined) cols.issue_reason = updates.issueReason;
  if (updates.driverAcknowledgedAt  !== undefined) cols.driver_acknowledged_at = updates.driverAcknowledgedAt;
  if (updates.cancelAcknowledgedAt  !== undefined) cols.cancel_acknowledged_at = updates.cancelAcknowledgedAt;
  if (Object.keys(cols).length) {
    const { data, error } = await supabase.from('assignments').update(cols).eq('id', assignmentId).select('id');
    if (error) throw new Error(`assignment: ${error.message}`);
    if (!data?.length) throw new Error('assignment not found');
  }

  if (updates.delayReports?.length) {
    const { count, error } = await supabase.from('delay_reports').select('id', { count: 'exact', head: true }).eq('assignment_id', assignmentId);
    if (error) throw new Error(`delay reports: ${error.message}`);
    const fresh = updates.delayReports.slice(count ?? 0)
      .map((r) => ({ assignment_id: assignmentId, type: r.type, reason: r.reason, reported_at: r.reportedAt ?? '' }));
    if (fresh.length) {
      const ins = await supabase.from('delay_reports').insert(fresh);
      if (ins.error) throw new Error(`delay reports: ${ins.error.message}`);
    }
  }

  /* Documents: only a NEW file counts (the trigger then resets that document to "pending" for admin
     review and ignores any status the driver tries to send) — same "smart merge" the old server did. */
  if (updates.documents?.length) {
    const { data: existing, error } = await supabase.from('assignment_documents').select('type, file_url').eq('assignment_id', assignmentId);
    if (error) throw new Error(`documents: ${error.message}`);
    const have = new Map((existing ?? []).map((r) => [r.type as string, r.file_url as string | null]));
    for (const d of updates.documents) {
      if (!d.fileUrl || isInlineImage(d.fileUrl) || sameStoredFile(have.get(d.type), d.fileUrl, BUCKET)) continue;
      const fileRef = fileRefToStore(d.fileUrl);
      const res = have.has(d.type)
        ? await supabase.from('assignment_documents').update({ file_url: fileRef, uploaded: true }).eq('assignment_id', assignmentId).eq('type', d.type)
        : await supabase.from('assignment_documents').insert({
            assignment_id: assignmentId, type: d.type, uploaded: true, doc_status: 'pending', file_url: fileRef,
            position: Math.max(0, (DOCUMENT_TYPES as readonly string[]).indexOf(d.type)),
          });
      if (res.error) throw new Error(`documents: ${res.error.message}`);
    }
  }

  if (notif) {
    /* no .select() here on purpose: drivers may insert notifications but not read the feed back */
    const { error } = await supabase.from('notifications').insert({
      id: notif.id ?? `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      read: false, time_label: timeLabel(), driver_name: driverName,
      type: notif.type, message: notif.message ?? '', assignment_id: assignmentId,
      truck_plate: notif.truckPlate ?? '', doc_type: notif.docType ?? null, status_update: notif.statusUpdate ?? null,
      photo_url: fileRefToStore(notif.photoUrl ?? null), reason: notif.reason ?? null, navigate_to: notif.navigateTo ?? null,
    });
    // A repeated request for the same persisted milestone must not make a second card.
    if (error && !(notif.id && error.code === '23505')) throw new Error(`notification: ${error.message}`);
  }
}

/** Staff-side event after the cancellation RPC commits. The RPC owns cancellation and audit. */
export async function notifyAssignmentCancelled(assignment: Assignment, reason: string, actor: string): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    id: `assignment-${assignment.id}-cancelled`, type: 'status_update',
    message: `[${assignment.truckPlate}] Delivery cancelled · ${reason}`,
    assignment_id: assignment.id, driver_name: actor, truck_plate: assignment.truckPlate,
    status_update: 'cancelled', reason, navigate_to: 'Monitor', time_label: timeLabel(), read: false,
  });
  if (error && error.code !== '23505') throw error;
}

/* Upload a photo/document (a base64 data URL from the camera) and return a link to show it.
   The link works for one hour; whatever saves it stores only the file's path (fileRefToStore). */
export async function uploadImage(dataUrl: string, path: string): Promise<string> {
  const [head, b64 = ''] = dataUrl.split(',');
  const contentType = head.startsWith('data:') ? head.slice(5).split(';')[0] || 'image/jpeg' : 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_LINK_SECONDS);
  if (error || !data) throw new Error(`sign: ${error?.message ?? 'no url'}`);
  signedLinks.set(path, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_LINK_SECONDS * 1000 });
  return data.signedUrl;
}
