-- Tests for 20261021000000_explicit_table_grants.sql. The local stubs grant
-- nothing on public, like a Supabase project since it stopped granting new
-- tables automatically (30 October 2026), so every privilege here comes from
-- the migrations. Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.none(label text, q text) returns text language plpgsql as
$$ declare found text; begin
     execute 'select string_agg(x, '', '' order by x) from (' || q || ') t(x)' into found;
     return case when found is null then 'PASS ' || label else 'FAIL ' || label || ': ' || found end;
   end $$;
create or replace function pg_temp.privs(r text, t text) returns text language sql as
$$ select coalesce(string_agg(p, ',' order by array_position(array['select','insert','update','delete'], p)), '')
   from unnest(array['select','insert','update','delete']) p
   where has_table_privilege(r, ('public.' || t)::regclass, p) $$;
create temp view public_tables as
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm');

-- Tables the app reaches only through functions: earlier migrations revoked
-- them from the app's roles on purpose, so they must stay ungranted.
create temp table through_functions(name text);
insert into through_functions values
  ('absence_reviews'), ('attendance_absences'), ('child_activity_seen'), ('conduct_acceptances'),
  ('former_partner_roles'), ('game_pair_attempts'), ('group_membership_changes'),
  ('push_settings'), ('push_todo_log'),
  ('join_password_attempts'), ('record_access_log'), ('season_kpi_measures'),
  ('season_kpi_review_notes'), ('season_kpi_review_points'), ('season_kpi_reviews'), ('season_kpis'),
  ('session_plan_notices'), ('session_plan_views'), ('survey_answers'), ('survey_questions'),
  ('survey_recipients'), ('survey_responses'), ('surveys');

-- Every other table is granted to signed-in members. A new table whose
-- migration forgot its grant shows up here.
select pg_temp.none('every other table is granted to signed-in members',
  $$select relname from public_tables
    where relname not in (select name from through_functions)
      and not has_table_privilege('authenticated', oid, 'select')$$);
select pg_temp.none('tables reached through functions stay closed to signed-in members',
  $$select relname from public_tables
    where relname in (select name from through_functions)
      and has_table_privilege('authenticated', oid, 'select,insert,update,delete')$$);
select pg_temp.none('the list of tables reached through functions names real tables',
  $$select name from through_functions where name not in (select relname from public_tables)$$);
select pg_temp.none('every table has row level security on',
  $$select t.relname from public_tables t join pg_class c on c.oid = t.oid
    where c.relkind = 'r' and not c.relrowsecurity$$);

-- Signed-out visitors get no table.
select pg_temp.none('signed-out visitors get no table',
  $$select relname from public_tables
    where has_table_privilege('anon', oid, 'select,insert,update,delete,truncate,references,trigger')$$);

-- Signed-in members never get truncate (it skips row level security),
-- references or trigger.
select pg_temp.none('signed-in members can''t truncate, reference or add triggers',
  $$select relname from public_tables
    where has_table_privilege('authenticated', oid, 'truncate,references,trigger')$$);

-- The edge functions' service role reaches every table.
select pg_temp.none('the service role reaches every table',
  $$select relname from public_tables
    where not has_table_privilege('service_role', oid, 'select,insert,update,delete')$$);

-- Tables with narrower grants keep exactly what they have on live.
select pg_temp.ok('profiles: select, insert, delete (names change through functions)',
  pg_temp.privs('authenticated', 'profiles') = 'select,insert,delete', true);
select pg_temp.ok('games are read-only to members',
  pg_temp.privs('authenticated', 'games') = 'select', true);
select pg_temp.ok('game events are read-only to members',
  pg_temp.privs('authenticated', 'game_events') = 'select', true);
select pg_temp.ok('session plans are read-only to members',
  pg_temp.privs('authenticated', 'session_plans') = 'select', true);
select pg_temp.ok('session plan files are read-only to members',
  pg_temp.privs('authenticated', 'session_plan_files') = 'select', true);
select pg_temp.ok('absence reasons can''t be deleted by members',
  pg_temp.privs('authenticated', 'absence_categories') = 'select,insert,update', true);
select pg_temp.ok('injuries: full access, row level security decides rows',
  pg_temp.privs('authenticated', 'injuries') = 'select,insert,update,delete', true);

-- Signed in as a member, a table read works through the grant and row level
-- security still filters: an athlete sees their own injury, not Jordan's.
insert into public.injuries (athlete_id, body_area, description, injured_on) values
  ('00000000-0000-0000-0000-000000000031', 'Ankle', 'Rolled ankle', current_date - 3),
  ('00000000-0000-0000-0000-000000000032', 'Knee', 'Sore knee', current_date - 3);
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000032', false);
end $$;
set role authenticated;
select pg_temp.ok('a signed-in athlete reads their own injury',
  (select count(*) = 1 from public.injuries where athlete_id = auth.uid()), true);
select pg_temp.ok('row level security still hides another athlete''s injury',
  not exists (select 1 from public.injuries where athlete_id <> auth.uid()), true);
select pg_temp.ok('a signed-in member can''t empty a table',
  has_table_privilege('public.injuries', 'truncate'), false);
reset role;
