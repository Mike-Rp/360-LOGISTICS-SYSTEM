-- Staff who can write data may also delete uploaded media (e.g. clean up after a reset).
-- Drivers can upload but never delete.
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'make-ee4d169c-media' and public.can_write());
