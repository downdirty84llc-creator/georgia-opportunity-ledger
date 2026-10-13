-- Provider requests are immutable and durable before the first network call.
create table public.email_outbox (
 id uuid primary key default extensions.gen_random_uuid(),
 notification_id uuid not null unique references public.notifications(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 report_id uuid references public.reports(id) on delete cascade,
 opportunity_ids uuid[] not null default '{}',
 alert_type text not null,
 minimum_access_rank integer not null check(minimum_access_rank>=0),
 email jsonb not null,
 state text not null default 'queued' check(state in ('queued','sending','sent','skipped','needs_review')),
 lease_token uuid, lease_until timestamptz,
 first_attempt_at timestamptz, last_attempt_at timestamptz,
 next_attempt_at timestamptz not null default now(),
 attempts integer not null default 0,
 credential_fingerprint text,
 provider_message_id text, last_error text,
 created_at timestamptz not null default now(), completed_at timestamptz
);
create index email_outbox_user_idx on public.email_outbox(user_id);
create index email_outbox_report_idx on public.email_outbox(report_id);
create index email_outbox_due_idx on public.email_outbox(next_attempt_at) where state in ('queued','sending');
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from public,anon,authenticated;
grant all on public.email_outbox to service_role;
alter table public.reports add column email_queued_at timestamptz;

create function public.email_addresses_for_members(p_ids uuid[])
returns table(id uuid,email text) language sql stable security definer set search_path=public,extensions as $$
 select u.id,u.email::text from auth.users u join public.profiles p on p.id=u.id
 where u.id=any(p_ids) and p.account_status='active' and u.email_confirmed_at is not null;
$$;

create function public.enqueue_notification_email(p_user_id uuid,p_notifications jsonb,p_email jsonb,
 p_minimum_rank integer,p_alert_type text,p_opportunity_ids uuid[],p_report_id uuid default null)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare item jsonb; notification uuid; first_notification uuid; outbox_id uuid; existing integer;
begin
 if jsonb_array_length(p_notifications) not between 1 and 100 then raise exception 'Invalid notification batch size'; end if;
 perform 1 from public.profiles where id=p_user_id and account_status='active' for update;
 if not found then return null; end if;
 -- Serialize this member's enqueue attempts. No notification can commit without
 -- its email, and a partial overlap must reload its keys before rendering again.
 select count(*) into existing from public.notifications n where n.user_id=p_user_id
   and n.dedupe_key in (select value->>'dedupe_key' from jsonb_array_elements(p_notifications));
 if existing=jsonb_array_length(p_notifications) then
   select q.id into outbox_id from public.email_outbox q join public.notifications n on n.id=q.notification_id
    where n.user_id=p_user_id and n.dedupe_key in (select value->>'dedupe_key' from jsonb_array_elements(p_notifications)) limit 1;
   return outbox_id;
 elsif existing>0 then raise exception 'Notification batch overlaps queued work; reload dedupe keys'; end if;
 for item in select value from jsonb_array_elements(p_notifications) loop
   if nullif(item->>'dedupe_key','') is null then raise exception 'Email notification requires a dedupe key'; end if;
   insert into public.notifications(user_id,notification_type,title,message,opportunity_id,report_id,action_url,dedupe_key)
   values(p_user_id,(item->>'notification_type')::public.notification_type,item->>'title',item->>'message',
     (item->>'opportunity_id')::uuid,p_report_id,item->>'action_url',item->>'dedupe_key') returning id into notification;
   first_notification:=coalesce(first_notification,notification);
 end loop;
 insert into public.email_outbox(notification_id,user_id,report_id,opportunity_ids,alert_type,minimum_access_rank,email)
 values(first_notification,p_user_id,p_report_id,coalesce(p_opportunity_ids,'{}'),p_alert_type,p_minimum_rank,p_email)
 returning id into outbox_id;
 return outbox_id;
end $$;

create function public.claim_email_delivery(p_provider text,p_fingerprint text)
returns public.email_outbox language plpgsql security definer set search_path=public,extensions as $$
declare item public.email_outbox; rank integer; reason text;
begin
 for item in select * from public.email_outbox
   where (state='queued' and next_attempt_at<=clock_timestamp()) or (state='sending' and lease_until<clock_timestamp())
   order by next_attempt_at,id limit 50 for update skip locked
 loop
   reason:=null;
   if item.email->>'provider'<>p_provider then reason:='Queued provider differs from configured provider';
   elsif item.first_attempt_at is not null and item.credential_fingerprint<>p_fingerprint then reason:='Sending credentials changed after an uncertain attempt';
   elsif item.first_attempt_at<clock_timestamp()-interval '23 hours' then reason:='Provider idempotency window expired; reconcile before retrying';
   elsif item.first_attempt_at is not null and p_provider='postmark' then reason:='Postmark attempt outcome requires reconciliation before another send'; end if;
   if reason is not null then
     update public.email_outbox set state='needs_review',last_error=reason,lease_until=null where id=item.id;
     continue;
   end if;
   rank:=public.effective_access_rank(item.user_id);
   if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
      where p.id=item.user_id and p.account_status='active' and u.email_confirmed_at is not null
      and lower(u.email)=lower(item.email->>'recipient'))
      or exists(select 1 from public.user_preferences where user_id=item.user_id and not email_alerts_enabled)
      or exists(select 1 from public.alert_preferences where user_id=item.user_id and alert_type::text=item.alert_type and delivery_method='email' and (not enabled or frequency='never'))
      or rank<item.minimum_access_rank
      or (item.report_id is not null and not exists(select 1 from public.reports r where r.id=item.report_id and r.status='published' and r.published_at<=now() and (item.minimum_access_rank<10 or r.minimum_access_rank<=rank)))
      or exists(select 1 from unnest(item.opportunity_ids) source_id where not exists(select 1 from public.opportunities o
        where o.id=source_id and o.workflow_status='published' and not o.is_restricted and o.minimum_access_rank<=rank and o.published_at<=now()
          and (item.alert_type<>'closing_soon' or (not o.is_expired and o.closing_date>now())))) then
     update public.email_outbox set state='skipped',last_error='Recipient, preference, entitlement or source visibility changed',completed_at=clock_timestamp(),lease_until=null where id=item.id;
     insert into public.notification_deliveries(notification_id,delivery_method,delivery_status,error_message)
       values(item.notification_id,'email','suppressed','Recipient, preference, entitlement or source visibility changed');
     continue;
   end if;
   update public.email_outbox set state='sending',lease_token=extensions.gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',
     first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),last_attempt_at=clock_timestamp(),attempts=attempts+1,
     credential_fingerprint=coalesce(credential_fingerprint,p_fingerprint)
     where id=item.id returning * into item;
   return item;
 end loop;
 return null;
end $$;

create function public.finish_email_delivery(p_id uuid,p_token uuid,p_state text,p_provider_id text,p_error text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare item public.email_outbox;
begin
 if p_state not in ('sent','queued','needs_review') or (p_state='sent' and nullif(p_provider_id,'') is null) then raise exception 'Invalid email delivery result'; end if;
 update public.email_outbox set state=p_state,provider_message_id=p_provider_id,last_error=p_error,lease_until=null,
   completed_at=case when p_state='sent' then clock_timestamp() else null end,
   next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,power(2,least(attempts,8))::integer*15))
 where id=p_id and lease_token=p_token and state='sending' and lease_until>clock_timestamp() returning * into item;
 if not found then return false; end if;
 insert into public.notification_deliveries(notification_id,delivery_method,provider_message_id,delivery_status,delivered_at,error_message)
 values(item.notification_id,'email',p_provider_id,case when p_state='sent' then 'sent'::public.delivery_status else 'failed'::public.delivery_status end,
   case when p_state='sent' then clock_timestamp() else null end,p_error);
 return true;
end $$;

create function public.complete_email_distributions()
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare affected integer;
begin
 update public.reports r set distributed_at=clock_timestamp() where r.distributed_at is null and r.email_queued_at is not null
   and not exists(select 1 from public.email_outbox q where q.report_id=r.id and q.state not in ('sent','skipped'));
 get diagnostics affected = row_count;
 return affected;
end $$;

revoke all on function public.email_addresses_for_members(uuid[]),public.enqueue_notification_email(uuid,jsonb,jsonb,integer,text,uuid[],uuid),
 public.claim_email_delivery(text,text),public.finish_email_delivery(uuid,uuid,text,text,text),public.complete_email_distributions() from public,anon,authenticated;
grant execute on function public.email_addresses_for_members(uuid[]),public.enqueue_notification_email(uuid,jsonb,jsonb,integer,text,uuid[],uuid),
 public.claim_email_delivery(text,text),public.finish_email_delivery(uuid,uuid,text,text,text),public.complete_email_distributions() to service_role;
notify pgrst,'reload schema';
