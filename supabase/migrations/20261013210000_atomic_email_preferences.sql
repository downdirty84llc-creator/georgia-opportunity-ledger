-- Save master switches and individual choices atomically as the signed-in
-- member. There is no caller-supplied user ID, and invoker RLS still applies.
create or replace function public.save_email_preferences(
  p_email_alerts_enabled boolean,
  p_marketing_email_enabled boolean,
  p_alert_types jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  entry jsonb;
begin
  if member_id is null then
    raise exception 'Sign in to update email preferences' using errcode = '42501';
  end if;
  if p_email_alerts_enabled is null or p_marketing_email_enabled is null
    or jsonb_typeof(p_alert_types) is distinct from 'array' then
    raise exception 'Invalid email preferences' using errcode = '22023';
  end if;
  if jsonb_array_length(p_alert_types) > 9
    or (select count(*) <> count(distinct value->>'alertType') from jsonb_array_elements(p_alert_types)) then
    raise exception 'Alert types must be unique' using errcode = '22023';
  end if;

  -- This row lock also serializes concurrent saves before any alert rows change.
  insert into public.user_preferences(user_id,email_alerts_enabled,marketing_email_enabled)
  values(member_id,p_email_alerts_enabled,p_marketing_email_enabled)
  on conflict(user_id) do update set
    email_alerts_enabled = excluded.email_alerts_enabled,
    marketing_email_enabled = excluded.marketing_email_enabled;

  for entry in select value from jsonb_array_elements(p_alert_types) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry->'alertType') is distinct from 'string'
      or jsonb_typeof(entry->'enabled') is distinct from 'boolean'
      or (entry ? 'frequency' and jsonb_typeof(entry->'frequency') is distinct from 'string')
      or (entry ? 'minimumScore' and (
        jsonb_typeof(entry->'minimumScore') is distinct from 'number'
        or (entry->>'minimumScore') !~ '^[0-9]+$'
      )) then
      raise exception 'Invalid alert preference' using errcode = '22023';
    end if;
    insert into public.alert_preferences(user_id,alert_type,delivery_method,enabled,frequency,minimum_score)
    values(member_id,(entry->>'alertType')::public.alert_type,'email',
      (entry->>'enabled')::boolean,
      coalesce((entry->>'frequency')::public.delivery_frequency,'immediate'),
      coalesce((entry->>'minimumScore')::integer,0))
    on conflict(user_id,alert_type,delivery_method) do update set
      enabled = excluded.enabled,
      frequency = case when entry ? 'frequency' then excluded.frequency else public.alert_preferences.frequency end,
      minimum_score = case when entry ? 'minimumScore' then excluded.minimum_score else public.alert_preferences.minimum_score end;
  end loop;
end;
$$;

revoke all on function public.save_email_preferences(boolean,boolean,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_email_preferences(boolean,boolean,jsonb) to authenticated;
