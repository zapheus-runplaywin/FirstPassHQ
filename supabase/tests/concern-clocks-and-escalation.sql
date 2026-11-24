-- Tests for 20261124800000_concern_clocks_and_escalation.sql: each concern's
-- clock (new, late, refer, in progress, Important, Urgent), who is chased
-- about it, the club's times, escalation chains (who may set them, loops and
-- people refused), the hourly escalation (steps reached, a step skipped when
-- everyone in it is named, a named person handling only what reached them),
-- late requests to read messages, and the to-do push list. Times are moved
-- with p_now and by moving the concern's own timestamps. Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
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
create temp table s (k text primary key, v uuid);
grant all on s to public;
create or replace function pg_temp.s(p_k text) returns uuid language sql as $$ select v from s where s.k = p_k $$;
create or replace function pg_temp.stage(p_k text, p_now timestamptz default now()) returns text language sql as
$$ select stage from public.concern_clock(pg_temp.s(p_k), p_now) $$;
-- The concern's stages the signed-in member is chased about, as "stage" or
-- "stage+escalated".
create or replace function pg_temp.chased(p_k text, p_now timestamptz default now()) returns text language sql as
$$ select coalesce(string_agg(stage || case when escalated then '+escalated' else '' end, ','), '')
   from public.my_concern_clocks(p_now) where concern_id = pg_temp.s(p_k) $$;
-- Runs the hourly escalation at p_now and counts the steps it records for
-- one concern (other concerns in this file escalate on their own clocks).
create or replace function pg_temp.escalate(p_k text, p_now timestamptz) returns integer language plpgsql as $$
declare before integer;
begin
  select count(*) into before from public.concern_escalations where concern_id = pg_temp.s(p_k);
  perform public.escalate_concerns(p_now);
  return (select count(*) from public.concern_escalations where concern_id = pg_temp.s(p_k)) - before;
end $$;
create or replace function pg_temp.sees(p_k text) returns boolean language sql as
$$ select exists (select 1 from public.concern_register() where id = pg_temp.s(p_k)) $$;

-- Grants.
select pg_temp.ok('anon can''t read the club''s times', has_function_privilege('anon', 'public.club_concern_times()', 'execute'), false);
select pg_temp.ok('members can', has_function_privilege('authenticated', 'public.club_concern_times()', 'execute'), true);
select pg_temp.ok('anon can''t list people for a chain', has_function_privilege('anon', 'public.admin_escalation_people()', 'execute'), false);
select pg_temp.ok('members can''t run escalation', has_function_privilege('authenticated', 'public.escalate_concerns(timestamptz)', 'execute'), false);
select pg_temp.ok('nor read a concern''s clock directly', has_function_privilege('authenticated', 'public.concern_clock(uuid, timestamptz)', 'execute'), false);
select pg_temp.ok('nor the push list', has_function_privilege('authenticated', 'public.member_todos(uuid, timestamptz)', 'execute'), false);
select pg_temp.ok('nor the old push list', has_function_privilege('authenticated', 'public.member_todos_before_clocks(uuid, timestamptz)', 'execute'), false);
select pg_temp.ok('the chains table is closed to members', has_table_privilege('authenticated', 'public.escalation_steps', 'select'), false);
select pg_temp.ok('so is the escalation record', has_table_privilege('authenticated', 'public.concern_escalations', 'select'), false);
select pg_temp.ok('and the escalated views log', has_table_privilege('authenticated', 'public.concern_escalated_views', 'select'), false);
select pg_temp.ok('anon can''t set a chain', has_function_privilege('anon', 'public.admin_set_escalation_chain(text, jsonb)', 'execute'), false);

-- Posts: Casey Coach (11) is Child Safety Officer, Emery Manager (13)
-- Complaints Manager. Gale Committee (21) gets a current check to be named.
delete from public.safeguarding_post_holders;
insert into public.safeguarding_post_holders (post, profile_id) values
  ('child_safety_officer', pg_temp.id('11')), ('complaints_manager', pg_temp.id('13'));
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('21');

-- The club's times: only admins change them, within limits.
select pg_temp.ok('defaults: 24 h, 48 h, 7 and 14 days, 7 days per step',
  (select concern_first_action_hours = 24 and concern_refer_hours = 48 and concern_important_days = 7
     and concern_urgent_days = 14 and concern_escalate_days = 7 and request_important_hours = 24
     and request_urgent_hours = 48 and clearance_important_days = 3 and clearance_urgent_days = 7
   from public.club_settings where id), true);
select pg_temp.as_member('13');
select pg_temp.fails('the Complaints Manager can''t change the times', $s$ select public.admin_set_concern_times(24, 48, 7, 14, 7, 24, 48, 3, 7) $s$);
select pg_temp.as_member('21');
select pg_temp.fails('nor the committee', $s$ select public.admin_set_concern_times(24, 48, 7, 14, 7, 24, 48, 3, 7) $s$);
select pg_temp.as_member('32');
select pg_temp.fails('nor an athlete', $s$ select public.admin_set_concern_times(24, 48, 7, 14, 7, 24, 48, 3, 7) $s$);
select pg_temp.ok('an athlete can read them', (select concern_urgent_days = 14 from public.club_concern_times()), true);
select pg_temp.as_member('01');
select pg_temp.fails('Urgent must come after Important', $s$ select public.admin_set_concern_times(24, 48, 7, 7, 7, 24, 48, 3, 7) $s$);
select pg_temp.fails('days stay within 30', $s$ select public.admin_set_concern_times(24, 48, 7, 31, 7, 24, 48, 3, 7) $s$);
select pg_temp.fails('hours stay at least 1', $s$ select public.admin_set_concern_times(0, 48, 7, 14, 7, 24, 48, 3, 7) $s$);
select pg_temp.works('an admin changes them', $s$ select public.admin_set_concern_times(12, 48, 5, 10, 7, 24, 48, 3, 7) $s$);
select pg_temp.ok('and they''re saved', (select concern_first_action_hours = 12 and concern_important_days = 5 from public.club_settings where id), true);
select pg_temp.works('and put back', $s$ select public.admin_set_concern_times(24, 48, 7, 14, 7, 24, 48, 3, 7) $s$);

-- Two concerns from Kai (32): A about nobody (led by the Complaints Manager),
-- B about a child (led by the Child Safety Officer).
select pg_temp.as_member('32');
insert into s values ('a', public.raise_concern('Training finished late again'));
insert into s values ('b', public.raise_concern('A child was left alone after training', p_involves_child => 'yes'));
reset role;
select pg_temp.ok('a new concern is new', pg_temp.stage('a') = 'new', true);
select pg_temp.ok('the lead post follows whether a child is involved',
  public.concern_lead_post(pg_temp.s('a')) = 'complaints_manager' and public.concern_lead_post(pg_temp.s('b')) = 'child_safety_officer', true);
select pg_temp.as_member('13');
select pg_temp.ok('nobody is chased about a new one yet (the Urgent new-concern to-do covers it)', pg_temp.chased('a') = '', true);

-- Nothing recorded for a day: late. For a child, 48 hours: refer.
select pg_temp.ok('nothing for 25 hours: late', pg_temp.stage('a', now() + interval '25 hours') = 'new_late', true);
select pg_temp.ok('a child''s, at 25 hours, also late', pg_temp.stage('b', now() + interval '25 hours') = 'new_late', true);
select pg_temp.ok('a child''s, at 49 hours: refer', pg_temp.stage('b', now() + interval '49 hours') = 'refer', true);
select pg_temp.ok('the Complaints Manager is chased about A', pg_temp.chased('a', now() + interval '25 hours') = 'new_late', true);
select pg_temp.ok('not about B, which the Child Safety Officer leads', pg_temp.chased('b', now() + interval '49 hours') = '', true);
select pg_temp.as_member('11');
select pg_temp.ok('the Child Safety Officer is chased to refer B', pg_temp.chased('b', now() + interval '49 hours') = 'refer', true);
select pg_temp.ok('but not about A', pg_temp.chased('a', now() + interval '25 hours') = '', true);
select pg_temp.as_member('01');
select pg_temp.ok('an admin isn''t chased while the posts are filled', pg_temp.chased('a', now() + interval '25 hours') || pg_temp.chased('b', now() + interval '49 hours') = '', true);
select pg_temp.as_member('21');
select pg_temp.ok('the committee isn''t chased, and can''t see either', pg_temp.chased('a', now() + interval '25 hours') = '' and not pg_temp.sees('a'), true);
select pg_temp.as_member('32');
select pg_temp.ok('the athlete who raised it isn''t chased', (select count(*) = 0 from public.my_concern_clocks(now() + interval '30 days')), true);

-- A step recorded restarts the clock; then 7 days: Important; 14: Urgent.
select pg_temp.as_member('13');
select public.add_concern_event(pg_temp.s('a'), 'note', 'Spoke to the coach');
reset role;
select pg_temp.ok('a step recorded: in progress', pg_temp.stage('a') = 'in_progress', true);
select pg_temp.ok('7 days later: Important', pg_temp.stage('a', now() + interval '7 days 1 minute') = 'important', true);
select pg_temp.ok('14 days later: Urgent', pg_temp.stage('a', now() + interval '14 days 1 minute') = 'urgent', true);
select pg_temp.as_member('13');
select pg_temp.ok('the lead is chased: Important', pg_temp.chased('a', now() + interval '7 days 1 minute') = 'important', true);
select pg_temp.ok('then Urgent', pg_temp.chased('a', now() + interval '14 days 1 minute') = 'urgent', true);
select pg_temp.ok('nothing to chase while it''s in progress', pg_temp.chased('a') = '', true);
-- Steps on B: a referral restarts its clock too.
select pg_temp.as_member('11');
select public.add_concern_event(pg_temp.s('b'), 'referred_police', 'Reference 123');
reset role;
select pg_temp.ok('referred: in progress, no longer "refer"', pg_temp.stage('b', now() + interval '49 hours') = 'in_progress', true);

-- Escalation chains: admins only, no loops, people who could hold a post.
select pg_temp.as_member('13');
select pg_temp.fails('the Complaints Manager can''t set a chain',
  $s$ select public.admin_set_escalation_chain('complaints_manager', '[{"post": "child_safety_officer", "wait_days": 7}]') $s$);
select pg_temp.as_member('21');
select pg_temp.fails('nor the committee',
  $s$ select public.admin_set_escalation_chain('complaints_manager', '[{"post": "child_safety_officer", "wait_days": 7}]') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('a chain can''t come back to its own post',
  $s$ select public.admin_set_escalation_chain('complaints_manager', '[{"post": "child_safety_officer", "wait_days": 7}, {"post": "complaints_manager", "wait_days": 7}]') $s$);
select pg_temp.fails('nor name a post twice (A to B to C to B)',
  format($s$ select public.admin_set_escalation_chain('complaints_manager', '[{"post": "child_safety_officer", "wait_days": 7}, {"person": "%s", "wait_days": 7}, {"post": "child_safety_officer", "wait_days": 7}]') $s$, pg_temp.id('21')));
select pg_temp.fails('nor a person twice',
  format($s$ select public.admin_set_escalation_chain('child_safety_officer', '[{"person": "%1$s", "wait_days": 7}, {"post": "complaints_manager", "wait_days": 7}, {"person": "%1$s", "wait_days": 7}]') $s$, pg_temp.id('21')));
select pg_temp.fails('nor someone who holds the post it starts from',
  format($s$ select public.admin_set_escalation_chain('complaints_manager', '[{"person": "%s", "wait_days": 7}]') $s$, pg_temp.id('13')));
select pg_temp.fails('nor someone without a current check',
  format($s$ select public.admin_set_escalation_chain('complaints_manager', '[{"person": "%s", "wait_days": 7}]') $s$, pg_temp.id('22')));
select pg_temp.fails('nor a child',
  format($s$ select public.admin_set_escalation_chain('complaints_manager', '[{"person": "%s", "wait_days": 7}]') $s$, pg_temp.id('31')));
select pg_temp.fails('nothing after Admins',
  $s$ select public.admin_set_escalation_chain('complaints_manager', '[{"post": "admins", "wait_days": 7}, {"post": "child_safety_officer", "wait_days": 7}]') $s$);
select pg_temp.fails('at most 4 steps',
  format($s$ select public.admin_set_escalation_chain('complaints_manager', '[{"post": "child_safety_officer", "wait_days": 7}, {"person": "%s", "wait_days": 7}, {"person": "%s", "wait_days": 7}, {"person": "%s", "wait_days": 7}, {"post": "admins", "wait_days": 7}]') $s$, pg_temp.id('21'), pg_temp.id('42'), pg_temp.id('14')));
select pg_temp.fails('a wait between 1 and 30 days',
  $s$ select public.admin_set_escalation_chain('complaints_manager', '[{"post": "child_safety_officer", "wait_days": 0}]') $s$);
select pg_temp.fails('a post or a person, not both',
  format($s$ select public.admin_set_escalation_chain('complaints_manager', '[{"post": "child_safety_officer", "person": "%s", "wait_days": 7}]') $s$, pg_temp.id('21')));
select pg_temp.ok('a refused chain leaves nothing saved', (select count(*) = 0 from public.escalation_steps), true);
select pg_temp.works('the Complaints Manager''s chain: Child Safety Officer after 7 days, then Gale after 7',
  format($s$ select public.admin_set_escalation_chain('complaints_manager', '[{"post": "child_safety_officer", "wait_days": 7}, {"person": "%s", "wait_days": 7}]') $s$, pg_temp.id('21')));
select pg_temp.works('each post can back up the other: a concern only ever follows its own lead''s chain',
  $s$ select public.admin_set_escalation_chain('child_safety_officer', '[{"post": "complaints_manager", "wait_days": 3}]') $s$);
select pg_temp.ok('the admin sees both chains, named',
  (select string_agg(lead_post || ':' || step_no || ':' || target_name, ',' order by lead_post, step_no) from public.admin_escalation_chains())
  = 'child_safety_officer:1:Complaints Manager,complaints_manager:1:Child Safety Officer,complaints_manager:2:Gale Committee', true);
select pg_temp.ok('the admin can pick anyone who could hold a post: Gale, with a check',
  exists (select 1 from public.admin_escalation_people() where id = pg_temp.id('21')), true);
select pg_temp.ok('but not a child, or an admin with no check',
  not exists (select 1 from public.admin_escalation_people() where id in (pg_temp.id('31'), pg_temp.id('02'))), true);
select pg_temp.as_member('13');
select pg_temp.ok('nobody else reads the chains', (select count(*) = 0 from public.admin_escalation_chains()), true);
select pg_temp.ok('nor lists who they could pick', (select count(*) = 0 from public.admin_escalation_people()), true);
reset role;
select pg_temp.ok('Admins are added as the last stop, after the club''s 7 days',
  (select string_agg(coalesce(target_post, 'person') || ':' || wait_days, ',' order by step_no) from public.escalation_chain('complaints_manager'))
  = 'child_safety_officer:7,person:7,admins:7', true);

-- A goes Urgent at day 14; the steps follow at days 21, 28 and 35.
select pg_temp.ok('before Urgent, nothing escalates', pg_temp.escalate('a', now() + interval '13 days') = 0, true);
select pg_temp.ok('Urgent but inside the first wait: nothing yet', pg_temp.escalate('a', now() + interval '20 days') = 0, true);
select pg_temp.as_member('21');
select pg_temp.ok('Gale can''t see A yet', pg_temp.sees('a'), false);
select pg_temp.ok('and has no escalated concerns', public.has_escalated_concerns(), false);
reset role;
select pg_temp.ok('day 21: the Child Safety Officer is reached', pg_temp.escalate('a', now() + interval '21 days 1 hour') = 1, true);
select pg_temp.ok('running again records nothing twice', pg_temp.escalate('a', now() + interval '21 days 2 hours') = 0, true);
select pg_temp.as_member('11');
select pg_temp.ok('the Child Safety Officer is chased, escalated', pg_temp.chased('a', now() + interval '21 days 2 hours') = 'urgent+escalated', true);
select pg_temp.as_member('13');
select pg_temp.ok('the lead still is too', pg_temp.chased('a', now() + interval '21 days 2 hours') = 'urgent', true);
reset role;
select pg_temp.ok('day 28: Gale is reached', pg_temp.escalate('a', now() + interval '28 days 1 hour') = 1, true);
select pg_temp.as_member('21');
select pg_temp.ok('Gale now handles A', pg_temp.sees('a'), true);
select pg_temp.ok('only A: not B', pg_temp.sees('b'), false);
select pg_temp.ok('has escalated concerns', public.has_escalated_concerns(), true);
select pg_temp.ok('is chased, escalated', pg_temp.chased('a', now() + interval '28 days 2 hours') = 'urgent+escalated', true);
select pg_temp.ok('is still no safeguarding officer', public.is_safeguarding_officer(), false);
select pg_temp.works('Gale records a step', $s$ select public.add_concern_event(pg_temp.s('a'), 'note', 'Called the family') $s$);
select pg_temp.works('Gale''s look is noted', $s$ select public.note_escalated_concern_view(pg_temp.s('a')) $s$);
select pg_temp.fails('Gale still can''t ask to read messages',
  format($s$ select public.request_message_access(%L, %L, 'raised_by', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('a'), pg_temp.id('32')));
select pg_temp.as_member('13');
select pg_temp.works('the Complaints Manager''s look isn''t noted', $s$ select public.note_escalated_concern_view(pg_temp.s('a')) $s$);
select pg_temp.ok('the looks list Gale only', (select string_agg(viewer_name, ',') = 'Gale Committee' from public.concern_escalated_view_log(pg_temp.s('a'))), true);
select pg_temp.ok('history shows both steps, in order',
  (select string_agg(target_name || case when skipped then ' (skipped)' else '' end, ',' order by reached_at) from public.concern_escalation_history(pg_temp.s('a')))
  = 'Child Safety Officer,Gale Committee', true);
select pg_temp.as_member('21');
select pg_temp.ok('Gale''s step restarted A''s clock: nothing to chase', pg_temp.chased('a') = '', true);
select pg_temp.as_member('32');
select pg_temp.ok('the athlete sees no escalation history', (select count(*) = 0 from public.concern_escalation_history(pg_temp.s('a'))), true);

-- Closing A ends Gale's access.
select pg_temp.as_member('13');
select public.add_concern_event(pg_temp.s('a'), 'status_changed', 'Sorted with the coach', 'closed');
select pg_temp.as_member('21');
select pg_temp.ok('closed: Gale no longer sees A', pg_temp.sees('a'), false);
select pg_temp.ok('and has no escalated concerns', public.has_escalated_concerns(), false);

-- C is about the Child Safety Officer: their step is skipped, and the next
-- follows straight away.
select pg_temp.as_member('32');
insert into s values ('c', public.raise_concern('The coach shouted at us', p_about_member_id => pg_temp.id('11')));
select pg_temp.as_member('13');
select public.add_concern_event(pg_temp.s('c'), 'note', 'Looking into it');
reset role;
select pg_temp.ok('day 21: one step skipped and the next reached', pg_temp.escalate('c', now() + interval '21 days 1 hour') = 2, true);
select pg_temp.as_member('13');
select pg_temp.ok('history: the Child Safety Officer skipped, then Gale',
  (select string_agg(target_name || case when skipped then ' (skipped)' else '' end, ',' order by reached_at, target_name) from public.concern_escalation_history(pg_temp.s('c')))
  = 'Child Safety Officer (skipped),Gale Committee', true);
reset role;
select pg_temp.ok('both at the same time', (select count(distinct reached_at) = 1 from public.concern_escalations where concern_id = pg_temp.s('c')), true);
select pg_temp.as_member('11');
select pg_temp.ok('the Child Safety Officer it''s about never sees it', pg_temp.sees('c'), false);
select pg_temp.ok('nor is chased about it', (select count(*) = 0 from public.my_concern_clocks(now() + interval '22 days') where concern_id = pg_temp.s('c')), true);
select pg_temp.as_member('21');
select pg_temp.ok('Gale handles C', pg_temp.sees('c'), true);

-- A named person whose check lapses stops handling it.
reset role;
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('21');
select pg_temp.as_member('21');
select pg_temp.ok('a lapsed check: Gale no longer sees C', pg_temp.sees('c'), false);
reset role;
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('21');

-- Day 28: Admins, the last stop.
select pg_temp.ok('day 28: Admins reached', pg_temp.escalate('c', now() + interval '28 days 1 hour') = 1, true);
select pg_temp.as_member('01');
select pg_temp.ok('the admin is chased, escalated', pg_temp.chased('c', now() + interval '28 days 2 hours') = 'urgent+escalated', true);
select pg_temp.as_member('02');
select pg_temp.ok('so is the other admin', pg_temp.chased('c', now() + interval '28 days 2 hours') = 'urgent+escalated', true);
select pg_temp.as_member('31');
select pg_temp.ok('a child is never chased', (select count(*) = 0 from public.my_concern_clocks(now() + interval '28 days 2 hours')), true);
select pg_temp.as_member('41');
select pg_temp.ok('nor a parent', (select count(*) = 0 from public.my_concern_clocks(now() + interval '28 days 2 hours')), true);

-- Late requests to read messages, for whoever can answer.
select pg_temp.as_member('11');
insert into s values ('req', public.request_message_access(pg_temp.s('b'), pg_temp.id('32'), 'raised_by',
  public.club_today() - 30, public.club_today(), 'Need to see what was sent'));
select pg_temp.as_member('01');
select pg_temp.ok('a new request isn''t late', public.message_access_late() is null, true);
select pg_temp.ok('after 25 hours: Important', public.message_access_late(now() + interval '25 hours') = 'important', true);
select pg_temp.ok('after 49 hours: Urgent', public.message_access_late(now() + interval '49 hours') = 'urgent', true);
select pg_temp.as_member('11');
select pg_temp.ok('the person who asked isn''t chased', public.message_access_late(now() + interval '49 hours') is null, true);
select pg_temp.as_member('32');
select pg_temp.ok('nor the athlete', public.message_access_late(now() + interval '49 hours') is null, true);

-- The push list: what was there before, then the clocks.
reset role;
select pg_temp.ok('the push list adds the Urgent concern for an admin, by reference only',
  exists (select 1 from public.member_todos(pg_temp.id('01'), now() + interval '28 days 2 hours') m
    where m.todo_key like 'concern-clock:' || pg_temp.s('c') || ':urgent:%'
      and m.title like 'C-%' and m.title not like '%shouted%' and m.detail = 'Escalated to you'), true);
select pg_temp.ok('and the late request for the admin',
  exists (select 1 from public.member_todos(pg_temp.id('01'), now() + interval '49 hours') where todo_key like 'message-access-late:urgent:%'), true);
select pg_temp.ok('nothing for the athlete',
  not exists (select 1 from public.member_todos(pg_temp.id('32'), now() + interval '49 hours') where todo_key like 'concern-clock:%' or todo_key like 'message-access-late:%'), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.works('the push list runs with nobody signed in', format($s$ select count(*) from public.member_todos(%L, now() + interval '49 hours') $s$, pg_temp.id('01')));
select pg_temp.ok('the push list leaves no one signed in afterwards', coalesce(current_setting('request.jwt.claim.sub', true), '') = '', true);
