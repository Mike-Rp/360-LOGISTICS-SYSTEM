# HANDOFF.md — 360 Logistics

Complete technical handoff for the 360 Logistics trucking operations and delivery tracking app. Everything a new engineer needs to run, modify, or redeploy this project from scratch.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Environment Variables & Secrets](#2-environment-variables--secrets)
3. [Supabase Tables, Columns & SQL](#3-supabase-tables-columns--sql)
4. [Edge Functions — Deployed Names & Routes](#4-edge-functions--deployed-names--routes)
5. [KV Store — Keys & Data Shapes](#5-kv-store--keys--data-shapes)
6. [Storage Buckets](#6-storage-buckets)
7. [LocalStorage Keys](#7-localstorage-keys)
8. [External Services & Third-Party APIs](#8-external-services--third-party-apis)
9. [Admin Accounts & Auth Scheme](#9-admin-accounts--auth-scheme)
10. [Frontend Architecture](#10-frontend-architecture)

---

## 1. Project Overview

| Field | Value |
|---|---|
| **Stack** | React 18 + TypeScript + Tailwind CSS v4 + Vite |
| **Backend** | Supabase Edge Functions (Deno runtime) + Hono web framework |
| **Database** | Supabase Postgres — single KV table, accessed via service role |
| **Storage** | Supabase Storage — private bucket for photos and PDFs |
| **Supabase project ID** | `veuehobbfkwppsirapdp` |
| **Supabase dashboard** | https://supabase.com/dashboard/project/veuehobbfkwppsirapdp |

---

## 2. Environment Variables & Secrets

### Frontend (Vite / browser)

There are **no `.env` files** in this project. The frontend credentials are hardcoded in an auto-generated file:

**File:** `utils/supabase/info.tsx` — **do not edit manually**

```ts
export const projectId  = "veuehobbfkwppsirapdp"
export const publicAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

| Variable | Value | Notes |
|---|---|---|
| `projectId` | `veuehobbfkwppsirapdp` | Supabase project reference ID |
| `publicAnonKey` | JWT (see file) | Supabase anon key — safe to expose in browser; expires 2088 |

These are consumed in:
- `src/app/lib/supabaseClient.ts` — builds the `SERVER` base URL and the Supabase client
- `src/app/App.tsx` — used directly in `Authorization: Bearer` headers

### Backend (Supabase Edge Function — Deno runtime)

These are **automatically injected by Supabase** into every edge function at runtime. You do not set them manually.

| Variable | Injected by | Used in | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | Supabase runtime | `index.tsx`, `kv_store.tsx` | Supabase project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase runtime | `index.tsx`, `kv_store.tsx` | Full-access key for Storage + DB; **never expose to browser** |

> **Security note:** `SUPABASE_SERVICE_ROLE_KEY` is only ever used inside the edge function. It is never sent to the frontend.

### Secrets stored in Figma Make settings

The following secrets are registered in the Figma Make project settings (not in any file):

| Secret name | What it is |
|---|---|
| `SUPABASE_URL` | Same as above — also registered as a Make secret for edge function access |
| `SUPABASE_ANON_KEY` | Same as `publicAnonKey` above |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — registered for edge function use |
| `SUPABASE_DB_URL` | Direct Postgres connection string |
| `SUPABASE_PUBLISHABLE_KEYS` | Supabase publishable key bundle |
| `SUPABASE_SECRET_KEYS` | Supabase secret key bundle |
| `SUPABASE_JWKS` | JSON Web Key Set for JWT verification |

---

## 3. Supabase Tables, Columns & SQL

### Table: `kv_store_ee4d169c`

This is the **only database table** in the project. It is a general-purpose key-value store. All application data (drivers, trucks, assignments, notifications, etc.) is stored as JSONB values under string keys.

**DDL to recreate:**

```sql
CREATE TABLE kv_store_ee4d169c (
  key   TEXT  NOT NULL PRIMARY KEY,
  value JSONB NOT NULL
);
```

**Columns:**

| Column | Type | Constraints | Description |
|---|---|---|---|
| `key` | `TEXT` | `PRIMARY KEY`, `NOT NULL` | Unique string key (see KV Store section for all keys) |
| `value` | `JSONB` | `NOT NULL` | JSON payload — always an array of objects for app data |

**RLS policies:**

This table has **no RLS policies**. It is accessed exclusively via the Supabase service role key from inside the edge function — the service role bypasses RLS entirely. The anon key (used by the browser) has no direct table access.

> To add RLS if desired: `ALTER TABLE kv_store_ee4d169c ENABLE ROW LEVEL SECURITY;` — then all access goes through the edge function only, which is already the case.

**Dashboard link:** https://supabase.com/dashboard/project/veuehobbfkwppsirapdp/database/tables

---

## 4. Edge Functions — Deployed Names & Routes

### Deployed function name

| Directory | Deployed slug | Full base URL |
|---|---|---|
| `supabase/functions/server/` | `server` | `https://veuehobbfkwppsirapdp.supabase.co/functions/v1/make-server-ee4d169c` |

> Note: The Supabase function is named `server` (the directory name), but the Hono router is mounted under the prefix `/make-server-ee4d169c`. All routes below are relative to `https://veuehobbfkwppsirapdp.supabase.co/functions/v1`.

The frontend constructs this URL in `src/app/lib/supabaseClient.ts`:
```ts
export const SERVER = `https://${projectId}.supabase.co/functions/v1/make-server-ee4d169c`;
```

### Route table

All requests require the header `Authorization: Bearer <publicAnonKey>` for Supabase function invocation. Additional per-route auth is described below.

| Method | Path | Route auth | Description |
|---|---|---|---|
| `GET` | `/make-server-ee4d169c/health` | None | Health check — returns `{ status: "ok", ts: <epoch_ms> }` |
| `POST` | `/make-server-ee4d169c/upload-image` | None | Upload a base64-encoded image to Supabase Storage; returns a 10-year signed URL |
| `POST` | `/make-server-ee4d169c/driver-login` | None | Authenticate a driver by mobile number + 4-digit PIN; returns `{ driverId, driverName }` |
| `GET` | `/make-server-ee4d169c/app-data` | `X-Admin-Token` header | Return all KV data (drivers, trucks, assignments, completed, cancelled, notifications, activityLog) + `role` |
| `PUT` | `/make-server-ee4d169c/app-data` | `X-Admin-Token` header | Write all 7 KV keys; blocked for `viewer` role (403) |
| `POST` | `/make-server-ee4d169c/reset-data` | `X-Admin-Token` header | Wipe 6 KV keys to `[]` (keeps `activityLog`); blocked for `viewer` role (403) |
| `GET` | `/make-server-ee4d169c/driver-data?driverId=<id>` | None | Return a single driver's info, active assignment, and completed history |
| `PUT` | `/make-server-ee4d169c/driver-update` | None | Smart-merge driver-submitted document updates into an assignment; append a notification |

### Route details

#### `POST /upload-image`

```
Body: { data: string (base64 data-URL or raw base64), path: string }
Response: { url: string (signed URL, 315360000s / ~10yr expiry) }
```

Uploads to bucket `make-ee4d169c-media`. The bucket is created idempotently on cold start if it doesn't exist. Path format used by the app: `photos/<assignmentId>/<status>_<timestamp>.jpg` and `docs/<assignmentId>/<docType>_<timestamp>.jpg`.

#### `POST /driver-login`

```
Body: { mobile: string, pin: string (4 digits) }
Response (success): { success: true, driverId: string, driverName: string }
Response (error):   { error: "driver_not_found" | "wrong_pin", msg: string }
```

Mobile number normalisation (server-side): strips non-digits; if starts with `63` and is 12 digits, converts to `09XXXXXXXXX`. Frontend sends `+63XXXXXXXXXX`.

#### `GET /app-data`

```
Headers: X-Admin-Token: <btoa(email:role:timestamp)>
Response: { drivers, trucks, assignments, completed, cancelled, notifications, activityLog, role }
```

#### `PUT /driver-update`

```
Body: { driverId, assignmentId, updates: Partial<Assignment>, notif?: NotifPayload }
```

Smart document merge: if `updates.documents` is present, only marks a document as `pending` and overwrites `fileUrl` if a genuinely new file URL is provided. Admin-set `approved`/`rejected` statuses on other documents are preserved.

### CORS

All routes allow `origin: "*"` with headers `Content-Type`, `Authorization`, `X-Admin-Token`.

---

## 5. KV Store — Keys & Data Shapes

All data is stored in `kv_store_ee4d169c`. Keys are defined in `supabase/functions/server/index.tsx`:

```ts
const K = {
  drivers:       'app_drivers_v1',
  trucks:        'app_trucks_v1',
  assignments:   'app_assignments_v1',
  completed:     'app_completed_v1',
  cancelled:     'app_cancelled_v1',
  notifications: 'app_notifications_v1',
  activityLog:   'app_activity_log_v1',
};
```

### Key: `app_drivers_v1` — `LocalDriver[]`

```ts
{
  id:       string;    // e.g. "DRV-001"
  name:     string;
  phone:    string;    // stored as "+63XXXXXXXXXX" (E.164)
  pin:      string;    // 4-digit string
  status:   string;    // "Active" | "Inactive"
  truckId?: string;    // references a truck id
}
```

### Key: `app_trucks_v1` — `LocalTruck[]`

```ts
{
  id:       string;    // e.g. "TRK-001"
  plate:    string;    // e.g. "TRK-8847"
  model:    string;
  status:   string;    // "Available" | "In Use" | "Maintenance"
  driverId?: string;
}
```

### Key: `app_assignments_v1` — `Assignment[]`

```ts
{
  id:             string;    // e.g. "DEL-2026-0042"
  driverId:       string;
  truckPlate:     string;
  destination:    string;    // cargo description
  company:        string;
  pickupLocation: string;
  pickupTime:     string;    // e.g. "09:00 AM"
  pickedUpDate:   string;
  eta:            string;    // estimated time of arrival
  ata:            string;    // actual/target delivery time
  deliveryDate:   string;    // YYYY-MM-DD
  remarks?:       string;
  taskStatus:     TaskStatus;
  issueReason?:   string;
  assignedAt?:    string;    // ISO timestamp
  documents:      AssignmentDoc[];
  statusPhotos?:  Record<TaskStatus, StatusPhoto>;
  delayReports?:  DelayReport[];
}

// TaskStatus
type TaskStatus = 'Assigned' | 'Picked Up' | 'In Transit' | 'Delivered' | 'Failed / Issue' | 'Cancelled';

// AssignmentDoc
{
  type:         string;    // e.g. "Proof of Delivery"
  uploaded:     boolean;
  docStatus:    'pending' | 'approved' | 'rejected';
  rejectReason?: string;
  fileUrl?:     string;   // signed Supabase Storage URL (or base64 stripped to '[image-data-stripped]')
}

// StatusPhoto
{
  url:       string;   // Supabase Storage signed URL
  timestamp: string;   // human-readable, e.g. "Aug 23, 2026, 10:30 AM"
  location:  string;   // reverse-geocoded address or coords
  coords?:   { lat: number; lng: number };
}

// DelayReport
{
  type:       'pickup' | 'delivery';
  reason:     string;
  reportedAt: string;   // human-readable
}
```

### Key: `app_completed_v1` — Completed delivery snapshots

Same shape as `Assignment` with additional `completedAt: string` field. Moved here from `assignments` when an assignment is archived.

### Key: `app_cancelled_v1` — Cancelled delivery snapshots

Same shape as `Assignment`. Assignments with `taskStatus: 'Cancelled'` are moved here.

### Key: `app_notifications_v1` — `AppNotification[]`

```ts
{
  id:          string;    // e.g. "notif-<timestamp>-<random>"
  read:        boolean;
  timestamp:   string;    // human-readable
  driverName:  string;
  type:        'doc_upload' | 'status_update' | 'delay_report' | 'issue_report';
  message:     string;
  truckPlate:  string;
  assignmentId?: string;
  navigateTo?: string;    // admin page to navigate to on click
  photoUrl?:   string;
  statusUpdate?: string;
  docType?:    string;
  reason?:     string;
}
```

### Key: `app_activity_log_v1` — Activity log entries

Append-only log of admin actions. **Not wiped by `/reset-data`.** Shape varies but generally:

```ts
{
  timestamp: string;
  action:    string;
  user:      string;
  details:   string;
}
```

### KV utility functions available (`kv_store.tsx`)

| Function | Signature | Notes |
|---|---|---|
| `kv.get(key)` | `(key: string) => Promise<any>` | Returns `null` if key not found |
| `kv.set(key, value)` | `(key: string, value: any) => Promise<void>` | Upsert |
| `kv.del(key)` | `(key: string) => Promise<void>` | Delete one key |
| `kv.mget(keys)` | `(keys: string[]) => Promise<any[]>` | Batch get |
| `kv.mset(keys, values)` | `(keys: string[], values: any[]) => Promise<void>` | Batch upsert |
| `kv.mdel(keys)` | `(keys: string[]) => Promise<void>` | Batch delete |
| `kv.getByPrefix(prefix)` | `(prefix: string) => Promise<any[]>` | LIKE `prefix%` scan |

---

## 6. Storage Buckets

| Bucket name | Visibility | Created by | Used for |
|---|---|---|---|
| `make-ee4d169c-media` | **Private** | Edge function on cold start (idempotent) | Status photos taken by drivers; document photos and PDFs uploaded by drivers |

Files are accessed exclusively via **signed URLs** with a 10-year expiry (`315360000` seconds), generated by the edge function at upload time and stored inside the `Assignment.documents[].fileUrl` or `Assignment.statusPhotos[status].url` fields in KV.

Path conventions:
- Status photos: `photos/<assignmentId>/<status>_<timestamp>.jpg`
- Document uploads: `docs/<assignmentId>/<docType>_<timestamp>.jpg`

---

## 7. LocalStorage Keys

All browser-side persistence uses `localStorage`. No cookies, no IndexedDB.

| Key | Type | Set in | Read in | Value |
|---|---|---|---|---|
| `360_admin_token` | `string` | `LoginScreen.tsx`, `App.tsx` | `App.tsx` | `btoa(email + ':' + role + ':' + timestamp)` — 30-day expiry enforced server-side |
| `360_admin_role` | `string` | `LoginScreen.tsx`, `App.tsx` | `App.tsx` | `'admin'` \| `'demo'` \| `'viewer'` |
| `360_driver_id` | `string` | `App.tsx` | `App.tsx` | Driver's `id` field (e.g. `"DRV-001"`) — persists session across page reloads |
| `360_driver_name` | `string` | `App.tsx` | `App.tsx` | Driver's display name — shown in DriverInterface header |
| `360_notif_enabled` | `string` | `SettingsPanel.tsx` | `AdminDashboard.tsx` | `'true'` or `'false'` — toggles admin notification badge |
| `360_display_name` | `string` | `SettingsPanel.tsx` | `SettingsPanel.tsx` | Admin display name override; default `'Admin User'` |
| `360_avatar` | `string` | `SettingsPanel.tsx` | `SettingsPanel.tsx` | Admin avatar URL (data-URL or remote URL) |

---

## 8. External Services & Third-Party APIs

### Supabase

| Service | Used for | Auth method |
|---|---|---|
| Supabase Postgres | KV store table `kv_store_ee4d169c` | Service role key (edge function only) |
| Supabase Edge Functions | Hono API server | Anon key in `Authorization` header |
| Supabase Storage | Photo and document uploads | Service role key (edge function only); signed URLs returned to browser |

**No Supabase Auth** is used. Driver and admin authentication is custom-implemented (PIN-based for drivers, hardcoded credentials for admins).

### OpenStreetMap Nominatim (reverse geocoding)

**URL:** `https://nominatim.openstreetmap.org/reverse`

| Field | Value |
|---|---|
| **API key required** | No — public endpoint |
| **Rate limits** | 1 request/second per IP (Nominatim usage policy) |
| **Called from** | `src/app/components/driver/DriverInterface.tsx` — `PhotoSheet` component |
| **Purpose** | Convert GPS coordinates to a human-readable address when a driver takes a status photo |
| **Fallback** | If the request fails or geolocation is unavailable, falls back to raw coordinates or "Location unavailable" |

```ts
fetch(
  `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`,
  { headers: { 'Accept-Language': 'en' } }
)
```

**No other external services, webhooks, or third-party APIs are used.**

---

## 9. Admin Accounts & Auth Scheme

Admin credentials are **hardcoded** in two places that must stay in sync:

1. `src/app/components/auth/LoginScreen.tsx` — `ADMIN_ACCOUNTS` array (for client-side validation)
2. `supabase/functions/server/index.tsx` — `ADMIN_ACCOUNTS` array (for server-side token verification)

| Email | Password | Role | Permissions |
|---|---|---|---|
| `360logistics@email.ph` | `360Admin2026!` | `admin` | Full read + write |
| `admin360logistics@gmail.ph` | `360Demo2026!` | `demo` | Full read + write |
| `admin360logistics@email.com` | `360View2026!` | `viewer` | Read-only; PUT/POST routes return 403 |

### Token scheme

Tokens are generated client-side:
```ts
const token = btoa(`${email}:${role}:${Date.now()}`);
```

Tokens are:
- Stored in `localStorage` as `360_admin_token` and `360_admin_role`
- Sent to the edge function as the `X-Admin-Token` request header
- Validated server-side: decoded, email+role checked against `ADMIN_ACCOUNTS`, timestamp checked for 30-day expiry

> **To rotate credentials:** Update `ADMIN_ACCOUNTS` in both files and redeploy the edge function. Existing tokens will be invalidated automatically because the email/role won't match.

### Driver auth

Drivers log in with:
- Philippine mobile number (`+63` prefix + 10 digits starting with `9`)
- 4-digit PIN stored plaintext in KV under `app_drivers_v1`

> **To reset a driver PIN:** Update their record in the admin Accounts Management panel and save.

---

## 10. Frontend Architecture

### Key files

| File | Purpose |
|---|---|
| `src/app/App.tsx` | Root — session state, routing between login / admin / driver |
| `src/app/components/auth/LoginScreen.tsx` | Shared login screen (driver + admin tabs) |
| `src/app/components/driver/DriverInterface.tsx` | Driver-facing UI — dashboard + task screens |
| `src/app/components/admin/AdminDashboard.tsx` | Admin shell — sidebar nav, panel state |
| `src/app/components/admin/Header.tsx` | Admin top bar — notifications bell, account menu |
| `src/app/components/admin/SettingsPanel.tsx` | Admin settings drawer — profile, notifications toggle, activity log |
| `src/app/components/admin/HelpPanel.tsx` | Admin help drawer — guide list + detail view |
| `src/app/components/admin/RegisterModals.tsx` | Add/edit driver and truck modals |
| `src/app/data/assignmentTypes.ts` | Shared TypeScript types and `taskStatusConfig` |
| `src/app/lib/supabaseClient.ts` | Supabase client singleton + `SERVER` constant |
| `supabase/functions/server/index.tsx` | Edge function — all API routes |
| `supabase/functions/server/kv_store.tsx` | KV abstraction over `kv_store_ee4d169c` table — **do not edit** |
| `utils/supabase/info.tsx` | Project ID + anon key — **auto-generated, do not edit** |

### Session flow

```
App load
  → check localStorage for 360_admin_token / 360_driver_id
  → if admin token valid (30d) → AdminDashboard
  → if driver id present → DriverInterface (re-fetches from server)
  → else → LoginScreen

LoginScreen (driver tab)
  → POST /driver-login → { driverId, driverName }
  → store in localStorage → navigate to DriverInterface

LoginScreen (admin tab)
  → client-side credential check
  → generate btoa token → store in localStorage → navigate to AdminDashboard

AdminDashboard
  → GET /app-data (every 5s polling)
  → PUT /app-data on any data mutation

DriverInterface
  → GET /driver-data?driverId= (every 5s polling)
  → PUT /driver-update on status/document changes
```

### Required documents (6, hardcoded in DriverInterface.tsx)

```
Proof of Delivery
Receiving Acknowledgement Report
Dispatch Slip
Sales Invoice
Bill of Lading
Waybill / Delivery Receipt
```

These are defined in `REQUIRED_DOCS` in `DriverInterface.tsx` and merged with server-side `Assignment.documents` via `useMemo`.

### Task status flow (linear)

```
Assigned → Picked Up → In Transit → Delivered → (Upload Documents) → Complete
```

`Picked Up` and `In Transit` transitions require a photo. `Delivered` requires a confirmation sheet. `Upload Documents` unlocks after `Delivered`. `Complete` is determined when all 6 documents are admin-approved.

`Failed / Issue` and `Cancelled` are terminal states reachable at any point via admin action (`Cancelled`) or driver report (`Failed / Issue`).
