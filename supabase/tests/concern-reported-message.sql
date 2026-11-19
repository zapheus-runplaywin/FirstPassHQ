-- Tests for 20261119130000_concern_reported_message.sql: a reported message
-- is copied into the concern, and those who handle concerns can name any
-- approved member as who it's about. Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
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

-- Casey Coach (11) is the Child Safety Officer, Emery Manager (13) the
-- Complaints Manager.
select pg_temp.as_member('01');
select public.admin_set_safeguarding(pg_temp.id('11'), pg_temp.id('13'), null, null, null, null);

-- Casey Coach messages Kai Senior (32); Emery Manager messages Logan Parent (41).
reset role;
insert into public.messages (id, sender_id, sender_name, body, audience, created_at) values
  ('c0000000-0000-0000-0000-000000000001', pg_temp.id('11'), 'Casey Coach', 'Come early on your own, don''t tell your parents', 'club', now() - interval '2 hours'),
  ('c0000000-0000-0000-0000-000000000002', pg_temp.id('13'), 'Emery Manager', 'Bus leaves at 7', 'club', now() - interval '1 hour');
insert into public.message_recipients (message_id, profile_id) values
  ('c0000000-0000-0000-0000-000000000001', pg_temp.id('32')),
  ('c0000000-0000-0000-0000-000000000002', pg_temp.id('41'));

select pg_temp.ok('one raise_concern, no overload left behind',
  (select count(*) = 1 from pg_proc where proname = 'raise_concern' and pronamespace = 'public'::regnamespace), true);
select pg_temp.ok('anon cannot raise a concern',
  (select not has_function_privilege('anon', p.oid, 'execute') from pg_proc p
   where proname = 'raise_concern' and pronamespace = 'public'::regnamespace), true);

-- Kai reports the message, hiding his name.
select pg_temp.as_member('32');
select public.raise_concern('Strange message. Are they okay?', p_anonymous => true,
  p_context => 'Message from Casey Coach', p_message_id => 'c0000000-0000-0000-0000-000000000001') is not null;
select pg_temp.fails('cannot report a message they never got',
  $s$ select public.raise_concern('Not mine', p_message_id => 'c0000000-0000-0000-0000-000000000002') $s$);
select pg_temp.fails('cannot report a message that doesn''t exist',
  $s$ select public.raise_concern('Made up', p_message_id => 'c0000000-0000-0000-0000-0000000000ff') $s$);
select pg_temp.ok('a refused report saves nothing',
  (select count(*) = 1 from public.my_concerns()), true);
-- Without a message, as before (and an app not yet updated, which names
-- only the first nine parameters).
select public.raise_concern('Training finished late', p_about_text => 'Training times') is not null;
select pg_temp.ok('raiser sees both of theirs', (select count(*) = 2 from public.my_concerns()), true);

-- The Complaints Manager sees the copy; the raiser stays hidden.
select pg_temp.as_member('13');
select pg_temp.ok('the register has the message text',
  (select reported_message_body = 'Come early on your own, don''t tell your parents'
   from public.concern_register() where body like 'Strange%'), true);
select pg_temp.ok('and who sent it and when',
  (select reported_message_sender_name = 'Casey Coach' and reported_message_sent_at < now() - interval '1 hour'
   from public.concern_register() where body like 'Strange%'), true);
select pg_temp.ok('the reporter''s name stays hidden',
  (select anonymous and raised_by_name is null and contact_details is null
   from public.concern_register() where body like 'Strange%'), true);
select pg_temp.ok('a concern with no message has no copy',
  (select reported_message_body is null and reported_message_sender_name is null and reported_message_sent_at is null
   from public.concern_register() where body like 'Training%'), true);

-- The sender is the officer: as before, a concern naming them is hidden from
-- them once it does. Reporting alone doesn't name them.
select pg_temp.as_member('01');
select public.set_concern_about((select id from public.concerns where body like 'Strange%'), pg_temp.id('11'));
select pg_temp.as_member('11');
select pg_temp.ok('the sender, once named, can''t see the concern or the copy',
  (select count(*) = 0 from public.concern_register() where body like 'Strange%'), true);

-- The copy outlives the message: edited, then removed as old records are.
reset role;
update public.messages set body = 'Edited' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.as_member('01');
select pg_temp.ok('editing the message doesn''t change the copy',
  (select reported_message_body = 'Come early on your own, don''t tell your parents'
   from public.concern_register() where body like 'Strange%'), true);
reset role;
delete from public.messages where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.ok('removing the message keeps the copy',
  (select reported_message_id is null and reported_message_body like 'Come early%'
     and reported_message_sender_name = 'Casey Coach' and reported_message_sent_at is not null
   from public.concerns where body like 'Strange%'), true);

-- Who it's about: those who handle concerns can find any approved member.
select pg_temp.as_member('01');
select pg_temp.ok('admin finds the child athlete',
  (select count(*) = 1 from public.concern_about_people() where id = pg_temp.id('31')), true);
select pg_temp.ok('admin finds the adult athlete and the parent',
  (select count(*) = 2 from public.concern_about_people() where id in (pg_temp.id('32'), pg_temp.id('41'))), true);
select pg_temp.ok('admin finds the coaches too',
  (select count(*) = 1 from public.concern_about_people() where id = pg_temp.id('11')), true);
select pg_temp.as_member('13');
select pg_temp.ok('the Complaints Manager finds the child athlete',
  (select count(*) = 1 from public.concern_about_people() where id = pg_temp.id('31')), true);
select pg_temp.as_member('11');
select pg_temp.ok('the Child Safety Officer finds the parent',
  (select count(*) = 1 from public.concern_about_people() where id = pg_temp.id('41')), true);
select pg_temp.ok('names are in order', (select array_agg(name) = array_agg(name order by name) from public.concern_about_people()), true);

reset role;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'waiting.parent@example.test', now());
update public.profiles set full_name = 'Pat Waiting', status = 'pending' where id = '00000000-0000-0000-0000-000000000061';
select pg_temp.as_member('01');
select pg_temp.ok('nobody waiting for approval is listed',
  (select count(*) = 0 from public.concern_about_people() where id = pg_temp.id('61')), true);

create or replace function pg_temp.people_for(n text) returns bigint language plpgsql as
$$ begin perform pg_temp.as_member(n); return (select count(*) from public.concern_about_people()); end $$;
select pg_temp.ok('member ' || n || ' who doesn''t handle concerns finds nobody', pg_temp.people_for(n) = 0, true)
from unnest(array['12', '14', '21', '22', '23', '31', '32', '41', '42', '61']) n;

-- An officer whose check lapses stops finding anyone.
reset role;
update public.profiles set wwcc_expires_on = current_date - 1 where id = pg_temp.id('13');
select pg_temp.ok('a lapsed officer finds nobody', pg_temp.people_for('13') = 0, true);

-- Raise a concern still offers only adults with club roles, never children.
select pg_temp.as_member('32');
select pg_temp.ok('raising a concern doesn''t list the child athlete',
  (select count(*) = 0 from public.concern_people() where id = pg_temp.id('31')), true);
select pg_temp.ok('or parents',
  (select count(*) = 0 from public.concern_people() where id = pg_temp.id('41')), true);

select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.fails('anon cannot list people', 'select public.concern_about_people()');
reset role;
