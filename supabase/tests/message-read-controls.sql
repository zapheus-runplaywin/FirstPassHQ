-- Tests for 20261120600000_message_read_controls.sql: "Mark all read" and
-- "Mark as unread" in the messages inbox. Run on a database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
--
-- The rule under test: these change only the member's own inbox. A sender's
-- read receipt still means the person opened the message, so "Mark all read"
-- never shows a message as read to its sender, and "Mark as unread" never
-- takes back a receipt.
--
-- Sample Squad: coach Casey (11), athletes Jordan (31, 14 years old) and Kai
-- (32, adult). Jordan's parents are Logan (41) and Morgan (42). Admin (01).
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
grant select on public.messages, public.message_recipients to authenticated;

create temp table sent (label text primary key, id uuid);
grant select, insert on sent to authenticated;
create or replace function pg_temp.m(label text) returns uuid language sql as
$$ select id from sent s where s.label = $1 $$;
-- One member's copy of one message.
create or replace function pg_temp.read_at(label text, n text) returns timestamptz language sql as
$$ select read_at from public.message_recipients where message_id = pg_temp.m($1) and profile_id = pg_temp.id($2) $$;
create or replace function pg_temp.unread(label text, n text) returns boolean language sql as
$$ select unread from public.message_recipients where message_id = pg_temp.m($1) and profile_id = pg_temp.id($2) $$;
create or replace function pg_temp.unread_count(n text) returns bigint language sql as
$$ select count(*) from public.message_recipients where profile_id = pg_temp.id($1) and unread $$;
-- What the sender's receipt says for one member, as the sender sees it.
create or replace function pg_temp.receipt(label text, n text) returns timestamptz language sql as
$$ select r.read_at from public.message_receipts(pg_temp.m($1)) r where r.profile_id = pg_temp.id($2) $$;

-- Who can call what.
select pg_temp.ok('anon cannot mark a message unread', has_function_privilege('anon', 'public.mark_message_unread(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot mark all read', has_function_privilege('anon', 'public.mark_all_messages_read()', 'execute'), false);
select pg_temp.ok('anon still cannot mark a message read', has_function_privilege('anon', 'public.mark_message_read(uuid)', 'execute'), false);
select pg_temp.ok('signed-in members can mark a message unread', has_function_privilege('authenticated', 'public.mark_message_unread(uuid)', 'execute'), true);
select pg_temp.ok('signed-in members can mark all read', has_function_privilege('authenticated', 'public.mark_all_messages_read()', 'execute'), true);
select pg_temp.ok('no policy lets members change their copies directly', exists (select 1 from pg_policies where tablename = 'message_recipients' and cmd in ('UPDATE', 'ALL', 'INSERT')), false);

-- ---------------------------------------------------------------------------
-- Messages to work with
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
insert into sent values ('bus', public.send_group_message('Bus leaves at 7', 'group', null, pg_temp.id('a1')));
insert into sent values ('water', public.send_group_message('Bring water', 'group', null, pg_temp.id('a1')));
insert into sent values ('kit', public.send_group_message('New kit on sale', 'group', null, pg_temp.id('a1')));
select pg_temp.as_member('01');
insert into sent values ('agm', public.send_group_message('AGM on Friday', 'club'));
select pg_temp.ok('new messages are unread for Kai', pg_temp.unread('bus', '32') and pg_temp.unread('agm', '32'), true);
select pg_temp.ok('new messages have no inbox state', (select bool_and(inbox_state is null) from public.message_recipients where message_id in (select id from sent)), true);
select pg_temp.ok('Kai starts with 4 unread', pg_temp.unread_count('32') = 4, true);
select pg_temp.fails('inbox state is read, unread or empty', $s$ update public.message_recipients set inbox_state = 'archived' where profile_id = '00000000-0000-0000-0000-000000000032' $s$, '%message_recipients_inbox_state_check%');
select pg_temp.fails('nobody can write the unread column', $s$ update public.message_recipients set unread = false where profile_id = '00000000-0000-0000-0000-000000000032' $s$, '%can only be updated to DEFAULT%');

-- ---------------------------------------------------------------------------
-- Mark as unread
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('32');
select public.mark_message_read(pg_temp.m('bus'));
select pg_temp.ok('opening a message marks it read', pg_temp.unread('bus', '32'), false);
select pg_temp.ok('opening sets the read time', pg_temp.read_at('bus', '32') is not null, true);
reset role;
-- Make the first open clearly earlier, so we can see it is kept.
update public.message_recipients set read_at = now() - interval '1 day'
where message_id = pg_temp.m('bus') and profile_id = pg_temp.id('32');
set role authenticated;
select pg_temp.as_member('32');
select public.mark_message_unread(pg_temp.m('bus'));
select pg_temp.ok('Mark as unread puts it back as unread', pg_temp.unread('bus', '32'), true);
select pg_temp.ok('Mark as unread keeps the first read time', pg_temp.read_at('bus', '32') < now() - interval '23 hours', true);
select pg_temp.ok('it counts as unread again', pg_temp.unread_count('32') = 4, true);
select pg_temp.as_member('11');
select pg_temp.ok('the coach''s receipt still shows Kai read it', pg_temp.receipt('bus', '32') < now() - interval '23 hours', true);
select pg_temp.ok('the coach''s read count still counts Kai', (select read_count = 1 from public.my_sent_messages() where id = pg_temp.m('bus')), true);
select pg_temp.as_member('32');
select public.mark_message_unread(pg_temp.m('bus'));
select pg_temp.ok('marking it unread twice changes nothing', pg_temp.unread('bus', '32') and pg_temp.read_at('bus', '32') < now() - interval '23 hours', true);
select public.mark_message_read(pg_temp.m('bus'));
select pg_temp.ok('opening it again marks it read', pg_temp.unread('bus', '32'), false);
select pg_temp.ok('opening it again keeps the first read time', pg_temp.read_at('bus', '32') < now() - interval '23 hours', true);
select pg_temp.ok('opening it clears the inbox state', (select inbox_state is null from public.message_recipients where message_id = pg_temp.m('bus') and profile_id = pg_temp.id('32')), true);

-- An unopened message can be marked unread too; it stays unopened.
select public.mark_message_unread(pg_temp.m('kit'));
select pg_temp.ok('an unopened message marked unread stays unread', pg_temp.unread('kit', '32'), true);
select pg_temp.ok('and still has no read time', pg_temp.read_at('kit', '32') is null, true);

-- Only the member's own copy.
select pg_temp.as_member('41');
select public.mark_message_read(pg_temp.m('water'));
select public.mark_message_unread(pg_temp.m('water'));
select pg_temp.ok('Logan''s copy is unread for Logan', pg_temp.unread('water', '41'), true);
reset role;
select pg_temp.ok('Morgan''s copy is untouched by Logan', pg_temp.read_at('water', '42') is null and pg_temp.unread('water', '42'), true);
select pg_temp.ok('Jordan''s copy is untouched by Logan', pg_temp.read_at('water', '31') is null, true);
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.ok('the sender has no copy to mark unread', (select count(*) from public.message_recipients where message_id = pg_temp.m('bus') and profile_id = pg_temp.id('11')) = 0, true);
select public.mark_message_unread(pg_temp.m('bus'));
select pg_temp.ok('the sender marking their own message unread makes no copy', (select count(*) from public.message_recipients where message_id = pg_temp.m('bus') and profile_id = pg_temp.id('11')) = 0, true);
select pg_temp.ok('and leaves Kai''s copy alone', pg_temp.unread('bus', '32'), false);
select public.mark_message_unread('00000000-0000-0000-0000-0000000000ee');
select pg_temp.ok('marking a missing message unread does nothing', (select count(*) from public.message_recipients where inbox_state = 'unread') = 2, true);

-- Members can't skip the functions.
select pg_temp.as_member('32');
update public.message_recipients set inbox_state = 'read', read_at = now() where profile_id = pg_temp.id('31');
reset role;
select pg_temp.ok('Kai cannot change Jordan''s copies directly', (select bool_and(read_at is null and inbox_state is null) from public.message_recipients where profile_id = pg_temp.id('31')), true);
set role authenticated;
select pg_temp.as_member('32');
update public.message_recipients set read_at = now() where profile_id = pg_temp.id('32') and message_id = pg_temp.m('water');
select pg_temp.ok('Kai cannot fake a receipt on their own copy', pg_temp.read_at('water', '32') is null, true);

-- ---------------------------------------------------------------------------
-- Mark all read
-- ---------------------------------------------------------------------------
select pg_temp.ok('Mark all read says how many it cleared', public.mark_all_messages_read() = 3, true);
select pg_temp.ok('Kai has nothing unread', pg_temp.unread_count('32') = 0, true);
select pg_temp.ok('unopened messages keep no read time', pg_temp.read_at('water', '32') is null and pg_temp.read_at('agm', '32') is null and pg_temp.read_at('kit', '32') is null, true);
select pg_temp.ok('the opened one keeps its first read time', pg_temp.read_at('bus', '32') < now() - interval '23 hours', true);
select pg_temp.ok('a second Mark all read clears nothing', public.mark_all_messages_read() = 0, true);
select pg_temp.as_member('11');
select pg_temp.ok('the coach''s receipt says Kai hasn''t read it', pg_temp.receipt('water', '32') is null, true);
select pg_temp.ok('the coach''s read count counts only Logan, who opened it', (select read_count = 1 from public.my_sent_messages() where id = pg_temp.m('water')), true);
select pg_temp.as_member('01');
select pg_temp.ok('the admin''s receipt says Kai hasn''t read the club message', pg_temp.receipt('agm', '32') is null, true);
reset role;
select pg_temp.ok('other members'' messages stay unread', pg_temp.unread('water', '31') and pg_temp.unread('water', '42') and pg_temp.unread('water', '41'), true);
set role authenticated;

select pg_temp.as_member('32');
select public.mark_message_read(pg_temp.m('water'));
select pg_temp.ok('opening a message after Mark all read records the read', pg_temp.read_at('water', '32') is not null, true);
select pg_temp.ok('and clears its inbox state', (select inbox_state is null from public.message_recipients where message_id = pg_temp.m('water') and profile_id = pg_temp.id('32')), true);
select pg_temp.as_member('11');
select pg_temp.ok('so the coach now sees Kai read it', pg_temp.receipt('water', '32') is not null, true);

select pg_temp.as_member('32');
select public.mark_message_unread(pg_temp.m('agm'));
select pg_temp.ok('a message marked read can be marked unread again', pg_temp.unread('agm', '32'), true);
select pg_temp.ok('Mark all read clears it again', public.mark_all_messages_read() = 1, true);

select pg_temp.as_member('');
select pg_temp.ok('signed out, Mark all read clears nothing', public.mark_all_messages_read() = 0, true);
reset role;

-- No receipts were invented: only messages someone opened have a read time.
select pg_temp.ok('read times only where someone opened the message', (select count(*) = 3 from public.message_recipients where message_id in (select id from sent) and read_at is not null), true);
