-- ════════════════════════════════════════════════════════════════════════════
-- REQ-006 database tests — CSR password reset via OPM-approved one-time link.
--
-- Run AFTER migrations 20261020000002 and 20261020000003.
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "REQ-006 TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "REQ-006 FAIL: …"                                            → what broke
--
-- The Edge Function's database steps (claim / release / finish) are called as
-- service_role, exactly as the function does; the Auth Admin API password change
-- in between is replayed as Auth's own UPDATE of auth.users. The Edge Function's
-- own logic is unit-tested separately:
--   node --test supabase/functions/complete-csr-password-reset/logic.test.cjs
-- The recovery / magic-link guard is deferred to COMMIT; `set constraints all
-- immediate` runs it at the point the real Auth transaction would commit.
-- Uses its own throwaway users (@req006.invalid); real rows are never touched.
-- Run the whole file at once: the helpers below roll back with everything else.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- Replays Auth's UpdatePassword() + session clean-up, then the commit-time check.
-- p_keep = the caller's session (PUT /user); null = Admin API (all sessions go).
create function pg_temp.req006_change_password(p_uid uuid, p_keep uuid) returns text
language plpgsql as $f$
begin
  set constraints all deferred;
  begin
    update auth.users
       set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
           confirmation_token = '', confirmation_sent_at = null,
           recovery_token = '', recovery_sent_at = null,
           email_change_token_current = '', email_change_token_new = '', email_change_sent_at = null,
           phone_change_token = '', phone_change_sent_at = null,
           reauthentication_token = '', reauthentication_sent_at = null,
           updated_at = now()
     where id = p_uid;
    if p_keep is null then
      delete from auth.sessions where user_id = p_uid;
    else
      delete from auth.sessions where user_id = p_uid and id <> p_keep;
    end if;
    set constraints all immediate;   -- = COMMIT
    return 'ok';
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
end $f$;

-- A signed-in session for p_uid, recorded with sign-in method p_method.
create function pg_temp.req006_session(p_uid uuid, p_method text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v, p_uid, now(), now());
  insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
    values (gen_random_uuid(), v, now(), now(), p_method);
  return v;
end $f$;

do $test$
declare
  n     int := 0;
  csr_a uuid := gen_random_uuid();   -- main flow
  csr_b uuid := gen_random_uuid();   -- rejected
  csr_c uuid := gen_random_uuid();   -- expired
  csr_d uuid := gen_random_uuid();   -- removed CSR
  opm   uuid := gen_random_uuid();
  adm   uuid := gen_random_uuid();   -- admin staff, not OPM
  drv   uuid := gen_random_uuid();   -- driver-style login (no staff profile)
  sess  uuid;
  res   text;
  req   public.csr_password_reset_requests%rowtype;
  req_b uuid; req_c uuid; req_d uuid;
  t1 text; t2 text; t3 text; t4 text := encode(extensions.gen_random_bytes(32), 'hex'); t5 text := encode(extensions.gen_random_bytes(32), 'hex');
  exp_before timestamptz;
  h_before text; h_after text;
  claimed record;
  cnt   int;
  ok    boolean;
begin
  -- ── setup: throwaway users ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, 'authenticated', 'authenticated', u.email, extensions.crypt('old-pass', extensions.gen_salt('bf')), now(), now(), now()
    from (values (csr_a, 'csr-a@req006.invalid'), (csr_b, 'csr-b@req006.invalid'), (csr_c, 'csr-c@req006.invalid'),
                 (csr_d, 'csr-d@req006.invalid'), (opm, 'opm@req006.invalid'), (adm, 'admin@req006.invalid'),
                 (drv, 'd09170000000@req006.invalid')) u(id, email);
  insert into public.profiles (id, email, name, role, status)
  values (csr_a, 'csr-a@req006.invalid', 'REQ-006 Test CSR A', 'csr', 'active'),
         (csr_b, 'csr-b@req006.invalid', 'REQ-006 Test CSR B', 'csr', 'active'),
         (csr_c, 'csr-c@req006.invalid', 'REQ-006 Test CSR C', 'csr', 'active'),
         (csr_d, 'csr-d@req006.invalid', 'REQ-006 Test CSR D', 'csr', 'active'),
         (opm,   'opm@req006.invalid',   'REQ-006 Test OPM',   'opm', 'active'),
         (adm,   'admin@req006.invalid', 'REQ-006 Test Admin', 'admin', 'active');

  -- ── 1. no raw token / password columns; the only token column is a SHA-256 hex hash ──
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'csr_password_reset_requests'
               and (column_name like '%password%' or (column_name like '%token%'
                    and column_name not in ('reset_token_hash', 'reset_token_created_at', 'reset_token_claimed_at')))) then
    raise exception 'REQ-006 FAIL: request table has a password/raw-token column';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'csr_password_reset_token_hash_format') then
    raise exception 'REQ-006 FAIL: token hash format constraint missing';
  end if;
  n := n + 1;

  -- ── 2. anonymous users cannot read requests or call OPM / Edge Function operations ──
  set local role anon;
  ok := false; begin perform 1 from public.csr_password_reset_requests; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: anon can read reset requests'; end if;
  ok := false; begin perform public.claim_csr_password_reset(repeat('0', 64)); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: anon can call claim'; end if;
  ok := false; begin perform public.finish_csr_password_reset(gen_random_uuid(), repeat('0', 64)); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: anon can call finish'; end if;
  ok := false; begin perform public.create_csr_password_reset_link(gen_random_uuid()); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: anon can call create link'; end if;
  n := n + 1;

  -- ── 3. CSR Forgot Password (anonymous RPC) creates a pending request ──
  perform public.request_csr_password_reset('CSR-A@req006.invalid');
  reset role;
  select * into req from public.csr_password_reset_requests where user_id = csr_a;
  if not found or req.status <> 'pending' or req.reset_token_hash is not null then
    raise exception 'REQ-006 FAIL: pending request not created';
  end if;
  n := n + 1;

  -- ── 4–9. a signed-in CSR cannot approve, complete, insert, review, link, or read the hash ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', csr_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin update public.csr_password_reset_requests set status = 'approved', expires_at = now() + interval '1 day' where user_id = csr_a;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: CSR could self-approve'; end if;
  n := n + 1;
  ok := false; begin update public.csr_password_reset_requests set status = 'completed', completed_at = now() where user_id = csr_a;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: CSR could self-complete'; end if;
  n := n + 1;
  ok := false; begin insert into public.csr_password_reset_requests (user_id, requested_email, status, expires_at)
    values (csr_a, 'csr-a@req006.invalid', 'approved', now() + interval '1 day');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: CSR could insert an approved request'; end if;
  n := n + 1;
  ok := false; begin perform public.review_csr_password_reset(req.id, true);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: CSR could call the OPM review'; end if;
  n := n + 1;
  ok := false; begin perform public.create_csr_password_reset_link(req.id);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: CSR could generate their own reset link'; end if;
  n := n + 1;
  ok := false; begin perform reset_token_hash from public.csr_password_reset_requests where user_id = csr_a;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: CSR can read the token hash'; end if;
  if (select status from public.csr_password_reset_requests where user_id = csr_a) is distinct from 'pending' then
    raise exception 'REQ-006 FAIL: CSR cannot read their own request status';
  end if;
  n := n + 1;

  -- ── 10. OPM approves: 45-minute window ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', opm, 'role', 'authenticated')::text, true);
  perform public.review_csr_password_reset(req.id, true);
  reset role;
  select * into req from public.csr_password_reset_requests where id = req.id;
  if req.status <> 'approved' or req.expires_at not between now() + interval '44 minutes' and now() + interval '46 minutes' then
    raise exception 'REQ-006 FAIL: approval — %', req.status;
  end if;
  exp_before := req.expires_at;
  n := n + 1;

  -- ── 11. a non-OPM staff member (admin) cannot generate a reset link ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.create_csr_password_reset_link(req.id);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'REQ-006 FAIL: non-OPM generated a reset link'; end if;
  n := n + 1;

  -- ── 12. OPM generates a link; only the SHA-256 is stored; window not extended ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', opm, 'role', 'authenticated')::text, true);
  t1 := public.create_csr_password_reset_link(req.id);
  reset role;
  select * into req from public.csr_password_reset_requests where id = req.id;
  if t1 !~ '^[0-9a-f]{64}$' then raise exception 'REQ-006 FAIL: token format %', length(t1); end if;
  n := n + 1;
  if req.reset_token_hash <> encode(extensions.digest(t1, 'sha256'), 'hex')
     or to_jsonb(req)::text like '%' || t1 || '%' then
    raise exception 'REQ-006 FAIL: stored value is not just the token hash';
  end if;
  if req.expires_at <> exp_before or req.reset_token_created_at is null then
    raise exception 'REQ-006 FAIL: link generation changed the approval window';
  end if;
  n := n + 1;

  -- ── 13. a second link invalidates the first ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', opm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t2 := public.create_csr_password_reset_link(req.id);
  set local role service_role;
  select count(*) into cnt from public.claim_csr_password_reset(encode(extensions.digest(t1, 'sha256'), 'hex'));
  reset role;
  if t2 = t1 or cnt <> 0 or (select expires_at from public.csr_password_reset_requests where id = req.id) <> exp_before then
    raise exception 'REQ-006 FAIL: first link still valid after regeneration (claims %)', cnt;
  end if;
  n := n + 1;

  -- ── 14. valid token: atomic one-time claim (a second claim gets nothing) ──
  set local role service_role;
  select * into claimed from public.claim_csr_password_reset(encode(extensions.digest(t2, 'sha256'), 'hex'));
  select count(*) into cnt from public.claim_csr_password_reset(encode(extensions.digest(t2, 'sha256'), 'hex'));
  reset role;
  if claimed.request_id is distinct from req.id or claimed.target_user_id is distinct from csr_a or cnt <> 0 then
    raise exception 'REQ-006 FAIL: claim — % / second claim rows %', claimed, cnt;
  end if;
  n := n + 1;

  -- ── 15. while a link is being used, OPM cannot swap it out (reset_in_progress) ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', opm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.create_csr_password_reset_link(req.id);
  exception when others then ok := sqlerrm = 'reset_in_progress'; end;
  reset role;
  if not ok then raise exception 'REQ-006 FAIL: link replaced while a reset was in progress'; end if;
  n := n + 1;

  -- ── 16. Auth refused the password → release (needs the right hash) → claimable again ──
  set local role service_role;
  perform public.release_csr_password_reset_claim(req.id, encode(extensions.digest(t1, 'sha256'), 'hex'));   -- wrong hash: no effect
  select count(*) into cnt from public.claim_csr_password_reset(encode(extensions.digest(t2, 'sha256'), 'hex'));
  if cnt <> 0 then raise exception 'REQ-006 FAIL: release with a wrong hash freed the claim'; end if;
  perform public.release_csr_password_reset_claim(req.id, encode(extensions.digest(t2, 'sha256'), 'hex'));
  select * into claimed from public.claim_csr_password_reset(encode(extensions.digest(t2, 'sha256'), 'hex'));
  reset role;
  if claimed.request_id is distinct from req.id then raise exception 'REQ-006 FAIL: released link not claimable'; end if;
  n := n + 1;

  -- ── 17. password changed (Auth Admin API, replayed) → finish → completed.
  --        The CSR even has a leftover recovery session: the Admin API removes
  --        every session, so the recovery / magic-link guard lets it through. ──
  select encrypted_password into h_before from auth.users where id = csr_a;
  sess := pg_temp.req006_session(csr_a, 'recovery');
  res := pg_temp.req006_change_password(csr_a, null);
  if res <> 'ok' then raise exception 'REQ-006 FAIL: Copy Reset Link / Admin API change blocked — %', res; end if;
  n := n + 1;
  set local role service_role;
  perform public.finish_csr_password_reset(req.id, encode(extensions.digest(t2, 'sha256'), 'hex'));
  reset role;
  select encrypted_password into h_after from auth.users where id = csr_a;
  select * into req from public.csr_password_reset_requests where id = req.id;
  if h_after = h_before or req.status <> 'completed' or req.completed_at is null or req.reset_token_hash is not null then
    raise exception 'REQ-006 FAIL: completion — status % hash wiped %', req.status, req.reset_token_hash is null;
  end if;
  n := n + 1;

  -- ── 18. a used token cannot be reused (claim or finish) ──
  set local role service_role;
  select count(*) into cnt from public.claim_csr_password_reset(encode(extensions.digest(t2, 'sha256'), 'hex'));
  ok := false; begin perform public.finish_csr_password_reset(req.id, encode(extensions.digest(t2, 'sha256'), 'hex'));
  exception when others then ok := sqlerrm = 'reset_not_claimed'; end;
  reset role;
  if cnt <> 0 or not ok then raise exception 'REQ-006 FAIL: used token reusable'; end if;
  n := n + 1;

  -- ── 19. rejected (after approval + link): link revoked, no new link ──
  insert into public.csr_password_reset_requests (user_id, requested_email) values (csr_b, 'csr-b@req006.invalid') returning id into req_b;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', opm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.review_csr_password_reset(req_b, true);
  t3 := public.create_csr_password_reset_link(req_b);
  perform public.review_csr_password_reset(req_b, false);
  ok := false; begin perform public.create_csr_password_reset_link(req_b);
  exception when others then ok := sqlerrm = 'request_not_approved'; end;
  set local role service_role;
  select count(*) into cnt from public.claim_csr_password_reset(encode(extensions.digest(t3, 'sha256'), 'hex'));
  reset role;
  if not ok or cnt <> 0 or (select status <> 'rejected' or reset_token_hash is not null from public.csr_password_reset_requests where id = req_b) then
    raise exception 'REQ-006 FAIL: rejected request still usable';
  end if;
  n := n + 1;

  -- ── 20. expired approval: link unusable, no new link, expiry wipes the hash ──
  insert into public.csr_password_reset_requests (user_id, requested_email, status, reviewed_by, reviewed_at, expires_at, requested_at,
                                                  reset_token_hash, reset_token_created_at)
  values (csr_c, 'csr-c@req006.invalid', 'approved', opm, now() - interval '50 minutes', now() - interval '5 minutes',
          now() - interval '1 hour', encode(extensions.digest(t4, 'sha256'), 'hex'), now() - interval '30 minutes')
  returning id into req_c;
  set local role service_role;
  select count(*) into cnt from public.claim_csr_password_reset(encode(extensions.digest(t4, 'sha256'), 'hex'));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', opm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.create_csr_password_reset_link(req_c);
  exception when others then ok := sqlerrm = 'request_expired'; end;
  reset role;
  if cnt <> 0 or not ok then raise exception 'REQ-006 FAIL: expired request usable (claims %)', cnt; end if;
  perform public.request_csr_password_reset('csr-c@req006.invalid');
  if (select status <> 'expired' or reset_token_hash is not null from public.csr_password_reset_requests where id = req_c) then
    raise exception 'REQ-006 FAIL: expiry did not wipe the token';
  end if;
  n := n + 1;

  -- ── 21. a removed CSR cannot reset, even with a live link ──
  insert into public.csr_password_reset_requests (user_id, requested_email, status, reviewed_by, reviewed_at, expires_at,
                                                  reset_token_hash, reset_token_created_at)
  values (csr_d, 'csr-d@req006.invalid', 'approved', opm, now(), now() + interval '45 minutes',
          encode(extensions.digest(t5, 'sha256'), 'hex'), now())
  returning id into req_d;
  update public.profiles set status = 'removed' where id = csr_d;
  set local role service_role;
  select count(*) into cnt from public.claim_csr_password_reset(encode(extensions.digest(t5, 'sha256'), 'hex'));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', opm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.create_csr_password_reset_link(req_d);
  exception when others then ok := sqlerrm = 'member_not_eligible'; end;
  reset role;
  if cnt <> 0 or not ok then raise exception 'REQ-006 FAIL: removed CSR could reset'; end if;
  n := n + 1;

  -- ── 22. wrong / random / malformed tokens fail without detail ──
  set local role service_role;
  select count(*) into cnt from (
    select * from public.claim_csr_password_reset(encode(extensions.digest(encode(extensions.gen_random_bytes(32), 'hex'), 'sha256'), 'hex'))
    union all select * from public.claim_csr_password_reset('not-a-hash')
    union all select * from public.claim_csr_password_reset(null)
    union all select * from public.claim_csr_password_reset(t5)) x;   -- the raw token itself is not a valid key
  reset role;
  if cnt <> 0 then raise exception 'REQ-006 FAIL: a wrong token claimed something'; end if;
  n := n + 1;

  -- ── 23. activity log: all safe events present; no token, hash or password ──
  select count(distinct type) into cnt from public.activity_log
   where member_email like '%@req006.invalid'
     and type in ('password_reset_requested', 'password_reset_approved', 'password_reset_link_generated',
                  'password_reset_rejected', 'password_changed');
  if cnt <> 5 then raise exception 'REQ-006 FAIL: expected 5 event types, found %', cnt; end if;
  if exists (select 1 from public.activity_log l where l.member_email like '%@req006.invalid'
             and (select bool_or(to_jsonb(l)::text like '%' || s || '%')
                    from unnest(array[t1, t2, t3, t4, t5,
                                      encode(extensions.digest(t1, 'sha256'), 'hex'), encode(extensions.digest(t2, 'sha256'), 'hex'),
                                      encode(extensions.digest(t3, 'sha256'), 'hex'), h_after, '$2a$']) s)) then
    raise exception 'REQ-006 FAIL: activity log contains a token, hash or password hash';
  end if;
  n := n + 1;

  -- ── 24. the narrow guard is installed: deferred trigger on recovery_token only,
  --        and its function no longer consults approvals ──
  if not exists (select 1 from pg_trigger t
                 where t.tgrelid = 'auth.users'::regclass and t.tgname = 'enforce_csr_password_reset_at_commit'
                   and t.tgdeferrable and t.tginitdeferred
                   and (select array_agg(a.attname::text) from pg_attribute a
                         where a.attrelid = t.tgrelid and a.attnum = any(t.tgattr)) = array['recovery_token'])
     or (select prosrc from pg_proc where oid = 'public.enforce_csr_password_reset()'::regprocedure)
          not like '%csr_password_reset_requires_opm_link%'
     or (select prosrc from pg_proc where oid = 'public.enforce_csr_password_reset()'::regprocedure)
          like '%csr_password_reset_requests%' then
    raise exception 'REQ-006 FAIL: recovery / magic-link guard not installed as expected';
  end if;
  n := n + 1;

  -- ── 25. active CSR: password change from a Supabase recovery session is blocked
  --        (both the 'recovery' and the 'otp' form of a reset-email sign-in) ──
  select encrypted_password into h_before from auth.users where id = csr_b;
  sess := pg_temp.req006_session(csr_b, 'recovery');
  res := pg_temp.req006_change_password(csr_b, sess);
  if res not like '42501%csr_password_reset_requires_opm_link%' then raise exception 'REQ-006 FAIL: recovery-session change allowed — %', res; end if;
  delete from auth.sessions where user_id = csr_b;
  sess := pg_temp.req006_session(csr_b, 'otp');
  res := pg_temp.req006_change_password(csr_b, sess);
  if res not like '42501%csr_password_reset_requires_opm_link%' then raise exception 'REQ-006 FAIL: otp-session change allowed — %', res; end if;
  if (select encrypted_password from auth.users where id = csr_b) <> h_before then
    raise exception 'REQ-006 FAIL: blocked change still altered the password';
  end if;
  n := n + 1;

  -- ── 26. active CSR: password change from a magic-link session is blocked ──
  delete from auth.sessions where user_id = csr_b;
  sess := pg_temp.req006_session(csr_b, 'magiclink');
  res := pg_temp.req006_change_password(csr_b, sess);
  if res not like '42501%csr_password_reset_requires_opm_link%' then raise exception 'REQ-006 FAIL: magic-link change allowed — %', res; end if;
  n := n + 1;

  -- ── 27. CSR signed in with their current password changes it: allowed
  --        (Auth deletes the other sessions, incl. the leftover magic-link one) ──
  sess := pg_temp.req006_session(csr_b, 'password');
  res := pg_temp.req006_change_password(csr_b, sess);
  if res <> 'ok' then raise exception 'REQ-006 FAIL: password-session change blocked — %', res; end if;
  n := n + 1;

  -- ── 28. OPM / admin / service-role Admin API password set: allowed, even while
  --        the CSR has a recovery session; also an ordinary direct SQL update ──
  sess := pg_temp.req006_session(csr_b, 'recovery');
  res := pg_temp.req006_change_password(csr_b, null);
  if res <> 'ok' then raise exception 'REQ-006 FAIL: Admin API change blocked — %', res; end if;
  update auth.users
     set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
         recovery_token = '', reauthentication_token = '', updated_at = now()
   where id in (csr_b, opm, adm);
  get diagnostics cnt = row_count;
  set constraints all immediate;
  if cnt <> 3 then raise exception 'REQ-006 FAIL: ordinary password update blocked'; end if;
  n := n + 1;

  -- ── 29. non-CSR recovery is unaffected: OPM, admin, removed CSR, driver login ──
  foreach sess in array array[opm, adm, csr_d, drv] loop
    res := pg_temp.req006_change_password(sess, pg_temp.req006_session(sess, 'recovery'));
    if res <> 'ok' then raise exception 'REQ-006 FAIL: non-CSR recovery blocked for % — %', sess, res; end if;
  end loop;
  res := pg_temp.req006_change_password(drv, pg_temp.req006_session(drv, 'magiclink'));
  if res <> 'ok' then raise exception 'REQ-006 FAIL: driver magic-link change blocked — %', res; end if;
  n := n + 1;

  -- ── 30. sign-in re-encryption and Recover() token clean-up are not blocked,
  --        even with a recovery session present ──
  delete from auth.sessions where user_id = csr_b;
  sess := pg_temp.req006_session(csr_b, 'recovery');
  set constraints all deferred;
  ok := true; begin
    update auth.users set encrypted_password = extensions.crypt('same-pass', extensions.gen_salt('bf')), updated_at = now() where id = csr_b;
    update auth.users set recovery_token = '', recovery_sent_at = now(), updated_at = now() where id = csr_b;
    set constraints all immediate;
  exception when others then ok := false; res := sqlerrm; end;
  if not ok then raise exception 'REQ-006 FAIL: sign-in / token maintenance blocked — %', res; end if;
  n := n + 1;

  raise exception 'REQ-006 TESTS PASSED (% checks) — rolled back on purpose, nothing was saved', n;
end
$test$;
rollback;
