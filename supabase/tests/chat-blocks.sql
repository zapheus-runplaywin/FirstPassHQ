-- Tests for 20261125400000_chat_blocks.sql: blocking in chat groups. Run on
-- a database with the migrations and seed-members.sql loaded. Prints one
-- line per check.
--
-- The rules under test, each for every kind of member, both ways:
--   - a member blocks the author of a post in one of their groups, and that
--     author's posts then leave their group list, last post and unread count;
--     the author isn't told and still sees the blocker's posts;
--   - a parent's inbox copy of a post to or from their child is never hidden
--     by a block, and a parent can't block from that copy;
--   - an adult can't block a member under 18; a member under 18 can block
--     an adult;
--   - nobody blocks themselves, or from a post they weren't sent;
--   - admins, the Child Safety Officer and the Complaints Manager see every
--     block in the register and get a to-do until it's followed up, except a
--     block they're part of; nobody else sees any;
--   - a follow-up is recorded once, by them only;
--   - unblocking shows the posts again and keeps the record;
--   - with chat groups off, nobody blocks.
--
-- Sample Squad (a1): head coach Casey (11, Child Safety Officer here),
-- assistant coach Morgan (42, also Jordan's parent), manager Emery (13),
-- physio Finley (14, Complaints Manager here), athletes Jordan (31, 14 years
-- old, captain of Sample Team a2) and Kai (32, adult). Jordan's parents are
-- Logan (41) and Morgan (42). Admins Alex (01) and Blair (02). Committee
-- Harper (22).
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
create or replace function pg_temp.post(label text, grp_label text, body text) returns text language plpgsql as
$$ begin insert into posts values (label, public.post_to_chat_group(pg_temp.g(grp_label), body)); return 'posted';
   exception when others then return 'refused: ' || sqlerrm; end $$;
-- The bodies of a group's posts the signed-in member sees, in order.
create or replace function pg_temp.seen(grp_label text) returns text language sql as
$$ select coalesce(string_agg(body, ' | ' order by created_at), '') from public.chat_group_posts(pg_temp.g(grp_label)) $$;
create or replace function pg_temp.unread(grp_label text) returns int language sql as
$$ select unread_count from public.my_chat_groups() where id = pg_temp.g(grp_label) $$;
create or replace function pg_temp.last(grp_label text) returns text language sql as
$$ select last_post from public.my_chat_groups() where id = pg_temp.g(grp_label) $$;
-- The register the signed-in member sees, as "blocker>blocked".
create or replace function pg_temp.register() returns text language sql as
$$ select coalesce(string_agg(blocker_name || '>' || blocked_name, ', ' order by blocker_name, blocked_name), '') from public.chat_block_register() $$;
create or replace function pg_temp.waiting() returns int language sql as
$$ select waiting from public.chat_blocks_waiting() $$;
create or replace function pg_temp.block_todo(n text) returns boolean language sql security definer as
$$ select exists (select 1 from public.member_todos(pg_temp.id(n)) t where t.todo_key like 'chat-blocks:%' and t.href = '/concerns/blocks') $$;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('anon can call none of it', bool_or(has_function_privilege('anon', f, 'execute')), false)
from unnest(array['public.block_chat_member(uuid)', 'public.unblock_chat_member(uuid)', 'public.my_chat_blocks()',
  'public.chat_member_blocked(uuid)', 'public.chat_block_register()', 'public.chat_blocks_waiting()',
  'public.follow_up_chat_block(uuid, text)']) f;
select pg_temp.ok('members can block, unblock, list and follow up', bool_and(has_function_privilege('authenticated', f, 'execute')), true)
from unnest(array['public.block_chat_member(uuid)', 'public.unblock_chat_member(uuid)', 'public.my_chat_blocks()',
  'public.chat_member_blocked(uuid)', 'public.chat_block_register()', 'public.chat_blocks_waiting()',
  'public.follow_up_chat_block(uuid, text)']) f;
select pg_temp.ok('the inner rules aren''t for the app to call', bool_or(has_function_privilege('authenticated', f, 'execute')), false)
from unnest(array['public.chat_post_blocked_for_me(uuid)', 'public.can_follow_up_chat_block(public.chat_blocks)',
  'public.member_todos_before_blocks(uuid, timestamptz)', 'public.member_todos(uuid, timestamptz)']) f;
select pg_temp.ok('members can''t read or change the blocks table', has_table_privilege('authenticated', 'public.chat_blocks', 'select')
  or has_table_privilege('authenticated', 'public.chat_blocks', 'insert') or has_table_privilege('anon', 'public.chat_blocks', 'select'), false);
select pg_temp.ok('the blocks table has row level security', (select relrowsecurity from pg_class where oid = 'public.chat_blocks'::regclass), true);

-- ---------------------------------------------------------------------------
-- Setting up: chat groups on, a Child Safety Officer and a Complaints Manager
-- ---------------------------------------------------------------------------
update public.club_settings set features = coalesce(features, '{}') || '{"chatGroups": true}' where id;
delete from public.safeguarding_post_holders;
insert into public.safeguarding_post_holders (post, profile_id) values
  ('child_safety_officer', pg_temp.id('11')), ('complaints_manager', pg_temp.id('14'));
insert into public.team_captains (team_id, profile_id, captain_role)
values (pg_temp.id('a2'), pg_temp.id('31'), 'captain');
select pg_temp.as_member('11');
do $$ begin perform * from public.my_chat_groups(); end $$;
insert into grp select 'staff', id from public.chat_groups where kind = 'team_staff' and team_id = pg_temp.id('a1');
insert into grp select 'captains', id from public.chat_groups where kind = 'team_captains' and team_id = pg_temp.id('a2');

select pg_temp.eq('Casey posts in the staff group', pg_temp.post('casey 1', 'staff', 'Casey one'), 'posted');
select pg_temp.as_member('42');
select pg_temp.eq('Morgan posts in it', pg_temp.post('morgan 1', 'staff', 'Morgan one'), 'posted');

-- ---------------------------------------------------------------------------
-- An adult blocks an adult
-- ---------------------------------------------------------------------------
select pg_temp.as_member('13');
select pg_temp.eq('before blocking, Emery sees both posts', pg_temp.seen('staff'), 'Casey one | Morgan one');
select pg_temp.ok('Emery hasn''t blocked Casey yet', public.chat_member_blocked(pg_temp.id('11')), false);
select pg_temp.ok('Emery blocks Casey from Casey''s post', public.block_chat_member(pg_temp.p('casey 1')) is not null, true);
select pg_temp.ok('Emery has blocked Casey', public.chat_member_blocked(pg_temp.id('11')), true);
select pg_temp.eq('Emery no longer sees Casey''s posts', pg_temp.seen('staff'), 'Morgan one');
select pg_temp.eq('Blocked people lists Casey, with the group', (select string_agg(name || ' in ' || group_name, ', ') from public.my_chat_blocks()), 'Casey Coach in Sample Squad coaches and managers');
select pg_temp.ok('blocking again adds nothing', public.block_chat_member(pg_temp.p('casey 1')) = (select id from public.chat_blocks where blocker_id = pg_temp.id('13') and unblocked_at is null), true);
select pg_temp.ok('one standing block', (select count(*) from public.chat_blocks where blocker_id = pg_temp.id('13')) = 1, true);

select pg_temp.as_member('11');
select pg_temp.eq('Casey posts again', pg_temp.post('casey 2', 'staff', 'Casey two'), 'posted');
select pg_temp.ok('Casey''s new post still goes to Emery (nothing tells Casey)', exists (select 1 from public.message_recipients where message_id = pg_temp.p('casey 2') and profile_id = pg_temp.id('13')), true);
select pg_temp.ok('Casey isn''t told: Casey can''t see who blocked them', exists (select 1 from public.my_chat_blocks()), false);
select pg_temp.as_member('13');
select pg_temp.eq('Emery doesn''t see it', pg_temp.seen('staff'), 'Morgan one');
select pg_temp.ok('nor count it as unread (only Morgan''s post is)', pg_temp.unread('staff') = 1, true);
select pg_temp.eq('nor show it as the last post', pg_temp.last('staff'), 'Morgan one');
select pg_temp.eq('Emery posts', pg_temp.post('emery 1', 'staff', 'Emery one'), 'posted');
select pg_temp.as_member('11');
select pg_temp.ok('it is one way: Casey still sees Emery''s post', pg_temp.seen('staff') like '%Emery one%', true);
select pg_temp.as_member('42');
select pg_temp.eq('Morgan, who blocked nobody, sees everything', pg_temp.seen('staff'), 'Casey one | Morgan one | Casey two | Emery one');

-- Refusals.
select pg_temp.as_member('13');
select pg_temp.fails('Emery can''t block themselves', $s$select public.block_chat_member(pg_temp.p('emery 1'))$s$, '%can''t block yourself%');
select pg_temp.as_member('32');
select pg_temp.fails('Kai, not in the group, can''t block from its post', $s$select public.block_chat_member(pg_temp.p('casey 1'))$s$, '%one of your groups%');
select pg_temp.as_member('01');
select pg_temp.fails('an admin outside the group can''t block from its post', $s$select public.block_chat_member(pg_temp.p('casey 1'))$s$, '%one of your groups%');
select pg_temp.fails('a club message isn''t a group post', $s$select public.block_chat_member(gen_random_uuid())$s$, '%one of your groups%');

-- ---------------------------------------------------------------------------
-- Members under 18, and their parents
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.eq('Casey posts to the captains', pg_temp.post('captains casey', 'captains', 'Captains from Casey'), 'posted');
select pg_temp.as_member('31');
select pg_temp.eq('Jordan posts', pg_temp.post('captains jordan', 'captains', 'Captains from Jordan'), 'posted');
select pg_temp.as_member('11');
select pg_temp.fails('Casey, an adult, can''t block Jordan, who is under 18', $s$select public.block_chat_member(pg_temp.p('captains jordan'))$s$, '%Adults can''t block a member under 18%');
select pg_temp.ok('Casey still sees Jordan''s post', pg_temp.seen('captains') like '%Captains from Jordan%', true);
select pg_temp.as_member('41');
select pg_temp.fails('Logan can''t block from their inbox copy of a post to their child', $s$select public.block_chat_member(pg_temp.p('captains casey'))$s$, '%one of your groups%');
select pg_temp.as_member('31');
select pg_temp.ok('Jordan, under 18, blocks Casey, an adult', public.block_chat_member(pg_temp.p('captains casey')) is not null, true);
select pg_temp.eq('Jordan no longer sees Casey''s posts', pg_temp.seen('captains'), 'Captains from Jordan');
select pg_temp.ok('the record says Jordan is under 18', (select blocker_under_18 and not blocked_under_18 from public.chat_blocks where blocker_id = pg_temp.id('31')), true);
select pg_temp.as_member('11');
select pg_temp.eq('Casey posts again', pg_temp.post('captains casey 2', 'captains', 'Captains from Casey again'), 'posted');
select pg_temp.as_member('41');
select pg_temp.ok('Logan still gets their copy of Casey''s post to Jordan', public.is_message_recipient(pg_temp.p('captains casey 2')), true);
select pg_temp.ok('and can open it', exists (select 1 from public.message_recipients where message_id = pg_temp.p('captains casey 2') and profile_id = pg_temp.id('41')), true);
select pg_temp.as_member('42');
select pg_temp.ok('Morgan, Jordan''s other parent, gets a copy too', public.is_message_recipient(pg_temp.p('captains casey 2')), true);
select pg_temp.as_member('31');
select pg_temp.ok('Jordan can still open the post itself (reporting it stays possible)', public.is_message_recipient(pg_temp.p('captains casey 2')), true);

-- ---------------------------------------------------------------------------
-- Telling admins and safeguarding
-- ---------------------------------------------------------------------------
-- A third block, by Morgan of Emery, which the Child Safety Officer isn't part of.
select pg_temp.as_member('42');
select pg_temp.ok('Morgan blocks Emery', public.block_chat_member(pg_temp.p('emery 1')) is not null, true);

select pg_temp.as_member('01');
select pg_temp.eq('Alex the admin sees every block', pg_temp.register(), 'Emery Manager>Casey Coach, Jordan Junior>Casey Coach, Morgan Coach-Parent>Emery Manager');
select pg_temp.ok('and has 3 to follow up', pg_temp.waiting() = 3, true);
select pg_temp.as_member('02');
select pg_temp.ok('Blair, an admin with no check, sees them too', pg_temp.waiting() = 3, true);
select pg_temp.as_member('11');
select pg_temp.eq('Casey, the Child Safety Officer, sees only the block they aren''t part of', pg_temp.register(), 'Morgan Coach-Parent>Emery Manager');
select pg_temp.as_member('14');
select pg_temp.eq('Finley, the Complaints Manager, sees every block', pg_temp.register(), 'Emery Manager>Casey Coach, Jordan Junior>Casey Coach, Morgan Coach-Parent>Emery Manager');
select pg_temp.as_member('13');
select pg_temp.eq('Emery, a manager, sees none', pg_temp.register(), '');
select pg_temp.ok('and has nothing to follow up', pg_temp.waiting() = 0, true);
select pg_temp.as_member('31');
select pg_temp.eq('Jordan sees none', pg_temp.register(), '');
select pg_temp.as_member('41');
select pg_temp.eq('Logan, a parent, sees none', pg_temp.register(), '');
select pg_temp.as_member('32');
select pg_temp.eq('Kai, an athlete, sees none', pg_temp.register(), '');
select pg_temp.as_member('22');
select pg_temp.eq('Harper, on the committee, sees none', pg_temp.register(), '');
select pg_temp.as_member('14');
select pg_temp.ok('the register never carries a post', exists (
  select 1 from information_schema.routines r
  join information_schema.parameters p on p.specific_name = r.specific_name
  where r.routine_name = 'chat_block_register' and p.parameter_name in ('body', 'post', 'message_id')), false);

-- To-dos, for push too.
select pg_temp.ok('Alex gets a to-do', pg_temp.block_todo('01'), true);
select pg_temp.ok('Finley gets a to-do', pg_temp.block_todo('14'), true);
select pg_temp.ok('Casey gets a to-do for the block they aren''t part of', pg_temp.block_todo('11'), true);
select pg_temp.ok('Emery gets none', pg_temp.block_todo('13'), false);
select pg_temp.ok('Logan gets none', pg_temp.block_todo('41'), false);
select pg_temp.ok('Jordan gets none', pg_temp.block_todo('31'), false);
select pg_temp.ok('the to-do names nobody', (select bool_and(title not like '%Casey%' and title not like '%Jordan%' and detail not like '%Casey%' and detail not like '%Jordan%')
  from public.member_todos(pg_temp.id('01')) t where t.todo_key like 'chat-blocks:%'), true);
select pg_temp.ok('the rest of the to-do list is still there', (select count(*) from public.member_todos(pg_temp.id('01'))) = (select count(*) from public.member_todos_before_blocks(pg_temp.id('01'))) + 1, true);

-- Following up.
create temp table b (k text primary key, id uuid);
insert into b select 'emery', id from public.chat_blocks where blocker_id = pg_temp.id('13');
insert into b select 'jordan', id from public.chat_blocks where blocker_id = pg_temp.id('31');
insert into b select 'morgan', id from public.chat_blocks where blocker_id = pg_temp.id('42');
grant select on b to public;
select pg_temp.as_member('32');
select pg_temp.fails('Kai can''t record a follow-up', $s$select public.follow_up_chat_block((select id from b where k = 'jordan'), 'x')$s$, '%Only admins%');
select pg_temp.as_member('11');
select pg_temp.fails('Casey can''t follow up a block they''re part of', $s$select public.follow_up_chat_block((select id from b where k = 'jordan'), 'x')$s$, '%Only admins%');
select pg_temp.as_member('13');
select pg_temp.fails('Emery can''t follow up their own block', $s$select public.follow_up_chat_block((select id from b where k = 'emery'), 'x')$s$, '%Only admins%');
select pg_temp.as_member('14');
select pg_temp.fails('a note over 1000 characters is refused', $s$select public.follow_up_chat_block((select id from b where k = 'jordan'), repeat('x', 1001))$s$, '%1000%');
select public.follow_up_chat_block((select id from b where k = 'jordan'), '  Spoke to Jordan and Logan  ');
select pg_temp.eq('Finley''s follow-up is recorded with their name and note', (select followed_up_by_name || ': ' || follow_up_note from public.chat_block_register() where id = (select id from b where k = 'jordan')), 'Finley Physio: Spoke to Jordan and Logan');
select pg_temp.fails('it is recorded once', $s$select public.follow_up_chat_block((select id from b where k = 'jordan'), 'again')$s$, '%already followed up%');
select pg_temp.ok('Finley has 2 left', pg_temp.waiting() = 2, true);
select pg_temp.as_member('01');
select pg_temp.ok('so has Alex', pg_temp.waiting() = 2, true);
select pg_temp.ok('the followed-up block sits last', (select id from public.chat_block_register() offset 2 limit 1) = (select id from b where k = 'jordan'), true);
select public.follow_up_chat_block((select id from b where k = 'emery'), null);
select public.follow_up_chat_block((select id from b where k = 'morgan'), '');
select pg_temp.ok('with every block followed up, nothing waits', pg_temp.waiting() = 0, true);
select pg_temp.ok('and the to-do goes', pg_temp.block_todo('01'), false);
select pg_temp.ok('an empty note is kept as none', (select follow_up_note is null from public.chat_blocks where id = (select id from b where k = 'morgan')), true);

-- ---------------------------------------------------------------------------
-- Unblocking
-- ---------------------------------------------------------------------------
select pg_temp.as_member('13');
select public.unblock_chat_member(pg_temp.id('11'));
select pg_temp.ok('Emery has unblocked Casey', public.chat_member_blocked(pg_temp.id('11')), false);
select pg_temp.eq('Emery sees Casey''s posts again', pg_temp.seen('staff'), 'Casey one | Morgan one | Casey two | Emery one');
select pg_temp.ok('Blocked people is empty', exists (select 1 from public.my_chat_blocks()), false);
select pg_temp.as_member('32');
select public.unblock_chat_member(pg_temp.id('11'));
select pg_temp.ok('Kai unblocking someone they never blocked changes nothing', (select count(*) from public.chat_blocks where unblocked_at is not null) = 1, true);
select pg_temp.as_member('01');
select pg_temp.ok('the register keeps the block, marked unblocked', (select unblocked_at is not null from public.chat_block_register() where id = (select id from b where k = 'emery')), true);
select pg_temp.as_member('13');
select pg_temp.ok('Emery blocks Casey again', public.block_chat_member(pg_temp.p('casey 2')) <> (select id from b where k = 'emery'), true);
select pg_temp.as_member('01');
select pg_temp.ok('a new block waits for follow-up again', pg_temp.waiting() = 1, true);
select pg_temp.ok('and the to-do comes back', pg_temp.block_todo('01'), true);

-- ---------------------------------------------------------------------------
-- Switched off, and nothing lost
-- ---------------------------------------------------------------------------
update public.club_settings set features = features || '{"chatGroups": false}' where id;
select pg_temp.as_member('42');
select pg_temp.fails('with chat groups off, nobody blocks', $s$select public.block_chat_member(pg_temp.p('casey 2'))$s$, '%turned off%');
select pg_temp.ok('no post was deleted by blocking', (select count(*) from public.messages where id in (select id from posts)) = (select count(*) from posts), true);
