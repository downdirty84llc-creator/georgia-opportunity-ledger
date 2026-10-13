-- Keep the trigger's flags consistent with the lifecycle worker, including
-- administrator-controlled closed/withdrawn states.
create or replace function public.maintain_opportunity_lifecycle()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  -- Derived deadline flags. The daily job recomputes these across the table so
  -- that the passage of time alone flips them; this trigger keeps a row honest
  -- the moment it is written.
  if new.closing_date is null then
    new.is_closing_soon := false;
    new.is_expired := false;
  else
    new.is_expired := new.closing_date < now();
    new.is_closing_soon :=
      not new.is_expired
      and new.closing_date <= now() + public.closing_soon_window();
  end if;

  -- An information-only record has no deadline semantics.
  if new.status in ('information_only','withdrawn','under_review','closed') then
    new.is_closing_soon := false;
  end if;

  new.reverification_due_at :=
    (new.date_verified::timestamptz) + public.reverification_interval();

  -- Publishing stamps the record; unpublishing clears the stamp so the
  -- "published" invariant in the table constraint stays true.
  if tg_op = 'UPDATE' then
    if new.workflow_status = 'published' and old.workflow_status <> 'published'
       and new.published_at is null then
      new.published_at := now();
      new.published_by := coalesce(new.published_by, auth.uid());
    end if;
  elsif tg_op = 'INSERT' then
    if new.workflow_status = 'published' and new.published_at is null then
      new.published_at := now();
      new.published_by := coalesce(new.published_by, auth.uid());
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.maintain_opportunity_lifecycle() from public,anon,authenticated;
grant execute on function public.maintain_opportunity_lifecycle() to service_role;

-- Aggregate in SQL so PostgREST's row cap cannot silently undercount traffic.
create index if not exists analytics_events_occurred_idx on public.analytics_events(occurred_at);
create function public.aggregate_analytics_window(p_start timestamptz,p_end timestamptz)
returns jsonb language sql stable security definer set search_path=public,extensions as $$
 with counts as (
  select e.event_name,count(*) as total from public.analytics_events e
  left join public.profiles p on p.id=e.user_id
  where e.occurred_at>=p_start and e.occurred_at<p_end and not coalesce(p.is_sample,false)
  group by e.event_name
 )
 select jsonb_build_object('total',coalesce(sum(total),0),'counts',coalesce(jsonb_object_agg(event_name,total),'{}'::jsonb)) from counts;
$$;
revoke all on function public.aggregate_analytics_window(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.aggregate_analytics_window(timestamptz,timestamptz) to service_role;
notify pgrst,'reload schema';
