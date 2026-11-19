-- Tests for 20261119120000_concern_counts.sql: the red, orange and green
-- counts on the home screen's Concerns card. Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
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
-- The three counts as "new/in progress/closed", such as '2/3/2'.
create or replace function pg_temp.counts() returns text language sql as
$$ select new_count || '/' || in_progress_count || '/' || closed_recent_count from public.concern_counts() $$;
create or replace function pg_temp.concern(b text) returns uuid language sql as
$$ select id from public.concerns where body = b $$;

-- Casey Coach (11) is the Child Safety Officer, Emery Manager (13) the
-- Complaints Manager.
select pg_temp.as_member('01');
select public.admin_set_safeguarding('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000013',
  null, null, null, null);

select pg_temp.ok('no concerns: all zero', pg_temp.counts() = '0/0/0', true);

-- Kai Senior (32) raises eight concerns, one of them about Casey Coach.
select pg_temp.as_member('32');
select count(*) from (
  select public.raise_concern(b) from unnest(array['New', 'Noted', 'Referred', 'Looked into',
    'Closed today', 'Closed 27 days ago', 'Closed 29 days ago']) b
) x;
select public.raise_concern('About the officer', p_about_member_id => '00000000-0000-0000-0000-000000000011');

select pg_temp.as_member('01');
select pg_temp.ok('all new before anyone acts', pg_temp.counts() = '8/0/0', true);

-- The admin acts on them.
select public.add_concern_event(pg_temp.concern('Noted'), 'note', 'Called the family');
select public.add_concern_event(pg_temp.concern('Referred'), 'referred_police', 'Reported to local police');
select public.add_concern_event(pg_temp.concern('Looked into'), 'status_changed', 'Started', 'under_review');
select public.add_concern_event(pg_temp.concern(b), 'status_changed', 'Resolved with the family', 'closed')
from unnest(array['Closed today', 'Closed 27 days ago', 'Closed 29 days ago']) b;
reset role;
update public.concerns set closed_at = now() - interval '27 days' where body = 'Closed 27 days ago';
update public.concerns set closed_at = now() - interval '29 days' where body = 'Closed 29 days ago';

select pg_temp.ok('a note keeps the status Received',
  (select status = 'received' from public.concerns where body = 'Noted'), true);

-- Red: new and not acted on. Orange: noted, referred, being looked into.
-- Green: closed today and 27 days ago, not 29 days ago.
select pg_temp.as_member('01');
select pg_temp.ok('admin: 2 new, 3 in progress, 2 closed in 4 weeks', pg_temp.counts() = '2/3/2', true);
select pg_temp.ok('admin: red matches the new-concern to-do',
  (select new_count = public.new_concerns_count() from public.concern_counts()), true);
select pg_temp.as_member('13');
select pg_temp.ok('Complaints Manager: same as admin', pg_temp.counts() = '2/3/2', true);
select pg_temp.as_member('11');
select pg_temp.ok('officer does not count the concern about them', pg_temp.counts() = '1/3/2', true);
select pg_temp.ok('officer: red matches the new-concern to-do',
  (select new_count = public.new_concerns_count() from public.concern_counts()), true);

-- Once acted on, the concern about the officer moves from red to orange.
select pg_temp.as_member('01');
select public.add_concern_event(pg_temp.concern('About the officer'), 'referred_governing_body', 'Sent the complaints form');
select pg_temp.ok('admin: red to orange after a referral', pg_temp.counts() = '1/4/2', true);
select pg_temp.as_member('11');
select pg_temp.ok('officer still does not count it', pg_temp.counts() = '1/3/2', true);

-- Nobody else sees any counts, whatever their role.
create or replace function pg_temp.counts_for(n text) returns text language plpgsql as
$$ begin perform pg_temp.as_member(n); return pg_temp.counts(); end $$;
select pg_temp.ok('member ' || n || ' sees zeros', pg_temp.counts_for(n) = '0/0/0', true)
from unnest(array['12', '14', '21', '22', '23', '31', '32', '41', '42']) n;
select pg_temp.as_member('02');
select pg_temp.ok('second admin sees the same counts', pg_temp.counts() = '1/4/2', true);

-- An officer whose check lapses stops seeing counts.
reset role;
update public.profiles set wwcc_expires_on = current_date - 1 where id = '00000000-0000-0000-0000-000000000013';
select pg_temp.as_member('13');
select pg_temp.ok('lapsed officer sees zeros', pg_temp.counts() = '0/0/0', true);

-- Signed out, nothing.
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('signed out sees zeros', pg_temp.counts() = '0/0/0', true);
set role anon;
select pg_temp.fails('anon cannot call concern_counts', 'select public.concern_counts()');
reset role;
