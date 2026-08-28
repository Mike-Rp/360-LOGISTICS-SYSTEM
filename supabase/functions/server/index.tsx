import { Hono } from "npm:hono@4";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv_store.tsx";

const app = new Hono();
app.use('*', logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization", "X-Admin-Token"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

/* ── Supabase client (service role — for Storage) ────── */
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const BUCKET_NAME = 'make-ee4d169c-media';

/* Idempotently create media bucket on startup */
(async () => {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === BUCKET_NAME);
    if (!exists) {
      await supabase.storage.createBucket(BUCKET_NAME);
      console.log(`[init] Created bucket: ${BUCKET_NAME}`);
    }
  } catch (e) {
    console.log('[init] Bucket init error:', e);
  }
})();

/* ── Admin accounts (must match LoginScreen.tsx) ────── */
const ADMIN_ACCOUNTS = [
  { email: '360logistics@email.ph',            role: 'admin'  },
  { email: 'operationmanager@360logistics.ph', role: 'viewer' },
  { email: 'adminabuse@360logistics.ph',       role: 'admin'  },
];

/* Operation Manager — the one hardcoded 'viewer' account, distinct from any
   Viewer-role team member invited later (both share role: 'viewer'). */
const OM_EMAIL = ADMIN_ACCOUNTS.find((a) => a.role === 'viewer')!.email;

/* ── Initial seed data ───────────────────────────────── */
const INITIAL_DRIVERS: unknown[] = [];
const INITIAL_TRUCKS:  unknown[] = [];

/* ── Token: btoa(email:role:timestamp) — read from X-Admin-Token header ───
   Checks the 3 static accounts first, then falls back to the dynamic
   team-members list (KV-backed). For a team member, the CURRENT role in KV
   wins over whatever role was baked into the token at login time — this
   makes role changes and removals take effect on the member's next request
   instead of waiting out the 30-day token expiry. ─────────────────────── */
async function getAuthUser(request: Request): Promise<{ email: string; role: string } | null> {
  try {
    const token = request.headers.get('X-Admin-Token');
    if (!token) return null;
    const decoded = atob(token);
    const parts   = decoded.split(':');
    if (parts.length < 3) return null;
    const email = parts[0];
    const role  = parts[1];
    const ts    = parseInt(parts[2]);
    if (isNaN(ts) || Date.now() - ts > 30 * 24 * 60 * 60 * 1000) return null;

    const staticAccount = ADMIN_ACCOUNTS.find((a) => a.email === email && a.role === role);
    if (staticAccount) return { email, role };

    const members = ((await kv.get(K.teamMembers)) ?? []) as any[];
    const member  = members.find((m) => m.email === email);
    if (member && member.status === 'active') return { email, role: member.role };

    return null;
  } catch {
    return null;
  }
}

/* ── KV keys ─────────────────────────────────────────── */
const K = {
  drivers:       'app_drivers_v1',
  trucks:        'app_trucks_v1',
  assignments:   'app_assignments_v1',
  completed:     'app_completed_v1',
  cancelled:     'app_cancelled_v1',
  notifications: 'app_notifications_v1',
  activityLog:   'app_activity_log_v1',
  teamMembers:   'app_team_members_v1',
};

/* ── Strip base64 data-URLs from any object (keeps storage URLs, drops raw image bytes) ── */
function stripBase64<T>(obj: T): T {
  if (typeof obj === 'string') {
    return (obj.startsWith('data:') ? '[image-data-stripped]' : obj) as unknown as T;
  }
  if (Array.isArray(obj)) return obj.map(stripBase64) as unknown as T;
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, stripBase64(v)])
    ) as unknown as T;
  }
  return obj;
}

/* ── Health check ────────────────────────────────────── */
app.get("/make-server-ee4d169c/health", (c) => c.json({ status: "ok", ts: Date.now() }));

/* ── POST /upload-image — store image in Supabase Storage, return signed URL ── */
app.post("/make-server-ee4d169c/upload-image", async (c) => {
  let body: { data?: string; path?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_request" }, 400); }

  const { data: b64, path } = body;
  if (!b64 || !path) return c.json({ error: "data and path are required" }, 400);

  try {
    const base64Data  = b64.includes(',') ? b64.split(',')[1] : b64;
    const contentType = b64.startsWith('data:') ? b64.split(';')[0].split(':')[1] : 'image/jpeg';
    const binaryStr   = atob(base64Data);
    const bytes       = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(path, bytes, { contentType, upsert: true });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    /* Signed URL — 10-year expiry (max Supabase allows) */
    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(path, 315360000);
    if (signErr) throw new Error(`Sign failed: ${signErr.message}`);

    console.log(`[POST /upload-image] stored: ${path}`);
    return c.json({ url: signed!.signedUrl });
  } catch (err) {
    console.log('[POST /upload-image] error:', err);
    return c.json({ error: `Upload failed: ${err}` }, 500);
  }
});

/* ── POST /driver-login (no auth required) ───────────── */
/* Normalise a PH mobile number to 11-digit "09XXXXXXXXX" for comparison */
function normaliseMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) return '0' + digits.slice(2);
  return digits;
}

app.post("/make-server-ee4d169c/driver-login", async (c) => {
  let body: { mobile?: string; pin?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_request" }, 400); }

  const mobile = normaliseMobile((body.mobile ?? '').trim());
  const pin    = (body.pin ?? '').trim();

  if (!mobile) return c.json({ error: "driver_not_found", msg: "Please enter your mobile number." }, 400);
  if (pin.length !== 4) return c.json({ error: "wrong_pin", msg: "Please enter your 4-digit PIN." }, 400);

  const drivers = (await kv.get(K.drivers)) ?? INITIAL_DRIVERS;

  const driver = (drivers as any[]).find(
    (d) => normaliseMobile(d.phone ?? '') === mobile
  );
  if (!driver) {
    return c.json({ error: "driver_not_found", msg: "No driver account found with that mobile number. Contact your admin." }, 401);
  }

  if (driver.pin && driver.pin !== pin) {
    return c.json({ error: "wrong_pin", msg: "Incorrect PIN. Try again or contact your admin." }, 401);
  }

  console.log(`[driver-login] success: ${driver.name} / ${mobile}`);
  return c.json({ success: true, driverId: driver.id, driverName: driver.name });
});

/* ── Team members (CSR / Viewer accounts invited by the Operation Manager) ──
   Own KV key, own routes — deliberately NOT folded into GET/PUT /app-data:
   (1) the only existing write-gate is role === 'viewer', which can't express
   "only THIS ONE viewer (the OM) may write this", since invited Viewer
   members also have role 'viewer'; (2) these records carry a plaintext
   password and must never ride in a payload every logged-in session receives.
   All routes below except /member-login require the caller to BE the OM. ── */
async function requireOM(c: any): Promise<{ email: string; role: string } | null> {
  const user = await getAuthUser(c.req.raw);
  if (!user || user.email !== OM_EMAIL) return null;
  return user;
}

/* ── GET /team-members — OM only ─────────────────────── */
app.get("/make-server-ee4d169c/team-members", async (c) => {
  if (!(await requireOM(c))) return c.json({ error: "Unauthorized" }, 403);
  try {
    const members = (await kv.get(K.teamMembers)) ?? [];
    return c.json({ members });
  } catch (err) {
    console.log('[GET /team-members] error:', err);
    return c.json({ error: `${err}` }, 500);
  }
});

/* ── POST /team-members — OM invites a CSR or Viewer ─── */
app.post("/make-server-ee4d169c/team-members", async (c) => {
  const om = await requireOM(c);
  if (!om) return c.json({ error: "Unauthorized" }, 403);

  let body: { name?: string; email?: string; password?: string; role?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_request" }, 400); }

  const name  = (body.name ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = (body.password ?? '').trim();
  const role  = body.role;

  if (!name || !email || !password) return c.json({ error: "name, email, and password are required" }, 400);
  if (role !== 'csr' && role !== 'viewer') return c.json({ error: "role must be 'csr' or 'viewer'" }, 400);

  try {
    const isStaticEmail = ADMIN_ACCOUNTS.some((a) => a.email.toLowerCase() === email);
    const members = ((await kv.get(K.teamMembers)) ?? []) as any[];
    const isDupe  = members.some((m) => (m.email ?? '').toLowerCase() === email);
    if (isStaticEmail || isDupe) return c.json({ error: "A member with that email already exists" }, 409);

    const newMember = {
      id: `TM${String(Date.now()).slice(-6)}`,
      name, email, password, role,
      status: 'active' as const,
      invitedAt: new Date().toISOString(),
    };
    members.push(newMember);
    await kv.set(K.teamMembers, members);

    console.log(`[POST /team-members] ${om.email} invited ${email} as ${role}`);
    return c.json({ success: true, member: newMember });
  } catch (err) {
    console.log('[POST /team-members] error:', err);
    return c.json({ error: `${err}` }, 500);
  }
});

/* ── PATCH /team-members/:id — OM changes role/status ── */
app.patch("/make-server-ee4d169c/team-members/:id", async (c) => {
  if (!(await requireOM(c))) return c.json({ error: "Unauthorized" }, 403);

  const id = c.req.param('id');
  let body: { role?: string; status?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_request" }, 400); }

  if (body.role !== undefined && body.role !== 'csr' && body.role !== 'viewer') {
    return c.json({ error: "role must be 'csr' or 'viewer'" }, 400);
  }

  try {
    const members = ((await kv.get(K.teamMembers)) ?? []) as any[];
    const idx = members.findIndex((m) => m.id === id);
    if (idx === -1) return c.json({ error: "Member not found" }, 404);

    members[idx] = { ...members[idx], ...(body.role ? { role: body.role } : {}), ...(body.status ? { status: body.status } : {}) };
    await kv.set(K.teamMembers, members);

    return c.json({ success: true, member: members[idx] });
  } catch (err) {
    console.log('[PATCH /team-members/:id] error:', err);
    return c.json({ error: `${err}` }, 500);
  }
});

/* ── DELETE /team-members/:id — OM removes a member ──── */
app.delete("/make-server-ee4d169c/team-members/:id", async (c) => {
  if (!(await requireOM(c))) return c.json({ error: "Unauthorized" }, 403);

  const id = c.req.param('id');
  try {
    const members = ((await kv.get(K.teamMembers)) ?? []) as any[];
    const filtered = members.filter((m) => m.id !== id);
    await kv.set(K.teamMembers, filtered);
    return c.json({ success: true });
  } catch (err) {
    console.log('[DELETE /team-members/:id] error:', err);
    return c.json({ error: `${err}` }, 500);
  }
});

/* ── POST /member-login (no auth required) — CSR/Viewer team-member login ── */
app.post("/make-server-ee4d169c/member-login", async (c) => {
  let body: { email?: string; password?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_request" }, 400); }

  const email    = (body.email ?? '').trim().toLowerCase();
  const password = (body.password ?? '').trim();
  if (!email || !password) return c.json({ error: "invalid_credentials", msg: "Enter your email and password." }, 400);

  try {
    const members = ((await kv.get(K.teamMembers)) ?? []) as any[];
    const idx = members.findIndex((m) => (m.email ?? '').toLowerCase() === email);
    if (idx === -1 || members[idx].status !== 'active') {
      return c.json({ error: "invalid_credentials", msg: "Invalid email or password." }, 401);
    }
    if (members[idx].password !== password) {
      return c.json({ error: "invalid_credentials", msg: "Invalid email or password." }, 401);
    }

    members[idx] = { ...members[idx], lastActive: new Date().toISOString() };
    await kv.set(K.teamMembers, members);

    const token = btoa(`${members[idx].email}:${members[idx].role}:${Date.now()}`);
    console.log(`[member-login] success: ${members[idx].email} (${members[idx].role})`);
    return c.json({ success: true, token, role: members[idx].role, name: members[idx].name });
  } catch (err) {
    console.log('[POST /member-login] error:', err);
    return c.json({ error: `${err}` }, 500);
  }
});

/* ── GET /app-data ───────────────────────────────────── */
app.get("/make-server-ee4d169c/app-data", async (c) => {
  const user = await getAuthUser(c.req.raw);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const [drivers, trucks, assignments, completed, cancelled, notifications, activityLog] = await Promise.all([
      kv.get(K.drivers),
      kv.get(K.trucks),
      kv.get(K.assignments),
      kv.get(K.completed),
      kv.get(K.cancelled),
      kv.get(K.notifications),
      kv.get(K.activityLog),
    ]);

    return c.json({
      drivers:       drivers       ?? INITIAL_DRIVERS,
      trucks:        trucks        ?? INITIAL_TRUCKS,
      assignments:   assignments   ?? [],
      completed:     completed     ?? [],
      cancelled:     cancelled     ?? [],
      notifications: notifications ?? [],
      activityLog:   activityLog   ?? [],
      role:          user.role,
    });
  } catch (err) {
    console.log('[GET /app-data] error:', err);
    return c.json({ error: `Failed to load data: ${err}` }, 500);
  }
});

/* ── PUT /app-data ───────────────────────────────────── */
app.put("/make-server-ee4d169c/app-data", async (c) => {
  const user = await getAuthUser(c.req.raw);
  if (!user) {
    console.log('[PUT /app-data] Unauthorized — bad/missing token');
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (user.role === 'viewer') return c.json({ error: "Read-only access — cannot save data" }, 403);

  try {
    const body = await c.req.json();

    await kv.set(K.drivers,       stripBase64(body.drivers       ?? []));
    await kv.set(K.trucks,        stripBase64(body.trucks        ?? []));
    await kv.set(K.assignments,   stripBase64(body.assignments   ?? []));
    await kv.set(K.completed,     stripBase64(body.completed     ?? []));
    await kv.set(K.cancelled,     stripBase64(body.cancelled     ?? []));
    await kv.set(K.notifications, stripBase64(body.notifications ?? []));
    await kv.set(K.activityLog,   stripBase64(body.activityLog   ?? []));

    console.log(`[PUT /app-data] saved ok — user: ${user.email}`);
    return c.json({ success: true });
  } catch (err) {
    console.log('[PUT /app-data] error:', err);
    return c.json({ error: `Failed to save data: ${err}` }, 500);
  }
});

/* ── POST /reset-data — wipe all app data, keep admin accounts ── */
app.post("/make-server-ee4d169c/reset-data", async (c) => {
  const user = await getAuthUser(c.req.raw);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (user.role === 'viewer') return c.json({ error: "Read-only access" }, 403);

  try {
    await Promise.all([
      kv.set(K.drivers,       []),
      kv.set(K.trucks,        []),
      kv.set(K.assignments,   []),
      kv.set(K.completed,     []),
      kv.set(K.cancelled,     []),
      kv.set(K.notifications, []),
    ]);
    console.log(`[POST /reset-data] all data wiped by: ${user.email}`);
    return c.json({ success: true });
  } catch (err) {
    console.log('[POST /reset-data] error:', err);
    return c.json({ error: `Reset failed: ${err}` }, 500);
  }
});

/* ── GET /driver-data?driverId=xxx ─────────────────────
   Returns the driver's active/recent assignment + completed history.
   Cancelled assignments excluded. ─────────────────────── */
app.get("/make-server-ee4d169c/driver-data", async (c) => {
  const driverId = c.req.query('driverId');
  if (!driverId) return c.json({ error: "driverId required" }, 400);

  try {
    const [rawDrivers, rawTrucks, rawAssignments, rawCompleted] = await Promise.all([
      kv.get(K.drivers),
      kv.get(K.trucks),
      kv.get(K.assignments),
      kv.get(K.completed),
    ]);
    const allDrivers     = (rawDrivers     ?? INITIAL_DRIVERS) as any[];
    const allTrucks      = (rawTrucks      ?? INITIAL_TRUCKS)  as any[];
    const allAssignments = (rawAssignments ?? [])              as any[];
    const allCompleted   = (rawCompleted   ?? [])              as any[];

    const driver = allDrivers.find((d: any) => d.id === driverId);
    if (!driver) return c.json({ error: "Driver not found" }, 404);

    /* Active: in-progress first, then most-recent terminal (Delivered/Failed) for doc upload.
       Cancelled excluded entirely. */
    const active = allAssignments.find(
      (a: any) =>
        a.driverId === driverId &&
        a.taskStatus !== 'Delivered' &&
        a.taskStatus !== 'Failed / Issue' &&
        a.taskStatus !== 'Cancelled'
    );
    const terminal = allAssignments
      .filter((a: any) =>
        a.driverId === driverId &&
        (a.taskStatus === 'Delivered' || a.taskStatus === 'Failed / Issue')
      )
      .sort((a: any, b: any) => (b.assignedAt ?? '').localeCompare(a.assignedAt ?? ''))
      [0] ?? null;

    const assignment = active ?? terminal ?? null;

    /* Completed delivery history for this driver (most recent first) */
    const completedHistory = allCompleted
      .filter((c: any) => c.driverId === driverId)
      .sort((a: any, b: any) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      .map((c: any) => ({
        id:           c.id,
        destination:  c.destination,
        company:      c.company,
        deliveryDate: c.deliveryDate,
        completedAt:  c.completedAt,
        truckPlate:   c.truckPlate,
        taskStatus:   c.taskStatus,
      }));

    return c.json({ driver, assignment, trucks: allTrucks, completedHistory });
  } catch (err) {
    console.log('[GET /driver-data] error:', err);
    return c.json({ error: `${err}` }, 500);
  }
});

/* ── PUT /driver-update ─────────────────────────────────
   Smart document merge: preserves admin-set docStatus (approved/rejected)
   unless the driver is uploading a new file for that document. ─── */
app.put("/make-server-ee4d169c/driver-update", async (c) => {
  let body: { driverId?: string; assignmentId?: string; updates?: Record<string, any>; notif?: Record<string, any> };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_request" }, 400); }

  const { driverId, assignmentId, updates, notif } = body;
  if (!driverId || !assignmentId || !updates) return c.json({ error: "missing fields" }, 400);

  try {
    const rawDrivers = await kv.get(K.drivers);
    const allDrivers = (rawDrivers ?? INITIAL_DRIVERS) as any[];
    const driver = allDrivers.find((d: any) => d.id === driverId);
    if (!driver) return c.json({ error: "Driver not found" }, 401);

    const rawAssignments = await kv.get(K.assignments);
    const allAssignments = (rawAssignments ?? []) as any[];

    /* Strip base64 — storage URLs pass through unaffected */
    const safeUpdates = stripBase64(updates) as Record<string, any>;

    const updatedAssignments = allAssignments.map((a: any) => {
      if (a.id !== assignmentId) return a;

      /* Smart document merge: only update specific doc when driver uploads a new file.
         This preserves admin-approved/rejected status on OTHER documents. */
      if (safeUpdates.documents && Array.isArray(safeUpdates.documents) && Array.isArray(a.documents)) {
        const mergedDocs = a.documents.map((serverDoc: any) => {
          const driverDoc = (safeUpdates.documents as any[]).find((d: any) => d.type === serverDoc.type);
          if (!driverDoc) return serverDoc;

          const newFileUrl = driverDoc.fileUrl;
          const hasNewFile = newFileUrl &&
            newFileUrl !== '[image-data-stripped]' &&
            newFileUrl !== serverDoc.fileUrl;

          if (hasNewFile) {
            /* New file uploaded — reset this doc to pending for admin review */
            return { ...serverDoc, uploaded: true, fileUrl: newFileUrl, docStatus: 'pending' };
          }
          /* No new file — preserve server state (keep admin-approved/rejected) */
          return serverDoc;
        });
        return { ...a, ...safeUpdates, documents: mergedDocs };
      }

      return { ...a, ...safeUpdates };
    });

    await kv.set(K.assignments, updatedAssignments);

    if (notif) {
      const rawNotifs = await kv.get(K.notifications);
      const allNotifs = (rawNotifs ?? []) as any[];
      allNotifs.unshift({
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        read: false,
        timestamp: new Date().toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
        driverName: driver.name,
        ...notif,
      });
      await kv.set(K.notifications, allNotifs);
    }

    console.log(`[driver-update] ${driver.name} / ${assignmentId} → ${JSON.stringify(Object.keys(updates))}`);
    return c.json({ success: true });
  } catch (err) {
    console.log('[PUT /driver-update] error:', err);
    return c.json({ error: `${err}` }, 500);
  }
});

Deno.serve(app.fetch);