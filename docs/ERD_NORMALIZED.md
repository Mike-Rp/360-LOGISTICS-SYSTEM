# 360 Logistics — ERD Prompts (real schema names only)

> Every table, column, and relationship in these prompts **exists in the live database**
> (`supabase/migrations`, latest file `20261105000002_opm_issue_reports.sql`). Nothing is
> added or renamed. A relationship line is drawn **only** where the database has a real
> foreign key.

---

## 1. Two figures, in the style of the reference ERD

The database has 16 tables in `public` plus Supabase's `auth.users`. Put into one figure,
that's unreadable, so the ERD is split into two figures:

| Figure | Center | What it shows |
|---|---|---|
| **5.1 — Staff and accounts** | `profiles` | Staff logins (CSR / OPM) and every table that points to a staff member: issues they resolve, reports they issue, delegations, fleet unavailability, password reset requests. Also the two standalone tables, `activity_log` and `login_attempts`. |
| **5.2 — Delivery operations** | `drivers` → `assignments` | The delivery: driver, truck, assignment, documents, status photos, delay reports, issues, notifications, fleet unavailability. |

Box style: table name on top, a narrow PK/FK column, attribute names, **no data types**.
Each box lists its **main** columns; columns left out still exist (see section 2).

Some tables appear in both figures. Like `booking` in the reference, they show only their
staff columns in 5.1 and their delivery columns in 5.2.

---

## 2. Columns left out of the boxes (they exist, just not drawn)

To keep the boxes small, these real columns are not shown. You can list them in an appendix.

| Table | Not drawn |
|---|---|
| `profiles` | `is_demo`, `invited_at`, `avatar_path` |
| `drivers` | `current_location`, `deliveries_today`, `rating`, `shift`, `auth_user_id`, `created_at` |
| `assignments` | `destination`, `destination_area`, `pickup_latitude`, `pickup_longitude`, `delivery_latitude`, `delivery_longitude`, `picked_up_date`, `ata`, `delivery_date`, `assigned_at`, `issue_reason`, `driver_acknowledged_at`, `pickup_arrived_at`, `loading_started_at`, `loading_completed_at`, `loading_remark`, `departed_at`, `destination_arrived_at`, `unloading_started_at`, `unloading_completed_at`, `unloading_remark`, `cancel_reason`, `cancel_acknowledged_at`, `cancelled_at`, `completed_at`, `completed_at_utc`, `created_at` |
| `assignment_documents` | `position`, `uploaded` |
| `status_photos` | `capture_observed_at`, `gps_observed_at`, `gps_accuracy_m`, `uploaded_at`, `file_hash` |
| `assignment_issues` | `task_status_at_report`, `operational_stage_at_report`, `reported_by_name`, `resolved_by_name`, `idempotency_key`, `created_at`, `updated_at` |
| `notifications` | `driver_name`, `truck_plate`, `doc_type`, `status_update`, `photo_url`, `reason`, `read`, `time_label`, `navigate_to` |
| `activity_log` | `driver_name`, `truck_plate`, `assignment_id`, `issue_id`, `doc_type`, `reject_reason`, `destination`, `company`, `member_name`, `member_email`, `reason`, `changes` |
| `issued_reports` | `generated_by_name`, `row_count`, `row_digest`, `created_at` |
| `csr_password_reset_requests` | `expires_at`, `completed_at`, `reset_token_hash`, `reset_token_created_at`, `reset_token_claimed_at` |
| `fleet_delegations` | `contact_phone`, `revoked_at`, `created_at` |
| `fleet_unavailability` | `created_at` |

---

## 3. How normalized is the real schema? (for your defense)

**Already normalized:**
- **No repeating groups in one row (1NF):** the six documents, the status photos, delay
  reports, and issues are each separate child tables linked by `assignment_id`, not lists
  stored inside `assignments`.
- **Composite keys used correctly:** `assignment_documents` (`assignment_id` + `type`) and
  `status_photos` (`assignment_id` + `status`) allow one row per document type and per
  photo stage.
- **One `assignments` table** with a `state` column (active / completed / cancelled)
  instead of three copies of the same table.
- **Sensitive data separated:** PINs in `driver_pins` (1-to-1 with `drivers`), passwords
  only in Supabase Auth (`auth.users`), never in our tables.

**Duplication kept on purpose:**
- `assignments.driver_name`, `truck_plate`: keep delivery history readable after a driver or
  truck changes or is archived.
- `activity_log` copies names, emails, and roles at the moment of the action: an audit log
  must show what was true *then*. It's also append-only (no update or delete).

**Not fully 3NF (be honest if asked; these are future improvements):**
- `assignments.company` and the location text/coordinates repeat on every delivery
  (could become client and location tables).
- The stage timestamp columns on `assignments` (`pickup_arrived_at` … `cancelled_at`) could
  become one event table.
- `drivers.truck_number` / `drivers.status` / `trucks.status` can be derived from active
  assignments.
- `notifications` copies `driver_name` / `truck_plate`, and its `assignment_id` has no
  foreign key.

So in your paper, describe the schema as **"normalized, with selected fields denormalized on
purpose for history and auditing"**, not as fully 3NF.

---

## 4. Prompts to paste

Paste **Prompt 1** into a new chat and **Prompt 2** into a second chat. Each is
self-contained. Change the figure numbers if your chapter numbering is different.

### Prompt 1 — Figure 5.1 (staff and accounts)

```text
Draw an Entity Relationship Model for a trucking delivery-tracking system called
360 Logistics. This figure shows STAFF AND ACCOUNTS: the profiles table (staff logins) in
the center, and the tables that point to a staff member around it.

Output: draw.io (diagrams.net) XML that I can import with Extras → Edit Diagram.
If you can't produce draw.io XML, output Mermaid erDiagram code instead.

Visual style (follow exactly):
- Each table is a simple box: the table name in a header row on top, then one row per
  attribute with two columns: a narrow left column with "PK", "FK" or "PK, FK" (blank for
  normal attributes) and a right column with the attribute name.
- Attribute names only. NO data types.
- Use the table and column names EXACTLY as written below (they are the real database
  names). Do not add, remove, or rename any table, column, or relationship.
- Black lines on a white background, plain font. No colors, icons, or shading.
- Put "profiles" in the center. Put "auth.users" on the left of profiles, with
  "csr_password_reset_requests" below auth.users and "notifications" next to it.
  Put the other boxes around profiles.
- Draw lines only for the relationships listed below, from the FK row to the PK row, with
  crow's-foot ends.
- Boxes marked "(partial)" intentionally show only some columns. Do NOT add the missing
  columns.
- Put "activity_log" and "login_attempts" at the bottom under the italic label
  "Standalone tables (no foreign keys)", with no lines.
- Under the diagram write the caption:
  "Figure 5.1: Entity Relationship Model of the proposed system"

Tables:

auth.users            (managed by Supabase Auth)
  PK id
     email

profiles
  PK, FK id
         email
         name
         phone
         role            (csr, opm)
         status
         last_active

assignment_issues     (partial)
  PK id
  FK resolved_by_user_id
     status
     resolved_at
     resolution_note

issued_reports
  PK id
  FK generated_by_user_id
     report_type
     report_period_start
     report_period_end
     generated_at

fleet_delegations
  PK id
  FK csr_id
  FK granted_by
     starts_at
     ends_at
     can_reset_pin
     can_register

fleet_unavailability  (partial)
  PK id
  FK created_by
  FK ended_by
     reason
     ended_at

csr_password_reset_requests
  PK id
  FK user_id
  FK reviewed_by
     requested_email
     status
     requested_at
     reviewed_at

notifications         (partial)
  PK id
  FK reset_request_id
     type
     message
     created_at

activity_log          (standalone, append-only audit log)
  PK id
     type
     ts
     admin_user_id
     admin_email
     admin_role

login_attempts        (standalone)
  PK email
     failed_count
     last_failed_at
     locked_until

Relationships (crow's foot):
- auth.users 1 — 1 profiles                          (profiles.id → auth.users.id)
- auth.users 1 — many csr_password_reset_requests    (user_id: requested by)
- auth.users 1 — many csr_password_reset_requests    (reviewed_by: reviewed by; optional)
- profiles 1 — many assignment_issues                (resolved_by_user_id; optional)
- profiles 1 — many issued_reports                   (generated_by_user_id)
- profiles 1 — many fleet_delegations                (csr_id: receives)
- profiles 1 — many fleet_delegations                (granted_by: grants)
- profiles 1 — many fleet_unavailability             (created_by; optional)
- profiles 1 — many fleet_unavailability             (ended_by; optional)
- csr_password_reset_requests 1 — many notifications (reset_request_id; optional)
```

### Prompt 2 — Figure 5.2 (delivery operations)

```text
Draw an Entity Relationship Model for a trucking delivery-tracking system called
360 Logistics. This figure shows DELIVERY OPERATIONS: a driver and a truck are given an
assignment (a delivery), which has required documents, status photos, delay reports,
and issues.

Output: draw.io (diagrams.net) XML that I can import with Extras → Edit Diagram.
If you can't produce draw.io XML, output Mermaid erDiagram code instead.

Visual style (follow exactly):
- Each table is a simple box: the table name in a header row on top, then one row per
  attribute with two columns: a narrow left column with "PK", "FK" or "PK, FK" (blank for
  normal attributes) and a right column with the attribute name.
- Attribute names only. NO data types.
- Use the table and column names EXACTLY as written below (they are the real database
  names). Do not add, remove, or rename any table, column, or relationship.
- Black lines on a white background, plain font. No colors, icons, or shading.
- Layout: "drivers" at the top center with "driver_pins" on its left and "notifications"
  on its right. "assignments" directly below drivers in the center. "trucks" on the left of
  assignments, with "fleet_unavailability" between drivers and trucks.
  "assignment_documents", "status_photos", "delay_reports" and "assignment_issues" below and
  to the right of assignments.
- Draw lines only for the relationships listed below, from the FK row to the PK row, with
  crow's-foot ends.
- In "notifications", assignment_id is a normal attribute (it has no foreign key in the
  database): do NOT draw a line from it.
- Under the diagram write the caption:
  "Figure 5.2: Entity Relationship Model of the proposed system"

Tables:

drivers
  PK id
     name
     phone
     truck_number
     status
     archived_at

driver_pins
  PK, FK driver_id
         pin

trucks
  PK id
     plate_number
     classification
     capacity
     status
     archived_at

fleet_unavailability
  PK id
  FK driver_id
  FK truck_id
     reason
     note
     expected_return_at
     ended_at

assignments
  PK id
  FK driver_id
  FK truck_id
     driver_name
     truck_plate
     company
     pickup_location
     delivery_location
     pickup_time
     scheduled_arrival_time
     task_status
     operational_stage
     state
     remarks

assignment_documents
  PK, FK assignment_id
  PK     type
         file_url
         doc_status
         reject_reason
         uploaded_at

status_photos
  PK, FK assignment_id
  PK     status
         url
         taken_at
         location
         lat
         lng
         source

delay_reports
  PK id
  FK assignment_id
     type
     reason
     reported_at

assignment_issues
  PK id
  FK assignment_id
  FK reported_by_driver_id
     issue_type
     reason
     is_blocking
     status
     reported_at

notifications
  PK id
  FK recipient_driver_id
     assignment_id
     type
     message
     read_at
     created_at

Relationships (crow's foot):
- drivers 1 — 1 driver_pins
- drivers 1 — many assignments              (driver_id; optional)
- trucks 1 — many assignments               (truck_id; optional)
- drivers 1 — many fleet_unavailability     (driver_id; optional)
- trucks 1 — many fleet_unavailability      (truck_id; optional)
- assignments 1 — many assignment_documents (one per document type, six types)
- assignments 1 — many status_photos        (one per photo stage)
- assignments 1 — many delay_reports
- assignments 1 — many assignment_issues
- drivers 1 — many assignment_issues        (reported_by_driver_id)
- drivers 1 — many notifications            (recipient_driver_id; optional)
```

---

## 5. If the figure is still too crowded

- Ask the AI: *"Show only PK and FK rows in each box."* Put the full column list (section 2)
  in an appendix.
- In Figure 5.2, `notifications` and `fleet_unavailability` can move to Figure 5.1 if
  space is tight.
