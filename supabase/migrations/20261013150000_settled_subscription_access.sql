-- A renewal's current_period_end includes time that has not yet been paid for.
alter table public.subscriptions add column paid_through_at timestamptz;
alter table public.subscriptions add column last_sync_attempt_at timestamptz;
create index subscriptions_sync_queue_idx on public.subscriptions(last_sync_attempt_at nulls first, id)
where stripe_subscription_id is not null;
comment on column public.subscriptions.paid_through_at is
  'Latest recurring service period covered by a settled Stripe invoice; service-written only.';

-- Manual subscriptions have no provider invoices. Stripe subscriptions are
-- reconciled by the application; never infer payment from an active status.
update public.subscriptions set paid_through_at = current_period_end
where stripe_subscription_id is null;

create or replace function public.subscription_access_rank(target_user uuid)
returns integer language plpgsql stable security definer
set search_path = public, extensions as $$
declare sub record;
begin
  select s.status, s.stripe_subscription_id,
    case when s.stripe_subscription_id is null then s.current_period_end
         else s.paid_through_at end as paid_until,
    p.access_rank into sub
  from public.subscriptions s join public.subscription_plans p on p.id = s.plan_id
  where s.user_id = target_user;
  if not found then return 0; end if;
  return case sub.status
    when 'active' then case when sub.stripe_subscription_id is null
      or now() <= sub.paid_until then sub.access_rank else 0 end
    when 'trialing' then sub.access_rank
    when 'past_due' then case when now() <= sub.paid_until + public.past_due_grace_period()
      then sub.access_rank else 0 end
    when 'canceled' then case when now() <= sub.paid_until then sub.access_rank else 0 end
    else 0 end;
end;
$$;

-- Preserve the existing caller grants: this replaces an access helper used by
-- RLS and search redaction; it does not expose any new privileged mutation.
notify pgrst, 'reload schema';
