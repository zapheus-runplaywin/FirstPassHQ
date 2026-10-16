-- New or changed absences go on the to-do list of the coaches and managers of
-- the athlete's squads and teams (Matt, 2026-10-15). An absence is new when
-- it was reported, and changed when it was withdrawn, after the member last
-- tapped "Mark as reviewed". Absences that ended more than 14 days ago don't
-- count. A member who has never reviewed starts with the last 7 days.
--
-- Additive only: a new table and new functions.

begin;

create table if not exists public.absence_reviews (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  reviewed_at timestamptz not null default now()
);

alter table public.absence_reviews enable row level security;
-- Read and written only through the functions below.
revoke all on public.absence_reviews from public, anon, authenticated;

-- Absences reported or withdrawn since the signed-in member last reviewed,
-- for the athletes in squads and teams they coach or manage. Not those the
-- member reported or withdrew themselves.
create or replace function public.absences_to_review()
returns table (
  id uuid,
  athlete_id uuid,
  athlete_name text,
  from_day date,
  to_day date,
  category text,
  reason text,
  reported_by_name text,
  withdrawn boolean,
  changed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with since as (
    select coalesce(
      (select r.reviewed_at from public.absence_reviews r where r.profile_id = auth.uid()),
      now() - interval '7 days'
    ) as at
  )
  select a.id, a.athlete_id, coalesce(public.member_display_name(a.athlete_id), 'Athlete'),
    a.from_day, a.to_day, c.name, a.reason, a.reported_by_name,
    a.withdrawn_at is not null, coalesce(a.withdrawn_at, a.created_at)
  from public.attendance_absences a
  cross join since
  left join public.absence_categories c on c.id = a.category_id
  where a.to_day >= current_date - 14
    and (
      (a.withdrawn_at is null and a.created_at > since.at
        and a.reported_by is distinct from auth.uid())
      or (a.withdrawn_at > since.at and a.withdrawn_by is distinct from auth.uid())
    )
    and exists (
      select 1 from public.team_members tm
      where tm.profile_id = a.athlete_id
        and tm.team_role = 'athlete'
        and public.leads_group(tm.team_id)
    )
  order by coalesce(a.withdrawn_at, a.created_at) desc;
$$;

revoke execute on function public.absences_to_review() from public, anon;
grant execute on function public.absences_to_review() to authenticated;

-- The signed-in member has looked at the absences waiting for them.
create or replace function public.mark_absences_reviewed()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.absence_reviews (profile_id, reviewed_at)
  select auth.uid(), now()
  where auth.uid() is not null and public.is_approved()
  on conflict (profile_id) do update set reviewed_at = excluded.reviewed_at;
$$;

revoke execute on function public.mark_absences_reviewed() from public, anon;
grant execute on function public.mark_absences_reviewed() to authenticated;

commit;
