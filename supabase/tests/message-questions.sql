-- Tests for 20261120300000_message_questions.sql: a message that asks one
-- question with answers the sender sets. Run on a database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
--
-- Sample Squad: coaches Casey (11), Drew (12, card expired) and Morgan (42,
-- also Jordan's parent), manager Emery (13), physio Finley (14), athletes
-- Jordan (31, 14 years old) and Kai (32, adult). Jordan's parents are Logan
-- (41) and Morgan. Sample Team: coach Casey, athlete Jordan.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text, pattern text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like pattern then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
grant select on public.messages, public.message_recipients to authenticated;

create temp table sent (label text primary key, id uuid);
grant select, insert on sent to authenticated;
create or replace function pg_temp.m(label text) returns uuid language sql as
$$ select id from sent s where s.label = $1 $$;
create or replace function pg_temp.q(label text) returns jsonb language sql as
$$ select public.message_question(pg_temp.m($1)) $$;

-- Who can call what.
select pg_temp.ok('anon cannot send a question', has_function_privilege('anon', 'public.send_group_question(text, public.message_audience, text[], boolean, public.app_role, uuid)', 'execute'), false);
select pg_temp.ok('anon cannot answer', has_function_privilege('anon', 'public.answer_message_question(uuid, int, uuid)', 'execute'), false);
select pg_temp.ok('anon cannot read answers', has_function_privilege('anon', 'public.message_question(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot close a question', has_function_privilege('anon', 'public.close_message_question(uuid)', 'execute'), false);
select pg_temp.ok('no policy lets members write answers to the table', exists (select 1 from pg_policies where tablename = 'message_recipients' and cmd in ('UPDATE', 'ALL', 'INSERT')), false);

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('one answer is not enough', $s$ select public.send_group_question('Training?', 'group', array['Yes'], false, null, '00000000-0000-0000-0000-0000000000a1') $s$, 'Give 2 to 4 answers');
select pg_temp.fails('five answers is too many', $s$ select public.send_group_question('Training?', 'group', array['A','B','C','D','E'], false, null, '00000000-0000-0000-0000-0000000000a1') $s$, 'Give 2 to 4 answers');
select pg_temp.fails('blank answers don''t count', $s$ select public.send_group_question('Training?', 'group', array['Yes', '  '], false, null, '00000000-0000-0000-0000-0000000000a1') $s$, 'Give 2 to 4 answers');
select pg_temp.fails('answers up to 30 characters', $s$ select public.send_group_question('Training?', 'group', array['Yes', repeat('x', 31)], false, null, '00000000-0000-0000-0000-0000000000a1') $s$, 'Answers can be up to 30 characters');
select pg_temp.fails('answers must differ', $s$ select public.send_group_question('Training?', 'group', array['Yes', 'yes'], false, null, '00000000-0000-0000-0000-0000000000a1') $s$, 'Each answer must be different');
select pg_temp.fails('a coach cannot ask a group they don''t lead', $s$ select public.send_group_question('Training?', 'club', array['Yes', 'No'], false, null, null) $s$, 'Only admins, the committee and club captains%');
select pg_temp.as_member('32');
select pg_temp.fails('an athlete who isn''t captain cannot ask', $s$ select public.send_group_question('Party?', 'group', array['Yes', 'No'], false, null, '00000000-0000-0000-0000-0000000000a1') $s$, 'You can only message squads and teams you coach, manage or captain');
select pg_temp.as_member('12');
select pg_temp.fails('a coach whose card expired cannot ask', $s$ select public.send_group_question('Training?', 'group', array['Yes', 'No'], false, null, '00000000-0000-0000-0000-0000000000a1') $s$, 'You can only message%');
select pg_temp.ok('nothing was saved by the refused questions', (select count(*) = 0 from public.messages where answer_options is not null), true);

select pg_temp.as_member('11');
insert into sent values ('squad', public.send_group_question('Extra session Friday?', 'group', array[' Yes ', 'No', 'Not sure'], false, null, pg_temp.id('a1')));
insert into sent values ('shared', public.send_group_question('White dresses Saturday', 'group', array['Got it', 'Need one'], true, null, pg_temp.id('a1')));
select pg_temp.ok('answers are trimmed and kept in order', (select answer_options = array['Yes', 'No', 'Not sure'] from public.messages where id = pg_temp.m('squad')), true);
select pg_temp.ok('the question goes to the same people as the message', (select count(*) from public.message_recipients where message_id = pg_temp.m('squad')) = (select count(*) from public.message_recipients where message_id = pg_temp.m('shared')), true);
select pg_temp.ok('Logan (Jordan''s parent) gets a copy naming Jordan', (select for_children = array[pg_temp.id('31')] from public.message_recipients where message_id = pg_temp.m('squad') and profile_id = pg_temp.id('41')), true);

-- ---------------------------------------------------------------------------
-- Answering
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('32');
select pg_temp.fails('an answer must be one of the choices', format($s$ select public.answer_message_question(%L, 3) $s$, pg_temp.m('squad')), 'Choose one of the answers');
select pg_temp.fails('no negative answers', format($s$ select public.answer_message_question(%L, -1) $s$, pg_temp.m('squad')), 'Choose one of the answers');
select public.answer_message_question(pg_temp.m('squad'), 1);
select pg_temp.ok('Kai sees their own answer', (pg_temp.q('squad') ->> 'my_answer')::int = 1, true);
select pg_temp.ok('Kai''s answer was their own', (pg_temp.q('squad') ->> 'my_answer_by_parent')::boolean, false);
select pg_temp.ok('answering marks it read', (select read_at is not null from public.message_recipients where message_id = pg_temp.m('squad') and profile_id = auth.uid()), true);
select pg_temp.fails('Kai cannot answer twice', format($s$ select public.answer_message_question(%L, 0) $s$, pg_temp.m('squad')), 'This has already been answered');
select pg_temp.ok('Kai''s first answer stands', (pg_temp.q('squad') ->> 'my_answer')::int = 1, true);
select pg_temp.fails('Kai cannot answer for Jordan', format($s$ select public.answer_message_question(%L, 0, %L) $s$, pg_temp.m('squad'), pg_temp.id('31')), 'You can only answer for your own child');
select pg_temp.ok('Kai sees no names', pg_temp.q('squad') -> 'answers' = 'null'::jsonb, true);
select pg_temp.ok('Kai sees no totals when they aren''t shared', pg_temp.q('squad') -> 'totals' = 'null'::jsonb, true);
select pg_temp.ok('Kai has no children to answer for', pg_temp.q('squad') -> 'children' = '[]'::jsonb, true);
select pg_temp.ok('Kai cannot close it', (pg_temp.q('squad') ->> 'can_close')::boolean, false);
select pg_temp.fails('Kai cannot close it (database)', format($s$ select public.close_message_question(%L) $s$, pg_temp.m('squad')), 'Only whoever sent it%');

-- A parent answers for their child.
select pg_temp.as_member('41');
select pg_temp.ok('Logan''s copy is answered for Jordan, not for themselves', (pg_temp.q('squad') ->> 'can_answer_myself')::boolean, false);
select pg_temp.fails('Logan cannot answer for themselves on a copy', format($s$ select public.answer_message_question(%L, 0) $s$, pg_temp.m('squad')), 'Answer for your child instead');
select pg_temp.ok('Logan sees Jordan has not answered', (pg_temp.q('squad') -> 'children' -> 0 ->> 'answer') is null and (pg_temp.q('squad') -> 'children' -> 0 ->> 'name') = 'Jordan Junior', true);
select pg_temp.fails('Logan cannot answer for Kai', format($s$ select public.answer_message_question(%L, 0, %L) $s$, pg_temp.m('squad'), pg_temp.id('32')), 'You can only answer for your own child');
select public.answer_message_question(pg_temp.m('squad'), 0, pg_temp.id('31'));
select pg_temp.ok('Logan sees Jordan''s answer', (pg_temp.q('squad') -> 'children' -> 0 ->> 'answer')::int = 0, true);
select pg_temp.ok('Logan sees who answered', (pg_temp.q('squad') -> 'children' -> 0 ->> 'answered_by_name') = 'Logan Parent', true);
select pg_temp.ok('Logan sees it was a parent', (pg_temp.q('squad') -> 'children' -> 0 ->> 'answered_by_parent')::boolean, true);
select pg_temp.ok('Logan sees when', (pg_temp.q('squad') -> 'children' -> 0 ->> 'answered_at') is not null, true);
select pg_temp.ok('Logan sees no other names', pg_temp.q('squad') -> 'answers' = 'null'::jsonb, true);
select pg_temp.ok('Logan sees no totals', pg_temp.q('squad') -> 'totals' = 'null'::jsonb, true);

select pg_temp.as_member('31');
select pg_temp.ok('Jordan sees the answer their parent gave', (pg_temp.q('squad') ->> 'my_answer')::int = 0, true);
select pg_temp.ok('Jordan sees who gave it', (pg_temp.q('squad') ->> 'my_answer_by_name') = 'Logan Parent', true);
select pg_temp.ok('Jordan sees it was a parent', (pg_temp.q('squad') ->> 'my_answer_by_parent')::boolean, true);
select pg_temp.fails('Jordan cannot change it', format($s$ select public.answer_message_question(%L, 1) $s$, pg_temp.m('squad')), 'This has already been answered');

-- Morgan coaches the squad and is Jordan's parent: their copy names no child.
select pg_temp.as_member('42');
select pg_temp.ok('Morgan sees Jordan on their own copy', (pg_temp.q('squad') -> 'children' -> 0 ->> 'answered_by_name') = 'Logan Parent', true);
select pg_temp.fails('Morgan cannot answer over Logan', format($s$ select public.answer_message_question(%L, 2, %L) $s$, pg_temp.m('squad'), pg_temp.id('31')), 'This has already been answered');
select public.answer_message_question(pg_temp.m('shared'), 1, pg_temp.id('31'));
select pg_temp.ok('Morgan answers for Jordan on the other question', (pg_temp.q('shared') -> 'children' -> 0 ->> 'answered_by_name') = 'Morgan Coach-Parent', true);
select public.answer_message_question(pg_temp.m('squad'), 2);
select pg_temp.ok('Morgan also answers for themselves as a coach', (pg_temp.q('squad') ->> 'my_answer')::int = 2, true);

-- ---------------------------------------------------------------------------
-- Who sees names
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.ok('the sender sees every answer by name', jsonb_array_length(pg_temp.q('squad') -> 'answers') = 3, true);
select pg_temp.ok('the sender sees totals', pg_temp.q('squad') -> 'totals' = '[1, 1, 1]'::jsonb, true);
select pg_temp.ok('the sender sees Jordan''s answer was given by a parent',
  exists (select 1 from jsonb_array_elements(pg_temp.q('squad') -> 'answers') a
    where a ->> 'name' = 'Jordan Junior' and (a ->> 'answered_by_parent')::boolean and a ->> 'answered_by_name' = 'Logan Parent'), true);
select pg_temp.ok('the sender sees Not sure answers (the follow-up list)',
  exists (select 1 from jsonb_array_elements(pg_temp.q('squad') -> 'answers') a where (a ->> 'answer')::int = 2 and a ->> 'name' = 'Morgan Coach-Parent'), true);
select pg_temp.ok('the sender sees who hasn''t answered', pg_temp.q('squad') -> 'not_answered' ? 'Emery Manager', true);
select pg_temp.ok('a parent''s copy isn''t counted as waiting', pg_temp.q('squad') -> 'not_answered' ? 'Logan Parent', false);
select pg_temp.ok('the sender isn''t waiting on themselves', pg_temp.q('squad') -> 'not_answered' ? 'Casey Coach', false);

select pg_temp.as_member('13');
select pg_temp.ok('the squad''s manager sees names', jsonb_array_length(pg_temp.q('squad') -> 'answers') = 3, true);
select pg_temp.ok('the manager can close it', (pg_temp.q('squad') ->> 'can_close')::boolean, true);
select pg_temp.as_member('12');
select pg_temp.ok('a coach whose card expired sees no names', pg_temp.q('squad') -> 'answers' = 'null'::jsonb, true);
select pg_temp.as_member('14');
select pg_temp.ok('the squad''s physio sees no names', pg_temp.q('squad') -> 'answers' = 'null'::jsonb, true);
select pg_temp.as_member('01');
-- Admins no longer read messages they didn't send or get (21 November 2026).
select pg_temp.ok('an admin, not sent it, sees nothing', pg_temp.q('squad') is null, true);
select pg_temp.as_member('22');
select pg_temp.ok('the committee, not sent it, sees nothing', pg_temp.q('squad') is null, true);
select pg_temp.fails('the committee cannot answer it', format($s$ select public.answer_message_question(%L, 0) $s$, pg_temp.m('squad')), 'Message not found');

-- Shared totals
select pg_temp.as_member('32');
select pg_temp.ok('with totals shared, Kai sees totals', pg_temp.q('shared') -> 'totals' = '[0, 1]'::jsonb, true);
select pg_temp.ok('with totals shared, Kai still sees no names', pg_temp.q('shared') -> 'answers' = 'null'::jsonb, true);
select pg_temp.as_member('41');
select pg_temp.ok('with totals shared, Logan sees totals', pg_temp.q('shared') -> 'totals' = '[0, 1]'::jsonb, true);

-- ---------------------------------------------------------------------------
-- Closing
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select public.close_message_question(pg_temp.m('squad'));
select pg_temp.ok('closed', (pg_temp.q('squad') ->> 'closed')::boolean, true);
select pg_temp.as_member('13');
select pg_temp.fails('nobody answers after it closes', format($s$ select public.answer_message_question(%L, 0) $s$, pg_temp.m('squad')), 'This question is closed');
select pg_temp.as_member('32');
select pg_temp.fails('a plain message asks nothing', format($s$ select public.answer_message_question(%L, 0) $s$,
  (select id from public.messages where answer_options is null limit 1)), '%');
reset role;

-- ---------------------------------------------------------------------------
-- A captain asks: treated like a coach (Matt, 20 November 2026)
-- ---------------------------------------------------------------------------
insert into public.team_captains (team_id, profile_id, captain_role) values (pg_temp.id('a2'), pg_temp.id('31'), 'captain');
set role authenticated;
select pg_temp.as_member('31');
insert into sent values ('captain', public.send_group_question('Team dinner after the game?', 'group', array['Coming', 'Can''t make it'], false, null, pg_temp.id('a2')));
select pg_temp.as_member('11');
select public.answer_message_question(pg_temp.m('captain'), 0);
select pg_temp.as_member('31');
select pg_temp.ok('the captain who asked sees names', jsonb_array_length(pg_temp.q('captain') -> 'answers') = 1, true);
select pg_temp.ok('the captain can close their question', (pg_temp.q('captain') ->> 'can_close')::boolean, true);
select pg_temp.ok('the captain has nothing to answer on their own question', (pg_temp.q('captain') ->> 'can_answer_myself') is distinct from 'true', true);
select pg_temp.as_member('41');
select pg_temp.ok('Logan gets a copy of their child''s question', pg_temp.q('captain') is not null, true);
select pg_temp.ok('Logan has no child to answer for on Jordan''s own question', pg_temp.q('captain') -> 'children' = '[]'::jsonb, true);
select pg_temp.fails('Logan cannot answer for the child who asked', format($s$ select public.answer_message_question(%L, 0, %L) $s$, pg_temp.m('captain'), pg_temp.id('31')), 'You can only answer for your own child');
select pg_temp.as_member('11');
select pg_temp.ok('the team''s coach sees names on the captain''s question', jsonb_array_length(pg_temp.q('captain') -> 'answers') = 1, true);
reset role;

-- No rows changed outside the questions
select pg_temp.ok('plain messages have no question', (select count(*) = 0 from public.messages where answer_options is null and (answer_totals_shared or question_closed_at is not null)), true);
