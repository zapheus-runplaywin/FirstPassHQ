-- Age limits for award nominees, for awards such as Rising Star.
--
-- An award can say nominees must be under an age (for example under 21) on a
-- day (for example 1 January). With no day set, it is the day voting closes.
-- People with no date of birth can't be voted for while an award has an age
-- limit, so admins see how many of them would otherwise be nominees. Listed
-- names (people not in the app) have no date of birth, so the limit doesn't
-- apply to them.
--
-- Additive only: two new nullable columns, new functions and replaced
-- functions. No rows change.

begin;

alter table public.awards
  add column if not exists nominee_max_age smallint,
  add column if not exists nominee_age_on date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'awards_nominee_max_age_check') then
    alter table public.awards
      add constraint awards_nominee_max_age_check check (nominee_max_age between 1 and 99);
  end if;
end;
$$;

-- Everyone who could be voted for in an award (and group), before any age
-- limit, with their date of birth.
create or replace function public.award_nominee_pool(p_award_id uuid, p_team_id uuid)
returns table (id uuid, is_candidate boolean, name text, date_of_birth date)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, false, coalesce(nullif(p.full_name, ''), p.email), p.date_of_birth
  from public.awards a
  join public.team_members tm
    on tm.team_role = case a.nominees when 'coaches' then 'coach'::public.team_role
                                      else 'athlete'::public.team_role end
  join public.profiles p on p.id = tm.profile_id and p.status = 'approved'
  where a.id = p_award_id
    and a.nominees in ('athletes', 'coaches')
    and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
    and p.id is distinct from auth.uid()
  union all
  select p.id, false, coalesce(nullif(p.full_name, ''), p.email), p.date_of_birth
  from public.awards a
  join public.profiles p on p.status = 'approved' and p.role <> 'guest'
  where a.id = p_award_id
    and a.nominees = 'members'
    and p.id is distinct from auth.uid()
  union all
  select c.id, true, c.name, null::date
  from public.awards a
  join public.award_candidates c on c.award_id = a.id
  where a.id = p_award_id
    and a.nominees = 'listed';
$$;
revoke execute on function public.award_nominee_pool(uuid, uuid) from public, anon, authenticated;

-- The day an award's age limit is measured on.
create or replace function public.award_age_day(p_award public.awards)
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce(p_award.nominee_age_on, (p_award.closes_at at time zone 'Australia/Perth')::date);
$$;
revoke execute on function public.award_age_day(public.awards) from public, anon, authenticated;

-- Who can be voted for: the pool, less anyone at or over the age limit or
-- with no date of birth. Same columns as before.
create or replace function public.award_nominee_rows(p_award_id uuid, p_team_id uuid)
returns table (id uuid, is_candidate boolean, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.is_candidate, n.name
  from public.awards a
  cross join public.award_nominee_pool(p_award_id, p_team_id) n
  where a.id = p_award_id
    and (
      a.nominee_max_age is null
      or n.is_candidate
      or n.date_of_birth > public.award_age_day(a) - make_interval(years => a.nominee_max_age)
    );
$$;
revoke execute on function public.award_nominee_rows(uuid, uuid) from public, anon, authenticated;

-- Sets or clears an award's age limit. It can't change once anyone has
-- voted, since that would change who could have been voted for.
create or replace function public.admin_set_award_age_limit(
  p_award_id uuid,
  p_max_age smallint,
  p_age_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_award public.awards;
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage awards';
  end if;
  select * into v_award from public.awards where id = p_award_id;
  if not found then
    raise exception 'That award no longer exists';
  end if;
  if p_max_age is not null and (p_max_age < 1 or p_max_age > 99) then
    raise exception 'Choose an age between 1 and 99';
  end if;
  if (v_award.nominee_max_age is distinct from p_max_age
      or v_award.nominee_age_on is distinct from (case when p_max_age is null then null else p_age_on end))
    and exists (select 1 from public.award_ballots b where b.award_id = p_award_id) then
    raise exception 'People have voted, so the age limit can''t change';
  end if;

  update public.awards
  set nominee_max_age = p_max_age,
      nominee_age_on = case when p_max_age is null then null else p_age_on end
  where id = p_award_id;
end;
$$;
revoke execute on function public.admin_set_award_age_limit(uuid, smallint, date) from public, anon;
grant execute on function public.admin_set_award_age_limit(uuid, smallint, date) to authenticated;

-- For admins: how many people would be nominees in an award with an age
-- limit but have no date of birth, so can't be voted for.
create or replace function public.admin_award_missing_birthdays(p_award_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct n.id)::int
  from public.awards a
  cross join lateral (
    select g.team_id from public.award_groups g where a.per_group and g.award_id = a.id
    union all
    select null::uuid where not a.per_group
  ) g
  cross join lateral public.award_nominee_pool(a.id, g.team_id) n
  where a.id = p_award_id
    and public.is_admin()
    and a.nominee_max_age is not null
    and not n.is_candidate
    and n.date_of_birth is null;
$$;
revoke execute on function public.admin_award_missing_birthdays(uuid) from public, anon;
grant execute on function public.admin_award_missing_birthdays(uuid) to authenticated;

commit;
