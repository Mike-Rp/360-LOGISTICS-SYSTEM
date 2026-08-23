# 360 Logistics — Project Context

Trucking operations and delivery tracking app. Read this before making changes.

## What it does

Two user types, one codebase:

- **Admin** (desktop web) — assigns deliveries to drivers, reviews uploaded documents,
  manages drivers and trucks, monitors delivery status.
- **Driver** (mobile web) — sees their active assignment, advances it through a status
  flow with photo proof, uploads six required delivery documents.

## Stack

- React 18 + TypeScript + Tailwind CSS v4 + Vite
- Backend: Supabase Edge Function (Deno runtime, Hono framework)
- Database: Supabase Postgres — **a single key-value table**, not a relational schema
- Storage: Supabase Storage, private bucket, signed URLs
- **No Supabase Auth** — authentication is custom and currently insecure (see below)

## Running locally

```bash
pnpm install
pnpm dev
```

Edge function deploys separately via the Supabase CLI:
```bash
supabase functions deploy server
```

> Verify these commands against `package.json` — update this section once confirmed.

## Architecture — read this first

`src/app/App.tsx` is the root and holds **all** application state:
`drivers`, `trucks`, `assignments`, `completed`, `cancelled`, `notifications`, `activityLog`.

A single `view` variable (`'login' | 'admin' | 'driver'`) decides which of three screens
renders. State flows down as props; there is no router, no context, no state library.

```
App.tsx  (all state lives here)
  ├── LoginScreen.tsx      — admin tab + driver tab
  ├── AdminDashboard.tsx   — sidebar shell; Monitor / Deliveries / Documents / Reports / Accounts
  └── DriverInterface.tsx  — the entire driver experience
```

If you're looking for where something happens, start in `App.tsx` and follow the prop down.

## Data model

Everything is stored in **one table**, `kv_store_ee4d169c`, as seven JSON blobs:

| Key | Contains |
|---|---|
| `app_drivers_v1` | Driver records (id, name, phone, 4-digit PIN, status, truckId) |
| `app_trucks_v1` | Truck records (id, plate, model, status, driverId) |
| `app_assignments_v1` | Active deliveries |
| `app_completed_v1` | Archived completed deliveries |
| `app_cancelled_v1` | Archived cancelled deliveries |
| `app_notifications_v1` | Admin notification feed |
| `app_activity_log_v1` | Admin audit log (never wiped by reset) |

Consequences to keep in mind: no joins, no foreign keys, no DB-level constraints. Every
read pulls a whole JSON array and filters in JavaScript. Any "query" is an array method.

## Backend

One edge function, directory `supabase/functions/server/`, deployed as `server`, but the
Hono router is mounted under the prefix `/make-server-ee4d169c`.

Both clients poll every 5 seconds. Admin does `GET /app-data` and writes the whole state
back with `PUT /app-data`. Drivers use `GET /driver-data` and `PUT /driver-update`.

Note `PUT /app-data` writes **all seven keys at once** — mutations are whole-state writes,
not targeted updates.

## Rules and gotchas

- **Do not edit** `supabase/functions/server/kv_store.tsx` or `utils/supabase/info.tsx` —
  both are auto-generated.
- Admin credentials are hardcoded in **two** files that must stay in sync:
  `src/app/components/auth/LoginScreen.tsx` and `supabase/functions/server/index.tsx`.
  Changing one without the other silently breaks login.
- `HANDOFF.md` is a useful reference but **not authoritative** — it has been wrong before
  (it claims the anon key has no direct table access; that is false when RLS is disabled).
  Verify claims against the code.
- The six required document types are hardcoded in `DriverInterface.tsx` as `REQUIRED_DOCS`.
- Driver phone numbers are Philippine format, normalised server-side to `09XXXXXXXXX`.

## Security status — known broken, do not treat as production-ready

1. **Admin tokens are forgeable.** The token is `btoa(email:role:timestamp)` — unsigned,
   unencrypted, validated against a list of emails visible in the client bundle. Anyone
   who knows an admin email can construct a valid admin token.
2. **Admin login is client-side**, so admin passwords are compiled into the JavaScript
   bundle and served to every visitor.
3. **RLS is disabled** on `kv_store_ee4d169c` (verify in the Supabase dashboard — an
   "Unrestricted" badge means exposed). With the anon key hardcoded in the frontend, the
   entire table may be readable and writable directly, bypassing the edge function.
4. **Three endpoints have no auth**: `POST /upload-image`, `GET /driver-data`,
   `PUT /driver-update`. The last one accepts writes. CORS is `origin: *`.
5. **Driver PINs are stored in plaintext** in the KV store.

Fixing this properly means moving to Supabase Auth and enabling RLS. Until then, assume
all data is public.

## Known incomplete features

- **Password change** (`SettingsPanel.tsx`) — UI only. Shows a success toast, does nothing.
- **Dashboard line chart** (`Charts.tsx`) — reads static numbers from `mockData.ts`, not
  real deliveries. **Reports bar chart** — hardcoded placeholder array.
- **Offline fallback** (`DriverInterface.tsx`) — on network error, shows a fake assignment
  (`DRIVER-PREVIEW`) instead of an error state. Operationally dangerous; fix early.
- **Activity log** — only ~7 of ~15 admin actions call `onLogActivity`. Adding/editing
  drivers and trucks, PIN resets, and Documents-page approvals are not logged.
- **"Open in Maps"** (`TaskDetails.tsx`) — button with no handler.
- **`currentLocation`** — initialised to `'—'` and never written. Note that drivers already
  capture GPS for status photos, so the plumbing to populate this mostly exists.
- **Dead code**: `driver/TaskDetails.tsx`, `driver/TaskList.tsx`, `driver/Notifications.tsx`
  are not imported anywhere. `data/mockData.ts` is scaffolding; only `weeklyDeliveryData`
  is still imported (by `Charts.tsx`).

## Working agreement

I am learning this codebase — it was generated by an AI tool, not written by me, and my
goal is to understand it, not just to have it fixed.

- Explain what a change does and why before or alongside making it.
- Point out the file and the data flow involved, so I learn where things live.
- Prefer small, reviewable changes over large rewrites.
- If I'm about to do something that will break something else, say so.
