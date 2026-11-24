-- Tests for 20261121300000_several_safeguarding_contacts_and_about_people.sql:
-- several people in each safeguarding post, and several people a concern is
-- about. Run on a fresh database with the migrations and seed-members.sql
-- loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.holders(p text) returns text language sql as
$$ select coalesce(string_agg(p2.full_name, ', ' order by p2.full_name), '')
   from public.safeguarding_post_holders h join public.profiles p2 on p2.id = h.profile_id where h.post = p $$;
-- Whether member n sees the concern in the register.
create or replace function pg_temp.sees(n text, concern uuid) returns boolean language sql as
$$ select pg_temp.as_member(n); select exists (select 1 from public.concern_register() r where r.id = concern) $$;

-- Sample people with a current check: Alex Admin (01), Casey Coach (11),
-- Emery Manager (13), Finley Physio (14), Morgan Coach-Parent (42). Drew
-- Lapsed (12) has an expired check; Jordan Junior (31) is under 18; Blair
-- Admin (02) has no check.

-- ---------------------------------------------------------------------------
-- Several Child Safety Officers and Complaints Managers
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('a member who isn''t an admin can''t save the contacts',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('11')], array[pg_temp.id('13')], null, null, null, null) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('nobody can be in both posts',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('11'), pg_temp.id('14')], array[pg_temp.id('14')], null, null, null, null) $s$);
select pg_temp.fails('a newly named contact needs a current check',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('11'), pg_temp.id('12')], null, null, null, null, null) $s$);
select pg_temp.fails('a newly named contact must be an adult',
  $s$ select public.admin_set_safeguarding_contacts(null, array[pg_temp.id('13'), pg_temp.id('31')], null, null, null, null) $s$);
select pg_temp.fails('up to 5 in a post',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('01'), pg_temp.id('11'), pg_temp.id('13'), pg_temp.id('14'), pg_temp.id('42'), gen_random_uuid()], null, null, null, null, null) $s$);
select pg_temp.fails('an admin can''t be the only contact',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('01')], null, null, null, null, null) $s$);
select pg_temp.fails('links must still be https',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('11')], null, null, null, 'http://example.com', null) $s$);
reset role;
select pg_temp.ok('a refused save names nobody',
  (select count(*) = 0 from public.safeguarding_post_holders), true);

select pg_temp.as_member('01');
select pg_temp.works('two Child Safety Officers and two Complaints Managers',
  $s$ select public.admin_set_safeguarding_contacts(
    array[pg_temp.id('11'), pg_temp.id('14'), pg_temp.id('11')], array[pg_temp.id('13'), pg_temp.id('01')],
    'Netball WA', '1800 955 900', 'https://example.com/complaints', 'https://example.com/policy') $s$);
reset role;
select pg_temp.ok('both Child Safety Officers kept, once each',
  pg_temp.holders('child_safety_officer') = 'Casey Coach, Finley Physio', true);
select pg_temp.ok('both Complaints Managers kept',
  pg_temp.holders('complaints_manager') = 'Alex Admin, Emery Manager', true);
select pg_temp.ok('the old single columns hold the first person named',
  (select child_safety_officer_id = pg_temp.id('11') and complaints_manager_id = pg_temp.id('13')
   from public.safeguarding_settings where id), true);
select pg_temp.ok('links saved with them',
  (select governing_body_phone = '1800 955 900' from public.safeguarding_settings where id), true);

-- Everyone signed in sees every contact.
select pg_temp.as_member('32');
select pg_temp.ok('an athlete sees both Child Safety Officers',
  (select child_safety_officers = '[{"id": "00000000-0000-0000-0000-000000000011", "name": "Casey Coach", "acting": false}, {"id": "00000000-0000-0000-0000-000000000014", "name": "Finley Physio", "acting": false}]'::jsonb
   from public.safeguarding_contacts()), true);
select pg_temp.ok('and both Complaints Managers',
  (select jsonb_array_length(complaints_managers) = 2 from public.safeguarding_contacts()), true);
select pg_temp.ok('the old single fields show the first by name, for older app versions',
  (select child_safety_officer_name = 'Casey Coach' and complaints_manager_name = 'Alex Admin' from public.safeguarding_contacts()), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed out sees them',
  (select count(*) = 0 from public.safeguarding_contacts()), true);

-- Each holder acts in the post.
select pg_temp.as_member('14');
select pg_temp.ok('the second Child Safety Officer is a safeguarding officer', public.is_safeguarding_officer(), true);
select pg_temp.ok('and a Child Safety Officer', public.is_child_safety_officer(), true);
select pg_temp.ok('and sees the post on home',
  (select child_safety_officer and not complaints_manager from public.my_safeguarding_posts()), true);
select pg_temp.as_member('13');
select pg_temp.ok('a Complaints Manager is a safeguarding officer, not a Child Safety Officer',
  public.is_safeguarding_officer() and not public.is_child_safety_officer(), true);
select pg_temp.as_member('42');
select pg_temp.ok('someone in no post isn''t', public.is_safeguarding_officer(), false);
select pg_temp.ok('and has no posts on home',
  (select not child_safety_officer and not complaints_manager and not wwc_registration_officer from public.my_safeguarding_posts()), true);

select pg_temp.as_member('11');
select pg_temp.fails('a holder who isn''t an admin can''t see the admin list',
  $s$ select 1 / count(*) from public.admin_safeguarding_posts() $s$);
select pg_temp.as_member('01');
select pg_temp.ok('an admin sees all four holders, each able to act',
  (select count(*) = 4 and bool_and(can_act) from public.admin_safeguarding_posts()), true);

-- No to-do while someone in each post can act.
select pg_temp.ok('no "Name a Child Safety Officer" to-do',
  (select child_safety_officer_missing = 0 and complaints_manager_missing = 0 from public.admin_safety_todos()), true);

-- A holder whose check lapses stays named but can't act.
reset role;
update public.profiles set stood_down_at = now() where id = pg_temp.id('14');
select pg_temp.as_member('14');
select pg_temp.ok('a stood-down Child Safety Officer can''t act', public.is_safeguarding_officer(), false);
select pg_temp.as_member('32');
select pg_temp.ok('and isn''t shown to members',
  (select jsonb_array_length(child_safety_officers) = 1 from public.safeguarding_contacts()), true);
select pg_temp.as_member('01');
select pg_temp.ok('the admin still sees them, marked as unable to act',
  (select not can_act from public.admin_safeguarding_posts() where profile_id = pg_temp.id('14')), true);
select pg_temp.ok('no to-do while another Child Safety Officer can act',
  (select child_safety_officer_missing = 0 from public.admin_safety_todos()), true);
select pg_temp.works('saving the screen unchanged keeps them named',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('11'), pg_temp.id('14')], array[pg_temp.id('13'), pg_temp.id('01')],
    'Netball WA', '1800 955 900', 'https://example.com/complaints', 'https://example.com/policy') $s$);
reset role;
select pg_temp.ok('still named', pg_temp.holders('child_safety_officer') = 'Casey Coach, Finley Physio', true);
update public.profiles set stood_down_at = now() where id = pg_temp.id('11');
select pg_temp.as_member('01');
select pg_temp.ok('the to-do shows once nobody in the post can act',
  (select child_safety_officer_missing = 1 and complaints_manager_missing = 0 from public.admin_safety_todos()), true);
reset role;
update public.profiles set stood_down_at = null where id in (pg_temp.id('11'), pg_temp.id('14'));

-- Older app versions save one person per post.
select pg_temp.as_member('01');
select pg_temp.works('an older app saving the person it shows keeps every holder',
  $s$ select public.admin_set_safeguarding(pg_temp.id('11'), pg_temp.id('01'), 'Netball WA', null, null, null) $s$);
reset role;
select pg_temp.ok('both Child Safety Officers kept', pg_temp.holders('child_safety_officer') = 'Casey Coach, Finley Physio', true);
select pg_temp.ok('both Complaints Managers kept', pg_temp.holders('complaints_manager') = 'Alex Admin, Emery Manager', true);
select pg_temp.as_member('01');
select pg_temp.works('an older app naming someone new replaces the post',
  $s$ select public.admin_set_safeguarding(pg_temp.id('42'), pg_temp.id('01'), 'Netball WA', null, null, null) $s$);
reset role;
select pg_temp.ok('just the new Child Safety Officer', pg_temp.holders('child_safety_officer') = 'Morgan Coach-Parent', true);
select pg_temp.as_member('01');
select pg_temp.works('an older app clearing a post it showed clears it',
  $s$ select public.admin_set_safeguarding(null, pg_temp.id('01'), 'Netball WA', null, null, null) $s$);
reset role;
select pg_temp.ok('nobody is Child Safety Officer', pg_temp.holders('child_safety_officer') = '', true);
select pg_temp.ok('the old column cleared too',
  (select child_safety_officer_id is null from public.safeguarding_settings where id), true);

-- Back to two of each for the rest.
select pg_temp.as_member('01');
select public.admin_set_safeguarding_contacts(array[pg_temp.id('11'), pg_temp.id('14')], array[pg_temp.id('13'), pg_temp.id('01')],
  'Netball WA', null, null, null);

-- ---------------------------------------------------------------------------
-- Several WWC Registration Officers
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('a member who isn''t an admin can''t choose them',
  $s$ select public.admin_set_wwc_officers(array[pg_temp.id('01')]) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('each must be an admin or committee member',
  $s$ select public.admin_set_wwc_officers(array[pg_temp.id('01'), pg_temp.id('11')]) $s$);
select pg_temp.fails('with a current check',
  $s$ select public.admin_set_wwc_officers(array[pg_temp.id('01'), pg_temp.id('21')]) $s$);
reset role;
update public.profiles set extra_roles = array['committee']::public.app_role[] where id = pg_temp.id('42');
select pg_temp.as_member('01');
select pg_temp.works('two WWC Registration Officers',
  $s$ select public.admin_set_wwc_officers(array[pg_temp.id('42'), pg_temp.id('01')]) $s$);
select pg_temp.ok('both listed for reports',
  (select array_agg(officer_name order by officer_name) = array['Alex Admin', 'Morgan Coach-Parent'] from public.admin_wwc_officers()), true);
select pg_temp.ok('older app versions get one row',
  (select count(*) = 1 from public.admin_wwc_officer()), true);
select pg_temp.ok('no "Choose a WWC Registration Officer" to-do',
  (select wwc_officer_missing = 0 from public.admin_safety_todos()), true);
select pg_temp.as_member('42');
select pg_temp.ok('the second one sees the post on home',
  (select wwc_registration_officer from public.my_safeguarding_posts()), true);
select pg_temp.as_member('32');
select pg_temp.ok('an athlete can''t list them',
  (select count(*) = 0 from public.admin_wwc_officers()), true);
select pg_temp.as_member('01');
select pg_temp.works('an older app saving one already named keeps both',
  $s$ select public.admin_set_wwc_officer(pg_temp.id('01')) $s$);
reset role;
select pg_temp.ok('both kept', pg_temp.holders('wwc_officer') = 'Alex Admin, Morgan Coach-Parent', true);

-- ---------------------------------------------------------------------------
-- Concerns about one of several contacts
-- ---------------------------------------------------------------------------
select pg_temp.as_member('32');
create temp table k as select
  public.raise_concern('About a Child Safety Officer', p_about_member_ids => array[pg_temp.id('11')]) as about_cso;
select pg_temp.ok('the other Child Safety Officer sees a concern about the first',
  pg_temp.sees('14', (select about_cso from k)), true);
select pg_temp.ok('the Complaints Manager sees it', pg_temp.sees('13', (select about_cso from k)), true);
select pg_temp.ok('the Child Safety Officer it''s about doesn''t', pg_temp.sees('11', (select about_cso from k)), false);

-- ---------------------------------------------------------------------------
-- Several people a concern is about
-- ---------------------------------------------------------------------------
-- A second child, Riley Young (63), with Logan Parent (41) as verified parent.
reset role;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000063', 'riley@example.test', now());
update public.profiles set full_name = 'Riley Young', role = 'athlete', status = 'approved',
  date_of_birth = public.club_today() - interval '12 years' where id = pg_temp.id('63');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('41'), pg_temp.id('63'));

select pg_temp.as_member('32');
select pg_temp.fails('up to 10 people when raising',
  $s$ select public.raise_concern('Too many', p_about_member_ids => array(select id from public.profiles limit 11)) $s$);
create temp table c as select public.raise_concern(
  'Two children left behind by a coach',
  p_about_text => 'and a parent helper I don''t know',
  p_about_member_ids => array[pg_temp.id('31'), pg_temp.id('63'), pg_temp.id('31')],
  p_about_member_id => pg_temp.id('13'),
  p_involves_child => 'yes') as id;
reset role;
select pg_temp.ok('three people named, once each, in the order given',
  (select array_agg(member_name order by id) = array['Jordan Junior', 'Riley Young', 'Emery Manager']
   from public.concern_about_members where concern_id = (select id from c)), true);
select pg_temp.ok('all three named by the raiser',
  (select bool_and(named_by_raiser) from public.concern_about_members where concern_id = (select id from c)), true);
select pg_temp.ok('the old column holds the first',
  (select about_member_id = pg_temp.id('31') and about_member_name = 'Jordan Junior' from public.concerns where id = (select id from c)), true);

select pg_temp.ok('the Complaints Manager named in it can''t see it', pg_temp.sees('13', (select id from c)), false);
select pg_temp.ok('the other Complaints Manager (an admin) can', pg_temp.sees('01', (select id from c)), true);
select pg_temp.ok('a Child Safety Officer can', pg_temp.sees('11', (select id from c)), true);
select pg_temp.as_member('11');
select pg_temp.ok('the register lists all three',
  (select about_members = '[{"id": "00000000-0000-0000-0000-000000000031", "name": "Jordan Junior"}, {"id": "00000000-0000-0000-0000-000000000063", "name": "Riley Young"}, {"id": "00000000-0000-0000-0000-000000000013", "name": "Emery Manager"}]'::jsonb
   from public.concern_register() where id = (select id from c)), true);
select pg_temp.as_member('32');
select pg_temp.ok('the raiser sees the names they gave and their words',
  (select about_text = 'Jordan Junior, Riley Young, Emery Manager, and a parent helper I don''t know'
   from public.my_concerns() where id = (select id from c)), true);

-- Each child's verified parents are shown.
select pg_temp.as_member('11');
select pg_temp.ok('parents of both children, with each child''s name',
  (select string_agg(child_name || ':' || name, ', ' order by child_name, name) =
     'Jordan Junior:Logan Parent, Jordan Junior:Morgan Coach-Parent, Riley Young:Logan Parent'
   from public.concern_guardians((select id from c))), true);
select pg_temp.as_member('13');
select pg_temp.ok('the Complaints Manager named in it gets none',
  (select count(*) = 0 from public.concern_guardians((select id from c))), true);

-- Those handling it add and remove people.
select pg_temp.as_member('32');
select pg_temp.fails('the raiser can''t add people afterwards',
  $s$ select public.add_concern_about((select id from c), pg_temp.id('02')) $s$);
select pg_temp.as_member('11');
select pg_temp.fails('someone already named can''t be added twice',
  $s$ select public.add_concern_about((select id from c), pg_temp.id('63')) $s$);
select pg_temp.fails('an unknown member can''t be added',
  $s$ select public.add_concern_about((select id from c), gen_random_uuid()) $s$);
select pg_temp.works('a Child Safety Officer adds Blair Admin',
  $s$ select public.add_concern_about((select id from c), pg_temp.id('02')) $s$);
select pg_temp.ok('Blair can no longer see it, though an admin',
  pg_temp.sees('02', (select id from c)), false);
select pg_temp.as_member('32');
select pg_temp.ok('the raiser isn''t shown a name added later',
  (select about_text not like '%Blair%' from public.my_concerns() where id = (select id from c)), true);
select pg_temp.as_member('11');
select pg_temp.ok('the change is in the history',
  (select count(*) = 1 from public.concern_history((select id from c)) where kind = 'about_changed' and note = 'Added: Blair Admin'), true);
select pg_temp.works('and takes Emery Manager off',
  $s$ select public.remove_concern_about((select id from c), pg_temp.id('13')) $s$);
select pg_temp.ok('Emery can see it again', pg_temp.sees('13', (select id from c)), true);
select pg_temp.as_member('11');
select pg_temp.ok('the removal is in the history',
  (select count(*) = 1 from public.concern_history((select id from c)) where note = 'Removed: Emery Manager'), true);
select pg_temp.fails('removing someone not named is refused',
  $s$ select public.remove_concern_about((select id from c), pg_temp.id('13')) $s$);
select pg_temp.as_member('02');
select pg_temp.fails('someone named can''t take themselves off',
  $s$ select public.remove_concern_about((select id from c), pg_temp.id('02')) $s$);

-- Up to 10.
reset role;
insert into public.concern_about_members (concern_id, member_id, member_name)
select (select id from c), p.id, p.full_name from public.profiles p
where p.id in (pg_temp.id('42'), pg_temp.id('12'), pg_temp.id('21'), pg_temp.id('22'), pg_temp.id('23'), pg_temp.id('41'), pg_temp.id('32'));
select pg_temp.as_member('11');
select pg_temp.fails('an 11th person is refused',
  $s$ select public.add_concern_about((select id from c), pg_temp.id('14')) $s$);
reset role;
delete from public.concern_about_members
where concern_id = (select id from c)
  and member_id in (pg_temp.id('42'), pg_temp.id('12'), pg_temp.id('21'), pg_temp.id('22'), pg_temp.id('23'), pg_temp.id('41'), pg_temp.id('32'));

-- The old one-person change, from older app versions, names just that person.
select pg_temp.as_member('01');
select pg_temp.works('an older app sets who it''s about',
  $s$ select public.set_concern_about((select id from c), pg_temp.id('31')) $s$);
reset role;
select pg_temp.ok('only Jordan is named now',
  (select array_agg(member_name) = array['Jordan Junior'] from public.concern_about_members where concern_id = (select id from c)), true);
select pg_temp.ok('Blair can see it again', pg_temp.sees('02', (select id from c)), true);
select pg_temp.as_member('11');
select public.add_concern_about((select id from c), pg_temp.id('63'));
select public.add_concern_about((select id from c), pg_temp.id('13'));

-- ---------------------------------------------------------------------------
-- Message access with several people a concern is about
-- ---------------------------------------------------------------------------
select pg_temp.as_member('14');
select pg_temp.ok('the second Child Safety Officer can name each person it''s about',
  (select count(*) = 3 from public.message_access_people((select id from c)) where link = 'about'), true);
create temp table r as select public.request_message_access((select id from c), pg_temp.id('63'), 'about',
  public.club_today() - 30, public.club_today(), 'Messages to Riley around the trip') as id;
select pg_temp.ok('a request names the second child as who it''s about',
  (select subject_link = 'about' from public.message_access_requests where id = (select id from r)), true);
select pg_temp.fails('naming someone not on the concern as who it''s about is refused',
  $s$ select public.request_message_access((select id from c), pg_temp.id('42'), 'about', public.club_today() - 30, public.club_today(), 'Not about this person') $s$);
select pg_temp.as_member('13');
select pg_temp.ok('a Complaints Manager named in the concern doesn''t see the request',
  (select count(*) = 0 from public.message_access_requests() where id = (select id from r)), true);
select pg_temp.as_member('01');
select pg_temp.ok('an admin not named can decide it',
  (select can_decide from public.message_access_requests() where id = (select id from r)), true);
reset role;
select pg_temp.ok('everyone it''s about is on legal hold',
  public.on_legal_hold(pg_temp.id('31')) and public.on_legal_hold(pg_temp.id('63')) and public.on_legal_hold(pg_temp.id('13')), true);
select pg_temp.ok('someone not named isn''t',
  public.on_legal_hold(pg_temp.id('14')), false);

-- ---------------------------------------------------------------------------
-- Filling in from the old columns, and running the migration again
-- ---------------------------------------------------------------------------
-- A concern stored before this change, about Kai Senior (32), and one whose
-- "about" was changed by someone handling it.
reset role;
insert into public.concerns (id, raised_by, raised_by_name, about_member_id, about_member_name, body)
values ('00000000-0000-0000-0000-0000000000c1', pg_temp.id('31'), 'Jordan Junior', pg_temp.id('32'), 'Kai Senior', 'Older concern'),
       ('00000000-0000-0000-0000-0000000000c2', pg_temp.id('31'), 'Jordan Junior', pg_temp.id('12'), 'Drew Lapsed', 'Changed concern');
insert into public.concern_events (concern_id, kind, note)
values ('00000000-0000-0000-0000-0000000000c2', 'about_changed', 'About: Drew Lapsed');
create temp table counts_before as
  select (select count(*) from public.concerns) as concerns,
         (select count(*) from public.safeguarding_post_holders) as holders,
         (select count(*) from public.concern_about_members) as about;
\ir ../migrations/20261121300000_several_safeguarding_contacts_and_about_people.sql
select pg_temp.ok('running it again works and keeps every holder',
  (select count(*) = (select holders from counts_before) from public.safeguarding_post_holders), true);
select pg_temp.ok('the older concern''s member is filled in, named by the raiser',
  (select named_by_raiser and member_name = 'Kai Senior' from public.concern_about_members
   where concern_id = '00000000-0000-0000-0000-0000000000c1'), true);
select pg_temp.ok('one changed by a handler isn''t shown to the raiser as theirs',
  (select not named_by_raiser from public.concern_about_members
   where concern_id = '00000000-0000-0000-0000-0000000000c2'), true);
select pg_temp.ok('nothing else added and no concern lost',
  (select count(*) = (select about from counts_before) + 2 from public.concern_about_members)
  and (select count(*) = (select concerns from counts_before) from public.concerns), true);
select pg_temp.ok('Kai counts as named on the older concern, so would never see it',
  public.is_named_in_concern('00000000-0000-0000-0000-0000000000c1', pg_temp.id('32')), true);

-- ---------------------------------------------------------------------------
-- Nobody reaches the new tables directly
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('01');
select pg_temp.fails('an admin can''t read the holders table',
  $s$ select count(*) from public.safeguarding_post_holders $s$);
select pg_temp.fails('or the people-a-concern-is-about table',
  $s$ select count(*) from public.concern_about_members $s$);
select pg_temp.fails('or call the inner helpers',
  $s$ select public.replace_safeguarding_post('child_safety_officer', array[pg_temp.id('01')]) $s$);
reset role;
