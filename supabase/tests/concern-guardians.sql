-- Tests for 20261120700000_concern_guardians_and_contact_titles.sql: a concern
-- about a child shows the child's verified parents and guardians to those who
-- handle it, each look kept with the concern (never in the child's record
-- views, which parents read); and members see the safeguarding posts they
-- hold. Run on a fresh database with the migrations and seed-members.sql
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
create or replace function pg_temp.guardians(n text, concern uuid) returns text language sql as
$$ select pg_temp.as_member(n);
   select coalesce(string_agg(name || '<' || coalesce(email, '') || '>', ', ' order by name), '')
   from public.concern_guardians(concern) $$;
create or replace function pg_temp.views(concern uuid) returns bigint language sql as
$$ select count(*) from public.concern_guardian_views where concern_id = concern $$;

-- Casey Coach (11) is the Child Safety Officer, Emery Manager (13) the
-- Complaints Manager, Alex Admin (01) the WWC Registration Officer.
select pg_temp.as_member('01');
select public.admin_set_safeguarding(pg_temp.id('11'), pg_temp.id('13'), null, null, null, null);
select public.admin_set_wwc_officer(pg_temp.id('01'));

-- Kai Senior (32) raises three concerns: about Jordan Junior (31, under 18,
-- guardians Logan Parent 41 and Morgan Coach-Parent 42), about himself as an
-- adult, and one naming nobody.
select pg_temp.as_member('32');
create temp table c as select
  public.raise_concern('Jordan was left alone after training', p_about_member_id => pg_temp.id('31'), p_involves_child => 'yes') as child,
  public.raise_concern('About an adult', p_about_member_id => pg_temp.id('32')) as adult,
  public.raise_concern('Nobody named', p_about_text => 'The away trip') as nobody;
reset role;
create temp table log_before as select count(*) as n from public.record_access_log;
create temp table new_before as select count(*) as n from public.concern_events;

-- ---------------------------------------------------------------------------
-- Who sees the child's parents and guardians
-- ---------------------------------------------------------------------------
select pg_temp.ok('the Child Safety Officer sees both verified guardians with their email',
  pg_temp.guardians('11', (select child from c)) =
  'Logan Parent<guardian@example.test>, Morgan Coach-Parent<coach.guardian@example.test>', true);
select pg_temp.ok('the Complaints Manager sees them too',
  pg_temp.guardians('13', (select child from c)) like 'Logan Parent<%>, Morgan Coach-Parent<%>', true);
select pg_temp.ok('an admin sees them too',
  pg_temp.guardians('02', (select child from c)) like 'Logan Parent<%>, Morgan Coach-Parent<%>', true);
select pg_temp.ok('a parent of the child does not (they don''t handle concerns)',
  pg_temp.guardians('41', (select child from c)) = '', true);
select pg_temp.ok('a coach who is also the child''s parent does not',
  pg_temp.guardians('42', (select child from c)) = '', true);
select pg_temp.ok('the child does not', pg_temp.guardians('31', (select child from c)) = '', true);
select pg_temp.ok('the person who raised it does not', pg_temp.guardians('32', (select child from c)) = '', true);
select pg_temp.ok('a committee member does not', pg_temp.guardians('22', (select child from c)) = '', true);
select pg_temp.ok('the WWC Registration Officer sees them only as an admin',
  pg_temp.guardians('01', (select child from c)) like 'Logan Parent<%>, Morgan Coach-Parent<%>', true);
select pg_temp.ok('nobody shown for a concern about an adult',
  pg_temp.guardians('11', (select adult from c)) = '', true);
select pg_temp.ok('nobody shown for a concern naming nobody',
  pg_temp.guardians('11', (select nobody from c)) = '', true);
select pg_temp.ok('nobody shown for a concern that doesn''t exist',
  pg_temp.guardians('11', gen_random_uuid()) = '', true);

-- ---------------------------------------------------------------------------
-- Each look is kept with the concern, not in the child's record views
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.ok('four looks kept: Child Safety Officer, Complaints Manager and two admins',
  pg_temp.views((select child from c)) = 4, true);
select pg_temp.ok('who looked, by name',
  (select array_agg(viewer_name order by viewer_name) = array['Alex Admin', 'Blair Admin', 'Casey Coach', 'Emery Manager']
   from public.concern_guardian_views where concern_id = (select child from c)), true);
select pg_temp.ok('refused and empty looks are not kept',
  (select count(*) = 0 from public.concern_guardian_views where concern_id <> (select child from c)), true);
select pg_temp.guardians('11', (select child from c)) <> '';
reset role;
select pg_temp.ok('a second look within 30 minutes is kept once',
  pg_temp.views((select child from c)) = 4, true);
update public.concern_guardian_views set created_at = now() - interval '31 minutes'
  where viewer_id = pg_temp.id('11');
select pg_temp.guardians('11', (select child from c)) <> '';
reset role;
select pg_temp.ok('a look after 30 minutes is kept again',
  pg_temp.views((select child from c)) = 5, true);
select pg_temp.ok('nothing written to the child''s record views (parents read them)',
  (select count(*) from public.record_access_log) = (select n from log_before), true);
select pg_temp.ok('looking is not an action: the concern stays New',
  (select count(*) from public.concern_events) = (select n from new_before), true);

select pg_temp.as_member('11');
select pg_temp.ok('the Child Safety Officer reads who has looked',
  (select count(*) = 5 from public.concern_guardian_views((select child from c))), true);
select pg_temp.ok('newest first',
  (select (array_agg(viewer_name))[1] = 'Casey Coach' from public.concern_guardian_views((select child from c))), true);
select pg_temp.as_member('41');
select pg_temp.ok('a parent can''t read who has looked',
  (select count(*) = 0 from public.concern_guardian_views((select child from c))), true);
select pg_temp.as_member('22');
select pg_temp.ok('a committee member can''t either',
  (select count(*) = 0 from public.concern_guardian_views((select child from c))), true);

-- ---------------------------------------------------------------------------
-- Only verified, approved parents and guardians
-- ---------------------------------------------------------------------------
reset role;
update public.profiles set verified_at = null where id = pg_temp.id('41');
select pg_temp.ok('a parent not verified yet is left off',
  pg_temp.guardians('11', (select child from c)) = 'Morgan Coach-Parent<coach.guardian@example.test>', true);
reset role;
update public.profiles set verified_at = now() where id = pg_temp.id('41');
update public.profiles set status = 'rejected' where id = pg_temp.id('42');
select pg_temp.ok('a parent no longer approved is left off',
  pg_temp.guardians('11', (select child from c)) = 'Logan Parent<guardian@example.test>', true);
reset role;
update public.profiles set status = 'approved' where id = pg_temp.id('42');

-- ---------------------------------------------------------------------------
-- A handler the concern is about, or one who can't act now, sees nothing
-- ---------------------------------------------------------------------------
-- Naming the Complaints Manager hides the concern from him, guardians included.
select pg_temp.as_member('11');
select public.set_concern_about((select child from c), pg_temp.id('13'));
select pg_temp.ok('the person it''s about sees no guardians',
  pg_temp.guardians('13', (select child from c)) = '', true);
select pg_temp.ok('and once it names an adult, nobody sees guardians',
  pg_temp.guardians('11', (select child from c)) = '', true);
select pg_temp.as_member('11');
select public.set_concern_about((select child from c), pg_temp.id('31'));
reset role;
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('11');
select pg_temp.ok('a Child Safety Officer whose check lapsed sees nothing',
  pg_temp.guardians('11', (select child from c)) = '', true);
reset role;
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('11');

-- ---------------------------------------------------------------------------
-- Access to the functions and the table
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.ok('anon cannot call concern_guardians',
  not has_function_privilege('anon', 'public.concern_guardians(uuid)', 'execute'), true);
select pg_temp.ok('anon cannot call concern_guardian_views',
  not has_function_privilege('anon', 'public.concern_guardian_views(uuid)', 'execute'), true);
select pg_temp.ok('anon cannot call my_safeguarding_posts',
  not has_function_privilege('anon', 'public.my_safeguarding_posts()', 'execute'), true);
select pg_temp.ok('signed-in members cannot read the looks table directly',
  not has_table_privilege('authenticated', 'public.concern_guardian_views', 'select'), true);
select pg_temp.ok('or write to it',
  not has_table_privilege('authenticated', 'public.concern_guardian_views', 'insert'), true);
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.fails('a direct read is refused', $s$ select * from public.concern_guardian_views $s$);
reset role;

-- ---------------------------------------------------------------------------
-- The safeguarding posts a member holds
-- ---------------------------------------------------------------------------
create or replace function pg_temp.posts(n text) returns text language sql as
$$ select pg_temp.as_member(n);
   select concat_ws(',',
     case when child_safety_officer then 'cso' end,
     case when complaints_manager then 'cm' end,
     case when wwc_registration_officer then 'wwc' end)
   from public.my_safeguarding_posts() $$;

select pg_temp.ok('Casey is the Child Safety Officer', pg_temp.posts('11') = 'cso', true);
select pg_temp.ok('Emery is the Complaints Manager', pg_temp.posts('13') = 'cm', true);
select pg_temp.ok('Alex is the WWC Registration Officer', pg_temp.posts('01') = 'wwc', true);
select pg_temp.ok('an athlete holds none', pg_temp.posts('32') = '', true);
select pg_temp.ok('a parent holds none', pg_temp.posts('41') = '', true);
select pg_temp.ok('another admin holds none', pg_temp.posts('02') = '', true);
select pg_temp.as_member('01');
select public.admin_set_safeguarding(pg_temp.id('13'), pg_temp.id('11'), null, null, null, null);
select pg_temp.ok('swapping the contacts swaps the titles',
  pg_temp.posts('11') = 'cm' and pg_temp.posts('13') = 'cso', true);
reset role;
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('13');
select pg_temp.ok('a contact whose check lapsed shows no title',
  pg_temp.posts('13') = '', true);
reset role;
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('13');
update public.profiles set role = 'coach' where id = pg_temp.id('01');
select pg_temp.ok('a WWC Registration Officer no longer an admin or on the committee shows no title',
  pg_temp.posts('01') = '', true);
reset role;
update public.profiles set role = 'admin' where id = pg_temp.id('01');
select pg_temp.ok('and shows it again once they are',
  pg_temp.posts('01') = 'wwc', true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in gets no row',
  (select count(*) = 0 from public.my_safeguarding_posts()), true);
