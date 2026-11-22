-- Tests for 20261013090000_record_access_log.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- A verified guardian consents, so coaches and physios see the child's records.
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
  perform public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true);
end $$;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.n(p_subject text) returns bigint language sql as
$$ select count(*) from public.record_access_log where subject_id = ('00000000-0000-0000-0000-0000000000' || p_subject)::uuid $$;

create temp table t as select
  (select id from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031') as injury;
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
values ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000032', 'Knee', 'Jarred knee', public.club_today() - 1, 'Kai Senior');

-- Nothing can be read or written directly.
select pg_temp.ok('authenticated cannot select the log', has_table_privilege('authenticated', 'public.record_access_log', 'select'), false);
select pg_temp.ok('authenticated cannot insert into the log', has_table_privilege('authenticated', 'public.record_access_log', 'insert'), false);
select pg_temp.ok('authenticated cannot call write_record_access', has_function_privilege('authenticated', 'public.write_record_access(uuid, text, uuid, boolean)', 'execute'), false);
select pg_temp.ok('anon cannot log a view', has_function_privilege('anon', 'public.log_record_view(uuid, text, uuid)', 'execute'), false);
select pg_temp.ok('anon cannot read history', has_function_privilege('anon', 'public.record_access_history(uuid, integer)', 'execute'), false);

-- The coach opens the child's injury, check-ins and goals.
select pg_temp.as_member('11');
select pg_temp.works('coach logs the injury', format('select public.log_record_view(%L, %L, %L)', '00000000-0000-0000-0000-000000000031', 'injury', (select injury from t)));
select pg_temp.ok('one row for the injury', pg_temp.n('31') = 1, true);
select pg_temp.works('coach opens it again', format('select public.log_record_view(%L, %L, %L)', '00000000-0000-0000-0000-000000000031', 'injury', (select injury from t)));
select pg_temp.ok('repeat open within 30 minutes counts once', pg_temp.n('31') = 1, true);
select pg_temp.works('coach logs check-ins', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'check_ins')$$);
select pg_temp.works('coach logs goals', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'goals')$$);
select pg_temp.ok('three rows after check-ins and goals', pg_temp.n('31') = 3, true);
select pg_temp.ok('viewer name and role recorded', (select viewer_name = 'Casey Coach' and viewer_role = 'Coach' from public.record_access_log where kind = 'check_ins'), true);
select pg_temp.works('an old open no longer counts as a repeat', $$update public.record_access_log set created_at = now() - interval '31 minutes' where kind = 'check_ins'$$);
select pg_temp.works('coach logs check-ins again', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'check_ins')$$);
select pg_temp.ok('opened again after 30 minutes is a new row', pg_temp.n('31') = 4, true);
select pg_temp.works('coach cannot log another child''s injury id against this child', format('select public.log_record_view(%L, %L, %L)', '00000000-0000-0000-0000-000000000031', 'injury', (select id from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000032')));
select pg_temp.ok('mismatched injury is ignored', pg_temp.n('31') = 4, true);
select pg_temp.works('coach member_record view is ignored', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'member_record')$$);
select pg_temp.ok('coach member_record not logged', pg_temp.n('31') = 4, true);
select pg_temp.fails('unknown kind refused', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'diary')$$);

-- Adults aren't logged.
select pg_temp.works('coach opens an adult athlete''s check-ins', $$select public.log_record_view('00000000-0000-0000-0000-000000000032', 'check_ins')$$);
select pg_temp.ok('adult not logged', pg_temp.n('32') = 0, true);

-- The child and their guardians aren't logged.
select pg_temp.as_member('31');
select pg_temp.works('child opens own check-ins', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'check_ins')$$);
select pg_temp.as_member('41');
select pg_temp.works('guardian opens child''s goals', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'goals')$$);
select pg_temp.as_member('42');
select pg_temp.works('coach who is the child''s guardian opens injury', format('select public.log_record_view(%L, %L, %L)', '00000000-0000-0000-0000-000000000031', 'injury', (select injury from t)));
select pg_temp.ok('child and guardians not logged', pg_temp.n('31') = 4, true);

-- Someone without access logs nothing.
select pg_temp.as_member('13');
select pg_temp.works('manager opens injury', format('select public.log_record_view(%L, %L, %L)', '00000000-0000-0000-0000-000000000031', 'injury', (select injury from t)));
select pg_temp.as_member('32');
select pg_temp.works('another athlete opens check-ins', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'check_ins')$$);
select pg_temp.ok('no access, no row', pg_temp.n('31') = 4, true);

-- Physio and admin.
select pg_temp.as_member('14');
select pg_temp.works('physio opens injury', format('select public.log_record_view(%L, %L, %L)', '00000000-0000-0000-0000-000000000031', 'injury', (select injury from t)));
select pg_temp.ok('physio role recorded', (select viewer_role = 'Physio' from public.record_access_log where viewer_id = '00000000-0000-0000-0000-000000000014'), true);
select pg_temp.as_member('01');
select pg_temp.works('admin opens member record', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'member_record')$$);
select pg_temp.ok('admin role recorded', (select viewer_role = 'Admin' from public.record_access_log where kind = 'member_record'), true);
select pg_temp.ok('six rows', pg_temp.n('31') = 6, true);

-- Injury documents: every open and share goes in the child's log.
select pg_temp.as_member('11');
insert into public.injury_document_events (injury_id, document_path, viewer_id, viewer_name, viewer_role, kind)
select injury, 'x/letter.pdf', '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Coach', 'viewed' from t;
insert into public.injury_document_events (injury_id, document_path, viewer_id, viewer_name, viewer_role, kind)
select injury, 'x/letter.pdf', '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Coach', 'viewed' from t;
select pg_temp.ok('each document open logged', (select count(*) = 2 from public.record_access_log where kind = 'injury_document'), true);
select pg_temp.as_member('22');
insert into public.injury_document_events (injury_id, document_path, viewer_id, viewer_name, viewer_role, kind)
select injury, 'x/letter.pdf', '00000000-0000-0000-0000-000000000022', 'Harper Committee', 'Committee', 'shared' from t;
select pg_temp.ok('document share logged', (select count(*) = 1 from public.record_access_log where kind = 'injury_document_shared' and viewer_role = 'Committee'), true);
select pg_temp.as_member('41');
insert into public.injury_document_events (injury_id, document_path, viewer_id, viewer_name, viewer_role, kind)
select injury, 'x/letter.pdf', '00000000-0000-0000-0000-000000000041', 'Logan Parent', 'Parent or guardian', 'viewed' from t;
select pg_temp.ok('guardian''s document open not logged', pg_temp.n('31') = 9, true);

-- Who reads the log.
select pg_temp.as_member('41');
select pg_temp.ok('verified guardian sees the log', (select count(*) = 9 from public.record_access_history('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.ok('newest first', (select kind = 'injury_document_shared' from public.record_access_history('00000000-0000-0000-0000-000000000031') limit 1), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin sees the log', (select count(*) = 9 from public.record_access_history('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach does not see the log', (select count(*) = 0 from public.record_access_history('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('31');
select pg_temp.ok('child does not see the log', (select count(*) = 0 from public.record_access_history('00000000-0000-0000-0000-000000000031')), true);
update public.profiles set verified_at = null where id = '00000000-0000-0000-0000-000000000041';
select pg_temp.as_member('41');
select pg_temp.ok('unverified guardian does not see the log', (select count(*) = 0 from public.record_access_history('00000000-0000-0000-0000-000000000031')), true);
update public.profiles set verified_at = now() where id = '00000000-0000-0000-0000-000000000041';

-- Safeguarding contact.
select pg_temp.as_member('22');
select pg_temp.ok('committee member who is not a contact does not see the log', (select count(*) = 0 from public.record_access_history('00000000-0000-0000-0000-000000000031')), true);

-- Summary for the under 18s report.
select pg_temp.as_member('01');
select pg_temp.ok('summary counts views and viewers', (select views = 9 and viewers = 4 from public.admin_record_access_summary() where subject_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.as_member('11');
select pg_temp.ok('summary empty for non-admins', (select count(*) = 0 from public.admin_record_access_summary()), true);

-- A former viewer stays in the log after their account goes.
select pg_temp.works('viewer''s profile removed', $$update public.record_access_log set viewer_id = null where viewer_id = '00000000-0000-0000-0000-000000000014'$$);
select pg_temp.as_member('01');
select pg_temp.ok('row kept with name', (select count(*) = 1 from public.record_access_history('00000000-0000-0000-0000-000000000031') where viewer_name = 'Finley Physio'), true);

-- At 18 the guardian's view ends.
update public.profiles set date_of_birth = public.club_today() - interval '18 years' where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('41');
select pg_temp.ok('guardian loses the log at 18', (select count(*) = 0 from public.record_access_history('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('11');
select pg_temp.works('coach opens check-ins after 18', $$select public.log_record_view('00000000-0000-0000-0000-000000000031', 'goals', '00000000-0000-0000-0000-000000000099')$$);
select pg_temp.ok('no longer logged after 18', pg_temp.n('31') = 9, true);
