-- Tests for 20261016030000_retention_choices.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
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

-- Who can call what.
select pg_temp.ok('members can call save-all (admins only inside)', has_function_privilege('authenticated', 'public.admin_set_record_retention_all(boolean, integer, integer, integer, integer, integer, integer, integer, integer)', 'execute'), true);
select pg_temp.ok('anon cannot save', has_function_privilege('anon', 'public.admin_set_record_retention_all(boolean, integer, integer, integer, integer, integer, integer, integer, integer)', 'execute'), false);
select pg_temp.ok('anon cannot read child message period', has_function_privilege('anon', 'public.child_messages_keep_months()', 'execute'), false);
select pg_temp.ok('members cannot call message_involves_child', has_function_privilege('authenticated', 'public.message_involves_child(public.messages)', 'execute'), false);

-- A club that never saved its periods sees the new defaults; nothing is on.
select pg_temp.as_member('01');
select pg_temp.ok('unsaved club gets new defaults', (select not enabled and check_ins_months = 12 and goals_months = 12 and messages_months = 36 and attendance_months = 12 and certificates_months = 12 and access_log_months = 84 from public.record_retention()), true);
select pg_temp.ok('unsaved club: child messages 7 years', (select public.child_messages_keep_months() = 84), true);
select pg_temp.ok('unsaved club: injury documents 1 year', (select public.injury_documents_keep_days() = 365), true);
select pg_temp.ok('purge off while unsaved', (select public.purge_expired_records() = '{"enabled": false}'::jsonb), true);

-- Coaches can't save.
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot save', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 12, 12, 84, 365)$$);
select pg_temp.ok('coach cannot read child message period', (select public.child_messages_keep_months() is null), true);

-- A club that saved a period no longer offered keeps it, and can save it again.
select pg_temp.as_member('01');
select pg_temp.works('legacy 7-year attendance can be saved again', $$select public.admin_set_record_retention_all(false, 24, 24, 24, 84, 84, 84, 84, 90)$$);
select pg_temp.ok('saved values read back', (select attendance_months = 84 and messages_months = 24 from public.record_retention()) and public.injury_documents_keep_days() = 90, true);
select pg_temp.works('new defaults saved', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 12, 12, 84, 365)$$);
select pg_temp.fails('7-year attendance no longer allowed once changed', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 84, 12, 84, 365)$$);

-- The choices.
select pg_temp.works('check-ins 3 months', $$select public.admin_set_record_retention_all(false, 3, 12, 36, 84, 12, 12, 84, 365)$$);
select pg_temp.fails('check-ins 3 years refused', $$select public.admin_set_record_retention_all(false, 36, 12, 36, 84, 12, 12, 84, 365)$$);
select pg_temp.works('goals, attendance, certificates 5 years', $$select public.admin_set_record_retention_all(false, 12, 60, 36, 84, 60, 60, 84, 365)$$);
select pg_temp.fails('attendance 6 years refused', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 72, 12, 84, 365)$$);
select pg_temp.fails('messages 10 years refused', $$select public.admin_set_record_retention_all(false, 12, 12, 120, 180, 12, 12, 84, 365)$$);
select pg_temp.fails('child messages 2 years refused', $$select public.admin_set_record_retention_all(false, 12, 12, 12, 24, 12, 12, 84, 365)$$);
select pg_temp.works('child messages 15 years', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 180, 12, 12, 84, 365)$$);
select pg_temp.fails('record views 2 years refused', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 12, 12, 24, 365)$$);
select pg_temp.works('record views 15 years', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 12, 12, 180, 365)$$);
select pg_temp.fails('injury documents 30 days refused', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 12, 12, 84, 30)$$);
select pg_temp.works('injury documents 3 years', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 12, 12, 84, 1095)$$);
select pg_temp.fails('child messages shorter than other messages refused', $$select public.admin_set_record_retention_all(false, 12, 12, 84, 60, 12, 12, 84, 365)$$);
select pg_temp.works('both message periods raised together', $$select public.admin_set_record_retention_all(false, 12, 12, 84, 84, 12, 12, 84, 365)$$);
select pg_temp.works('both message periods lowered together', $$select public.admin_set_record_retention_all(false, 12, 12, 12, 36, 12, 12, 84, 365)$$);
select pg_temp.fails('old save rejects messages longer than child messages', $$select public.admin_set_record_retention(false, 12, 12, 60, 12, 12, 84)$$);
select pg_temp.fails('a failed save changes nothing', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 12, 12, 84, 30)$$);
select pg_temp.ok('still the last good save', (select retention_messages_months = 12 and retention_child_messages_months = 36 and retention_injury_documents_days = 365 from public.club_settings), true);

-- Messages: adult text goes after 3 years; text involving a child after 7.
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set date_of_birth = public.club_today() - interval '20 years', under_17 = false
where id = '00000000-0000-0000-0000-000000000032';
insert into public.messages (id, sender_id, sender_name, body, audience, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'Alex Admin', 'adult old', 'club', now() - interval '4 years'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', 'Alex Admin', 'to child 4y', 'club', now() - interval '4 years'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001', 'Alex Admin', 'to child 8y', 'club', now() - interval '8 years'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-000000000001', 'Alex Admin', 'to then-16 now adult', 'club', now() - interval '4 years'),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000031', 'Jordan Junior', 'from child', 'club', now() - interval '4 years'),
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-000000000001', 'Alex Admin', 'adult recent', 'club', now() - interval '1 year'),
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-000000000001', 'Alex Admin', 'to then-adult', 'club', now() - interval '1 year');
insert into public.message_recipients (message_id, profile_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000013'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000031'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000013'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000031'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-000000000032'),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000013'),
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-000000000013'),
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-000000000032');

select pg_temp.as_member('01');
select pg_temp.works('removal on with 3 and 7 years', $$select public.admin_set_record_retention_all(true, 12, 12, 36, 84, 12, 12, 84, 365)$$);
create temp table purge1 as select public.purge_expired_records() as r;
create temp table kept as select id, body_removed_at is null as kept from public.messages where id::text like '00000000-0000-0000-0000-0000000000c%';
select pg_temp.ok('adult message past 3 years removed', (select not kept from kept where id = '00000000-0000-0000-0000-0000000000c1'), true);
select pg_temp.ok('message to a child at 4 years kept', (select kept from kept where id = '00000000-0000-0000-0000-0000000000c2'), true);
select pg_temp.ok('message to a child past 7 years removed', (select not kept from kept where id = '00000000-0000-0000-0000-0000000000c3'), true);
select pg_temp.ok('message to someone under 18 then, adult now, kept', (select kept from kept where id = '00000000-0000-0000-0000-0000000000c4'), true);
select pg_temp.ok('message from a child kept', (select kept from kept where id = '00000000-0000-0000-0000-0000000000c5'), true);
select pg_temp.ok('recent messages kept', (select bool_and(kept) from kept where id in ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000c7')), true);
select pg_temp.ok('two message texts counted', (select r ->> 'messages' = '2' from purge1), true);
select pg_temp.ok('recipients and messages all still there', (select count(*) = 7 from public.messages where id::text like '00000000-0000-0000-0000-0000000000c%') and (select count(*) = 8 from public.message_recipients where message_id::text like '00000000-0000-0000-0000-0000000000c%'), true);

-- Injury documents: archiving the season no longer removes them sooner.
select set_config('request.jwt.claim.sub', '', false);
insert into public.teams (name, kind, season, archived, created_at) values
  ('Old Squad', 'squad', 2020, true, now() - interval '600 days');
insert into public.injuries (id, athlete_id, body_area, description, injured_on, status, cleared_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000032', 'Ankle', 'Rolled', public.club_today() - 200, 'cleared', now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000032', 'Knee', 'Sore', public.club_today() - 500, 'cleared', now() - interval '400 days');
select pg_temp.ok('cleared 100 days ago in an archived season: kept', (select not public.injury_documents_expired(i) from public.injuries i where id = '00000000-0000-0000-0000-0000000000e1'), true);
select pg_temp.ok('cleared over a year ago: due', (select public.injury_documents_expired(i) from public.injuries i where id = '00000000-0000-0000-0000-0000000000e2'), true);
select pg_temp.as_member('01');
select pg_temp.works('injury documents 90 days', $$select public.admin_set_record_retention_all(true, 12, 12, 36, 84, 12, 12, 84, 90)$$);
select pg_temp.ok('cleared 100 days ago: due at 90 days', (select public.injury_documents_expired(i) from public.injuries i where id = '00000000-0000-0000-0000-0000000000e1'), true);

-- Switching off stops everything.
select pg_temp.works('removal off', $$select public.admin_set_record_retention_all(false, 12, 12, 36, 84, 12, 12, 84, 365)$$);
select pg_temp.ok('nothing due once off', (select bool_and(not public.injury_documents_expired(i)) from public.injuries i) and public.purge_expired_records() = '{"enabled": false}'::jsonb, true);
