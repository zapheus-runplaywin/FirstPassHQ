-- Injury documents are removed soon after the athlete is cleared; the record
-- of them is kept (child safety audit finding 4, decided by Matt on
-- 13 October 2026, thread "Child safety audit").
--
-- Until now a physio's letter or a photo stayed until 12 months after the
-- athlete left the club, which can be many years. The club only needs the
-- file while a clearance is being checked. Now, once an admin has switched
-- on "Remove old records" in Club settings, the nightly clean-up removes an
-- injury's files at whichever comes first:
-- - 90 days after the injury was cleared (the club can choose 30, 60, 90 or
--   180 days), or
-- - the end of the season it was cleared in, which is when an admin archives
--   that season.
--
-- What stays, for the club's keep periods: the injury, its history and
-- sign-offs, each document's name, who added it and when, the letter and
-- consent confirmations, and who viewed or shared it. Each document is
-- marked with when its file was removed. Injuries that aren't cleared keep
-- their files.
--
-- This migration only adds two columns with defaults and new functions; it
-- changes no rows. The files are removed by the purge-expired-injuries
-- function through the storage API, and only for clubs that switch removal
-- on. Removing a file can't be undone.

begin;

alter table public.club_settings
  add column if not exists retention_injury_documents_days integer not null default 90;

-- When the document's file was removed after the keep period. The row, with
-- the document's name, stays.
alter table public.injury_updates
  add column if not exists document_removed_at timestamptz;

-- The season an injury was cleared in: the newest season whose squads or
-- teams were set up by then.
create or replace function public.injury_cleared_season(p_cleared_at timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select max(t.season) from public.teams t where t.created_at <= p_cleared_at;
$$;

revoke execute on function public.injury_cleared_season(timestamptz) from public, anon, authenticated;

-- True when a cleared injury's files are past the club's keep period: the
-- chosen number of days after clearance, or its season has been archived.
-- Always false while "Remove old records" is off.
create or replace function public.injury_documents_expired(p_injury public.injuries)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p_injury.status = 'cleared'
      and p_injury.cleared_at is not null
      and (
        p_injury.cleared_at < now() - make_interval(days => s.retention_injury_documents_days)
        or exists (
          select 1 from public.teams t
          where t.season = public.injury_cleared_season(p_injury.cleared_at)
          group by t.season
          having bool_and(t.archived)
        )
      )
    from public.club_settings s
    where s.id and s.retention_enabled
  ), false);
$$;

revoke execute on function public.injury_documents_expired(public.injuries) from public, anon, authenticated;

-- Files of cleared injuries past the keep period, for the purge function to
-- remove from storage. Empty while removal is off.
create or replace function public.cleared_injury_documents()
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
    and public.injury_documents_expired(i)
  order by o.name;
$$;

revoke execute on function public.cleared_injury_documents() from public, anon, authenticated;
grant execute on function public.cleared_injury_documents() to service_role;

-- After the files go, marks each of those injuries' documents as removed,
-- and returns how many were marked. A document whose file is still in
-- storage isn't marked, so a failed run is finished by the next.
create or replace function public.mark_removed_injury_documents()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.injury_updates u
  set document_removed_at = now()
  from public.injuries i
  where i.id = u.injury_id
    and u.document_path is not null
    and u.document_removed_at is null
    and public.injury_documents_expired(i)
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'injury-documents' and o.name = u.document_path
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_removed_injury_documents() from public, anon, authenticated;
grant execute on function public.mark_removed_injury_documents() to service_role;

-- How many days after clearance injury files are kept, for admins.
create or replace function public.injury_documents_keep_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select retention_injury_documents_days from public.club_settings where id), 90)
  where public.is_admin();
$$;

revoke execute on function public.injury_documents_keep_days() from public, anon;
grant execute on function public.injury_documents_keep_days() to authenticated;

-- Admins choose 30, 60, 90 or 180 days.
create or replace function public.admin_set_injury_documents_keep_days(p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change how long records are kept';
  end if;
  if p_days is null or p_days not in (30, 60, 90, 180) then
    raise exception 'Injury documents can be kept 30, 60, 90 or 180 days after clearance';
  end if;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set retention_injury_documents_days = p_days,
      retention_updated_by_name = public.member_display_name(auth.uid()),
      retention_updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_injury_documents_keep_days(integer) from public, anon;
grant execute on function public.admin_set_injury_documents_keep_days(integer) to authenticated;

commit;
