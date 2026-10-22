-- ════════════════════════════════════════════════════════════════════════════
-- REQ-012 — Per-account profile persistence (own display name + avatar).
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Adds profiles.avatar_path and two self-service RPCs. Deliberately does NOT
-- touch profiles_update_opm or the existing column grants — per the
-- requirement's own warning, combining a wider column grant with that policy
-- could let OPM edit another member's name/avatar. Both new RPCs are
-- SECURITY DEFINER and update only the caller's own row (auth.uid()), so no
-- RLS/grant change on public.profiles is needed at all.
--
-- Storage: avatars live at profiles/<auth-user-uuid>/<file>, private bucket
-- make-ee4d169c-media (same bucket as photos/docs, different top folder).
--   * media_select needs no change — is_staff() already grants any signed-in
--     staff member read access to the whole bucket, so OPM (or any staff)
--     can already see a profile avatar once uploaded.
--   * media_insert / media_update extended: a staff member may write only
--     under their own profiles/<their uuid>/ path. Driver photo/doc paths
--     are untouched.
--   * media_delete extended: today it's can_write()-only (admin/csr), which
--     would wrongly block OPM from removing their own avatar. Added an
--     owner-match branch for the profiles/ path specifically, alongside the
--     existing can_write() branch — does not widen delete rights anywhere else.
--
-- Not done here (flagged, not silently skipped): server-side file size/type
-- validation. Storage RLS can't cleanly inspect an upload's content type here;
-- validation stays client-side for now (same as existing photo/doc uploads).
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.profiles add column if not exists avatar_path text;

-- ── 1. Update own display name ──
create function public.update_own_display_name(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text := trim(p_name);
begin
  if not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'missing_name' using errcode = '22023'; end if;
  if char_length(v_name) > 100 then raise exception 'name_too_long' using errcode = '22023'; end if;

  update public.profiles set name = v_name where id = auth.uid();

  return (select jsonb_build_object('id', id, 'email', email, 'name', name, 'role', role, 'avatarPath', avatar_path)
          from public.profiles where id = auth.uid());
end $$;

-- ── 2. Set/clear own avatar path (upload itself goes through Storage directly;
--       this just persists or clears the pointer, and refuses a path that
--       isn't the caller's own profiles/<uuid>/... object) ──
create function public.set_own_avatar_path(p_avatar_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_avatar_path is not null and (
       split_part(p_avatar_path, '/', 1) <> 'profiles'
    or split_part(p_avatar_path, '/', 2) <> auth.uid()::text
  ) then
    raise exception 'invalid_path' using errcode = '22023';
  end if;

  update public.profiles set avatar_path = p_avatar_path where id = auth.uid();

  return (select jsonb_build_object('id', id, 'email', email, 'name', name, 'role', role, 'avatarPath', avatar_path)
          from public.profiles where id = auth.uid());
end $$;

revoke all on function public.update_own_display_name(text), public.set_own_avatar_path(text) from public, anon;
grant execute on function public.update_own_display_name(text), public.set_own_avatar_path(text) to authenticated;

-- ── 3. Storage: own-avatar write access ──
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'make-ee4d169c-media'
    and (
      ((storage.foldername(name))[1] in ('photos', 'docs') and public.driver_owns_assignment((storage.foldername(name))[2]))
      or ((storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = auth.uid()::text and public.is_staff())
    )
  );

drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects for update to authenticated
  using (
    bucket_id = 'make-ee4d169c-media'
    and (
      public.driver_owns_assignment((storage.foldername(name))[2])
      or ((storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = auth.uid()::text and public.is_staff())
    )
  );

drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'make-ee4d169c-media'
    and (
      public.can_write()
      or ((storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = auth.uid()::text and public.is_staff())
    )
  );

notify pgrst, 'reload schema';
commit;
