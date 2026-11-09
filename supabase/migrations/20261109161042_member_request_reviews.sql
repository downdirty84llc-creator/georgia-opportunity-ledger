-- Customer-facing resolution notes: owners can already select their tickets.
alter table public.support_tickets add column resolution_notes text;

-- One transaction owns the status change and its audit record. Derive the
-- actor from the JWT; never accept an actor supplied by the browser.
create function public.review_member_request(
  p_kind text, p_id uuid, p_expected_updated_at timestamptz,
  p_status text, p_note text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  prior_status text;
  prior_updated_at timestamptz;
  prior_note text;
begin
  if p_kind = 'corrections' then
    if not public.has_role('reviewer','editor','super_administrator') then
      raise exception 'Editorial access required' using errcode='42501';
    end if;
    if p_status is null or p_status not in ('submitted','under_review','accepted','rejected','published') then
      raise exception 'Invalid correction status' using errcode='22023';
    end if;
    select status::text,updated_at,resolution_notes into prior_status,prior_updated_at,prior_note
      from public.correction_requests where id=p_id for update;
  elsif p_kind = 'support' then
    if not public.has_role('support_representative','billing_manager','super_administrator') then
      raise exception 'Support access required' using errcode='42501';
    end if;
    if p_status is null or p_status not in ('open','awaiting_customer','awaiting_internal','resolved','closed') then
      raise exception 'Invalid support status' using errcode='22023';
    end if;
    select status::text,updated_at,resolution_notes into prior_status,prior_updated_at,prior_note
      from public.support_tickets where id=p_id for update;
  else
    raise exception 'Invalid request type' using errcode='22023';
  end if;
  if prior_updated_at is null then
    raise exception 'Request not found' using errcode='P0002';
  end if;
  if p_expected_updated_at is null or prior_updated_at <> p_expected_updated_at then
    raise exception 'Request changed; refresh before reviewing' using errcode='40001';
  end if;
  if p_note is null or length(btrim(p_note)) not between 10 and 8000 then
    raise exception 'A resolution note of 10 to 8000 characters is required' using errcode='22023';
  end if;
  if p_kind='corrections' then
    if p_status='published' and prior_status not in ('accepted','published') then
      raise exception 'Accept the correction before marking it published' using errcode='22023';
    end if;
    update public.correction_requests set
      status=p_status::public.correction_status, reviewed_by=auth.uid(),
      resolution_notes=btrim(p_note),
      resolved_at=case when p_status in ('rejected','published') then coalesce(resolved_at,now()) else null end
      where id=p_id;
  else
    update public.support_tickets set
      status=p_status::public.support_status, assigned_to=auth.uid(),
      resolution_notes=btrim(p_note),
      resolved_at=case when p_status in ('resolved','closed') then coalesce(resolved_at,now()) else null end
      where id=p_id;
  end if;
  perform public.write_audit_log(
    case when p_kind='corrections' then 'correction.reviewed' else 'support.reviewed' end,
    case when p_kind='corrections' then 'correction_request' else 'support_ticket' end,
    p_id,jsonb_build_object('status',prior_status,'resolution_notes',prior_note),
    jsonb_build_object('status',p_status,'resolution_notes',btrim(p_note))
  );
end;
$$;
revoke all on function public.review_member_request(text,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.review_member_request(text,uuid,timestamptz,text,text) to authenticated;

-- Reveal only the current contact address for the displayed requests, to the
-- same MFA-verified roles that already handle those requests. No user search.
create function public.member_request_contacts(p_kind text,p_ids uuid[])
returns table(request_id uuid,email text)
language plpgsql stable security definer set search_path=public,pg_temp
as $$
begin
  if coalesce(cardinality(p_ids),0)>25 then
    raise exception 'At most 25 requests per page' using errcode='22023';
  end if;
  if p_kind='support' then
    if not public.has_role('support_representative','billing_manager','super_administrator') then
      raise exception 'Support access required' using errcode='42501';
    end if;
    return query select r.id,u.email::text from public.support_tickets r
      join auth.users u on u.id=r.user_id where r.id=any(p_ids);
  elsif p_kind='corrections' then
    if not public.has_role('reviewer','editor','super_administrator') then
      raise exception 'Editorial access required' using errcode='42501';
    end if;
    return query select r.id,u.email::text from public.correction_requests r
      join auth.users u on u.id=r.submitted_by_user_id where r.id=any(p_ids);
  else
    raise exception 'Invalid request type' using errcode='22023';
  end if;
end;
$$;
revoke all on function public.member_request_contacts(text,uuid[]) from public,anon,authenticated;
grant execute on function public.member_request_contacts(text,uuid[]) to authenticated;
