-- Tests for 20261119135000_wwcc_self_submit.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
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
create or replace function pg_temp.has_todo(n text, key_prefix text) returns boolean language sql as
$$ select exists (select 1 from public.member_todos(('00000000-0000-0000-0000-0000000000' || n)::uuid) m where m.todo_key like key_prefix || '%') $$;
create or replace function pg_temp.coach_role(n text) returns boolean language plpgsql as
$$ begin perform pg_temp.as_member(n); return public.has_role('coach'); end $$;

-- 12 Drew Lapsed: a coach whose card expired yesterday, so the role is paused.
-- 11 Casey Coach: a coach with a current card. 01 and 02 admins. 31 a child
-- athlete, 32 an adult athlete, 41 a parent, 23 an exempt treasurer.

-- Nobody reaches the table directly.
select pg_temp.ok('signed-in members cannot read submissions', has_table_privilege('authenticated', 'public.wwcc_submissions', 'select'), false);
select pg_temp.ok('signed-in members cannot write submissions', has_table_privilege('authenticated', 'public.wwcc_submissions', 'insert'), false);
select pg_temp.ok('anon cannot submit', has_function_privilege('anon', 'public.submit_my_wwcc(text, date, text)', 'execute'), false);
select pg_temp.ok('anon cannot list submissions', has_function_privilege('anon', 'public.admin_wwcc_submissions()', 'execute'), false);
select pg_temp.ok('anon cannot accept', has_function_privilege('anon', 'public.admin_accept_wwcc_submission(uuid, text, text, boolean)', 'execute'), false);
select pg_temp.ok('anon cannot send back', has_function_privilege('anon', 'public.admin_return_wwcc_submission(uuid, text)', 'execute'), false);
select pg_temp.ok('nobody calls the trigger function', has_function_privilege('authenticated', 'public.close_wwcc_submission_on_card()', 'execute'), false);

select pg_temp.ok('the lapsed coach starts paused', pg_temp.coach_role('12'), false);
select pg_temp.ok('push: the paused coach is asked to add their card', pg_temp.has_todo('12', 'wwcc-send:'), true);
select pg_temp.ok('push: a coach with a current card is not', pg_temp.has_todo('11', 'wwcc-'), false);
select pg_temp.ok('push: an athlete is not', pg_temp.has_todo('32', 'wwcc-'), false);
select pg_temp.ok('push: an exempt treasurer is not', pg_temp.has_todo('23', 'wwcc-'), false);
select pg_temp.ok('push: nobody has cards to check yet', pg_temp.has_todo('01', 'wwcc-sent:'), false);

-- Who may send a card in.
select pg_temp.as_member('31');
select pg_temp.fails('a child athlete cannot send a card in', $s$ select public.submit_my_wwcc('WWC9031', public.club_today() + 300, 'Jordan Junior') $s$);
select pg_temp.as_member('32');
select pg_temp.fails('an adult athlete cannot send a card in', $s$ select public.submit_my_wwcc('WWC9032', public.club_today() + 300, 'Kai Senior') $s$);
select pg_temp.as_member('41');
select pg_temp.fails('a parent without a club role cannot send a card in', $s$ select public.submit_my_wwcc('WWC9041', public.club_today() + 300, 'Logan Parent') $s$);
select pg_temp.as_member('23');
select pg_temp.fails('an exempt treasurer cannot send a card in', $s$ select public.submit_my_wwcc('WWC9023', public.club_today() + 300, 'Indy Treasurer') $s$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
select pg_temp.fails('someone who isn''t a member cannot send a card in', $s$ select public.submit_my_wwcc('WWC90FF', public.club_today() + 300, 'Nobody') $s$);

-- What a card needs.
select pg_temp.as_member('12');
select pg_temp.fails('a card number is needed', $s$ select public.submit_my_wwcc('  ', public.club_today() + 300, 'Drew Lapsed') $s$);
select pg_temp.fails('a card number over 30 characters is refused', $s$ select public.submit_my_wwcc(repeat('1', 31), public.club_today() + 300, 'Drew Lapsed') $s$);
select pg_temp.fails('an expiry is needed', $s$ select public.submit_my_wwcc('WWC1212', null, 'Drew Lapsed') $s$);
select pg_temp.fails('an expired card is refused', $s$ select public.submit_my_wwcc('WWC1212', public.club_today() - 1, 'Drew Lapsed') $s$);
select pg_temp.fails('an expiry over three years away is refused', $s$ select public.submit_my_wwcc('WWC1212', (public.club_today() + interval '3 years 1 day')::date, 'Drew Lapsed') $s$);
select pg_temp.fails('the name on the card is needed', $s$ select public.submit_my_wwcc('WWC1212', public.club_today() + 300, ' ') $s$);
select pg_temp.fails('a name over 120 characters is refused', $s$ select public.submit_my_wwcc('WWC1212', public.club_today() + 300, repeat('a', 121)) $s$);

-- The paused coach sends a card in. Their role stays paused.
select pg_temp.works('the paused coach sends a card in', $s$ select public.submit_my_wwcc(' wwc1212 ', public.club_today() + 700, 'Drew Lapsed') $s$);
select pg_temp.ok('the card number is tidied', (select card_number = 'WWC1212' from public.my_wwcc_submission()), true);
select pg_temp.ok('they see it waiting', (select status = 'waiting' from public.my_wwcc_submission()), true);
select pg_temp.ok('their record is unchanged', (select wwcc_number = 'WWC0012' and wwcc_expires_on = public.club_today() - 1 from public.profiles where id = '00000000-0000-0000-0000-000000000012'), true);
select pg_temp.ok('their coach role is still paused', pg_temp.coach_role('12'), false);
select pg_temp.as_member('11');
select pg_temp.ok('another member sees nothing of it', not exists (select 1 from public.my_wwcc_submission()), true);
select pg_temp.ok('a coach cannot list cards sent in', not exists (select 1 from public.admin_wwcc_submissions()), true);

-- Sending again replaces it.
select pg_temp.as_member('12');
select pg_temp.works('they correct the expiry and send again', $s$ select public.submit_my_wwcc('WWC1212', public.club_today() + 800, 'Drew Lapsed') $s$);
select pg_temp.ok('one card waiting', (select count(*) = 1 from public.wwcc_submissions where profile_id = '00000000-0000-0000-0000-000000000012' and status = 'waiting'), true);
select pg_temp.ok('the first one is replaced', (select count(*) = 1 from public.wwcc_submissions where profile_id = '00000000-0000-0000-0000-000000000012' and status = 'replaced'), true);
select pg_temp.ok('they see the new expiry', (select expires_on = public.club_today() + 800 from public.my_wwcc_submission()), true);

-- Admins see it.
select pg_temp.as_member('01');
select pg_temp.ok('push: the coach is asked nothing while the card waits', pg_temp.has_todo('12', 'wwcc-send'), false);
select pg_temp.ok('push: admins are asked to check it', pg_temp.has_todo('01', 'wwcc-sent:'), true);
select pg_temp.ok('push: the admin''s item names the count', (select title = 'Check 1 Working With Children Check members sent in' from public.member_todos('00000000-0000-0000-0000-000000000001') where todo_key like 'wwcc-sent:%'), true);
select pg_temp.ok('push: a coach is not asked to check cards', pg_temp.has_todo('11', 'wwcc-sent:'), false);
select pg_temp.as_member('01');
select pg_temp.ok('the admin sees one card waiting, named', (select count(*) = 1 and bool_and(member_name = 'Drew Lapsed' and card_number = 'WWC1212') from public.admin_wwcc_submissions()), true);
create temp table t as select (select id from public.wwcc_submissions where profile_id = '00000000-0000-0000-0000-000000000012' and status = 'waiting') as sub;
grant select on t to public;

-- Only admins decide.
select pg_temp.as_member('11');
select pg_temp.fails('a coach cannot accept a card', format('select public.admin_accept_wwcc_submission(%L, %L, %L, true)', (select sub from t), 'Drew Lapsed', 'online'));
select pg_temp.fails('a coach cannot send a card back', format('select public.admin_return_wwcc_submission(%L, %L)', (select sub from t), 'No'));
select pg_temp.as_member('21');
select pg_temp.fails('a committee member cannot accept a card', format('select public.admin_accept_wwcc_submission(%L, %L, %L, true)', (select sub from t), 'Drew Lapsed', 'online'));
select pg_temp.as_member('12');
select pg_temp.fails('the member cannot accept their own card', format('select public.admin_accept_wwcc_submission(%L, %L, %L, true)', (select sub from t), 'Drew Lapsed', 'online'));

-- Sent back with a note.
select pg_temp.as_member('01');
select pg_temp.fails('sending back needs a note', format('select public.admin_return_wwcc_submission(%L, %L)', (select sub from t), '  '));
select pg_temp.works('the admin sends it back', format('select public.admin_return_wwcc_submission(%L, %L)', (select sub from t), 'The Screening Unit has a different expiry'));
select pg_temp.ok('nothing waiting for admins now', not exists (select 1 from public.admin_wwcc_submissions()), true);
select pg_temp.fails('a card sent back cannot then be accepted', format('select public.admin_accept_wwcc_submission(%L, %L, %L, true)', (select sub from t), 'Drew Lapsed', 'online'));
select pg_temp.as_member('12');
select pg_temp.ok('the member reads the note', (select status = 'returned' and return_note = 'The Screening Unit has a different expiry' from public.my_wwcc_submission()), true);
select pg_temp.ok('their coach role is still paused after it''s sent back', pg_temp.coach_role('12'), false);
select pg_temp.ok('push: the coach is asked to send it again, with the note',
  (select detail = 'Sent back: The Screening Unit has a different expiry' from public.member_todos('00000000-0000-0000-0000-000000000012') where todo_key like 'wwcc-send-again:%'), true);
select pg_temp.ok('push: and not also to add a card', pg_temp.has_todo('12', 'wwcc-send:'), false);
select pg_temp.as_member('12');

-- Sent again and accepted.
select pg_temp.works('they send it again', $s$ select public.submit_my_wwcc('WWC1212', public.club_today() + 900, 'Drew Lapsed') $s$);
update t set sub = (select id from public.wwcc_submissions where profile_id = '00000000-0000-0000-0000-000000000012' and status = 'waiting');
select pg_temp.as_member('01');
select pg_temp.fails('accepting needs the name on the card', format('select public.admin_accept_wwcc_submission(%L, %L, %L, true)', (select sub from t), ' ', 'online'));
select pg_temp.fails('accepting needs how it was checked', format('select public.admin_accept_wwcc_submission(%L, %L, %L, true)', (select sub from t), 'Drew Lapsed', 'phone'));
select pg_temp.works('the admin accepts it', format('select public.admin_accept_wwcc_submission(%L, %L, %L, true)', (select sub from t), 'Drew A Lapsed', 'online'));
select pg_temp.ok('the card is recorded and validated',
  (select wwcc_number = 'WWC1212' and wwcc_expires_on = public.club_today() + 900 and wwcc_card_name = 'Drew A Lapsed'
     and wwcc_validated_by = '00000000-0000-0000-0000-000000000001' and wwcc_validation_method = 'online'
     and wwcc_unit_linked_at is not null
   from public.profiles where id = '00000000-0000-0000-0000-000000000012'), true);
select pg_temp.ok('the submission is accepted by the admin', (select status = 'accepted' and decided_by_name = 'Alex Admin' from public.wwcc_submissions where id = (select sub from t)), true);
select pg_temp.fails('it cannot be accepted twice', format('select public.admin_accept_wwcc_submission(%L, %L, %L, true)', (select sub from t), 'Drew Lapsed', 'online'));
select pg_temp.ok('their coach role is back', pg_temp.coach_role('12'), true);
select pg_temp.ok('push: the accepted coach is asked nothing more', pg_temp.has_todo('12', 'wwcc-'), false);
select pg_temp.ok('push: admins have nothing left to check', pg_temp.has_todo('01', 'wwcc-sent:'), false);
select pg_temp.as_member('12');
select pg_temp.ok('the member no longer sees a card waiting', not exists (select 1 from public.my_wwcc_submission()), true);
select pg_temp.fails('they cannot send the same validated card again', $s$ select public.submit_my_wwcc('WWC1212', public.club_today() + 900, 'Drew Lapsed') $s$);

-- An admin's own card goes to another admin.
select pg_temp.as_member('02');
select pg_temp.works('an admin with no card sends theirs in', $s$ select public.submit_my_wwcc('WWC0202', public.club_today() + 500, 'Blair Admin') $s$);
update t set sub = (select id from public.wwcc_submissions where profile_id = '00000000-0000-0000-0000-000000000002' and status = 'waiting');
select pg_temp.fails('they cannot accept it themselves', format('select public.admin_accept_wwcc_submission(%L, %L, %L, false)', (select sub from t), 'Blair Admin', 'online'));
select pg_temp.fails('they cannot send it back themselves', format('select public.admin_return_wwcc_submission(%L, %L)', (select sub from t), 'No'));
select pg_temp.ok('their own card shows in the admin list for another admin to check', exists (select 1 from public.admin_wwcc_submissions() where profile_id = '00000000-0000-0000-0000-000000000002'), true);

-- A card the admin records by hand closes the waiting one.
select pg_temp.as_member('01');
select pg_temp.works('another admin records a card by hand', $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000002', null, 'WWC0202', public.club_today() + 500) $s$);
select pg_temp.ok('the waiting card is closed as recorded', (select status = 'recorded' from public.wwcc_submissions where id = (select sub from t)), true);
select pg_temp.ok('no card left waiting', not exists (select 1 from public.admin_wwcc_submissions()), true);

-- A stood-down member's roles aren't paused for want of a card.
select pg_temp.works('an admin stands the manager down', $s$ select public.admin_stand_down('00000000-0000-0000-0000-000000000013', 'other', 'Under review') $s$);
select pg_temp.as_member('13');
select pg_temp.fails('a stood-down member cannot send a card in', $s$ select public.submit_my_wwcc('WWC1313', public.club_today() + 300, 'Emery Manager') $s$);

-- A card that expired while waiting cannot be accepted.
select pg_temp.as_member('21');
select pg_temp.works('the committee member sends a card in', $s$ select public.submit_my_wwcc('WWC2121', public.club_today() + 10, 'Gale Committee') $s$);
update public.wwcc_submissions set expires_on = public.club_today() - 1 where profile_id = '00000000-0000-0000-0000-000000000021' and status = 'waiting';
select pg_temp.as_member('01');
select pg_temp.fails('a card that expired while waiting is refused', format('select public.admin_accept_wwcc_submission(%L, %L, %L, true)',
  (select id from public.wwcc_submissions where profile_id = '00000000-0000-0000-0000-000000000021' and status = 'waiting'), 'Gale Committee', 'online'));

-- A card expiring within 60 days asks for the renewed one, once per card.
update public.profiles set wwcc_expires_on = public.club_today() + 30 where id = '00000000-0000-0000-0000-000000000014';
select pg_temp.ok('push: a physio whose card expires in 30 days is asked for the renewed one', pg_temp.has_todo('14', 'wwcc-renew:' || (public.club_today() + 30)), true);
update public.profiles set wwcc_expires_on = public.club_today() + 61 where id = '00000000-0000-0000-0000-000000000014';
select pg_temp.ok('push: not when it expires in 61 days', pg_temp.has_todo('14', 'wwcc-'), false);
-- A stood-down member is asked nothing.
select pg_temp.ok('push: the stood-down manager is asked nothing', pg_temp.has_todo('13', 'wwcc-'), false);
