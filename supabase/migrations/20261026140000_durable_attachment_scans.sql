-- Optional asynchronous scanner state. No provider credentials or signed upload
-- targets are stored here, and no existing attachment is made readable.
create table public.attachment_scan_jobs (
  attachment_id uuid primary key references public.attachments(id) on delete cascade,
  file_path text not null,
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  file_size bigint not null check (file_size between 1 and 26214400),
  phase text not null default 'ready' check (phase in ('ready','requesting','polling','quarantined','complete','review')),
  provider_scan_id text unique check (provider_scan_id ~ '^scan_[A-Za-z0-9_-]{1,100}$'),
  lease_id uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((lease_id is null) = (lease_until is null)),
  check (phase not in ('polling','quarantined','complete') or provider_scan_id is not null)
);
alter table public.attachment_scan_jobs enable row level security;
revoke all on public.attachment_scan_jobs from public, anon, authenticated;
grant all on public.attachment_scan_jobs to service_role;
create index attachment_scan_jobs_pending_idx on public.attachment_scan_jobs(next_attempt_at)
  where phase not in ('complete','review');

create function public.pending_attachment_scans()
returns table(attachment_id uuid) language sql security invoker set search_path=''
as $$
  select a.id from public.attachments a
  left join public.attachment_scan_jobs j on j.attachment_id=a.id
  where (j.attachment_id is null and a.scan_status in ('pending','failed','scanning')
      and a.checksum ~ '^[a-f0-9]{64}$' and a.file_size between 1 and 26214400)
    or (j.phase not in ('complete','review') and j.next_attempt_at <= now()
      and (j.lease_until is null or j.lease_until <= now()))
  order by coalesce(j.next_attempt_at,a.uploaded_at),a.id limit 25;
$$;

create function public.claim_attachment_scan(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare a public.attachments; j public.attachment_scan_jobs; fresh boolean;
begin
  if p_lease is null then raise exception 'Missing scan lease'; end if;
  select * into a from public.attachments where id=p_id for update;
  if not found then return null; end if;
  insert into public.attachment_scan_jobs(attachment_id,file_path,checksum,file_size)
    select a.id,a.file_path,a.checksum,a.file_size
    where a.scan_status in ('pending','failed','scanning')
      and a.checksum ~ '^[a-f0-9]{64}$' and a.file_size between 1 and 26214400
    on conflict(attachment_id) do nothing;
  select * into j from public.attachment_scan_jobs where attachment_id=p_id for update;
  if not found or j.phase in ('complete','review') or j.next_attempt_at>now()
     or j.lease_until>now() then return null; end if;
  if a.file_path is distinct from j.file_path or a.checksum is distinct from j.checksum
     or a.file_size is distinct from j.file_size then
    update public.attachment_scan_jobs set phase='review',lease_id=null,lease_until=null where attachment_id=p_id;
    update public.attachments set scan_status='failed',scan_detail='Attachment changed after scanner submission; operator review required.' where id=p_id;
    return null;
  end if;
  fresh := j.phase='ready';
  update public.attachment_scan_jobs set
    lease_id=p_lease,lease_until=now()+interval '2 minutes'
    where attachment_id=p_id returning * into j;
  update public.attachments set scan_status=case when j.phase='quarantined' then 'infected' else 'scanning' end,
    scanner='bouncer',scan_detail=case when j.phase='quarantined' then scan_detail else 'Waiting for scanner verification.' end
    where id=p_id;
  return to_jsonb(j)||jsonb_build_object('start_new',fresh);
end;
$$;

create function public.begin_attachment_scan(p_id uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path=''
as $$
begin
  perform 1 from public.attachments where id=p_id for update;
  update public.attachment_scan_jobs set phase='requesting'
    where attachment_id=p_id and lease_id=p_lease and lease_until>now() and phase='ready';
  return found;
end;
$$;

create function public.checkpoint_attachment_scan(p_id uuid,p_lease uuid,p_scan_id text)
returns boolean language plpgsql security invoker set search_path=''
as $$
begin
  if p_scan_id is null or p_scan_id !~ '^scan_[A-Za-z0-9_-]{1,100}$' then raise exception 'Invalid scan ID'; end if;
  perform 1 from public.attachments where id=p_id for update;
  update public.attachment_scan_jobs set provider_scan_id=p_scan_id,phase='polling'
    where attachment_id=p_id and lease_id=p_lease and lease_until>now()
      and phase='requesting' and provider_scan_id is null;
  return found;
end;
$$;

create function public.finish_attachment_scan(p_id uuid,p_lease uuid,p_verdict text,p_detail text)
returns boolean language plpgsql security invoker set search_path=''
as $$
declare a public.attachments; j public.attachment_scan_jobs;
begin
  if p_verdict is null or p_verdict not in ('retry','pending','clean','infected','failed','removed') then raise exception 'Invalid scanner verdict'; end if;
  select * into a from public.attachments where id=p_id for update;
  if not found then return false; end if;
  select * into j from public.attachment_scan_jobs where attachment_id=p_id for update;
  if not found or j.lease_id is distinct from p_lease or p_lease is null or j.lease_until<=now() then return false; end if;
  if a.file_path is distinct from j.file_path or a.checksum is distinct from j.checksum or a.file_size is distinct from j.file_size then return false; end if;
  if p_verdict='removed' then
    if j.phase<>'quarantined' then return false; end if;
    update public.attachment_scan_jobs set phase='complete',lease_id=null,lease_until=null where attachment_id=p_id;
    return true;
  end if;
  if j.phase='quarantined' or j.phase in ('complete','review') then return false; end if;
  if p_verdict='retry' and j.phase<>'ready' then return false; end if;
  if p_verdict in ('pending','clean','infected') and (j.phase<>'polling' or j.provider_scan_id is null) then return false; end if;
  update public.attachments set
    scan_status=case when p_verdict='pending' then 'scanning' when p_verdict='retry' then 'failed' else p_verdict end,
    scan_detail=case when p_verdict='clean' then null else left(coalesce(p_detail,'Scanner verification incomplete.'),500) end,
    scanner='bouncer',scanned_at=case when p_verdict='pending' then null else now() end
    where id=p_id;
  update public.attachment_scan_jobs set
    phase=case p_verdict when 'retry' then 'ready' when 'pending' then 'polling' when 'infected' then 'quarantined' when 'clean' then 'complete' else 'review' end,
    next_attempt_at=case when p_verdict in ('pending','retry') then now()+interval '1 minute' else now() end,
    lease_id=case when p_verdict='infected' then lease_id else null end,
    lease_until=case when p_verdict='infected' then lease_until else null end
    where attachment_id=p_id;
  return true;
end;
$$;

revoke all on function public.pending_attachment_scans() from public,anon,authenticated;
revoke all on function public.claim_attachment_scan(uuid,uuid) from public,anon,authenticated;
revoke all on function public.begin_attachment_scan(uuid,uuid) from public,anon,authenticated;
revoke all on function public.checkpoint_attachment_scan(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finish_attachment_scan(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pending_attachment_scans() to service_role;
grant execute on function public.claim_attachment_scan(uuid,uuid) to service_role;
grant execute on function public.begin_attachment_scan(uuid,uuid) to service_role;
grant execute on function public.checkpoint_attachment_scan(uuid,uuid,text) to service_role;
grant execute on function public.finish_attachment_scan(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
