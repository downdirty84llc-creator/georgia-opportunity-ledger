-- ---------------------------------------------------------------------------
-- 0002 — Shared trigger functions and helpers
-- ---------------------------------------------------------------------------

-- Keeps `updated_at` honest regardless of what the caller supplies.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Attaches the updated_at trigger to a table. Used by every migration that
-- creates a table with an `updated_at` column.
create or replace function public.attach_updated_at(target regclass)
returns void
language plpgsql
as $$
declare
  trigger_name text := 'set_updated_at_' || replace(target::text, '.', '_');
begin
  execute format(
    'drop trigger if exists %I on %s',
    trigger_name, target
  );
  execute format(
    'create trigger %I before update on %s
       for each row execute function public.set_updated_at()',
    trigger_name, target
  );
end;
$$;

-- Slug helper used by seeds and by the admin API when a slug is not supplied.
create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;
