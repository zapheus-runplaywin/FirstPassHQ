-- Injury records are kept for 12 months after an athlete leaves.
--
-- Until now, deleting an account deleted the athlete's injuries and their
-- sign-off history, and left their proof documents in storage where nobody
-- could see or remove them. Now the injury, its history and its documents
-- stay when the account is deleted, with the athlete's name and email kept
-- on the record. Only the committee and admins can see them after that.
-- Twelve months after the athlete left, the purge-expired-injuries function
-- (supabase/functions) removes the documents and then the records.
--
-- Additive only: new columns, a trigger and new or replaced functions. The
-- foreign key from injuries to profiles is dropped so records outlive the
-- profile; no rows are changed or deleted when this migration runs.

alter table public.injuries
  add column if not exists athlete_name text,
  add column if not exists athlete_email text,
  -- When the athlete's account was deleted. Null while they are a member.
  add column if not exists athlete_left_at timestamptz;

-- The athlete's id stays on the record, and in its document paths, after
-- their profile is gone.
alter table public.injuries drop constraint if exists injuries_athlete_id_fkey;

-- ---------------------------------------------------------------------------
-- Keep the record when the athlete leaves
-- ---------------------------------------------------------------------------

create or replace function public.keep_injuries_of_leaving_athlete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.injuries
  set athlete_name = coalesce(nullif(old.full_name, ''), old.email),
      athlete_email = old.email,
      athlete_left_at = now()
  where athlete_id = old.id and athlete_left_at is null;
  return old;
end;
$$;

revoke execute on function public.keep_injuries_of_leaving_athlete() from public, anon, authenticated;

drop trigger if exists profiles_keep_injuries on public.profiles;
create trigger profiles_keep_injuries
  before delete on public.profiles
  for each row execute function public.keep_injuries_of_leaving_athlete();

-- ---------------------------------------------------------------------------
-- Twelve months after leaving, records and documents are removed
-- ---------------------------------------------------------------------------

create or replace function public.injury_retention_over(p_left_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_left_at < now() - interval '12 months';
$$;

revoke execute on function public.injury_retention_over(timestamptz) from public, anon, authenticated;

-- Documents of injuries whose athlete left more than 12 months ago. The purge
-- function removes these through the storage API first.
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
    and public.injury_retention_over(i.athlete_left_at)
  order by o.name;
$$;

-- Then removes the expired injuries (and, with them, their history). An
-- injury whose documents are still in storage is left for the next run, so
-- a record is never removed while its files remain.
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
  where public.injury_retention_over(i.athlete_left_at)
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

-- Only the purge function (which uses the service role) can call these.
revoke execute on function public.expired_injury_documents() from public, anon, authenticated;
revoke execute on function public.purge_expired_injuries() from public, anon, authenticated;
grant execute on function public.expired_injury_documents() to service_role;
grant execute on function public.purge_expired_injuries() to service_role;

-- ---------------------------------------------------------------------------
-- Reading injuries of athletes who have left
-- ---------------------------------------------------------------------------

-- Same as before, but the athlete's name falls back to the one kept on the
-- record, and injuries of athletes who left only show when asked for (the
-- cleared list, or one injury by id), so they don't count as current.
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
          or (public.is_admin() and not exists (
            select 1 from public.team_members c
            join public.team_members a on a.team_id = c.team_id
            join public.teams t on t.id = c.team_id
            where a.profile_id = i.athlete_id and a.team_role = 'athlete'
              and c.team_role = 'coach' and not t.archived
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

-- The admin report gains the date an athlete left, and keeps listing their
-- injuries by the name and email kept on the record.
drop function if exists public.injury_report(date);

create function public.injury_report(p_since date)
returns table (
  id uuid,
  athlete_name text,
  athlete_email text,
  athlete_left_at timestamptz,
  body_area text,
  injured_on date,
  reported_at timestamptz,
  status public.injury_status,
  restrictions text,
  expected_return date,
  coach_endorsed_by_name text,
  cleared_by_name text,
  cleared_at timestamptz,
  update_count int,
  document_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    coalesce(nullif(p.full_name, ''), p.email, i.athlete_name),
    coalesce(p.email, i.athlete_email),
    i.athlete_left_at,
    i.body_area, i.injured_on,
    i.created_at, i.status, i.restrictions, i.expected_return,
    -- Names of people who have since left come from the injury's history.
    case when i.status in ('coach_endorsed', 'cleared') then coalesce(
      nullif(e.full_name, ''), e.email,
      (select u.author_name from public.injury_updates u
       where u.injury_id = i.id and u.kind = 'coach_endorsed'
       order by u.created_at desc limit 1)
    ) end,
    case when i.status = 'cleared' then coalesce(
      nullif(c.full_name, ''), c.email,
      (select u.author_name from public.injury_updates u
       where u.injury_id = i.id and u.kind = 'cleared'
       order by u.created_at desc limit 1)
    ) end,
    i.cleared_at,
    (select count(*)::int from public.injury_updates u where u.injury_id = i.id),
    (select count(u.document_path)::int from public.injury_updates u where u.injury_id = i.id)
  from public.injuries i
  left join public.profiles p on p.id = i.athlete_id
  left join public.profiles e on e.id = i.coach_endorsed_by
  left join public.profiles c on c.id = i.cleared_by
  where public.is_admin()
    and (i.created_at >= p_since or i.status <> 'cleared' or i.cleared_at >= p_since)
  order by i.created_at desc;
$$;

revoke execute on function public.injury_report(date) from public, anon;
grant execute on function public.injury_report(date) to authenticated;
