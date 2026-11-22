-- Tests for 20261121100000_message_archive_and_access.sql: archiving
-- messages, concern references, admins no longer reading every message, and
-- the Child Safety Officer's and Complaints Manager's requests to read a
-- member's messages. Run on a database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
--
-- Sample people: admins Alex (01) and Blair (02); committee Indy (23); Child
-- Safety Officer Casey Coach (11); Complaints Manager Emery Manager (13);
-- athletes Jordan (31, 14 years old) and Kai (32, adult); Jordan's parents
-- Logan (41) and Morgan (42).
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Requests take dates in the club's own time zone (Perth), so today here must
-- be Perth's today too. Without this, public.club_today() is UTC's, a day behind
-- Perth from 4 pm to midnight UTC, and today's messages fell outside a
-- request ending "today" (failed in CI at 21:52 UTC, 22 November 2026).
set time zone 'Australia/Perth';
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

create temp table saved (label text primary key, id uuid);
grant select, insert on saved to authenticated;
create or replace function pg_temp.s(label text) returns uuid language sql as
$$ select id from saved s where s.label = $1 $$;
create or replace function pg_temp.copy(label text, n text) returns public.message_recipients language sql as
$$ select * from public.message_recipients where message_id = pg_temp.s($1) and profile_id = pg_temp.id($2) $$;
create or replace function pg_temp.req(label text) returns public.message_access_requests language sql as
$$ select * from public.message_access_requests where id = pg_temp.s($1) $$;
-- The requests the signed-in member can see, by their id.
create or replace function pg_temp.sees(label text) returns boolean language sql as
$$ select exists (select 1 from public.message_access_requests() r where r.id = pg_temp.s($1)) $$;
create or replace function pg_temp.can_decide(label text) returns boolean language sql as
$$ select coalesce((select r.can_decide from public.message_access_requests() r where r.id = pg_temp.s($1)), false) $$;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('anon cannot archive', has_function_privilege('anon', 'public.archive_message(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot move to inbox', has_function_privilege('anon', 'public.move_message_to_inbox(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot ask for access', has_function_privilege('anon', 'public.request_message_access(uuid, uuid, text, date, date, text)', 'execute'), false);
select pg_temp.ok('anon cannot decide', has_function_privilege('anon', 'public.decide_message_access(uuid, boolean, text)', 'execute'), false);
select pg_temp.ok('anon cannot list requests', has_function_privilege('anon', 'public.message_access_requests()', 'execute'), false);
select pg_temp.ok('anon cannot list messages', has_function_privilege('anon', 'public.accessed_messages(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot open a message', has_function_privilege('anon', 'public.open_accessed_message(uuid, uuid)', 'execute'), false);
select pg_temp.ok('anon cannot read the log', has_function_privilege('anon', 'public.message_access_log(uuid)', 'execute'), false);
select pg_temp.ok('anon gets no to-dos', has_function_privilege('anon', 'public.message_access_todo()', 'execute'), false);
select pg_temp.ok('signed-in members can archive', has_function_privilege('authenticated', 'public.archive_message(uuid)', 'execute'), true);
select pg_temp.ok('the post check is closed to the app', has_function_privilege('authenticated', 'public.my_safeguarding_post()', 'execute'), false);
select pg_temp.ok('the open-request check is closed to the app', has_function_privilege('authenticated', 'public.message_access_open_request(uuid)', 'execute'), false);
select pg_temp.ok('requests table closed to signed-in members', has_table_privilege('authenticated', 'public.message_access_requests', 'select'), false);
select pg_temp.ok('access log closed to signed-in members', has_table_privilege('authenticated', 'public.message_access_views', 'select'), false);
select pg_temp.ok('requests table closed to anon', has_table_privilege('anon', 'public.message_access_requests', 'select'), false);
select pg_temp.ok('no policy lets anyone read requests directly', exists (select 1 from pg_policies where tablename in ('message_access_requests', 'message_access_views')), false);

-- ---------------------------------------------------------------------------
-- Messages to work with
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select public.admin_set_safeguarding(pg_temp.id('11'), pg_temp.id('13'), null, null, null, null);
select pg_temp.as_member('11');
insert into saved values ('bus', public.send_group_message('Bus leaves at 7', 'group', null, pg_temp.id('a1')));
insert into saved values ('old', public.send_group_message('Old squad news', 'group', null, pg_temp.id('a1')));
select pg_temp.as_member('01');
insert into saved values ('agm', public.send_group_message('AGM on Friday', 'club'));
insert into saved values ('athletes', public.send_group_message('Athletes: photos on Sunday', 'role', 'athlete'));
-- One message from 200 days ago, outside any request's dates.
update public.messages set created_at = now() - interval '200 days' where id = pg_temp.s('old');

-- ---------------------------------------------------------------------------
-- Archive
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('32');
select public.archive_message(pg_temp.s('bus'));
reset role;
select pg_temp.ok('Kai''s copy is archived', (pg_temp.copy('bus', '32')).archived_at is not null, true);
select pg_temp.ok('archiving clears Kai''s unread dot', (pg_temp.copy('bus', '32')).unread, false);
select pg_temp.ok('archiving doesn''t tell Casey it was read', (pg_temp.copy('bus', '32')).read_at is null, true);
select pg_temp.as_member('11');
select pg_temp.ok('Casey''s receipt for Kai still says not read', (select r.read_at is null from public.message_receipts(pg_temp.s('bus')) r where r.profile_id = pg_temp.id('32')), true);
select pg_temp.ok('Jordan''s copy is untouched', (pg_temp.copy('bus', '31')).archived_at is null and (pg_temp.copy('bus', '31')).unread, true);
select pg_temp.ok('the parents'' copies are untouched', (select bool_and(archived_at is null) from public.message_recipients where message_id = pg_temp.s('bus') and profile_id in (pg_temp.id('41'), pg_temp.id('42'))), true);
select pg_temp.ok('the message itself is still there', exists (select 1 from public.messages where id = pg_temp.s('bus') and body = 'Bus leaves at 7'), true);

-- The sender has no copy to archive: Sent can't be archived.
set role authenticated;
select pg_temp.as_member('11');
select public.archive_message(pg_temp.s('bus'));
reset role;
select pg_temp.ok('archiving your own sent message changes nobody''s copy', (select count(*) from public.message_recipients where message_id = pg_temp.s('bus') and archived_at is not null) = 1, true);
select pg_temp.as_member('11');
select pg_temp.ok('Casey still sees it in Sent', exists (select 1 from public.my_sent_messages() m where m.id = pg_temp.s('bus')), true);

-- Archiving twice keeps the first time.
reset role;
update public.message_recipients set archived_at = now() - interval '1 hour'
where message_id = pg_temp.s('bus') and profile_id = pg_temp.id('32');
set role authenticated;
select pg_temp.as_member('32');
select public.archive_message(pg_temp.s('bus'));
reset role;
select pg_temp.ok('archiving again keeps the first time', (pg_temp.copy('bus', '32')).archived_at < now() - interval '30 minutes', true);

-- Move to inbox, then archive and mark unread.
set role authenticated;
select pg_temp.as_member('32');
select public.move_message_to_inbox(pg_temp.s('bus'));
reset role;
select pg_temp.ok('Move to inbox brings it back', (pg_temp.copy('bus', '32')).archived_at is null, true);
select pg_temp.ok('it comes back read', (pg_temp.copy('bus', '32')).unread, false);
set role authenticated;
select pg_temp.as_member('32');
select public.archive_message(pg_temp.s('bus'));
select public.mark_message_unread(pg_temp.s('bus'));
reset role;
select pg_temp.ok('Mark as unread brings an archived message back to the inbox', (pg_temp.copy('bus', '32')).archived_at is null, true);
select pg_temp.ok('and shows its dot', (pg_temp.copy('bus', '32')).unread, true);
select pg_temp.ok('and still doesn''t tell Casey it was read', (pg_temp.copy('bus', '32')).read_at is null, true);

-- Someone else can't archive Kai's copy.
set role authenticated;
select pg_temp.as_member('31');
select public.archive_message(pg_temp.s('athletes'));
reset role;
select pg_temp.ok('Jordan archiving only moves Jordan''s copy', (select count(*) from public.message_recipients where message_id = pg_temp.s('athletes') and archived_at is not null) = 1 and (pg_temp.copy('athletes', '31')).archived_at is not null, true);
select pg_temp.ok('Jordan''s parents still have their copies in their inbox', (select bool_and(archived_at is null) from public.message_recipients where message_id = pg_temp.s('athletes') and profile_id in (pg_temp.id('41'), pg_temp.id('42'))), true);
-- No policy lets a member write their copies, so a direct write changes nothing.
set role authenticated;
select pg_temp.as_member('32');
update public.message_recipients set archived_at = now() where profile_id = pg_temp.id('32');
reset role;
select pg_temp.ok('nothing was archived directly', (pg_temp.copy('agm', '32')).archived_at is null, true);

-- ---------------------------------------------------------------------------
-- Admins no longer read every message
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('01');
select pg_temp.ok('an admin can''t read a coach''s squad message', exists (select 1 from public.messages where id = pg_temp.s('bus')), false);
select pg_temp.ok('an admin can''t read other people''s copies', exists (select 1 from public.message_recipients where message_id = pg_temp.s('bus')), false);
select pg_temp.ok('an admin gets no receipts for it', exists (select 1 from public.message_receipts(pg_temp.s('bus'))), false);
select pg_temp.ok('an admin still reads what they sent', exists (select 1 from public.messages where id = pg_temp.s('athletes')), true);
select pg_temp.ok('an admin still reads messages they got', exists (select 1 from public.messages where id = pg_temp.s('agm')), true);
select pg_temp.ok('an admin still sees receipts for what they sent', (select count(*) from public.message_receipts(pg_temp.s('athletes'))) > 0, true);
select pg_temp.as_member('02');
select pg_temp.ok('the other admin can''t read it either', exists (select 1 from public.messages where id = pg_temp.s('bus')), false);
select pg_temp.as_member('23');
select pg_temp.ok('the committee can''t read it', exists (select 1 from public.messages where id = pg_temp.s('bus')), false);
select pg_temp.as_member('32');
select pg_temp.ok('Kai still reads his message', exists (select 1 from public.messages where id = pg_temp.s('bus')), true);
select pg_temp.as_member('41');
select pg_temp.ok('Logan still reads his copy for Jordan', exists (select 1 from public.messages where id = pg_temp.s('bus')), true);
reset role;
select pg_temp.as_member('01');
select pg_temp.fails('an admin can''t copy a message they didn''t get into a concern',
  format($s$ select public.raise_concern('Looking at this', p_message_id => %L) $s$, pg_temp.s('bus')), '%isn''t available to report%');
select pg_temp.as_member('32');
select pg_temp.ok('Kai can still report it', public.raise_concern('Worried about this message', p_message_id => pg_temp.s('bus')) is not null, true);

-- ---------------------------------------------------------------------------
-- Concern references
-- ---------------------------------------------------------------------------
-- A concern about the Child Safety Officer, raised by Jordan with his name.
select pg_temp.as_member('31');
insert into saved values ('about_casey', public.raise_concern('Something Casey said', p_about_member_id => pg_temp.id('11')));
-- An anonymous one about Kai, raised by Logan.
select pg_temp.as_member('41');
insert into saved values ('about_kai', public.raise_concern('Kai at training', p_about_member_id => pg_temp.id('32'), p_anonymous => true));
-- One about Alex the admin, raised by Kai.
select pg_temp.as_member('32');
insert into saved values ('about_alex', public.raise_concern('Alex at the AGM', p_about_member_id => pg_temp.id('01')));

select pg_temp.ok('every concern has a reference', (select bool_and(ref_no is not null) from public.concerns), true);
select pg_temp.ok('references are all different', (select count(distinct ref_no) = count(*) from public.concerns), true);
select pg_temp.ok('newer concerns get bigger numbers', (select (select ref_no from public.concerns where id = pg_temp.s('about_alex')) > (select ref_no from public.concerns where id = pg_temp.s('about_casey'))), true);
select pg_temp.ok('a reference looks like C-0001', public.concern_reference(1) = 'C-0001' and public.concern_reference(12345) = 'C-12345', true);
select pg_temp.fails('a reference can''t be written', $s$ update public.concerns set ref_no = 999 $s$, '%can only be updated to DEFAULT%');
select pg_temp.as_member('31');
select pg_temp.ok('Jordan sees his concern''s reference', (select reference from public.my_concerns() where id = pg_temp.s('about_casey')) = public.concern_reference((select ref_no from public.concerns where id = pg_temp.s('about_casey'))), true);
select pg_temp.as_member('13');
select pg_temp.ok('the Complaints Manager sees references in the register', (select bool_and(reference like 'C-%') and count(*) >= 3 from public.concern_register()), true);
select pg_temp.as_member('11');
select pg_temp.ok('the Child Safety Officer still doesn''t see the concern about them', exists (select 1 from public.concern_register() where id = pg_temp.s('about_casey')), false);

-- ---------------------------------------------------------------------------
-- Who can ask
-- ---------------------------------------------------------------------------
select pg_temp.as_member('13');
select pg_temp.ok('the Complaints Manager is offered who it''s about and who raised it', (select count(*) = 2 from public.message_access_people(pg_temp.s('about_casey'))), true);
select pg_temp.ok('an anonymous raiser is never offered', (select array_agg(link) = '{about}' from public.message_access_people(pg_temp.s('about_kai'))), true);
select pg_temp.as_member('01');
select pg_temp.ok('an admin is offered nobody', exists (select 1 from public.message_access_people(pg_temp.s('about_kai'))), false);
select pg_temp.as_member('11');
select pg_temp.ok('the officer a concern is about is offered nobody', exists (select 1 from public.message_access_people(pg_temp.s('about_casey'))), false);

select pg_temp.as_member('01');
select pg_temp.fails('an admin can''t ask', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_kai'), pg_temp.id('32')), 'Only the Child Safety Officer or the Complaints Manager%');
select pg_temp.as_member('23');
select pg_temp.fails('the committee can''t ask', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_kai'), pg_temp.id('32')), 'Only the Child Safety Officer or the Complaints Manager%');
select pg_temp.as_member('32');
select pg_temp.fails('an athlete can''t ask', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_casey'), pg_temp.id('11')), 'Only the Child Safety Officer or the Complaints Manager%');
select pg_temp.as_member('41');
select pg_temp.fails('a parent can''t ask', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_kai'), pg_temp.id('32')), 'Only the Child Safety Officer or the Complaints Manager%');
select pg_temp.as_member('11');
select pg_temp.fails('the officer a concern is about can''t ask on it', format($s$ select public.request_message_access(%L, %L, 'raised_by', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_casey'), pg_temp.id('31')), 'Concern not found');

select pg_temp.as_member('13');
select pg_temp.fails('a concern must exist', format($s$ select public.request_message_access(gen_random_uuid(), %L, 'other', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.id('32')), 'Concern not found');
select pg_temp.fails('not your own messages', format($s$ select public.request_message_access(%L, %L, 'other', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_casey'), pg_temp.id('13')), '%your own messages%');
select pg_temp.fails('who it''s about must match', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_casey'), pg_temp.id('32')), '%isn''t about that person%');
select pg_temp.fails('who raised it must match', format($s$ select public.request_message_access(%L, %L, 'raised_by', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_casey'), pg_temp.id('32')), '%didn''t raise this concern%');
select pg_temp.fails('an anonymous raiser can''t be named as the raiser', format($s$ select public.request_message_access(%L, %L, 'raised_by', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_kai'), pg_temp.id('41')), '%didn''t raise this concern%');
select pg_temp.fails('how they''re involved is needed', format($s$ select public.request_message_access(%L, %L, 'friend', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_casey'), pg_temp.id('11')), '%how this person is involved%');
select pg_temp.fails('a reason is needed', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 30, public.club_today(), 'short') $s$, pg_temp.s('about_casey'), pg_temp.id('11')), '%at least 10 characters%');
select pg_temp.fails('no future end date', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 30, public.club_today() + 2, 'Need to see these messages') $s$, pg_temp.s('about_casey'), pg_temp.id('11')), '%can''t be in the future%');
select pg_temp.fails('start on or before the end', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 1, public.club_today() - 5, 'Need to see these messages') $s$, pg_temp.s('about_casey'), pg_temp.id('11')), '%on or before the end date%');
select pg_temp.fails('at most 90 days', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 91, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('about_casey'), pg_temp.id('11')), '%90 days or less%');

create temp table msg_count_before as select id from public.messages where id not in (select id from saved);
insert into saved values ('casey_req', public.request_message_access(pg_temp.s('about_casey'), pg_temp.id('11'), 'about', public.club_today() - 90, public.club_today(), 'Check what Casey sent the squad'));
select pg_temp.ok('the request is saved as pending', (pg_temp.req('casey_req')).status = 'pending', true);
select pg_temp.ok('it names the Complaints Manager''s post', (pg_temp.req('casey_req')).requested_post = 'complaints_manager', true);
select pg_temp.fails('one pending request at a time for the same person and concern', format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 10, public.club_today(), 'Asking a second time') $s$, pg_temp.s('about_casey'), pg_temp.id('11')), '%already asked%');
insert into saved values ('jordan_req', public.request_message_access(pg_temp.s('about_casey'), pg_temp.id('31'), 'raised_by', public.club_today() - 30, public.club_today(), 'Messages Jordan got from Casey'));
insert into saved values ('logan_req', public.request_message_access(pg_temp.s('about_kai'), pg_temp.id('41'), 'other', public.club_today() - 30, public.club_today(), 'Logan saw it happen and messaged the coach'));
select pg_temp.ok('someone else involved can be named with a reason', (pg_temp.req('logan_req')).subject_link = 'other', true);

-- ---------------------------------------------------------------------------
-- Nobody is told, and only the right people see requests
-- ---------------------------------------------------------------------------
select pg_temp.ok('asking sent nobody a message', (select count(*) from public.messages) = (select count(*) from saved where label in ('bus', 'old', 'agm', 'athletes')) + (select count(*) from msg_count_before), true);
select pg_temp.as_member('13');
select pg_temp.ok('the requester sees their request', pg_temp.sees('casey_req'), true);
select pg_temp.ok('and it''s marked as theirs', (select mine from public.message_access_requests() where id = pg_temp.s('casey_req')), true);
select pg_temp.ok('the requester can''t answer it', pg_temp.can_decide('casey_req'), false);
select pg_temp.ok('the request has a reference', (select reference like 'R-%' and concern_reference like 'C-%' and concern_open from public.message_access_requests() where id = pg_temp.s('casey_req')), true);
select pg_temp.as_member('01');
select pg_temp.ok('an admin sees it', pg_temp.sees('casey_req'), true);
select pg_temp.ok('an admin can answer it', pg_temp.can_decide('casey_req'), true);
select pg_temp.as_member('11');
select pg_temp.ok('the person it''s about never sees it', pg_temp.sees('casey_req'), false);
select pg_temp.ok('nor the request about who raised it', pg_temp.sees('jordan_req'), false);
select pg_temp.ok('the other officer sees a request they''re not in', pg_temp.sees('logan_req'), true);
select pg_temp.ok('but can''t answer it while an admin can', pg_temp.can_decide('logan_req'), false);
select pg_temp.as_member('31');
select pg_temp.ok('Jordan never sees the request about his messages', pg_temp.sees('jordan_req'), false);
select pg_temp.as_member('41');
select pg_temp.ok('a parent never sees requests', exists (select 1 from public.message_access_requests()), false);
select pg_temp.as_member('42');
select pg_temp.ok('the other parent never sees requests', exists (select 1 from public.message_access_requests()), false);
select pg_temp.as_member('23');
select pg_temp.ok('the committee never sees requests', exists (select 1 from public.message_access_requests()), false);
select pg_temp.as_member('32');
select pg_temp.ok('an athlete never sees requests', exists (select 1 from public.message_access_requests()), false);

-- ---------------------------------------------------------------------------
-- Answering
-- ---------------------------------------------------------------------------
select pg_temp.as_member('13');
select pg_temp.fails('the requester can''t approve their own request', format($s$ select public.decide_message_access(%L, true, 'Approving my own request') $s$, pg_temp.s('casey_req')), 'Someone else must answer%');
select pg_temp.fails('nothing to read before approval', format($s$ select * from public.accessed_messages(%L) $s$, pg_temp.s('casey_req')), '%isn''t open%');
select pg_temp.as_member('11');
select pg_temp.fails('the person it''s about can''t answer it', format($s$ select public.decide_message_access(%L, false, 'Refusing a request about me') $s$, pg_temp.s('casey_req')), 'Request not found');
select pg_temp.as_member('23');
select pg_temp.fails('the committee can''t answer it', format($s$ select public.decide_message_access(%L, true, 'Committee approving this') $s$, pg_temp.s('casey_req')), 'Request not found');
select pg_temp.as_member('41');
select pg_temp.fails('a parent can''t answer it', format($s$ select public.decide_message_access(%L, true, 'Parent approving this') $s$, pg_temp.s('casey_req')), 'Request not found');
select pg_temp.as_member('01');
select pg_temp.fails('approving needs a justification', format($s$ select public.decide_message_access(%L, true, 'ok') $s$, pg_temp.s('casey_req')), '%why you''re approving%');
select pg_temp.fails('refusing needs reasons', format($s$ select public.decide_message_access(%L, false, '') $s$, pg_temp.s('casey_req')), '%why you''re refusing%');
select public.decide_message_access(pg_temp.s('casey_req'), true, 'Concern is serious and messages are relevant');
select pg_temp.ok('approved with the admin''s name and note', (select status = 'approved' and decided_by_name = 'Alex Admin' and decision_note = 'Concern is serious and messages are relevant' from public.message_access_requests where id = pg_temp.s('casey_req')), true);
select pg_temp.ok('access lasts 24 hours', (select access_expires_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' from public.message_access_requests where id = pg_temp.s('casey_req')), true);
select pg_temp.fails('it can''t be answered twice', format($s$ select public.decide_message_access(%L, false, 'Changed my mind on this') $s$, pg_temp.s('casey_req')), '%already been answered%');
select pg_temp.as_member('02');
select public.decide_message_access(pg_temp.s('jordan_req'), false, 'Talk to Jordan''s parents first');
select pg_temp.ok('refused with reasons', (select status = 'rejected' and decision_note = 'Talk to Jordan''s parents first' and access_expires_at is null from public.message_access_requests where id = pg_temp.s('jordan_req')), true);
select pg_temp.as_member('13');
select pg_temp.fails('a refused request opens nothing', format($s$ select * from public.accessed_messages(%L) $s$, pg_temp.s('jordan_req')), '%isn''t open%');
select pg_temp.ok('the requester sees why it was refused', (select decision_note from public.message_access_requests() where id = pg_temp.s('jordan_req')) = 'Talk to Jordan''s parents first', true);

-- ---------------------------------------------------------------------------
-- Reading under an approved request
-- ---------------------------------------------------------------------------
select pg_temp.as_member('13');
create temp table listed as select * from public.accessed_messages(pg_temp.s('casey_req'));
select pg_temp.ok('the list has what Casey sent', exists (select 1 from listed where message_id = pg_temp.s('bus') and sent_by_member), true);
select pg_temp.ok('and what Casey got', exists (select 1 from listed where message_id = pg_temp.s('agm') and not sent_by_member), true);
select pg_temp.ok('but nothing from before the start date', exists (select 1 from listed where message_id = pg_temp.s('old')), false);
select pg_temp.ok('nor messages Casey wasn''t part of', exists (select 1 from listed where message_id = pg_temp.s('athletes')), false);
select pg_temp.ok('the list shows who sent each and who it went to', (select bool_and(sender_name is not null and audience is not null) from listed), true);
select pg_temp.ok('the list itself is logged', (select count(*) = 1 from public.message_access_views where request_id = pg_temp.s('casey_req') and kind = 'listed' and viewed_by = pg_temp.id('13')), true);
select pg_temp.ok('opening shows the text', (select body = 'Bus leaves at 7' from public.open_accessed_message(pg_temp.s('casey_req'), pg_temp.s('bus'))), true);
select pg_temp.ok('opening is logged', (select count(*) = 1 from public.message_access_views where request_id = pg_temp.s('casey_req') and kind = 'opened' and message_id = pg_temp.s('bus')), true);
select pg_temp.fails('a message outside the dates can''t be opened', format($s$ select * from public.open_accessed_message(%L, %L) $s$, pg_temp.s('casey_req'), pg_temp.s('old')), '%isn''t covered%');
select pg_temp.fails('a message Casey wasn''t part of can''t be opened', format($s$ select * from public.open_accessed_message(%L, %L) $s$, pg_temp.s('casey_req'), pg_temp.s('athletes')), '%isn''t covered%');
select pg_temp.ok('a refused opening isn''t logged as an opening', (select count(*) = 1 from public.message_access_views where request_id = pg_temp.s('casey_req') and kind = 'opened'), true);
select pg_temp.ok('the request counts one message opened', (select views = 1 from public.message_access_requests() where id = pg_temp.s('casey_req')), true);
select pg_temp.ok('reading changes nobody''s copy', (select read_at is null from public.message_recipients where message_id = pg_temp.s('agm') and profile_id = pg_temp.id('11')), true);

-- Only the requester reads.
select pg_temp.as_member('01');
select pg_temp.fails('the admin who approved it can''t read under it', format($s$ select * from public.accessed_messages(%L) $s$, pg_temp.s('casey_req')), '%isn''t open%');
select pg_temp.fails('nor open a message under it', format($s$ select * from public.open_accessed_message(%L, %L) $s$, pg_temp.s('casey_req'), pg_temp.s('bus')), '%isn''t open%');
select pg_temp.ok('the admin sees the log', (select count(*) = 2 from public.message_access_log(pg_temp.s('casey_req'))), true);
select pg_temp.ok('the log names who looked and the message opened', (select bool_and(viewed_by_name = 'Emery Manager') and bool_or(kind = 'opened' and message_sender_name = 'Casey Coach') from public.message_access_log(pg_temp.s('casey_req'))), true);
select pg_temp.as_member('11');
select pg_temp.fails('the officer the concern is about can''t read under it', format($s$ select * from public.accessed_messages(%L) $s$, pg_temp.s('casey_req')), '%isn''t open%');
select pg_temp.ok('nor see the log', exists (select 1 from public.message_access_log(pg_temp.s('casey_req'))), false);
select pg_temp.as_member('41');
select pg_temp.ok('a parent can''t see the log', exists (select 1 from public.message_access_log(pg_temp.s('casey_req'))), false);
select pg_temp.as_member('23');
select pg_temp.ok('the committee can''t see the log', exists (select 1 from public.message_access_log(pg_temp.s('casey_req'))), false);
select pg_temp.ok('nothing went in the record views log parents can read', (select count(*) = 0 from public.record_access_log where viewer_id = pg_temp.id('13')), true);

-- The 24 hours end.
reset role;
update public.message_access_requests set access_expires_at = now() - interval '1 minute' where id = pg_temp.s('casey_req');
select pg_temp.as_member('13');
select pg_temp.fails('after 24 hours nothing can be read', format($s$ select * from public.accessed_messages(%L) $s$, pg_temp.s('casey_req')), '%isn''t open%');
select pg_temp.fails('nor opened', format($s$ select * from public.open_accessed_message(%L, %L) $s$, pg_temp.s('casey_req'), pg_temp.s('bus')), '%isn''t open%');
-- An officer who loses the post loses open access.
reset role;
update public.message_access_requests set access_expires_at = now() + interval '1 hour' where id = pg_temp.s('casey_req');
select pg_temp.as_member('01');
select public.admin_set_safeguarding(pg_temp.id('11'), pg_temp.id('42'), null, null, null, null);
select pg_temp.as_member('13');
select pg_temp.fails('an officer replaced in the post can''t read', format($s$ select * from public.accessed_messages(%L) $s$, pg_temp.s('casey_req')), '%isn''t open%');
select pg_temp.as_member('01');
select public.admin_set_safeguarding(pg_temp.id('11'), pg_temp.id('13'), null, null, null, null);

-- ---------------------------------------------------------------------------
-- Who answers when an admin is involved
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
insert into saved values ('alex_req', public.request_message_access(pg_temp.s('about_alex'), pg_temp.id('01'), 'about', public.club_today() - 30, public.club_today(), 'Messages Alex sent the club'));
select pg_temp.ok('the Child Safety Officer can ask about an admin', (pg_temp.req('alex_req')).requested_post = 'child_safety_officer', true);
select pg_temp.as_member('01');
select pg_temp.ok('the admin it''s about never sees it', pg_temp.sees('alex_req'), false);
select pg_temp.fails('the admin it''s about can''t answer it', format($s$ select public.decide_message_access(%L, false, 'This is about me so no') $s$, pg_temp.s('alex_req')), 'Request not found');
select pg_temp.as_member('02');
select pg_temp.ok('the other admin can answer it', pg_temp.can_decide('alex_req'), true);
select pg_temp.as_member('13');
select pg_temp.ok('the other officer can''t while an admin can', pg_temp.can_decide('alex_req'), false);
select pg_temp.fails('so the other officer is refused', format($s$ select public.decide_message_access(%L, true, 'Approving as the other officer') $s$, pg_temp.s('alex_req')), 'Someone else must answer%');
-- With Blair stood down, no admin is left who isn't involved.
reset role;
update public.profiles set stood_down_at = now() where id = pg_temp.id('02');
select pg_temp.as_member('02');
select pg_temp.ok('a stood-down admin can''t answer', pg_temp.can_decide('alex_req'), false);
select pg_temp.as_member('13');
select pg_temp.ok('the other officer can answer when no admin can', pg_temp.can_decide('alex_req'), true);
select pg_temp.as_member('11');
select pg_temp.ok('the requester still can''t', pg_temp.can_decide('alex_req'), false);
select pg_temp.as_member('01');
select pg_temp.ok('the lone admin is told to add a second admin', (select only_one_admin from public.message_access_todo()), true);
select pg_temp.as_member('13');
select pg_temp.ok('the other officer has it to answer', (select to_decide = 1 from public.message_access_todo()), true);
select public.decide_message_access(pg_temp.s('alex_req'), true, 'No admin free to answer, concern is serious');
select pg_temp.ok('the other officer approved it', (pg_temp.req('alex_req')).decided_by_name = 'Emery Manager', true);
select pg_temp.as_member('11');
select pg_temp.ok('the requester''s access shows as a to-do', (select open_access = 1 from public.message_access_todo()), true);
reset role;
update public.profiles set stood_down_at = null where id = pg_temp.id('02');
select pg_temp.as_member('01');
select pg_temp.ok('with two admins there''s no warning', (select only_one_admin from public.message_access_todo()), false);
select pg_temp.ok('Alex has Logan''s request to answer', (select to_decide = 1 from public.message_access_todo()), true);
select pg_temp.as_member('32');
select pg_temp.ok('an athlete has nothing to do', (select to_decide = 0 and open_access = 0 and not only_one_admin from public.message_access_todo()), true);

-- ---------------------------------------------------------------------------
-- Legal hold and closed concerns
-- ---------------------------------------------------------------------------
select pg_temp.ok('Jordan is on hold while the concern naming him in a request is open', public.on_legal_hold(pg_temp.id('31')), true);
select pg_temp.ok('so is Logan', public.on_legal_hold(pg_temp.id('41')), true);
select pg_temp.ok('Kai stays on hold as who a concern is about', public.on_legal_hold(pg_temp.id('32')), true);
select pg_temp.ok('Morgan isn''t on hold', public.on_legal_hold(pg_temp.id('42')), false);
select pg_temp.as_member('13');
select public.add_concern_event(pg_temp.s('about_casey'), 'status_changed', 'Dealt with', 'closed');
select pg_temp.ok('closing the concern ends the hold on Jordan', public.on_legal_hold(pg_temp.id('31')), false);
select pg_temp.ok('the request shows the concern is closed', (select not concern_open from public.message_access_requests() where id = pg_temp.s('jordan_req')), true);
select pg_temp.fails('no new requests on a closed concern', format($s$ select public.request_message_access(%L, %L, 'raised_by', public.club_today() - 30, public.club_today(), 'Messages Jordan got from Casey') $s$, pg_temp.s('about_casey'), pg_temp.id('31')), '%concern is closed%');
select pg_temp.ok('requests are never removed', (select count(*) = 4 from public.message_access_requests), true);
