-- Parents and guardians of athletes under 17.
--
-- Guardians register like anyone else (with their PlayHQ email, so admins can
-- check them against PlayHQ registrations). An admin marks an athlete as
-- under 17 and links one or more approved guardians to them. Guardians are
-- placed in squads and teams like athletes, so they see the right calendars,
-- but they are left out of team rosters.

alter type public.team_role add value if not exists 'guardian';

alter table public.profiles
  add column under_17 boolean not null default false;

create table public.guardianships (
  guardian_id uuid not null references public.profiles (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guardian_id, athlete_id),
  check (guardian_id <> athlete_id)
);

create index guardianships_athlete_id_idx on public.guardianships (athlete_id);

-- Changed only through admin_save_member().
alter table public.guardianships enable row level security;

create policy "Guardians, their athletes and admins see guardianships"
  on public.guardianships for select to authenticated
  using (guardian_id = auth.uid() or athlete_id = auth.uid() or public.is_admin());

-- The athletes a guardian looks after, for their home screen. Guardians can't
-- read other profiles directly.
create function public.my_athletes()
returns table (profile_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
  from public.guardianships g
  join public.profiles p on p.id = g.athlete_id
  where g.guardian_id = auth.uid() and p.status = 'approved'
  order by p.full_name;
$$;

revoke execute on function public.my_athletes() from public, anon;
grant execute on function public.my_athletes() to authenticated;

-- ---------------------------------------------------------------------------
-- Saving a member: guardians can be placed in squads and teams, and athletes
-- can be marked under 17 and linked to their guardians.
-- ---------------------------------------------------------------------------

drop function public.admin_save_member(uuid, public.app_role, public.member_status, jsonb);

create function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb,
  p_under_17 boolean default false,
  p_guardian_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_role public.team_role;
  v_under_17 boolean := p_role = 'athlete' and coalesce(p_under_17, false);
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  if p_profile_id = auth.uid() and (p_role <> 'admin' or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
  end if;
  if jsonb_typeof(p_teams) <> 'array' then
    raise exception 'p_teams must be a JSON array';
  end if;
  if cardinality(v_guardian_ids) > 0 and not v_under_17 then
    raise exception 'Only athletes under 17 have guardians';
  end if;
  if p_profile_id = any (v_guardian_ids) then
    raise exception 'A member cannot be their own guardian';
  end if;
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    where not exists (
      select 1 from public.profiles p
      where p.id = g.id and p.role = 'guardian' and p.status = 'approved'
    )
  ) then
    raise exception 'Guardians must be approved members with the Guardian role';
  end if;

  update public.profiles
  set role = p_role, status = p_status, under_17 = v_under_17
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  -- Guardian links: replace this athlete's guardians, and drop links from
  -- anyone who is no longer an approved guardian.
  delete from public.guardianships where athlete_id = p_profile_id;
  if p_role <> 'guardian' or p_status <> 'approved' then
    delete from public.guardianships where guardian_id = p_profile_id;
  end if;
  if p_status = 'approved' then
    insert into public.guardianships (guardian_id, athlete_id)
    select distinct g.id, p_profile_id from unnest(v_guardian_ids) as g (id);
  end if;

  delete from public.team_members where profile_id = p_profile_id;

  if jsonb_array_length(p_teams) = 0 or p_status <> 'approved' then
    return;
  end if;
  if p_role not in ('coach', 'manager', 'athlete', 'guardian') then
    raise exception 'Only coaches, managers, athletes and guardians can be added to a squad or team';
  end if;
  v_team_role := p_role::text::public.team_role;

  -- Teams are named from a squad, so a member of a team must be in its squad.
  if exists (
    select 1
    from jsonb_array_elements(p_teams) as t
    join public.teams g on g.id = (t ->> 'team_id')::uuid
    where g.kind = 'team'
      and not exists (
        select 1 from jsonb_array_elements(p_teams) as s
        where (s ->> 'team_id')::uuid = g.squad_id
      )
  ) then
    raise exception 'Add them to the squad before naming them in one of its teams';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    g.id,
    p_profile_id,
    v_team_role,
    case when p_role = 'coach'
      then coalesce((t ->> 'coach_title')::public.coach_title, 'head_coach')
    end,
    case when p_role = 'athlete' and g.kind = 'team'
      then coalesce((t ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(p_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;
end;
$$;

revoke execute on function public.admin_save_member(uuid, public.app_role, public.member_status, jsonb, boolean, uuid[])
  from public, anon;
grant execute on function public.admin_save_member(uuid, public.app_role, public.member_status, jsonb, boolean, uuid[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- Guardians must give their PlayHQ email so admins can check them against
-- PlayHQ registrations.
-- ---------------------------------------------------------------------------

create or replace function public.submit_join_request(
  p_full_name text,
  p_playhq_email text,
  p_requested_role public.app_role,
  p_requested_team_id uuid,
  p_join_password text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select join_password_hash into v_hash from public.club_settings;
  if v_hash is not null
     and extensions.crypt(coalesce(trim(p_join_password), ''), v_hash) <> v_hash then
    raise exception 'That club password is not right. Ask a club admin for it.';
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Rosters list the team itself, not guardians.
-- ---------------------------------------------------------------------------

create or replace function public.team_roster(p_team_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  team_role public.team_role,
  coach_title public.coach_title,
  selection public.team_selection
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id, p.full_name, tm.team_role, tm.coach_title, tm.selection
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.team_id = p_team_id
    and p.status = 'approved'
    -- Compared as text: the enum value is new in this migration.
    and tm.team_role::text <> 'guardian'
    and (public.is_team_member(p_team_id) or public.is_admin())
  order by
    case tm.team_role::text when 'coach' then 0 when 'manager' then 1 else 2 end,
    case tm.coach_title when 'head_coach' then 0 else 1 end,
    case tm.selection when 'touring' then 0 when 'training_partner' then 1 else 2 end,
    p.full_name;
$$;
