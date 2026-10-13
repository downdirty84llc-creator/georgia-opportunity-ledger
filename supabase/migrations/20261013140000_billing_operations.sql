-- Serialize provider mutations per member. Unknown outcomes keep their durable
-- operation and Stripe idempotency keys; a retry cannot become a new purchase.
create table public.billing_operations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('checkout', 'change_plan', 'cancel')),
  payload jsonb not null,
  state text not null default 'pending' check (state in ('pending', 'succeeded', 'failed')),
  lease_token uuid not null default extensions.gen_random_uuid(),
  lease_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  result jsonb
);
create unique index billing_operations_one_pending on public.billing_operations(user_id) where state = 'pending';
create index billing_operations_user_id_idx on public.billing_operations(user_id);
alter table public.billing_operations enable row level security;
revoke all on public.billing_operations from public, anon, authenticated;
grant select on public.billing_operations to service_role;

create function public.begin_billing_operation(p_user_id uuid, p_kind text, p_payload jsonb)
returns public.billing_operations
language plpgsql security definer set search_path = public, extensions
as $$
declare
  profile_status public.account_status;
  operation public.billing_operations;
begin
  select account_status into profile_status from public.profiles
    where id = p_user_id for update;
  if profile_status is distinct from 'active' then
    raise exception 'Account is not active' using errcode = 'P0001';
  end if;
  select * into operation from public.billing_operations
    where user_id = p_user_id and state = 'pending' for update;
  if found then
    if operation.kind <> p_kind or operation.payload <> p_payload then
      raise exception 'An earlier billing request must finish before another can start' using errcode = 'P0001';
    end if;
    if operation.lease_until > clock_timestamp() then
      raise exception 'A billing request is already running. Wait a moment and try again' using errcode = 'P0001';
    end if;
    -- Stripe retains idempotency keys for at least 24 hours. Do not replay an
    -- unresolved purchase after that guarantee ends; it needs reconciliation.
    if operation.created_at < clock_timestamp() - interval '23 hours' then
      raise exception 'An earlier billing request needs support to reconcile its outcome' using errcode = 'P0001';
    end if;
    update public.billing_operations set lease_token = extensions.gen_random_uuid(),
      lease_until = clock_timestamp() + interval '2 minutes'
      where id = operation.id returning * into operation;
  else
    insert into public.billing_operations(user_id, kind, payload, lease_until)
      values(p_user_id, p_kind, p_payload, clock_timestamp() + interval '2 minutes')
      returning * into operation;
  end if;
  return operation;
end;
$$;

create function public.finish_billing_operation(p_id uuid, p_token uuid, p_state text, p_result jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_state not in ('pending', 'succeeded', 'failed') then raise exception 'Invalid state'; end if;
  update public.billing_operations set state = p_state, result = p_result,
    lease_until = clock_timestamp()
    where id = p_id and lease_token = p_token and state = 'pending';
  return found;
end;
$$;

-- Closure writes, including direct member RPC/profile writes, enqueue billing
-- cancellation. Reopening and permanent purge wait for provider confirmation.
create table public.account_billing_closures (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  requested_at timestamptz not null,
  completed_at timestamptz,
  last_error text,
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz
);
alter table public.account_billing_closures enable row level security;
revoke all on public.account_billing_closures from public, anon, authenticated;
grant select, update on public.account_billing_closures to service_role;

create function public.guard_account_billing_transition()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.account_status is distinct from old.account_status
     or new.deletion_requested_at is distinct from old.deletion_requested_at then
    if exists (select 1 from public.billing_operations where user_id = old.id and state = 'pending') then
      raise exception 'Finish the pending billing request before changing account status' using errcode = 'insufficient_privilege';
    end if;
    if old.account_status = 'closed' and exists (
      select 1 from public.account_billing_closures where user_id = old.id and completed_at is null
    ) then
      raise exception 'Billing cancellation is still processing. Try again shortly' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.account_status = 'closed' and new.deletion_requested_at is not null
     and (old.account_status is distinct from 'closed' or old.deletion_requested_at is distinct from new.deletion_requested_at) then
    insert into public.account_billing_closures(user_id, requested_at)
      values(new.id, new.deletion_requested_at)
      on conflict(user_id) do update set requested_at = excluded.requested_at,
        completed_at = null, last_error = null, attempts = 0,
        lease_token = null, lease_until = null;
    if not exists(select 1 from public.subscriptions where user_id = new.id
      and (stripe_customer_id is not null or stripe_subscription_id is not null)) then
      update public.account_billing_closures set completed_at = clock_timestamp() where user_id = new.id;
    end if;
  end if;
  return new;
end;
$$;
-- AFTER sees the trusted deletion timestamp produced by the privilege guard.
create trigger guard_account_billing_transition_trigger after update on public.profiles
for each row execute function public.guard_account_billing_transition();

insert into public.account_billing_closures(user_id, requested_at)
select id, deletion_requested_at from public.profiles
where account_status = 'closed' and deletion_requested_at is not null;
update public.account_billing_closures c set completed_at = clock_timestamp()
where not exists(select 1 from public.subscriptions s where s.user_id = c.user_id
  and (s.stripe_customer_id is not null or s.stripe_subscription_id is not null));

create function public.guard_purge_billing_completion()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
begin
  if exists(select 1 from public.account_billing_closures where user_id = new.user_id and completed_at is null)
     or exists(select 1 from public.billing_operations where user_id = new.user_id and state = 'pending') then
    raise exception 'Billing cleanup must complete before permanent account deletion';
  end if;
  return new;
end;
$$;
create trigger guard_purge_billing_completion_trigger before insert on public.account_purge_claims
for each row execute function public.guard_purge_billing_completion();

create function public.claim_account_billing_closure(p_user_id uuid)
returns public.account_billing_closures
language plpgsql security definer set search_path = public, extensions
as $$
declare closure public.account_billing_closures;
begin
  perform 1 from public.profiles where id = p_user_id and account_status = 'closed' for update;
  if not found then return null; end if;
  update public.account_billing_closures set lease_token = extensions.gen_random_uuid(),
    lease_until = clock_timestamp() + interval '2 minutes', attempts = attempts + 1
    where user_id = p_user_id and completed_at is null
      and (lease_until is null or lease_until < clock_timestamp())
    returning * into closure;
  return closure;
end;
$$;

revoke all on function public.begin_billing_operation(uuid,text,jsonb),
  public.finish_billing_operation(uuid,uuid,text,jsonb),
  public.claim_account_billing_closure(uuid),
  public.guard_account_billing_transition(), public.guard_purge_billing_completion()
  from public, anon, authenticated;
grant execute on function public.begin_billing_operation(uuid,text,jsonb),
  public.finish_billing_operation(uuid,uuid,text,jsonb),
  public.claim_account_billing_closure(uuid) to service_role;
