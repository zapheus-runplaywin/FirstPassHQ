-- Tests for the admin's club, season and team tools and some small member
-- lookups: 20261007050000_club_password.sql, 20261007080000_member_verification.sql,
-- 20261007160000_selections_phase.sql, 20261007170000_seasons.sql,
-- 20261008010000_fixtures_and_awards.sql (PlayHQ), 20261008040000_club_branding_and_features.sql,
-- 20261008120000_guest_and_physio_access.sql, 20261008150000_club_settings_save_where.sql,
-- 20261008210000_captains.sql, 20261009000000_optional_squads.sql,
-- 20261009110000_multiple_roles.sql, 20261012001000_team_physios.sql,
-- 20261012100000_team_templates.sql, 20261012200000_security_hardening.sql,
-- 20261012220000_stand_downs.sql, 20261012235000_concerns.sql,
-- 20261013090000_record_access_log.sql, 20261016000000_season_kpis.sql and
-- 20261016010000_session_plans.sql. Covers admin_start_season,
-- admin_set_season_archived, admin_end_squads_now, season_list,
-- returning_members, admin_place_members, admin_put_team_in_squad,
-- admin_set_team_members, admin_apply_team_template, club_team_template,
-- set_selections_complete, admin_set_club_captains, club_captain_choices,
-- is_club_captain, set_group_captains, admin_set_head_physio,
-- admin_set_physios_get_club_messages, physios_get_club_messages,
-- admin_set_member_title, admin_set_join_password, join_password_required,
-- admin_update_club_profile, club_profile, admin_save_playhq_season,
-- save_playhq_fixtures, my_verification_code, is_safeguarding_officer,
-- can_see_record_access, kpi_review_points and session_plan_coaches.
-- Rules checked: admin-only tools refuse everyone else; captains must be
-- athletes and are chosen by admins or the group's current coaches (not
-- stood-down or lapsed ones); club captaincy ends with the season; the join
-- password is never stored or returned in plain text; selections complete
-- ends the squad as a coaching group; a team's members must be in its squad;
-- safeguarding contacts are cleared adults; a child's access log is for
-- verified guardians (until 18) and admins. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Supabase grants table access to signed-in users and relies on row level
-- security; the local stubs don't, so do it here.
grant select on public.team_captains, public.club_captains to authenticated;
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
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.team(p_name text, p_season int) returns uuid language sql as
$$ select id from public.teams where name = p_name and season = p_season $$;
-- admin_update_club_profile with the given colours and features.
create or replace function pg_temp.save_club(p_colour text, p_features jsonb, p_logo text default null) returns void language sql as
$$ select public.admin_update_club_profile(' Sample Netball Club ', ' SNC ', p_colour, '#ffffff', null, p_logo, p_features) $$;

-- Two more sample people: an adult athlete in no squad (33) and someone who
-- has just signed up (34).
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000033', 'athlete.free@example.test', now()),
  ('00000000-0000-0000-0000-000000000034', 'new.member@example.test', now());
update public.profiles set status = 'approved', role = 'athlete', full_name = 'Lee Free',
  date_of_birth = current_date - interval '30 years', verified_at = now()
where id = '00000000-0000-0000-0000-000000000033';
update public.profiles set status = 'pending', role = 'athlete', full_name = 'Nico New'
where id = '00000000-0000-0000-0000-000000000034';

select pg_temp.ok('anon cannot start a season', has_function_privilege('anon', 'public.admin_start_season(integer)', 'execute'), false);
select pg_temp.ok('anon cannot read the club profile', has_function_privilege('anon', 'public.club_profile()', 'execute'), false);
select pg_temp.ok('anon cannot import fixtures', has_function_privilege('anon', 'public.save_playhq_fixtures(text, jsonb)', 'execute'), false);
select pg_temp.ok('anon cannot ask for a verification code', has_function_privilege('anon', 'public.my_verification_code()', 'execute'), false);
select pg_temp.ok('anon cannot set captains', has_function_privilege('anon', 'public.set_group_captains(uuid, uuid[], uuid[])', 'execute'), false);

-- ---------------------------------------------------------------------------
-- Club profile, password and settings
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.ok('members read the club profile', (select count(*) = 1 from public.club_profile()), true);
select pg_temp.ok('the club profile never returns the password hash', pg_get_function_result('public.club_profile()'::regprocedure) !~* 'password', true);
select pg_temp.ok('no join password at first', public.join_password_required(), false);
select pg_temp.ok('no starting setup chosen yet', public.club_team_template() is null, true);
select pg_temp.as_member('22');
select pg_temp.fails('committee cannot change club settings', $s$ select pg_temp.save_club('#123456', '{}') $s$);
select pg_temp.fails('committee cannot set the join password', $s$ select public.admin_set_join_password('secret') $s$);
select pg_temp.fails('committee cannot change physio messages', $s$ select public.admin_set_physios_get_club_messages(true) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('colours must be hex', $s$ select pg_temp.save_club('yellow', '{}') $s$);
select pg_temp.fails('features must be an object', $s$ select pg_temp.save_club('#123456', '[]') $s$);
select pg_temp.fails('features must be on or off', $s$ select pg_temp.save_club('#123456', '{"awards": "yes"}') $s$);
select pg_temp.fails('logo must be uploaded first', $s$ select pg_temp.save_club('#123456', '{}', 'logo.png') $s$);
insert into storage.objects (bucket_id, name) values ('club-branding', 'logo.png');
select pg_temp.works('admin saves the club profile', $s$ select pg_temp.save_club(' #ffcd00 ', '{"awards": true}', 'logo.png') $s$);
select pg_temp.as_member('32');
select pg_temp.ok('club profile shows the trimmed, upper-case settings', (select club_name = 'Sample Netball Club' and short_name = 'SNC' and background_colour = '#FFCD00' and text_colour = '#FFFFFF' and hero_colour is null and logo_path = 'logo.png' and features = '{"awards": true}' from public.club_profile()), true);

select pg_temp.as_member('01');
select pg_temp.works('admin sets the join password', $s$ select public.admin_set_join_password('  open sesame  ') $s$);
select pg_temp.ok('stored as a bcrypt hash of the trimmed password', (select join_password_hash like '$2a$10$%' and join_password_hash = extensions.crypt('open sesame', join_password_hash) and join_password_hash !~ 'sesame' from public.club_settings), true);
select pg_temp.as_member('34');
select pg_temp.ok('a new member sees a password is needed', public.join_password_required(), true);
select pg_temp.as_member('01');
select pg_temp.works('admin clears the join password', $s$ select public.admin_set_join_password('  ') $s$);
select pg_temp.ok('no password needed once cleared', public.join_password_required(), false);

select pg_temp.ok('physios don''t get club messages at first', public.physios_get_club_messages(), false);
select pg_temp.works('admin message to the club', $s$ select public.send_group_message('Club news one', 'club') $s$);
select pg_temp.ok('physio did not get it', exists (select 1 from public.message_recipients r join public.messages m on m.id = r.message_id where m.body = 'Club news one' and r.profile_id = pg_temp.m('14')), false);
select pg_temp.works('admin turns physio club messages on', $s$ select public.admin_set_physios_get_club_messages(true) $s$);
select pg_temp.ok('setting is on', public.physios_get_club_messages(), true);
select pg_temp.works('another admin message to the club', $s$ select public.send_group_message('Club news two', 'club') $s$);
select pg_temp.ok('physio got it', exists (select 1 from public.message_recipients r join public.messages m on m.id = r.message_id where m.body = 'Club news two' and r.profile_id = pg_temp.m('14')), true);
select pg_temp.works('admin turns it off again', $s$ select public.admin_set_physios_get_club_messages(null) $s$);
select pg_temp.ok('null turns it off', public.physios_get_club_messages(), false);

-- Titles and the Head Physio.
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot set titles', $s$ select public.admin_set_member_title('00000000-0000-0000-0000-000000000022', 'Secretary') $s$);
select pg_temp.fails('coach cannot set the Head Physio', $s$ select public.admin_set_head_physio('00000000-0000-0000-0000-000000000014', true) $s$);
select pg_temp.as_member('01');
select pg_temp.works('admin gives a committee member a title', $s$ select public.admin_set_member_title('00000000-0000-0000-0000-000000000022', ' Secretary ') $s$);
select pg_temp.ok('title saved trimmed', (select title = 'Secretary' from public.profiles where id = pg_temp.m('22')), true);
select pg_temp.fails('athletes have no title', $s$ select public.admin_set_member_title('00000000-0000-0000-0000-000000000031', 'Star') $s$);
select pg_temp.fails('title over 40 characters refused', format('select public.admin_set_member_title(%L, %L)', pg_temp.m('22'), repeat('x', 41)));
select pg_temp.fails('title for a missing member refused', $s$ select public.admin_set_member_title('00000000-0000-0000-0000-0000000000ee', 'Ghost') $s$);
select pg_temp.works('admin clears the title', $s$ select public.admin_set_member_title('00000000-0000-0000-0000-000000000022', '') $s$);
select pg_temp.ok('title cleared', (select title is null from public.profiles where id = pg_temp.m('22')), true);
select pg_temp.as_member('14');
select pg_temp.ok('squad physio does not look after an athlete outside their squad', public.physio_looks_after(pg_temp.m('33')), false);
select pg_temp.as_member('01');
select pg_temp.fails('only physios can be Head Physio', $s$ select public.admin_set_head_physio('00000000-0000-0000-0000-000000000011', true) $s$);
select pg_temp.fails('Head Physio for a missing member refused', $s$ select public.admin_set_head_physio('00000000-0000-0000-0000-0000000000ee', true) $s$);
select pg_temp.works('admin makes the physio Head Physio', $s$ select public.admin_set_head_physio('00000000-0000-0000-0000-000000000014', true) $s$);
select pg_temp.as_member('14');
select pg_temp.ok('Head Physio looks after every athlete', public.physio_looks_after(pg_temp.m('33')), true);
select pg_temp.as_member('01');
select pg_temp.works('admin takes Head Physio away', $s$ select public.admin_set_head_physio('00000000-0000-0000-0000-000000000014', false) $s$);
select pg_temp.ok('head physio flag cleared', (select not head_physio from public.profiles where id = pg_temp.m('14')), true);

-- ---------------------------------------------------------------------------
-- Small lookups
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.ok('approved members need no verification code', public.my_verification_code() is null, true);
select pg_temp.as_member('34');
select pg_temp.ok('a new member gets a 6-digit code', public.my_verification_code() ~ '^[0-9]{6}$', true);
select pg_temp.ok('asking again gives the same code', public.my_verification_code() = (select code from public.verification_codes where profile_id = pg_temp.m('34')), true);
select pg_temp.ok('code lasts 7 days', (select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute' from public.verification_codes where profile_id = pg_temp.m('34')), true);
update public.verification_codes set code = '000000', expires_at = now() - interval '1 minute' where profile_id = pg_temp.m('34');
select pg_temp.works('asking after the code expired', $s$ select public.my_verification_code() $s$);
select pg_temp.ok('the expired code is replaced with one lasting another 7 days', (select code ~ '^[0-9]{6}$' and expires_at > now() + interval '6 days' from public.verification_codes where profile_id = pg_temp.m('34')), true);

update public.safeguarding_settings set child_safety_officer_id = pg_temp.m('01'), complaints_manager_id = pg_temp.m('31');
select pg_temp.as_member('01');
select pg_temp.ok('the Child Safety Officer is a safeguarding officer', public.is_safeguarding_officer(), true);
select pg_temp.as_member('31');
select pg_temp.ok('an under-18 named as Complaints Manager is not', public.is_safeguarding_officer(), false);
select pg_temp.as_member('22');
select pg_temp.ok('a committee member not named is not', public.is_safeguarding_officer(), false);
update public.profiles set stood_down_at = now() where id = pg_temp.m('01');
select pg_temp.as_member('01');
select pg_temp.ok('a stood-down officer is not', public.is_safeguarding_officer(), false);
update public.profiles set stood_down_at = null, wwcc_expires_on = current_date - 1 where id = pg_temp.m('01');
select pg_temp.ok('an officer whose check lapsed is not', public.is_safeguarding_officer(), false);
update public.profiles set wwcc_expires_on = current_date + 400 where id = pg_temp.m('01');

select pg_temp.as_member('41');
select pg_temp.ok('verified guardian can see the child''s access log', public.can_see_record_access(pg_temp.m('31')), true);
select pg_temp.ok('guardian cannot see another member''s log', public.can_see_record_access(pg_temp.m('32')), false);
select pg_temp.as_member('01');
select pg_temp.ok('admin can see the child''s access log', public.can_see_record_access(pg_temp.m('31')), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach cannot see the child''s access log', public.can_see_record_access(pg_temp.m('31')), false);
select pg_temp.as_member('22');
select pg_temp.ok('committee cannot see the child''s access log', public.can_see_record_access(pg_temp.m('31')), false);
select pg_temp.as_member('31');
select pg_temp.ok('the child cannot see their own access log', public.can_see_record_access(pg_temp.m('31')), false);
update public.profiles set verified_at = null where id = pg_temp.m('41');
select pg_temp.as_member('41');
select pg_temp.ok('unverified guardian cannot see the log', public.can_see_record_access(pg_temp.m('31')), false);
update public.profiles set verified_at = now() where id = pg_temp.m('41');
update public.profiles set date_of_birth = current_date - interval '18 years', under_17 = false where id = pg_temp.m('31');
select pg_temp.ok('guardian cannot see the log once the child is 18', public.can_see_record_access(pg_temp.m('31')), false);
update public.profiles set date_of_birth = current_date - interval '14 years', under_17 = true where id = pg_temp.m('31');

insert into public.season_kpi_review_points (season, name, due_on) values
  (2026, 'Mid-season', current_date + 60), (2026, 'Preseason', current_date + 10), (2025, 'Old', current_date - 300);
select pg_temp.as_member('31');
select pg_temp.ok('review points for the season in date order', (select array_agg(name) = array['Preseason', 'Mid-season'] from public.kpi_review_points(2026)), true);
select pg_temp.as_member('34');
select pg_temp.ok('someone not approved sees no review points', (select count(*) = 0 from public.kpi_review_points(2026)), true);

select pg_temp.as_member('11');
select pg_temp.ok('coach sees the other coaches to share plans with', (select array_agg(profile_id order by profile_id) = array[pg_temp.m('12'), pg_temp.m('42')] from public.session_plan_coaches()), true);
select pg_temp.ok('coach list names their groups', (select groups = 'Sample Squad' from public.session_plan_coaches() where profile_id = pg_temp.m('42')), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin sees every coach', (select count(*) = 3 from public.session_plan_coaches()), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees no coach list', (select count(*) = 0 from public.session_plan_coaches()), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager sees no coach list', (select count(*) = 0 from public.session_plan_coaches()), true);
select pg_temp.as_member('12');
select pg_temp.ok('lapsed coach sees no coach list', (select count(*) = 0 from public.session_plan_coaches()), true);
update public.club_settings set features = features || '{"sessionPlans": false}';
select pg_temp.as_member('11');
select pg_temp.ok('no coach list with session plans off', (select count(*) = 0 from public.session_plan_coaches()), true);
update public.club_settings set features = features - 'sessionPlans';

-- ---------------------------------------------------------------------------
-- PlayHQ
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot add a PlayHQ competition', $s$ select public.admin_save_playhq_season('S1', 'Winter', 'https://playhq.test/s1', 2026, '[]') $s$);
select pg_temp.fails('coach cannot import fixtures', $s$ select public.save_playhq_fixtures('T1', '[]') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('competition needs an id', $s$ select public.admin_save_playhq_season(' ', 'Winter', 'https://playhq.test/s1', 2026, '[]') $s$);
select pg_temp.fails('teams must be a list', $s$ select public.admin_save_playhq_season('S1', 'Winter', 'https://playhq.test/s1', 2026, '{}') $s$);
select pg_temp.works('admin adds a competition and links a team', $s$ select public.admin_save_playhq_season('S1', ' ', 'https://playhq.test/s1', 2026, '[{"playhq_team_id": "T1", "playhq_name": "Sample A", "team_id": "00000000-0000-0000-0000-0000000000a2"}, {"playhq_team_id": "T2", "playhq_name": "Rivals", "team_id": ""}, {"playhq_team_id": "", "playhq_name": "Nameless"}]') $s$);
select pg_temp.ok('competition saved with a default name', (select name = 'PlayHQ competition' and season = 2026 from public.playhq_seasons where playhq_season_id = 'S1'), true);
select pg_temp.ok('two teams saved, the other club''s unlinked', (select count(*) = 2 and count(team_id) = 1 from public.playhq_teams), true);
select pg_temp.works('admin renames the competition', $s$ select public.admin_save_playhq_season('S1', 'Winter League', 'https://playhq.test/s1', 2026, '[{"playhq_team_id": "T1", "playhq_name": "Sample A", "team_id": "00000000-0000-0000-0000-0000000000a2"}]') $s$);
select pg_temp.ok('competition updated, not duplicated', (select count(*) = 1 and min(name) = 'Winter League' from public.playhq_seasons), true);
select pg_temp.fails('fixtures for an unlinked team refused', $s$ select public.save_playhq_fixtures('T2', '[]') $s$);
select pg_temp.ok('two games saved, one without an id skipped', public.save_playhq_fixtures('T1', '[{"id": "g1", "date": "2026-11-01", "time": "10:00", "round": "Round 1", "opponent": "Rockets", "venue": "Arena", "court": "2", "is_home": true}, {"id": "g2", "date": "2026-11-08", "time": "", "round": "Round 2", "opponent": ""}, {"date": "2026-11-15", "opponent": "Nobody"}]') = 2, true);
select pg_temp.ok('game saved at Perth time for the team', (select starts_at = '2026-11-01 10:00:00+08' and team_id = pg_temp.m('a2') and team_name = 'Sample Team' and opponent = 'Rockets' and venue = 'Arena' and is_home and not time_tbc from public.fixtures where playhq_game_id = 'g1'), true);
select pg_temp.ok('a game with no time or opponent is a bye with time to be set', (select time_tbc and opponent is null from public.fixtures where playhq_game_id = 'g2'), true);
select pg_temp.ok('import time recorded', (select imported_at is not null from public.playhq_seasons where playhq_season_id = 'S1'), true);
select pg_temp.ok('a changed time updates the game', public.save_playhq_fixtures('T1', '[{"id": "g1", "date": "2026-11-01", "time": "12:30", "timezone": "Australia/Sydney", "opponent": "Rockets"}]') = 1, true);
select pg_temp.ok('game moved, not duplicated', (select count(*) = 2 from public.fixtures) and (select starts_at = '2026-11-01 12:30:00+11' from public.fixtures where playhq_game_id = 'g1'), true);

-- ---------------------------------------------------------------------------
-- Captains
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot choose club captains', $s$ select public.admin_set_club_captains(2026, '{00000000-0000-0000-0000-000000000032}') $s$);
select pg_temp.ok('coach sees no captain choices', (select count(*) = 0 from public.club_captain_choices(2026)), true);
select pg_temp.as_member('01');
select pg_temp.fails('club captains need a current season', $s$ select public.admin_set_club_captains(2030, '{00000000-0000-0000-0000-000000000032}') $s$);
select pg_temp.fails('club captains must be athletes', $s$ select public.admin_set_club_captains(2026, '{00000000-0000-0000-0000-000000000011}') $s$);
select pg_temp.fails('club captains must be approved', $s$ select public.admin_set_club_captains(2026, '{00000000-0000-0000-0000-000000000034}') $s$);
select pg_temp.works('admin chooses two club captains', $s$ select public.admin_set_club_captains(2026, '{00000000-0000-0000-0000-000000000031,00000000-0000-0000-0000-000000000032}') $s$);
select pg_temp.works('admin drops one', $s$ select public.admin_set_club_captains(2026, '{00000000-0000-0000-0000-000000000032}') $s$);
select pg_temp.ok('one club captain left', (select array_agg(profile_id) = array[pg_temp.m('32')] from public.club_captains), true);
select pg_temp.ok('captain choices are the season''s athletes, flagged', (select array_agg(profile_id::text || ':' || is_captain || ':' || is_minor order by profile_id) = array[pg_temp.m('31') || ':false:true', pg_temp.m('32') || ':true:false'] from public.club_captain_choices(2026)), true);
select pg_temp.as_member('32');
select pg_temp.ok('club captain is one', public.is_club_captain(), true);
select pg_temp.works('club captain messages the whole club', $s$ select public.send_group_message('Captain''s run Sunday', 'club') $s$);
select pg_temp.as_member('31');
select pg_temp.ok('the dropped captain is not', public.is_club_captain(), false);
select pg_temp.fails('a non-captain athlete cannot message the club', $s$ select public.send_group_message('Hi all', 'club') $s$);

select pg_temp.as_member('31');
select pg_temp.fails('athlete cannot choose captains', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a1', '{00000000-0000-0000-0000-000000000031}'::uuid[], '{}'::uuid[]) $s$);
select pg_temp.as_member('13');
select pg_temp.fails('manager cannot choose captains', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a1', '{00000000-0000-0000-0000-000000000031}'::uuid[], '{}'::uuid[]) $s$);
select pg_temp.as_member('12');
select pg_temp.fails('lapsed coach cannot choose captains', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a1', '{00000000-0000-0000-0000-000000000031}'::uuid[], '{}'::uuid[]) $s$);
select pg_temp.as_member('42');
select pg_temp.fails('squad coach cannot choose a team''s captains', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a2', '{00000000-0000-0000-0000-000000000031}'::uuid[], '{}'::uuid[]) $s$);
select pg_temp.as_member('11');
select pg_temp.fails('captains must be athletes in the group', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a1', '{00000000-0000-0000-0000-000000000013}'::uuid[], '{}'::uuid[]) $s$);
select pg_temp.fails('an athlete outside the group cannot be captain', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a2', '{00000000-0000-0000-0000-000000000032}'::uuid[], '{}'::uuid[]) $s$);
select pg_temp.fails('nobody is captain and vice captain', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a1', '{00000000-0000-0000-0000-000000000031}'::uuid[], '{00000000-0000-0000-0000-000000000031}'::uuid[]) $s$);
select pg_temp.fails('missing group refused', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000ee', '{}'::uuid[], '{}'::uuid[]) $s$);
select pg_temp.works('coach chooses the squad''s captain and vice captain', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a1', '{00000000-0000-0000-0000-000000000032}'::uuid[], '{00000000-0000-0000-0000-000000000031}'::uuid[]) $s$);
select pg_temp.ok('captains saved', (select array_agg(profile_id::text || ':' || captain_role order by profile_id) = array[pg_temp.m('31') || ':vice_captain', pg_temp.m('32') || ':captain'] from public.team_captains where team_id = pg_temp.m('a1')), true);
select pg_temp.works('coach changes them', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a1', '{00000000-0000-0000-0000-000000000031,00000000-0000-0000-0000-000000000032}'::uuid[], '{}'::uuid[]) $s$);
select pg_temp.ok('two captains, no vice captain', (select count(*) = 2 and bool_and(captain_role = 'captain') from public.team_captains where team_id = pg_temp.m('a1')), true);
select pg_temp.as_member('31');
select pg_temp.ok('a group captain can message their group', public.can_message_group(pg_temp.m('a1')), true);
update public.profiles set stood_down_at = now() where id = pg_temp.m('11');
select pg_temp.as_member('11');
select pg_temp.fails('stood-down coach cannot choose captains', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a1', '{}'::uuid[], '{}'::uuid[]) $s$);
update public.profiles set stood_down_at = null where id = pg_temp.m('11');
select pg_temp.as_member('01');
select pg_temp.works('admin chooses the team''s captain', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a2', '{00000000-0000-0000-0000-000000000031}'::uuid[], '{}'::uuid[]) $s$);
set role authenticated;
select pg_temp.as_member('33');
select pg_temp.ok('someone outside the groups cannot see their captains', (select count(*) = 0 from public.team_captains), true);
select pg_temp.as_member('13');
select pg_temp.ok('a squad member sees the squad''s captains', (select count(*) = 2 from public.team_captains where team_id = pg_temp.m('a1')), true);
reset role;

-- ---------------------------------------------------------------------------
-- Selections and seasons
-- ---------------------------------------------------------------------------
insert into public.teams (id, name, kind, season, sort_order) values
  ('00000000-0000-0000-0000-0000000000a3', 'Empty Squad', 'squad', 2026, 3);
insert into public.calendars (name, url, team_id, color) values
  ('Squad training', 'https://calendar.example.test/squad.ics', '00000000-0000-0000-0000-0000000000a1', 'blue');

select pg_temp.as_member('11');
select pg_temp.ok('coach sees no season list', (select count(*) = 0 from public.season_list()), true);
select pg_temp.fails('coach cannot complete selections', $s$ select public.set_selections_complete('00000000-0000-0000-0000-0000000000a1', true) $s$);
select pg_temp.ok('before selections are complete the coach coaches the squad-only athlete', public.coaches_athlete(pg_temp.m('32')), true);
select pg_temp.as_member('01');
select pg_temp.ok('season list: 2026 with 2 squads and 1 team', (select array_agg(season || ':' || archived || ':' || squad_count || ':' || team_count) = array['2026:false:2:1'] from public.season_list()), true);
select pg_temp.fails('selections are for squads', $s$ select public.set_selections_complete('00000000-0000-0000-0000-0000000000a2', true) $s$);
select pg_temp.fails('a squad needs a team named first', $s$ select public.set_selections_complete('00000000-0000-0000-0000-0000000000a3', true) $s$);
select pg_temp.works('admin completes the squad''s selections', $s$ select public.set_selections_complete('00000000-0000-0000-0000-0000000000a1', true) $s$);
select pg_temp.ok('completed time and admin recorded', (select selections_completed_at is not null and selections_completed_by = pg_temp.m('01') from public.teams where id = pg_temp.m('a1')), true);
select pg_temp.as_member('11');
select pg_temp.ok('after selections the coach no longer coaches the squad-only athlete', public.coaches_athlete(pg_temp.m('32')), false);
select pg_temp.ok('but still coaches their team''s athlete', public.coaches_athlete(pg_temp.m('31')), true);
select pg_temp.as_member('01');
select pg_temp.works('admin undoes it', $s$ select public.set_selections_complete('00000000-0000-0000-0000-0000000000a1', false) $s$);
select pg_temp.ok('undone', (select selections_completed_at is null and selections_completed_by is null from public.teams where id = pg_temp.m('a1')), true);

-- Starting 2027.
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot start a season', $s$ select public.admin_start_season(2027) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('admin cannot archive the only season', $s$ select public.admin_set_season_archived(2026, true) $s$);
select pg_temp.fails('only the next season can start', $s$ select public.admin_start_season(2028) $s$);
select pg_temp.ok('starting 2027 copies the two squads', public.admin_start_season(2027) = 2, true);
select pg_temp.ok('new squads are empty, the team is not copied', (select count(*) = 2 and bool_and(kind = 'squad') from public.teams where season = 2027) and not exists (select 1 from public.team_members tm join public.teams t on t.id = tm.team_id where t.season = 2027), true);
select pg_temp.ok('squad calendar copied to the new squad', (select count(*) = 1 from public.calendars where team_id = pg_temp.team('Sample Squad', 2027)), true);
select pg_temp.fails('the same season cannot start twice', $s$ select public.admin_start_season(2027) $s$);
select pg_temp.ok('season list shows both seasons, newest first', (select array_agg(season) = array[2027, 2026] from public.season_list()), true);

-- Returning members and placing them.
select pg_temp.ok('everyone in last season''s squad is returning', (select count(*) = 7 from public.returning_members(pg_temp.team('Sample Squad', 2027))), true);
select pg_temp.ok('returning junior''s last squad is shown', (select last_squad_name = 'Sample Squad' and role = 'athlete' from public.returning_members(pg_temp.team('Sample Squad', 2027)) where profile_id = pg_temp.m('31')), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees no returning members', (select count(*) = 0 from public.returning_members(pg_temp.team('Sample Squad', 2027))), true);
select pg_temp.fails('coach cannot place members', format('select public.admin_place_members(%L, %L)', pg_temp.team('Sample Squad', 2027), array[pg_temp.m('31')]));
select pg_temp.as_member('01');
select pg_temp.fails('placing into a team in a squad refused', format('select public.admin_place_members(%L, %L)', pg_temp.m('a2'), array[pg_temp.m('31')]));
select pg_temp.fails('placing into a missing squad refused', format('select public.admin_place_members(%L, %L)', pg_temp.m('ee'), array[pg_temp.m('31')]));
select pg_temp.ok('admin places three, a pending member is skipped', public.admin_place_members(pg_temp.team('Sample Squad', 2027), array[pg_temp.m('31'), pg_temp.m('11'), pg_temp.m('14'), pg_temp.m('34')]) = 3, true);
select pg_temp.ok('placed with last season''s roles and coach title', (select array_agg(profile_id::text || ':' || team_role || ':' || coalesce(coach_title::text, '-') order by profile_id) = array[pg_temp.m('11') || ':coach:head_coach', pg_temp.m('14') || ':physio:-', pg_temp.m('31') || ':athlete:-'] from public.team_members where team_id = pg_temp.team('Sample Squad', 2027)), true);
select pg_temp.ok('placing again adds nobody', public.admin_place_members(pg_temp.team('Sample Squad', 2027), array[pg_temp.m('31')]) = 0, true);
select pg_temp.ok('placed members are no longer returning', (select count(*) = 4 from public.returning_members(pg_temp.team('Sample Squad', 2027))), true);

-- Naming a team from the new squad.
insert into public.teams (id, name, kind, season, squad_id, sort_order) values
  ('00000000-0000-0000-0000-0000000000b7', 'New Team', 'team', 2027, (select id from public.teams where name = 'Sample Squad' and season = 2027), 4);
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot name teams', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000b7', '[]') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('members must be a list', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000b7', '{}') $s$);
select pg_temp.fails('naming a missing team refused', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000ee', '[]') $s$);
select pg_temp.fails('team members must be in its squad', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000b7', '[{"profile_id": "00000000-0000-0000-0000-000000000032"}]') $s$);
select pg_temp.works('admin names the team', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000b7', '[{"profile_id": "00000000-0000-0000-0000-000000000031", "selection": "training_partner"}, {"profile_id": "00000000-0000-0000-0000-000000000011", "coach_title": "assistant_coach"}]') $s$);
select pg_temp.ok('team members take their squad roles', (select array_agg(profile_id::text || ':' || team_role || ':' || coalesce(selection::text, coach_title::text) order by profile_id) = array[pg_temp.m('11') || ':coach:assistant_coach', pg_temp.m('31') || ':athlete:training_partner'] from public.team_members where team_id = pg_temp.m('b7')), true);
select pg_temp.works('admin names it again with just the athlete', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000b7', '[{"profile_id": "00000000-0000-0000-0000-000000000031"}]') $s$);
select pg_temp.ok('team replaced, athlete touring by default', (select count(*) = 1 and bool_and(selection = 'touring') from public.team_members where team_id = pg_temp.m('b7')), true);

-- A team with no squad, which then joins one.
insert into public.teams (id, name, kind, season, sort_order) values
  ('00000000-0000-0000-0000-0000000000a4', 'Solo Team', 'team', 2026, 5);
select pg_temp.fails('only approved coaches, managers, physios and athletes join a team', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a4', '[{"profile_id": "00000000-0000-0000-0000-000000000041"}]') $s$);
select pg_temp.fails('a pending member cannot join a team', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a4', '[{"profile_id": "00000000-0000-0000-0000-000000000034"}]') $s$);
select pg_temp.fails('a role the member doesn''t hold refused', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a4', '[{"profile_id": "00000000-0000-0000-0000-000000000033", "team_role": "coach"}]') $s$);
select pg_temp.works('admin names a team with no squad from the whole club', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a4', '[{"profile_id": "00000000-0000-0000-0000-000000000033"}, {"profile_id": "00000000-0000-0000-0000-000000000013"}]') $s$);
select pg_temp.ok('solo team has the athlete and the manager', (select array_agg(profile_id::text || ':' || team_role order by profile_id) = array[pg_temp.m('13') || ':manager', pg_temp.m('33') || ':athlete'] from public.team_members where team_id = pg_temp.m('a4')), true);
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot put a team in a squad', $s$ select public.admin_put_team_in_squad('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('a team already in a squad refused', $s$ select public.admin_put_team_in_squad('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3') $s$);
select pg_temp.fails('a squad from another season refused', format('select public.admin_put_team_in_squad(%L, %L)', pg_temp.m('a4'), pg_temp.team('Sample Squad', 2027)));
select pg_temp.fails('a team is not a squad', $s$ select public.admin_put_team_in_squad('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a2') $s$);
select pg_temp.works('admin puts the team in the squad', $s$ select public.admin_put_team_in_squad('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1') $s$);
select pg_temp.ok('team now in the squad', (select squad_id = pg_temp.m('a1') from public.teams where id = pg_temp.m('a4')), true);
select pg_temp.ok('its athlete was added to the squad', exists (select 1 from public.team_members where team_id = pg_temp.m('a1') and profile_id = pg_temp.m('33') and team_role = 'athlete'), true);

-- Archiving last season.
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot archive a season', $s$ select public.admin_set_season_archived(2026, true) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('the newest season cannot be archived', $s$ select public.admin_set_season_archived(2027, true) $s$);
select pg_temp.works('admin archives 2026', $s$ select public.admin_set_season_archived(2026, true) $s$);
select pg_temp.ok('every 2026 squad and team archived, 2027 not', (select bool_and(archived = (season = 2026)) from public.teams), true);
select pg_temp.ok('season list shows 2026 archived', (select archived from public.season_list() where season = 2026), true);
select pg_temp.ok('memberships kept', (select count(*) > 0 from public.team_members where team_id = pg_temp.m('a1')), true);
select pg_temp.as_member('32');
select pg_temp.ok('club captaincy ends with the season', public.is_club_captain(), false);
select pg_temp.as_member('11');
select pg_temp.fails('archived group''s captains cannot change', $s$ select public.set_group_captains('00000000-0000-0000-0000-0000000000a1', '{}'::uuid[], '{}'::uuid[]) $s$);
select pg_temp.as_member('01');
select pg_temp.works('admin brings 2026 back', $s$ select public.admin_set_season_archived(2026, false) $s$);
select pg_temp.as_member('32');
select pg_temp.ok('captaincy is back with the season', public.is_club_captain(), true);

-- Turning squads off.
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot end squads', $s$ select public.admin_end_squads_now() $s$);
select pg_temp.as_member('01');
select pg_temp.fails('squads must be switched off first', $s$ select public.admin_end_squads_now() $s$);
select pg_temp.works('admin switches squads off', $s$ select pg_temp.save_club('#ffcd00', '{"squads": false}', 'logo.png') $s$);
select pg_temp.ok('squads off', public.club_uses_squads(), false);
select pg_temp.ok('ending squads frees the three named teams', public.admin_end_squads_now() = 3, true);
select pg_temp.ok('teams keep their old squad and stand alone', (select bool_and(squad_id is null and former_squad_id is not null) from public.teams where id in (pg_temp.m('a2'), pg_temp.m('a4'), pg_temp.m('b7'))), true);
select pg_temp.ok('every squad archived', (select bool_and(archived) from public.teams where kind = 'squad'), true);
select pg_temp.ok('team memberships kept', (select count(*) = 2 from public.team_members where team_id = pg_temp.m('a2')), true);

-- Starting setups only for a club with no squads or teams.
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot choose a starting setup', $s$ select public.admin_apply_team_template('wanl') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('unknown setup refused', $s$ select public.admin_apply_team_template('nba') $s$);
select pg_temp.fails('a club with teams cannot start over', $s$ select public.admin_apply_team_template('blank') $s$);
update public.teams set archived = true;
select pg_temp.works('admin chooses the WA Netball League setup', $s$ select public.admin_apply_team_template('wanl') $s$);
select pg_temp.ok('four teams with no squads', (select count(*) = 4 and bool_and(kind = 'team' and squad_id is null) from public.teams where not archived), true);
select pg_temp.ok('squads switched off and the setup remembered', not public.club_uses_squads() and public.club_team_template() = 'wanl', true);
select pg_temp.fails('the setup cannot be applied twice', $s$ select public.admin_apply_team_template('wanl') $s$);
