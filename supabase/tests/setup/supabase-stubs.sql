-- Stubs that let the app's migrations run on a plain local Postgres 16, for
-- testing a migration before opening a PR (AGENTS.md "Database migrations").
-- Load into an empty database first, then apply supabase/migrations/*.sql in
-- order. auth.uid() reads the request.jwt.claim.sub setting, so a test can
-- act as a member with:  set request.jwt.claim.sub = '<profile id>';
-- Roles belong to the whole server, so a second test database reuses them.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
create schema extensions;
create schema storage;
create schema net;
create extension pgcrypto schema extensions;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
create function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 1000)
returns bigint language sql as $$ select 1::bigint $$;
grant usage on schema auth, extensions, storage, net to anon, authenticated, service_role;
-- Supabase Realtime, used by live updates in the app.
create schema realtime;
create table realtime.messages (
  id bigserial primary key, topic text, extension text, payload jsonb,
  event text, private boolean default true, inserted_at timestamptz default now()
);
create function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true)
$$;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$ select $$;
grant usage on schema realtime to anon, authenticated, service_role;
