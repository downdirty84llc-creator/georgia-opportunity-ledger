-- Recovered from the live database (project bbgikfblcahhvrpxiqnd), applied
-- 2026-08-14 and never committed. Reproduced verbatim from the statement
-- Supabase recorded in supabase_migrations.schema_migrations.
--
-- Closes the gap between the attachments row and the storage object. The
-- application withholds an unscanned attachment, but the object itself lived
-- under a broader storage policy — so the row was hidden while the bytes were
-- still reachable by anyone who knew the path. This ties object reads to the
-- scan status of the row that owns them.

create index if not exists attachments_file_path_idx
  on public.attachments (file_path);

drop policy if exists "members read servable attachment objects"
  on storage.objects;

create policy "members read servable attachment objects"
  on storage.objects for select
  using (
    bucket_id = 'attachments'
    and public.account_is_active()
    and exists (
      select 1
      from public.attachments a
      where a.file_path = storage.objects.name
        and a.scan_status = 'clean'
    )
  );
