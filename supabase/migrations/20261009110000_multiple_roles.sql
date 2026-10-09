-- Members can hold more than one role.
--
-- Until now each member had one club role (profiles.role). Matt's role matrix
-- (2026-10-09) lets people combine roles, such as a coach who is also a parent:
--
--   * Guests can't have any other role.
--   * Admins can also be a coach, manager, physio, committee member or
--     guardian, but not an athlete.
--   * Athletes can't also be a manager or a physio, and can only coach a squad
--     or team they don't play in.
--   * Athletes under 18 can only add Coach. Guardians must be 18 or over.
--   * Nobody endorses or accepts an injury clearance for themselves or their
--     own child, and whoever endorsed a clearance can't also accept it.
--
-- profiles.role stays the member's main role (what they asked to join as, and
-- what the app shows first). Other roles go in the new profiles.extra_roles.
-- Every check that asked "is their role X" now asks "do they hold X".
--
-- One new column with an empty default and one new trigger on new team places.
-- Nothing here changes or removes existing rows. Functions are replaced in
-- place; admin_save_member gets an extra argument, so the old version is
-- dropped and recreated.

begin;

-- ---------------------------------------------------------------------------
-- Extra roles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists extra_roles public.app_role[] not null default '{}';

-- Every role a member holds: their main role first.
create or replace function public.roles_of(p_role public.app_role, p_extra public.app_role[])
returns public.app_role[]
language sql
immutable
set search_path = ''
as $$
  select array[p_role] || coalesce(
    array(select distinct r from unnest(p_extra) as r where r <> p_role), '{}'
  );
$$;
revoke execute on function public.roles_of(public.app_role, public.app_role[]) from public, anon;
grant execute on function public.roles_of(public.app_role, public.app_role[]) to authenticated;

-- Whether the signed-in, approved member holds a role.
create or replace function public.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
      and (role = p_role or p_role = any (extra_roles))
  );
$$;
revoke execute on function public.has_role(public.app_role) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;

-- Only physios (and guests) are view-only, and only when that's all they are.
create or replace function public.is_view_only_member(
  p_role public.app_role,
  p_extra public.app_role[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.is_view_only_role(p_role)
    and coalesce(p_extra, '{}') <@ array['guest', 'physio']::public.app_role[];
$$;
revoke execute on function public.is_view_only_member(public.app_role, public.app_role[]) from public, anon;
grant execute on function public.is_view_only_member(public.app_role, public.app_role[]) to authenticated;

-- Why a set of roles can't go together, or null when they can.
create or replace function public.role_combination_problem(
  p_roles public.app_role[],
  p_date_of_birth date,
  p_under_18 boolean
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when 'partner' = any (p_roles)
      then 'The Partner role has been removed. Use Guest instead.'
    when 'guest' = any (p_roles) and cardinality(p_roles) > 1
      then 'Guests can''t have another role'
    when 'admin' = any (p_roles) and 'athlete' = any (p_roles)
      then 'Admins can''t also be athletes'
    when 'athlete' = any (p_roles) and 'manager' = any (p_roles)
      then 'Athletes can''t also be managers'
    when 'athlete' = any (p_roles) and 'physio' = any (p_roles)
      then 'Athletes can''t also be physios'
    when 'athlete' = any (p_roles) and public.is_minor(p_date_of_birth, p_under_18)
      and not p_roles <@ array['athlete', 'coach']::public.app_role[]
      then 'Athletes under 18 can only also be a coach'
    when 'guardian' = any (p_roles) and p_date_of_birth is not null
      and public.is_minor(p_date_of_birth, false)
      then 'Parents and guardians must be 18 or over'
  end;
$$;
revoke execute on function public.role_combination_problem(public.app_role[], date, boolean) from public, anon;
grant execute on function public.role_combination_problem(public.app_role[], date, boolean) to authenticated;

-- Nobody coaches a squad or team they play in, or one of its teams.
create or replace function public.check_coach_athlete_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.team_role in ('coach', 'athlete') and exists (
    select 1
    from public.team_members m
    join public.teams t on t.id = m.team_id
    join public.teams nt on nt.id = new.team_id
    where m.profile_id = new.profile_id
      and m.team_id <> new.team_id
      and m.team_role in ('coach', 'athlete')
      and m.team_role <> new.team_role
      and not t.archived
      and coalesce(t.squad_id, t.id) = coalesce(nt.squad_id, nt.id)
  ) then
    raise exception 'Athletes can only coach a squad or team they don''t play in';
  end if;
  return new;
end;
$$;

drop trigger if exists team_members_coach_athlete_groups on public.team_members;
create trigger team_members_coach_athlete_groups
  before insert or update of team_id, team_role on public.team_members
  for each row execute function public.check_coach_athlete_groups();

-- Partner can't come back as an extra role either.
create or replace function public.reject_partner_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'partner' or new.requested_role = 'partner'
     or 'partner' = any (new.extra_roles) then
    raise exception 'The Partner role has been removed. Use Guest instead.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Role checks for the signed-in member
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('admin');
$$;

create or replace function public.is_committee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('committee') or public.has_role('admin');
$$;

create or replace function public.is_physio()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('physio');
$$;

create or replace function public.is_attendance_taker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_committee() or (
    public.is_approved() and (
      public.has_role('coach') or public.has_role('manager')
      or exists (
        select 1 from public.team_members
        where profile_id = auth.uid() and team_role in ('coach', 'manager')
      )
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Athletes
-- ---------------------------------------------------------------------------

create or replace function public.acts_for_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and exists (
      select 1 from public.profiles
      where id = p_athlete_id and status = 'approved'
        and (role = 'athlete' or 'athlete' = any (extra_roles))
    )
    and (p_athlete_id = auth.uid() or public.is_guardian_of(p_athlete_id));
$$;

create or replace function public.can_report_for(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and exists (
      select 1 from public.profiles
      where id = p_athlete_id and status = 'approved'
        and (role = 'athlete' or 'athlete' = any (extra_roles))
    )
    and (p_athlete_id = auth.uid() or public.is_guardian_of(p_athlete_id));
$$;

create or replace function public.is_club_athlete(p_profile_id uuid)
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
      and (
        p.role = 'athlete' or 'athlete' = any (p.extra_roles)
        or exists (
          select 1 from public.team_members tm
          join public.teams t on t.id = tm.team_id
          where tm.profile_id = p.id and tm.team_role = 'athlete' and not t.archived
        )
      )
  );
$$;

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
      and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
      and exists (
        select 1 from public.teams t where t.season = cc.season and not t.archived
      )
  );
$$;

create or replace function public.club_captain_choices(p_season integer)
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
    and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
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

create or replace function public.admin_set_club_captains(p_season integer, p_profile_ids uuid[])
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
      where p.id = i.id and p.status = 'approved'
        and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
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

create or replace function public.save_check_in(
  p_day date,
  p_sleep integer,
  p_soreness integer,
  p_stress integer,
  p_mood integer,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_role('athlete') then
    raise exception 'Only athletes can check in.';
  end if;
  if p_day is null or p_day not between current_date - 1 and current_date + 1 then
    raise exception 'You can only check in for today.';
  end if;

  insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note)
  values (auth.uid(), p_day, p_sleep, p_soreness, p_stress, p_mood, nullif(trim(p_note), ''))
  on conflict (athlete_id, day) do update
    set sleep = excluded.sleep,
        soreness = excluded.soreness,
        stress = excluded.stress,
        mood = excluded.mood,
        note = excluded.note
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Injury clearances: never for yourself or your own child
-- ---------------------------------------------------------------------------

create or replace function public.endorse_clearance(p_injury_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null
    or not (public.coaches_athlete(v_injury.athlete_id) or public.is_physio()) then
    raise exception 'Only the athlete’s coaches or a physio can endorse clearance';
  end if;
  if v_injury.status <> 'clearance_requested' then
    raise exception 'This injury isn’t waiting for a coach or physio';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t endorse your own clearance';
  end if;
  if public.is_guardian_of(v_injury.athlete_id) then
    raise exception 'You can’t endorse your own child’s clearance. Ask another coach or a physio.';
  end if;

  update public.injuries
  set status = 'coach_endorsed', coach_endorsed_by = auth.uid(), coach_endorsed_at = now()
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'coach_endorsed', nullif(trim(p_notes), '')
  );
end;
$$;

create or replace function public.accept_clearance(p_injury_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null or not public.is_committee() then
    raise exception 'Only the committee can accept clearance';
  end if;
  if v_injury.status <> 'coach_endorsed' then
    raise exception 'A coach needs to endorse this first';
  end if;
  if v_injury.coach_endorsed_by = auth.uid() or v_injury.athlete_id = auth.uid() then
    raise exception 'Someone other than the endorsing coach needs to accept this';
  end if;
  if public.is_guardian_of(v_injury.athlete_id) then
    raise exception 'You can’t accept your own child’s clearance. Ask another committee member.';
  end if;

  update public.injuries
  set status = 'cleared', cleared_by = auth.uid(), cleared_at = now()
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'cleared', nullif(trim(p_notes), '')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

create or replace function public.is_message_recipient(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.message_recipients
    where message_id = p_message_id and profile_id = auth.uid()
  ) and not exists (
    -- Guests never see messages, including ones from before. Members who are
    -- only physios see messages to their role, and whole-club messages only
    -- while admins send them those.
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'guest' or (
        public.is_view_only_member(role, extra_roles)
        and not public.physios_get_club_messages()
        and not exists (
          select 1 from public.messages m
          where m.id = p_message_id and m.audience = 'role' and m.audience_role = 'physio'
        )
      ))
  );
$$;

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
    select p.id, p.role, p.extra_roles, p.date_of_birth, p.under_17
    from public.profiles p
    where p.status = 'approved'
      and p.role <> 'guest'
      and (not public.is_view_only_member(p.role, p.extra_roles)
        or p_audience = 'role'
        or (p_audience = 'club' and public.physios_get_club_messages()))
      and case p_audience
        when 'club' then true
        when 'role' then p.role = p_role or p_role = any (p.extra_roles)
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
    where (a.role = 'athlete' or 'athlete' = any (a.extra_roles))
      and public.is_minor(a.date_of_birth, a.under_17)
  ) r
  where r.id <> v_sender.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the message too.
    raise exception 'Nobody else is in that group yet';
  end if;

  -- Guardians of a child who sends a message (a captain or junior coach) get a copy too.
  if (v_sender.role = 'athlete' or 'athlete' = any (v_sender.extra_roles))
     and public.is_minor(v_sender.date_of_birth, v_sender.under_17) then
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

-- ---------------------------------------------------------------------------
-- Awards
-- ---------------------------------------------------------------------------

create or replace function public.award_voters(p_award_id uuid, p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.awards a
  join public.profiles p
    on p.status = 'approved' and not public.is_view_only_member(p.role, p.extra_roles)
  where a.id = p_award_id
    and (
      'member' = any (a.voter_roles)
      -- Committee, admin and partner aren't tied to a group.
      or exists (
        select 1 from unnest(public.roles_of(p.role, p.extra_roles)) as r
        where r::text = any (a.voter_roles)
          and (a.club_wide or r in ('committee', 'admin', 'partner'))
      )
      or exists (
        select 1 from public.team_members tm
        where tm.profile_id = p.id
          and tm.team_role::text = any (a.voter_roles)
          and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------

create or replace function public.admin_safety_todos()
returns table (
  wwcc_missing integer,
  wwcc_expiring integer,
  minors_without_guardian integer,
  turning_18 integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select p.*, public.roles_of(p.role, p.extra_roles) as roles
    from public.profiles p
    where p.status = 'approved' and public.is_admin()
  )
  select
    count(*) filter (
      where m.roles && array['coach', 'manager', 'physio']::public.app_role[]
        and not public.has_current_wwcc(m.id)
    )::int,
    count(*) filter (
      where m.roles && array['coach', 'manager', 'physio']::public.app_role[]
        and public.has_current_wwcc(m.id)
        and m.wwcc_expires_on < current_date + 30
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and public.is_minor(m.date_of_birth, m.under_17)
        and not exists (select 1 from public.guardianships g where g.athlete_id = m.id)
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is not null
        and public.is_minor(m.date_of_birth, m.under_17)
        and m.date_of_birth <= current_date - interval '18 years' + interval '30 days'
    )::int
  from members m;
$$;

create or replace function public.delete_member_now(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Member not found';
  end if;
  -- The club always keeps at least one admin.
  if exists (
    select 1 from public.profiles
    where id = p_profile_id and status = 'approved'
      and (role = 'admin' or 'admin' = any (extra_roles))
  ) and not exists (
    select 1 from public.profiles
    where id <> p_profile_id and status = 'approved'
      and (role = 'admin' or 'admin' = any (extra_roles))
  ) then
    raise exception 'This is the club’s only admin. Make someone else an admin first.';
  end if;

  delete from auth.users where id = p_profile_id;
  -- In case the sign-in was already gone.
  delete from public.profiles where id = p_profile_id;
end;
$$;

create or replace function public.notify_admins_of_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', 'New request to join',
    'body', coalesce(nullif(new.full_name, ''), new.email, 'Someone')
      || ' asked to join as '
      || coalesce(initcap(new.requested_role::text), 'a member')
      || '.',
    'data', jsonb_build_object('memberId', new.id),
    'sound', 'default',
    'channelId', 'join-requests'
  ))
  into v_messages
  from public.push_tokens t
  join public.profiles p on p.id = t.profile_id
  where (p.role = 'admin' or 'admin' = any (p.extra_roles))
    and p.status = 'approved' and p.id <> new.id;

  if v_messages is not null then
    -- Sent in the background once the transaction commits.
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_messages,
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
  end if;
  return new;
end;
$$;

-- Titles belong to anyone who holds the Committee or Admin role.
create or replace function public.save_my_details(
  p_preferred_name text,
  p_title text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preferred_name text := nullif(trim(coalesce(p_preferred_name, '')), '');
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Sign in first';
  end if;
  if char_length(v_preferred_name) > 40 then
    raise exception 'Keep your preferred name to 40 characters';
  end if;
  if char_length(v_title) > 40 then
    raise exception 'Keep your title to 40 characters';
  end if;

  if public.is_committee() then
    update public.profiles
    set preferred_name = v_preferred_name, title = v_title
    where id = auth.uid();
  else
    if v_title is not null then
      raise exception 'Only committee members and admins have a title';
    end if;
    update public.profiles set preferred_name = v_preferred_name where id = auth.uid();
  end if;
end;
$$;

create or replace function public.admin_set_member_title(p_profile_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if char_length(v_title) > 40 then
    raise exception 'Keep the title to 40 characters';
  end if;
  if v_title is not null and not (
    public.roles_of(v_member.role, v_member.extra_roles)
      && array['committee', 'admin']::public.app_role[]
  ) then
    raise exception 'Only committee members and admins have a title';
  end if;
  update public.profiles set title = v_title where id = p_profile_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Saving a member: main role, extra roles and a role in each squad or team
-- ---------------------------------------------------------------------------

drop function if exists public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason
);

-- p_teams is a list of {team_id, team_role?, coach_title?, selection?}. A
-- missing team_role means their main role, or their first other role that
-- belongs in a squad or team.
create or replace function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb,
  p_under_17 boolean default false,
  p_guardian_ids uuid[] default '{}',
  p_rejection_reason public.rejection_reason default null,
  p_extra_roles public.app_role[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles public.app_role[] := public.roles_of(p_role, coalesce(p_extra_roles, '{}'));
  v_extra public.app_role[];
  v_default_team_role public.team_role;
  v_placements jsonb;
  v_date_of_birth date;
  v_under_17 boolean;
  v_problem text;
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  v_extra := v_roles[2:];
  select date_of_birth into v_date_of_birth from public.profiles where id = p_profile_id;
  v_under_17 := 'athlete' = any (v_roles) and public.is_minor(v_date_of_birth, p_under_17);

  if p_profile_id = auth.uid() and (not 'admin' = any (v_roles) or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
  end if;
  v_problem := public.role_combination_problem(v_roles, v_date_of_birth, p_under_17);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  if jsonb_typeof(p_teams) <> 'array' then
    raise exception 'p_teams must be a JSON array';
  end if;
  if cardinality(v_guardian_ids) > 0 and not v_under_17 then
    raise exception 'Only athletes under 18 have guardians';
  end if;
  if p_profile_id = any (v_guardian_ids) then
    raise exception 'A member cannot be their own guardian';
  end if;
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    where not exists (
      select 1 from public.profiles p
      where p.id = g.id and p.status = 'approved'
        and (p.role = 'guardian' or 'guardian' = any (p.extra_roles))
    )
  ) then
    raise exception 'Guardians must be approved members with the Guardian role';
  end if;
  -- Links that already exist are kept; new ones need a verified guardian.
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    join public.profiles p on p.id = g.id
    where p.verified_at is null
      and not exists (
        select 1 from public.guardianships l
        where l.guardian_id = g.id and l.athlete_id = p_profile_id
      )
  ) then
    raise exception 'Verify a guardian (code in person, or checked against PlayHQ) before linking them to a child';
  end if;
  if p_status = 'approved' and v_under_17 and cardinality(v_guardian_ids) = 0 then
    raise exception 'Link at least one verified guardian before approving an athlete under 18';
  end if;
  if p_status = 'approved' and v_roles && array['coach', 'manager', 'physio']::public.app_role[]
     and not public.has_current_wwcc(p_profile_id) then
    raise exception 'Record a current Working With Children Check before approving a coach, manager or physio';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_teams) as t
    where not exists (
      select 1 from public.teams g where g.id = (t ->> 'team_id')::uuid and not g.archived
    )
  ) then
    raise exception 'Members can only be added to this season''s squads and teams';
  end if;

  update public.profiles
  set role = p_role,
      extra_roles = v_extra,
      status = p_status,
      under_17 = v_under_17,
      rejection_reason = case when p_status = 'rejected' then p_rejection_reason end
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  -- Guardian links: replace this athlete's guardians, and drop links from
  -- anyone who is no longer an approved guardian.
  delete from public.guardianships where athlete_id = p_profile_id;
  if not 'guardian' = any (v_roles) or p_status <> 'approved' then
    delete from public.guardianships where guardian_id = p_profile_id;
  end if;
  if p_status = 'approved' then
    insert into public.guardianships (guardian_id, athlete_id)
    select distinct g.id, p_profile_id from unnest(v_guardian_ids) as g (id);
  end if;

  delete from public.team_members m
  using public.teams g
  where m.profile_id = p_profile_id and g.id = m.team_id and not g.archived;

  if jsonb_array_length(p_teams) = 0 or p_status <> 'approved' then
    return;
  end if;

  select r::text::public.team_role into v_default_team_role
  from unnest(v_roles) with ordinality as x (r, n)
  where r in ('coach', 'manager', 'athlete', 'guardian')
  order by n
  limit 1;
  if v_default_team_role is null then
    raise exception 'Only coaches, managers, athletes and guardians can be added to a squad or team';
  end if;

  -- Each placement with its group's kind and squad, and the role it's in.
  select coalesce(jsonb_agg(t || jsonb_build_object(
    'team_role', coalesce(t ->> 'team_role', v_default_team_role::text),
    'kind', g.kind,
    'squad_id', g.squad_id
  )), '[]'::jsonb)
  into v_placements
  from jsonb_array_elements(p_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;

  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    where not (p ->> 'team_role')::public.app_role = any (v_roles)
       or p ->> 'team_role' not in ('coach', 'manager', 'athlete', 'guardian')
  ) then
    raise exception 'Give them that role before adding them to a squad or team with it';
  end if;

  -- A team named from a squad needs its members in the squad too, in the same role.
  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    where p ->> 'squad_id' is not null
      and not exists (
        select 1 from jsonb_array_elements(v_placements) as s
        where s ->> 'team_id' = p ->> 'squad_id'
      )
  ) then
    raise exception 'Add them to the squad before naming them in one of its teams';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    join jsonb_array_elements(v_placements) as s on s ->> 'team_id' = p ->> 'squad_id'
    where p ->> 'team_role' <> s ->> 'team_role'
  ) then
    raise exception 'Their role in a team must match their role in its squad';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    (p ->> 'team_id')::uuid,
    p_profile_id,
    (p ->> 'team_role')::public.team_role,
    case when p ->> 'team_role' = 'coach'
      then coalesce((p ->> 'coach_title')::public.coach_title, 'head_coach')
    end,
    case when p ->> 'team_role' = 'athlete' and p ->> 'kind' = 'team'
      then coalesce((p ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(v_placements) as p;
end;
$$;
revoke execute on function public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason,
  public.app_role[]
) from public, anon;
grant execute on function public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason,
  public.app_role[]
) to authenticated;

-- ---------------------------------------------------------------------------
-- Squads, teams and seasons: place people in the role they had
-- ---------------------------------------------------------------------------

create or replace function public.returning_members(p_squad_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  role public.app_role,
  last_squad_id uuid,
  last_squad_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select season, kind from public.teams where id = p_squad_id and squad_id is null
  )
  select distinct on (p.id)
    p.id, coalesce(nullif(p.full_name, ''), p.email), m.team_role::text::public.app_role,
    old_group.id, old_group.name
  from target
  join public.teams old_group on old_group.season = target.season - 1
  join public.team_members m on m.team_id = old_group.id
  join public.profiles p on p.id = m.profile_id and p.status = 'approved'
    and m.team_role::text::public.app_role = any (public.roles_of(p.role, p.extra_roles))
  where public.is_admin()
    and not exists (
      select 1 from public.team_members now_in
      join public.teams s on s.id = now_in.team_id
      where now_in.profile_id = p.id and s.season = target.season and s.squad_id is null
    )
  order by p.id, (old_group.kind = target.kind) desc, (m.team_role = 'athlete') desc,
    old_group.sort_order;
$$;

create or replace function public.admin_place_members(p_squad_id uuid, p_profile_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.teams;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can place members';
  end if;
  select * into v_group
  from public.teams where id = p_squad_id and squad_id is null and not archived;
  if v_group.id is null then
    raise exception 'Squad or team not found';
  end if;

  with people as (
    select
      p.id,
      -- The role they had last season, or their main role.
      coalesce((
        select m.team_role from public.team_members m
        join public.teams t on t.id = m.team_id
        where m.profile_id = p.id
          and m.team_role::text::public.app_role = any (public.roles_of(p.role, p.extra_roles))
        order by t.season desc, (m.team_role = 'athlete') desc
        limit 1
      ), case when p.role in ('coach', 'manager', 'athlete', 'guardian')
        then p.role::text::public.team_role end) as team_role
    from public.profiles p
    where p.id = any (coalesce(p_profile_ids, '{}'))
      and p.status = 'approved'
  )
  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    p_squad_id,
    pp.id,
    pp.team_role,
    case when pp.team_role = 'coach' then coalesce((
      select m.coach_title from public.team_members m
      join public.teams t on t.id = m.team_id
      where m.profile_id = pp.id and m.coach_title is not null
      order by t.season desc
      limit 1
    ), 'head_coach') end,
    case when pp.team_role = 'athlete' and v_group.kind = 'team' then coalesce((
      select m.selection from public.team_members m
      join public.teams t on t.id = m.team_id
      where m.profile_id = pp.id and m.selection is not null
      order by t.season desc
      limit 1
    ), 'touring') end
  from people pp
  where pp.team_role is not null
  on conflict (team_id, profile_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- p_members is a list of {profile_id, team_role?, coach_title?, selection?}.
create or replace function public.admin_set_team_members(p_team_id uuid, p_members jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_picks jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can name teams';
  end if;
  select * into v_team from public.teams where id = p_team_id and kind = 'team';
  if v_team.id is null then
    raise exception 'Team not found';
  end if;
  if jsonb_typeof(p_members) <> 'array' then
    raise exception 'p_members must be a JSON array';
  end if;

  if v_team.squad_id is null then
    if v_team.archived then
      raise exception 'Team not found';
    end if;

    -- Each pick with the role they're in the team as: the one asked for, or
    -- their first role that belongs in a team.
    select coalesce(jsonb_agg(m || jsonb_build_object(
      'team_role', coalesce(m ->> 'team_role', (
        select r::text
        from unnest(public.roles_of(p.role, p.extra_roles)) with ordinality as x (r, n)
        where r in ('coach', 'manager', 'athlete')
        order by n
        limit 1
      )),
      'roles', to_jsonb(public.roles_of(p.role, p.extra_roles)),
      'approved', p.status = 'approved'
    )), '[]'::jsonb)
    into v_picks
    from jsonb_array_elements(p_members) as m
    left join public.profiles p on p.id = (m ->> 'profile_id')::uuid;

    if exists (
      select 1 from jsonb_array_elements(v_picks) as k
      where not coalesce((k ->> 'approved')::boolean, false)
        or coalesce(k ->> 'team_role', '') not in ('coach', 'manager', 'athlete')
        or not (k -> 'roles') ? (k ->> 'team_role')
    ) then
      raise exception 'Only approved coaches, managers and athletes can be in a team';
    end if;

    delete from public.team_members where team_id = p_team_id and team_role <> 'guardian';

    insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
    select
      p_team_id,
      (k ->> 'profile_id')::uuid,
      (k ->> 'team_role')::public.team_role,
      case when k ->> 'team_role' = 'coach'
        then coalesce((k ->> 'coach_title')::public.coach_title, 'head_coach')
      end,
      case when k ->> 'team_role' = 'athlete'
        then coalesce((k ->> 'selection')::public.team_selection, 'touring')
      end
    from jsonb_array_elements(v_picks) as k
    on conflict (team_id, profile_id) do nothing;
    return;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) as m
    where not exists (
      select 1 from public.team_members sm
      where sm.team_id = v_team.squad_id and sm.profile_id = (m ->> 'profile_id')::uuid
    )
  ) then
    raise exception 'Everyone in a team must be in its squad';
  end if;

  delete from public.team_members where team_id = p_team_id;

  -- Their role in the team is the same as in the squad.
  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    p_team_id,
    sm.profile_id,
    sm.team_role,
    case when sm.team_role = 'coach'
      then coalesce((m ->> 'coach_title')::public.coach_title, sm.coach_title, 'head_coach')
    end,
    case when sm.team_role = 'athlete'
      then coalesce((m ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(p_members) as m
  join public.team_members sm
    on sm.team_id = v_team.squad_id and sm.profile_id = (m ->> 'profile_id')::uuid;
end;
$$;

commit;
