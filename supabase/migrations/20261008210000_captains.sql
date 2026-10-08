-- Club captains, and a captain and vice captains for each squad or team.
--
-- Matt (2026-10-08): admins pick the athletes who are club captains, and
-- club captains can message the whole club. Each team has a captain and
-- vice captains, who can message their team like its coaches.
--
-- - Club captains are chosen for a season. They can message the club while
--   that season is current (not archived).
-- - A squad or team's captains are chosen by admins or that group's coaches.
--   Groups belong to one season, so captaincy ends when the season is
--   archived. Captains must be athletes in the group, and only count while
--   they still are.
-- - Captains can be under 18. Their messages copy guardians of minor
--   recipients as before, and now also copy the approved guardians of a
--   minor sender, so parents see what their child sends.
--
-- Additive only: two new tables, new functions and two replaced functions.
-- No existing rows change.

begin;

create type public.captain_role as enum ('captain', 'vice_captain');

create table if not exists public.club_captains (
  season int not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (season, profile_id)
);

create table if not exists public.team_captains (
  team_id uuid not null references public.teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  captain_role public.captain_role not null,
  created_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);

-- One captain per group; any number of vice captains.
create unique index if not exists team_captains_one_captain_idx
  on public.team_captains (team_id) where captain_role = 'captain';

create index if not exists team_captains_profile_idx on public.team_captains (profile_id);
create index if not exists club_captains_profile_idx on public.club_captains (profile_id);

-- Written only through the functions below.
alter table public.club_captains enable row level security;
alter table public.team_captains enable row level security;

-- Anyone in the club can see who the club captains are.
create policy "Members see club captains"
  on public.club_captains for select to authenticated
  using (public.is_approved());

-- Group captains are shown on the roster, so the same people see them.
create policy "Group members and admins see group captains"
  on public.team_captains for select to authenticated
  using (public.is_admin() or public.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- Who is a captain
-- ---------------------------------------------------------------------------

-- A club captain for a season that is still current, and still an approved
-- athlete.
create or replace function public.is_club_captain()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_captains cc
    join public.profiles p on p.id = cc.profile_id
    where cc.profile_id = auth.uid()
      and p.status = 'approved'
      and p.role = 'athlete'
      and exists (
        select 1 from public.teams t where t.season = cc.season and not t.archived
      )
  );
$$;

revoke execute on function public.is_club_captain() from public, anon;
grant execute on function public.is_club_captain() to authenticated;

-- A captain or vice captain of the group who is still an athlete in it.
create or replace function public.is_group_captain(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_captains tc
    join public.team_members tm
      on tm.team_id = tc.team_id and tm.profile_id = tc.profile_id and tm.team_role = 'athlete'
    join public.profiles p on p.id = tc.profile_id
    join public.teams t on t.id = tc.team_id
    where tc.team_id = p_team_id
      and tc.profile_id = auth.uid()
      and p.status = 'approved'
      and not t.archived
  );
$$;

revoke execute on function public.is_group_captain(uuid) from public, anon;
grant execute on function public.is_group_captain(uuid) to authenticated;

-- Admins can message any squad or team; coaches and managers the ones they
-- coach or manage; captains and vice captains the one they captain.
create or replace function public.can_message_group(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.is_group_captain(p_team_id) or exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role in ('coach', 'manager')
      and p.status = 'approved'
  );
$$;

revoke execute on function public.can_message_group(uuid) from public, anon;
grant execute on function public.can_message_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Choosing captains
-- ---------------------------------------------------------------------------

-- Admins only. Replaces the season's club captains with these athletes.
create or replace function public.admin_set_club_captains(p_season int, p_profile_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_profile_ids, '{}');
begin
  if not public.is_admin() then
    raise exception 'Only admins can choose club captains';
  end if;
  if not exists (select 1 from public.teams where season = p_season and not archived) then
    raise exception 'Choose a current season';
  end if;
  if exists (
    select 1 from unnest(v_ids) as i(id)
    where not exists (
      select 1 from public.profiles p
      where p.id = i.id and p.status = 'approved' and p.role = 'athlete'
    )
  ) then
    raise exception 'Club captains must be approved athletes';
  end if;

  delete from public.club_captains
  where season = p_season and not (profile_id = any (v_ids));

  insert into public.club_captains (season, profile_id)
  select p_season, i.id from unnest(v_ids) as i(id)
  on conflict (season, profile_id) do nothing;
end;
$$;

revoke execute on function public.admin_set_club_captains(int, uuid[]) from public, anon;
grant execute on function public.admin_set_club_captains(int, uuid[]) to authenticated;

-- Approved athletes in the season's squads and teams, plus anyone already a
-- club captain for it, for the admin Club captains screen.
create or replace function public.club_captain_choices(p_season int)
returns table (profile_id uuid, full_name text, is_captain boolean, is_minor boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name,
    exists (
      select 1 from public.club_captains cc
      where cc.season = p_season and cc.profile_id = p.id
    ),
    public.is_minor(p.date_of_birth, p.under_17)
  from public.profiles p
  where public.is_admin()
    and p.status = 'approved'
    and p.role = 'athlete'
    and (
      exists (
        select 1 from public.team_members tm
        join public.teams t on t.id = tm.team_id
        where tm.profile_id = p.id and tm.team_role = 'athlete' and t.season = p_season
      )
      or exists (
        select 1 from public.club_captains cc
        where cc.season = p_season and cc.profile_id = p.id
      )
    )
  order by p.full_name;
$$;

revoke execute on function public.club_captain_choices(int) from public, anon;
grant execute on function public.club_captain_choices(int) to authenticated;

-- Admins and the group's coaches. Sets the captain (or none) and vice
-- captains; both must be athletes in the group.
create or replace function public.set_group_captains(
  p_team_id uuid,
  p_captain_id uuid,
  p_vice_captain_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vice uuid[] := coalesce(p_vice_captain_ids, '{}');
  v_all uuid[];
begin
  if not exists (select 1 from public.teams where id = p_team_id and not archived) then
    raise exception 'Choose a current squad or team';
  end if;
  if not (public.is_admin() or exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role = 'coach'
      and p.status = 'approved'
  )) then
    raise exception 'Only admins and this group''s coaches can choose its captains';
  end if;
  if p_captain_id is not null and p_captain_id = any (v_vice) then
    raise exception 'The captain can''t also be a vice captain';
  end if;

  v_all := v_vice || case when p_captain_id is null then '{}'::uuid[] else array[p_captain_id] end;
  if exists (
    select 1 from unnest(v_all) as i(id)
    where not exists (
      select 1 from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = p_team_id and tm.profile_id = i.id
        and tm.team_role = 'athlete' and p.status = 'approved'
    )
  ) then
    raise exception 'Captains must be athletes in this squad or team';
  end if;

  delete from public.team_captains where team_id = p_team_id;

  insert into public.team_captains (team_id, profile_id, captain_role)
  select p_team_id, i.id, 'vice_captain'::public.captain_role
  from (select distinct unnest(v_vice) as id) i;

  if p_captain_id is not null then
    insert into public.team_captains (team_id, profile_id, captain_role)
    values (p_team_id, p_captain_id, 'captain');
  end if;
end;
$$;

revoke execute on function public.set_group_captains(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.set_group_captains(uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

-- Same as before, plus club captains can message the whole club, and the
-- guardians of a minor sender get a copy of what they send.
create or replace function public.send_group_message(
  p_body text,
  p_audience public.message_audience,
  p_role public.app_role default null,
  p_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_sender public.profiles;
  v_team public.teams;
  v_message_id uuid;
  v_count int;
begin
  select * into v_sender from public.profiles where id = auth.uid();
  if v_sender.id is null or v_sender.status <> 'approved' then
    raise exception 'Only approved members can send messages';
  end if;
  if v_body = '' then
    raise exception 'Write a message first';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Messages can be up to 4000 characters';
  end if;

  if p_audience = 'club' then
    -- is_committee() is true for admins too.
    if not (public.is_committee() or public.is_club_captain()) then
      raise exception 'Only admins, the committee and club captains can message the whole club';
    end if;
  elsif p_audience = 'role' then
    if not public.is_admin() then
      raise exception 'Only admins can message a role';
    end if;
    if p_role is null then
      raise exception 'Choose a role to message';
    end if;
    if p_role = 'guest' then
      raise exception 'Guests don''t get messages';
    end if;
  else
    select * into v_team from public.teams where id = p_team_id and not archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team to message';
    end if;
    if not public.can_message_group(v_team.id) then
      raise exception 'You can only message squads and teams you coach, manage or captain';
    end if;
  end if;

  insert into public.messages (
    sender_id, sender_name, body, audience, audience_role, team_id, audience_label
  )
  values (
    v_sender.id,
    coalesce(nullif(v_sender.full_name, ''), v_sender.email),
    v_body,
    p_audience,
    case when p_audience = 'role' then p_role end,
    v_team.id,
    v_team.name
  )
  returning id into v_message_id;

  with audience as (
    select p.id, p.role, p.date_of_birth, p.under_17
    from public.profiles p
    where p.status = 'approved'
      and (not public.is_view_only_role(p.role)
        or (p.role = 'physio' and (p_audience = 'role'
          or (p_audience = 'club' and public.physios_get_club_messages()))))
      and case p_audience
        when 'club' then true
        when 'role' then p.role = p_role
        else exists (
          select 1 from public.team_members tm
          where tm.team_id = v_team.id and tm.profile_id = p.id
        )
      end
  )
  insert into public.message_recipients (message_id, profile_id)
  select v_message_id, r.id
  from (
    select a.id from audience a
    union
    -- Guardians of children who received it.
    select g.guardian_id
    from audience a
    join public.guardianships g on g.athlete_id = a.id
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where a.role = 'athlete' and public.is_minor(a.date_of_birth, a.under_17)
  ) r
  where r.id <> v_sender.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the message too.
    raise exception 'Nobody else is in that group yet';
  end if;

  -- Guardians of a child who sends a message (a captain) get a copy too.
  if v_sender.role = 'athlete' and public.is_minor(v_sender.date_of_birth, v_sender.under_17) then
    insert into public.message_recipients (message_id, profile_id)
    select v_message_id, g.guardian_id
    from public.guardianships g
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where g.athlete_id = v_sender.id
    on conflict (message_id, profile_id) do nothing;
  end if;

  return v_message_id;
end;
$$;

revoke execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid)
  from public, anon;
grant execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid)
  to authenticated;

commit;
