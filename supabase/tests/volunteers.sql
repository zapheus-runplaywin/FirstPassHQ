-- Tests for 20261013060000_temporary_volunteers.sql, and who can call its two
-- compliance checks (20261121200000_match_database_access_to_roles.sql). Run
-- on a fresh database with the migrations and seed-members.sql loaded. Prints
-- one line per check.
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
grant select on public.messages, public.message_recipients, public.policy_acknowledgements to authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000051', 'helper.card@example.test', now()),
  ('00000000-0000-0000-0000-000000000052', 'visitor@example.test', now()),
  ('00000000-0000-0000-0000-000000000053', 'national.coach@example.test', now()),
  ('00000000-0000-0000-0000-000000000054', 'second.visit@example.test', now());

-- The rules.
select pg_temp.ok('a volunteer needs a check', public.needs_wwcc('{volunteer}', 'Only for a day'), true);
select pg_temp.ok('a volunteer can''t have another role',
  public.role_combination_problem('{volunteer,coach}', null, false) is not null, true);
select pg_temp.ok('a volunteer alone is fine', public.role_combination_problem('{volunteer}', null, false) is null, true);
select pg_temp.ok('a visitor exemption lasts two weeks',
  public.exemption_last_day('short_term_visitor', date '2027-03-01') = date '2027-03-14', true);
select pg_temp.ok('a national event exemption lasts 30 days',
  public.exemption_last_day('national_event', date '2027-03-01') = date '2027-03-30', true);

-- Asking to join as a volunteer.
select pg_temp.as_member('51');
select pg_temp.works('asking to join as a volunteer',
  $s$ select public.submit_join_request('Quinn Helper', null, 'volunteer', null, null, date '1990-01-01', null) $s$);
select pg_temp.fails('details need a task',
  $s$ select public.set_my_volunteer_details('', public.club_today() + 5, public.club_today() + 5, 'card', 'WWC0051') $s$);
select pg_temp.fails('the last day can''t be before the first',
  $s$ select public.set_my_volunteer_details('Bench helper', public.club_today() + 5, public.club_today() + 4, 'card', 'WWC0051') $s$);
select pg_temp.fails('more than 12 months isn''t temporary',
  $s$ select public.set_my_volunteer_details('Bench helper', public.club_today(), public.club_today() + 400, 'card', 'WWC0051') $s$);
select pg_temp.fails('a card choice needs the number',
  $s$ select public.set_my_volunteer_details('Bench helper', public.club_today() + 5, public.club_today() + 5, 'card', '') $s$);
select pg_temp.works('saving their details',
  $s$ select public.set_my_volunteer_details('Bench helper at the carnival', public.club_today() + 5, public.club_today() + 6, 'card', 'wwc 0051') $s$);
select pg_temp.ok('their details are kept',
  (select volunteer_task = 'Bench helper at the carnival' and volunteer_screening = 'card'
     and declared_wwcc_number = 'WWC 0051' and requested_role = 'volunteer'
   from public.profiles where id = '00000000-0000-0000-0000-000000000051'), true);
select pg_temp.as_member('32');
select pg_temp.fails('someone who didn''t ask to join as a volunteer can''t set them',
  $s$ select public.set_my_volunteer_details('Helper', public.club_today(), public.club_today(), 'none') $s$);

-- Approving them.
select pg_temp.as_member('01');
select pg_temp.fails('can''t approve before they accept the club''s policies',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'volunteer', 'approved') $s$);
select pg_temp.as_member('51');
select pg_temp.works('they accept the club''s policies', $s$ select public.acknowledge_club_policies() $s$);
select pg_temp.works('accepting twice is fine', $s$ select public.acknowledge_club_policies() $s$);
select pg_temp.ok('one acknowledgement is kept, word for word',
  (select count(*) = 1 and bool_and(statement like 'I''ve read the club''s code of conduct%')
   from public.policy_acknowledgements where profile_id = '00000000-0000-0000-0000-000000000051'), true);
select pg_temp.as_member('01');
select pg_temp.fails('can''t approve without a check',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'volunteer', 'approved') $s$);
select pg_temp.works('recording a card that ends before their last day',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000051', null, 'WWC0051', public.club_today() + 5) $s$);
select pg_temp.fails('can''t approve when the card ends before their last day',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'volunteer', 'approved') $s$);
select pg_temp.works('with a card that lasts, they''re approved',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000051', null, 'WWC0051', public.club_today() + 300);
      select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'volunteer', 'approved') $s$);
select pg_temp.fails('a volunteer can''t also be a coach',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'volunteer', 'approved', '[]', false, '{}', null, '{coach}') $s$);

-- No club features.
select pg_temp.as_member('51');
select pg_temp.ok('a volunteer isn''t an approved member', public.is_approved(), false);
select pg_temp.as_member('11');
select pg_temp.ok('a coach still is', public.is_approved(), true);
select pg_temp.as_member('01');
select pg_temp.fails('admins can''t message volunteers as a role',
  $s$ select public.send_group_message('Hello', 'role', 'volunteer') $s$);
select pg_temp.works('a whole-club message', $s$ select public.send_group_message('Club news', 'club') $s$);
select pg_temp.ok('doesn''t go to the volunteer',
  (select not exists (select 1 from public.message_recipients r join public.messages m on m.id = r.message_id
    where m.body = 'Club news' and r.profile_id = '00000000-0000-0000-0000-000000000051')), true);
insert into public.message_recipients (message_id, profile_id)
select id, '00000000-0000-0000-0000-000000000051' from public.messages where body = 'Club news';
select pg_temp.as_member('51');
select pg_temp.ok('and a volunteer can''t read one even if listed',
  public.is_message_recipient((select id from public.messages where body = 'Club news')), false);
select pg_temp.ok('they can still see the people a concern can be about',
  (select count(*) > 0 from public.concern_people()), true);
select pg_temp.as_member('01');
select pg_temp.ok('concerns can be raised about a volunteer',
  (select count(*) = 1 from public.concern_people() where id = '00000000-0000-0000-0000-000000000051'), true);
select pg_temp.works('a volunteer can be stood down',
  $s$ select public.admin_stand_down('00000000-0000-0000-0000-000000000051', 'allegation', null) $s$);

-- Changing an approved volunteer's dates.
select pg_temp.works('an admin changes the task',
  $s$ select public.admin_set_volunteer_details('00000000-0000-0000-0000-000000000051', 'Scorer', public.club_today() + 5, public.club_today() + 6) $s$);
select pg_temp.fails('dates beyond their card are refused',
  $s$ select public.admin_set_volunteer_details('00000000-0000-0000-0000-000000000051', 'Scorer', public.club_today() + 5, public.club_today() + 320) $s$);

-- Short-term visitor.
select pg_temp.as_member('52');
select public.submit_join_request('Riley Visitor', null, 'volunteer', null, null, date '1985-05-05', null);
select public.set_my_volunteer_details('Guest coach at two clinics', public.club_today() + 2, public.club_today() + 9, 'visitor');
select public.acknowledge_club_policies();
select pg_temp.as_member('01');
select pg_temp.fails('a visitor exemption needs the arrival day',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000052', 'short_term_visitor') $s$);
select pg_temp.fails('a visitor who arrived more than two weeks ago is refused',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000052', 'short_term_visitor', null, public.club_today() - 14) $s$);
select pg_temp.works('recording a visitor exemption from their arrival',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000052', 'short_term_visitor', null, public.club_today() + 1) $s$);
select pg_temp.fails('can''t approve before they accept the declaration',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000052', 'volunteer', 'approved') $s$);
select pg_temp.as_member('52');
select pg_temp.ok('their declaration names the dates',
  (select declaration_text like '%arrived in WA for this visit on ' || to_char(public.club_today() + 1, 'DD/MM/YYYY') || '%'
     and declaration_text like '%ends on ' || to_char(public.club_today() + 14, 'DD/MM/YYYY') || '%'
     and ends_on = public.club_today() + 14 and not valid
   from public.my_volunteer_exemption()), true);
select pg_temp.works('they accept it', $s$ select public.accept_volunteer_declaration() $s$);
select pg_temp.as_member('01');
select pg_temp.fails('dates past the two weeks are refused',
  $s$ select public.admin_set_volunteer_details('00000000-0000-0000-0000-000000000052', 'Guest coach', public.club_today() + 2, public.club_today() + 20);
      select public.admin_save_member('00000000-0000-0000-0000-000000000052', 'volunteer', 'approved') $s$);
select pg_temp.works('dates inside the two weeks are approved',
  $s$ select public.admin_set_volunteer_details('00000000-0000-0000-0000-000000000052', 'Guest coach', public.club_today() + 2, public.club_today() + 9);
      select public.admin_save_member('00000000-0000-0000-0000-000000000052', 'volunteer', 'approved') $s$);
select pg_temp.ok('the exemption doesn''t apply until they arrive',
  public.is_cleared('00000000-0000-0000-0000-000000000052'), false);
select pg_temp.ok('a volunteer who hasn''t started isn''t counted as missing a check',
  (select wwcc_missing from public.admin_safety_todos()) =
  (select count(*) from public.profiles p where p.status = 'approved'
     and public.needs_wwcc(public.roles_of(p.role, p.extra_roles), p.wwcc_exempt_reason)
     and p.role <> 'volunteer' and not public.is_cleared(p.id)), true);
update public.volunteer_exemptions set starts_on = public.club_today() - 1
where profile_id = '00000000-0000-0000-0000-000000000052' and ended_at is null;
select pg_temp.ok('it applies from the day they arrive', public.is_cleared('00000000-0000-0000-0000-000000000052'), true);
select pg_temp.ok('a short exemption isn''t flagged as ending',
  (select exemptions_ending = 0 from public.admin_safety_todos()), true);
update public.volunteer_exemptions set starts_on = public.club_today() - 14
where profile_id = '00000000-0000-0000-0000-000000000052' and ended_at is null;
select pg_temp.ok('and stops after two weeks', public.is_cleared('00000000-0000-0000-0000-000000000052'), false);
select pg_temp.fails('a second visitor exemption within 12 months is refused',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000052', 'short_term_visitor', null, public.club_today() + 200) $s$);
select pg_temp.fails('so is a national event exemption',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000052', 'national_event', null, public.club_today() + 300, 'National Championships', 'Netball Australia') $s$);
select pg_temp.works('one more than 12 months after it ended is allowed',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000052', 'short_term_visitor', null, public.club_today() + 400) $s$);
select pg_temp.ok('the earlier one is kept, ended',
  (select count(*) = 2 and count(*) filter (where ended_at is not null) = 1
   from public.volunteer_exemptions where profile_id = '00000000-0000-0000-0000-000000000052'), true);

-- National event: the national coach.
select pg_temp.as_member('53');
select public.submit_join_request('Sam National', null, 'volunteer', null, null, date '1980-02-02', null);
select public.set_my_volunteer_details('Coaching at the national championships', public.club_today() + 30, public.club_today() + 40, 'national_event');
select public.acknowledge_club_policies();
select pg_temp.as_member('01');
select pg_temp.fails('a national event needs its name and organiser',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000053', 'national_event', null, public.club_today() + 28) $s$);
select pg_temp.works('recording the national event',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000053', 'national_event', null, public.club_today() + 28, 'National Netball Championships', 'Netball Australia') $s$);
select pg_temp.as_member('53');
select pg_temp.ok('the declaration names the event and organiser',
  (select declaration_text like '%in WA for National Netball Championships, organised by Netball Australia%'
     and ends_on = public.club_today() + 57 from public.my_volunteer_exemption()), true);
select public.accept_volunteer_declaration();
select pg_temp.as_member('01');
select pg_temp.works('approved for dates inside the 30 days',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000053', 'volunteer', 'approved') $s$);
select pg_temp.works('swapping an accepted exemption that hasn''t started yet is allowed',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000053', 'short_term_visitor', null, public.club_today() + 100) $s$);
select pg_temp.works('and back to the national event, with its first day corrected',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000053', 'national_event', null, public.club_today() + 29, 'National Netball Championships', 'Netball Australia') $s$);
select pg_temp.ok('the admin list shows the event and dates',
  (select event_name = 'National Netball Championships' and starts_on = public.club_today() + 29 and ends_on = public.club_today() + 58
   from public.admin_volunteer_exemptions()
   where profile_id = '00000000-0000-0000-0000-000000000053' and ended_at is null), true);
select pg_temp.as_member('53');
select public.accept_volunteer_declaration();
select pg_temp.as_member('01');
update public.volunteer_exemptions set starts_on = public.club_today() - 1
where profile_id = '00000000-0000-0000-0000-000000000053' and ended_at is null;
select pg_temp.fails('once it has started, swapping to a visitor exemption is refused',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000053', 'short_term_visitor', null, public.club_today() + 100) $s$);

-- An exemption not accepted doesn't count towards the 12 months.
select pg_temp.as_member('54');
select public.submit_join_request('Taylor Twice', null, 'volunteer', null, null, date '1979-03-03', null);
select pg_temp.as_member('01');
select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000054', 'short_term_visitor', null, public.club_today());
select pg_temp.works('an exemption they never accepted can be replaced',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000054', 'national_event', null, public.club_today() + 10, 'State Schools Cup', 'School Sport WA') $s$);

-- Older exemptions still work.
select pg_temp.works('a parent volunteer exemption still records',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000042', 'parent_volunteer', '00000000-0000-0000-0000-000000000031') $s$);
select pg_temp.ok('with no dates',
  (select starts_on is null and event_name is null from public.volunteer_exemptions
   where profile_id = '00000000-0000-0000-0000-000000000042' and ended_at is null), true);

-- Only admins.
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t record an exemption',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000054', 'short_term_visitor', null, public.club_today()) $s$);
select pg_temp.fails('a coach can''t change a volunteer''s dates',
  $s$ select public.admin_set_volunteer_details('00000000-0000-0000-0000-000000000051', 'X', public.club_today(), public.club_today()) $s$);
select pg_temp.ok('nobody can read another member''s acknowledgement directly',
  has_table_privilege('anon', 'public.policy_acknowledgements', 'select'), false);

-- The two compliance checks behind those saves run only inside them
-- (20261121200000_match_database_access_to_roles.sql), so nobody signed in
-- can look up whether someone else accepted the policies or is covered.
select pg_temp.ok('members can''t call has_acknowledged_policies directly',
  has_function_privilege('authenticated', 'public.has_acknowledged_policies(uuid)', 'execute'), false);
select pg_temp.ok('members can''t call volunteer_covered directly',
  has_function_privilege('authenticated', 'public.volunteer_covered(uuid, date, date)', 'execute'), false);
set role authenticated;
select pg_temp.as_member('01');
select pg_temp.works('signed in, an admin still changes a volunteer''s dates (the check runs inside)',
  $s$ select public.admin_set_volunteer_details('00000000-0000-0000-0000-000000000051', 'Scorer', public.club_today() + 5, public.club_today() + 7) $s$);
select pg_temp.fails('signed in, an admin still can''t call has_acknowledged_policies directly',
  $s$ select public.has_acknowledged_policies('00000000-0000-0000-0000-000000000051') $s$);
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t check whether a volunteer is covered',
  $s$ select public.volunteer_covered('00000000-0000-0000-0000-000000000051', public.club_today(), public.club_today()) $s$);
select pg_temp.as_member('51');
select pg_temp.fails('a volunteer can''t check their own cover directly either',
  $s$ select public.volunteer_covered('00000000-0000-0000-0000-000000000051', public.club_today(), public.club_today()) $s$);
reset role;
