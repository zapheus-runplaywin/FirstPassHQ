-- Guests and physios: what each can see and do.
--
-- Matt (2026-10-08): "Change the Guest role to not be able to vote in awards
-- or see messages. They can just view teams and see the club calendars for
-- now. Add a Physio role which can see squads/teams, calendar, check-in
-- averages only, see all injuries, endorse clearances."
--
-- - Guests and physios no longer get messages or vote in awards. Messages
--   they already received are hidden from them, not deleted.
-- - Physios see the committee's check-in averages, every current athlete's
--   injuries and proof documents, and can endorse (or send back) a clearance
--   request like the athlete's coach. A committee member still accepts it,
--   and it must be someone other than the endorser.
-- - Physios need a current Working With Children Check, like coaches and
--   managers, since they see injuries of athletes under 18.
--
-- Additive only: one new function and replaced functions. No rows change.

begin;

-- True for an approved member with the Physio role.
create or replace function public.is_physio()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved' and role = 'physio'
  );
$$;

revoke execute on function public.is_physio() from public, anon;
grant execute on function public.is_physio() to authenticated;

-- True for roles that don't get messages or vote in awards.
create or replace function public.is_view_only_role(p_role public.app_role)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_role in ('guest', 'physio');
$$;

revoke execute on function public.is_view_only_role(public.app_role) from public, anon;
grant execute on function public.is_view_only_role(public.app_role) to authenticated;

-- Same as before, plus physios.
create or replace function public.can_view_athlete_injuries(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    p_athlete_id = auth.uid()
    or public.is_guardian_of(p_athlete_id)
    or public.coaches_athlete(p_athlete_id)
    or public.is_committee()
    -- Physios see current athletes only; records kept after someone leaves
    -- stay with the committee and admins.
    or (public.is_physio() and exists (
      select 1 from public.profiles where id = p_athlete_id
    ))
  );
$$;

revoke execute on function public.can_view_athlete_injuries(uuid) from public, anon;
grant execute on function public.can_view_athlete_injuries(uuid) to authenticated;

-- Same as before, plus physios.
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
    or not (public.coaches_athlete(v_injury.athlete_id) or public.is_admin() or public.is_physio()) then
    raise exception 'Only the athlete’s coaches or a physio can endorse clearance';
  end if;
  if v_injury.status <> 'clearance_requested' then
    raise exception 'This injury isn’t waiting for a coach';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t endorse your own clearance';
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

revoke execute on function public.endorse_clearance(uuid, text) from public, anon;
grant execute on function public.endorse_clearance(uuid, text) to authenticated;

-- Same as before: physios can also send back a request they could endorse.
create or replace function public.send_back_clearance(p_injury_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null then
    raise exception 'Injury not found';
  end if;
  if not (
    (v_injury.status = 'clearance_requested'
      and (public.coaches_athlete(v_injury.athlete_id) or public.is_committee()
        or public.is_physio()))
    or (v_injury.status = 'coach_endorsed' and public.is_committee())
  ) then
    raise exception 'You can’t send this back';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t send back your own clearance';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Say why it’s being sent back';
  end if;

  update public.injuries
  set status = 'injured', coach_endorsed_by = null, coach_endorsed_at = null
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (p_injury_id, auth.uid(), public.my_display_name(), 'sent_back', trim(p_notes));
end;
$$;

revoke execute on function public.send_back_clearance(uuid, text) from public, anon;
grant execute on function public.send_back_clearance(uuid, text) to authenticated;

-- Same as before: clearance requests also wait for physios.
create or replace function public.visible_injuries(
  p_include_cleared boolean default false,
  p_injury_id uuid default null
)
returns table (
  id uuid,
  athlete_id uuid,
  athlete_name text,
  body_area text,
  description text,
  injured_on date,
  restrictions text,
  expected_return date,
  status public.injury_status,
  coach_endorsed_by uuid,
  cleared_at timestamptz,
  created_at timestamptz,
  last_update_at timestamptz,
  can_report boolean,
  waiting_for_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.athlete_id,
    coalesce(nullif(p.full_name, ''), p.email, i.athlete_name),
    i.body_area,
    i.description, i.injured_on, i.restrictions, i.expected_return, i.status,
    i.coach_endorsed_by, i.cleared_at, i.created_at,
    (select max(u.created_at) from public.injury_updates u where u.injury_id = i.id),
    public.can_report_for(i.athlete_id),
    i.athlete_left_at is null and i.athlete_id <> auth.uid() and (
      (i.status = 'clearance_requested'
        and (public.coaches_athlete(i.athlete_id)
          or public.is_physio()
          or (public.is_admin() and not exists (
            select 1 from public.team_members c
            join public.team_members a on a.team_id = c.team_id
            join public.teams t on t.id = c.team_id
            where a.profile_id = i.athlete_id and a.team_role = 'athlete'
              and c.team_role = 'coach' and not t.archived
              and t.selections_completed_at is null
          ))))
      or (i.status = 'coach_endorsed' and public.is_committee()
        and i.coach_endorsed_by is distinct from auth.uid())
    )
  from public.injuries i
  left join public.profiles p on p.id = i.athlete_id
  where public.can_view_athlete_injuries(i.athlete_id)
    and (p_include_cleared or i.status <> 'cleared' or i.id = p_injury_id)
    and (p_include_cleared or i.athlete_left_at is null or i.id = p_injury_id)
    and (p_injury_id is null or i.id = p_injury_id)
  order by i.status = 'cleared', i.created_at desc;
$$;

revoke execute on function public.visible_injuries(boolean, uuid) from public, anon;
grant execute on function public.visible_injuries(boolean, uuid) to authenticated;

-- Same as before, plus physios.
create or replace function public.check_in_overview(p_day date)
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  season int,
  athlete_count int,
  checked_in_count int,
  -- Null when fewer than 3 athletes have checked in.
  flagged_count int,
  avg_sleep numeric,
  avg_soreness numeric,
  avg_stress numeric,
  avg_mood numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with groups as (
    select t.id, t.name, t.kind, t.season, t.sort_order, coalesce(s.sort_order, t.sort_order) as squad_order
    from public.teams t
    left join public.teams s on s.id = t.squad_id
    where not t.archived
      and (
        (t.kind = 'squad' and t.selections_completed_at is null)
        or (t.kind = 'team' and s.selections_completed_at is not null)
      )
  ),
  scores as (
    select
      g.id, g.name, g.kind, g.season, g.sort_order, g.squad_order,
      count(a.profile_id)::int as athletes,
      count(c.id)::int as checked_in,
      count(c.id) filter (where least(c.sleep, c.soreness, c.stress, c.mood) <= 2)::int as flagged,
      avg(c.sleep) as sleep, avg(c.soreness) as soreness,
      avg(c.stress) as stress, avg(c.mood) as mood
    from groups g
    left join public.team_members a on a.team_id = g.id and a.team_role = 'athlete'
      and exists (select 1 from public.profiles p where p.id = a.profile_id and p.status = 'approved')
    left join public.check_ins c on c.athlete_id = a.profile_id and c.day = p_day
    group by g.id, g.name, g.kind, g.season, g.sort_order, g.squad_order
  )
  select
    id, name, kind::text, season, athletes, checked_in,
    case when checked_in >= 3 then flagged end,
    case when checked_in >= 3 then round(sleep, 1) end,
    case when checked_in >= 3 then round(soreness, 1) end,
    case when checked_in >= 3 then round(stress, 1) end,
    case when checked_in >= 3 then round(mood, 1) end
  from scores
  where public.is_committee() or public.is_physio()
  order by season desc, squad_order, kind, sort_order, name;
$$;

revoke execute on function public.check_in_overview(date) from public, anon;
grant execute on function public.check_in_overview(date) to authenticated;

-- Same as before, plus physios.
create or replace function public.check_in_trend(p_team_id uuid, p_since date, p_until date)
returns table (
  day date,
  checked_in_count int,
  flagged_count int,
  avg_sleep numeric,
  avg_soreness numeric,
  avg_stress numeric,
  avg_mood numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.is_approved() and p_until - p_since between 0 and 366 and (
      public.is_committee()
      or public.is_physio()
      or (p_team_id is not null and exists (
        select 1 from public.team_members coach
        join public.teams t on t.id = coach.team_id
        where coach.team_id = p_team_id
          and coach.profile_id = auth.uid()
          and coach.team_role = 'coach'
          and not t.archived
          and t.selections_completed_at is null
      ))
    ) as ok
  ),
  athletes as (
    select distinct a.profile_id
    from public.team_members a
    join public.teams t on t.id = a.team_id and not t.archived
    join public.profiles p on p.id = a.profile_id and p.status = 'approved'
    where a.team_role = 'athlete'
      and (p_team_id is null or a.team_id = p_team_id)
  ),
  days as (
    select d::date as day from generate_series(p_since, p_until, interval '1 day') d
  ),
  scores as (
    select
      d.day,
      count(c.id)::int as checked_in,
      count(c.id) filter (where least(c.sleep, c.soreness, c.stress, c.mood) <= 2)::int as flagged,
      avg(c.sleep) as sleep, avg(c.soreness) as soreness,
      avg(c.stress) as stress, avg(c.mood) as mood
    from days d
    left join public.check_ins c on c.day = d.day
      and c.athlete_id in (select profile_id from athletes)
    group by d.day
  )
  select
    s.day, s.checked_in,
    case when s.checked_in >= 3 then s.flagged end,
    case when s.checked_in >= 3 then round(s.sleep, 1) end,
    case when s.checked_in >= 3 then round(s.soreness, 1) end,
    case when s.checked_in >= 3 then round(s.stress, 1) end,
    case when s.checked_in >= 3 then round(s.mood, 1) end
  from scores s, allowed
  where allowed.ok
  order by s.day;
$$;

revoke execute on function public.check_in_trend(uuid, date, date) from public, anon;
grant execute on function public.check_in_trend(uuid, date, date) to authenticated;

-- Same as before, leaving out guests and physios, even for "every member".
create or replace function public.award_voters(p_award_id uuid, p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.awards a
  join public.profiles p on p.status = 'approved' and not public.is_view_only_role(p.role)
  where a.id = p_award_id
    and (
      'member' = any (a.voter_roles)
      -- Committee, admin and partner aren't tied to a group.
      or (p.role::text = any (a.voter_roles)
        and (a.club_wide or p.role in ('committee', 'admin', 'partner')))
      or exists (
        select 1 from public.team_members tm
        where tm.profile_id = p.id
          and tm.team_role::text = any (a.voter_roles)
          and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
      )
    );
$$;

revoke execute on function public.award_voters(uuid, uuid) from public, anon, authenticated;

-- Same as before, leaving out guests and physios.
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
    if not public.is_committee() then
      raise exception 'Only admins and the committee can message the whole club';
    end if;
  elsif p_audience = 'role' then
    if not public.is_admin() then
      raise exception 'Only admins can message a role';
    end if;
    if p_role is null then
      raise exception 'Choose a role to message';
    end if;
    if public.is_view_only_role(p_role) then
      raise exception 'Guests and physios don''t get messages';
    end if;
  else
    select * into v_team from public.teams where id = p_team_id and not archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team to message';
    end if;
    if not public.can_message_group(v_team.id) then
      raise exception 'You can only message squads and teams you coach or manage';
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
      and not public.is_view_only_role(p.role)
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

  return v_message_id;
end;
$$;

revoke execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid)
  from public, anon;
grant execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid)
  to authenticated;

-- Same as before, hiding messages from guests and physios.
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
    -- Guests and physios don't see messages, including ones from before.
    select 1 from public.profiles
    where id = auth.uid() and public.is_view_only_role(role)
  );
$$;

revoke execute on function public.is_message_recipient(uuid) from public, anon;
grant execute on function public.is_message_recipient(uuid) to authenticated;

-- Same as before: physios need a current Working With Children Check too.
create or replace function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb,
  p_under_17 boolean default false,
  p_guardian_ids uuid[] default '{}',
  p_rejection_reason public.rejection_reason default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_role public.team_role;
  v_date_of_birth date;
  v_under_17 boolean;
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  select date_of_birth into v_date_of_birth from public.profiles where id = p_profile_id;
  v_under_17 := p_role = 'athlete' and public.is_minor(v_date_of_birth, p_under_17);

  if p_profile_id = auth.uid() and (p_role <> 'admin' or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
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
      where p.id = g.id and p.role = 'guardian' and p.status = 'approved'
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
  if p_status = 'approved' and p_role in ('coach', 'manager', 'physio')
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
  if p_role <> 'guardian' or p_status <> 'approved' then
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

revoke execute on function public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason
) from public, anon;
grant execute on function public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason
) to authenticated;

-- Same as before, counting physios with coaches and managers.
create or replace function public.admin_safety_todos()
returns table (
  wwcc_missing int,
  wwcc_expiring int,
  minors_without_guardian int,
  turning_18 int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (
      where p.role in ('coach', 'manager', 'physio') and not public.has_current_wwcc(p.id)
    )::int,
    count(*) filter (
      where p.role in ('coach', 'manager', 'physio') and public.has_current_wwcc(p.id)
        and p.wwcc_expires_on < current_date + 30
    )::int,
    count(*) filter (
      where p.role = 'athlete' and public.is_minor(p.date_of_birth, p.under_17)
        and not exists (select 1 from public.guardianships g where g.athlete_id = p.id)
    )::int,
    count(*) filter (
      where p.role = 'athlete' and p.date_of_birth is not null
        and public.is_minor(p.date_of_birth, p.under_17)
        and p.date_of_birth <= current_date - interval '18 years' + interval '30 days'
    )::int
  from public.profiles p
  where p.status = 'approved' and public.is_admin();
$$;

revoke execute on function public.admin_safety_todos() from public, anon;
grant execute on function public.admin_safety_todos() to authenticated;

commit;
