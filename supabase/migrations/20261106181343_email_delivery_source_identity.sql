-- Qualify the queued opportunity ID: unqualified source_id binds to opportunities.source_id.
create or replace function public.claim_email_delivery(p_provider text,p_fingerprint text)
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
      or exists(select 1 from unnest(item.opportunity_ids) as requested(id) where not exists(select 1 from public.opportunities o
        where o.id=requested.id and o.workflow_status='published' and not o.is_restricted and o.minimum_access_rank<=rank and o.published_at<=now()
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

