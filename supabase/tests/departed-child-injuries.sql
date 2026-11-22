-- Tests for 20261106000100_departed_child_injuries.sql. Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
--
-- A child's injury records are kept after their account is deleted. The
-- under-18 rules still apply to them: committee members who aren't screened
-- and admins whose check has lapsed can't read them, their updates or their
-- documents. A departed adult's records stay as before.
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
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- What the signed-in member reads of an athlete's records under row level
-- security, as the app does.
create or replace function pg_temp.injuries_of(n text) returns bigint language plpgsql as
$$ declare v bigint; begin set local role authenticated;
   select count(*) into v from public.injuries where athlete_id = ('00000000-0000-0000-0000-0000000000' || n)::uuid;
   reset role; return v; end $$;
create or replace function pg_temp.updates_of(n text) returns bigint language plpgsql as
$$ declare v bigint; begin set local role authenticated;
   select count(*) into v from public.injury_updates u join public.injuries i on i.id = u.injury_id
   where i.athlete_id = ('00000000-0000-0000-0000-0000000000' || n)::uuid;
   reset role; return v; end $$;
create or replace function pg_temp.objects(p text) returns bigint language plpgsql as
$$ declare v bigint; begin set local role authenticated;
   select count(*) into v from storage.objects where bucket_id = 'injury-documents' and name = p;
   reset role; return v; end $$;
grant select, insert, delete on storage.objects to authenticated;

-- Committee checks are required from 31 days ago, so Blair Admin (02, no
-- card) is past the grace period and stops seeing under 18s' injuries (C8).
-- Indy Treasurer (23) is committee, exempt with a reason, so not screened
-- (C6). Jordan Junior (31, 14) has health consent from Logan Parent, so
-- screening is the only rule in the way. Jordan's ankle injury gets a physio
-- update and a document.
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;
update public.safeguarding_settings set committee_checks_from = public.club_today() - 31 where id;
insert into public.child_consents (athlete_id, kind, given_by, given_by_name, policy_version)
values ('00000000-0000-0000-0000-000000000031', 'health', '00000000-0000-0000-0000-000000000041', 'Logan Parent', 'test');
insert into public.injury_updates (injury_id, author_id, author_name, kind, notes, restrictions)
select id, '00000000-0000-0000-0000-000000000014', 'Finley Physio', 'physio_update', 'Sample note', 'No jumping'
from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031' and body_area = 'Ankle';
create temp table doc as
select '00000000-0000-0000-0000-000000000031/' || id || '/scan.pdf' as path
from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031' and body_area = 'Ankle';
grant select on doc to authenticated;
insert into storage.objects (bucket_id, name, metadata)
select 'injury-documents', path, '{"mimetype":"application/pdf"}' from doc;
-- Kai Senior (32, 25) has an injury too.
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
values ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000032', 'Knee', 'Jarred knee', public.club_today() - 1, 'Kai Senior');

-- 1. While the child is a member.
select pg_temp.as_member('23');
select pg_temp.ok('unscreened committee member is not cleared', public.is_cleared(auth.uid()), false);
select pg_temp.ok('unscreened committee member reads none of the child''s injuries', pg_temp.injuries_of('31') = 0, true);
select pg_temp.ok('unscreened committee member reads the adult''s injury', pg_temp.injuries_of('32') = 1, true);
select pg_temp.as_member('02');
select pg_temp.ok('admin past the grace period reads none of the child''s injuries', pg_temp.injuries_of('31') = 0, true);
select pg_temp.as_member('01');
select pg_temp.ok('screened admin reads the child''s injury', pg_temp.injuries_of('31') >= 1, true);

-- 2. The child deletes their own account; the adult's account is deleted by
-- an admin.
select pg_temp.as_member('31');
select pg_temp.works('child deletes their account', 'select public.delete_my_account()');
select pg_temp.as_member('01');
select pg_temp.works('admin deletes the adult''s account', $s$ select public.admin_delete_member('00000000-0000-0000-0000-000000000032') $s$);
select pg_temp.ok('child''s profile is gone', exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000031'), false);
select pg_temp.ok('child''s injury is kept', exists (select 1 from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031' and athlete_left_at is not null), true);
select pg_temp.ok('child''s date of birth is kept with the injury',
  (select bool_and(athlete_date_of_birth is not null) from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('departed child still counts as under 18', public.athlete_is_minor('00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('departed adult still counts as an adult', public.athlete_is_minor('00000000-0000-0000-0000-000000000032'), false);

-- 3. After the child has gone: the same people are still refused.
select pg_temp.as_member('23');
select pg_temp.ok('unscreened committee member still reads none of the child''s injuries', pg_temp.injuries_of('31') = 0, true);
select pg_temp.ok('unscreened committee member reads none of the child''s updates', pg_temp.updates_of('31') = 0, true);
select pg_temp.ok('the child''s injury is not in their injury list',
  exists (select 1 from public.visible_injuries(true) where athlete_id = '00000000-0000-0000-0000-000000000031'), false);
select pg_temp.fails('unscreened committee member cannot open the child''s document', format('select public.open_injury_document(%L)', (select path from doc)));
select pg_temp.ok('unscreened committee member cannot read the document file', pg_temp.objects((select path from doc)) = 0, true);
select pg_temp.ok('unscreened committee member still reads the departed adult''s injury', pg_temp.injuries_of('32') = 1, true);
select pg_temp.as_member('02');
select pg_temp.ok('admin past the grace period still reads none of the child''s injuries', pg_temp.injuries_of('31') = 0, true);
select pg_temp.ok('admin past the grace period reads none of the child''s updates', pg_temp.updates_of('31') = 0, true);
select pg_temp.as_member('22');
select pg_temp.ok('member without the committee role reads none of them', pg_temp.injuries_of('31') = 0, true);
select pg_temp.as_member('11');
select pg_temp.ok('coach reads none of them once the child has gone', pg_temp.injuries_of('31') = 0, true);
select pg_temp.as_member('01');
select pg_temp.ok('screened admin still reads the child''s injury', pg_temp.injuries_of('31') >= 1, true);
select pg_temp.ok('screened admin still reads the child''s update', pg_temp.updates_of('31') = 1, true);
select pg_temp.works('screened admin can open the child''s document', format('select public.open_injury_document(%L)', (select path from doc)));

-- 4. Ages kept with the record follow the calendar, and records kept before
-- this change (no age) count as under 18.
update public.injuries set athlete_date_of_birth = public.club_today() - interval '19 years'
where athlete_id = '00000000-0000-0000-0000-000000000031';
select pg_temp.ok('a departed child who has since turned 18 counts as an adult', public.athlete_is_minor('00000000-0000-0000-0000-000000000031'), false);
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name, athlete_left_at)
values ('00000000-0000-0000-0000-0000000000d1', null, 'Wrist', 'Kept from before', public.club_today() - 400, 'Left Earlier', now() - interval '1 year');
select pg_temp.ok('a record kept with no age counts as under 18', public.athlete_is_minor('00000000-0000-0000-0000-0000000000d1'), true);
select pg_temp.ok('an id with no profile and no record counts as under 18', public.athlete_is_minor('00000000-0000-0000-0000-0000000000d2'), true);
select pg_temp.ok('a current member''s age still comes from their profile', public.athlete_is_minor('00000000-0000-0000-0000-000000000011'), false);

-- 5. The function stays closed to the app.
select pg_temp.ok('authenticated cannot call athlete_is_minor', has_function_privilege('authenticated', 'public.athlete_is_minor(uuid)', 'execute'), false);
select pg_temp.ok('authenticated cannot call the keep trigger', has_function_privilege('authenticated', 'public.keep_injuries_of_leaving_athlete()', 'execute'), false);
