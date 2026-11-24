-- Tests for 20261124600000_chat_groups.sql: chat groups in Messages. Run on a
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
--
-- The rules under test, each for every kind of member, both ways:
--   - the Chat groups switch is off until an admin turns it on;
--   - who is in each automatic group (coaches and managers, coaches and
--     captains, coaches and physios with any Head Physio, all managers), with
--     coaches and managers only while they could work with children;
--   - a post goes to the people in the group then, and the parents of every
--     member under 18 get a copy in their inbox naming the child;
--   - members under 18 post only in their own squad's or team's automatic
--     groups while a coach is in them; in admins' groups they read only
--     (privacy and social media assessment, reassessed 24 November 2026);
--   - the group's coaches hide posts, which then stay only with the author,
--     the coaches and the author's parents; the text is kept; coaches can
--     show them again;
--   - hiding a group marks its posts read without touching receipts;
--   - admins set up groups but don't read groups they aren't in;
--   - nothing is ever deleted.
--
-- Sample Squad (a1): head coach Casey (11), assistant coaches Drew (12, lapsed
-- check) and Morgan (42, also Jordan's parent), manager Emery (13), physio
-- Finley (14), athletes Jordan (31, 14 years old) and Kai (32, adult).
-- Sample Team (a2), named from the squad: coach Casey, athlete Jordan.
-- Jordan's parents are Logan (41) and Morgan (42). Admins Alex (01) and
-- Blair (02). Committee Gale (21), Harper (22), Indy (23).
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', case when n = '' then '' else '00000000-0000-0000-0000-0000000000' || n end, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text, pattern text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like pattern then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.eq(label text, actual text, expected text) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual, 'null') || ')' $$;

create temp table posts (label text primary key, id uuid);
create temp table grp (label text primary key, id uuid);
grant select, insert on posts, grp to authenticated;
create or replace function pg_temp.p(label text) returns uuid language sql as
$$ select id from posts where posts.label = $1 $$;
create or replace function pg_temp.g(label text) returns uuid language sql as
$$ select id from grp where grp.label = $1 $$;
-- The signed-in member's groups, by name.
create or replace function pg_temp.my_groups() returns text language sql as
$$ select coalesce(string_agg(name, ', ' order by name), '') from public.my_chat_groups() $$;
create temp table mine_shape as select * from public.my_chat_groups() limit 0;
create or replace function pg_temp.mine(label text) returns mine_shape language sql as
$$ select * from public.my_chat_groups() where id = pg_temp.g($1) $$;
-- Who got a post, by member number, and whose copies name children.
create or replace function pg_temp.got(label text) returns text language sql as
$$ select coalesce(string_agg(right(profile_id::text, 2), ',' order by profile_id), '') from public.message_recipients where message_id = pg_temp.p($1) $$;
create or replace function pg_temp.copies(label text) returns text language sql as
$$ select coalesce(string_agg(right(profile_id::text, 2) || ':' || array_to_string(for_child_names, '/'), ',' order by profile_id), '')
   from public.message_recipients where message_id = pg_temp.p($1) and for_children is not null and chat_group_id is null $$;
create or replace function pg_temp.post(label text, grp_label text, body text) returns text language plpgsql as
$$ begin insert into posts values (label, public.post_to_chat_group(pg_temp.g(grp_label), body)); return 'posted';
   exception when others then return 'refused: ' || sqlerrm; end $$;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('anon cannot list groups', has_function_privilege('anon', 'public.my_chat_groups()', 'execute'), false);
select pg_temp.ok('anon cannot post', has_function_privilege('anon', 'public.post_to_chat_group(uuid, text)', 'execute'), false);
select pg_temp.ok('anon cannot read posts', has_function_privilege('anon', 'public.chat_group_posts(uuid, timestamptz)', 'execute'), false);
select pg_temp.ok('anon cannot remove posts', has_function_privilege('anon', 'public.remove_chat_post(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot save groups', has_function_privilege('anon', 'public.admin_save_chat_group(uuid, text, public.app_role[], uuid[], uuid[])', 'execute'), false);
select pg_temp.ok('members can list, post, read, hide and remove', bool_and(has_function_privilege('authenticated', f, 'execute')), true)
from unnest(array['public.my_chat_groups()', 'public.post_to_chat_group(uuid, text)', 'public.chat_group_posts(uuid, timestamptz)',
  'public.chat_group_members(uuid)', 'public.mark_chat_group_read(uuid)', 'public.set_chat_group_hidden(uuid, boolean)',
  'public.remove_chat_post(uuid)', 'public.show_chat_post(uuid)']) f;
select pg_temp.ok('the inner rules aren''t for the app to call', bool_or(has_function_privilege('authenticated', f, 'execute')), false)
from unnest(array['public.chat_group_people(public.chat_groups)', 'public.chat_can_post(public.chat_groups, uuid)',
  'public.chat_can_remove(public.chat_groups, uuid)', 'public.chat_post_hidden_from_me(uuid)', 'public.chat_group_coach_led(public.chat_groups)',
  'public.ensure_automatic_chat_groups()', 'public.chat_staff_ok(uuid)',
  'public.chat_group_draft(text, public.app_role[], uuid[], uuid[])']) f;
select pg_temp.ok('members can''t read the group tables directly', has_table_privilege('authenticated', 'public.chat_groups', 'select') or has_table_privilege('authenticated', 'public.chat_group_hidden', 'select'), false);
select pg_temp.ok('no policy lets members change messages or copies', exists (select 1 from pg_policies where tablename in ('messages', 'message_recipients') and cmd in ('UPDATE', 'ALL', 'INSERT', 'DELETE')), false);

-- ---------------------------------------------------------------------------
-- Off until an admin turns it on
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.eq('switched off, Casey has no groups', pg_temp.my_groups(), '');
select pg_temp.ok('switched off, chat groups count as off', public.chat_groups_on(), false);
update public.club_settings set features = coalesce(features, '{}') || '{"chatGroups": true}' where id;
select pg_temp.ok('switched on, chat groups count as on', public.chat_groups_on(), true);
update public.club_settings set features = features || '{"messages": false}' where id;
select pg_temp.ok('with Messages off, chat groups are off too', public.chat_groups_on(), false);
update public.club_settings set features = features - 'messages' where id;

-- Jordan captains Sample Team.
insert into public.team_captains (team_id, profile_id, captain_role)
values (pg_temp.id('a2'), pg_temp.id('31'), 'captain');

select pg_temp.as_member('11');
select pg_temp.eq('Casey is in the squad''s staff and physio groups and the team''s captains group', pg_temp.my_groups(),
  'Sample Squad coaches and managers, Sample Squad coaches and physios, Sample Team coaches and captains');
insert into grp select 'staff', id from public.chat_groups where kind = 'team_staff' and team_id = pg_temp.id('a1');
insert into grp select 'physio', id from public.chat_groups where kind = 'team_physio' and team_id = pg_temp.id('a1');
insert into grp select 'captains', id from public.chat_groups where kind = 'team_captains' and team_id = pg_temp.id('a2');
insert into grp select 'team staff', id from public.chat_groups where kind = 'team_staff' and team_id = pg_temp.id('a2');
insert into grp select 'managers', id from public.chat_groups where kind = 'managers';
select pg_temp.ok('a squad gets no coaches and captains group', exists (select 1 from public.chat_groups where kind = 'team_captains' and team_id = pg_temp.id('a1')), false);
select pg_temp.ok('automatic groups are made once', (select count(*) from public.chat_groups where kind <> 'custom') = 6, true);
select public.my_chat_groups();
select pg_temp.ok('asking again makes no more', (select count(*) from public.chat_groups where kind <> 'custom') = 6, true);
select pg_temp.ok('the team''s staff group, Casey alone, isn''t listed', pg_temp.mine('team staff') is null, true);

-- Who is in each group.
create or replace function pg_temp.people(label text) returns text language sql security definer as
$$ select coalesce(string_agg(right(x::text, 2), ',' order by x), '') from public.chat_group_people((select g from public.chat_groups g where g.id = pg_temp.g($1))) x $$;
select pg_temp.eq('staff: coaches and the manager, not Drew (lapsed check)', pg_temp.people('staff'), '11,13,42');
select pg_temp.eq('physio: coaches and the physio', pg_temp.people('physio'), '11,14,42');
select pg_temp.eq('captains: the team''s coach and its captain', pg_temp.people('captains'), '11,31');
select pg_temp.eq('managers: every manager of a current squad or team', pg_temp.people('managers'), '13');

-- Each kind of member sees only their own groups.
select pg_temp.as_member('13');
select pg_temp.eq('Emery the manager: the staff group only (All managers has one person)', pg_temp.my_groups(), 'Sample Squad coaches and managers');
select pg_temp.as_member('14');
select pg_temp.eq('Finley the physio: the physio group', pg_temp.my_groups(), 'Sample Squad coaches and physios');
select pg_temp.as_member('42');
select pg_temp.eq('Morgan the assistant coach: staff and physio', pg_temp.my_groups(), 'Sample Squad coaches and managers, Sample Squad coaches and physios');
select pg_temp.as_member('31');
select pg_temp.eq('Jordan the captain: the captains group', pg_temp.my_groups(), 'Sample Team coaches and captains');
select pg_temp.ok('Jordan can post in their own team''s group while its coach is in it', (pg_temp.mine('captains')).can_post, true);
select pg_temp.ok('Jordan can''t remove posts', (pg_temp.mine('captains')).can_remove, false);
select pg_temp.as_member('12');
select pg_temp.eq('Drew, whose check lapsed: no groups', pg_temp.my_groups(), '');
select pg_temp.as_member('32');
select pg_temp.eq('Kai, an athlete who doesn''t captain: no groups', pg_temp.my_groups(), '');
select pg_temp.as_member('41');
select pg_temp.eq('Logan the parent: no groups', pg_temp.my_groups(), '');
select pg_temp.as_member('22');
select pg_temp.eq('Harper on the committee: no groups', pg_temp.my_groups(), '');
select pg_temp.as_member('01');
select pg_temp.eq('Alex the admin: no automatic groups', pg_temp.my_groups(), '');

-- A Head Physio is in every squad's and team's physio group.
update public.profiles set head_physio = true where id = pg_temp.id('14');
select pg_temp.as_member('11');
select pg_temp.eq('with Finley as Head Physio, the team gets a physio group too',
  pg_temp.my_groups(), 'Sample Squad coaches and managers, Sample Squad coaches and physios, Sample Team coaches and captains, Sample Team coaches and physios');
update public.profiles set head_physio = false where id = pg_temp.id('14');

-- ---------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.eq('Casey posts in the staff group', pg_temp.post('staff hello', 'staff', 'Bibs are in the shed'), 'posted');
select pg_temp.eq('it goes to the others in the group', pg_temp.got('staff hello'), '13,42');
select pg_temp.ok('their copies sit in the group, not the inbox', (select bool_and(chat_group_id = pg_temp.g('staff')) from public.message_recipients where message_id = pg_temp.p('staff hello')), true);
select pg_temp.ok('the message is a chat post named for its group', (select audience = 'chat' and audience_label = 'Sample Squad coaches and managers' and chat_group_id = pg_temp.g('staff') from public.messages where id = pg_temp.p('staff hello')), true);
select pg_temp.ok('group posts aren''t in Sent', exists (select 1 from public.my_sent_messages() where id = pg_temp.p('staff hello')), false);
select pg_temp.fails('an empty post is refused', $s$select public.post_to_chat_group(pg_temp.g('staff'), '   ')$s$, '%Write a message first%');
select pg_temp.fails('a post over 4000 characters is refused', $s$select public.post_to_chat_group(pg_temp.g('staff'), repeat('x', 4001))$s$, '%up to 4000%');

select pg_temp.as_member('32');
select pg_temp.eq('Kai can''t post in a group he isn''t in', pg_temp.post('kai', 'staff', 'Hi'), 'refused: You''re not in this group');
select pg_temp.ok('Kai reads none of its posts', exists (select 1 from public.chat_group_posts(pg_temp.g('staff'))), false);
select pg_temp.as_member('01');
select pg_temp.eq('an admin outside the group can''t post in it', pg_temp.post('admin', 'staff', 'Hi'), 'refused: You''re not in this group');
select pg_temp.ok('an admin outside the group reads none of its posts', exists (select 1 from public.chat_group_posts(pg_temp.g('staff'))), false);
set role authenticated;
select pg_temp.ok('an admin outside the group can''t select its posts', exists (select 1 from public.messages where id = pg_temp.p('staff hello')), false);
select pg_temp.as_member('13');
select pg_temp.ok('Emery can select the post he was sent', exists (select 1 from public.messages where id = pg_temp.p('staff hello')), true);
reset role;
select pg_temp.as_member('12');
select pg_temp.eq('Drew, whose check lapsed, can''t post', pg_temp.post('drew', 'staff', 'Hi'), 'refused: You''re not in this group');

-- The physio, who only looks, reads their group's posts.
select pg_temp.as_member('11');
select pg_temp.eq('Casey posts in the physio group', pg_temp.post('physio hello', 'physio', 'Jordan''s ankle?'), 'posted');
select pg_temp.as_member('14');
select pg_temp.ok('Finley reads it', (select count(*) = 1 from public.chat_group_posts(pg_temp.g('physio'))), true);
select pg_temp.ok('as a recipient of the message itself', public.is_message_recipient(pg_temp.p('physio hello')), true);
select pg_temp.eq('Finley answers', pg_temp.post('physio reply', 'physio', 'Cleared to jog'), 'posted');

-- ---------------------------------------------------------------------------
-- Members under 18
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.eq('Casey posts to the captains', pg_temp.post('captains 1', 'captains', 'Warm-up at 5:30'), 'posted');
select pg_temp.eq('Jordan gets it, and both parents get a copy', pg_temp.got('captains 1'), '31,41,42');
select pg_temp.eq('the parents'' copies name Jordan and sit in their inbox', pg_temp.copies('captains 1'), '41:Jordan Junior,42:Jordan Junior');
select pg_temp.as_member('31');
select pg_temp.eq('Jordan replies in the coach-led team group', pg_temp.post('captains 2', 'captains', 'I''ll bring the cones'), 'posted');
select pg_temp.eq('it goes to Casey and to Jordan''s parents', pg_temp.got('captains 2'), '11,41,42');
select pg_temp.eq('the parents'' copies name Jordan', pg_temp.copies('captains 2'), '41:Jordan Junior,42:Jordan Junior');
select pg_temp.ok('Jordan reads both posts', (select count(*) = 2 from public.chat_group_posts(pg_temp.g('captains'))), true);
select pg_temp.ok('Jordan doesn''t see who is in the group', exists (select 1 from public.chat_group_members(pg_temp.g('captains'))), false);
select pg_temp.as_member('11');
select pg_temp.ok('Casey sees who is in the group, Jordan named Captain', (select detail = 'Captain' and under_18 from public.chat_group_members(pg_temp.g('captains')) where profile_id = pg_temp.id('31')), true);
select pg_temp.as_member('41');
select pg_temp.ok('Logan reads the copy of Jordan''s post', public.is_message_recipient(pg_temp.p('captains 2')), true);
select pg_temp.ok('Logan doesn''t get the group itself', exists (select 1 from public.my_chat_groups()), false);
select pg_temp.eq('Logan can''t post in it', pg_temp.post('logan', 'captains', 'Hi'), 'refused: You''re not in this group');

-- No coach in the group: not coach-led, so Jordan reads only.
update public.profiles set stood_down_at = now() where id = pg_temp.id('11');
select pg_temp.as_member('31');
select pg_temp.eq('with the coach stood down, Jordan can''t post', pg_temp.post('no coach', 'captains', 'Anyone?'), 'refused: Members under 18 can post only in their own squad''s or team''s groups while a coach is in them');
select pg_temp.eq('and is told why', (pg_temp.mine('captains')).read_only_reason, 'under_18');
select pg_temp.as_member('11');
select pg_temp.eq('the stood-down coach has no groups', pg_temp.my_groups(), '');
select pg_temp.ok('and reads none of the posts', exists (select 1 from public.chat_group_posts(pg_temp.g('captains'))), false);
update public.profiles set stood_down_at = null where id = pg_temp.id('11');

-- A captain with no verified parent or guardian: the groups are hidden from
-- them until one is linked, and the parent then gets copies (Matt, 24 November).
update public.profiles set verified_at = null where id in (pg_temp.id('41'), pg_temp.id('42'));
select pg_temp.eq('with no verified parent, Jordan stays in the captains group', pg_temp.people('captains'), '11,31');
select pg_temp.as_member('31');
select pg_temp.eq('but the groups are hidden from Jordan', pg_temp.my_groups(), '');
select pg_temp.ok('and so are the posts', exists (select 1 from public.chat_group_posts(pg_temp.g('captains'))), false);
select pg_temp.ok('even the message itself', public.is_message_recipient(pg_temp.p('captains 1')), false);
select pg_temp.eq('and Jordan can''t post', pg_temp.post('unguarded', 'captains', 'Hello?'), 'refused: Members under 18 can post only in their own squad''s or team''s groups while a coach is in them');
select pg_temp.as_member('11');
select pg_temp.eq('Casey posts meanwhile', pg_temp.post('while hidden', 'captains', 'Training is on'), 'posted');
select pg_temp.ok('it still reaches Jordan, hidden for now', exists (select 1 from public.message_recipients where message_id = pg_temp.p('while hidden') and profile_id = pg_temp.id('31')), true);
-- A new parent, Pat, is linked and verified.
insert into auth.users (id, email, email_confirmed_at) values (pg_temp.id('43'), 'pat@example.test', now());
update public.profiles set status = 'approved', full_name = 'Pat Parent', role = 'guardian', verified_at = now() where id = pg_temp.id('43');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('43'), pg_temp.id('31'));
select pg_temp.ok('Pat gets a copy of every group post Jordan was sent or wrote, naming Jordan',
  (select count(*) = 3 and bool_and(r.for_child_names = array['Jordan Junior'] and r.chat_group_id is null)
   from public.message_recipients r join public.messages m on m.id = r.message_id
   where r.profile_id = pg_temp.id('43') and m.audience = 'chat'), true);
select pg_temp.ok('Logan''s copies aren''t doubled', (select count(*) = 3 from public.message_recipients r join public.messages m on m.id = r.message_id where r.profile_id = pg_temp.id('41') and m.audience = 'chat'), true);
select pg_temp.as_member('31');
select pg_temp.eq('with Pat linked, Jordan sees the group again', pg_temp.my_groups(), 'Sample Team coaches and captains');
select pg_temp.ok('with what was posted meanwhile', exists (select 1 from public.chat_group_posts(pg_temp.g('captains')) where id = pg_temp.p('while hidden')), true);
select pg_temp.ok('and can post again', (pg_temp.mine('captains')).can_post, true);
select pg_temp.as_member('43');
select pg_temp.ok('Pat reads the copy', public.is_message_recipient(pg_temp.p('while hidden')), true);
update public.profiles set verified_at = now() where id in (pg_temp.id('41'), pg_temp.id('42'));
-- Linking a parent to an adult adds no copies.
insert into auth.users (id, email, email_confirmed_at) values (pg_temp.id('44'), 'quinn@example.test', now());
update public.profiles set status = 'approved', full_name = 'Quinn', role = 'guardian', verified_at = now() where id = pg_temp.id('44');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('44'), pg_temp.id('11'));
select pg_temp.ok('a link to an adult adds no copies', exists (select 1 from public.message_recipients r join public.messages m on m.id = r.message_id where r.profile_id = pg_temp.id('44') and m.audience = 'chat'), false);

-- ---------------------------------------------------------------------------
-- Removing posts
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.fails('Jordan can''t remove a post', $s$select public.remove_chat_post(pg_temp.p('captains 1'))$s$, '%Only the group''s coaches%');
select pg_temp.as_member('13');
select pg_temp.fails('Emery the manager can''t remove a post in the staff group', $s$select public.remove_chat_post(pg_temp.p('staff hello'))$s$, '%Only the group''s coaches%');
select pg_temp.as_member('01');
select pg_temp.fails('an admin outside the group can''t remove a post', $s$select public.remove_chat_post(pg_temp.p('captains 2'))$s$, '%Only the group''s coaches%');
select pg_temp.fails('only group posts can be removed', $s$select public.remove_chat_post(gen_random_uuid())$s$, '%doesn''t exist%');
select pg_temp.as_member('11');
select pg_temp.ok('Casey can remove posts in his groups', (pg_temp.mine('captains')).can_remove, true);
select public.remove_chat_post(pg_temp.p('captains 2'));
select pg_temp.ok('the coach who hid it still sees it, text and who hid it', (select body = 'I''ll bring the cones' and removed_by_name = 'Casey Coach' from public.chat_group_posts(pg_temp.g('captains')) where id = pg_temp.p('captains 2')), true);
select pg_temp.ok('the text is kept', (select body = 'I''ll bring the cones' and removed_by = pg_temp.id('11') from public.messages where id = pg_temp.p('captains 2')), true);
select public.remove_chat_post(pg_temp.p('captains 2'));
select pg_temp.ok('hiding twice keeps the first', (select count(*) = 1 from public.messages where id = pg_temp.p('captains 2') and removed_by_name = 'Casey Coach'), true);
select pg_temp.as_member('31');
select pg_temp.ok('Jordan, its author, still sees it, marked hidden', (select body = 'I''ll bring the cones' and removed_by_name = 'Casey Coach' from public.chat_group_posts(pg_temp.g('captains')) where id = pg_temp.p('captains 2')), true);
select pg_temp.as_member('41');
select pg_temp.ok('Logan, the author''s parent, keeps his copy', public.is_message_recipient(pg_temp.p('captains 2')), true);
select pg_temp.as_member('11');
select public.remove_chat_post(pg_temp.p('captains 1'));
select pg_temp.as_member('31');
select pg_temp.ok('a hidden post is gone for the rest of the group', exists (select 1 from public.chat_group_posts(pg_temp.g('captains')) where id = pg_temp.p('captains 1')), false);
select pg_temp.ok('including opening it on its own', public.is_message_recipient(pg_temp.p('captains 1')), false);
select pg_temp.ok('and it isn''t the group''s last post for them', (pg_temp.mine('captains')).last_post is distinct from 'Warm-up at 5:30', true);
select pg_temp.as_member('41');
select pg_temp.ok('the other members'' parents lose their copies', public.is_message_recipient(pg_temp.p('captains 1')), false);
select pg_temp.as_member('11');
select pg_temp.ok('its author still sees it', exists (select 1 from public.chat_group_posts(pg_temp.g('captains')) where id = pg_temp.p('captains 1') and removed_by_name is not null), true);
select pg_temp.as_member('31');
select pg_temp.fails('Jordan can''t show it again', $s$select public.show_chat_post(pg_temp.p('captains 1'))$s$, '%Only the group''s coaches%');
select pg_temp.as_member('11');
select public.show_chat_post(pg_temp.p('captains 1'));
select pg_temp.as_member('31');
select pg_temp.ok('shown again, the group sees it', exists (select 1 from public.chat_group_posts(pg_temp.g('captains')) where id = pg_temp.p('captains 1') and removed_by_name is null), true);
select pg_temp.as_member('41');
select pg_temp.ok('and the parents'' copies come back', public.is_message_recipient(pg_temp.p('captains 1')), true);

-- ---------------------------------------------------------------------------
-- Reading and hiding
-- ---------------------------------------------------------------------------
select pg_temp.as_member('13');
select pg_temp.ok('Emery has one unread post in the staff group', (pg_temp.mine('staff')).unread_count = 1, true);
select public.mark_all_messages_read();
select pg_temp.ok('Mark all read in the Inbox leaves group posts unread', (pg_temp.mine('staff')).unread_count = 1, true);
select public.set_chat_group_hidden(pg_temp.g('staff'), true);
select pg_temp.ok('hiding marks the group''s posts read for Emery', (pg_temp.mine('staff')).unread_count = 0 and (pg_temp.mine('staff')).hidden, true);
select pg_temp.ok('without a receipt: Casey still sees it unread by Emery', (select read_at is null from public.message_recipients where message_id = pg_temp.p('staff hello') and profile_id = pg_temp.id('13')), true);
select pg_temp.as_member('11');
select pg_temp.eq('a new post', pg_temp.post('staff 2', 'staff', 'Kit order closes Friday'), 'posted');
select pg_temp.ok('reaches Emery already marked read', (select not unread and read_at is null from public.message_recipients where message_id = pg_temp.p('staff 2') and profile_id = pg_temp.id('13')), true);
select pg_temp.ok('and reaches Morgan unread', (select unread from public.message_recipients where message_id = pg_temp.p('staff 2') and profile_id = pg_temp.id('42')), true);
select pg_temp.as_member('13');
select public.set_chat_group_hidden(pg_temp.g('staff'), false);
select pg_temp.ok('Emery shows the group again', (pg_temp.mine('staff')).hidden, false);
select public.mark_chat_group_read(pg_temp.g('staff'));
select pg_temp.ok('opening the group sets Emery''s receipts', (select bool_and(read_at is not null) from public.message_recipients where profile_id = pg_temp.id('13') and chat_group_id = pg_temp.g('staff')), true);
select pg_temp.as_member('11');
select pg_temp.ok('Casey''s post shows read by 1 of 2', (select read_count = 1 and recipient_count = 2 from public.chat_group_posts(pg_temp.g('staff')) where id = pg_temp.p('staff hello')), true);
select pg_temp.ok('the latest page has the newest post', exists (select 1 from public.chat_group_posts(pg_temp.g('staff')) where id = pg_temp.p('staff 2')), true);
select pg_temp.ok('scrolling up gives only older posts', (select bool_and(created_at < (select created_at from public.messages where id = pg_temp.p('staff 2'))) and count(*) > 0 from public.chat_group_posts(pg_temp.g('staff'), (select created_at from public.messages where id = pg_temp.p('staff 2')))), true);
select pg_temp.ok('and not the newest', exists (select 1 from public.chat_group_posts(pg_temp.g('staff'), (select created_at from public.messages where id = pg_temp.p('staff 2'))) where id = pg_temp.p('staff 2')), false);
select pg_temp.ok('nothing before the first post', exists (select 1 from public.chat_group_posts(pg_temp.g('staff'), (select min(created_at) from public.messages where chat_group_id = pg_temp.g('staff')))), false);

-- ---------------------------------------------------------------------------
-- Admins' groups
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t set up groups', $s$select public.admin_save_chat_group(null, 'Mine', '{coach}', '{}', '{}')$s$, '%Only admins%');
select pg_temp.fails('a coach can''t preview one', $s$select public.admin_chat_group_preview('{coach}', '{}', '{}')$s$, '%Only admins%');
select pg_temp.ok('a coach sees no admins'' groups', exists (select 1 from public.admin_chat_groups()), false);
select pg_temp.as_member('01');
select pg_temp.fails('a name is needed', $s$select public.admin_save_chat_group(null, ' ', '{committee}', '{}', '{}')$s$, '%Give the group a name%');
select pg_temp.fails('someone must be chosen', $s$select public.admin_save_chat_group(null, 'Empty', '{}', '{}', '{}')$s$, '%Choose roles%');
select pg_temp.fails('guests can''t be chosen', $s$select public.admin_save_chat_group(null, 'Guests', '{guest}', '{}', '{}')$s$, '%don''t get messages%');
select pg_temp.fails('in teams, only team roles', $s$select public.admin_save_chat_group(null, 'Odd', '{committee}', array[pg_temp.id('a1')], '{}')$s$, '%choose athletes, coaches, managers or physios%');
select pg_temp.ok('the committee plus Alex comes to four people', (select member_count = 4 and under_18_count = 0 from public.admin_chat_group_preview('{committee}', '{}', array[pg_temp.id('01')])), true);
insert into grp values ('committee', public.admin_save_chat_group(null, 'Committee chat', '{committee}', '{}', array[pg_temp.id('01')]));
select pg_temp.fails('names are unique among open groups', $s$select public.admin_save_chat_group(null, 'committee CHAT', '{committee}', '{}', '{}')$s$, '%already a group called%');
-- A group an admin sets up shows straight away, even with only them in it
-- (Matt, 24 November 2026); posting waits for someone else.
insert into grp values ('just me', public.admin_save_chat_group(null, 'Just me', '{}', '{}', array[pg_temp.id('01')]));
select pg_temp.ok('Alex sees the group he set up with only himself in it', (pg_temp.mine('just me')).member_count = 1, true);
select pg_temp.ok('and can open it', exists (select 1 from public.chat_group_members(pg_temp.g('just me'))), true);
select pg_temp.fails('but can''t post until someone else is in it', $s$select public.post_to_chat_group(pg_temp.g('just me'), 'Hello?')$s$, '%Nobody else is in this group yet%');
select public.admin_set_chat_group_closed(pg_temp.g('just me'), true);
select pg_temp.eq('committee group members', pg_temp.people('committee'), '01,21,22,23');
select pg_temp.eq('Alex posts in it', pg_temp.post('committee 1', 'committee', 'AGM agenda attached'), 'posted');
select pg_temp.as_member('22');
select pg_temp.eq('Harper sees it', pg_temp.my_groups(), 'Committee chat');
select pg_temp.eq('Harper answers', pg_temp.post('committee 2', 'committee', 'Thanks'), 'posted');
select pg_temp.ok('Harper can''t remove posts (not a coach or admin)', (pg_temp.mine('committee')).can_remove, false);
select pg_temp.as_member('01');
select pg_temp.ok('Alex, in it, can remove posts', (pg_temp.mine('committee')).can_remove, true);

-- An admin's group of a squad's athletes, with a member under 18.
select pg_temp.ok('the squad''s athletes: two, one under 18', (select member_count = 2 and under_18_count = 1 from public.admin_chat_group_preview('{athlete}', array[pg_temp.id('a1')], '{}')), true);
insert into grp values ('athletes', public.admin_save_chat_group(null, 'Squad athletes', '{athlete}', array[pg_temp.id('a1')], '{}'));
select pg_temp.ok('Alex, not in it, isn''t listed in it', pg_temp.mine('athletes') is null, true);
select pg_temp.eq('Alex can''t post in it', pg_temp.post('athletes admin', 'athletes', 'Hi'), 'refused: You''re not in this group');
select pg_temp.ok('Alex sees who is in it on the admin screen', (select count(*) = 2 from public.chat_group_members(pg_temp.g('athletes'))), true);
select pg_temp.ok('and its counts, with no posts', (select member_count = 2 and under_18_count = 1 and post_count = 0 from public.admin_chat_groups() where id = pg_temp.g('athletes')), true);
select pg_temp.as_member('32');
select pg_temp.eq('Kai posts to the squad''s athletes', pg_temp.post('athletes 1', 'athletes', 'Car pool on Sunday?'), 'posted');
select pg_temp.eq('Jordan gets it, and Jordan''s parents get copies', pg_temp.got('athletes 1'), '31,41,42,43');
select pg_temp.as_member('31');
select pg_temp.eq('Jordan reads only in an admin''s group', pg_temp.post('athletes 2', 'athletes', 'Yes please'), 'refused: Members under 18 can post only in their own squad''s or team''s groups while a coach is in them');
select pg_temp.eq('and is told why', (pg_temp.mine('athletes')).read_only_reason, 'under_18');

-- Changing a group applies from then on; what was sent stays.
select pg_temp.as_member('01');
select public.admin_save_chat_group(pg_temp.g('athletes'), 'Squad athletes', '{}', '{}', array[pg_temp.id('32')]);
select pg_temp.eq('now just Kai', pg_temp.people('athletes'), '32');
select pg_temp.as_member('31');
select pg_temp.ok('Jordan keeps what he was sent, read only', (select count(*) = 1 from public.chat_group_posts(pg_temp.g('athletes'))), true);
select pg_temp.eq('marked as left', (pg_temp.mine('athletes')).read_only_reason, 'left');
select pg_temp.as_member('01');
select pg_temp.fails('automatic groups can''t be changed', $s$select public.admin_save_chat_group(pg_temp.g('staff'), 'Mine', '{coach}', '{}', '{}')$s$, '%Only groups admins set up%');

-- Closing keeps every post; nobody adds to it.
select public.admin_set_chat_group_closed(pg_temp.g('committee'), true);
select pg_temp.as_member('22');
select pg_temp.eq('nobody posts in a closed group', pg_temp.post('closed', 'committee', 'Hello?'), 'refused: This group is closed. Its posts are kept, but nobody can add to it');
select pg_temp.ok('its posts are still there', (select count(*) = 2 from public.chat_group_posts(pg_temp.g('committee'))), true);
select pg_temp.eq('and Harper is told why', (pg_temp.mine('committee')).read_only_reason, 'closed');
select pg_temp.as_member('01');
select pg_temp.fails('automatic groups can''t be closed', $s$select public.admin_set_chat_group_closed(pg_temp.g('staff'), true)$s$, '%Only groups admins set up%');
select public.admin_set_chat_group_closed(pg_temp.g('committee'), false);
select pg_temp.as_member('22');
select pg_temp.eq('opened again, Harper can post', pg_temp.post('reopened', 'committee', 'Back again'), 'posted');

-- ---------------------------------------------------------------------------
-- Switched off again: paused, nothing deleted
-- ---------------------------------------------------------------------------
update public.club_settings set features = features || '{"chatGroups": false}' where id;
select pg_temp.as_member('11');
select pg_temp.eq('off, Casey has no groups', pg_temp.my_groups(), '');
select pg_temp.eq('off, nobody posts', pg_temp.post('off', 'staff', 'Hi'), 'refused: Chat groups are turned off for the club');
select pg_temp.ok('off, the posts are all still there', (select count(*) from public.messages where audience = 'chat') = (select count(*) from posts), true);
select pg_temp.as_member('41');
select pg_temp.ok('a parent''s copy stays in their inbox', public.is_message_recipient(pg_temp.p('captains 1')), true);
