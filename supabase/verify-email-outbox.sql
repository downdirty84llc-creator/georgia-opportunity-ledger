\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values ('77777777-1111-4111-8111-111111111111','email-outbox@example.test');
create function pg_temp.queue(label text) returns uuid language sql as $$
 select public.enqueue_notification_email('77777777-1111-4111-8111-111111111111',
 jsonb_build_array(jsonb_build_object('dedupe_key',label,'notification_type','report_published','title','Fixture','message','Fixture','action_url','/reports')),
 '{"provider":"resend","recipient":"email-outbox@example.test","body":{"subject":"Immutable fixture"}}',0,'weekly_report','{}',null);
$$;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'OUTBOX CHECK FAILED: %',label; end if; raise notice 'ok  %',label;
end $$;
do $$ declare queued_id uuid; item public.email_outbox; retry public.email_outbox; count_before integer;
begin
 perform pg_temp.expect(not has_function_privilege('authenticated','public.claim_email_delivery(text,text)','execute'),'member cannot claim delivery payloads');
 queued_id:=pg_temp.queue('delivery-first');
 perform pg_temp.expect(queued_id=pg_temp.queue('delivery-first'),'enqueue is idempotent');
 perform pg_temp.expect((select count(*)=1 from public.notifications where dedupe_key='delivery-first'),'enqueue does not duplicate notification');
 item:=public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect(item.id=queued_id,'eligible confirmed recipient can be claimed');
 perform pg_temp.expect((public.claim_email_delivery('resend','credential-fingerprint')).id is null,'live delivery lease excludes another worker');
 update public.email_outbox set lease_until=clock_timestamp()-interval '1 second' where email_outbox.id=queued_id;
 retry:=public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect(retry.id=item.id and retry.email=item.email and retry.lease_token<>item.lease_token,'uncertain send reuses its original provider request ID and body');
 perform pg_temp.expect(not public.finish_email_delivery(item.id,item.lease_token,'sent','old-id',null),'stale worker cannot acknowledge delivery');
 perform pg_temp.expect(public.finish_email_delivery(retry.id,retry.lease_token,'sent','provider-id',null),'current worker acknowledges delivery');
 perform pg_temp.expect((select count(*)=1 from public.notification_deliveries where notification_id=item.notification_id and delivery_status='sent'),'one confirmed delivery record is committed');
 queued_id:=pg_temp.queue('expired-key');
 update public.email_outbox set first_attempt_at=clock_timestamp()-interval '24 hours',credential_fingerprint='credential-fingerprint' where email_outbox.id=queued_id;
 perform public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect((select state='needs_review' from public.email_outbox where email_outbox.id=queued_id),'expired provider dedupe guarantee requires review');
 queued_id:=pg_temp.queue('changed-credentials');
 update public.email_outbox set first_attempt_at=clock_timestamp(),credential_fingerprint='old-key' where email_outbox.id=queued_id;
 perform public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect((select state='needs_review' from public.email_outbox where email_outbox.id=queued_id),'changed credentials cannot replay a possibly sent email in another account');
 queued_id:=pg_temp.queue('opted-out');
 update public.user_preferences set email_alerts_enabled=false where user_id='77777777-1111-4111-8111-111111111111';
 perform public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect((select state='skipped' from public.email_outbox where email_outbox.id=queued_id),'unsubscribe between queueing and delivery is respected');
 update public.user_preferences set email_alerts_enabled=true where user_id='77777777-1111-4111-8111-111111111111';
 queued_id:=pg_temp.queue('no-paid-access');
 update public.email_outbox set minimum_access_rank=30 where email_outbox.id=queued_id;
 perform public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect((select state='skipped' from public.email_outbox where email_outbox.id=queued_id),'paid content is withheld after entitlement loss');
 queued_id:=pg_temp.queue('changed-address');
 update auth.users set email='new-address@example.test' where users.id='77777777-1111-4111-8111-111111111111';
 perform public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect((select state='skipped' from public.email_outbox where email_outbox.id=queued_id),'queued private content is not sent to a superseded address');
 update auth.users set email_confirmed_at=null where users.id='77777777-1111-4111-8111-111111111111';
 perform pg_temp.expect(not exists(select 1 from public.email_addresses_for_members(array['77777777-1111-4111-8111-111111111111']::uuid[])),'unconfirmed addresses are not delivery recipients');
 select count(*) into count_before from public.notifications;
 begin
   perform public.enqueue_notification_email('77777777-1111-4111-8111-111111111111',
    '[{"dedupe_key":"atomic-first","notification_type":"report_published","title":"Fixture","message":"Fixture"},{"dedupe_key":"atomic-fault","notification_type":"not-a-real-type","title":"Fixture","message":"Fixture"}]',
    '{}',0,'weekly_report','{}',null);
   raise exception 'Invalid batch unexpectedly committed';
 exception when invalid_text_representation then null; end;
 perform pg_temp.expect((select count(*)=count_before from public.notifications),'batch failure rolls back notifications as well as email');

 update auth.users set email='email-outbox@example.test',email_confirmed_at=now() where users.id='77777777-1111-4111-8111-111111111111';
 queued_id:=pg_temp.queue('postmark-uncertain');
 update public.email_outbox set email=jsonb_set(email,'{provider}','"postmark"'),first_attempt_at=now(),credential_fingerprint='credential-fingerprint' where email_outbox.id=queued_id;
 perform public.claim_email_delivery('postmark','credential-fingerprint');
 perform pg_temp.expect((select state='needs_review' from public.email_outbox where email_outbox.id=queued_id),'Postmark unknown outcome is never automatically resent');
 queued_id:=pg_temp.queue('never-frequency');
 insert into public.alert_preferences(user_id,alert_type,delivery_method,enabled,frequency)
 values('77777777-1111-4111-8111-111111111111','weekly_report','email',true,'never')
 on conflict(user_id,alert_type,delivery_method) do update set enabled=true,frequency='never';
 perform public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect((select state='skipped' from public.email_outbox where email_outbox.id=queued_id),'never frequency suppresses queued delivery even when enabled');
 delete from public.alert_preferences where user_id='77777777-1111-4111-8111-111111111111';
 insert into public.reports(id,title,slug,status,published_at,email_queued_at,minimum_access_rank)
 values('77777777-2222-4222-8222-222222222222','Outbox fixture','outbox-test-only','published',now(),now(),0);
 queued_id:=pg_temp.queue('report-delivery');
 update public.email_outbox set report_id='77777777-2222-4222-8222-222222222222' where email_outbox.id=queued_id;
 perform public.complete_email_distributions();
 perform pg_temp.expect((select distributed_at is null from public.reports where id='77777777-2222-4222-8222-222222222222'),'pending delivery prevents false report completion');
 item:=public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect(item.id=queued_id,'published report can be delivered');
 perform public.finish_email_delivery(item.id,item.lease_token,'queued',null,'transient provider fault');
 perform pg_temp.expect((select state='queued' and next_attempt_at>now() from public.email_outbox where email_outbox.id=queued_id),'transient failure remains queued with backoff');
 perform public.complete_email_distributions();
 perform pg_temp.expect((select distributed_at is null from public.reports where id='77777777-2222-4222-8222-222222222222'),'failed attempt does not complete report');
 update public.email_outbox set next_attempt_at=now() where email_outbox.id=queued_id;
 item:=public.claim_email_delivery('resend','credential-fingerprint');
 perform public.finish_email_delivery(item.id,item.lease_token,'sent','report-provider-id',null);
 perform public.complete_email_distributions();
 perform pg_temp.expect((select distributed_at is not null from public.reports where id='77777777-2222-4222-8222-222222222222'),'confirmed delivery completes report');
 queued_id:=pg_temp.queue('source-hidden');
 update public.email_outbox set opportunity_ids=array['77777777-3333-4333-8333-333333333333']::uuid[] where email_outbox.id=queued_id;
 perform public.claim_email_delivery('resend','credential-fingerprint');
 perform pg_temp.expect((select state='skipped' from public.email_outbox where email_outbox.id=queued_id),'deleted source cannot leak from an old queued payload');
end $$;
rollback;
