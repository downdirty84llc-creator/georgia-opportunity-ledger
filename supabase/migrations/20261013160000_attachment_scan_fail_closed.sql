-- An absent scanner is not evidence that bytes are safe. Keep staff metadata
-- visible for remediation; neither the signed-URL API nor Storage serves bytes
-- until a positive verdict exists. Existing skipped files enter the retry queue.
update public.attachments
set scan_status = 'pending', scan_attempts = 0,
    scan_detail = 'Awaiting a configured scanner; previous scan was skipped.'
where scan_status = 'skipped';

comment on column public.attachments.scan_status is
  'Only clean permits member reads. Missing, skipped, failed and infected scans are withheld.';

drop policy if exists attachments_read on public.attachments;

create policy attachments_read on public.attachments
  for select using (
    public.is_staff()
    or (
      scan_status = 'clean'
      and public.account_is_active()
      and public.my_access_rank() >= minimum_access_rank
      and (
        opportunity_id is null
        or exists (
          select 1 from public.opportunities o
          where o.id = attachments.opportunity_id
            and public.can_view_opportunity(o.workflow_status, o.is_restricted,
                                            o.minimum_access_rank)
        )
      )
      and (
        report_id is null
        or exists (
          select 1 from public.reports r
          where r.id = attachments.report_id
            and r.status = 'published'
            and public.my_access_rank() >= r.minimum_access_rank
        )
      )
    )
  );

notify pgrst, 'reload schema';
