-- Daily check-ins.
--
-- Once a day an athlete rates their sleep, soreness, stress and mood from 1
-- (bad) to 5 (good), with an optional note. A score of 2 or less flags them,
-- so their coaches can follow up before training.
--
-- Check-ins are private like injuries: only the athlete, their guardians,
-- their coaches and admins can see them. Managers and the committee can't.
--
-- Additive only: one new table and new functions.

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  -- The athlete's own calendar day, so a 6am check-in in Perth counts for that day.
  day date not null,
  sleep smallint not null check (sleep between 1 and 5),
  soreness smallint not null check (soreness between 1 and 5),
  stress smallint not null check (stress between 1 and 5),
  mood smallint not null check (mood between 1 and 5),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, day)
);

create index if not exists check_ins_day_idx on public.check_ins (day);

drop trigger if exists check_ins_touch_updated_at on public.check_ins;
create trigger check_ins_touch_updated_at
  before update on public.check_ins
  for each row execute function public.touch_updated_at();

-- Written only through save_check_in().
alter table public.check_ins enable row level security;

create or replace function public.can_view_check_ins(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    p_athlete_id = auth.uid()
    or public.is_guardian_of(p_athlete_id)
    or public.coaches_athlete(p_athlete_id)
    or public.is_admin()
  );
$$;

revoke execute on function public.can_view_check_ins(uuid) from public, anon;
grant execute on function public.can_view_check_ins(uuid) to authenticated;

drop policy if exists "Athletes, guardians, coaches and admins see check-ins" on public.check_ins;
create policy "Athletes, guardians, coaches and admins see check-ins"
  on public.check_ins for select to authenticated
  using (public.can_view_check_ins(athlete_id));

-- An approved athlete saves today's check-in. Saving again the same day
-- replaces it. p_day is the athlete's local date, which can be a day either
-- side of the server's.
create or replace function public.save_check_in(
  p_day date,
  p_sleep int,
  p_soreness int,
  p_stress int,
  p_mood int,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_approved() or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'athlete'
  ) then
    raise exception 'Only athletes can check in.';
  end if;
  if p_day is null or p_day not between current_date - 1 and current_date + 1 then
    raise exception 'You can only check in for today.';
  end if;

  insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note)
  values (auth.uid(), p_day, p_sleep, p_soreness, p_stress, p_mood, nullif(trim(p_note), ''))
  on conflict (athlete_id, day) do update
    set sleep = excluded.sleep,
        soreness = excluded.soreness,
        stress = excluded.stress,
        mood = excluded.mood,
        note = excluded.note
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.save_check_in(date, int, int, int, int, text) from public, anon;
grant execute on function public.save_check_in(date, int, int, int, int, text) to authenticated;

-- The squads and teams the member coaches, with how many athletes have
-- checked in on p_day and how many of those flagged a low score. Teams are
-- named from a squad, so their athletes are also counted in the squad.
create or replace function public.check_in_summary(p_day date)
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  athlete_count int,
  checked_in_count int,
  flagged_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    t.kind::text,
    count(a.profile_id)::int,
    count(c.id)::int,
    count(c.id) filter (
      where least(c.sleep, c.soreness, c.stress, c.mood) <= 2
    )::int
  from public.team_members coach
  join public.teams t on t.id = coach.team_id and not t.archived
  left join public.team_members a on a.team_id = t.id and a.team_role = 'athlete'
    and exists (select 1 from public.profiles p where p.id = a.profile_id and p.status = 'approved')
  left join public.check_ins c on c.athlete_id = a.profile_id and c.day = p_day
  where public.is_approved()
    and coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
  group by t.id, t.name, t.kind, t.sort_order
  order by t.kind, t.sort_order, t.name;
$$;

revoke execute on function public.check_in_summary(date) from public, anon;
grant execute on function public.check_in_summary(date) to authenticated;

-- Every athlete in a squad or team with their check-in for p_day (null scores
-- when they haven't checked in). For the group's coaches and admins.
create or replace function public.check_in_board(p_team_id uuid, p_day date)
returns table (
  athlete_id uuid,
  full_name text,
  sleep smallint,
  soreness smallint,
  stress smallint,
  mood smallint,
  note text,
  checked_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, coalesce(nullif(p.full_name, ''), p.email),
    c.sleep, c.soreness, c.stress, c.mood, c.note, c.updated_at
  from public.team_members a
  join public.profiles p on p.id = a.profile_id and p.status = 'approved'
  left join public.check_ins c on c.athlete_id = p.id and c.day = p_day
  where a.team_id = p_team_id
    and a.team_role = 'athlete'
    and public.is_approved()
    and (
      public.is_admin()
      or exists (
        select 1 from public.team_members coach
        where coach.team_id = p_team_id
          and coach.profile_id = auth.uid()
          and coach.team_role = 'coach'
      )
    )
  order by p.full_name;
$$;

revoke execute on function public.check_in_board(uuid, date) from public, anon;
grant execute on function public.check_in_board(uuid, date) to authenticated;
