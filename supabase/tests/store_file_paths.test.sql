-- ════════════════════════════════════════════════════════════════════════════
-- Stored file paths — database tests (run AFTER 20261021000003_store_file_paths.sql).
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "PATH TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "PATH FAIL: …"                                            → what broke
-- Throwaway rows only (ids containing PATHTEST). Run the whole file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $test$
declare
  n   int := 0;
  ok  boolean;
  link text := 'https://yeyfmyojdlqtgoqlwhsv.supabase.co/storage/v1/object/sign/make-ee4d169c-media/photos/ASN-PATHTEST/x.jpg?token=t';
begin
  -- ── 1. no stored link is left in any of the three columns ──
  if exists (select 1 from public.status_photos        where url       like '%/storage/v1/object/%')
     or exists (select 1 from public.assignment_documents where file_url  like '%/storage/v1/object/%')
     or exists (select 1 from public.notifications        where photo_url like '%/storage/v1/object/%') then
    raise exception 'PATH FAIL: a stored link is still present';
  end if;
  n := n + 1;

  -- ── 2. every stored path points to an existing file in the bucket ──
  if exists (
    select 1 from (
      select url v from public.status_photos
      union all select file_url from public.assignment_documents
      union all select photo_url from public.notifications) u
    where (v like 'photos/%' or v like 'docs/%')
      and not exists (select 1 from storage.objects o where o.bucket_id = 'make-ee4d169c-media' and o.name = u.v)) then
    raise exception 'PATH FAIL: a stored path has no file';
  end if;
  n := n + 1;

  -- ── 3. the upload-time trigger is back on ──
  if not exists (select 1 from pg_trigger where tgrelid = 'public.assignment_documents'::regclass
                   and tgname = 'documents_stamp_uploaded_at' and tgenabled = 'O') then
    raise exception 'PATH FAIL: documents_stamp_uploaded_at is not enabled';
  end if;
  n := n + 1;

  -- ── 4. a link can no longer be stored; a path can ──
  insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state)
  values ('ASN-PATHTEST', 'A → B', 'Pasay City', 'Path test', 'A', 'Assigned', 'active');
  ok := false; begin insert into public.status_photos (assignment_id, status, url) values ('ASN-PATHTEST', 'pickup_front', link);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'PATH FAIL: a photo link was accepted'; end if;
  ok := false; begin insert into public.assignment_documents (assignment_id, type, position, uploaded, doc_status, file_url)
    values ('ASN-PATHTEST', 'Waybill / Delivery Receipt', 0, true, 'pending', link);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'PATH FAIL: a document link was accepted'; end if;
  ok := false; begin insert into public.notifications (id, type, message, assignment_id, photo_url)
    values ('notif-PATHTEST', 'status_update', 'x', 'ASN-PATHTEST', link);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'PATH FAIL: a notification link was accepted'; end if;
  insert into public.status_photos (assignment_id, status, url) values ('ASN-PATHTEST', 'pickup_front', 'photos/ASN-PATHTEST/x.jpg');
  n := n + 1;

  raise exception 'PATH TESTS PASSED (% checks) — rolled back on purpose, nothing was saved', n;
end
$test$;
rollback;
