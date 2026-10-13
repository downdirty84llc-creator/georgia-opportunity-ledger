-- Durable export preparation: retries upload the same bytes to a job-unique
-- object. A lease token fences all completion writes after worker termination.
alter table public.export_jobs
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column attempts integer not null default 0,
  add column prepared_csv text,
  add column prepared_access_rank integer,
  add column truncated boolean not null default false;

create function public.claim_export_job(p_id uuid)
returns public.export_jobs language plpgsql security definer
set search_path = public, extensions as $$
declare j public.export_jobs;
begin
  select * into j from public.export_jobs where id = p_id for update;
  if not found or j.status not in ('queued','processing') or
    (j.status = 'processing' and j.lease_until > clock_timestamp()) then return null; end if;
  if j.expires_at <= clock_timestamp() or j.attempts >= 5 or
     public.effective_access_rank(j.user_id) < greatest(30,coalesce(j.prepared_access_rank,30)) or
     not exists(select 1 from public.profiles where id=j.user_id and account_status='active') then
    update public.export_jobs set status='failed', error_message='Export expired, exhausted retries, or access changed.' where id=p_id;
    return null;
  end if;
  update public.export_jobs set status='processing', lease_token=extensions.gen_random_uuid(),
    lease_until=clock_timestamp()+interval '2 minutes', attempts=attempts+1,
    file_path=user_id::text || '/' || id::text || '.csv', error_message=null
    where id=p_id returning * into j;
  return j;
end $$;

create function public.export_opportunity_data(p_id uuid, p_token uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions set statement_timeout = '15s' as $$
declare j public.export_jobs; f jsonb; access_rank integer; result jsonb;
begin
  select * into j from public.export_jobs where id=p_id and lease_token=p_token
    and status='processing' and lease_until > clock_timestamp();
  if not found then raise exception 'Export claim no longer active'; end if;
  access_rank := public.effective_access_rank(j.user_id);
  if access_rank < 30 or not exists(select 1 from public.profiles where id=j.user_id and account_status='active') then
    raise exception 'Export access is no longer available';
  end if;
  f := j.filter_configuration;
  with selected as (
    select o.*, c.name as county_name, ci.name as city_name,
      case f->>'sort'
        when 'alphabetical' then lower(o.title)
        when 'closing_soon' then coalesce(to_char(o.closing_date at time zone 'UTC','YYYYMMDDHH24MISS'),'99999999999999')
        when 'newest' then to_char(o.published_at at time zone 'UTC','YYYYMMDDHH24MISS')
        when 'recently_updated' then to_char(o.updated_at at time zone 'UTC','YYYYMMDDHH24MISS')
        when 'value_desc' then lpad(coalesce(round(o.estimated_value_max),0)::text,16,'0')
        when 'capital_asc' then lpad(coalesce(round(o.capital_required_min),999999999999)::text,16,'0')
        else lpad(o.score::text,3,'0') end as sort_key
    from public.opportunities o
    left join public.counties c on c.id=o.county_id
    left join public.cities ci on ci.id=o.city_id
    left join public.property_details pd on pd.opportunity_id=o.id
    left join public.funding_details fd on fd.opportunity_id=o.id
    where o.workflow_status='published' and not o.is_restricted and o.published_at<=now()
      and o.minimum_access_rank<=access_rank
      and (case when j.opportunity_ids is not null then o.id=any(j.opportunity_ids) else (
        (coalesce((f->>'includeExpired')::boolean,false) or not o.is_expired)
        and (coalesce(f->>'q','')='' or o.search_vector @@ websearch_to_tsquery('english',f->>'q'))
        and (not f ? 'category' or jsonb_array_length(f->'category')=0 or o.category::text in (select jsonb_array_elements_text(f->'category')))
        and (not f ? 'status' or jsonb_array_length(f->'status')=0 or o.status::text in (select jsonb_array_elements_text(f->'status')))
        and (not f ? 'subtype' or o.subtype ilike '%' || (f->>'subtype') || '%')
        and (not f ? 'stateId' or o.state_id=(f->>'stateId')::uuid)
        and (not f ? 'countySlug' or c.slug=f->>'countySlug')
        and (not f ? 'countyIds' or jsonb_array_length(f->'countyIds')=0 or o.county_id::text in (select jsonb_array_elements_text(f->'countyIds')))
        and (not f ? 'cityIds' or jsonb_array_length(f->'cityIds')=0 or o.city_id::text in (select jsonb_array_elements_text(f->'cityIds')))
        and (not f ? 'propertyTypes' or jsonb_array_length(f->'propertyTypes')=0 or pd.property_type::text in (select jsonb_array_elements_text(f->'propertyTypes')))
        and (not f ? 'fundingTypes' or jsonb_array_length(f->'fundingTypes')=0 or fd.funding_type::text in (select jsonb_array_elements_text(f->'fundingTypes')))
        and (not f ? 'verificationStatus' or jsonb_array_length(f->'verificationStatus')=0 or o.verification_status::text in (select jsonb_array_elements_text(f->'verificationStatus')))
        and (not f ? 'minScore' or o.score >= (f->>'minScore')::numeric)
        and (not f ? 'capitalMin' or o.capital_required_min is null or o.capital_required_min >= (f->>'capitalMin')::numeric)
        and (not f ? 'capitalMax' or o.capital_required_min is null or o.capital_required_min <= (f->>'capitalMax')::numeric)
        and (not f ? 'deadlineFrom' or o.closing_date >= (f->>'deadlineFrom')::timestamptz)
        and (not f ? 'deadlineTo' or o.closing_date <= (f->>'deadlineTo')::timestamptz)
        and (not f ? 'addedSince' or o.published_at >= (f->>'addedSince')::timestamptz)
        and (not coalesce((f->>'closingSoon')::boolean,false) or o.is_closing_soon)
        and (not coalesce((f->>'featured')::boolean,false) or o.is_featured)
        and (not coalesce((f->>'recentlyUpdated')::boolean,false) or o.updated_at >= now()-interval '7 days')
        and (not f ? 'industryIds' or jsonb_array_length(f->'industryIds')=0
          or o.industry_id::text in (select jsonb_array_elements_text(f->'industryIds'))
          or exists(select 1 from public.opportunity_industries oi where oi.opportunity_id=o.id
            and oi.industry_id::text in (select jsonb_array_elements_text(f->'industryIds'))))
      ) end)
  ), numbered as (
    select selected.*, row_number() over(order by
      case when f->>'sort' in ('alphabetical','score_asc','closing_soon','capital_asc') then sort_key end asc,
      case when coalesce(f->>'sort','score_desc') not in ('alphabetical','score_asc','closing_soon','capital_asc') then sort_key end desc,
      id) as position from selected
    order by position limit 5001
  )
  select jsonb_build_object('accessRank',access_rank,'truncated',count(*)>5000,
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'title',title,'slug',slug,'category',category,'subtype',subtype,'status',status,
      'score',score,'score_classification',score_classification,'summary',summary,
      'county_name',county_name,'city_name',city_name,'street_address',street_address,
      'estimated_value_min',estimated_value_min,'estimated_value_max',estimated_value_max,
      'capital_required_min',capital_required_min,'capital_required_max',capital_required_max,
      'closing_date',closing_date,'date_verified',date_verified,'verification_status',verification_status,
      'original_source_url',original_source_url,'recommended_next_action',recommended_next_action,'is_sample',is_sample
    ) order by position) filter(where position<=5000),'[]'::jsonb)) into result from numbered;
  return result;
end $$;

create function public.finish_export_job(p_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin
  update public.export_jobs set status='ready',completed_at=clock_timestamp(),lease_until=null,prepared_csv=null
  where id=p_id and lease_token=p_token and status='processing' and prepared_csv is not null
    and lease_until>clock_timestamp() and expires_at>clock_timestamp()
    and public.effective_access_rank(user_id)>=greatest(30,prepared_access_rank)
    and exists(select 1 from public.profiles p where p.id=user_id and p.account_status='active');
  return found;
end $$;

revoke all on function public.claim_export_job(uuid), public.export_opportunity_data(uuid,uuid), public.finish_export_job(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.claim_export_job(uuid), public.export_opportunity_data(uuid,uuid), public.finish_export_job(uuid,uuid)
  to service_role;

-- Private objects remain inaccessible until completion, and after expiry or
-- downgrade, even if a member remembers their Storage path.
drop policy "members read own exports" on storage.objects;
create policy "members read own exports" on storage.objects for select using (
  bucket_id='exports' and public.account_is_active() and public.my_access_rank()>=30
  and exists(select 1 from public.export_jobs j where j.file_path=storage.objects.name
    and j.user_id=auth.uid() and j.status='ready' and j.expires_at>now()
    and public.my_access_rank()>=coalesce(j.prepared_access_rank,30))
);
drop policy export_jobs_own on public.export_jobs;
create policy export_jobs_own on public.export_jobs for select using (
  user_id=auth.uid() and public.account_is_active() and public.my_access_rank()>=greatest(30,coalesce(prepared_access_rank,30))
);
create index export_jobs_file_path_idx on public.export_jobs(file_path) where file_path is not null;
notify pgrst,'reload schema';
