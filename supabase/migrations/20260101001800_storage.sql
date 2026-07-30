-- ---------------------------------------------------------------------------
-- 0018 — Storage buckets and object policies (spec 3.2, 20)
--
-- All three buckets are private. Downloads are served through signed URLs
-- minted by the API after it has re-checked the caller's access rank, so a
-- leaked path is not a leaked file.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('reports', 'reports', false, 26214400,
   array['application/pdf']),
  ('attachments', 'attachments', false, 26214400,
   array['application/pdf', 'text/csv',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'image/png', 'image/jpeg', 'image/webp']),
  ('exports', 'exports', false, 104857600,
   array['text/csv',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- Staff may manage report and attachment objects directly.
create policy "staff manage report objects"
  on storage.objects for all
  using (
    bucket_id = 'reports'
    and public.has_role('editor', 'super_administrator')
  )
  with check (
    bucket_id = 'reports'
    and public.has_role('editor', 'super_administrator')
  );

create policy "staff manage attachment objects"
  on storage.objects for all
  using (
    bucket_id = 'attachments'
    and public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  )
  with check (
    bucket_id = 'attachments'
    and public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  );

-- Exports are laid down by the service-role worker under a per-user prefix.
-- Members may read only their own prefix, and only while their account is
-- active — a suspended account loses export access (spec 9).
create policy "members read own exports"
  on storage.objects for select
  using (
    bucket_id = 'exports'
    and public.account_is_active()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
