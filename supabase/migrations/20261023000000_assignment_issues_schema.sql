-- ════════════════════════════════════════════════════════════════════════════
-- REQ-008 phase 1 of 4 — assignment_issues: SCHEMA ONLY.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- No RPCs, no writes from anywhere yet — this is additive/inert, same safety
-- pattern as every other "schema first" migration this project has used
-- (REQ-002's stage columns, REQ-001's destination_area). Nothing in the app
-- writes to this table until phase 2 adds the two guarded RPCs, so applying
-- this now changes zero behavior.
--
-- One row per reported delivery issue (distinct from the existing, unrelated
-- pickup/delivery delay_reports workflow). A resolved issue is never
-- overwritten by a later one — each report is its own permanent row.
--
-- FK design notes:
--   - assignment_id -> assignments(id) ON DELETE RESTRICT: assignments are
--     never actually deleted in this app (archived via state), so this is
--     a safety rail, not expected to ever fire.
--   - reported_by_driver_id -> drivers(id) ON DELETE RESTRICT: drivers are
--     archived (archive_driver()), never row-deleted, for the same reason.
--   - resolved_by_user_id -> profiles(id) ON DELETE SET NULL, NOT restrict:
--     remove_team_member() does a REAL delete of the auth user (cascading to
--     profiles), unlike drivers. A RESTRICT here would make it impossible to
--     ever remove a CSR who resolved an issue. Paired with a name snapshot
--     (same "copy identity onto the row" convention this schema already uses
--     for assignments.driver_name/truck_plate) so history stays readable
--     even after the account is gone.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create table public.assignment_issues (
  id                           bigint generated always as identity primary key,
  assignment_id                text not null references public.assignments(id) on delete restrict,
  issue_type                   text not null,
  reason                       text not null,
  is_blocking                  boolean not null,
  status                       text not null default 'open' check (status in ('open', 'resolved')),
  reported_by_driver_id        text not null references public.drivers(id) on delete restrict,
  reported_by_name             text not null,
  reported_at                  timestamptz not null default now(),
  task_status_at_report        text not null,
  operational_stage_at_report  text,
  resolved_by_user_id          uuid references public.profiles(id) on delete set null,
  resolved_by_name             text,
  resolved_at                  timestamptz,
  resolution_note              text,
  idempotency_key              text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint assignment_issues_reason_not_blank check (btrim(reason) <> ''),
  constraint assignment_issues_resolution_note_length check (resolution_note is null or char_length(resolution_note) <= 300),
  constraint assignment_issues_resolved_fields check (
    (status = 'open'     and resolved_at is null     and resolution_note is null)
    or
    (status = 'resolved' and resolved_at is not null)
  )
);

create index assignment_issues_assignment_idx on public.assignment_issues (assignment_id, reported_at desc);
create index assignment_issues_status_idx     on public.assignment_issues (status, reported_at desc);
create index assignment_issues_type_idx       on public.assignment_issues (issue_type);

-- At most one OPEN BLOCKING issue per assignment at a time (resolved/nonblocking
-- issues are unrestricted — an assignment can have many over its history).
create unique index assignment_issues_one_open_blocking
  on public.assignment_issues (assignment_id)
  where status = 'open' and is_blocking;

-- Double-submit protection: a request replayed with the same key returns the
-- same row instead of creating a duplicate (phase 2's RPC uses this).
create unique index assignment_issues_idempotency_key_idx
  on public.assignment_issues (idempotency_key)
  where idempotency_key is not null;

alter table public.assignment_issues enable row level security;

-- Staff see everything; a driver sees only their own assignment's issues.
create policy assignment_issues_select on public.assignment_issues for select to authenticated
  using (public.is_staff() or public.driver_owns_assignment(assignment_id));

-- No insert/update/delete policy for anyone, and no such grant either —
-- every write goes through the SECURITY DEFINER RPCs added in phase 2,
-- which bypass RLS/grants the same way every other guarded RPC in this
-- schema does (archive_driver, cancel_assignment, etc.).
revoke all on public.assignment_issues from anon;
grant select on public.assignment_issues to authenticated;

commit;
