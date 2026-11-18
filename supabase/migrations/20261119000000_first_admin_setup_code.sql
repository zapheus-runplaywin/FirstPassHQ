-- A new club's first admin, without a database script (Matt, 18 November
-- 2026: "We haven't yet solved how we can add the first admin to new clubs
-- other than a DB script").
--
-- Nobody inside a new club can approve its first admin, so until now someone
-- ran an UPDATE on profiles by hand. Instead:
--
-- - scripts/first-admin-code.sh, run by FirstPass when the club's database is
--   set up, makes a one-time setup code (issue_first_admin_code). Only its
--   hash is stored. It lasts 7 days unless told otherwise, and making a new
--   one cancels the last.
-- - The club's first admin signs in with Google or Apple and, on "Request to
--   join", enters the code (claim_first_admin). They become an approved admin.
-- - The code works once, and only while the club has no approved admin. Once
--   there is one, no code can be made or used: every later admin is approved
--   by an admin, as before. So a leaked code can never add a second admin or
--   take over a running club.
-- - Five wrong codes in an hour lock that sign-in out for the rest of the
--   hour. A wrong code comes back as a message, so the count is kept.
--
-- Additive only: two new tables and four new functions. No existing row or
-- function is changed.

begin;

create table if not exists public.club_setup_codes (
  id uuid primary key default gen_random_uuid(),
  -- sha256 of the code, as hex. The code itself is never stored.
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles (id) on delete set null,
  -- Set when a newer code replaced this one.
  cancelled_at timestamptz
);
alter table public.club_setup_codes enable row level security;
-- Only reached through the functions below.
revoke all on public.club_setup_codes from public, anon, authenticated;
grant all on public.club_setup_codes to service_role;

-- Wrong codes, to stop guessing.
create table if not exists public.club_setup_code_attempts (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists club_setup_code_attempts_profile_idx
  on public.club_setup_code_attempts (profile_id, attempted_at desc);
alter table public.club_setup_code_attempts enable row level security;
revoke all on public.club_setup_code_attempts from public, anon, authenticated;
grant all on public.club_setup_code_attempts to service_role;

-- Whether the club has an approved admin, by first or extra role.
create or replace function public.club_has_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where status = 'approved' and (role = 'admin' or 'admin' = any (extra_roles))
  );
$$;
revoke execute on function public.club_has_admin() from public, anon, authenticated;

-- Whether the join screen should offer "Setting up this club?": the club has
-- no admin yet and a setup code is waiting to be used.
create or replace function public.first_admin_setup_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and not public.club_has_admin()
    and exists (
      select 1 from public.club_setup_codes
      where used_at is null and cancelled_at is null and expires_at > now()
    );
$$;
revoke execute on function public.first_admin_setup_open() from public, anon;
grant execute on function public.first_admin_setup_open() to authenticated;

-- Makes the club's setup code and returns it, the only time it can be read.
-- Run by FirstPass with the database's own sign-in
-- (scripts/first-admin-code.sh), never from the app: no app role may call it.
create or replace function public.issue_first_admin_code(p_days integer default 7)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text := '';
  v_bytes bytea;
  v_byte int;
  i int;
begin
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'A setup code lasts between 1 and 30 days';
  end if;
  -- One at a time with claim_first_admin.
  perform pg_advisory_xact_lock(hashtext('first_admin_setup'));
  if public.club_has_admin() then
    raise exception 'This club already has an admin, who approves other admins from Members';
  end if;
  update public.club_setup_codes set cancelled_at = now()
  where used_at is null and cancelled_at is null;
  while length(v_code) < 12 loop
    v_bytes := extensions.gen_random_bytes(24);
    for i in 0..23 loop
      v_byte := get_byte(v_bytes, i);
      -- 31 letters: bytes 248 and over are skipped so every letter is as likely.
      if v_byte < 248 and length(v_code) < 12 then
        v_code := v_code || substr(v_alphabet, (v_byte % 31) + 1, 1);
      end if;
    end loop;
  end loop;
  insert into public.club_setup_codes (code_hash, expires_at)
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), now() + make_interval(days => p_days));
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end;
$$;
revoke execute on function public.issue_first_admin_code(integer) from public, anon, authenticated;

-- The signed-in person uses the setup code and becomes the club's first
-- admin. Returns null when it worked, or why not as a message: not raising,
-- so the count of wrong tries is kept.
create or replace function public.claim_first_admin(p_code text, p_full_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_name text := trim(coalesce(p_full_name, ''));
  v_row public.club_setup_codes;
  v_max_failures constant integer := 5;
  v_window constant interval := interval '1 hour';
  v_failures integer;
  v_oldest timestamptz;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in';
  end if;
  if not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
  ) then
    raise exception 'Confirm your email address before setting up the club';
  end if;
  if v_name = '' then
    raise exception 'Name is required';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep your name to 80 characters';
  end if;

  -- One at a time: two people with the code can't both become the first admin.
  perform pg_advisory_xact_lock(hashtext('first_admin_setup'));
  if public.club_has_admin() then
    return 'This club already has an admin. Ask to join below and they’ll approve you.';
  end if;

  select count(*), min(attempted_at) into v_failures, v_oldest
  from public.club_setup_code_attempts
  where profile_id = v_me.id and attempted_at > now() - v_window;
  if v_failures >= v_max_failures then
    return 'Too many wrong codes. Try again in '
      || greatest(1, ceil(extract(epoch from (v_oldest + v_window - now())) / 60))::integer
      || ' minutes.';
  end if;

  select c.* into v_row from public.club_setup_codes c
  where c.code_hash = encode(sha256(convert_to(v_code, 'UTF8')), 'hex')
    and c.used_at is null and c.cancelled_at is null and c.expires_at > now();
  if v_row.id is null then
    insert into public.club_setup_code_attempts (profile_id) values (v_me.id);
    return 'That setup code isn’t right, or it has expired. Check it with FirstPass.';
  end if;

  update public.profiles
  set role = 'admin', status = 'approved', full_name = v_name, rejection_reason = null
  where id = v_me.id;
  update public.club_setup_codes set used_at = now(), used_by = v_me.id where id = v_row.id;
  delete from public.club_setup_code_attempts where profile_id = v_me.id;
  return null;
end;
$$;
revoke execute on function public.claim_first_admin(text, text) from public, anon;
grant execute on function public.claim_first_admin(text, text) to authenticated;

commit;
