-- ════════════════════════════════════════════════════════════════════════════
-- CSR reset password-reuse check — database tests
-- (run AFTER 20261026000003_csr_reset_password_reuse.sql).
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "REUSE TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "REUSE FAIL: …"                                            → what broke
-- Throwaway users only (@reuse-test.invalid). Run the whole file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $test$
declare
  n      int := 0;
  csr_u  uuid := gen_random_uuid();
  opm_u  uuid := gen_random_uuid();
  pw     text := 'Same-Passw0rd';
  tok    text := encode(extensions.gen_random_bytes(32), 'hex');
  h      text;
  req    uuid;
  hash_before text;
  row_before  jsonb;
  ok     boolean;
  err    text;
begin
  h := encode(extensions.digest(tok, 'sha256'), 'hex');

  -- ── setup: a CSR whose current password is pw, and an approved request claimed with h ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (csr_u, 'authenticated', 'authenticated', 'csr@reuse-test.invalid', extensions.crypt(pw, extensions.gen_salt('bf')), now(), now(), now()),
         (opm_u, 'authenticated', 'authenticated', 'opm@reuse-test.invalid', extensions.crypt('x-' || pw, extensions.gen_salt('bf')), now(), now(), now());
  insert into public.csr_password_reset_requests
    (user_id, requested_email, status, reviewed_by, reviewed_at, expires_at, reset_token_hash, reset_token_created_at, reset_token_claimed_at)
  values (csr_u, 'csr@reuse-test.invalid', 'approved', opm_u, now(), now() + interval '30 minutes', h, now(), now())
  returning id into req;
  select encrypted_password into hash_before from auth.users where id = csr_u;
  select to_jsonb(r) into row_before from public.csr_password_reset_requests r where id = req;

  -- ── 1. only service_role may call it ──
  if has_function_privilege('anon', 'public.csr_password_reset_password_matches(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.csr_password_reset_password_matches(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.csr_password_reset_password_matches(uuid,text,text)', 'EXECUTE') then
    raise exception 'REUSE FAIL: wrong execute privileges';
  end if;
  n := n + 1;

  -- ── 2. as the Edge Function (service_role): current password → true, a different one → false ──
  set local role service_role;
  if public.csr_password_reset_password_matches(req, h, pw) is distinct from true then
    raise exception 'REUSE FAIL: the current password was not recognised';
  end if;
  if public.csr_password_reset_password_matches(req, h, 'Different-Passw0rd') is distinct from false
     or public.csr_password_reset_password_matches(req, h, upper(pw)) is distinct from false then
    raise exception 'REUSE FAIL: a different password was reported as the same';
  end if;
  reset role;
  n := n + 1;

  -- ── 3. wrong token hash or unknown request → refused, no answer about the password ──
  err := null; begin perform public.csr_password_reset_password_matches(req, repeat('0', 64), pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'reset_not_claimed' then raise exception 'REUSE FAIL: wrong hash gave %', coalesce(err, 'an answer'); end if;
  err := null; begin perform public.csr_password_reset_password_matches(gen_random_uuid(), h, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'reset_not_claimed' then raise exception 'REUSE FAIL: unknown request gave %', coalesce(err, 'an answer'); end if;
  n := n + 1;

  -- ── 4. a request that is not claimed, or expired → refused ──
  update public.csr_password_reset_requests set reset_token_claimed_at = null where id = req;
  err := null; begin perform public.csr_password_reset_password_matches(req, h, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'reset_not_claimed' then raise exception 'REUSE FAIL: unclaimed request gave %', coalesce(err, 'an answer'); end if;
  update public.csr_password_reset_requests set reset_token_claimed_at = now(), expires_at = now() - interval '1 minute' where id = req;
  err := null; begin perform public.csr_password_reset_password_matches(req, h, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'reset_not_claimed' then raise exception 'REUSE FAIL: expired request gave %', coalesce(err, 'an answer'); end if;
  -- (a rejected/completed request cannot hold a token at all: csr_password_reset_token_only_when_approved)
  n := n + 1;

  -- ── 5. checking changes nothing: same password hash, request row as it was ──
  update public.csr_password_reset_requests r set
    expires_at = (row_before ->> 'expires_at')::timestamptz,
    reset_token_claimed_at = (row_before ->> 'reset_token_claimed_at')::timestamptz
  where r.id = req;
  set local role service_role;
  perform public.csr_password_reset_password_matches(req, h, pw);
  perform public.csr_password_reset_password_matches(req, h, 'Different-Passw0rd');
  reset role;
  if (select encrypted_password from auth.users where id = csr_u) is distinct from hash_before
     or (select to_jsonb(r) from public.csr_password_reset_requests r where id = req) is distinct from row_before then
    raise exception 'REUSE FAIL: the check changed the password or the request';
  end if;
  n := n + 1;

  raise exception 'REUSE TESTS PASSED (% checks) — rolled back on purpose, nothing was saved', n;
end
$test$;
rollback;
