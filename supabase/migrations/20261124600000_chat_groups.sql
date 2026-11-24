-- Chat groups (Matt, 24 November 2026): admins create chat groups for roles,
-- squads and teams and named people, and every member gets automatic groups:
--   - each squad's and team's coaches and managers;
--   - each team's coaches and captains (and vice captains);
--   - each squad's and team's coaches and physios, with every Head Physio;
--   - all managers.
-- They show in a Groups tab beside Inbox, Sent and Archived, and a member can
-- hide any group. Behind the Club features switch "Chat groups"
-- (features.chatGroups), off by default.
--
-- A post in a group is an ordinary message (audience 'chat') sent to the
-- people in the group at that moment, so everything messages already do
-- covers groups with no new rules: nothing is ever deleted (archive only),
-- read receipts, the keep periods and legal hold in purge_expired_records,
-- the Child Safety Officer's and Complaints Manager's approved access to one
-- member's messages, and reporting a message as a concern. Someone who joins
-- a group later sees only what's posted after they joined; someone who
-- leaves keeps what they were sent, read only.
--
-- Child safety (docs/security/privacy-and-social-media-assessment-2026-10-13.md,
-- section 2, reassessed 24 November 2026 after Matt chose "Under-18s can
-- write too"): a member under 18 posts only in the automatic groups of their
-- own squad or team (such as its coaches and captains), and only while one of
-- its coaches is in the group, so every conversation with a child is
-- coach-led. Their parents and guardians get a copy of every post in those
-- groups, the child's own posts included, in their own inbox. The group's
-- coaches can remove any post: members then see "Removed by <coach>", and the
-- text is kept for the Child Safety Officer and Complaints Manager, as every
-- message is. In admins' groups, which can span the club, under-18s read
-- only. Under-18s don't see who else is in a group. A member under 18 with no
-- verified parent or guardian linked has their groups hidden and can't post
-- until one is; posts still reach them meanwhile, and a parent or guardian
-- linked to a child gets a copy of every group post the child was sent or
-- wrote (Matt, 24 November 2026). Admins don't read groups
-- they aren't in (20261121100000_message_archive_and_access.sql).
--
-- Who is in a group is worked out each time from the club's records, so it
-- follows squad and team changes, captaincies, stand-downs and lapsed
-- checks: coaches and managers count only while they could work with
-- children (a current check, exemption or application, and not stood down),
-- as for their other group messages.
--
-- Additive: two new tables, new nullable columns on messages and on
-- message_recipients, a new message audience, new functions, and a trigger
-- on guardianships that adds copies for a newly linked parent.
-- is_message_recipient (physios read their groups), mark_all_messages_read
-- (Inbox only) and my_sent_messages (no group posts in Sent) are replaced
-- with the same signatures. No stored rows change.

-- Outside the transaction: a new enum value can't be used in the transaction
-- that adds it.
alter type public.message_audience add value if not exists 'chat';

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.chat_groups (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    check (kind in ('team_staff', 'team_captains', 'team_physio', 'managers', 'custom')),
  -- The squad or team of an automatic team group.
  team_id uuid references public.teams (id) on delete cascade,
  -- An admin's group: its name, and who is in it. Roles across the club when
  -- no squads or teams are chosen; with squads or teams, everyone in them,
  -- or only those roles in them. Named people are added on top.
  name text check (name is null or length(btrim(name)) between 1 and 80),
  roles public.app_role[] not null default '{}',
  team_ids uuid[] not null default '{}',
  people uuid[] not null default '{}',
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A closed group keeps its posts but takes no new ones.
  closed_at timestamptz,
  constraint chat_groups_team_kinds
    check ((kind in ('team_staff', 'team_captains', 'team_physio')) = (team_id is not null)),
  constraint chat_groups_custom_named check ((kind = 'custom') = (name is not null))
);

-- One automatic group of each kind per squad or team, and one "All managers".
create unique index if not exists chat_groups_automatic_idx
  on public.chat_groups (kind, team_id) nulls not distinct
  where kind <> 'custom';

-- Groups a member has hidden. Posts still reach them, already marked read.
create table if not exists public.chat_group_hidden (
  group_id uuid not null references public.chat_groups (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index if not exists chat_group_hidden_profile_idx on public.chat_group_hidden (profile_id);

-- Reached only through the functions below.
alter table public.chat_groups enable row level security;
alter table public.chat_group_hidden enable row level security;
revoke all on public.chat_groups from public, anon, authenticated;
revoke all on public.chat_group_hidden from public, anon, authenticated;
grant all on public.chat_groups to service_role;
grant all on public.chat_group_hidden to service_role;

-- A post's group. Kept as the group's name in audience_label if the group
-- itself ever goes (its squad or team is deleted).
alter table public.messages
  add column if not exists chat_group_id uuid references public.chat_groups (id) on delete set null;

alter table public.messages drop constraint if exists messages_chat_posts_name_a_group;
alter table public.messages add constraint messages_chat_posts_name_a_group
  check (audience = 'chat' or chat_group_id is null);

-- A post a coach removed: members see who removed it, not its text, which is
-- kept for safeguarding (approved message access, concerns and legal hold).
alter table public.messages
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.profiles (id) on delete set null,
  add column if not exists removed_by_name text;

create index if not exists messages_chat_group_idx
  on public.messages (chat_group_id, created_at desc) where chat_group_id is not null;

-- Set on a group member's own copy of a post, so it shows in Groups and not
-- in the Inbox. A parent's copy of a post to their child leaves it empty and
-- shows in the parent's Inbox, naming the child, like any other copy.
alter table public.message_recipients
  add column if not exists chat_group_id uuid references public.chat_groups (id) on delete set null;

create index if not exists message_recipients_chat_idx
  on public.message_recipients (profile_id, chat_group_id, created_at desc)
  where chat_group_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Who is in a group
-- ---------------------------------------------------------------------------

-- Whether chat groups are on for the signed-in member: Messages and Chat
-- groups both on (Chat groups is off until an admin turns it on).
create or replace function public.chat_groups_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.member_features() ->> 'messages')::boolean, true)
    and coalesce((public.member_features() ->> 'chatGroups')::boolean, false);
$$;

revoke execute on function public.chat_groups_on() from public, anon;
grant execute on function public.chat_groups_on() to authenticated;

-- A coach or manager counts in a group only while they could work with
-- children: approved, not stood down, with a current check, exemption or
-- application (as can_message_group and is_cleared). Not for the app to call.
create or replace function public.chat_staff_ok(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.status = 'approved' and p.stood_down_at is null
  ) and public.is_cleared(p_profile_id);
$$;

revoke execute on function public.chat_staff_ok(uuid) from public, anon, authenticated;

-- Everyone in a group now. Takes the row so an admin's unsaved group can be
-- counted too. Not for the app to call.
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
    -- An admin's group: roles across the club, when no squads or teams.
    select p.id
    from public.profiles p
    where p_group.kind = 'custom'
      and cardinality(p_group.team_ids) = 0
      and public.roles_of(p.role, p.extra_roles) && p_group.roles
      and p.stood_down_at is null
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

-- Whether a member is under 18, the rule every child-safety copy uses.
create or replace function public.chat_member_is_minor(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.is_minor(p.date_of_birth, p.under_17) from public.profiles p where p.id = p_profile_id
  ), false);
$$;

revoke execute on function public.chat_member_is_minor(uuid) from public, anon, authenticated;

-- A member under 18 with no approved, verified parent or guardian linked (Matt,
-- 24 November 2026): their groups are hidden from them, and they can't post,
-- until one is. Posts still reach them meanwhile, so they and the parent see
-- them once the parent is linked. Not for the app to call.
create or replace function public.chat_minor_unguarded(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.chat_member_is_minor(p_profile_id)
    and not exists (
      select 1
      from public.guardianships g
      join public.profiles gp on gp.id = g.guardian_id
      where g.athlete_id = p_profile_id
        and gp.status = 'approved'
        and gp.verified_at is not null
        and 'guardian' = any (public.roles_of(gp.role, gp.extra_roles))
    );
$$;

revoke execute on function public.chat_minor_unguarded(uuid) from public, anon, authenticated;

-- Whether a group is coach-led: an automatic group of one squad or team with
-- at least one of its coaches in it now. Only these take posts from members
-- under 18. Not for the app to call.
create or replace function public.chat_group_coach_led(p_group public.chat_groups)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_group.kind in ('team_staff', 'team_captains', 'team_physio')
    and exists (
      select 1 from public.chat_group_people(p_group) x
      join public.team_members tm
        on tm.profile_id = x and tm.team_id = p_group.team_id and tm.team_role = 'coach'
    );
$$;

revoke execute on function public.chat_group_coach_led(public.chat_groups) from public, anon, authenticated;

-- Whether a member can post in a group now: in it, the group open, and
-- either an adult or, under 18, the group coach-led. Not for the app to call.
create or replace function public.chat_can_post(p_group public.chat_groups, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_group.closed_at is null
    and exists (select 1 from public.chat_group_people(p_group) x where x = p_profile_id)
    and (not public.chat_member_is_minor(p_profile_id)
      or (public.chat_group_coach_led(p_group) and not public.chat_minor_unguarded(p_profile_id)));
$$;

revoke execute on function public.chat_can_post(public.chat_groups, uuid) from public, anon, authenticated;

-- Who can remove posts in a group: in an automatic squad or team group, its
-- coaches in the group; in an admin's group, the coaches and admins in it.
-- Adults only. Not for the app to call.
create or replace function public.chat_can_remove(p_group public.chat_groups, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_group_people(p_group) x where x = p_profile_id)
    and not public.chat_member_is_minor(p_profile_id)
    and case
      when p_group.kind in ('team_staff', 'team_captains', 'team_physio') then exists (
        select 1 from public.team_members tm
        where tm.team_id = p_group.team_id and tm.profile_id = p_profile_id and tm.team_role = 'coach'
      )
      when p_group.kind = 'custom' then exists (
        select 1 from public.profiles p
        where p.id = p_profile_id
          and public.roles_of(p.role, p.extra_roles) && array['coach', 'admin']::public.app_role[]
      )
      else false
    end;
$$;

revoke execute on function public.chat_can_remove(public.chat_groups, uuid) from public, anon, authenticated;

-- Whether a post a coach hid is hidden from the signed-in member. A hidden
-- post stays with its author, the group's coaches (who can show it again) and
-- the author's own verified parents or guardians, greyed out; everyone else
-- in the group, and their parents' copies, lose it (Matt, 24 November 2026:
-- "swipe to hide for everyone other than the coach and the author"). Its text
-- is kept for the Child Safety Officer. False for every other message.
create or replace function public.chat_post_hidden_from_me(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.chat_groups g on g.id = m.chat_group_id
    where m.id = p_message_id
      and m.audience = 'chat'
      and m.removed_at is not null
      and m.sender_id is distinct from auth.uid()
      and not public.chat_can_remove(g, auth.uid())
      and not exists (
        select 1
        from public.guardianships gs
        join public.profiles gp on gp.id = gs.guardian_id
        where gs.athlete_id = m.sender_id
          and gs.guardian_id = auth.uid()
          and gp.status = 'approved'
          and gp.verified_at is not null
      )
  );
$$;

revoke execute on function public.chat_post_hidden_from_me(uuid) from public, anon, authenticated;

-- A group's name as members see it.
create or replace function public.chat_group_name(p_group public.chat_groups)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_group.kind
    when 'custom' then p_group.name
    when 'managers' then 'All managers'
    else coalesce((select t.name from public.teams t where t.id = p_group.team_id), 'A squad or team')
      || case p_group.kind
        when 'team_staff' then ' coaches and managers'
        when 'team_captains' then ' coaches and captains'
        else ' coaches and physios'
      end
  end;
$$;

revoke execute on function public.chat_group_name(public.chat_groups) from public, anon, authenticated;

-- The automatic groups for every current squad and team. Rows only name the
-- group; who is in it is worked out each time. Not for the app to call.
create or replace function public.ensure_automatic_chat_groups()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.chat_groups (kind, team_id)
  select k.kind, t.id
  from public.teams t
  cross join (values ('team_staff'), ('team_captains'), ('team_physio')) as k (kind)
  where not t.archived and (k.kind <> 'team_captains' or t.kind = 'team')
  on conflict do nothing;
  insert into public.chat_groups (kind) values ('managers') on conflict do nothing;
$$;

revoke execute on function public.ensure_automatic_chat_groups() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The member's groups
-- ---------------------------------------------------------------------------

-- The signed-in member's groups: the ones they're in now, and ones they were
-- sent posts in before leaving (read only). An automatic group shows once
-- there are two people in it; coaches and physios only when it has a physio.
create or replace function public.my_chat_groups()
returns table (
  id uuid,
  kind text,
  name text,
  team_id uuid,
  is_member boolean,
  can_post boolean,
  -- Why the member can't post: 'under_18' (an admin's group, or no coach in
  -- it now), 'left' or 'closed'.
  read_only_reason text,
  -- Whether the member can remove posts (the group's coaches).
  can_remove boolean,
  member_count int,
  hidden boolean,
  unread_count int,
  last_post_at timestamptz,
  last_post text,
  last_sender text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_minor boolean;
begin
  select * into v_me from public.profiles p where p.id = auth.uid();
  if v_me.id is null or v_me.status <> 'approved' or not public.chat_groups_on()
     or public.chat_minor_unguarded(v_me.id) then
    return;
  end if;
  v_minor := public.is_minor(v_me.date_of_birth, v_me.under_17);
  perform public.ensure_automatic_chat_groups();

  return query
  with groups as (
    select g.*,
      public.chat_group_name(g) as group_name,
      public.chat_can_post(g, v_me.id) as can_post_now,
      public.chat_can_remove(g, v_me.id) as can_remove_now,
      public.chat_group_coach_led(g) as coach_led,
      (select count(*)::int from public.chat_group_people(g) x) as n_people,
      v_me.id in (select x from public.chat_group_people(g) x) as member,
      exists (
        select 1 from public.chat_group_people(g) x
        join public.profiles p on p.id = x
        where 'physio' = any (public.roles_of(p.role, p.extra_roles))
      ) as has_physio
    from public.chat_groups g
  ),
  mine as (
    select g.*
    from groups g
    where (g.member and g.n_people >= 2 and (g.kind <> 'team_physio' or g.has_physio))
      -- A group the member has left, while they can still read a post in it
      -- (a stood-down coach can't).
      or exists (
        select 1 from public.message_recipients r
        where r.profile_id = v_me.id and r.chat_group_id = g.id
          and public.is_message_recipient(r.message_id)
      )
      or exists (
        select 1 from public.messages m
        where m.chat_group_id = g.id and m.sender_id = v_me.id and not public.is_stood_down()
      )
  ),
  last_posts as (
    select distinct on (m.chat_group_id) m.chat_group_id, m.created_at, m.body, m.sender_name
    from public.messages m
    join mine g on g.id = m.chat_group_id
    where not public.chat_post_hidden_from_me(m.id)
      and ((m.sender_id = v_me.id and not public.is_stood_down())
      or exists (
        select 1 from public.message_recipients r
        where r.message_id = m.id and r.profile_id = v_me.id and r.chat_group_id = m.chat_group_id
      ))
    order by m.chat_group_id, m.created_at desc
  )
  select g.id, g.kind, g.group_name, g.team_id,
    g.member,
    g.can_post_now,
    case
      when g.closed_at is not null then 'closed'
      when not g.member then 'left'
      when v_minor and not g.coach_led then 'under_18'
    end,
    g.can_remove_now,
    g.n_people,
    exists (select 1 from public.chat_group_hidden h where h.group_id = g.id and h.profile_id = v_me.id),
    (select count(*)::int from public.message_recipients r
      where r.profile_id = v_me.id and r.chat_group_id = g.id and r.unread
        and not public.chat_post_hidden_from_me(r.message_id)),
    lp.created_at, lp.body, coalesce(lp.sender_name, 'Club')
  from mine g
  left join last_posts lp on lp.chat_group_id = g.id
  order by lp.created_at desc nulls last, g.group_name;
end;
$$;

revoke execute on function public.my_chat_groups() from public, anon;
grant execute on function public.my_chat_groups() to authenticated;

-- A group's posts the signed-in member sent or was sent, oldest first, 50 at a
-- time: the latest, or with p_before the 50 before that time, as the member
-- scrolls up. Read counts are for the member's own posts only.
create or replace function public.chat_group_posts(p_group_id uuid, p_before timestamptz default null)
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  body text,
  created_at timestamptz,
  mine boolean,
  -- Removed after the club's keep period.
  body_removed boolean,
  -- Hidden by a coach: only its author, the group's coaches and the author's
  -- parents still get it, greyed out.
  removed_by_name text,
  read_count int,
  recipient_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select m.id, m.sender_id, coalesce(m.sender_name, 'Club'),
      m.body,
      m.created_at,
      m.sender_id = auth.uid(),
      m.body_removed_at is not null,
      case when m.removed_at is not null then coalesce(m.removed_by_name, 'a coach') end,
      case when m.sender_id = auth.uid() then
        (select count(r.read_at)::int from public.message_recipients r where r.message_id = m.id) end,
      case when m.sender_id = auth.uid() then
        (select count(*)::int from public.message_recipients r where r.message_id = m.id) end
    from public.messages m
    where m.chat_group_id = p_group_id
      and (p_before is null or m.created_at < p_before)
      and not public.chat_post_hidden_from_me(m.id)
      and public.chat_groups_on()
      and not public.chat_minor_unguarded(auth.uid())
      and (
        (m.sender_id = auth.uid() and not public.is_stood_down())
        or (
          exists (
            select 1 from public.message_recipients r
            where r.message_id = m.id and r.profile_id = auth.uid() and r.chat_group_id = p_group_id
          )
          and public.is_message_recipient(m.id)
        )
      )
    order by m.created_at desc
    limit 50
  ) latest
  order by created_at;
$$;

revoke execute on function public.chat_group_posts(uuid, timestamptz) from public, anon;
grant execute on function public.chat_group_posts(uuid, timestamptz) to authenticated;

-- Who is in a group, for adults in it, and for admins looking at their own
-- groups. Under-18s don't see the list.
create or replace function public.chat_group_members(p_group_id uuid)
returns table (profile_id uuid, full_name text, detail text, under_18 boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group public.chat_groups;
  v_me public.profiles;
begin
  select * into v_group from public.chat_groups g where g.id = p_group_id;
  select * into v_me from public.profiles p where p.id = auth.uid();
  if v_group.id is null or v_me.id is null or v_me.status <> 'approved'
     or not public.chat_groups_on() then
    return;
  end if;
  if not (
    (v_me.id in (select x from public.chat_group_people(v_group) x)
      and not public.is_minor(v_me.date_of_birth, v_me.under_17))
    or (v_group.kind = 'custom' and public.is_admin())
  ) then
    return;
  end if;

  return query
  select p.id, public.member_display_name(p.id),
    case
      when v_group.kind = 'custom' then null
      when v_group.kind = 'managers' then (
        select 'Manager, ' || string_agg(t.name, ', ' order by t.sort_order, t.name)
        from public.team_members tm join public.teams t on t.id = tm.team_id and not t.archived
        where tm.profile_id = p.id and tm.team_role = 'manager'
      )
      when exists (
        select 1 from public.team_captains tc
        where tc.team_id = v_group.team_id and tc.profile_id = p.id and v_group.kind = 'team_captains'
      ) then (
        select case tc.captain_role when 'captain' then 'Captain' else 'Vice captain' end
        from public.team_captains tc where tc.team_id = v_group.team_id and tc.profile_id = p.id
      )
      when exists (
        select 1 from public.team_members tm
        where tm.team_id = v_group.team_id and tm.profile_id = p.id
          and tm.team_role in ('coach', 'manager', 'physio')
      ) then (
        select string_agg(
          case tm.team_role when 'coach' then 'Coach' when 'manager' then 'Manager' else 'Physio' end,
          ', ')
        from public.team_members tm
        where tm.team_id = v_group.team_id and tm.profile_id = p.id
          and tm.team_role in ('coach', 'manager', 'physio')
      )
      when p.head_physio then 'Head Physio'
    end,
    public.is_minor(p.date_of_birth, p.under_17)
  from public.chat_group_people(v_group) x
  join public.profiles p on p.id = x
  order by 2;
end;
$$;

revoke execute on function public.chat_group_members(uuid) from public, anon;
grant execute on function public.chat_group_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Posting, reading and hiding
-- ---------------------------------------------------------------------------

-- Posts in a group. Goes to everyone in it now but the sender, and to the
-- parents and guardians of each member under 18 (one copy each, naming the
-- children). Members under 18 can't post.
create or replace function public.post_to_chat_group(p_group_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_sender public.profiles;
  v_group public.chat_groups;
  v_message_id uuid;
  v_count int;
begin
  select * into v_sender from public.profiles where id = auth.uid();
  if v_sender.id is null or v_sender.status <> 'approved' then
    raise exception 'Only approved members can post in groups';
  end if;
  if not public.chat_groups_on() then
    raise exception 'Chat groups are turned off for the club';
  end if;
  select * into v_group from public.chat_groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'That group doesn''t exist';
  end if;
  if v_group.closed_at is not null then
    raise exception 'This group is closed. Its posts are kept, but nobody can add to it';
  end if;
  if not exists (select 1 from public.chat_group_people(v_group) x where x = v_sender.id) then
    raise exception 'You''re not in this group';
  end if;
  if not public.chat_can_post(v_group, v_sender.id) then
    raise exception 'Members under 18 can post only in their own squad''s or team''s groups while a coach is in them';
  end if;
  if v_body = '' then
    raise exception 'Write a message first';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Messages can be up to 4000 characters';
  end if;

  insert into public.messages (sender_id, sender_name, body, audience, audience_label, chat_group_id)
  values (
    v_sender.id,
    coalesce(nullif(v_sender.full_name, ''), v_sender.email),
    v_body,
    'chat',
    public.chat_group_name(v_group),
    v_group.id
  )
  returning id into v_message_id;

  with people as (
    select x as id from public.chat_group_people(v_group) x
  )
  insert into public.message_recipients (
    message_id, profile_id, for_children, for_child_names, chat_group_id, inbox_state
  )
  select
    v_message_id,
    r.id,
    case when bool_or(r.child_id is null) then null
      else array_agg(r.child_id order by r.child_name, r.child_id) end,
    case when bool_or(r.child_id is null) then null
      else array_agg(r.child_name order by r.child_name, r.child_id) end,
    -- Members' own copies belong in Groups; a parent's copy in their Inbox.
    case when bool_or(r.child_id is null) then v_group.id end,
    -- A member who hid the group gets the post already marked read. Their
    -- receipt (read_at) stays empty until they open the group.
    case when bool_or(r.child_id is null) and exists (
      select 1 from public.chat_group_hidden h where h.group_id = v_group.id and h.profile_id = r.id
    ) then 'read' end
  from (
    select p.id, null::uuid as child_id, null::text as child_name from people p
    union all
    -- Parents and guardians of members under 18, the sender included, so a
    -- child's own posts reach their parents too.
    select g.guardian_id, c.id, public.member_display_name(c.id)
    from people pe
    join public.profiles c on c.id = pe.id
    join public.guardianships g on g.athlete_id = c.id
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where public.is_minor(c.date_of_birth, c.under_17)
  ) r
  where r.id <> v_sender.id
  group by r.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Nobody else is in this group yet';
  end if;

  return v_message_id;
end;
$$;

revoke execute on function public.post_to_chat_group(uuid, text) from public, anon;
grant execute on function public.post_to_chat_group(uuid, text) to authenticated;

-- Opening a group marks every post in it read (the senders' receipts too,
-- since the member has seen them).
create or replace function public.mark_chat_group_read(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if auth.uid() is null or not public.chat_groups_on() then
    return 0;
  end if;
  update public.message_recipients r
  set read_at = coalesce(r.read_at, now()), inbox_state = null
  where r.profile_id = auth.uid()
    and r.chat_group_id = p_group_id
    and (r.read_at is null or r.inbox_state is not null)
    and public.is_message_recipient(r.message_id);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function public.mark_chat_group_read(uuid) from public, anon;
grant execute on function public.mark_chat_group_read(uuid) to authenticated;

-- Hides a group from the member's Groups list, or shows it again. Hiding
-- marks its posts read in the member's own list only; nobody's receipt
-- changes, and posts keep arriving, already marked read.
create or replace function public.set_chat_group_hidden(p_group_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.chat_groups_on() then
    raise exception 'Chat groups are turned off for the club';
  end if;
  if not exists (select 1 from public.chat_groups where id = p_group_id) then
    raise exception 'That group doesn''t exist';
  end if;
  if p_hidden then
    insert into public.chat_group_hidden (group_id, profile_id)
    values (p_group_id, auth.uid())
    on conflict do nothing;
    update public.message_recipients
    set inbox_state = 'read'
    where profile_id = auth.uid() and chat_group_id = p_group_id and unread;
  else
    delete from public.chat_group_hidden where group_id = p_group_id and profile_id = auth.uid();
  end if;
end;
$$;

revoke execute on function public.set_chat_group_hidden(uuid, boolean) from public, anon;
grant execute on function public.set_chat_group_hidden(uuid, boolean) to authenticated;

-- A coach hides a post (a swipe in the app). It then stays only with its
-- author, the group's coaches and the author's parents, greyed out with who
-- hid it (chat_post_hidden_from_me). Nothing is deleted: the text stays with
-- the message for the Child Safety Officer and Complaints Manager (approved
-- message access), a concern that reported it, and legal hold.
create or replace function public.remove_chat_post(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_group public.chat_groups;
begin
  if auth.uid() is null or not public.chat_groups_on() then
    raise exception 'Chat groups are turned off for the club';
  end if;
  select * into v_message from public.messages where id = p_message_id and audience = 'chat';
  if v_message.id is null then
    raise exception 'That post doesn''t exist';
  end if;
  select * into v_group from public.chat_groups where id = v_message.chat_group_id;
  if v_group.id is null or not public.chat_can_remove(v_group, auth.uid()) then
    raise exception 'Only the group''s coaches can hide posts';
  end if;
  if v_message.removed_at is not null then
    return;
  end if;
  update public.messages
  set removed_at = now(), removed_by = auth.uid(), removed_by_name = public.member_display_name(auth.uid())
  where id = p_message_id;
end;
$$;

revoke execute on function public.remove_chat_post(uuid) from public, anon;
grant execute on function public.remove_chat_post(uuid) to authenticated;

-- A coach shows a hidden post to the group again.
create or replace function public.show_chat_post(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_group public.chat_groups;
begin
  if auth.uid() is null or not public.chat_groups_on() then
    raise exception 'Chat groups are turned off for the club';
  end if;
  select * into v_message from public.messages where id = p_message_id and audience = 'chat';
  if v_message.id is null then
    raise exception 'That post doesn''t exist';
  end if;
  select * into v_group from public.chat_groups where id = v_message.chat_group_id;
  if v_group.id is null or not public.chat_can_remove(v_group, auth.uid()) then
    raise exception 'Only the group''s coaches can hide posts';
  end if;
  update public.messages
  set removed_at = null, removed_by = null, removed_by_name = null
  where id = p_message_id and removed_at is not null;
end;
$$;

revoke execute on function public.show_chat_post(uuid) from public, anon;
grant execute on function public.show_chat_post(uuid) to authenticated;

-- When a parent or guardian is linked to a child, they get a copy of every
-- group post the child was sent or wrote, naming the child, as they would
-- have had they been linked at the time (Matt, 24 November 2026: a child's
-- groups are hidden until a guardian is linked, "and that guardian can get
-- copies of the messages too"). Copies already there aren't touched.
create or replace function public.chat_copies_for_new_guardian()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chat_member_is_minor(new.athlete_id) then
    return null;
  end if;
  insert into public.message_recipients (message_id, profile_id, for_children, for_child_names)
  select m.id, new.guardian_id, array[new.athlete_id], array[public.member_display_name(new.athlete_id)]
  from public.messages m
  where m.audience = 'chat'
    and m.sender_id is distinct from new.guardian_id
    and (
      m.sender_id = new.athlete_id
      or exists (
        select 1 from public.message_recipients r
        where r.message_id = m.id and r.profile_id = new.athlete_id and r.chat_group_id is not null
      )
    )
  on conflict (message_id, profile_id) do update
    set for_children = public.message_recipients.for_children || excluded.for_children,
        for_child_names = public.message_recipients.for_child_names || excluded.for_child_names
    -- A guardian who got it in their own right keeps no children named, and
    -- a child already named isn't named twice.
    where public.message_recipients.for_children is not null
      and not (new.athlete_id = any (public.message_recipients.for_children));
  return null;
end;
$$;

revoke execute on function public.chat_copies_for_new_guardian() from public, anon, authenticated;

drop trigger if exists guardianships_chat_copies on public.guardianships;
create trigger guardianships_chat_copies
  after insert on public.guardianships
  for each row execute function public.chat_copies_for_new_guardian();

-- ---------------------------------------------------------------------------
-- 5. Admins' groups
-- ---------------------------------------------------------------------------

-- Checks an admin's choice of who is in a group, and returns it as a row.
create or replace function public.chat_group_draft(
  p_name text,
  p_roles public.app_role[],
  p_team_ids uuid[],
  p_people uuid[]
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
  v_group.kind := 'custom';
  v_group.name := btrim(coalesce(p_name, ''));
  v_group.roles := coalesce(p_roles, '{}');
  v_group.team_ids := coalesce(p_team_ids, '{}');
  v_group.people := coalesce(p_people, '{}');
  if v_group.roles && array['guest', 'volunteer', 'studio']::public.app_role[] then
    raise exception 'Guests, temporary helpers and Studio don''t get messages';
  end if;
  if cardinality(v_group.team_ids) > 0
     and not v_group.roles <@ array['athlete', 'coach', 'manager', 'physio']::public.app_role[] then
    raise exception 'In squads and teams, choose athletes, coaches, managers or physios';
  end if;
  if exists (
    select 1 from unnest(v_group.team_ids) t
    where not exists (select 1 from public.teams x where x.id = t and not x.archived)
  ) then
    raise exception 'Choose current squads or teams';
  end if;
  if exists (
    select 1 from unnest(v_group.people) x
    where not exists (select 1 from public.profiles p where p.id = x and p.status = 'approved')
  ) then
    raise exception 'Choose approved members';
  end if;
  return v_group;
end;
$$;

revoke execute on function public.chat_group_draft(text, public.app_role[], uuid[], uuid[]) from public, anon, authenticated;

-- How many people an admin's choice would put in a group, and how many are
-- under 18 (who read an admin's group but don't post in it), before saving.
create or replace function public.admin_chat_group_preview(
  p_roles public.app_role[],
  p_team_ids uuid[],
  p_people uuid[]
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
  v_group := public.chat_group_draft('Preview', p_roles, p_team_ids, p_people);
  return query
  select count(*)::int, count(*) filter (where public.chat_member_is_minor(x))::int
  from public.chat_group_people(v_group) x;
end;
$$;

revoke execute on function public.admin_chat_group_preview(public.app_role[], uuid[], uuid[]) from public, anon;
grant execute on function public.admin_chat_group_preview(public.app_role[], uuid[], uuid[]) to authenticated;

-- Adds an admin's group, or changes one (p_id). A change applies to posts
-- from then on; what was posted stays with the people it went to.
create or replace function public.admin_save_chat_group(
  p_id uuid,
  p_name text,
  p_roles public.app_role[],
  p_team_ids uuid[],
  p_people uuid[]
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
  v_group := public.chat_group_draft(p_name, p_roles, p_team_ids, p_people);
  if v_group.name = '' then
    raise exception 'Give the group a name';
  end if;
  if length(v_group.name) > 80 then
    raise exception 'Group names can be up to 80 characters';
  end if;
  if cardinality(v_group.roles) = 0 and cardinality(v_group.team_ids) = 0
     and cardinality(v_group.people) = 0 then
    raise exception 'Choose roles, squads or teams, or people';
  end if;
  if exists (
    select 1 from public.chat_groups g
    where g.kind = 'custom' and lower(g.name) = lower(v_group.name)
      and g.closed_at is null and g.id is distinct from p_id
  ) then
    raise exception 'There''s already a group called %', v_group.name;
  end if;

  if p_id is null then
    insert into public.chat_groups (kind, name, roles, team_ids, people, created_by, created_by_name)
    values ('custom', v_group.name, v_group.roles, v_group.team_ids, v_group.people,
      auth.uid(), public.member_display_name(auth.uid()))
    returning id into v_id;
  else
    update public.chat_groups
    set name = v_group.name, roles = v_group.roles, team_ids = v_group.team_ids,
      people = v_group.people, updated_at = now()
    where id = p_id and kind = 'custom'
    returning id into v_id;
    if v_id is null then
      raise exception 'Only groups admins set up can be changed';
    end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.admin_save_chat_group(uuid, text, public.app_role[], uuid[], uuid[]) from public, anon;
grant execute on function public.admin_save_chat_group(uuid, text, public.app_role[], uuid[], uuid[]) to authenticated;

-- Closes an admin's group, or opens it again. Nothing is deleted.
create or replace function public.admin_set_chat_group_closed(p_id uuid, p_closed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can close chat groups';
  end if;
  update public.chat_groups
  set closed_at = case when p_closed then coalesce(closed_at, now()) end, updated_at = now()
  where id = p_id and kind = 'custom';
  if not found then
    raise exception 'Only groups admins set up can be closed';
  end if;
end;
$$;

revoke execute on function public.admin_set_chat_group_closed(uuid, boolean) from public, anon;
grant execute on function public.admin_set_chat_group_closed(uuid, boolean) to authenticated;

-- Admins' groups for the Chat groups screen: who is in each and how many
-- posts, never the posts themselves.
create or replace function public.admin_chat_groups()
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
  closed_at timestamptz
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
    g.created_by_name, g.created_at, g.closed_at
  from public.chat_groups g
  where g.kind = 'custom' and public.is_admin()
  order by g.closed_at is not null, lower(g.name);
$$;

revoke execute on function public.admin_chat_groups() from public, anon;
grant execute on function public.admin_chat_groups() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Messages that change with groups (same signatures)
-- ---------------------------------------------------------------------------

-- As 20261018020000, plus: members who are only physios read the posts of
-- groups they're in, as they read their squad's and team's messages.
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
    -- Guests and temporary volunteers never see messages, including ones
    -- from before. Members who are only physios see messages to their role,
    -- and whole-club messages only while admins send them those.
    select 1 from public.profiles
    where id = auth.uid()
      and (role in ('guest', 'volunteer') or (
        public.is_view_only_member(role, extra_roles)
        and not public.physios_get_club_messages()
        and not exists (
          select 1 from public.messages m
          where m.id = p_message_id
            and ((m.audience = 'role' and m.audience_role = 'physio')
              -- Physios in a squad or team get its messages.
              or m.audience = 'group'
              -- And the posts of chat groups they're in.
              or m.audience = 'chat')
        )
      ))
  ) and (
    not public.is_stood_down() or public.reached_me_outside_paused_roles(p_message_id)
  ) and not public.is_locked_child(auth.uid())
    -- Group posts stay hidden from a member under 18 until a verified parent
    -- or guardian is linked.
    and not (
      public.chat_minor_unguarded(auth.uid())
      and exists (select 1 from public.messages m where m.id = p_message_id and m.audience = 'chat')
    )
    -- A group post a coach hid stays only with its author, the group's
    -- coaches and the author's parents.
    and not public.chat_post_hidden_from_me(p_message_id);
$$;

-- "Mark all read" in the Inbox leaves group posts alone: they're read by
-- opening the group.
create or replace function public.mark_all_messages_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  update public.message_recipients
  set inbox_state = 'read'
  where profile_id = auth.uid()
    and unread
    and chat_group_id is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Sent lists messages, not group posts, which show in their group.
create or replace function public.my_sent_messages()
returns table (
  id uuid,
  body text,
  audience public.message_audience,
  audience_role public.app_role,
  audience_label text,
  created_at timestamptz,
  recipient_count integer,
  read_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id, m.body, m.audience, m.audience_role, m.audience_label, m.created_at,
    count(r.profile_id)::int,
    count(r.read_at)::int
  from public.messages m
  left join public.message_recipients r on r.message_id = m.id
  where m.sender_id = auth.uid() and not public.is_stood_down()
    and m.audience <> 'chat'
  group by m.id
  order by m.created_at desc
  limit 100;
$$;

commit;
