-- Affiliation records: an optional feature for clubs and associations that
-- report to a governing body (Netball WA's Membership Policy, NWA-POL-07).
--
-- Off unless an admin turns on "Affiliation" in Club settings (stored as
-- club_settings.features.affiliation = true). Once on, admins keep:
-- - whether the club is an affiliated club or an association, and its tier;
-- - its incorporation number, who it is affiliated with and when it last
--   registered or signed the annual affiliation agreement;
-- - two primary contacts (approved adults);
-- - for associations, the officers the tier needs (President, Association
--   Development Officer, Association Umpire Development Officer, another
--   committee member, or one representative) and when each completed the
--   safeguarding induction;
-- - a tick for each criterion the app can't work out by itself;
-- - each season, whether every athlete, coach and manager is registered in
--   PlayHQ.
--
-- Nothing existing changes.
--
-- Additive only: new tables and functions. No rows change.

begin;

create table if not exists public.affiliation_settings (
  -- Always true: the table holds a single row.
  id boolean primary key default true check (id),
  member_type text not null default 'club' check (member_type in ('club', 'association')),
  tier int check (tier between 1 and 4),
  incorporation_number text check (length(incorporation_number) <= 60),
  affiliated_with text check (length(affiliated_with) <= 120),
  registered_on date,
  primary_contact_1_id uuid references public.profiles (id) on delete set null,
  primary_contact_2_id uuid references public.profiles (id) on delete set null,
  checks jsonb not null default '{}'::jsonb,
  notes text check (length(notes) <= 2000),
  updated_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.affiliation_settings default values on conflict (id) do nothing;

-- No policies: reached only through the functions below.
alter table public.affiliation_settings enable row level security;

create table if not exists public.affiliation_officers (
  office text primary key
    check (office in ('president', 'ado', 'audo', 'committee', 'representative')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  inducted_on date,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.affiliation_officers enable row level security;

create table if not exists public.playhq_registrations (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  season int not null,
  registered boolean not null,
  checked_at timestamptz not null default now(),
  checked_by uuid references public.profiles (id) on delete set null,
  primary key (profile_id, season)
);

alter table public.playhq_registrations enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The newest season with squads or teams that aren't archived.
create or replace function public.affiliation_season()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max(t.season) from public.teams t where not t.archived),
    (select max(t.season) from public.teams t)
  );
$$;

revoke execute on function public.affiliation_season() from public, anon;
grant execute on function public.affiliation_season() to authenticated;

-- Approved adults who aren't stood down.
create or replace function public.can_be_affiliation_contact(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.status = 'approved'
      and p.stood_down_at is null
      and not public.is_minor(p.date_of_birth, p.under_17)
  );
$$;

revoke execute on function public.can_be_affiliation_contact(uuid) from public, anon;
grant execute on function public.can_be_affiliation_contact(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create or replace function public.admin_affiliation()
returns table (
  member_type text,
  tier int,
  incorporation_number text,
  affiliated_with text,
  registered_on date,
  primary_contact_1_id uuid,
  primary_contact_1_name text,
  primary_contact_2_id uuid,
  primary_contact_2_name text,
  checks jsonb,
  notes text,
  updated_at timestamptz,
  updated_by_name text,
  season int,
  team_count int,
  registrations_total int,
  registered int,
  not_registered int
)
language sql
stable
security definer
set search_path = ''
as $$
  with season as (select public.affiliation_season() as s),
  people as (
    -- Athletes, coaches and managers in the season's squads and teams.
    select distinct m.profile_id
    from public.team_members m
    join public.teams t on t.id = m.team_id
    join public.profiles p on p.id = m.profile_id
    where t.season = (select s from season)
      and m.team_role in ('athlete', 'coach', 'manager')
      and p.status = 'approved'
  )
  select
    a.member_type,
    a.tier,
    a.incorporation_number,
    a.affiliated_with,
    a.registered_on,
    a.primary_contact_1_id,
    (select public.display_name(p) from public.profiles p where p.id = a.primary_contact_1_id),
    a.primary_contact_2_id,
    (select public.display_name(p) from public.profiles p where p.id = a.primary_contact_2_id),
    a.checks,
    a.notes,
    a.updated_at,
    (select public.display_name(p) from public.profiles p where p.id = a.updated_by),
    (select s from season),
    (select count(*) from public.teams t
     where t.kind = 'team' and t.season = (select s from season) and not t.archived)::int,
    (select count(*) from people)::int,
    (select count(*) from people x join public.playhq_registrations r
       on r.profile_id = x.profile_id and r.season = (select s from season) and r.registered)::int,
    (select count(*) from people x join public.playhq_registrations r
       on r.profile_id = x.profile_id and r.season = (select s from season) and not r.registered)::int
  from public.affiliation_settings a
  where a.id and public.is_admin();
$$;

revoke execute on function public.admin_affiliation() from public, anon;
grant execute on function public.admin_affiliation() to authenticated;

create or replace function public.admin_set_affiliation(
  p_member_type text,
  p_tier int,
  p_incorporation_number text,
  p_affiliated_with text,
  p_registered_on date,
  p_primary_contact_1_id uuid,
  p_primary_contact_2_id uuid,
  p_checks jsonb,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change affiliation records';
  end if;
  if p_member_type not in ('club', 'association') then
    raise exception 'Choose affiliated club or association';
  end if;
  if p_member_type = 'association' and (p_tier is null or p_tier not between 1 and 4) then
    raise exception 'Choose the association''s tier';
  end if;
  if p_registered_on is not null and p_registered_on > current_date then
    raise exception 'The registration date can''t be in the future';
  end if;
  if p_checks is null or jsonb_typeof(p_checks) <> 'object' then
    raise exception 'Checks must be a list of ticks';
  end if;
  for v_key in select jsonb_object_keys(p_checks) loop
    if jsonb_typeof(p_checks -> v_key) <> 'boolean' or length(v_key) > 40 then
      raise exception 'Check % must be ticked or not', v_key;
    end if;
  end loop;
  if (p_primary_contact_1_id is not null and not public.can_be_affiliation_contact(p_primary_contact_1_id))
     or (p_primary_contact_2_id is not null and not public.can_be_affiliation_contact(p_primary_contact_2_id)) then
    raise exception 'Primary contacts must be approved adults';
  end if;
  if p_primary_contact_1_id = p_primary_contact_2_id then
    raise exception 'Choose two different primary contacts';
  end if;

  update public.affiliation_settings
  set member_type = p_member_type,
      tier = case when p_member_type = 'association' then p_tier end,
      incorporation_number = nullif(trim(p_incorporation_number), ''),
      affiliated_with = nullif(trim(p_affiliated_with), ''),
      registered_on = p_registered_on,
      primary_contact_1_id = p_primary_contact_1_id,
      primary_contact_2_id = p_primary_contact_2_id,
      checks = p_checks,
      notes = nullif(trim(p_notes), ''),
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

revoke execute on function public.admin_set_affiliation(text, int, text, text, date, uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.admin_set_affiliation(text, int, text, text, date, uuid, uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Officers and their safeguarding induction
-- ---------------------------------------------------------------------------

create or replace function public.admin_affiliation_officers()
returns table (office text, profile_id uuid, name text, inducted_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select o.office, o.profile_id, public.display_name(p), o.inducted_on
  from public.affiliation_officers o
  join public.profiles p on p.id = o.profile_id
  where public.is_admin();
$$;

revoke execute on function public.admin_affiliation_officers() from public, anon;
grant execute on function public.admin_affiliation_officers() to authenticated;

-- Names someone to a position, or clears it when p_profile_id is null.
create or replace function public.admin_set_affiliation_officer(
  p_office text,
  p_profile_id uuid,
  p_inducted_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change affiliation records';
  end if;
  if p_office not in ('president', 'ado', 'audo', 'committee', 'representative') then
    raise exception 'Unknown office %', p_office;
  end if;
  if p_profile_id is null then
    delete from public.affiliation_officers where office = p_office;
    return;
  end if;
  if not public.can_be_affiliation_contact(p_profile_id) then
    raise exception 'Officers must be approved adults';
  end if;
  if p_inducted_on is not null and p_inducted_on > current_date then
    raise exception 'The induction date can''t be in the future';
  end if;
  insert into public.affiliation_officers (office, profile_id, inducted_on, updated_by)
  values (p_office, p_profile_id, p_inducted_on, auth.uid())
  on conflict (office) do update
  set profile_id = excluded.profile_id,
      inducted_on = excluded.inducted_on,
      updated_at = now(),
      updated_by = excluded.updated_by;
end;
$$;

revoke execute on function public.admin_set_affiliation_officer(text, uuid, date) from public, anon;
grant execute on function public.admin_set_affiliation_officer(text, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- PlayHQ registrations each season
-- ---------------------------------------------------------------------------

-- Every approved athlete, coach and manager in a season's squads and teams,
-- with whether an admin has found them registered in PlayHQ.
create or replace function public.admin_playhq_registrations(p_season int)
returns table (
  profile_id uuid,
  name text,
  playhq_email text,
  email text,
  team_roles text[],
  groups text[],
  registered boolean,
  checked_at timestamptz,
  checked_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    public.display_name(p),
    p.playhq_email,
    p.email,
    array_agg(distinct m.team_role::text order by m.team_role::text),
    array_agg(distinct t.name order by t.name),
    r.registered,
    r.checked_at,
    (select public.display_name(c) from public.profiles c where c.id = r.checked_by)
  from public.team_members m
  join public.teams t on t.id = m.team_id
  join public.profiles p on p.id = m.profile_id
  left join public.playhq_registrations r on r.profile_id = p.id and r.season = p_season
  where public.is_admin()
    and t.season = p_season
    and m.team_role in ('athlete', 'coach', 'manager')
    and p.status = 'approved'
  group by p.id, r.registered, r.checked_at, r.checked_by
  order by 2;
$$;

revoke execute on function public.admin_playhq_registrations(int) from public, anon;
grant execute on function public.admin_playhq_registrations(int) to authenticated;

create or replace function public.admin_set_playhq_registration(
  p_profile_id uuid,
  p_season int,
  p_registered boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can record PlayHQ registrations';
  end if;
  if p_registered is null then
    raise exception 'Choose registered or not registered';
  end if;
  if not exists (
    select 1 from public.team_members m
    join public.teams t on t.id = m.team_id
    where m.profile_id = p_profile_id and t.season = p_season
  ) then
    raise exception 'That member isn''t in a squad or team that season';
  end if;
  insert into public.playhq_registrations (profile_id, season, registered, checked_by)
  values (p_profile_id, p_season, p_registered, auth.uid())
  on conflict (profile_id, season) do update
  set registered = excluded.registered,
      checked_at = now(),
      checked_by = excluded.checked_by;
end;
$$;

revoke execute on function public.admin_set_playhq_registration(uuid, int, boolean) from public, anon;
grant execute on function public.admin_set_playhq_registration(uuid, int, boolean) to authenticated;

commit;
