-- ════════════════════════════════════════════════════════════════════════════
-- Record WHEN each delivery document was uploaded.
--
-- The driver app's delivery history already reads assignment_documents.uploaded_at
-- (db.ts → loadDriverData / history detail) and shows it under each uploaded
-- document, but the column never existed, so that line never appeared.
--
-- The database stamps the time itself (a trigger), so the browser can neither
-- set nor fake it:
--   • a file is attached or replaced  → uploaded_at = now()
--   • file_url did not change          → uploaded_at keeps its old value
--   • file is removed (file_url null)  → uploaded_at = null
--
-- Existing rows stay NULL: the real upload time was never recorded, so none is
-- invented. Only uploads from now on get a time.
--
-- Safe to run more than once. Does not depend on the other migrations except
-- that assignment_documents (init.sql) must exist.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.assignment_documents add column if not exists uploaded_at timestamptz;

create or replace function public.stamp_document_uploaded_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_at := case when new.file_url is not null then now() else null end;
  elsif new.file_url is distinct from old.file_url then
    new.uploaded_at := case when new.file_url is not null then now() else null end;
  else
    new.uploaded_at := old.uploaded_at;          -- ignore anything the client sent
  end if;
  return new;
end $$;

-- Named so it fires after documents_guard (triggers run in alphabetical order),
-- i.e. it sees the file_url the guard actually allowed.
drop trigger if exists documents_stamp_uploaded_at on public.assignment_documents;
create trigger documents_stamp_uploaded_at before insert or update on public.assignment_documents
  for each row execute function public.stamp_document_uploaded_at();

-- Trigger function only — nobody calls it directly (same pattern as the other migrations)
revoke all on function public.stamp_document_uploaded_at() from public, anon, authenticated;

commit;
