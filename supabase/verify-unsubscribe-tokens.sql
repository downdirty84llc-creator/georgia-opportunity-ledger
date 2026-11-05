\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('77777777-8888-4888-8888-111111111111','unsubscribe-recovery@example.test');
do $$
begin
 if not (select relrowsecurity from pg_class where oid='public.email_unsubscribe_tokens'::regclass) then
   raise exception 'Unsubscribe recovery RLS is disabled';
 end if;
 if has_table_privilege('anon','public.email_unsubscribe_tokens','select,insert,update,delete')
 or has_table_privilege('authenticated','public.email_unsubscribe_tokens','select,insert,update,delete') then
   raise exception 'Unsubscribe recovery is accessible to public clients';
 end if;
 if not has_table_privilege('service_role','public.email_unsubscribe_tokens','select')
 or not has_table_privilege('service_role','public.email_unsubscribe_tokens','insert')
 or has_table_privilege('service_role','public.email_unsubscribe_tokens','update,delete') then
   raise exception 'Unsubscribe service grants differ from select/insert only';
 end if;
end $$;
set local role service_role;
insert into public.email_unsubscribe_tokens(token_hash,user_id,scope)
 values(repeat('a',64),'77777777-8888-4888-8888-111111111111','alerts');
insert into public.email_unsubscribe_tokens(token_hash,user_id,scope)
 values(repeat('a',64),'77777777-8888-4888-8888-111111111111','all')
 on conflict(token_hash) do nothing;
do $$
begin
 if (select scope from public.email_unsubscribe_tokens where token_hash=repeat('a',64)) <> 'alerts' then
  raise exception 'Duplicate token changed its scope';
 end if;
 begin
   insert into public.email_unsubscribe_tokens(token_hash,user_id,scope)
    values('raw-secret','77777777-8888-4888-8888-111111111111','alerts');
   raise exception 'Malformed digest accepted';
 exception when check_violation then null;
 end;
 begin
   insert into public.email_unsubscribe_tokens(token_hash,user_id,scope)
    values(repeat('b',64),'77777777-8888-4888-8888-111111111111','anything');
   raise exception 'Unknown scope accepted';
 exception when check_violation then null;
 end;
end $$;
reset role;
delete from auth.users where id='77777777-8888-4888-8888-111111111111';
do $$ begin
 if exists(select 1 from public.email_unsubscribe_tokens where token_hash=repeat('a',64)) then
   raise exception 'Deleted profile retained unsubscribe recovery data';
 end if;
 raise notice 'ok  unsubscribe token grants, integrity, idempotency and deletion';
end $$;
rollback;
