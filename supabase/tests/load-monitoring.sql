-- Tests for 20261028000000_load_monitoring.sql: training load prompts from
-- session logs. The ratio flag (Gabbett 2016, Murray 2017), hours over age
-- for under 18s (Jayanthi 2015), sessions during an injury with
-- restrictions, and low check-ins alongside (Saw 2016). Coaches see and
-- close flags, athletes see their own, parents see only a coach's review,
-- and the Child Safety Officer sees under 18s' patterns. Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.is(label text, actual text, expected text) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual, 'null') || ')' $$;
create or replace function pg_temp.fails_with(label text, statement text, words text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when position(words in sqlerrm) > 0 then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- An athlete's flags today, worked out as the database owner.
create or replace function pg_temp.flags(n text) returns text language sql as
$$ select array_to_string(public.load_flags_on(pg_temp.id(n), current_date), ',') $$;
-- Sessions for the 3 weeks before the last 7 days (60 minutes at effort 5
-- every other day), then the last 7 days daily at p_effort.
create or replace function pg_temp.weeks(n text, p_effort int) returns void language sql as
$$ delete from public.session_logs where athlete_id = pg_temp.id(n);
   insert into public.session_logs (athlete_id, day, kind, minutes, rpe)
   select pg_temp.id(n), current_date - d, 'training', 60, case when d < 7 then p_effort else 5 end
   from generate_series(0, 27) d where d < 7 or d % 2 = 0 $$;
create or replace function pg_temp.check_in(n text, back int, low int) returns void language sql as
$$ insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note)
   values (pg_temp.id(n), current_date - back, 4, low, 4, 5, 'Private note')
   on conflict (athlete_id, day) do update set soreness = excluded.soreness, stress = 4 $$;
-- How many of the signed-in coach's listed athletes are this one.
create or replace function pg_temp.listed(n text) returns boolean language sql as
$$ select exists (select 1 from public.coach_load_flags() where athlete_id = pg_temp.id(n)) $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
-- The club turns on Training load flags (off by default; tested below).
update public.club_settings set features = features || '{"trainingLoad": true}' where id;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;
-- Emery Manager is the Child Safety Officer for these tests.
update public.safeguarding_settings set child_safety_officer_id = pg_temp.id('13') where id;
-- The seed's check-in for Jordan today is low (stress 2); start from a good one.
update public.check_ins set stress = 4 where athlete_id = pg_temp.id('31');

-- A new adult athlete in the squad with no history, and a teammate.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('55'), 'athlete.new@example.test', now()),
  (pg_temp.id('56'), 'athlete.teammate@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = 'athlete',
  date_of_birth = current_date - interval '20 years', verified_at = now()
from (values (pg_temp.id('55'), 'Ren New'), (pg_temp.id('56'), 'Sam Teammate')) v(id, name)
where p.id = v.id;
insert into public.team_members (team_id, profile_id, team_role) values
  (pg_temp.id('a1'), pg_temp.id('55'), 'athlete'),
  (pg_temp.id('a1'), pg_temp.id('56'), 'athlete');

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------

select pg_temp.ok('row level security is on for reviews', (select relrowsecurity from pg_class where oid = 'public.load_flag_reviews'::regclass), true);
select pg_temp.ok('signed-in members cannot read reviews directly', has_table_privilege('authenticated', 'public.load_flag_reviews', 'select'), false);
select pg_temp.ok('signed-in members cannot write reviews directly', has_table_privilege('authenticated', 'public.load_flag_reviews', 'insert'), false);
select pg_temp.ok('anon cannot read reviews', has_table_privilege('anon', 'public.load_flag_reviews', 'select'), false);
select pg_temp.ok('the service role can manage reviews', has_table_privilege('service_role', 'public.load_flag_reviews', 'delete'), true);
select pg_temp.ok('helper is closed: load_numbers', has_function_privilege('authenticated', 'public.load_numbers(uuid, date)', 'execute'), false);
select pg_temp.ok('helper is closed: load_flags_on', has_function_privilege('authenticated', 'public.load_flags_on(uuid, date)', 'execute'), false);
select pg_temp.ok('helper is closed: recent_load_review', has_function_privilege('authenticated', 'public.recent_load_review(uuid)', 'execute'), false);
select pg_temp.ok('helper is closed: load_review_athletes', has_function_privilege('authenticated', 'public.load_review_athletes()', 'execute'), false);
select pg_temp.ok('helper is closed: load_monitoring_on', has_function_privilege('authenticated', 'public.load_monitoring_on()', 'execute'), false);
select pg_temp.ok('helper is closed: load_pattern_rows', has_function_privilege('authenticated', 'public.load_pattern_rows()', 'execute'), false);
select pg_temp.ok('helper is closed to anon: load_flags_on', has_function_privilege('anon', 'public.load_flags_on(uuid, date)', 'execute'), false);
select pg_temp.ok('members can call the coach list', has_function_privilege('authenticated', 'public.coach_load_flags()', 'execute'), true);
select pg_temp.ok('members can call the coach to-do count', has_function_privilege('authenticated', 'public.coach_load_flag_count()', 'execute'), true);
select pg_temp.ok('members can call an athlete''s load', has_function_privilege('authenticated', 'public.athlete_load(uuid)', 'execute'), true);
select pg_temp.ok('members can call the review', has_function_privilege('authenticated', 'public.review_load_flag(uuid, text)', 'execute'), true);
select pg_temp.ok('members can call the patterns', has_function_privilege('authenticated', 'public.load_patterns()', 'execute'), true);
select pg_temp.ok('members can call the pattern count', has_function_privilege('authenticated', 'public.load_pattern_alerts()', 'execute'), true);
select pg_temp.ok('members can read the settings', has_function_privilege('authenticated', 'public.load_monitoring_settings()', 'execute'), true);
select pg_temp.ok('anon cannot read the settings', has_function_privilege('anon', 'public.load_monitoring_settings()', 'execute'), false);
select pg_temp.ok('anon cannot change the settings', has_function_privilege('anon', 'public.admin_set_load_monitoring(text, boolean)', 'execute'), false);
select pg_temp.ok('anon cannot see an athlete''s load', has_function_privilege('anon', 'public.athlete_load(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot review', has_function_privilege('anon', 'public.review_load_flag(uuid, text)', 'execute'), false);

-- ---------------------------------------------------------------------------
-- Club settings
-- ---------------------------------------------------------------------------

select pg_temp.as_member('32');
select pg_temp.is('the ratio flag defaults to 1.5 or more', (select ratio_flag from public.load_monitoring_settings()), 'from_1_5');
select pg_temp.ok('the hours flag defaults to on', (select hours_flag from public.load_monitoring_settings()), true);
select pg_temp.fails_with('an athlete cannot change them', $s$ select public.admin_set_load_monitoring('off', false) $s$, 'Only admins');
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach cannot change them', $s$ select public.admin_set_load_monitoring('off', false) $s$, 'Only admins');
select pg_temp.as_member('21');
select pg_temp.fails_with('the committee cannot change them', $s$ select public.admin_set_load_monitoring('off', false) $s$, 'Only admins');
select pg_temp.as_member('01');
select pg_temp.fails_with('a value that isn''t a choice is refused', $s$ select public.admin_set_load_monitoring('2.0', true) $s$, 'Choose 1.5 or more');
select pg_temp.fails_with('no value is refused', $s$ select public.admin_set_load_monitoring(null, true) $s$, 'Choose 1.5 or more');
select pg_temp.fails_with('no hours choice is refused', $s$ select public.admin_set_load_monitoring('off', null) $s$, 'hours over age');
select pg_temp.works('an admin chooses above 1.3 and hours off', $s$ select public.admin_set_load_monitoring('above_1_3', false) $s$);
select pg_temp.ok('saved', (select load_ratio_flag = 'above_1_3' and not load_hours_flag from public.club_settings where id), true);
select pg_temp.works('an admin goes back to the defaults', $s$ select public.admin_set_load_monitoring('from_1_5', true) $s$);
select pg_temp.ok('the table refuses other values', (select count(*) = 0 from pg_constraint where conname = 'club_settings_load_ratio_flag_check'), false);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in sees no settings', (select count(*) = 0 from public.load_monitoring_settings()), true);

-- ---------------------------------------------------------------------------
-- The ratio flag
-- ---------------------------------------------------------------------------

-- Effort 7 every day after 3 weeks of effort 5 every other day: about 1.64.
select pg_temp.weeks('32', 7);
select pg_temp.ok('a sharp rise is over 1.5', (select ratio >= 1.5 from public.load_numbers(pg_temp.id('32'), current_date)), true);
select pg_temp.is('a sharp rise flags the ratio', pg_temp.flags('32'), 'ratio');
select pg_temp.ok('3 weeks of history before the last 7 days', (select weeks_before = 3 from public.load_numbers(pg_temp.id('32'), current_date)), true);
select pg_temp.ok('the last 7 days: 7 sessions, 420 minutes', (select sessions_7d = 7 and minutes_7d = 420 from public.load_numbers(pg_temp.id('32'), current_date)), true);
-- Effort 4 every day: about 1.40, between the two choices.
select pg_temp.weeks('32', 4);
select pg_temp.ok('a smaller rise is between 1.3 and 1.5', (select ratio > 1.3 and ratio < 1.5 from public.load_numbers(pg_temp.id('32'), current_date)), true);
select pg_temp.is('it doesn''t flag at 1.5 or more', pg_temp.flags('32'), '');
update public.club_settings set load_ratio_flag = 'above_1_3' where id;
select pg_temp.is('it flags when the club picks above 1.3', pg_temp.flags('32'), 'ratio');
update public.club_settings set load_ratio_flag = 'off' where id;
select pg_temp.weeks('32', 7);
select pg_temp.is('nothing flags when the club turns it off', pg_temp.flags('32'), '');
update public.club_settings set load_ratio_flag = 'from_1_5' where id;
-- Steady training doesn't flag.
delete from public.session_logs where athlete_id = pg_temp.id('32');
insert into public.session_logs (athlete_id, day, kind, minutes, rpe)
select pg_temp.id('32'), current_date - d, 'training', 60, 5 from generate_series(0, 27) d where d % 2 = 0;
select pg_temp.ok('steady training stays in the sweet spot', (select ratio <= 1.3 from public.load_numbers(pg_temp.id('32'), current_date)), true);
select pg_temp.is('steady training doesn''t flag', pg_temp.flags('32'), '');
-- A new athlete's first big week doesn't flag the ratio: no history.
insert into public.session_logs (athlete_id, day, kind, minutes, rpe)
select pg_temp.id('55'), current_date - d, 'training', 120, 9 from generate_series(0, 6) d;
select pg_temp.ok('a new athlete has no weeks before', (select weeks_before = 0 from public.load_numbers(pg_temp.id('55'), current_date)), true);
select pg_temp.is('a new athlete isn''t flagged on the ratio', pg_temp.flags('55'), '');
-- A gap in the 3 weeks before means no ratio flag either.
delete from public.session_logs where athlete_id = pg_temp.id('55') ;
insert into public.session_logs (athlete_id, day, kind, minutes, rpe)
select pg_temp.id('55'), current_date - d, 'training', 60, case when d < 7 then 9 else 3 end
from generate_series(0, 27) d where d < 7 or d between 7 and 13 or d between 21 and 27;
select pg_temp.ok('a week with no sessions counts 2 weeks before', (select weeks_before = 2 from public.load_numbers(pg_temp.id('55'), current_date)), true);
select pg_temp.is('not flagged until each of the 3 weeks has a session', pg_temp.flags('55'), '');
delete from public.session_logs where athlete_id = pg_temp.id('55');

-- ---------------------------------------------------------------------------
-- Hours over age (under 18s)
-- ---------------------------------------------------------------------------

-- Jordan is 14: more than 14 hours in 7 days flags.
insert into public.session_logs (athlete_id, day, kind, minutes, rpe)
select pg_temp.id('31'), current_date - d, 'training', 120, 3 from generate_series(0, 6) d;
select pg_temp.is('14 hours at 14 doesn''t flag', pg_temp.flags('31'), '');
insert into public.session_logs (athlete_id, day, kind, minutes, rpe) values (pg_temp.id('31'), current_date, 'other', 1, 2);
select pg_temp.is('a minute over 14 hours flags', pg_temp.flags('31'), 'hours');
update public.club_settings set load_hours_flag = false where id;
select pg_temp.is('not when the club turns it off', pg_temp.flags('31'), '');
update public.club_settings set load_hours_flag = true where id;
-- Kai is 25: the same hours don't flag an adult.
delete from public.session_logs where athlete_id = pg_temp.id('32');
insert into public.session_logs (athlete_id, day, kind, minutes, rpe)
select pg_temp.id('32'), current_date - d, 'training', 180, 3 from generate_series(0, 6) d;
select pg_temp.is('an adult isn''t flagged on hours', pg_temp.flags('32'), '');
-- No date of birth: no age, so no hours flag.
update public.profiles set date_of_birth = null where id = pg_temp.id('31');
select pg_temp.is('no date of birth, no hours flag', pg_temp.flags('31'), '');
update public.profiles set date_of_birth = current_date - interval '14 years' where id = pg_temp.id('31');
-- A session logged for tomorrow (time zones) counts.
delete from public.session_logs where athlete_id = pg_temp.id('31') and kind = 'other';
insert into public.session_logs (athlete_id, day, kind, minutes, rpe) values (pg_temp.id('31'), current_date + 1, 'other', 1, 2);
select pg_temp.is('a session dated tomorrow counts in the last 7 days', pg_temp.flags('31'), 'hours');

-- ---------------------------------------------------------------------------
-- Sessions during an injury, and low check-ins alongside
-- ---------------------------------------------------------------------------

-- Ren has no flag and an injury without restrictions.
insert into public.session_logs (athlete_id, day, kind, minutes, rpe) values (pg_temp.id('55'), current_date - 1, 'training', 60, 5);
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
values (pg_temp.id('55'), pg_temp.id('55'), 'Knee', 'Sore knee', current_date - 4, 'Ren New');
select pg_temp.is('an injury without restrictions doesn''t flag', pg_temp.flags('55'), '');
update public.injuries set restrictions = 'No jumping or court training' where athlete_id = pg_temp.id('55');
select pg_temp.is('a session during an injury with restrictions flags', pg_temp.flags('55'), 'injury');
update public.injuries set injured_on = current_date where athlete_id = pg_temp.id('55');
select pg_temp.is('a session before the injury doesn''t', pg_temp.flags('55'), '');
update public.injuries set injured_on = current_date - 4, status = 'cleared' where athlete_id = pg_temp.id('55');
select pg_temp.is('a cleared injury doesn''t', pg_temp.flags('55'), '');
update public.injuries set status = 'clearance_requested' where athlete_id = pg_temp.id('55');
select pg_temp.is('an injury waiting for clearance still does', pg_temp.flags('55'), 'injury');
-- Two low check-ins in 7 days add wellbeing to a flag, never on their own.
select pg_temp.check_in('55', 1, 2);
select pg_temp.is('one low check-in adds nothing', pg_temp.flags('55'), 'injury');
select pg_temp.check_in('55', 3, 1);
select pg_temp.is('two low check-ins add wellbeing', pg_temp.flags('55'), 'injury,wellbeing');
select pg_temp.check_in('56', 1, 1);
select pg_temp.check_in('56', 2, 1);
insert into public.session_logs (athlete_id, day, kind, minutes, rpe) values (pg_temp.id('56'), current_date, 'training', 30, 3);
select pg_temp.is('low check-ins alone don''t flag load', pg_temp.flags('56'), '');

-- ---------------------------------------------------------------------------
-- The Training load flags switch
-- ---------------------------------------------------------------------------

select pg_temp.weeks('32', 7);
update public.club_settings set features = features - 'trainingLoad' where id;
select pg_temp.is('off by default: no flags when the club hasn''t turned it on', pg_temp.flags('32'), '');
update public.club_settings set features = features || '{"trainingLoad": false}' where id;
select pg_temp.is('no flags when the club turns it off', pg_temp.flags('32'), '');
select pg_temp.as_member('11');
select pg_temp.ok('turned off, the coach''s list is empty', (select count(*) = 0 from public.coach_load_flags()), true);
select pg_temp.is('turned off, the coach''s to-do counts none', (select public.coach_load_flag_count()::text), '0');
select pg_temp.fails_with('turned off, there''s nothing to mark as talked', $s$ select public.review_load_flag(pg_temp.id('32'), null) $s$, 'no training load flag');
update public.club_settings set features = features || '{"trainingLoad": true, "checkIns": false}' where id;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.is('no flags while Daily check-ins is off', pg_temp.flags('32'), '');
update public.club_settings set features = features || '{"trainingLoad": true, "checkIns": true}' where id;
select pg_temp.is('back on, the flag returns', pg_temp.flags('32'), 'ratio');

-- ---------------------------------------------------------------------------
-- The coach's list, to-do and "Talked with them"
-- ---------------------------------------------------------------------------

-- Kai: a sharp rise again.
select pg_temp.weeks('32', 7);
select pg_temp.as_member('11');
select pg_temp.ok('the coach sees Kai''s flag', pg_temp.listed('32'), true);
select pg_temp.ok('the coach sees Ren''s flag', pg_temp.listed('55'), true);
select pg_temp.ok('the coach doesn''t list Sam, who has no flag', pg_temp.listed('56'), false);
select pg_temp.ok('the coach doesn''t see Jordan before a parent consents', pg_temp.listed('31'), false);
select pg_temp.is('the to-do counts Kai and Ren', (select public.coach_load_flag_count()::text), '2');
select pg_temp.ok('the list carries the flags and numbers', (select flags = '{ratio}' and ratio >= 1.5 and minutes_7d = 420 and reviewed_on is null from public.coach_load_flags() where athlete_id = pg_temp.id('32')), true);

-- A guardian gives consent: Jordan joins the coach's list.
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
  perform public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true);
end $$;
select pg_temp.as_member('11');
select pg_temp.ok('after consent the coach sees Jordan''s flag', pg_temp.listed('31'), true);
select pg_temp.is('the to-do counts 3', (select public.coach_load_flag_count()::text), '3');

-- Others who don't coach the athletes.
select pg_temp.as_member('13');
select pg_temp.ok('the manager sees no one', (select count(*) = 0 from public.coach_load_flags()), true);
select pg_temp.ok('the manager has no to-do', (select public.coach_load_flag_count() is null), true);
select pg_temp.as_member('12');
select pg_temp.ok('the lapsed coach sees no one', (select count(*) = 0 from public.coach_load_flags()), true);
select pg_temp.as_member('14');
select pg_temp.ok('the physio sees no one', (select count(*) = 0 from public.coach_load_flags()), true);
select pg_temp.as_member('01');
select pg_temp.ok('an admin sees no one', (select count(*) = 0 from public.coach_load_flags()), true);
select pg_temp.as_member('22');
select pg_temp.ok('a committee member sees no one', (select count(*) = 0 from public.coach_load_flags()), true);
select pg_temp.as_member('56');
select pg_temp.ok('a teammate sees no one', (select count(*) = 0 from public.coach_load_flags()), true);
select pg_temp.as_member('41');
select pg_temp.ok('a parent has no coach list', (select count(*) = 0 from public.coach_load_flags()), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails_with('nobody signed in is refused the list', $s$ select * from public.coach_load_flags() $s$, 'Only coaches');

-- Who can mark "Talked with them".
select pg_temp.as_member('13');
select pg_temp.fails_with('the manager cannot', $s$ select public.review_load_flag(pg_temp.id('32'), null) $s$, 'Only the athlete''s coaches');
select pg_temp.as_member('01');
select pg_temp.fails_with('an admin cannot', $s$ select public.review_load_flag(pg_temp.id('32'), null) $s$, 'Only the athlete''s coaches');
select pg_temp.as_member('41');
select pg_temp.fails_with('a parent cannot', $s$ select public.review_load_flag(pg_temp.id('31'), null) $s$, 'Only the athlete''s coaches');
select pg_temp.as_member('32');
select pg_temp.fails_with('the athlete cannot', $s$ select public.review_load_flag(pg_temp.id('32'), null) $s$, 'Only the athlete''s coaches');
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach cannot close a flag that isn''t there', $s$ select public.review_load_flag(pg_temp.id('56'), null) $s$, 'no training load flag');
select pg_temp.fails_with('a note over 500 characters is refused', $s$ select public.review_load_flag(pg_temp.id('32'), repeat('x', 501)) $s$, '500 characters');
select pg_temp.works('the coach talked with Kai', $s$ select public.review_load_flag(pg_temp.id('32'), 'Busy week with uni sport, easing off Thursday') $s$);
select pg_temp.ok('the review keeps the flags and the coach', (select flags = '{ratio}' and reviewer_name = 'Casey Coach' and reviewed_on = current_date from public.load_flag_reviews where athlete_id = pg_temp.id('32')), true);
select pg_temp.is('the to-do drops to 2', (select public.coach_load_flag_count()::text), '2');
select pg_temp.ok('Kai stays on the list, marked talked', (select reviewed_on = current_date and reviewer_name = 'Casey Coach' from public.coach_load_flags() where athlete_id = pg_temp.id('32')), true);
select pg_temp.ok('open flags list first', (select athlete_id <> pg_temp.id('32') from public.coach_load_flags() limit 1), true);
select pg_temp.works('the coach talked with Jordan', $s$ select public.review_load_flag(pg_temp.id('31'), 'Asked about school netball') $s$);
-- A review from 8 days ago no longer closes the flag.
update public.load_flag_reviews set reviewed_on = current_date - 8 where athlete_id = pg_temp.id('31');
select pg_temp.is('a review over 7 days old opens the flag again', (select public.coach_load_flag_count()::text), '2');
update public.load_flag_reviews set reviewed_on = current_date where athlete_id = pg_temp.id('31');

-- ---------------------------------------------------------------------------
-- One athlete's load: what each person gets
-- ---------------------------------------------------------------------------

select pg_temp.as_member('32');
select pg_temp.ok('Kai sees his own flag and ratio', (select flags = '{ratio}' and ratio >= 1.5 and weeks_before = 3 from public.athlete_load(pg_temp.id('32'))), true);
select pg_temp.ok('Kai sees who talked with him, not the note', (select reviewer_name = 'Casey Coach' and review_note is null from public.athlete_load(pg_temp.id('32'))), true);
select pg_temp.as_member('11');
select pg_temp.ok('the coach sees the note', (select review_note = 'Busy week with uni sport, easing off Thursday' from public.athlete_load(pg_temp.id('32'))), true);
select pg_temp.as_member('31');
select pg_temp.ok('Jordan sees their own hours flag', (select flags = '{hours}' from public.athlete_load(pg_temp.id('31'))), true);
select pg_temp.fails_with('Jordan cannot see Kai''s', $s$ select * from public.athlete_load(pg_temp.id('32')) $s$, 'not found');
select pg_temp.as_member('41');
select pg_temp.ok('a parent sees no live flags or numbers', (select flags is null and ratio is null and weeks_before is null from public.athlete_load(pg_temp.id('31'))), true);
select pg_temp.ok('a parent sees the coach''s review and what it was about', (select reviewer_name = 'Casey Coach' and reviewed_flags = '{hours}' and reviewed_on = current_date from public.athlete_load(pg_temp.id('31'))), true);
select pg_temp.ok('a parent never sees the note', (select review_note is null from public.athlete_load(pg_temp.id('31'))), true);
select pg_temp.fails_with('a parent cannot see another athlete''s', $s$ select * from public.athlete_load(pg_temp.id('32')) $s$, 'not found');
-- Before any review, a parent sees nothing at all.
update public.load_flag_reviews set reviewed_on = current_date - 8 where athlete_id = pg_temp.id('31');
select pg_temp.ok('before a review, a parent sees no card', (select reviewed_on is null and reviewed_flags is null from public.athlete_load(pg_temp.id('31'))), true);
update public.load_flag_reviews set reviewed_on = current_date where athlete_id = pg_temp.id('31');
select pg_temp.as_member('42');
select pg_temp.ok('the coach-parent, as Jordan''s coach, sees the note', (select review_note = 'Asked about school netball' from public.athlete_load(pg_temp.id('31'))), true);
select pg_temp.as_member('56');
select pg_temp.fails_with('a teammate cannot see Kai''s', $s$ select * from public.athlete_load(pg_temp.id('32')) $s$, 'not found');
select pg_temp.as_member('13');
select pg_temp.fails_with('the manager cannot', $s$ select * from public.athlete_load(pg_temp.id('32')) $s$, 'not found');
select pg_temp.as_member('01');
select pg_temp.fails_with('an admin cannot', $s$ select * from public.athlete_load(pg_temp.id('32')) $s$, 'not found');
select pg_temp.as_member('22');
select pg_temp.fails_with('a committee member cannot', $s$ select * from public.athlete_load(pg_temp.id('32')) $s$, 'not found');
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails_with('nobody signed in cannot', $s$ select * from public.athlete_load(pg_temp.id('32')) $s$, 'not found');

-- ---------------------------------------------------------------------------
-- The Child Safety Officer: under 18s' patterns only
-- ---------------------------------------------------------------------------

-- Jordan: hours over age this week and the week before, low check-ins now,
-- and the coach's review is from today.
insert into public.session_logs (athlete_id, day, kind, minutes, rpe)
select pg_temp.id('31'), current_date - d, 'training', 120, 3 from generate_series(7, 13) d;
insert into public.session_logs (athlete_id, day, kind, minutes, rpe) values (pg_temp.id('31'), current_date - 7, 'other', 5, 2);
select pg_temp.check_in('31', 1, 2);
select pg_temp.check_in('31', 2, 2);
select pg_temp.as_member('13');
select pg_temp.ok('hours over age 2 weeks running', (select count(*) = 1 from public.load_patterns() where athlete_id = pg_temp.id('31') and pattern = 'hours_2_weeks'), true);
select pg_temp.ok('a flag alongside low check-ins', (select count(*) = 1 from public.load_patterns() where athlete_id = pg_temp.id('31') and pattern = 'with_wellbeing'), true);
select pg_temp.ok('followed up this week, so not "not followed up"', (select count(*) = 0 from public.load_patterns() where pattern = 'not_followed_up'), true);
select pg_temp.ok('adults never show', (select count(*) = 0 from public.load_patterns() where athlete_id <> pg_temp.id('31')), true);
select pg_temp.is('the to-do counts Jordan once', (select public.load_pattern_alerts()::text), '1');
select pg_temp.ok('each view of a child is logged', (select count(*) > 0 from public.record_access_log where subject_id = pg_temp.id('31') and viewer_id = pg_temp.id('13') and kind = 'check_ins'), true);
-- No coach review since the flag a week ago.
delete from public.load_flag_reviews where athlete_id = pg_temp.id('31');
select pg_temp.ok('a flag no coach followed up within 7 days', (select count(*) = 1 from public.load_patterns() where athlete_id = pg_temp.id('31') and pattern = 'not_followed_up'), true);
select pg_temp.ok('only the name, the pattern and the day', (select array_agg(parameter_name::text order by ordinal_position) = '{athlete_id,athlete_name,pattern,since}' from information_schema.parameters
  where specific_name like 'load_patterns\_%' and parameter_mode = 'OUT'), true);
-- Consent withdrawn: Jordan disappears.
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
  perform public.set_child_consent('00000000-0000-0000-0000-000000000031', false, true);
end $$;
select pg_temp.as_member('13');
select pg_temp.ok('without a parent''s consent the child doesn''t show', (select count(*) = 0 from public.load_patterns()), true);
select pg_temp.is('and the to-do counts none', (select public.load_pattern_alerts()::text), '0');
-- Nobody else.
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach is refused the patterns', $s$ select * from public.load_patterns() $s$, 'Only the Child Safety Officer');
select pg_temp.ok('a coach gets no pattern count', (select public.load_pattern_alerts() is null), true);
select pg_temp.as_member('01');
select pg_temp.fails_with('an admin is refused the patterns', $s$ select * from public.load_patterns() $s$, 'Only the Child Safety Officer');
select pg_temp.as_member('41');
select pg_temp.fails_with('a parent is refused the patterns', $s$ select * from public.load_patterns() $s$, 'Only the Child Safety Officer');
select pg_temp.as_member('22');
select pg_temp.fails_with('the committee is refused the patterns', $s$ select * from public.load_patterns() $s$, 'Only the Child Safety Officer');

-- ---------------------------------------------------------------------------
-- Removed with check-ins
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '', false);
insert into public.load_flag_reviews (athlete_id, reviewer_name, flags, reviewed_on) values
  (pg_temp.id('32'), 'Casey Coach', '{ratio}', current_date - interval '13 months'),
  (pg_temp.id('32'), 'Casey Coach', '{ratio}', current_date - interval '11 months');
update public.club_settings set retention_enabled = false where id;
select pg_temp.ok('nothing is removed while Remove old records is off', (select public.purge_expired_records() = '{"enabled": false}'::jsonb), true);
update public.club_settings set retention_enabled = true, retention_check_ins_months = 12 where id;
select pg_temp.ok('the clean-up removes the old review', (select (r->>'load_flag_reviews')::int = 1 from public.purge_expired_records() r), true);
select pg_temp.ok('the newer ones stay', (select count(*) = 2 from public.load_flag_reviews where athlete_id = pg_temp.id('32')), true);
select pg_temp.ok('the clean-up still removes session logs', (select r ? 'session_logs' from public.purge_expired_records() r), true);
