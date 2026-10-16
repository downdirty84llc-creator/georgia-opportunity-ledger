\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('17171717-1717-4717-8717-171717171717','mfa.staff@example.test');
alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
update public.profiles set role='super_administrator' where id='17171717-1717-4717-8717-171717171717';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;
select set_config('request.jwt.claim.sub','17171717-1717-4717-8717-171717171717',true);
set local role authenticated;
do $$ begin
 perform set_config('request.jwt.claims','{}',true);
 if public.is_staff() or public.has_role('super_administrator') or public.my_access_rank()<>0 then raise exception 'Missing assurance granted staff access'; end if;
 perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
 if public.is_staff() or public.has_role('super_administrator') or public.my_access_rank()<>0 then raise exception 'Password-only session granted staff access'; end if;
 begin
   update public.profiles set access_rank_override=100 where id=auth.uid();
   raise exception 'Password-only admin changed privileges';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.audit_logs) then raise exception 'Password-only staff read audit log'; end if;
 perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
 if not public.is_staff() or not public.has_role('super_administrator') or public.my_access_rank()<>100 then raise exception 'Verified active staff denied'; end if;
 raise notice 'ok  missing and password-only assurance refused; verified staff accepted';
end $$;
reset role;
alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
update public.profiles set account_status='suspended' where id='17171717-1717-4717-8717-171717171717';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;
set local role authenticated;
do $$ begin
 if public.is_staff() or public.has_role('super_administrator') or public.my_access_rank()<>0 then raise exception 'Suspended verified staff accepted'; end if;
 raise notice 'ok  suspension overrides a verified factor';
end $$;
rollback;
