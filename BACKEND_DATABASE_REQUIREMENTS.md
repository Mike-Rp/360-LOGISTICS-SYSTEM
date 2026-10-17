# Backend & Database Requirements

This document tracks features discovered during development that require
backend, API, database, schema, migration, or persistent-storage changes.

## Project Rule

Database/backend changes must not be implemented automatically.
Record the requirement here first and wait for explicit approval.

When a requested feature needs support that the current data model cannot provide:

1. Inspect the current persistence path and check this file for an existing entry.
2. Add or update the requirement without creating a duplicate. Never reuse an ID.
3. Implement only the portions that work correctly with existing data and behavior.
4. Report what remains blocked and the approval needed. Do not add a frontend-only
   field that appears to save but disappears after refresh.

Do not add entries for UI-only changes such as spacing, colors, labels, placeholders,
responsive layout, icons, or typography.

## Status and approval

Use only `Pending`, `Approved`, `In Progress`, `Implemented`, `Rejected`, or
`No Longer Needed` for **Status**. Number entries sequentially as `REQ-001`,
`REQ-002`, and so on. Update an existing entry when a later task concerns the
same requirement.

Set **Approval** to `Approved` and **Status** to `Approved` only after explicit
user approval. When implementation begins, set **Status** to `In Progress`.
After implementation and verification, set **Status** to `Implemented` and
record the migration, affected backend/API/frontend files, and verification.
Do not infer approval from a request for a UI change.

## [REQ-001] Separate Destination and Delivery Location

**Status:** In Progress

**Area:** Dispatch / Deliveries / Driver App / Reports

**Requested change:**
Store and display Origin (general starting area), Pickup Location (specific
pickup point), Destination (general destination area), and Delivery Location
(exact receiving or drop-off point) as distinct assignment values.

**Why backend/database support is required:**
Dispatch Truck currently keeps Origin and Delivery Location in separate form
state, then saves them together as one string in `Assignment.destination`:
`Origin → Delivery Location`. There is no separately persisted general
Destination. Adding another input to the current form would either overwrite
the same value or disappear after refresh.

**System before these local changes:**
- `src/app/components/admin/DriversManagement.tsx` saves `taskFrom` and
  `taskTo` as one `destination` string. The edit flow uses the same format.
- `src/app/data/assignmentTypes.ts` has `destination`, `pickupLocation`, and
  `company`, but no separate origin, destination area, or delivery location.
- `src/app/lib/db.ts` maps `Assignment.destination` to the
  `public.assignments.destination` column. The current repository migration
  defines that column but no separate columns for these three route values.
- Confirm the actual development database schema before planning a migration;
  this entry describes the current repository code and migrations.

**Required backend/database change:**
- Add a general Destination field while preserving the existing combined route
  (`Origin → Delivery Location`) and its exact drop-off value.
- Extend assignment create, update, and read mappings for the new field.
- Derive the displayed general route from the saved origin and new Destination,
  with the legacy route as a fallback for old assignments.

**Suggested data model:**
- `destination_area`: nullable text for general Destination; required for new
  assignments by a database insert check.
- Keep existing `destination` as `Origin → Delivery Location`. This preserves
  old assignments and allows the exact drop-off to be read without a backfill.

**API impact:**
Assignment create/update/read payloads and the active persistence mapper must
carry the separate values. Inspect the actual data path at implementation time;
a new endpoint is not necessarily required.

**Frontend impact:**
- Dispatch Truck Step 1 and assignment edit form.
- Dispatch cards and View Shipment.
- Deliveries and Driver task/details views.
- Reports and exports that show route or delivery location, where applicable.

**Migration required:** Yes

**Risk / considerations:**
Existing `destination` strings combine the route origin with an exact drop-off
point. They do not reliably contain a general destination area, so do not
backfill it automatically. Preserve old assignments and their display during
rollout. The new field is nullable for old rows and validated on new inserts.

**Approval:** Approved — local development only (2026-10-17)

**Implementation status:** Prepared locally; database and end-to-end verification pending

**Blocked:** Development Supabase migration requires authorized Supabase access.

**Prepared migration:** `supabase/migrations/20261017000000_destination_area.sql`.
It adds nullable `public.assignments.destination_area`, requires a nonblank
value on new assignment inserts, and extends the existing protected
`edit_assignment` function to update that field. It leaves the current
`destination` route and historical rows unchanged.

**Local activation after an authorized developer applies the migration:**
1. Confirm the SQL editor is connected to the development project used by
   `.env.local`, then execute the complete migration file there. Do not run it
   against production. The repository's `supabase/config.toml` may name a
   different project, so verify the target explicitly.
2. Verify the `destination_area` column, insert trigger, and updated
   `edit_assignment` function exist. Existing rows should retain NULL in the
   new column.
3. Set `VITE_DESTINATION_AREA_ENABLED=true` in local `.env.local` and restart
   `pnpm dev`. The default is false, so the local app keeps using its existing
   form and write payload until this step. The migration requires Destination
   on new inserts, so pause assignment creation between applying the SQL and
   enabling this setting. Old clients with the setting off cannot create new
   assignments after the migration.
4. Create and read back a development test assignment with distinct Origin,
   Destination, and Delivery Location. Verify Dispatch, Deliveries, Driver
   details, editing, and refresh before marking this requirement Implemented.

**Local files prepared:** `src/app/data/assignmentTypes.ts`,
`src/app/data/assignmentRoute.ts`, `src/app/lib/db.ts`,
`src/app/components/admin/DriversManagement.tsx`,
`src/app/components/admin/DeliveryTable.tsx`,
`src/app/components/admin/Reports.tsx`, `src/app/components/admin/Charts.tsx`,
`src/app/components/driver/DriverInterface.tsx`,
`src/app/components/driver/driverI18n.tsx`, and `.env.example`.

---
