-- Who sees each calendar (Matt, 21 November 2026): "Need to be able to
-- optionally share calendars with Physios and Stats and Guests etc.
-- especially if guests are taking on a safeguarding role. We should have a
-- need to know basis. But they can be managed by splitting calendars and
-- having multiple. Then admin can manage who sees what with good control."
--
-- Until now a calendar was shown to everyone in the club, to the committee,
-- or to one squad or team. Now an admin picks any mix of:
--   - everyone in the club (every approved member, as before: not temporary
--     helpers),
--   - roles: committee, coaches, managers, physios, statisticians, athletes,
--     parents and guardians, guests,
--   - safeguarding posts: Child Safety Officers, Complaints Managers and WWC
--     Registration Officers (any holder who can act in the post now, so a
--     guest who is a Child Safety Officer sees it),
--   - squads and teams (everyone in them, as before).
-- A member sees a calendar when they match any one of them. Admins see every
-- calendar, to manage them. A new calendar starts shown to nobody but admins
-- until the admin picks who it's for: need to know.
--
-- A role counts only while it is usable (public.has_role): a coach whose
-- check lapsed or who was stood down doesn't see the coaches' calendar, as
-- the app already hides their coach screens. Squad and team membership uses
-- public.is_team_member, as before.
--
-- Nothing changes for today's calendars: each one gets the audience it has
-- now (everyone, the committee, or its squad or team). The old team_id and
-- committee_only columns stay, so an app not yet updated can still add a
-- calendar; a trigger turns them into audiences. admin_save_calendar is the
-- new way to add or change one, and moves a calendar fully onto audiences.
--
-- Additive: one new table, new functions, a new version of
-- admin_start_season, and the calendars read policy replaced by one that
-- shows exactly what it showed before for today's calendars. No rows are
-- changed or removed.

begin;

create table if not exists public.calendar_audiences (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars (id) on delete cascade,
  kind text not null check (kind in ('everyone', 'role', 'team', 'post')),
  role public.app_role,
  team_id uuid references public.teams (id) on delete cascade,
  post text,
  created_at timestamptz not null default now(),
  constraint calendar_audiences_once unique nulls not distinct (calendar_id, kind, role, team_id, post),
  constraint calendar_audience_shape check (
    (kind = 'everyone' and role is null and team_id is null and post is null)
    or (kind = 'role' and team_id is null and post is null and role is not null
      and role::text in ('committee', 'coach', 'manager', 'physio', 'statistician',
        'athlete', 'guardian', 'guest'))
    or (kind = 'team' and role is null and post is null and team_id is not null)
    or (kind = 'post' and role is null and team_id is null
      and post in ('child_safety_officer', 'complaints_manager', 'wwc_officer'))
  )
);

create index if not exists calendar_audiences_team_id_idx on public.calendar_audiences (team_id);

alter table public.calendar_audiences enable row level security;

-- Members may read the audience of a calendar they can see (no personal
-- details: roles, posts and squad or team ids). Changes go through
-- admin_save_calendar only.
revoke all on table public.calendar_audiences from public, anon, authenticated;
grant select on table public.calendar_audiences to authenticated;
grant all on table public.calendar_audiences to service_role;

drop policy if exists "Members see the audience of calendars they see" on public.calendar_audiences;
create policy "Members see the audience of calendars they see"
  on public.calendar_audiences for select to authenticated
  using (exists (select 1 from public.calendars c where c.id = calendar_id));

-- Today's calendars keep exactly who they're shown to. Only calendars with no
-- audience yet, so running this again changes nothing.
insert into public.calendar_audiences (calendar_id, kind, team_id)
select c.id, 'team', c.team_id
from public.calendars c
where c.team_id is not null
  and not exists (select 1 from public.calendar_audiences a where a.calendar_id = c.id);

insert into public.calendar_audiences (calendar_id, kind, role)
select c.id, 'role', 'committee'
from public.calendars c
where c.committee_only and c.team_id is null
  and not exists (select 1 from public.calendar_audiences a where a.calendar_id = c.id);

insert into public.calendar_audiences (calendar_id, kind)
select c.id, 'everyone'
from public.calendars c
where c.team_id is null and not c.committee_only
  and not exists (select 1 from public.calendar_audiences a where a.calendar_id = c.id);

-- A calendar added the old way (an app not yet updated, or a new season
-- copying a squad's calendar) gets the audience its columns describe. A club
-- calendar added the old way gets none, so only admins see it until one is
-- picked: need to know.
create or replace function public.calendar_audience_from_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.team_id is not null then
    insert into public.calendar_audiences (calendar_id, kind, team_id)
    values (new.id, 'team', new.team_id) on conflict do nothing;
  elsif new.committee_only then
    insert into public.calendar_audiences (calendar_id, kind, role)
    values (new.id, 'role', 'committee') on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_audience_from_columns() from public, anon, authenticated;

drop trigger if exists calendar_audience_from_columns on public.calendars;
create trigger calendar_audience_from_columns
  after insert on public.calendars
  for each row execute function public.calendar_audience_from_columns();

-- Whether the signed-in member holds a safeguarding post and can act in it now.
create or replace function public.acts_in_safeguarding_post(p_post text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p_post
      when 'child_safety_officer' then s.child_safety_officer
      when 'complaints_manager' then s.complaints_manager
      when 'wwc_officer' then s.wwc_registration_officer
      else false
    end
    from public.my_safeguarding_posts() s
  ), false);
$$;
revoke execute on function public.acts_in_safeguarding_post(text) from public, anon;
grant execute on function public.acts_in_safeguarding_post(text) to authenticated;

-- Whether the signed-in member sees a calendar.
create or replace function public.can_see_calendar(p_calendar_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.calendar_audiences a
    where a.calendar_id = p_calendar_id
      and case a.kind
        when 'everyone' then public.is_approved()
        when 'role' then public.has_role(a.role)
        when 'team' then public.is_team_member(a.team_id)
        when 'post' then public.acts_in_safeguarding_post(a.post)
        else false
      end
  );
$$;
revoke execute on function public.can_see_calendar(uuid) from public, anon;
grant execute on function public.can_see_calendar(uuid) to authenticated;

drop policy if exists "Members see club, committee and team calendars" on public.calendars;
drop policy if exists "Members see the calendars shown to them" on public.calendars;
create policy "Members see the calendars shown to them"
  on public.calendars for select to authenticated
  using ((select public.is_admin()) or public.can_see_calendar(id));

-- Adds a calendar (p_id null) or changes one, with who sees it. Returns its
-- id. Admins only. "Everyone in the club" stands alone, since it already
-- covers every role offered here.
create or replace function public.admin_save_calendar(
  p_id uuid,
  p_name text,
  p_url text,
  p_color text,
  p_everyone boolean,
  p_roles text[],
  p_team_ids uuid[],
  p_posts text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_roles text[] := array(select distinct r from unnest(coalesce(p_roles, '{}')) r where r is not null);
  v_teams uuid[] := array(select distinct t from unnest(coalesce(p_team_ids, '{}')) t where t is not null);
  v_posts text[] := array(select distinct p from unnest(coalesce(p_posts, '{}')) p where p is not null);
begin
  if not public.is_admin() then
    raise exception 'Only admins can change calendars';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the calendar a name';
  end if;
  if not coalesce(p_everyone, false)
    and cardinality(v_roles) = 0 and cardinality(v_teams) = 0 and cardinality(v_posts) = 0 then
    raise exception 'Choose who sees this calendar';
  end if;
  if exists (
    select 1 from unnest(v_roles) r
    where r not in ('committee', 'coach', 'manager', 'physio', 'statistician', 'athlete', 'guardian', 'guest')
  ) then
    raise exception 'A calendar can''t be shown to that role';
  end if;
  if exists (
    select 1 from unnest(v_posts) p
    where p not in ('child_safety_officer', 'complaints_manager', 'wwc_officer')
  ) then
    raise exception 'That isn''t a safeguarding post';
  end if;
  if exists (select 1 from unnest(v_teams) t where not exists (select 1 from public.teams where id = t)) then
    raise exception 'That squad or team no longer exists';
  end if;

  if v_id is null then
    insert into public.calendars (name, url, color, team_id, committee_only)
    values (trim(p_name), trim(p_url), p_color, null, false)
    returning id into v_id;
  else
    update public.calendars
    set name = trim(p_name), url = trim(p_url), color = p_color, team_id = null, committee_only = false
    where id = v_id;
    if not found then
      raise exception 'That calendar no longer exists';
    end if;
    delete from public.calendar_audiences where calendar_id = v_id;
  end if;

  if coalesce(p_everyone, false) then
    insert into public.calendar_audiences (calendar_id, kind) values (v_id, 'everyone');
  else
    insert into public.calendar_audiences (calendar_id, kind, role)
    select v_id, 'role', r::public.app_role from unnest(v_roles) r;
    insert into public.calendar_audiences (calendar_id, kind, team_id)
    select v_id, 'team', t from unnest(v_teams) t;
    insert into public.calendar_audiences (calendar_id, kind, post)
    select v_id, 'post', p from unnest(v_posts) p;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.admin_save_calendar(uuid, text, text, text, boolean, text[], uuid[], text[]) from public, anon;
grant execute on function public.admin_save_calendar(uuid, text, text, text, boolean, text[], uuid[], text[]) to authenticated;

-- A new season: as before (20261009000000_optional_squads.sql), plus a
-- calendar shown to last season's squads or teams by name is also shown to
-- the new season's squads or teams of the same name.
create or replace function public.admin_start_season(p_season int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from int;
  v_count int;
  v_squads boolean := public.club_uses_squads();
begin
  if not public.is_admin() then
    raise exception 'Only admins can start a season';
  end if;
  select max(season) into v_from from public.teams where not archived;
  if v_from is null then
    raise exception 'There are no squads or teams to copy';
  end if;
  if p_season is distinct from v_from + 1 then
    raise exception 'The next season is %', v_from + 1;
  end if;

  insert into public.teams (name, sort_order, kind, season)
  select name, sort_order, case when v_squads then kind else 'team' end, p_season
  from public.teams
  where season = v_from and not archived
    and (case when v_squads then squad_id is null else kind = 'team' end)
  on conflict (season, name) do nothing;
  get diagnostics v_count = row_count;

  insert into public.calendars (name, url, team_id, committee_only, color)
  select c.name, c.url, new_group.id, false, c.color
  from public.calendars c
  join public.teams old_group on old_group.id = c.team_id
    and old_group.season = v_from and not old_group.archived
    and (case when v_squads then old_group.squad_id is null else old_group.kind = 'team' end)
  join public.teams new_group on new_group.season = p_season
    and new_group.squad_id is null and new_group.name = old_group.name
  where not exists (
    select 1 from public.calendars e where e.team_id = new_group.id and e.url = c.url
  );

  insert into public.calendar_audiences (calendar_id, kind, team_id)
  select a.calendar_id, 'team', new_group.id
  from public.calendar_audiences a
  join public.calendars c on c.id = a.calendar_id and c.team_id is null
  join public.teams old_group on old_group.id = a.team_id
    and old_group.season = v_from and not old_group.archived
  join public.teams new_group on new_group.season = p_season
    and new_group.name = old_group.name
  where a.kind = 'team'
  on conflict do nothing;

  return v_count;
end;
$$;

commit;
