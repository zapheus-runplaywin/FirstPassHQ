-- Chat groups: admins can add club roles and posts to a group alongside
-- squads and teams (Matt, 24 November 2026: "We should be able to add non
-- squad/team roles like admin and complaints manager or child safety
-- officer"). Before this, roles across the club could only be chosen when no
-- squad or team was, and posts couldn't be chosen at all.
--
-- - chat_groups gets club_roles (roles across the club, whatever squads or
--   teams are chosen) and posts (Child Safety Officer, Complaints Manager,
--   WWC Registration Officer, Head Physio). Both default to empty, so every
--   group saved before keeps exactly its members.
-- - chat_group_people (from 20261124600000_chat_groups.sql) takes them in.
--   A post follows whoever is in it now, including admins acting in an empty
--   safeguarding post.
-- - New admin_chat_group_preview and admin_save_chat_group with two more
--   arguments; the old ones still work for apps not yet updated, and leave
--   club roles and posts as they are.
-- - admin_chat_groups returns club_roles and posts too (dropped and made
--   again because its columns change; it holds no data).
--
-- Nothing is deleted or overwritten.

begin;

alter table public.chat_groups
  add column if not exists club_roles public.app_role[] not null default '{}',
  add column if not exists posts text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_groups_posts_known'
  ) then
    alter table public.chat_groups add constraint chat_groups_posts_known
      check (posts <@ array['child_safety_officer', 'complaints_manager', 'wwc_officer', 'head_physio']);
  end if;
end;
$$;

-- Everyone in a group now. As 20261124600000, plus club roles chosen
-- alongside squads and teams, and posts.
create or replace function public.chat_group_people(p_group public.chat_groups)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct x.id
  from (
    -- Coaches of the squad or team, in every automatic team group.
    select tm.profile_id as id
    from public.team_members tm
    where p_group.kind in ('team_staff', 'team_captains', 'team_physio')
      and tm.team_id = p_group.team_id and tm.team_role = 'coach'
      and public.chat_staff_ok(tm.profile_id)
    union all
    -- Its managers.
    select tm.profile_id
    from public.team_members tm
    where p_group.kind = 'team_staff'
      and tm.team_id = p_group.team_id and tm.team_role = 'manager'
      and public.chat_staff_ok(tm.profile_id)
    union all
    -- A team's captains and vice captains, while athletes in it.
    select tc.profile_id
    from public.team_captains tc
    join public.team_members tm
      on tm.team_id = tc.team_id and tm.profile_id = tc.profile_id and tm.team_role = 'athlete'
    where p_group.kind = 'team_captains' and tc.team_id = p_group.team_id
    union all
    -- Its physios, and every Head Physio.
    select tm.profile_id
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id and p.stood_down_at is null
    where p_group.kind = 'team_physio'
      and tm.team_id = p_group.team_id and tm.team_role = 'physio'
    union all
    select p.id
    from public.profiles p
    where p_group.kind = 'team_physio' and p.head_physio and p.stood_down_at is null
      and 'physio' = any (public.roles_of(p.role, p.extra_roles))
    union all
    -- Everyone managing a current squad or team.
    select tm.profile_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id and not t.archived
    where p_group.kind = 'managers' and tm.team_role = 'manager'
      and public.chat_staff_ok(tm.profile_id)
    union all
    -- An admin's group: roles across the club. Groups saved before
    -- 20261125200000 keep their roles there when no squads or teams are chosen.
    select p.id
    from public.profiles p
    where p_group.kind = 'custom'
      and public.roles_of(p.role, p.extra_roles) && (
        coalesce(p_group.club_roles, '{}')
        || case when cardinality(p_group.team_ids) = 0 then p_group.roles else '{}' end
      )
      and p.stood_down_at is null
    union all
    -- An admin's group: whoever is in the posts chosen now. The holders who
    -- can act, or the admins acting while none can (20261124200000).
    select h.profile_id
    from public.safeguarding_post_holders h
    where p_group.kind = 'custom'
      and h.post = any (coalesce(p_group.posts, '{}'))
      and public.in_safeguarding_post(h.post, h.profile_id)
    union all
    select p.id
    from public.profiles p
    cross join unnest(coalesce(p_group.posts, '{}')) x(post)
    where p_group.kind = 'custom'
      and x.post in ('child_safety_officer', 'complaints_manager', 'wwc_officer')
      and 'admin' = any (public.roles_of(p.role, p.extra_roles))
      and public.acting_in_safeguarding_post(x.post, p.id)
    union all
    -- The Head Physio.
    select p.id
    from public.profiles p
    where p_group.kind = 'custom'
      and 'head_physio' = any (coalesce(p_group.posts, '{}'))
      and p.head_physio and p.stood_down_at is null
      and 'physio' = any (public.roles_of(p.role, p.extra_roles))
    union all
    -- An admin's group: everyone in the squads or teams chosen, or only the
    -- roles chosen in them. A placement as a guardian doesn't count, as for
    -- squad and team messages.
    select tm.profile_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id and not t.archived
    where p_group.kind = 'custom'
      and tm.team_id = any (p_group.team_ids)
      and tm.team_role::text <> 'guardian'
      and (cardinality(p_group.roles) = 0 or tm.team_role::text = any (p_group.roles::text[]))
      and (tm.team_role not in ('coach', 'manager') or public.chat_staff_ok(tm.profile_id))
    union all
    -- An admin's group: the people named.
    select unnest(p_group.people)
    where p_group.kind = 'custom'
  ) x
  join public.profiles p on p.id = x.id
  where p.status = 'approved'
    -- Guests, temporary helpers and Studio on its own never get messages.
    and not (public.roles_of(p.role, p.extra_roles) <@ array['guest', 'volunteer', 'studio']::public.app_role[])
    -- A member under 18 with no verified parent or guardian stays in their
    -- groups, but the groups are hidden from them until one is linked
    -- (chat_minor_unguarded); the parent then gets copies of what was posted.
    -- An automatic team group only while its squad or team is current.
    and (
      p_group.team_id is null
      or exists (select 1 from public.teams t where t.id = p_group.team_id and not t.archived)
    )
    -- Coaches and captains: teams only (captains are chosen per team).
    and (
      p_group.kind <> 'team_captains'
      or exists (select 1 from public.teams t where t.id = p_group.team_id and t.kind = 'team')
    );
$$;

revoke execute on function public.chat_group_people(public.chat_groups) from public, anon, authenticated;

-- Checks an admin's full choice, club roles and posts included.
create or replace function public.chat_group_draft(
  p_name text,
  p_roles public.app_role[],
  p_team_ids uuid[],
  p_people uuid[],
  p_club_roles public.app_role[],
  p_posts text[]
)
returns public.chat_groups
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group public.chat_groups;
begin
  -- Roles in squads and teams only mean something with squads or teams.
  v_group := public.chat_group_draft(
    p_name,
    case when cardinality(coalesce(p_team_ids, '{}')) > 0 then p_roles else '{}' end,
    p_team_ids,
    p_people
  );
  v_group.club_roles := coalesce(p_club_roles, '{}');
  v_group.posts := coalesce(p_posts, '{}');
  if v_group.club_roles && array['guest', 'volunteer', 'studio']::public.app_role[] then
    raise exception 'Guests, temporary helpers and Studio don''t get messages';
  end if;
  if not v_group.posts <@ array['child_safety_officer', 'complaints_manager', 'wwc_officer', 'head_physio'] then
    raise exception 'Choose Child Safety Officer, Complaints Manager, WWC Registration Officer or Head Physio';
  end if;
  return v_group;
end;
$$;

revoke execute on function public.chat_group_draft(text, public.app_role[], uuid[], uuid[], public.app_role[], text[]) from public, anon, authenticated;

create or replace function public.admin_chat_group_preview(
  p_roles public.app_role[],
  p_team_ids uuid[],
  p_people uuid[],
  p_club_roles public.app_role[],
  p_posts text[]
)
returns table (member_count int, under_18_count int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group public.chat_groups;
begin
  if not public.is_admin() then
    raise exception 'Only admins can set up chat groups';
  end if;
  v_group := public.chat_group_draft('Preview', p_roles, p_team_ids, p_people, p_club_roles, p_posts);
  return query
  select count(*)::int, count(*) filter (where public.chat_member_is_minor(x))::int
  from public.chat_group_people(v_group) x;
end;
$$;

revoke execute on function public.admin_chat_group_preview(public.app_role[], uuid[], uuid[], public.app_role[], text[]) from public, anon;
grant execute on function public.admin_chat_group_preview(public.app_role[], uuid[], uuid[], public.app_role[], text[]) to authenticated;

create or replace function public.admin_save_chat_group(
  p_id uuid,
  p_name text,
  p_roles public.app_role[],
  p_team_ids uuid[],
  p_people uuid[],
  p_club_roles public.app_role[],
  p_posts text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.chat_groups;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can set up chat groups';
  end if;
  if not public.chat_groups_on() then
    raise exception 'Chat groups are turned off for the club';
  end if;
  v_group := public.chat_group_draft(p_name, p_roles, p_team_ids, p_people, p_club_roles, p_posts);
  if v_group.name = '' then
    raise exception 'Give the group a name';
  end if;
  if length(v_group.name) > 80 then
    raise exception 'Group names can be up to 80 characters';
  end if;
  if cardinality(v_group.club_roles) = 0 and cardinality(v_group.posts) = 0
     and cardinality(v_group.team_ids) = 0 and cardinality(v_group.people) = 0 then
    raise exception 'Choose roles, posts, squads or teams, or people';
  end if;
  if exists (
    select 1 from public.chat_groups g
    where g.kind = 'custom' and lower(g.name) = lower(v_group.name)
      and g.closed_at is null and g.id is distinct from p_id
  ) then
    raise exception 'There''s already a group called %', v_group.name;
  end if;

  if p_id is null then
    insert into public.chat_groups
      (kind, name, roles, team_ids, people, club_roles, posts, created_by, created_by_name)
    values ('custom', v_group.name, v_group.roles, v_group.team_ids, v_group.people,
      v_group.club_roles, v_group.posts, auth.uid(), public.member_display_name(auth.uid()))
    returning id into v_id;
  else
    update public.chat_groups
    set name = v_group.name, roles = v_group.roles, team_ids = v_group.team_ids,
      people = v_group.people, club_roles = v_group.club_roles, posts = v_group.posts,
      updated_at = now()
    where id = p_id and kind = 'custom'
    returning id into v_id;
    if v_id is null then
      raise exception 'Only groups admins set up can be changed';
    end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.admin_save_chat_group(uuid, text, public.app_role[], uuid[], uuid[], public.app_role[], text[]) from public, anon;
grant execute on function public.admin_save_chat_group(uuid, text, public.app_role[], uuid[], uuid[], public.app_role[], text[]) to authenticated;

-- Admins' groups, now with club roles and posts. Its columns change, so it's
-- made again; it holds no data.
drop function if exists public.admin_chat_groups();

create function public.admin_chat_groups()
returns table (
  id uuid,
  name text,
  roles public.app_role[],
  team_ids uuid[],
  people uuid[],
  member_count int,
  under_18_count int,
  post_count int,
  created_by_name text,
  created_at timestamptz,
  closed_at timestamptz,
  club_roles public.app_role[],
  posts text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.roles, g.team_ids, g.people,
    (select count(*)::int from public.chat_group_people(g) x),
    (select count(*)::int from public.chat_group_people(g) x where public.chat_member_is_minor(x)),
    (select count(*)::int from public.messages m where m.chat_group_id = g.id),
    g.created_by_name, g.created_at, g.closed_at, g.club_roles, g.posts
  from public.chat_groups g
  where g.kind = 'custom' and public.is_admin()
  order by g.closed_at is not null, lower(g.name);
$$;

revoke execute on function public.admin_chat_groups() from public, anon;
grant execute on function public.admin_chat_groups() to authenticated;

commit;
