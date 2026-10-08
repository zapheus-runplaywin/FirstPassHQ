-- A minimum age for award nominees, alongside the age limit from
-- 20261008160000_award_age_limit.sql, so an award can be for, say, athletes
-- aged 16 to 20. nominee_min_age means "at least this age"; nominee_max_age
-- still means "under this age". Both are measured on the same day.
--
-- Additive only: one new nullable column, a new function and replaced
-- functions. admin_set_award_age_limit stays for older app versions. No rows
-- change.

begin;

alter table public.awards add column if not exists nominee_min_age smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'awards_nominee_min_age_check') then
    alter table public.awards
      add constraint awards_nominee_min_age_check check (nominee_min_age between 1 and 99);
  end if;
end;
$$;

-- Who can be voted for: the pool, less anyone outside the award's ages or
-- with no date of birth when it has any. Same columns as before.
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
      n.is_candidate
      or (
        (a.nominee_max_age is null
          or n.date_of_birth > public.award_age_day(a) - make_interval(years => a.nominee_max_age))
        and (a.nominee_min_age is null
          or n.date_of_birth <= public.award_age_day(a) - make_interval(years => a.nominee_min_age))
      )
    );
$$;
revoke execute on function public.award_nominee_rows(uuid, uuid) from public, anon, authenticated;

-- Sets or clears an award's ages: at least p_min_age and under p_max_age on
-- p_age_on (or the day voting closes). Either age can be null. They can't
-- change once anyone has voted.
create or replace function public.admin_set_award_ages(
  p_award_id uuid,
  p_min_age smallint,
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
  v_age_on date := case when p_min_age is null and p_max_age is null then null else p_age_on end;
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage awards';
  end if;
  select * into v_award from public.awards where id = p_award_id;
  if not found then
    raise exception 'That award no longer exists';
  end if;
  if (p_min_age is not null and (p_min_age < 1 or p_min_age > 99))
    or (p_max_age is not null and (p_max_age < 1 or p_max_age > 99)) then
    raise exception 'Choose ages between 1 and 99';
  end if;
  if p_min_age is not null and p_max_age is not null and p_min_age >= p_max_age then
    raise exception 'The minimum age must be below the age nominees must be under';
  end if;
  if (v_award.nominee_min_age is distinct from p_min_age
      or v_award.nominee_max_age is distinct from p_max_age
      or v_award.nominee_age_on is distinct from v_age_on)
    and exists (select 1 from public.award_ballots b where b.award_id = p_award_id) then
    raise exception 'People have voted, so the ages can''t change';
  end if;

  update public.awards
  set nominee_min_age = p_min_age,
      nominee_max_age = p_max_age,
      nominee_age_on = v_age_on
  where id = p_award_id;
end;
$$;
revoke execute on function public.admin_set_award_ages(uuid, smallint, smallint, date) from public, anon;
grant execute on function public.admin_set_award_ages(uuid, smallint, smallint, date) to authenticated;

-- As before, now counting awards with only a minimum age too.
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
    and (a.nominee_max_age is not null or a.nominee_min_age is not null)
    and not n.is_candidate
    and n.date_of_birth is null;
$$;
revoke execute on function public.admin_award_missing_birthdays(uuid) from public, anon;
grant execute on function public.admin_award_missing_birthdays(uuid) to authenticated;

commit;
