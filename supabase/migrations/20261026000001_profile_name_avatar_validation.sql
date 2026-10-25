-- ════════════════════════════════════════════════════════════════════════════
-- Bug fixes: display name accepted any characters; avatar upload accepted
-- any file type.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- 1. update_own_display_name() only checked non-empty / under 100 chars —
--    nothing stopped a value like "--" or pure symbols/numbers. Adds a
--    format check: must start with a letter, and contain only letters,
--    spaces, apostrophes, hyphens, and periods (covers names like
--    "Maria Santos", "O'Brien", "Jose P. Rizal").
--
-- 2. The original REQ-012 migration's own comment said Storage RLS "can't
--    cleanly inspect an upload's content type here" and left file-type
--    validation client-side only (the file picker's accept="image/*" is a
--    browser hint a user can bypass via drag-and-drop or "All Files").
--    That assumption was wrong: Supabase Storage records each upload's real
--    MIME type in storage.objects.metadata before the row is ever visible
--    to RLS, so the WITH CHECK clause itself can require it. Tightens
--    media_insert/media_update so the profiles/ avatar path specifically
--    must be an image/* upload — every other path (photos/docs) is
--    untouched.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.update_own_display_name(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text := trim(p_name);
begin
  if not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'missing_name' using errcode = '22023'; end if;
  if char_length(v_name) > 100 then raise exception 'name_too_long' using errcode = '22023'; end if;
  if v_name !~ '^[[:alpha:]][[:alpha:][:space:]''.-]*$' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  update public.profiles set name = v_name where id = auth.uid();

  return (select jsonb_build_object('id', id, 'email', email, 'name', name, 'role', role, 'avatarPath', avatar_path)
          from public.profiles where id = auth.uid());
end $$;

drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'make-ee4d169c-media'
    and (
      ((storage.foldername(name))[1] in ('photos', 'docs') and public.driver_owns_assignment((storage.foldername(name))[2]))
      or (
        (storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = auth.uid()::text
        and public.is_staff() and coalesce(metadata ->> 'mimetype', '') like 'image/%'
      )
    )
  );

drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects for update to authenticated
  using (
    bucket_id = 'make-ee4d169c-media'
    and (
      public.driver_owns_assignment((storage.foldername(name))[2])
      or (
        (storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = auth.uid()::text
        and public.is_staff() and coalesce(metadata ->> 'mimetype', '') like 'image/%'
      )
    )
  );

notify pgrst, 'reload schema';
commit;
