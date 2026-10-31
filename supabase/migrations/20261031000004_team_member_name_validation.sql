-- ════════════════════════════════════════════════════════════════════════════
-- Add Team Member: validate the name on the server.
-- create_team_member() only checked that the name wasn't empty, so any text
-- (digits, '#', '@', emoji…) was accepted. It now applies the same rule as
-- update_own_display_name() and register_driver():
--   letters (any language — Ñ, ñ, é are fine), spaces, apostrophes, hyphens,
--   periods; must start with a letter; at most 100 characters.
-- Everything else in the function is exactly the previous version
-- (20261023000010_csr_setup_link.sql).
--
-- Manual SQL Editor application only. Shared/production project.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- Safety net: abort (and roll everything back) if this database does not treat
-- Ñ as a letter, because then Filipino names would be rejected.
do $$
begin
  if 'Peña Ñandú' !~ '^[[:alpha:]][[:alpha:][:space:]''.-]*$' then
    raise exception 'This database does not treat Ñ as a letter; name rule would reject Filipino names.';
  end if;
end $$;

create or replace function public.create_team_member(p_name text, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id           uuid;
  v_email        text := lower(trim(p_email));
  v_name         text := trim(p_name);
  v_throwaway_pw text := encode(extensions.gen_random_bytes(24), 'hex');
  v_setup_token  text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_role <> 'csr' then raise exception 'invalid_role'; end if;
  if v_name = '' or v_email = '' then raise exception 'missing_fields'; end if;
  if char_length(v_name) > 100 then raise exception 'name_too_long' using errcode = '22023'; end if;
  if v_name !~ '^[[:alpha:]][[:alpha:][:space:]''.-]*$' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  v_id := public._create_auth_user(v_email, v_throwaway_pw, jsonb_build_object('name', v_name));
  insert into public.profiles (id, email, name, role) values (v_id, v_email, v_name, p_role);

  insert into public.csr_password_reset_requests
    (user_id, requested_email, status, reviewed_by, reviewed_at, expires_at,
     reset_token_hash, reset_token_created_at)
  values
    (v_id, v_email, 'approved', auth.uid(), now(), now() + interval '7 days',
     encode(extensions.digest(v_setup_token, 'sha256'), 'hex'), now());

  return jsonb_build_object(
    'id', v_id, 'name', v_name, 'email', v_email, 'role', p_role,
    'status', 'active', 'invitedAt', now(), 'setupToken', v_setup_token
  );
end $$;

revoke all on function public.create_team_member(text, text, text) from public, anon, authenticated;
grant execute on function public.create_team_member(text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
