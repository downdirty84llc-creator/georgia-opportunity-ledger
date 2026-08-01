-- ---------------------------------------------------------------------------
-- 0025 — Repair `refresh_opportunity_search_vector` on databases that already
-- have the broken version
--
-- Migration 0014 was corrected in place, which fixes every database created
-- from an empty schema after that point. It does nothing for a database the
-- migrations have already been pushed to: `supabase db push` will not re-run a
-- migration it has recorded, so a deployed project keeps the broken function
-- for ever.
--
-- That is not hypothetical. The project this repository deploys to was already
-- carrying it, and `insert into opportunities` failed there with
--
--   ERROR: record "new" has no field "opportunity_id"
--
-- on every single row — the central table of the product, unable to accept
-- anything.
--
-- `create or replace function` is idempotent, so this is a no-op on a database
-- that already has the corrected 0014 and a repair on one that does not. Both
-- paths converge here, which is the property that matters; editing 0014 alone
-- was the mistake.
--
-- The defect itself: PL/pgSQL plans an expression as a single SQL statement, so
-- every column named in a `case` has to resolve against the record type even on
-- the branch that will not be taken. The `else` arm named `new.opportunity_id`,
-- which does not exist on `opportunities`. Branching has to be control flow,
-- which is compiled lazily, rather than an expression.
-- ---------------------------------------------------------------------------

create or replace function public.refresh_opportunity_search_vector()
returns trigger
language plpgsql
as $$
declare
  target uuid;
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'opportunities' then
      target := old.id;
    else
      target := old.opportunity_id;
    end if;
  else
    if tg_table_name = 'opportunities' then
      target := new.id;
    else
      target := new.opportunity_id;
    end if;
  end if;

  if target is not null then
    update public.opportunities
    set search_vector = public.build_opportunity_search_vector(target)
    where id = target;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
