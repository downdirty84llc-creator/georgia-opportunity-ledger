-- Direct uploads land in an isolated bucket. Signed upload tokens never grant
-- access to the final member-download object.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('attachment-uploads','attachment-uploads',false,26214400,
 array['application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=26214400,
 allowed_mime_types=excluded.allowed_mime_types;

create table public.attachment_uploads (
 id uuid primary key,
 uploaded_by uuid references public.profiles(id) on delete set null,
 parent_type text not null check(parent_type in ('opportunity','report')),
 parent_id uuid not null,
 file_name text not null,
 mime_type text not null,
 file_size bigint not null check(file_size between 1 and 26214400),
 minimum_access_rank integer not null check(minimum_access_rank in (0,10,20,30)),
 status text not null default 'waiting' check(status in ('waiting','finalizing','completed','rejected')),
 lease_id uuid,
 lease_until timestamptz,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '2 hours',
 cleanup_after timestamptz not null default now()+interval '3 hours'
);
create index attachment_uploads_owner_idx on public.attachment_uploads(uploaded_by);
create index attachment_uploads_cleanup_idx on public.attachment_uploads(cleanup_after);
alter table public.attachment_uploads enable row level security;
revoke all on public.attachment_uploads from public,anon,authenticated;
grant all on public.attachment_uploads to service_role;

create function public.claim_attachment_upload(p_id uuid,p_owner uuid,p_lease uuid)
returns setof public.attachment_uploads language sql security invoker set search_path=''
as $$
 update public.attachment_uploads set status='finalizing',lease_id=p_lease,
   lease_until=now()+interval '2 minutes'
 where id=p_id and uploaded_by=p_owner and expires_at>now()
   and (status='waiting' or (status='finalizing' and lease_until<now()))
 returning *;
$$;
revoke all on function public.claim_attachment_upload(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_attachment_upload(uuid,uuid,uuid) to service_role;

create function public.complete_attachment_upload(p_id uuid,p_lease uuid,p_checksum text)
returns uuid language plpgsql security invoker set search_path=''
as $$
declare u public.attachment_uploads;
begin
 select * into u from public.attachment_uploads where id=p_id for update;
 if not found or u.status<>'finalizing' or u.lease_id is distinct from p_lease
    or u.lease_until<=now() then
   raise exception 'Upload lease is no longer valid';
 end if;
 if p_checksum is null or p_checksum !~ '^[a-f0-9]{64}$' then raise exception 'Invalid checksum'; end if;
 insert into public.attachments(id,opportunity_id,report_id,file_name,file_path,
   mime_type,file_size,minimum_access_rank,checksum,scan_status,uploaded_by)
 values(u.id,case when u.parent_type='opportunity' then u.parent_id end,
   case when u.parent_type='report' then u.parent_id end,u.file_name,
   case when u.parent_type='opportunity' then 'opportunities/' else 'reports/' end
     ||u.parent_id||'/'||u.id||'-'||u.file_name,
   u.mime_type,u.file_size,u.minimum_access_rank,p_checksum,'pending',u.uploaded_by);
 update public.attachment_uploads set status='completed',lease_id=null,lease_until=null where id=u.id;
 return u.id;
end;
$$;
revoke all on function public.complete_attachment_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_attachment_upload(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
