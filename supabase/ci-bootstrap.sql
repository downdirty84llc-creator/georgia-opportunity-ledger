-- ---------------------------------------------------------------------------
-- Stand-ins for the objects Supabase provides, so the migrations can be
-- applied to a bare PostgreSQL instance.
--
-- WHY THIS EXISTS
--
-- `supabase db push` runs the migrations against a database where Supabase has
-- already created `auth.users`, `auth.uid()`, the storage tables and the
-- `extensions` schema. Continuous integration has none of that, so without
-- this file the very first migration that references `auth.users` fails and
-- the migrations are effectively untested until somebody points them at a real
-- project — which is exactly when a broken one is most expensive.
--
-- WHAT THIS IS NOT
--
-- Not a Supabase emulator, and not something to run against a real project.
-- The definitions here are the narrowest shape the migrations depend on:
-- enough for every `create table`, `create policy`, `create index` and
-- `create function` to compile and for the constraints to be exercised.
--
-- `auth.uid()` returns null here, which means row-level security denies
-- everything. That is the right default for a schema check: it proves the
-- policies parse and attach, not that they admit the right rows. Proving the
-- latter needs real sessions, which is what `tests/e2e/entitlements.spec.ts`
-- does against a seeded environment.
-- ---------------------------------------------------------------------------

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

-- --- Roles ------------------------------------------------------------------
--
-- Supabase creates these; policies and grants in the migrations name them.

do $$ begin
  create role anon nologin noinherit;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null;
end $$;

-- --- Grants -----------------------------------------------------------------
--
-- Supabase grants the API roles broad table privileges and lets row-level
-- security do the restricting. That split matters: without the grants, every
-- policy check is unreachable because permission is denied before RLS is
-- consulted, and a verification run would "pass" by refusing everything for
-- entirely the wrong reason.
--
-- The default privileges apply to the tables the migrations are about to
-- create, so this has to run before them.

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- --- Extensions -------------------------------------------------------------
--
-- The migrations qualify these as `extensions.`, which is where Supabase
-- installs them rather than in `public`.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gin with schema extensions;

-- --- auth -------------------------------------------------------------------

/**
 * The subset of `auth.users` that `profiles` references.
 *
 * Only the primary key and the columns the application reads are here. A
 * foreign key needs the target to exist, not to be complete.
 */
create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

/**
 * Returns the current user id from the request's JWT.
 *
 * Null here, because there is no GoTrue issuing tokens. Row-level security
 * therefore denies everything, which is the safe direction for a check whose
 * purpose is to prove the policies compile and attach.
 */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claim.sub', true),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    'anon'
  );
$$;

-- --- storage ----------------------------------------------------------------

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

/**
 * Splits an object path into its segments.
 *
 * The real implementation returns the folder components; the export policy
 * uses `(storage.foldername(name))[1]` to scope a member to their own prefix,
 * so the first element has to be the leading directory.
 */
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : greatest(array_length(parts, 1) - 1, 0)];
end;
$$;
