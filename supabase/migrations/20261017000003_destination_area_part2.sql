-- ════════════════════════════════════════════════════════════════════════════
-- Destination area — PART 2 of 2 (the rule: every NEW delivery needs an area)
--
-- Run this ONLY after:
--   1. 20261017000002_destination_area_part1.sql has been run, AND
--   2. VITE_DESTINATION_AREA_ENABLED=true is deployed (Vercel) and set in your
--      local .env.local, AND
--   3. everyone has refreshed the site — a browser still running the old code
--      sends no area, and its new deliveries would be rejected after this.
--
-- If a dispatch starts failing with "destination_area_required", back out with:
--   drop trigger assignments_destination_area_required on public.assignments;
--
-- Only INSERTs are checked. Existing deliveries and edits are not affected.
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- Refuse to run if part 1 was skipped
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'assignments' and column_name = 'destination_area') then
    raise exception 'Run 20261017000002_destination_area_part1.sql first (assignments.destination_area is missing)';
  end if;
end $$;

create or replace function public.require_assignment_destination_area() returns trigger
language plpgsql set search_path = '' as $$
begin
  if btrim(coalesce(new.destination_area, '')) = '' then
    raise exception 'destination_area_required' using errcode = '22023';
  end if;
  new.destination_area := btrim(new.destination_area);
  return new;
end $$;

create or replace trigger assignments_destination_area_required
before insert on public.assignments
for each row execute function public.require_assignment_destination_area();

revoke all on function public.require_assignment_destination_area()
from public, anon, authenticated;

commit;
