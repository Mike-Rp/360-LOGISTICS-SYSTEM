-- Trigger functions are only ever fired by their triggers. EXECUTE is checked when a
-- trigger is CREATED, not each time it fires, so nobody needs the privilege at runtime.
-- The security advisor flagged them as callable through /rest/v1/rpc/...; close that.
revoke execute on function
  public.guard_assignment_update(),
  public.guard_document_write(),
  public.stamp_activity(),
  public.drop_driver_login()
from public, anon, authenticated;
