-- Tests for 20261115000600_publish_consent_needs_guardian.sql: a parent's
-- consent to show their child's stats on a live stream counts only while
-- the child has at least one approved, verified guardian linked. Data and
-- health consent are unchanged, and no stored consent row changes. Run on a
-- fresh database with the migrations and seed-members.sql loaded. Prints
-- one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- What Studio is told about an athlete in game 1's line-up.
create or replace function pg_temp.may_publish(n text) returns boolean language plpgsql as
$$ declare r boolean; v text := current_setting('request.jwt.claim.sub', true);
   begin
     perform pg_temp.as_member('51');
     select l.may_publish into r from public.studio_lineup('00000000-0000-0000-0000-000000000f01') l where l.profile_id = pg_temp.m(n);
     perform set_config('request.jwt.claim.sub', coalesce(v, ''), false);
     return r;
   end $$;
create or replace function pg_temp.consents_in_force(n text) returns bigint language sql as
$$ select count(*) from public.child_consents where athlete_id = pg_temp.m(n) and withdrawn_at is null $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- Nico (51) runs Studio. Jordan (31, 14) is on Sample Team with verified
-- guardians Logan (41) and Morgan (42). Kai (32, adult) and Ash (81, 17,
-- turns 18 tomorrow, guardian Logan) join the team for these tests.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000051', 'studio@example.test', now()),
  ('00000000-0000-0000-0000-000000000081', 'athlete.nearly18@example.test', now());
update public.profiles set status = 'approved', full_name = 'Nico Studio', role = 'studio' where id = pg_temp.m('51');
update public.profiles set status = 'approved', full_name = 'Ash Nearly', role = 'athlete',
  date_of_birth = public.club_today() - interval '18 years' + interval '1 day', verified_at = now()
where id = pg_temp.m('81');
insert into public.team_members (team_id, profile_id, team_role, selection) values
  ('00000000-0000-0000-0000-0000000000a2', pg_temp.m('32'), 'athlete', 'touring'),
  ('00000000-0000-0000-0000-0000000000a2', pg_temp.m('81'), 'athlete', 'touring');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.m('41'), pg_temp.m('81'));
insert into public.games (id, team_id, playhq_game_id, config, status, recorder_id, pair_code, created_by) values
  ('00000000-0000-0000-0000-000000000f01', '00000000-0000-0000-0000-0000000000a2', 'PHQ-1', '{}', 'live', pg_temp.m('01'), '111111', pg_temp.m('01'));

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('members can''t call has_publish_consent directly', has_function_privilege('authenticated', 'public.has_publish_consent(uuid)', 'execute'), false);
select pg_temp.ok('anon can''t call has_publish_consent', has_function_privilege('anon', 'public.has_publish_consent(uuid)', 'execute'), false);
select pg_temp.ok('Studio still calls studio_lineup', has_function_privilege('authenticated', 'public.studio_lineup(uuid)', 'execute'), true);
select pg_temp.ok('guardians still call my_child_consents', has_function_privilege('authenticated', 'public.my_child_consents()', 'execute'), true);
select pg_temp.ok('one studio_lineup', (select count(*) = 1 from pg_proc where proname = 'studio_lineup' and pronamespace = 'public'::regnamespace), true);
select pg_temp.ok('one my_child_consents', (select count(*) = 1 from pg_proc where proname = 'my_child_consents' and pronamespace = 'public'::regnamespace), true);

-- ---------------------------------------------------------------------------
-- Consent given while guardians are verified
-- ---------------------------------------------------------------------------
select pg_temp.ok('before consent Jordan isn''t shown by name', pg_temp.may_publish('31'), false);
select pg_temp.ok('an adult is shown without consent', pg_temp.may_publish('32'), true);
select pg_temp.as_member('41');
select pg_temp.works('Logan gives publish consent for Jordan', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('31')));
select pg_temp.works('Logan gives publish consent for Ash', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('81')));
select pg_temp.works('Logan gives data and health consent for Jordan', format('select public.set_child_consent(%L, true, true)', pg_temp.m('31')));
select pg_temp.ok('Logan sees all three consents in force',
  (select data and health and publish from public.my_child_consents() where athlete_id = pg_temp.m('31')), true);
select pg_temp.ok('with both guardians verified Studio may name Jordan', pg_temp.may_publish('31'), true);
select pg_temp.ok('and Ash', pg_temp.may_publish('81'), true);

-- ---------------------------------------------------------------------------
-- One verified guardian is enough
-- ---------------------------------------------------------------------------
update public.profiles set verified_at = null where id = pg_temp.m('41');
select pg_temp.ok('Logan unverified, Morgan verified: still shown', pg_temp.may_publish('31'), true);
select pg_temp.as_member('42');
select pg_temp.ok('Morgan sees publish in force', (select publish from public.my_child_consents() where athlete_id = pg_temp.m('31')), true);
select pg_temp.ok('Ash (Logan his only guardian, now unverified) isn''t shown', pg_temp.may_publish('81'), false);

-- ---------------------------------------------------------------------------
-- No verified guardian: publish stops counting, data and health don't
-- ---------------------------------------------------------------------------
delete from public.guardianships where guardian_id = pg_temp.m('42') and athlete_id = pg_temp.m('31');
select pg_temp.ok('no verified guardian: Studio may not name Jordan', pg_temp.may_publish('31'), false);
select pg_temp.ok('Jordan is locked', public.is_locked_child(pg_temp.m('31')), true);
select pg_temp.ok('the publish consent row is still stored and in force', pg_temp.consents_in_force('31') = 3, true);
select pg_temp.ok('nothing recorded it as withdrawn',
  (select count(*) = 0 from public.child_consents where athlete_id = pg_temp.m('31') and withdrawn_at is not null), true);
select pg_temp.ok('has_child_consent publish still sees the stored row (unchanged function)', public.has_child_consent(pg_temp.m('31'), 'publish'), true);
select pg_temp.ok('data consent is unchanged', public.has_child_consent(pg_temp.m('31'), 'data'), true);
select pg_temp.ok('health consent is unchanged', public.has_child_consent(pg_temp.m('31'), 'health'), true);
select pg_temp.ok('has_publish_consent says no', public.has_publish_consent(pg_temp.m('31')), false);
select pg_temp.as_member('41');
select pg_temp.ok('Logan (unverified) is told publish isn''t in force, data and health are',
  (select data and health and not publish from public.my_child_consents() where athlete_id = pg_temp.m('31')), true);

-- Verified again: the stored consent counts again.
update public.profiles set verified_at = now() where id = pg_temp.m('41');
select pg_temp.ok('Logan verified again: Jordan shown again', pg_temp.may_publish('31'), true);
select pg_temp.ok('and Ash', pg_temp.may_publish('81'), true);

-- Other ways the last verified guardian goes
update public.profiles set status = 'pending' where id = pg_temp.m('41');
select pg_temp.ok('guardian no longer approved: not shown', pg_temp.may_publish('31'), false);
update public.profiles set status = 'approved', role = 'athlete', date_of_birth = public.club_today() - interval '40 years' where id = pg_temp.m('41');
select pg_temp.ok('guardian role taken away: not shown', pg_temp.may_publish('31'), false);
update public.profiles set role = 'guardian' where id = pg_temp.m('41');
select pg_temp.ok('guardian role back: shown', pg_temp.may_publish('31'), true);
select pg_temp.ok('a coach of the team who isn''t Jordan''s guardian doesn''t count',
  (select count(*) = 0 from public.guardianships where athlete_id = pg_temp.m('31') and guardian_id = pg_temp.m('11')), true);

-- Turning 18: adults need neither consent nor guardian.
update public.profiles set date_of_birth = public.club_today() - interval '18 years' where id = pg_temp.m('81');
delete from public.guardianships where athlete_id = pg_temp.m('81');
select pg_temp.ok('Ash at 18 with no guardian is shown', pg_temp.may_publish('81'), true);

-- The guardian's account deleted (as admin_delete_member does).
delete from auth.users where id = pg_temp.m('41');
select pg_temp.ok('last guardian deleted: Jordan not shown', pg_temp.may_publish('31'), false);
select pg_temp.ok('the consent rows are kept', pg_temp.consents_in_force('31') = 3, true);
select pg_temp.ok('an adult is still shown', pg_temp.may_publish('32'), true);

select set_config('request.jwt.claim.sub', '', false);
