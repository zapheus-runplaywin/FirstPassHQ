-- Security review, 12 October 2026: closes the gaps a signed-in account could
-- use against the club. Nothing here removes data.
--
-- 1. Guessing the club password: five wrong tries lock the account out of
--    joining for 15 minutes, and the password is hashed with a higher bcrypt
--    cost from the next time an admin sets it.
-- 2. Spamming admins' phones: a member who asks to join again and again now
--    notifies admins at most once an hour.
-- 3. Approved members could still change their own name and PlayHQ email
--    straight in the table, so a member could rename themselves to look like a
--    coach or committee member on messages and records. The app never did this
--    (names come from the join form and Your details), so the direct update
--    goes away. Admins still edit members through admin_save_member.
-- 4. is_admin() was the one helper still callable by signed-out visitors (it
--    returns false for them, but it's closed for consistency), and
--    touch_updated_at() gets the search_path every other function has.
-- 5. A join request needs a confirmed email (Google sign-in always has one)
--    and a name of at most 80 characters.

begin;

-- ---------------------------------------------------------------------------
-- 1. Club password: lock-out after repeated wrong tries
-- ---------------------------------------------------------------------------

create table if not exists public.join_password_attempts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  failures integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.join_password_attempts enable row level security;
-- Only reached through submit_join_request below.
revoke all on public.join_password_attempts from public, anon, authenticated;

-- A wrong password is now reported by returning the message instead of
-- raising, because raising would roll back the count of wrong tries along
-- with everything else. Null means the request went through.
drop function public.submit_join_request(text, text, public.app_role, uuid, text);

create function public.submit_join_request(
  p_full_name text,
  p_playhq_email text,
  p_requested_role public.app_role,
  p_requested_team_id uuid,
  p_join_password text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_attempt public.join_password_attempts;
  v_max_failures constant integer := 5;
  v_lockout constant interval := interval '15 minutes';
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  -- Admins match people to PlayHQ by this email, so it must be one the
  -- person actually controls.
  if not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
  ) then
    raise exception 'Confirm your email address before asking to join';
  end if;
  if char_length(coalesce(trim(p_full_name), '')) > 80 then
    raise exception 'Keep your name to 80 characters';
  end if;
  select join_password_hash into v_hash from public.club_settings;
  if v_hash is not null then
    select * into v_attempt from public.join_password_attempts where profile_id = auth.uid();
    if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
      return 'Too many wrong club passwords. Try again in '
        || ceil(extract(epoch from (v_attempt.locked_until - now())) / 60)::integer
        || ' minutes.';
    end if;
    if extensions.crypt(coalesce(trim(p_join_password), ''), v_hash) <> v_hash then
      insert into public.join_password_attempts as a (profile_id, failures, locked_until, updated_at)
      values (
        auth.uid(),
        1,
        null,
        now()
      )
      on conflict (profile_id) do update
        set failures = case
              when a.locked_until is not null and a.locked_until <= now() then 1
              else a.failures + 1
            end,
            locked_until = case
              when a.locked_until is not null and a.locked_until <= now() then null
              when a.failures + 1 >= v_max_failures then now() + v_lockout
              else null
            end,
            updated_at = now();
      return 'That club password is not right. Ask a club admin for it.';
    end if;
    -- A right password clears the count.
    delete from public.join_password_attempts where profile_id = auth.uid();
  end if;
  if p_requested_role = 'admin' then
    raise exception 'Admin access cannot be requested';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;
  if p_requested_role = 'guardian' and coalesce(trim(p_playhq_email), '') = '' then
    raise exception 'Guardians need to give the email they used to register with PlayHQ';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      playhq_email = nullif(lower(trim(p_playhq_email)), ''),
      requested_role = p_requested_role,
      requested_team_id = p_requested_team_id,
      join_requested_at = now(),
      -- A rejected member can ask again.
      status = case when status = 'rejected' then 'pending'::public.member_status else status end
  where id = auth.uid() and status <> 'approved';
  return null;
end;
$$;

revoke execute on function public.submit_join_request(text, text, public.app_role, uuid, text)
  from public, anon;
grant execute on function public.submit_join_request(text, text, public.app_role, uuid, text)
  to authenticated;

-- Same as before, with a bcrypt cost of 10 (the default is 6).
create or replace function public.admin_set_join_password(p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can set the club password';
  end if;
  update public.club_settings
  set join_password_hash = case
    when coalesce(trim(p_password), '') = '' then null
    else extensions.crypt(trim(p_password), extensions.gen_salt('bf', 10))
  end
  where id;
end;
$$;

revoke execute on function public.admin_set_join_password(text) from public, anon;
grant execute on function public.admin_set_join_password(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Admins hear about a member's join request at most once an hour
-- ---------------------------------------------------------------------------

drop trigger if exists profiles_notify_admins_of_join_request on public.profiles;
create trigger profiles_notify_admins_of_join_request
  after update of join_requested_at on public.profiles
  for each row
  when (
    new.join_requested_at is not null
    and new.join_requested_at is distinct from old.join_requested_at
    and new.status = 'pending'
    and (old.join_requested_at is null or old.join_requested_at < now() - interval '1 hour')
  )
  execute function public.notify_admins_of_join_request();

-- ---------------------------------------------------------------------------
-- 3. Members no longer change their own name or PlayHQ email directly
-- ---------------------------------------------------------------------------

drop policy if exists "Users update their own profile" on public.profiles;
revoke update on public.profiles from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. Tidy-ups
-- ---------------------------------------------------------------------------

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

commit;
