-- The nightly removal says when it last ran (customer review C16, Matt, 23
-- October 2026: "Record runs, warn admins").
--
-- The purge-expired-injuries function runs from a GitHub schedule, which
-- GitHub pauses in a repository with no activity for 60 days, and nothing
-- recorded whether it ran. Now:
--
-- * Each run writes a row to purge_runs: when, whether it finished, the step
--   it stopped at if it didn't, and what it removed. Only the function (the
--   service role) writes them; the app can't read the table.
-- * removal_run_status() tells admins when it last ran, when it last finished,
--   the step the latest run stopped at, and whether it's overdue: "Remove old
--   records" is on and it hasn't finished for 2 days (counted from when the
--   keep periods were last saved if it has never finished). Keeping records
--   shows it, and admins get a to-do while it's overdue.
--
-- Additive: one new table reached only through functions, and two new
-- functions. No existing rows change.

begin;

create table if not exists public.purge_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  -- Such as "removing documents", when the run stopped there.
  failed_step text,
  -- What the run removed, for FirstPass to check; never shown in the app.
  counts jsonb
);

create index if not exists purge_runs_ran_at_idx on public.purge_runs (ran_at desc);

alter table public.purge_runs enable row level security;
revoke all on public.purge_runs from public, anon, authenticated;
grant all on public.purge_runs to service_role;

-- Called by the purge function at the end of each run.
create or replace function public.record_purge_run(p_ok boolean, p_failed_step text, p_counts jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.purge_runs (ok, failed_step, counts)
  values (p_ok, case when p_ok then null else left(p_failed_step, 200) end, p_counts);
$$;
revoke execute on function public.record_purge_run(boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_purge_run(boolean, text, jsonb) to service_role;

-- For admins: when the nightly removal last ran and whether it's overdue.
create or replace function public.removal_run_status()
returns table (
  last_run_at timestamptz,
  last_ok_at timestamptz,
  failed_step text,
  overdue boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select r.ran_at, r.ok, r.failed_step from public.purge_runs r order by r.ran_at desc, r.id desc limit 1
  ), last_ok as (
    select max(r.ran_at) as ran_at from public.purge_runs r where r.ok
  )
  select l.ran_at,
    o.ran_at,
    case when l.ok then null else l.failed_step end,
    coalesce(s.retention_enabled, false)
      and coalesce(o.ran_at, s.retention_updated_at, now()) < now() - interval '2 days'
  from (select 1) as one
  left join latest l on true
  cross join last_ok o
  left join public.club_settings s on true
  where public.is_admin();
$$;
revoke execute on function public.removal_run_status() from public, anon;
grant execute on function public.removal_run_status() to authenticated;

commit;
