-- A factual digest of already verified records. No new verification, analysis,
-- staff approval or changed access rank is invented by this automation.
create function public.publish_automated_weekly_digest(p_preview boolean default false)
returns jsonb
language plpgsql security invoker
set search_path = public, pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_today date := timezone('UTC', v_now)::date;
  v_end date;
  v_start date;
  v_ids uuid[];
  v_count integer;
  v_market record;
  v_title text;
  v_summary text;
  v_commentary text;
  v_report public.reports;
begin
  -- Last complete Thursday-Wednesday reporting period, also on manual retries.
  v_end := v_today - (((extract(dow from v_today)::integer + 3) % 7) + 1);
  v_start := v_end - 6;
  perform pg_advisory_xact_lock(hashtextextended('ledger-weekly-digest:' || v_end::text, 0));
  if not p_preview then
    select * into v_report from public.reports
      where report_type='weekly' and not is_sample
        and reporting_period_start=v_start and reporting_period_end=v_end
        and status in ('draft','scheduled','published')
      order by created_at limit 1;
    if found then
      return jsonb_build_object('created',false,'reason','existing_weekly_report','id',v_report.id,'slug',v_report.slug);
    end if;
  end if;

  select array_agg(q.id order by q.date_verified desc,q.id) into v_ids from (
    select o.id,o.date_verified from public.opportunities o
      join public.sources s on s.id=o.source_id and s.is_active
    where o.workflow_status='published' and o.published_at<=v_now
      and o.verification_status='verified' and not o.is_sample and not o.is_restricted
      and not o.is_expired and o.status in ('open','upcoming')
      and (o.closing_date is null or o.closing_date>v_now)
      and o.date_verified between v_today-30 and v_today
      and (o.reverification_due_at is null or o.reverification_due_at>v_now)
    order by o.date_verified desc,o.id limit 60 for share of o
  ) q;
  v_count := coalesce(cardinality(v_ids),0);
  -- This exact attributed BLS series is available at Weekly rank. Never copy
  -- restricted market data into a lower-rank report.
  select m.value,m.reporting_period_end,m.interpretation into v_market
    from public.market_indicator_values m join public.market_indicators i on i.id=m.indicator_id
    join public.sources s on s.id=i.source_id and s.is_active and s.automation_allowed
    where i.slug='georgia-construction-employment' and i.is_active
      and i.minimum_access_rank<=10 and i.unit='thousands of jobs' and i.geographic_scope='Georgia'
      and not m.is_sample and m.verified_at between v_now-interval '48 hours' and v_now
      and m.reporting_period_end between v_today-120 and v_today
      and m.source_url='https://data.bls.gov/timeseries/SMS13000002000000001'
    order by m.reporting_period_end desc limit 1;
  if v_count=0 and v_market.value is null then
    return jsonb_build_object('created',false,'reason','no_current_verified_content');
  end if;
  v_title := 'Georgia weekly source digest — ' || v_end::text;
  v_summary := format('Automatically compiled source digest for %s through %s. This snapshot contains %s currently published opportunities with verification within the last 30 days. Each record retains its original verification date and plan access limits. This digest does not add new editorial analysis.',v_start,v_end,v_count);
  if v_market.value is null then
    v_commentary := 'No recently retrieved BLS observation was available for this digest. Check the market dashboard for the latest source-linked data.';
  else
    v_commentary := format('U.S. Bureau of Labor Statistics: Georgia construction payroll employment, seasonally adjusted, was %s thousand jobs for the month ending %s. Source: https://data.bls.gov/timeseries/SMS13000002000000001. Values may be revised.%s',
      v_market.value,v_market.reporting_period_end,
      case when v_market.interpretation like '%Preliminary estimate.%' then ' Preliminary estimate.' else '' end);
  end if;
  if p_preview then
    return jsonb_build_object('preview',true,'title',v_title,'period_start',v_start,'period_end',v_end,
      'executive_summary',v_summary,'market_commentary',v_commentary,'opportunities',v_count,'email_distribution_enabled',true);
  end if;
  -- Report and composition become visible together or not at all.
  insert into public.reports(title,slug,report_type,reporting_period_start,reporting_period_end,
    executive_summary,market_commentary,minimum_access_rank,status,published_at,is_sample,email_distribution_enabled)
  values(v_title,'weekly-source-digest-'||v_end::text,'weekly',v_start,v_end,
    to_jsonb(v_summary),to_jsonb(v_commentary),10,'published',v_now,false,true)
  returning * into v_report;
  insert into public.report_opportunities(report_id,opportunity_id,display_order,minimum_access_rank,editor_commentary)
    select v_report.id,o.id,(row_number() over(order by o.date_verified desc,o.id))::integer,
      greatest(10,o.minimum_access_rank),'Original Ledger verification date: '||o.date_verified::text||'. Follow the source link for current terms.'
    from public.opportunities o where o.id=any(v_ids);
  return jsonb_build_object('created',true,'id',v_report.id,'slug',v_report.slug,'opportunities',v_count,'email_distribution_enabled',true);
end;
$$;
revoke all on function public.publish_automated_weekly_digest(boolean) from public,anon,authenticated;
grant execute on function public.publish_automated_weekly_digest(boolean) to service_role;
