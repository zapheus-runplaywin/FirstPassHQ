-- Thunder app: initial schema.
-- Run once in the Supabase dashboard (SQL Editor) or with `supabase db push`.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.app_role as enum (
  'admin', 'coach', 'manager', 'athlete', 'committee', 'partner', 'guardian', 'guest'
);

create type public.member_status as enum ('pending', 'approved', 'rejected');

-- Roles a person can hold inside a team or squad.
create type public.team_role as enum ('coach', 'manager', 'athlete');

create type public.coach_title as enum ('head_coach', 'assistant_coach');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- One row per signed-in user, created automatically on first sign-in.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  -- PlayHQ registered email, when it differs from the sign-in identity.
  playhq_email text,
  role public.app_role not null default 'guest',
  status public.member_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  team_role public.team_role not null,
  -- Only set for coaches. Assistant coaches share head coach permissions for now.
  coach_title public.coach_title,
  created_at timestamptz not null default now(),
  primary key (team_id, profile_id),
  constraint coach_title_only_for_coaches
    check (coach_title is null or team_role = 'coach')
);

create index team_members_profile_id_idx on public.team_members (profile_id);

-- ---------------------------------------------------------------------------
-- Seed the club's teams and squads
-- ---------------------------------------------------------------------------

insert into public.teams (name, sort_order) values
  ('Lightning Academy', 1),
  ('17 & Under', 2),
  ('20 & Under', 3),
  ('Open A', 4),
  ('Open', 5),
  ('Open Mixed', 6);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- security definer so RLS policies can call it without recursing into profiles.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: nothing is readable unless a policy allows it.
-- ---------------------------------------------------------------------------

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.team_members enable row level security;

create policy "Signed-in users can see teams"
  on public.teams for select to authenticated
  using (true);

create policy "Admins manage teams"
  on public.teams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Users see their own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Users may only change their name and PlayHQ email. Role and status are
-- changed by admins through dedicated functions (added with the approvals step).
revoke update on public.profiles from authenticated, anon;
grant update (full_name, playhq_email) on public.profiles to authenticated;

create policy "Users see their own team memberships"
  on public.team_members for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

create policy "Admins manage team memberships"
  on public.team_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
