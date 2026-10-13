-- Child safety finding 13: tell parents when something changes.
--
-- Each child's parents and guardians (until the child turns 18) see what has
-- changed around their child, newest first:
--   - an adult (coach, manager or physio) added to or removed from a squad or
--     team the child is in, from when the child joined it
--   - the child added to or removed from a squad or team
--   - a parent or guardian linked or unlinked
--   - a consent given or withdrawn
--   - one of the child's injury documents shared out of the app
-- A stand-down shows only as the adult leaving the group: the reason stays
-- with the admins.
--
-- Additive only: a new table filled by a trigger from now on, a table for
-- when each guardian last looked, and new functions. Everything else is read
-- from records the app already keeps.

begin;

-- Who joined or left each squad or team, and in what role.
create table if not exists public.group_membership_changes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid,
  team_name text,
  profile_id uuid,
  member_name text,
  team_role text not null,
  change text not null check (change in ('added', 'removed')),
  changed_at timestamptz not null default now()
);

create index if not exists group_membership_changes_team
  on public.group_membership_changes (team_id, changed_at desc);
create index if not exists group_membership_changes_member
  on public.group_membership_changes (profile_id, changed_at desc);

alter table public.group_membership_changes enable row level security;
-- Read only through the functions below.
revoke all on public.group_membership_changes from public, anon, authenticated;

create or replace function public.log_group_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and (tg_op = 'DELETE' or old.team_role is distinct from new.team_role) then
    insert into public.group_membership_changes (team_id, team_name, profile_id, member_name, team_role, change)
    values (
      old.team_id,
      (select name from public.teams where id = old.team_id),
      old.profile_id,
      public.member_display_name(old.profile_id),
      old.team_role::text,
      'removed'
    );
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or old.team_role is distinct from new.team_role) then
    insert into public.group_membership_changes (team_id, team_name, profile_id, member_name, team_role, change)
    values (
      new.team_id,
      (select name from public.teams where id = new.team_id),
      new.profile_id,
      public.member_display_name(new.profile_id),
      new.team_role::text,
      'added'
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.log_group_membership_change() from public, anon, authenticated;

drop trigger if exists team_members_log_changes on public.team_members;
create trigger team_members_log_changes
  after insert or update or delete on public.team_members
  for each row execute function public.log_group_membership_change();

-- When each guardian last opened each child's activity.
create table if not exists public.child_activity_seen (
  guardian_id uuid not null references public.profiles (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (guardian_id, athlete_id)
);

alter table public.child_activity_seen enable row level security;
revoke all on public.child_activity_seen from public, anon, authenticated;

-- A child's activity, newest first, for their parents and guardians (until
-- the child turns 18) and admins. Empty for anyone else.
create or replace function public.child_activity(p_athlete_id uuid, p_limit integer default 100)
returns table (kind text, summary text, happened_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.is_approved() and (public.is_guardian_of(p_athlete_id) or public.is_admin()) as ok
  ),
  child as (
    select coalesce(public.member_display_name(p_athlete_id), 'Your child') as name
  ),
  events as (
    -- Adults joining or leaving the child's squads and teams, from when the
    -- child joined.
    select 'adult'::text as kind,
      coalesce(g.member_name, 'Someone') || case g.change when 'added' then ' was added as ' else ' is no longer ' end
        || case g.team_role when 'coach' then 'a coach' when 'manager' then 'a manager' else 'a physio' end
        || case g.change when 'added' then ' of ' else ' in ' end
        || coalesce(g.team_name, 'a squad or team') || '.' as summary,
      g.changed_at as happened_at
    from public.group_membership_changes g
    join public.team_members tm
      on tm.team_id = g.team_id and tm.profile_id = p_athlete_id and tm.team_role = 'athlete'
    where g.team_role in ('coach', 'manager', 'physio')
      and g.profile_id is distinct from p_athlete_id
      and g.changed_at >= tm.created_at
    union all
    -- The child joining or leaving a squad or team.
    select 'group',
      (select name from child) || case g.change when 'added' then ' was added to ' else ' was removed from ' end
        || coalesce(g.team_name, 'a squad or team') || '.',
      g.changed_at
    from public.group_membership_changes g
    where g.profile_id = p_athlete_id and g.team_role = 'athlete'
    union all
    select 'guardian',
      coalesce(h.guardian_name, 'A parent or guardian')
        || case h.change when 'linked' then ' was linked as a parent or guardian'
          else ' was unlinked as a parent or guardian' end
        || coalesce(', by ' || h.changed_by_name, '') || '.',
      h.changed_at
    from public.guardianship_history h
    where h.athlete_id = p_athlete_id
    union all
    select 'consent',
      coalesce(c.given_by_name, 'A parent or guardian') || ' gave consent for '
        || case c.kind when 'data' then 'daily check-ins' else 'injuries and health information' end || '.',
      c.given_at
    from public.child_consents c
    where c.athlete_id = p_athlete_id
    union all
    select 'consent',
      coalesce(c.withdrawn_by_name, 'A parent or guardian') || ' withdrew consent for '
        || case c.kind when 'data' then 'daily check-ins' else 'injuries and health information' end || '.',
      c.withdrawn_at
    from public.child_consents c
    where c.athlete_id = p_athlete_id and c.withdrawn_at is not null
    union all
    select 'shared',
      coalesce(l.viewer_name, 'Someone')
        || coalesce(' (' || lower(l.viewer_role) || ')', '')
        || ' shared an injury document out of the app.',
      l.created_at
    from public.record_access_log l
    where l.subject_id = p_athlete_id and l.kind = 'injury_document_shared'
  )
  select e.kind, e.summary, e.happened_at
  from events e
  where (select ok from allowed)
  order by e.happened_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke execute on function public.child_activity(uuid, integer) from public, anon;
grant execute on function public.child_activity(uuid, integer) to authenticated;

-- How many things happened since the signed-in guardian last looked, for
-- each of their children under 18.
create or replace function public.child_activity_new()
returns table (athlete_id uuid, new_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.profile_id,
    (select count(*)::int
     from public.child_activity(a.profile_id, 500) e
     where e.happened_at > coalesce(
       (select s.seen_at from public.child_activity_seen s
        where s.guardian_id = auth.uid() and s.athlete_id = a.profile_id),
       '-infinity'::timestamptz))
  from public.my_athletes() a;
$$;

revoke execute on function public.child_activity_new() from public, anon;
grant execute on function public.child_activity_new() to authenticated;

-- The guardian has opened a child's activity.
create or replace function public.mark_child_activity_seen(p_athlete_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_approved() and public.is_guardian_of(p_athlete_id)) then
    return;
  end if;
  insert into public.child_activity_seen (guardian_id, athlete_id, seen_at)
  values (auth.uid(), p_athlete_id, now())
  on conflict (guardian_id, athlete_id) do update set seen_at = excluded.seen_at;
end;
$$;

revoke execute on function public.mark_child_activity_seen(uuid) from public, anon;
grant execute on function public.mark_child_activity_seen(uuid) to authenticated;

commit;
