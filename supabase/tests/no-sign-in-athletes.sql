-- Tests for 20261120000000_no_sign_in_athletes.sql: athletes who never sign
-- in, run by their parent or guardian (Matt, 19 November 2026).
--
-- A parent asks for their child to be added; only an admin adds the child,
-- only for a verified parent, linked to that parent in the same step. The
-- child can't sign in, may be under 13, and is only ever an athlete. Their
-- parent acts for them (consent, absences, injuries, surveys); coaches see
-- them on registers but not on the check-in or game goals boards; they don't
-- vote in awards; read receipts follow their parents' copies.
--
-- New people: 71 asks to join as a parent (Taylor Parent), 72 asks to join
-- as a coach, 73 has signed in but not asked to join. Sam Small (10) is
-- Taylor's child who won't use the app; Riley Rookie (15) is Logan's (41).
-- Jamie Solo (74) is a parent who deletes their account, leaving Robin Solo.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails_with(label text, statement text, expected text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like expected then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;

create temp table ids (k text primary key, v uuid);
grant all on ids to public;
create or replace function pg_temp.v(key text) returns uuid language sql as
$$ select v from ids where k = key $$;

insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('71'), 'taylor.parent@example.test', now()),
  (pg_temp.id('72'), 'quinn.coach@example.test', now()),
  (pg_temp.id('73'), 'not.asked@example.test', now());
update public.profiles p
set full_name = v.name, requested_role = v.role::public.app_role, join_requested_at = now(),
    playhq_email = v.email, declared_date_of_birth = public.club_today() - interval '40 years'
from (values
  ('71', 'Taylor Parent', 'guardian', 'taylor.parent@example.test'),
  ('72', 'Quinn Coach', 'coach', 'quinn.coach@example.test')
) as v(n, name, role, email)
where p.id = pg_temp.id(v.n);

-- Every sample member as they are now, to show nobody already in the club is changed.
create temp table seed_before as
select id, status, role, extra_roles, date_of_birth, under_17, full_name, no_sign_in
from public.profiles where id not in (pg_temp.id('71'), pg_temp.id('72'), pg_temp.id('73'));
grant select on seed_before to public;

select pg_temp.ok('nobody already in the club is a no-app athlete',
  not exists (select 1 from public.profiles where no_sign_in), true);
select pg_temp.ok('members can ask for a child', has_function_privilege('authenticated', 'public.request_no_app_child(text, date, uuid)', 'execute'), true);
select pg_temp.ok('anon cannot ask for a child', has_function_privilege('anon', 'public.request_no_app_child(text, date, uuid)', 'execute'), false);
select pg_temp.ok('anon cannot add a child', has_function_privilege('anon', 'public.admin_add_no_app_child(uuid, text, date, uuid[], uuid)', 'execute'), false);
select pg_temp.ok('anon cannot answer for a child', has_function_privilege('anon', 'public.submit_survey_response_for_child(uuid, uuid, jsonb, boolean)', 'execute'), false);
select pg_temp.ok('signed-in members cannot read requests directly',
  has_table_privilege('authenticated', 'public.no_app_child_requests', 'select'), false);
select pg_temp.ok('signed-in members cannot write requests directly',
  has_table_privilege('authenticated', 'public.no_app_child_requests', 'insert'), false);
select pg_temp.ok('members cannot mark themselves as having no sign-in',
  has_column_privilege('authenticated', 'public.profiles', 'no_sign_in', 'update'), false);

-- ---------------------------------------------------------------------------
-- Asking for a child
-- ---------------------------------------------------------------------------
select pg_temp.as_member('71');
select pg_temp.fails_with('a name is needed', $s$ select public.request_no_app_child('  ', (public.club_today() - interval '10 years')::date, null) $s$, '%child’s name%');
select pg_temp.fails_with('a date of birth is needed', $s$ select public.request_no_app_child('Sam Small', null, null) $s$, '%doesn''t look right%');
select pg_temp.fails_with('a date in the future is refused', $s$ select public.request_no_app_child('Sam Small', public.club_today() + 1, null) $s$, '%doesn''t look right%');
select pg_temp.fails_with('an adult is refused', $s$ select public.request_no_app_child('Sam Small', (public.club_today() - interval '18 years')::date, null) $s$, '%under 18%');
select pg_temp.fails_with('an unknown team is refused', $s$ select public.request_no_app_child('Sam Small', (public.club_today() - interval '10 years')::date, gen_random_uuid()) $s$, '%this season''s%');
select pg_temp.works('a parent asking to join asks for their child under 13',
  $s$ insert into ids values ('req', public.request_no_app_child(' Sam Small ', (public.club_today() - interval '10 years')::date, '00000000-0000-0000-0000-0000000000a2')) $s$);
select pg_temp.fails_with('the same child twice is refused', $s$ select public.request_no_app_child('sam small', (public.club_today() - interval '10 years')::date, null) $s$, '%already asked for%');
select pg_temp.ok('the parent sees their request, name trimmed, with the team',
  (select full_name = 'Sam Small' and team_name = 'Sample Team' from public.my_no_app_child_requests()), true);
select pg_temp.works('they can ask for another and withdraw it',
  $s$ select public.withdraw_no_app_child_request(public.request_no_app_child('Alex Small', (public.club_today() - interval '8 years')::date, null)) $s$);
select pg_temp.ok('one request left', (select count(*) = 1 from public.my_no_app_child_requests()), true);

select pg_temp.as_member('41');
select pg_temp.fails_with('another parent cannot withdraw it', format($s$ select public.withdraw_no_app_child_request(%L) $s$, pg_temp.v('req')), 'Request not found');
select pg_temp.ok('and does not see it', (select count(*) = 0 from public.my_no_app_child_requests()), true);
select pg_temp.fails_with('a parent cannot list everyone''s requests', $s$ select * from public.admin_no_app_child_requests() $s$, 'Only admins%');
select pg_temp.as_member('31');
select pg_temp.fails_with('a child cannot ask', $s$ select public.request_no_app_child('Pat Small', (public.club_today() - interval '9 years')::date, null) $s$, 'Ask to join as a parent or guardian first');
select pg_temp.as_member('73');
select pg_temp.fails_with('someone who hasn''t asked to join cannot ask', $s$ select public.request_no_app_child('Pat Small', (public.club_today() - interval '9 years')::date, null) $s$, 'Ask to join as a parent or guardian first');
select pg_temp.as_member('72');
select pg_temp.fails_with('someone asking to join as a coach cannot ask', $s$ select public.request_no_app_child('Pat Small', (public.club_today() - interval '9 years')::date, null) $s$, 'Ask to join as a parent or guardian first');
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach cannot list requests', $s$ select * from public.admin_no_app_child_requests() $s$, 'Only admins%');
select pg_temp.fails_with('a coach cannot turn one down', format($s$ select public.admin_decline_no_app_child_request(%L) $s$, pg_temp.v('req')), 'Only admins%');
select pg_temp.as_member('01');
select pg_temp.ok('an admin sees the request on the parent''s page',
  (select count(*) = 1 from public.admin_no_app_child_requests(pg_temp.id('71')) where full_name = 'Sam Small'), true);

-- ---------------------------------------------------------------------------
-- Adding the child
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach cannot add a child', format($s$ select public.admin_add_no_app_child(%L, 'Sam Small', (public.club_today() - interval '10 years')::date, '{}', null) $s$, pg_temp.id('71')), 'Only admins%');
select pg_temp.as_member('41');
select pg_temp.fails_with('a parent cannot add a child themselves', format($s$ select public.admin_add_no_app_child(%L, 'Sam Small', (public.club_today() - interval '10 years')::date, '{}', null) $s$, pg_temp.id('41')), 'Only admins%');
select pg_temp.as_member('01');
select pg_temp.fails_with('not before the parent is verified', format($s$ select public.admin_add_no_app_child(%L, 'Sam Small', (public.club_today() - interval '10 years')::date, '{}', null) $s$, pg_temp.id('71')), 'Verify who they are%');
update public.profiles set verified_at = now(), verification_method = 'playhq' where id = pg_temp.id('71');
select pg_temp.fails_with('approving the parent first says to add their child', format($s$ select public.admin_save_member(%L, 'guardian', 'approved') $s$, pg_temp.id('71')), '%won’t use the app first%');
select pg_temp.fails_with('an admin cannot add their own child', format($s$ select public.admin_add_no_app_child(%L, 'Sam Small', (public.club_today() - interval '10 years')::date, '{}', null) $s$, pg_temp.id('01')), '%own child%');
update public.profiles set verified_at = now() where id = pg_temp.id('72');
select pg_temp.fails_with('not for someone asking to join as a coach', format($s$ select public.admin_add_no_app_child(%L, 'Pat Small', (public.club_today() - interval '9 years')::date, '{}', null) $s$, pg_temp.id('72')), '%as a parent or guardian%');
select pg_temp.fails_with('not for an athlete', format($s$ select public.admin_add_no_app_child(%L, 'Pat Small', (public.club_today() - interval '9 years')::date, '{}', null) $s$, pg_temp.id('32')), '%as a parent or guardian%');
select pg_temp.fails_with('not an adult', format($s$ select public.admin_add_no_app_child(%L, 'Pat Small', (public.club_today() - interval '18 years')::date, '{}', null) $s$, pg_temp.id('71')), '%under 18%');
select pg_temp.fails_with('not without a date of birth', format($s$ select public.admin_add_no_app_child(%L, 'Pat Small', null, '{}', null) $s$, pg_temp.id('71')), '%date of birth%');
select pg_temp.fails_with('not without a name', format($s$ select public.admin_add_no_app_child(%L, '', (public.club_today() - interval '9 years')::date, '{}', null) $s$, pg_temp.id('71')), '%child’s name%');
select pg_temp.fails_with('not into an unknown team', format($s$ select public.admin_add_no_app_child(%L, 'Pat Small', (public.club_today() - interval '9 years')::date, array[gen_random_uuid()], null) $s$, pg_temp.id('71')), '%this season''s%');
select pg_temp.fails_with('not with another parent''s request', format($s$ select public.admin_add_no_app_child(%L, 'Pat Small', (public.club_today() - interval '9 years')::date, '{}', %L) $s$, pg_temp.id('41'), pg_temp.v('req')), 'Request not found');
select pg_temp.ok('nothing was added by the refusals', not exists (select 1 from public.profiles where no_sign_in), true);

select pg_temp.works('an admin adds Sam (10) to Sample Team from the request',
  format($s$ insert into ids values ('sam', public.admin_add_no_app_child(%L, 'Sam Small', (public.club_today() - interval '10 years')::date, array['00000000-0000-0000-0000-0000000000a2']::uuid[], %L)) $s$,
    pg_temp.id('71'), pg_temp.v('req')));
select pg_temp.ok('Sam is an approved athlete with no sign-in',
  (select status = 'approved' and role = 'athlete' and extra_roles = '{}' and no_sign_in and email is null
     and full_name = 'Sam Small' and date_of_birth = (public.club_today() - interval '10 years')::date
   from public.profiles where id = pg_temp.v('sam')), true);
select pg_temp.ok('Sam''s sign-in record has no email and sign-in is blocked',
  (select email is null and banned_until = 'infinity' and (raw_app_meta_data ->> 'no_sign_in')::boolean
   from auth.users where id = pg_temp.v('sam')), true);
select pg_temp.ok('Sam is in Sample Team and its squad as an athlete',
  (select array_agg(team_id::text order by team_id::text) from public.team_members where profile_id = pg_temp.v('sam') and team_role = 'athlete')
    = array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2'], true);
select pg_temp.ok('Taylor is linked to Sam', exists (select 1 from public.guardianships where guardian_id = pg_temp.id('71') and athlete_id = pg_temp.v('sam')), true);
select pg_temp.ok('the link''s history says why',
  exists (select 1 from public.guardianship_history where athlete_id = pg_temp.v('sam') and change = 'linked' and reason like 'Added by an admin as a child who won’t use the app'), true);
select pg_temp.ok('Taylor is approved as a parent or guardian with them',
  (select status = 'approved' and role = 'guardian' from public.profiles where id = pg_temp.id('71')), true);
select pg_temp.ok('Taylor follows Sam into the squad and team',
  (select count(*) = 2 from public.team_members where profile_id = pg_temp.id('71') and team_role = 'guardian'), true);
select pg_temp.ok('Sam is not locked: a verified parent is linked', public.is_locked_child(pg_temp.v('sam')), false);
select pg_temp.ok('the request is gone', not exists (select 1 from public.no_app_child_requests where id = pg_temp.v('req')), true);

select pg_temp.works('an admin adds Riley (15) for Logan, already approved, with no request',
  format($s$ insert into ids values ('riley', public.admin_add_no_app_child(%L, 'Riley Rookie', (public.club_today() - interval '15 years')::date, '{}', null)) $s$, pg_temp.id('41')));
select pg_temp.ok('Logan keeps his role and approval',
  (select status = 'approved' and role = 'guardian' from public.profiles where id = pg_temp.id('41')), true);
select pg_temp.ok('Logan is linked to Riley', exists (select 1 from public.guardianships where guardian_id = pg_temp.id('41') and athlete_id = pg_temp.v('riley')), true);

-- An approved parent's request, turned down.
select pg_temp.as_member('41');
insert into ids values ('req2', public.request_no_app_child('Robin Rookie', (public.club_today() - interval '12 years')::date, null));
select pg_temp.as_member('01');
select pg_temp.works('an admin turns a request down', format($s$ select public.admin_decline_no_app_child_request(%L) $s$, pg_temp.v('req2')));
select pg_temp.as_member('41');
select pg_temp.ok('the parent''s request is gone', (select count(*) = 0 from public.my_no_app_child_requests()), true);

-- ---------------------------------------------------------------------------
-- Saving a no-app child afterwards
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('an admin saves Sam again, under 13, with a guardian linked',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved', '[{"team_id":"00000000-0000-0000-0000-0000000000a1"}]', false, array[%L]::uuid[]) $s$, pg_temp.v('sam'), pg_temp.id('71')));
select pg_temp.works('and approves Sam again after taking them off',
  format($s$ select public.admin_save_member(%L, 'athlete', 'pending'); select public.admin_save_member(%L, 'athlete', 'approved', '[{"team_id":"00000000-0000-0000-0000-0000000000a1"},{"team_id":"00000000-0000-0000-0000-0000000000a2"}]', false, array[%L]::uuid[]) $s$,
    pg_temp.v('sam'), pg_temp.v('sam'), pg_temp.id('71')));
select pg_temp.fails_with('Sam can''t be given another role', format($s$ select public.admin_save_member(%L, 'athlete', 'approved', '[]', false, array[%L]::uuid[], null, '{guest}') $s$, pg_temp.v('sam'), pg_temp.id('71')), '%can only be an athlete%');
select pg_temp.fails_with('or made a guardian', format($s$ select public.admin_save_member(%L, 'guardian', 'approved') $s$, pg_temp.v('sam')), '%can only be an athlete%');
update public.profiles set date_of_birth = public.club_today() - interval '10 years', full_name = 'Not Asked' where id = pg_temp.id('73');
select pg_temp.fails_with('an under 13 who signs in can''t be approved', format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('73')), '%under 13%');
select pg_temp.ok('Sam can''t ask for children: they never sign in',
  (select set_config('request.jwt.claim.sub', pg_temp.v('sam')::text, false) is not null and not public.can_ask_for_child()), true);
select pg_temp.as_member('01');

-- ---------------------------------------------------------------------------
-- The parent acts for the child
-- ---------------------------------------------------------------------------
select pg_temp.as_member('71');
select pg_temp.ok('Taylor is Sam''s guardian', public.is_guardian_of(pg_temp.v('sam')), true);
select pg_temp.works('Taylor gives consent for Sam', format($s$ select public.set_child_consent(%L, true, true) $s$, pg_temp.v('sam')));
select pg_temp.ok('the consent counts', public.has_child_consent(pg_temp.v('sam'), 'health') and public.has_child_consent(pg_temp.v('sam'), 'data'), true);
select pg_temp.works('Taylor reports an absence for Sam',
  format($s$ select public.report_absence(%L, public.club_today() + 3, public.club_today() + 4, (select id from public.absence_categories where name = 'Planned holidays'), 'Away') $s$, pg_temp.v('sam')));
select pg_temp.works('Taylor reports an injury for Sam',
  format($s$ select public.report_injury(%L, 'Wrist', 'Fell at school', public.club_today() - 1, 'No catching', public.club_today() + 14, false) $s$, pg_temp.v('sam')));
select pg_temp.as_member('41');
select pg_temp.ok('Logan is not Sam''s guardian', public.is_guardian_of(pg_temp.v('sam')), false);
select pg_temp.works('Logan gives consent for Jordan, who has the app', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true) $s$);
select pg_temp.fails_with('Logan cannot consent for Sam', format($s$ select public.set_child_consent(%L, true, true) $s$, pg_temp.v('sam')), '%');
select pg_temp.fails_with('Logan cannot report an injury for Sam',
  format($s$ select public.report_injury(%L, 'Wrist', 'x', public.club_today() - 1, null, public.club_today() + 14, false) $s$, pg_temp.v('sam')), '%');

-- ---------------------------------------------------------------------------
-- What coaches see
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.ok('the coach sees Sam on the squad''s members',
  exists (select 1 from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a2' and profile_id = pg_temp.v('sam')), true);
select pg_temp.ok('Sam is not on the check-in board, even with consent',
  exists (select 1 from public.check_in_board('00000000-0000-0000-0000-0000000000a2', public.club_today()) where athlete_id = pg_temp.v('sam')), false);
select pg_temp.ok('Jordan, with consent, still is on the check-in board', exists (select 1 from public.check_in_board('00000000-0000-0000-0000-0000000000a2', public.club_today()) where athlete_id = pg_temp.id('31')), true);
select pg_temp.ok('Sam is not on the game goals board', exists (select 1 from public.goal_board() where athlete_id = pg_temp.v('sam')), false);
select pg_temp.ok('Jordan still is on the game goals board', exists (select 1 from public.goal_board() where athlete_id = pg_temp.id('31')), true);

insert into public.awards (id, season, name, closes_at, voter_roles) values
  ('f0000000-0000-0000-0000-0000000000a1', 2026, 'Club favourite', now() + interval '1 week', '{member}');
select pg_temp.ok('Sam does not vote in awards',
  pg_temp.v('sam') in (select public.award_voters('f0000000-0000-0000-0000-0000000000a1', null)), false);
select pg_temp.ok('Jordan still does',
  pg_temp.id('31') in (select public.award_voters('f0000000-0000-0000-0000-0000000000a1', null)), true);

-- Read receipts: Sam is read once Taylor reads their copy.
insert into ids values ('msg', public.send_group_message('Bring water', 'group', null, '00000000-0000-0000-0000-0000000000a2'));
select pg_temp.ok('Sam''s receipt says no app, and isn''t read yet',
  (select full_name = 'Sam Small (no app, parents copied)' and read_at is null from public.message_receipts(pg_temp.v('msg')) where profile_id = pg_temp.v('sam')), true);
select pg_temp.ok('Jordan''s receipt is unchanged',
  (select full_name = 'Jordan Junior' from public.message_receipts(pg_temp.v('msg')) where profile_id = pg_temp.id('31')), true);
select pg_temp.ok('Taylor gets a copy for Sam',
  exists (select 1 from public.message_recipients where message_id = pg_temp.v('msg') and profile_id = pg_temp.id('71')), true);
select pg_temp.as_member('71');
select public.mark_message_read(pg_temp.v('msg'));
select pg_temp.as_member('11');
select pg_temp.ok('once Taylor reads it, Sam shows as read',
  (select read_at is not null from public.message_receipts(pg_temp.v('msg')) where profile_id = pg_temp.v('sam')), true);

-- ---------------------------------------------------------------------------
-- Surveys: a parent answers for a no-app child, and only for them
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
insert into ids values ('survey', public.create_survey(
  'Kit sizes', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"choice","prompt":"Size?","options":["Small","Medium"]}]'));
create temp table answer as
select jsonb_build_array(jsonb_build_object('question_id', q ->> 'id', 'choices', jsonb_build_array(0))) a
from jsonb_array_elements(public.survey_detail(pg_temp.v('survey')) -> 'questions') q;
grant select on answer to public;

select pg_temp.as_member('71');
select pg_temp.ok('Taylor can answer for Sam',
  public.survey_detail(pg_temp.v('survey')) -> 'answer_for' = jsonb_build_array(jsonb_build_object('id', pg_temp.v('sam'), 'name', 'Sam Small')), true);
select pg_temp.fails_with('but not as their own answer', $s$ select public.submit_survey_response(pg_temp.v('survey'), (select a from answer), false) $s$, '%for your child to answer%');
select pg_temp.as_member('41');
select pg_temp.ok('Logan can answer for nobody: Jordan has the app',
  public.survey_detail(pg_temp.v('survey')) -> 'answer_for' = '[]'::jsonb, true);
select pg_temp.fails_with('Logan cannot answer for Jordan', format($s$ select public.submit_survey_response_for_child(pg_temp.v('survey'), %L, (select a from answer), false) $s$, pg_temp.id('31')), '%for your child to answer%');
select pg_temp.fails_with('Logan cannot answer for Sam', format($s$ select public.submit_survey_response_for_child(pg_temp.v('survey'), %L, (select a from answer), false) $s$, pg_temp.v('sam')), 'Survey not found');
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach cannot answer for Sam', format($s$ select public.submit_survey_response_for_child(pg_temp.v('survey'), %L, (select a from answer), false) $s$, pg_temp.v('sam')), 'Survey not found');
select pg_temp.as_member('71');
select pg_temp.works('Taylor answers for Sam', format($s$ select public.submit_survey_response_for_child(pg_temp.v('survey'), %L, (select a from answer), false) $s$, pg_temp.v('sam')));
select pg_temp.ok('Taylor is still themselves afterwards', auth.uid() = pg_temp.id('71'), true);
select pg_temp.ok('Sam''s copy is answered', (select responded from public.survey_recipients where survey_id = pg_temp.v('survey') and profile_id = pg_temp.v('sam')), true);
select pg_temp.ok('the answer is Sam''s, naming Taylor',
  (select respondent_name from public.survey_responses where survey_id = pg_temp.v('survey') and respondent_id = pg_temp.v('sam')) = 'Sam Small (answered by Taylor Parent)', true);
select pg_temp.ok('nothing is left to answer for Sam', public.survey_detail(pg_temp.v('survey')) -> 'answer_for' = '[]'::jsonb, true);
select pg_temp.ok('Taylor reads Sam''s answers', jsonb_array_length(public.survey_detail(pg_temp.v('survey')) -> 'children' -> 0 -> 'answers') = 1, true);
select pg_temp.fails_with('Taylor cannot answer twice', format($s$ select public.submit_survey_response_for_child(pg_temp.v('survey'), %L, (select a from answer), false) $s$, pg_temp.v('sam')), '%already answered%');

-- ---------------------------------------------------------------------------
-- The last parent goes: the child is kept, locked, as any child would be
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('an admin unlinks Taylor from Sam', format($s$ select public.admin_save_member(%L, 'athlete', 'approved', '[]', false, '{}', null, '{}', 'Testing') $s$, pg_temp.v('sam')));
select pg_temp.ok('Sam is locked with no verified parent', public.is_locked_child(pg_temp.v('sam')), true);
select pg_temp.ok('and still a no-app athlete', (select no_sign_in and status = 'approved' from public.profiles where id = pg_temp.v('sam')), true);

select pg_temp.ok('admins are told nobody can act for Sam, not that Sam sees a link code',
  (select count(*) = 1 from public.messages
   where audience_label = 'Admins' and body like 'Sam Small is under 18, doesn’t use the app, and no longer has a verified parent or guardian linked (Taylor Parent was the last).%'
     and body like '%Nobody can report their absences or injuries, give consent or answer surveys for them until one is.%'
     and body like '%Link another parent or guardian from Sam Small’s page in Members.'), true);
select pg_temp.ok('no notice about Sam mentions a link code',
  not exists (select 1 from public.messages where body like 'Sam Small%' and body like '%link code%'), true);

-- A parent deletes their own account, leaving their no-app child with nobody.
insert into auth.users (id, email, email_confirmed_at) values (pg_temp.id('74'), 'jamie.solo@example.test', now());
update public.profiles set full_name = 'Jamie Solo', requested_role = 'guardian', join_requested_at = now(),
  verified_at = now(), verification_method = 'playhq', declared_date_of_birth = public.club_today() - interval '40 years'
where id = pg_temp.id('74');
select pg_temp.works('an admin adds Robin for Jamie',
  format($s$ insert into ids values ('robin', public.admin_add_no_app_child(%L, 'Robin Solo', (public.club_today() - interval '11 years')::date, '{}', null)) $s$, pg_temp.id('74')));
select pg_temp.as_member('74');
select pg_temp.works('Jamie deletes their account', 'select public.delete_my_account()');
select pg_temp.as_member('01');
select pg_temp.ok('Robin is kept, approved, with nobody linked',
  (select status = 'approved' and no_sign_in from public.profiles where id = pg_temp.v('robin'))
    and not exists (select 1 from public.guardianships where athlete_id = pg_temp.v('robin')), true);
select pg_temp.ok('Robin counts in the admins'' locked to-do', public.is_locked_child(pg_temp.v('robin')), true);
select pg_temp.ok('admins are told nobody can act for Robin',
  (select count(*) = 1 from public.messages
   where audience_label = 'Admins' and body like 'Robin Solo is under 18, doesn’t use the app, and no longer has a verified parent or guardian linked (Jamie Solo was the last).%'), true);

-- Deleting a no-app child removes their sign-in record and profile.
select pg_temp.works('an admin deletes Riley', format($s$ select public.admin_delete_member(%L) $s$, pg_temp.v('riley')));
select pg_temp.ok('Riley''s profile is gone', not exists (select 1 from public.profiles where id = pg_temp.v('riley')), true);
select pg_temp.ok('and their sign-in record', not exists (select 1 from auth.users where id = pg_temp.v('riley')), true);

select pg_temp.ok('nobody already in the club changed',
  not exists (
    select 1 from seed_before b join public.profiles p on p.id = b.id
    where (b.status, b.role, b.extra_roles, b.date_of_birth, b.under_17, b.full_name, b.no_sign_in)
      is distinct from (p.status, p.role, p.extra_roles, p.date_of_birth, p.under_17, p.full_name, p.no_sign_in)
  ), true);
