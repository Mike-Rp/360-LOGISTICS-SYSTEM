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
}
export type LoginErrorCode = 'invalid_credentials' | 'no_access' | 'network';
export class LoginError extends Error {
  code: LoginErrorCode;
  constructor(code: LoginErrorCode) { super(code); this.code = code; }
}
export type AppSession =
  | { kind: 'staff';  staff: StaffSession }
  | { kind: 'driver'; driver: { id: string; name: string } }
  | null;

const toStaff = (p: Row): StaffSession => ({
  id: p.id, email: p.email, name: p.name ?? '', role: p.role as AdminRole, isOm: !!p.is_om, isDemo: !!p.is_demo,
});

async function fetchProfile(uid: string): Promise<Row | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data;
}
async function fetchOwnDriver(uid: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase.from('drivers').select('id, name').eq('auth_user_id', uid).maybeSingle();
  if (error) throw error;
  return data;
}

function loginFailure(error: { status?: number; code?: string }): LoginError {
  const bad = error.status === 400 || error.status === 401 || error.code === 'invalid_credentials';
  return new LoginError(bad ? 'invalid_credentials' : 'network');
}

/* Admin / Operation Manager / CSR / Viewer — one path for all of them now. */
export async function signInStaff(email: string, password: string): Promise<StaffSession> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.user) throw loginFailure(error ?? {});
  let profile: Row | null;
  try { profile = await fetchProfile(data.user.id); }
  catch { await supabase.auth.signOut(); throw new LoginError('network'); }
  if (!profile || profile.status !== 'active') {
    await supabase.auth.signOut();          // valid login but not a staff account (e.g. a driver, or removed)
    throw new LoginError('no_access');
  }
  void supabase.rpc('touch_last_active');
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
  catch { await supabase.auth.signOut(); throw new LoginError('network'); }
  if (!driver) { await supabase.auth.signOut(); throw new LoginError('no_access'); }
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
  await supabase.auth.signOut();
  return null;
}

export const signOut = () => supabase.auth.signOut();

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
  ...(r.file_url ? { fileUrl: r.file_url } : {}),
  ...(r.reject_reason ? { rejectReason: r.reject_reason } : {}),
});
const photoFromRow = (r: Row): StatusPhoto => ({
  url: r.url, timestamp: r.taken_at ?? '', location: r.location ?? '',
  ...(r.lat != null && r.lng != null ? { coords: { lat: r.lat, lng: r.lng } } : {}),
});
const delayFromRow = (r: Row): DelayReport => ({ type: r.type, reason: r.reason, reportedAt: r.reported_at ?? '' });

function assignmentFromRow(r: Row, docs: Row[], photos: Row[], delays: Row[]): Assignment {
  return {
    id: r.id, driverName: r.driver_name ?? '', driverId: r.driver_id ?? '',
    truckPlate: r.truck_plate ?? '', truckId: r.truck_id ?? '',
    destination: r.destination ?? '', company: r.company ?? '',
    pickupLocation: r.pickup_location ?? '', pickupTime: r.pickup_time ?? '', pickedUpDate: r.picked_up_date ?? '',
    eta: r.eta ?? '', ata: r.ata ?? '', deliveryDate: r.delivery_date ?? '', remarks: r.remarks ?? '',
    taskStatus: r.task_status, assignedAt: r.assigned_at ?? '',
    documents: [...docs].sort((a, b) => a.position - b.position).map(docFromRow),
    ...(photos.length ? { statusPhotos: Object.fromEntries(photos.map((p) => [p.status, photoFromRow(p)])) } : {}),
    ...(r.issue_reason ? { issueReason: r.issue_reason } : {}),
    ...(delays.length ? { delayReports: [...delays].sort((a, b) => a.id - b.id).map(delayFromRow) } : {}),
    ...(r.driver_acknowledged_at ? { driverAcknowledgedAt: r.driver_acknowledged_at } : {}),
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

export async function loadAdminData(): Promise<AdminData> {
  const [driverRows, pinRows, truckRows, asnRows, docRows, photoRows, delayRows, notifRows, actRows] = await Promise.all([
    fetchAll('drivers',              [['created_at', true], ['id', true]]),
    fetchAll('driver_pins',          [['driver_id', true]]),
    fetchAll('trucks',               [['id', true]]),
    fetchAll('assignments',          [['created_at', true], ['id', true]]),
    fetchAll('assignment_documents', [['assignment_id', true], ['type', true]]),
    fetchAll('status_photos',        [['assignment_id', true], ['status', true]]),
    fetchAll('delay_reports',        [['id', true]]),
    fetchAll('notifications',        [['created_at', false], ['id', false]]),
    fetchAll('activity_log',         [['ts', false], ['id', false]]),
  ]);

  const pins = new Map(pinRows.map((p) => [p.driver_id as string, p.pin as string]));
  const drivers: LocalDriver[] = driverRows.map((r) => ({
    id: r.id, name: r.name, phone: r.phone, truckNumber: r.truck_number ?? '', status: r.status,
    currentLocation: r.current_location ?? '—', deliveriesToday: r.deliveries_today ?? 0,
    rating: Number(r.rating ?? 0),
    ...(pins.has(r.id) ? { pin: pins.get(r.id) } : {}),
    ...(r.shift ? { shift: r.shift } : {}),
  }));
  const trucks: LocalTruck[] = truckRows.map((r) => ({
    id: r.id, plateNumber: r.plate_number, status: r.status,
    ...(r.classification ? { classification: r.classification } : {}),
    ...(r.capacity ? { capacity: r.capacity } : {}),
  }));

  const docsBy = groupBy(docRows, 'assignment_id');
  const photosBy = groupBy(photoRows, 'assignment_id');
  const delaysBy = groupBy(delayRows, 'assignment_id');
  const build = (r: Row) => assignmentFromRow(r, docsBy.get(r.id) ?? [], photosBy.get(r.id) ?? [], delaysBy.get(r.id) ?? []);

  const assignments = asnRows.filter((r) => r.state === 'active').map(build);
  const completed: CompletedTask[] = asnRows.filter((r) => r.state === 'completed')
    .map((r) => ({ ...build(r), completedAt: r.completed_at ?? '' }));
  const cancelled = asnRows.filter((r) => r.state === 'cancelled').map(build);

  const notifications: AppNotification[] = notifRows.map((r) => ({
    id: r.id, type: r.type, message: r.message ?? '', assignmentId: r.assignment_id,
    driverName: r.driver_name ?? '', truckPlate: r.truck_plate ?? '', read: !!r.read, timestamp: r.time_label ?? '',
    ...(r.doc_type ? { docType: r.doc_type } : {}),
    ...(r.status_update ? { statusUpdate: r.status_update } : {}),
    ...(r.photo_url ? { photoUrl: r.photo_url } : {}),
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
  }));

  const data: AdminData = { drivers, trucks, assignments, completed, cancelled, notifications, activityLog };
  snapshot = flatten(data);        // remember what the database looks like right now
  return data;
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
      truck_plate: a.truckPlate ?? '', destination: a.destination ?? '', company: a.company ?? '',
      pickup_location: a.pickupLocation ?? '', pickup_time: a.pickupTime ?? '', picked_up_date: a.pickedUpDate ?? '',
      eta: a.eta ?? '', ata: a.ata ?? '', delivery_date: a.deliveryDate ?? '', remarks: a.remarks ?? '',
      task_status: a.taskStatus, assigned_at: a.assignedAt ?? '',
      issue_reason: a.issueReason ?? null, driver_acknowledged_at: a.driverAcknowledgedAt ?? null,
      state, completed_at: completedAt ?? null,
    });
    (a.documents ?? []).forEach((doc, i) => {
      f.docs.set(key2(a.id, doc.type), {
        assignment_id: a.id, type: doc.type, position: i, uploaded: !!doc.uploaded,
        doc_status: doc.docStatus ?? 'pending', file_url: stripBase64(doc.fileUrl ?? null), reject_reason: doc.rejectReason ?? null,
      });
    });
    for (const [status, p] of Object.entries(a.statusPhotos ?? {})) {
      f.photos.set(key2(a.id, status), {
        assignment_id: a.id, status, url: stripBase64(p.url), taken_at: p.timestamp ?? '', location: p.location ?? '',
        lat: p.coords?.lat ?? null, lng: p.coords?.lng ?? null,
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
      status_update: n.statusUpdate ?? null, photo_url: stripBase64(n.photoUrl ?? null), reason: n.reason ?? null,
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

/* Save the admin screens' state. Calls are queued so two saves never overlap. */
export function syncAdminData(data: AdminData): Promise<void> {
  const run = async () => {
    if (!snapshot) return;                       // nothing loaded yet — never write from an empty state
    const prev = snapshot;
    const next = flatten(data);

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
  id: r.id, name: r.name ?? '', email: r.email, password: '',    // passwords are hashed by Auth; unreadable by design
  role: r.role, status: r.status, invitedAt: r.invited_at, ...(r.last_active ? { lastActive: r.last_active } : {}),
});

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await supabase.from('profiles').select('*').eq('is_om', false).in('role', ['csr', 'viewer']).order('invited_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map(memberFromRow);
}

export async function createTeamMember(input: { name: string; email: string; password: string; role: 'csr' | 'viewer' }): Promise<TeamMember> {
  const { data, error } = await supabase.rpc('create_team_member', {
    p_name: input.name, p_email: input.email, p_password: input.password, p_role: input.role,
  });
  if (error) {
    if (error.message.includes('email_exists')) throw new Error('A member with that email already exists');
    if (error.message.includes('not_authorized')) throw new Error('Only the Operation Manager can add team members.');
    throw new Error(error.message);
  }
  return { ...memberFromRow({ ...(data as Row), invited_at: (data as Row).invitedAt }), password: input.password };
}

export async function removeTeamMember(id: string): Promise<void> {
  const { error } = await supabase.rpc('remove_team_member', { p_id: id });
  if (error) throw new Error(error.message);
}

/* ════════════════════════════════════════════════════════════════════════════
   DRIVER
   ════════════════════════════════════════════════════════════════════════════ */

export interface DriverViewData {
  driver: { id: string; name: string; phone: string; status: string; currentLocation: string };
  assignment: Assignment | null;
  completedHistory: Array<{ id: string; destination: string; company: string; deliveryDate: string; completedAt: string; truckPlate: string; taskStatus: string }>;
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
    const [docs, photos, delays] = await Promise.all([
      supabase.from('assignment_documents').select('*').eq('assignment_id', chosen.id),
      supabase.from('status_photos').select('*').eq('assignment_id', chosen.id),
      supabase.from('delay_reports').select('*').eq('assignment_id', chosen.id),
    ]);
    for (const r of [docs, photos, delays]) if (r.error) throw r.error;
    assignment = assignmentFromRow(chosen, docs.data ?? [], photos.data ?? [], delays.data ?? []);
  }

  const completedHistory = rows.filter((r) => r.state === 'completed')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    .map((r) => ({
      id: r.id, destination: r.destination, company: r.company, deliveryDate: r.delivery_date,
      completedAt: r.completed_at ?? '', truckPlate: r.truck_plate, taskStatus: r.task_status,
    }));

  return {
    driver: { id: drv.data.id, name: drv.data.name, phone: drv.data.phone, status: drv.data.status, currentLocation: drv.data.current_location ?? '—' },
    assignment, completedHistory,
  };
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
        assignment_id: assignmentId, status, url: p.url, taken_at: p.timestamp ?? '', location: p.location ?? '',
        lat: p.coords?.lat ?? null, lng: p.coords?.lng ?? null,
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
      if (!d.fileUrl || isInlineImage(d.fileUrl) || have.get(d.type) === d.fileUrl) continue;
      const res = have.has(d.type)
        ? await supabase.from('assignment_documents').update({ file_url: d.fileUrl, uploaded: true }).eq('assignment_id', assignmentId).eq('type', d.type)
        : await supabase.from('assignment_documents').insert({
            assignment_id: assignmentId, type: d.type, uploaded: true, doc_status: 'pending', file_url: d.fileUrl,
            position: Math.max(0, (DOCUMENT_TYPES as readonly string[]).indexOf(d.type)),
          });
      if (res.error) throw new Error(`documents: ${res.error.message}`);
    }
  }

  if (notif) {
    /* no .select() here on purpose: drivers may insert notifications but not read the feed back */
    const { error } = await supabase.from('notifications').insert({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      read: false, time_label: timeLabel(), driver_name: driverName,
      type: notif.type, message: notif.message ?? '', assignment_id: assignmentId,
      truck_plate: notif.truckPlate ?? '', doc_type: notif.docType ?? null, status_update: notif.statusUpdate ?? null,
      photo_url: notif.photoUrl ?? null, reason: notif.reason ?? null, navigate_to: notif.navigateTo ?? null,
    });
    if (error) throw new Error(`notification: ${error.message}`);
  }
}

/* Upload a photo/document (a base64 data URL from the camera) and return a long-lived signed URL. */
export async function uploadImage(dataUrl: string, path: string): Promise<string> {
  const [head, b64 = ''] = dataUrl.split(',');
  const contentType = head.startsWith('data:') ? head.slice(5).split(';')[0] || 'image/jpeg' : 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 315360000);   // ~10 years
  if (error || !data) throw new Error(`sign: ${error?.message ?? 'no url'}`);
  return data.signedUrl;
}
