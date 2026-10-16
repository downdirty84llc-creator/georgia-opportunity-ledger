-- A layout redirect is not an API or PostgREST boundary. Staff authority
-- requires an active account and a second factor in the current signed JWT.
create or replace function public.is_staff()
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(auth.jwt()->>'aal' = 'aal2' and exists (
    select 1 from public.profiles where id=auth.uid() and account_status='active'
    and role in ('researcher','reviewer','editor','support_representative','billing_manager','super_administrator')
  ), false);
$$;

create or replace function public.has_role(variadic wanted public.user_role[])
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce((select role=any(wanted)
    and (role='member' or (account_status='active' and auth.jwt()->>'aal'='aal2'))
    from public.profiles where id=auth.uid()),false);
$$;

-- Background jobs still resolve effective_access_rank for other users. The
-- request-bound wrapper must not give password-only staff the preview rank.
create or replace function public.my_access_rank()
returns integer language sql stable security definer
set search_path = public, extensions
as $$
  select case when not public.account_is_active() then 0
    when public.current_user_role() in ('researcher','reviewer','editor','support_representative','billing_manager','super_administrator')
         and not public.is_staff()
      then public.subscription_access_rank(auth.uid())
    else coalesce(public.effective_access_rank(auth.uid()),0) end;
$$;
