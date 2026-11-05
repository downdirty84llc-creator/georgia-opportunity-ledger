\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('88888888-1111-4111-8111-111111111111','billing-review-staff@example.test'),
 ('88888888-1111-4111-8111-222222222222','billing-review-member@example.test');
-- Fixture setup only, in this rolled-back disposable-database transaction.
alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
update public.profiles set role='billing_manager' where id='88888888-1111-4111-8111-111111111111';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;
insert into public.billing_events(id,stripe_event_id,event_type,event_payload,processed,review_required) values
 ('88888888-1111-4111-8111-333333333333','evt_review_synthetic','charge.refunded','{}',true,true),
 ('88888888-1111-4111-8111-444444444444','evt_review_processing','charge.refunded','{}',false,true);
do $$ begin
 if has_function_privilege('anon','public.review_billing_event(uuid,uuid,text,text)','execute')
 or has_function_privilege('authenticated','public.review_billing_event(uuid,uuid,text,text)','execute') then
   raise exception 'Public clients can bypass the MFA-gated review API';
 end if;
 if not has_function_privilege('service_role','public.review_billing_event(uuid,uuid,text,text)','execute') then
   raise exception 'Service cannot review events';
 end if;
end $$;
set local role service_role;
do $$ declare result text; begin
 begin
  perform public.review_billing_event('88888888-1111-4111-8111-333333333333','88888888-1111-4111-8111-222222222222','no_change','Member cannot review this');
  raise exception 'Member actor accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.review_billing_event('88888888-1111-4111-8111-333333333333','88888888-1111-4111-8111-111111111111','no_change','short');
  raise exception 'Short note accepted';
 exception when invalid_parameter_value then null; end;
 result := public.review_billing_event('88888888-1111-4111-8111-444444444444','88888888-1111-4111-8111-111111111111','no_change','Still processing event');
 if result <> 'processing' then raise exception 'Unprocessed event was reviewable'; end if;
 result := public.review_billing_event('88888888-1111-4111-8111-333333333333','88888888-1111-4111-8111-111111111111','no_change','Partial refund checked');
 if result <> 'reviewed' then raise exception 'Review failed'; end if;
 result := public.review_billing_event('88888888-1111-4111-8111-333333333333','88888888-1111-4111-8111-111111111111','handled_in_stripe','Duplicate must not overwrite');
 if result <> 'already_reviewed' then raise exception 'Duplicate review accepted'; end if;
 if (select count(*) from public.audit_logs where entity_id='88888888-1111-4111-8111-333333333333' and action='billing_event.reviewed') <> 1 then raise exception 'Review audit is not idempotent'; end if;
 if (select review_note from public.billing_events where id='88888888-1111-4111-8111-333333333333') <> 'Partial refund checked' then raise exception 'Original decision overwritten'; end if;
end $$;
reset role;
-- A failed audit insert must roll back the review update in the same call.
update public.billing_events set processed=true where stripe_event_id='evt_review_processing';
alter table public.audit_logs add constraint synthetic_review_audit_failure
  check (entity_id <> '88888888-1111-4111-8111-444444444444');
set local role service_role;
do $$ begin
 begin
  perform public.review_billing_event('88888888-1111-4111-8111-444444444444','88888888-1111-4111-8111-111111111111','no_change','Synthetic audit rollback check');
  raise exception 'Audit failure was ignored';
 exception when check_violation then null; end;
 if exists(select 1 from public.billing_events where stripe_event_id='evt_review_processing' and reviewed_at is not null) then
  raise exception 'Review persisted despite failed audit';
 end if;
end $$;
reset role;
-- Verify the table's existing staff policy still denies ordinary authenticated
-- clients access to notes, even when their user ID is attached to the event.
update public.billing_events set user_id='88888888-1111-4111-8111-222222222222' where stripe_event_id='evt_review_synthetic';
set local role authenticated;
select set_config('request.jwt.claim.sub','88888888-1111-4111-8111-222222222222',true);
select set_config('request.jwt.claims','{"sub":"88888888-1111-4111-8111-222222222222","role":"authenticated","aal":"aal2"}',true);
do $$ begin
 if exists(select 1 from public.billing_events where stripe_event_id='evt_review_synthetic') then raise exception 'Member can read billing review'; end if;
end $$;
reset role;
do $$ begin raise notice 'ok  billing reviews: service-only grants, active role, note validation, processing gate, duplicate audit and member isolation'; end $$;
rollback;
