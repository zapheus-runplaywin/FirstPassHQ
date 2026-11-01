-- Customer review fixes (Part 1), Matt's decisions of 20 October 2026:
--
-- 1. I4: a clearance nobody can endorse. Once a squad's phase is complete,
--    its coaches stop looking after athletes who weren't picked for a team,
--    so their clearance can only be endorsed by a Head Physio or a physio in
--    their squad or team. With neither, the request waits for ever. Nobody's
--    access changes: admins_unendorsable_clearances lists those requests for
--    admins, and the app puts them on every admin's to-do list.
-- 2. I5 and I6: injuries of athletes who left follow the club's own rules.
--    Until now every injury of an athlete who left more than 12 months ago
--    was removed each night, with its files, even while "Remove old records"
--    was off and whatever the club's "Cleared injuries" period said. Now
--    nothing of theirs is removed while it's off. Once it's on, a cleared
--    injury goes after the Cleared injuries period counted from when it was
--    cleared or the athlete left, whichever is later, and an injury that was
--    never cleared goes after the same period counted from when they left.
--    Files of cleared injuries already follow the Injury documents period
--    (cleared_injury_documents, unchanged); files of an injury never cleared
--    stay until the injury goes.
-- 3. I16: every club gets a "Representative or elite program" absence
--    reason, so clubs outside WA have one that isn't West Coast Fever.
--
-- Deletes less than before, never more. No rows are deleted or changed by
-- this migration itself; it adds one absence reason where it's missing.

begin;

-- ---------------------------------------------------------------------------
-- 1. Clearances nobody can endorse
-- ---------------------------------------------------------------------------

-- Whether a member could endorse this athlete's clearance today, by the same
-- rules as coaches_athlete and physio_looks_after, asked about someone other
-- than the signed-in member: approved, not stood down, cleared to work with
-- children, not the athlete or their guardian, and either a coach of a
-- current squad or team the athlete is in whose phase isn't complete, or a
-- physio who is the Head Physio or is in a current squad or team with them.
-- A parent's consent isn't part of it: that has its own message.
create or replace function public.could_endorse_clearance(p_member_id uuid, p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_member_id and p.id <> p_athlete_id
      and p.status = 'approved' and p.stood_down_at is null
      and public.is_cleared(p.id)
      and not exists (
        select 1 from public.guardianships g
        where g.guardian_id = p.id and g.athlete_id = p_athlete_id
      )
      and (
        exists (
          select 1 from public.team_members coach
          join public.teams t on t.id = coach.team_id
          join public.team_members a on a.team_id = coach.team_id
          where coach.profile_id = p.id and coach.team_role = 'coach'
            and not t.archived and t.selections_completed_at is null
            and a.profile_id = p_athlete_id and a.team_role = 'athlete'
        )
        or ('physio' = any (public.roles_of(p.role, p.extra_roles)) and (
          p.head_physio
          or exists (
            select 1 from public.team_members me
            join public.teams t on t.id = me.team_id
            join public.team_members a on a.team_id = me.team_id
            where me.profile_id = p.id and me.team_role = 'physio' and not t.archived
              and a.profile_id = p_athlete_id and a.team_role = 'athlete'
          )
        ))
      )
  );
$$;

revoke execute on function public.could_endorse_clearance(uuid, uuid) from public, anon, authenticated;

-- Clearance requests of current athletes that nobody in the club could
-- endorse, oldest first, for admins only.
create or replace function public.admin_unendorsable_clearances()
returns table (
  injury_id uuid,
  athlete_id uuid,
  athlete_name text,
  body_area text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.athlete_id, coalesce(nullif(p.full_name, ''), p.email), i.body_area
  from public.injuries i
  join public.profiles p on p.id = i.athlete_id
  where public.is_admin()
    and i.status = 'clearance_requested'
    and i.athlete_left_at is null
    and not exists (
      select 1 from public.profiles e
      where public.could_endorse_clearance(e.id, i.athlete_id)
    )
  order by i.updated_at, i.id;
$$;

revoke execute on function public.admin_unendorsable_clearances() from public, anon;
grant execute on function public.admin_unendorsable_clearances() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Injuries of athletes who left follow the club's rules
-- ---------------------------------------------------------------------------

-- True when this injury of an athlete who left is past the club's Cleared
-- injuries period. Always false while "Remove old records" is off, and for
-- athletes who haven't left.
create or replace function public.departed_injury_expired(p_injury public.injuries)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p_injury.athlete_left_at is not null
      and greatest(p_injury.athlete_left_at,
            case when p_injury.status = 'cleared' then p_injury.cleared_at end)
          < now() - make_interval(months => s.retention_injuries_months)
    from public.club_settings s
    where s.id and s.retention_enabled
  ), false);
$$;

revoke execute on function public.departed_injury_expired(public.injuries) from public, anon, authenticated;

-- Documents of injuries of athletes who left that are past the club's
-- period. The purge function removes these through the storage API first.
create or replace function public.expired_injury_documents()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  join public.injuries i
    on i.athlete_id::text = split_part(o.name, '/', 1)
   and i.id::text = split_part(o.name, '/', 2)
  where o.bucket_id = 'injury-documents'
    and public.departed_injury_expired(i)
  order by o.name;
$$;

-- Removes injuries of athletes who left once they are past the club's
-- period and their files are gone. Returns how many went.
create or replace function public.purge_expired_injuries()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.injuries i
  where public.departed_injury_expired(i)
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'injury-documents'
        and split_part(o.name, '/', 1) = i.athlete_id::text
        and split_part(o.name, '/', 2) = i.id::text
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.expired_injury_documents() from public, anon, authenticated;
revoke execute on function public.purge_expired_injuries() from public, anon, authenticated;
grant execute on function public.expired_injury_documents() to service_role;
grant execute on function public.purge_expired_injuries() to service_role;

-- ---------------------------------------------------------------------------
-- 3. A generic representative reason
-- ---------------------------------------------------------------------------

insert into public.absence_categories (name, sort_order)
select 'Representative or elite program', 7
where not exists (
  select 1 from public.absence_categories
  where lower(trim(name)) = 'representative or elite program'
);

commit;
