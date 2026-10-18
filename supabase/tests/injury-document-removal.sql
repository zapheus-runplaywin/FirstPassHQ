-- Tests for 20261013160000_injury_document_removal.sql. Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
-- Uses the choices from 20261016030000_retention_choices.sql: 90 days, 1 year
-- (the default) or 3 years after clearance, and archiving a season no longer
-- removes its files sooner.
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

insert into public.club_settings (id) values (true) on conflict (id) do nothing;

-- An archived old season, set up long ago, and a current season set up 50
-- days ago (the seed's squad and team were set up just now).
insert into public.teams (name, kind, season, archived, created_at) values
  ('Old Squad', 'squad', 2020, true, now() - interval '400 days'),
  ('New Squad', 'squad', 2021, false, now() - interval '50 days');

-- Four injuries, each with documents:
--   long: cleared 100 days ago (past 90 days)
--   recent: cleared 3 days ago, in the current season
--   archived: cleared 60 days ago, in the archived season (kept: archiving
--     no longer removes files sooner)
--   open: still injured, reported 200 days ago
insert into public.injuries (id, athlete_id, body_area, description, injured_on, athlete_name, status, cleared_at) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000031', 'Knee', 'long', current_date - 120, 'Jordan Junior', 'cleared', now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-000000000031', 'Wrist', 'recent', current_date - 20, 'Jordan Junior', 'cleared', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000001a3', '00000000-0000-0000-0000-000000000032', 'Hip', 'archived', current_date - 30, 'Kai Senior', 'cleared', now() - interval '60 days'),
  ('00000000-0000-0000-0000-0000000001a4', '00000000-0000-0000-0000-000000000032', 'Back', 'open', current_date - 200, 'Kai Senior', 'injured', null);
create or replace function pg_temp.p(athlete text, injury text, f text) returns text language sql as
$$ select '00000000-0000-0000-0000-0000000000' || athlete || '/00000000-0000-0000-0000-0000000001' || injury || '/' || f $$;
insert into public.injury_updates (injury_id, author_name, kind, document_path, document_name) values
  ('00000000-0000-0000-0000-0000000001a1', 'Jordan Junior', 'clearance_requested', pg_temp.p('31', 'a1', 'letter.pdf'), 'letter.pdf'),
  ('00000000-0000-0000-0000-0000000001a1', 'Logan Parent', 'physio_update', pg_temp.p('31', 'a1', 'report.pdf'), 'report.pdf'),
  ('00000000-0000-0000-0000-0000000001a1', 'Casey Coach', 'cleared', null, null),
  ('00000000-0000-0000-0000-0000000001a2', 'Jordan Junior', 'clearance_requested', pg_temp.p('31', 'a2', 'letter.pdf'), 'letter.pdf'),
  ('00000000-0000-0000-0000-0000000001a3', 'Kai Senior', 'clearance_requested', pg_temp.p('32', 'a3', 'letter.pdf'), 'letter.pdf'),
  ('00000000-0000-0000-0000-0000000001a4', 'Kai Senior', 'physio_update', pg_temp.p('32', 'a4', 'letter.pdf'), 'letter.pdf');
insert into storage.objects (bucket_id, name)
select 'injury-documents', document_path from public.injury_updates where document_path is not null;

create temp table before as select
  (select count(*) from public.injuries) as injuries,
  (select count(*) from public.injury_updates) as updates;

-- Who can call what.
select pg_temp.ok('members cannot list cleared files', has_function_privilege('authenticated', 'public.cleared_injury_documents()', 'execute'), false);
select pg_temp.ok('anon cannot list cleared files', has_function_privilege('anon', 'public.cleared_injury_documents()', 'execute'), false);
select pg_temp.ok('members cannot mark files removed', has_function_privilege('authenticated', 'public.mark_removed_injury_documents()', 'execute'), false);
select pg_temp.ok('service role lists cleared files', has_function_privilege('service_role', 'public.cleared_injury_documents()', 'execute'), true);
select pg_temp.ok('service role marks files removed', has_function_privilege('service_role', 'public.mark_removed_injury_documents()', 'execute'), true);
select pg_temp.ok('members cannot call the expiry check', has_function_privilege('authenticated', 'public.injury_documents_expired(public.injuries)', 'execute'), false);

-- Off by default: nothing listed or marked.
select pg_temp.ok('nothing listed while removal is off', (select count(*) = 0 from public.cleared_injury_documents()), true);
select pg_temp.ok('nothing marked while removal is off', (select public.mark_removed_injury_documents() = 0), true);

-- Admins only, with the allowed choices.
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot change the period', $$select public.admin_set_injury_documents_keep_days(30)$$);
select pg_temp.ok('coach cannot read the period', (select public.injury_documents_keep_days() is null), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin reads the default of 1 year', (select public.injury_documents_keep_days() = 365), true);
select pg_temp.fails('admin cannot choose 7 days', $$select public.admin_set_injury_documents_keep_days(7)$$);
select pg_temp.fails('admin cannot choose 60 days', $$select public.admin_set_injury_documents_keep_days(60)$$);
select pg_temp.fails('admin cannot choose nothing', $$select public.admin_set_injury_documents_keep_days(null)$$);
select pg_temp.works('admin saves 3 years', $$select public.admin_set_injury_documents_keep_days(1095)$$);
select pg_temp.ok('saved with who changed it', (select retention_injury_documents_days = 1095 and retention_updated_by_name is not null from public.club_settings), true);
select pg_temp.works('admin saves 90 days', $$select public.admin_set_injury_documents_keep_days(90)$$);
select pg_temp.ok('admin reads 90 days', (select public.injury_documents_keep_days() = 90), true);
select pg_temp.works('admin switches removal on', $$select public.admin_set_record_retention(true, 12, 12, 36, 12, 12, 84)$$);
select set_config('request.jwt.claim.sub', '', false);

-- On: past 90 days go; recent, archived-season and open stay.
create temp table listed as select f as name from public.cleared_injury_documents() as f;
select pg_temp.ok('lists the files of an injury cleared over 90 days ago', (select count(*) = 2 from listed where name like '%0001a1/%'), true);
select pg_temp.ok('keeps the file of an injury cleared 60 days ago in an archived season', (select count(*) = 0 from listed where name like '%0001a3/%'), true);
select pg_temp.ok('keeps the file of a recent clearance', (select count(*) = 0 from listed where name like '%0001a2/%'), true);
select pg_temp.ok('keeps the files of an injury not yet cleared', (select count(*) = 0 from listed where name like '%0001a4/%'), true);

-- A document is only marked once its file is gone from storage.
delete from storage.objects where bucket_id = 'injury-documents' and name = pg_temp.p('31', 'a1', 'letter.pdf');
select pg_temp.ok('marks only the document whose file is gone', (select public.mark_removed_injury_documents() = 1), true);
select pg_temp.ok('the other stays unmarked until its file goes', (select document_removed_at is null from public.injury_updates where document_path = pg_temp.p('31', 'a1', 'report.pdf')), true);
delete from storage.objects o using listed l where o.bucket_id = 'injury-documents' and o.name = l.name;
select pg_temp.ok('marks the rest once their files are gone', (select public.mark_removed_injury_documents() = 1), true);
select pg_temp.ok('a second run marks nothing', (select public.mark_removed_injury_documents() = 0), true);
select pg_temp.ok('marked documents keep their name and path', (select bool_and(document_name is not null and document_path is not null and document_removed_at is not null) from public.injury_updates where injury_id = '00000000-0000-0000-0000-0000000001a1' and kind <> 'cleared'), true);
select pg_temp.ok('recent, archived-season and open documents are not marked', (select bool_and(document_removed_at is null) from public.injury_updates where injury_id in ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000001a3', '00000000-0000-0000-0000-0000000001a4')), true);
select pg_temp.ok('recent, archived-season and open files are still in storage', (select count(*) = 3 from storage.objects where bucket_id = 'injury-documents'), true);
select pg_temp.ok('no injuries or history removed', (select injuries = (select count(*) from public.injuries) and updates = (select count(*) from public.injury_updates) from before), true);

-- The recent clearance is listed once 90 days pass, and a longer period
-- keeps it.
update public.injuries set cleared_at = now() - interval '89 days' where id = '00000000-0000-0000-0000-0000000001a2';
select pg_temp.ok('kept at 89 days', (select count(*) = 0 from public.cleared_injury_documents()), true);
update public.injuries set cleared_at = now() - interval '100 days' where id = '00000000-0000-0000-0000-0000000001a2';
select pg_temp.ok('listed at 100 days', (select array_agg(f) = array[pg_temp.p('31', 'a2', 'letter.pdf')] from public.cleared_injury_documents() as f), true);
select pg_temp.as_member('01');
select pg_temp.works('admin saves 1 year', $$select public.admin_set_injury_documents_keep_days(365)$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('kept under 1 year', (select count(*) = 0 from public.cleared_injury_documents()), true);

-- Switching removal off stops it again.
update public.club_settings set retention_enabled = false where id;
select pg_temp.ok('nothing listed once switched off', (select count(*) = 0 from public.cleared_injury_documents()), true);
