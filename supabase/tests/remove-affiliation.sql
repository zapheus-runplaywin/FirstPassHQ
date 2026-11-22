-- Tests for 20261107140000_remove_affiliation.sql: Affiliation records are
-- gone (Matt, 7 November 2026: clubs only). Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.fails_as(n text, label text, statement text) returns text language plpgsql as
$$ begin perform pg_temp.as_member(n); return pg_temp.fails(n || ': ' || label, statement); end $$;

-- The four tables are gone.
select pg_temp.ok(t || ' is gone', to_regclass('public.' || t) is null, true)
from unnest(array['affiliation_settings', 'affiliation_officers', 'playhq_registrations', 'affiliation_returns']) t
order by t;

-- No function for affiliation, associations or PlayHQ registration ticks is left.
select pg_temp.ok('no affiliation, association or PlayHQ registration function is left',
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname ilike '%affiliation%' or p.proname ilike '%association%' or p.proname ilike '%playhq_registration%')
  ), false);

-- No table or column anywhere in public still holds a member type or tier.
select pg_temp.ok('no member_type or tier column is left',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name in ('member_type', 'tier')
  ), false);

-- Nobody can call the old functions, whatever their role: admin, committee,
-- coach, lapsed coach, manager, physio, statistician, athletes, guardians.
create temp table members(n text);
insert into members values ('01'), ('02'), ('11'), ('12'), ('13'), ('14'), ('21'), ('23'), ('31'), ('32'), ('41'), ('42');
grant select on members to authenticated;
set role authenticated;
select pg_temp.fails_as(n, 'admin_affiliation is gone', 'select * from public.admin_affiliation()')
from members order by n;
select pg_temp.fails_as(n, 'admin_playhq_registrations is gone', 'select * from public.admin_playhq_registrations(2026)')
from members order by n;
select pg_temp.fails_as(n, 'admin_log_affiliation_return is gone', 'select public.admin_log_affiliation_return(2026)')
from members order by n;
reset role;

-- The code of conduct still finds the club's current season, with the same
-- rule as before: the newest season that isn't archived, then the newest
-- season, then this year.
select pg_temp.ok('conduct season is the newest season that isn''t archived',
  public.conduct_season() = coalesce(
    (select max(season) from public.teams where not archived),
    (select max(season) from public.teams),
    extract(year from public.club_today())::int), true);

create temp table saved_teams as select id, archived from public.teams;
update public.teams set archived = true where id in (select id from saved_teams);
select pg_temp.ok('with every team archived, conduct season is the newest season',
  public.conduct_season() = (select max(season) from public.teams), true);
update public.teams t set archived = s.archived from saved_teams s where s.id = t.id;

select pg_temp.ok('signed-in members can still call conduct_season',
  has_function_privilege('authenticated', 'public.conduct_season()', 'execute'), true);
select pg_temp.ok('anon still cannot call conduct_season',
  has_function_privilege('anon', 'public.conduct_season()', 'execute'), false);
