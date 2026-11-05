-- Provider risk signals are review tasks, never automatic account penalties.
alter table public.billing_events
  add column review_required boolean not null default false,
  add column review_context jsonb,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.profiles(id) on delete set null,
  add column review_outcome text check (review_outcome in ('no_change', 'handled_in_stripe')),
  add column review_note text check (char_length(review_note) between 10 and 2000);

create index billing_events_pending_review_idx on public.billing_events(created_at)
  where review_required and reviewed_at is null;
create index billing_events_reviewed_by_idx on public.billing_events(reviewed_by);

-- Retain any signals received before the handler was installed for manual review.
update public.billing_events set review_required = true
where event_type in ('charge.refunded','charge.dispute.created','radar.early_fraud_warning.created');

create function public.review_billing_event(p_event_id uuid, p_actor_id uuid,
  p_outcome text, p_note text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  event_row public.billing_events%rowtype;
begin
  -- Only the MFA-gated server API supplies the actor. Lock their role while
  -- recording the decision so a concurrent staff demotion cannot race it.
  perform 1 from public.profiles where id = p_actor_id and account_status = 'active'
    and role in ('billing_manager','super_administrator') for share;
  if not found then raise exception 'Active billing staff required' using errcode = '42501'; end if;
  if p_outcome is null or p_outcome not in ('no_change','handled_in_stripe')
    or p_note is null or char_length(btrim(p_note)) not between 10 and 2000 then
    raise exception 'Invalid review decision' using errcode = '22023';
  end if;
  select * into event_row from public.billing_events where id = p_event_id for update;
  if not found or not event_row.review_required then return 'not_found'; end if;
  if not event_row.processed then return 'processing'; end if;
  if event_row.reviewed_at is not null then return 'already_reviewed'; end if;
  update public.billing_events set reviewed_at = now(), reviewed_by = p_actor_id,
    review_outcome = p_outcome, review_note = btrim(p_note) where id = p_event_id;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, new_values)
    values(p_actor_id, 'billing_event.reviewed', 'billing_events', p_event_id,
      jsonb_build_object('stripe_event_id',event_row.stripe_event_id,
        'outcome',p_outcome,'note',btrim(p_note)));
  return 'reviewed';
end;
$$;
revoke all on function public.review_billing_event(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_billing_event(uuid,uuid,text,text) to service_role;
