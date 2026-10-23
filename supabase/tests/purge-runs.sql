-- Tests for 20261023180000_purge_runs.sql: the nightly removal records each
-- run, and admins see when it last ran and whether it's overdue (customer
-- review C16). Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
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
-- Whether the signed-in member gets a status row, as the app calls it.
create or replace function pg_temp.sees_status() returns boolean language sql as
$$ select exists (select 1 from public.removal_run_status()) $$;
create or replace function pg_temp.overdue() returns boolean language sql as
$$ select overdue from public.removal_run_status() $$;
create or replace function pg_temp.reads_table() returns boolean language plpgsql as
$$ declare v boolean;
   begin
     set local role authenticated;
     select exists (select 1 from public.purge_runs) into v;
     reset role;
     return v;
   exception when insufficient_privilege then
     reset role;
     return false;
   end $$;
create or replace function pg_temp.runs() returns bigint language sql as
$$ select count(*) from public.purge_runs $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;

-- Who can call what.
select pg_temp.ok('members cannot record a run', has_function_privilege('authenticated', 'public.record_purge_run(boolean, text, jsonb)', 'execute'), false);
select pg_temp.ok('anon cannot record a run', has_function_privilege('anon', 'public.record_purge_run(boolean, text, jsonb)', 'execute'), false);
select pg_temp.ok('the purge function (service role) records runs', has_function_privilege('service_role', 'public.record_purge_run(boolean, text, jsonb)', 'execute'), true);
select pg_temp.ok('anon cannot read the status', has_function_privilege('anon', 'public.removal_run_status()', 'execute'), false);
select pg_temp.ok('signed-in members can call the status', has_function_privilege('authenticated', 'public.removal_run_status()', 'execute'), true);
select pg_temp.ok('members cannot read the runs table', has_table_privilege('authenticated', 'public.purge_runs', 'select'), false);
select pg_temp.ok('members cannot write the runs table', has_table_privilege('authenticated', 'public.purge_runs', 'insert'), false);
select pg_temp.ok('anon cannot read the runs table', has_table_privilege('anon', 'public.purge_runs', 'select'), false);
select pg_temp.ok('service role can write the runs table', has_table_privilege('service_role', 'public.purge_runs', 'insert'), true);

-- Nothing run yet, removal off.
select pg_temp.as_member('01');
select pg_temp.ok('an admin sees the status before any run', pg_temp.sees_status(), true);
select pg_temp.ok('nothing has run yet', (select last_run_at is null and last_ok_at is null from public.removal_run_status()), true);
select pg_temp.ok('not overdue while Remove old records is off', pg_temp.overdue(), false);

-- Removal switched on today: not overdue until two days pass.
update public.club_settings set retention_enabled = true, retention_updated_at = now() where id;
select pg_temp.ok('switched on today, never run: not overdue yet', pg_temp.overdue(), false);
update public.club_settings set retention_updated_at = now() - interval '47 hours' where id;
select pg_temp.ok('switched on 47 hours ago, never run: not overdue yet', pg_temp.overdue(), false);
update public.club_settings set retention_updated_at = now() - interval '49 hours' where id;
select pg_temp.ok('switched on 49 hours ago, never run: overdue', pg_temp.overdue(), true);

-- Every kind of member other than an admin gets nothing back.
select pg_temp.as_member('02');
select pg_temp.ok('a second admin (no check) sees the status', pg_temp.sees_status(), true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('12');
select pg_temp.ok('a coach whose check lapsed gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('13');
select pg_temp.ok('a manager gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('14');
select pg_temp.ok('a physio gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('21');
select pg_temp.ok('a committee member gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('23');
select pg_temp.ok('an exempt committee member gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('31');
select pg_temp.ok('an athlete under 18 gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('32');
select pg_temp.ok('an adult athlete gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('41');
select pg_temp.ok('a guardian gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('42');
select pg_temp.ok('a coach who is also a guardian gets nothing', pg_temp.sees_status(), false);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('someone signed out gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('31');
select pg_temp.ok('an athlete cannot read the runs table directly', pg_temp.reads_table(), false);

-- A stood-down admin gets nothing.
update public.profiles set stood_down_at = now() where id = '00000000-0000-0000-0000-000000000002';
select pg_temp.as_member('02');
select pg_temp.ok('a stood-down admin gets nothing', pg_temp.sees_status(), false);
select pg_temp.as_member('01');

-- A run that finished.
select public.record_purge_run(true, 'ignored when it finished', '{"documents": 2, "injuries": 1}');
select pg_temp.ok('a finished run is recorded', pg_temp.runs() = 1, true);
select pg_temp.ok('a finished run keeps no failed step', (select failed_step is null and ok from public.purge_runs), true);
select pg_temp.ok('a finished run keeps what it removed', (select counts ->> 'documents' = '2' from public.purge_runs), true);
select pg_temp.ok('the status shows the run', (select last_run_at is not null and last_run_at = last_ok_at and failed_step is null from public.removal_run_status()), true);
select pg_temp.ok('a run today: not overdue', pg_temp.overdue(), false);
select pg_temp.ok('the status never shows what was removed', (select count(*) = 4 from information_schema.routines r
  join information_schema.parameters p on p.specific_name = r.specific_name
  where r.routine_schema = 'public' and r.routine_name = 'removal_run_status' and p.parameter_mode = 'OUT'), true);

-- The run is two days old.
update public.purge_runs set ran_at = now() - interval '47 hours';
select pg_temp.ok('last finished 47 hours ago: not overdue', pg_temp.overdue(), false);
update public.purge_runs set ran_at = now() - interval '49 hours';
select pg_temp.ok('last finished 49 hours ago: overdue', pg_temp.overdue(), true);
update public.club_settings set retention_enabled = false where id;
select pg_temp.ok('not overdue once Remove old records is off', pg_temp.overdue(), false);
update public.club_settings set retention_enabled = true where id;

-- A later run that stopped part way.
select public.record_purge_run(false, 'removing documents', null);
select pg_temp.ok('a failed run is recorded', pg_temp.runs() = 2, true);
select pg_temp.ok('the status shows the step it stopped at', (select failed_step = 'removing documents' from public.removal_run_status()), true);
select pg_temp.ok('the latest run is the failed one', (select last_run_at > last_ok_at from public.removal_run_status()), true);
select pg_temp.ok('a failed run does not count as finished: still overdue', pg_temp.overdue(), true);
select public.record_purge_run(false, repeat('x', 500), null);
select pg_temp.ok('a long step name is cut to 200 characters', (select max(length(failed_step)) = 200 from public.purge_runs), true);

-- Then a run that finished again.
select public.record_purge_run(true, null, '{}');
select pg_temp.ok('a finished run clears the failed step', (select failed_step is null from public.removal_run_status()), true);
select pg_temp.ok('a finished run clears overdue', pg_temp.overdue(), false);

-- Recording runs never changes other records.
select pg_temp.ok('runs are kept, not replaced', pg_temp.runs() = 4, true);
select pg_temp.fails('a member cannot record a run by calling it',
  $$set local role authenticated; select public.record_purge_run(true, null, null)$$);
reset role;
