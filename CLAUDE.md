# 360 Logistics — Project Context

Trucking operations and delivery tracking app. Read this before making changes.

## What it does

Two user types, one codebase:

- **Admin** (desktop web) — assigns deliveries to drivers, reviews uploaded documents,
  manages drivers and trucks, monitors delivery status. Staff roles: `admin`, `csr`
  (both can write), `viewer` (read-only). One viewer is the **Operation Manager** (OM),
  who alone can invite/remove team members.
- **Driver** (mobile web) — sees their active assignment, advances it through a status
  flow with photo proof, uploads six required delivery documents.

## Stack

- React 18 + TypeScript + Tailwind CSS v4 + Vite
- Backend: **Supabase directly from the browser** (`@supabase/supabase-js`) — there is no
  server code of our own any more
- Database: Supabase Postgres — **relational tables**, protected by **Row Level Security**
- Auth: **Supabase Auth** (email + password for staff; synthetic email + PIN for drivers)
- Storage: Supabase Storage, private bucket `make-ee4d169c-media`, signed URLs

## Running locally

```bash
pnpm install
pnpm dev
```

Create `.env.local` (git-ignored) with the project's URL and **anon** key:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
```

Vite reads it at startup — restart `pnpm dev` after editing. Hosting must set the same two
variables. **Never** put the service-role key in the repo or in any `VITE_` variable.

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

**All database calls live in one file: `src/app/lib/db.ts`.** Screens do not call `supabase`
directly. `supabaseClient.ts` only creates the connection.

- **Loading:** `loadAdminData()` reads every table and rebuilds the same objects the screens
  already use (`Assignment`, `LocalDriver`, …). `loadDriverData()` does the same for one driver.
- **Saving (admin):** screens still edit plain arrays in `App.tsx`. `syncAdminData()` compares
  them with what was last loaded and writes **only the rows/columns that changed**
  (insert / update changed columns / delete). It is queued so saves never overlap.
- **Driver writes:** `driverUpdate()` — status, photos, delay reports, new document files,
  and a notification. `uploadImage()` sends photos/documents to Storage.
- Admin screen polls every 12 s, driver screen every 5 s.

## Data model (supabase/migrations)

`profiles` (staff logins: role, `is_om`, `is_demo`, status), `drivers`, `driver_pins`,
`trucks`, `assignments`, `assignment_documents`, `status_photos`, `delay_reports`,
`notifications`, `activity_log`.

- One `assignments` table replaces the old three arrays: `state` is `active | completed | cancelled`.
  `loadAdminData()` splits it back into `assignments` / `completed` / `cancelled`.
- Ids and display times are `text` (the app generates ids like `DR12345` / `ASN12345` and
  formats times as strings). Tighten later if wanted.
- `activity_log` is **append-only** (no update/delete policy) and the database stamps the real
  signed-in email/role on insert.

## Security model — enforced by the database, not by JavaScript

The anon key is public. Safety comes from **GRANTs + RLS + triggers** in `supabase/migrations`:

- No RLS-less table; `anon` has no table access at all.
- Staff (active profile) read everything; only `admin`/`csr` write; `viewer` is read-only.
- A driver sees only their own driver row, assignments, documents, photos, and may only change
  status / issue reason / acknowledgement, add photos + delay reports, and attach a new
  document file. Trigger `guard_document_write` resets a document to `pending` when a new
  file is attached and ignores any status a driver sends (replaces the old "smart merge").
- Files in Storage: drivers may upload only under `photos|docs/<their assignment id>/`.
- Creating/resetting logins needs the privileged `auth` schema, so it is done by
  `SECURITY DEFINER` functions that check the caller first: `sync_driver_login`,
  `create_team_member`, `remove_team_member`, `reset_all_data`, `touch_last_active`.
- New Supabase projects do **not** auto-grant table access to `authenticated`; the
  `*_grants.sql` migration does it explicitly. Both layers (GRANT + RLS) must allow a request.

Migrations are applied by hand (SQL editor or the Supabase connector) — they are numbered by
filename. `supabase/manual/seed_staff.sql` attaches roles to staff users you create in
Dashboard → Authentication → Users (passwords are never stored in this repo).

## Rules and gotchas

- **Drivers log in with mobile + 4-digit PIN.** Auth email is `d09XXXXXXXXX@drivers.360logistics.ph`
  and the password is `360pin-<PIN>` (Auth needs ≥ 6 chars). `driverLoginEmail/Password` in
  `db.ts` **must match** `driver_login_email()` / `sync_driver_login()` in the migration.
  Auth only says "invalid" — it can't tell wrong mobile from wrong PIN (by design).
- Admins can still *see* driver PINs (`driver_pins`, readable by admin/csr only); the Auth
  password itself is hashed. Team-member passwords are shown once at creation, never readable.
- When a **driver** inserts a notification, do **not** ask for the row back (`.select()`):
  drivers may insert but not read the feed, so the read-back fails.
- Only send columns you are allowed to write — `drivers` has column-level grants
  (`auth_user_id` is set only by `sync_driver_login`), `profiles` allows updating only
  `name`, `role`, `status`.
- Assignments keep history after a driver/truck is deleted: `driver_id`/`truck_id` become null
  (names/plates are copied onto the assignment).
- Direct writes to the `auth` schema (in `_create_auth_user`) are not an official Supabase API.
  If a Supabase update breaks driver/team-member creation, look there first.
- `HANDOFF.md` and `PROJECT_AUDIT.md` describe the **old** edge-function design — treat as history.
- `supabase/functions/server/` is the **legacy** edge function (old project, no longer deployed
  or used). It still contains the old plaintext admin passwords — do not reuse them. Safe to delete.
- The six required document types are hardcoded in `DriverInterface.tsx` as `REQUIRED_DOCS`.
- Driver phone numbers are Philippine format, stored as `+639XXXXXXXXX` and normalised to
  `09XXXXXXXXX` for login (`normaliseMobile` in `db.ts` and SQL).

## Known incomplete features

- **Dashboard line chart** (`Charts.tsx`) — reads static numbers from `mockData.ts`, not
  real deliveries. **Reports bar chart** — hardcoded placeholder array.
- **Offline driver screen** (`DriverInterface.tsx`) — on first-load failure shows a
  "No Connection" screen with an explicit *Preview with demo data* button (`MOCK_DATA`).
- **Settings profile card** (`SettingsPanel.tsx`) — shows a hard-coded email, not the signed-in one.
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
