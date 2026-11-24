-- Tests for 20261124200000_acting_safeguarding_posts.sql: while nobody named
-- as Child Safety Officer, Complaints Manager or WWC Registration Officer can
-- act, each admin who could hold the post acts in it, with its full powers,
-- and is shown as acting. Nobody else gains anything, and acting stops the
-- moment someone named can act. Run on a fresh database with the migrations
-- and seed-members.sql loaded. Prints one line per check.
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
-- Every power of a post, for the signed-in member, as one line.
create or replace function pg_temp.powers() returns text language sql as $$
  select concat_ws(',',
    case when public.is_safeguarding_officer() then 'officer' end,
    case when public.is_child_safety_officer() then 'cso' end,
    public.my_safeguarding_post(),
    case when (select child_safety_officer from public.my_acting_safeguarding_posts()) then 'acting-cso' end,
    case when (select complaints_manager from public.my_acting_safeguarding_posts()) then 'acting-cm' end,
    case when (select wwc_registration_officer from public.my_acting_safeguarding_posts()) then 'acting-wwc' end)
$$;
create temp table s (k text primary key, v uuid);
grant all on s to public;
create or replace function pg_temp.s(p_k text) returns uuid language sql as $$ select v from s where s.k = p_k $$;

-- Grants: a member can see their own acting posts; the helpers stay inside.
select pg_temp.ok('anon can''t read acting posts', has_function_privilege('anon', 'public.my_acting_safeguarding_posts()', 'execute'), false);
select pg_temp.ok('members can read their own', has_function_privilege('authenticated', 'public.my_acting_safeguarding_posts()', 'execute'), true);
select pg_temp.ok('members can''t call the acting check directly', has_function_privilege('authenticated', 'public.acting_in_safeguarding_post(text, uuid)', 'execute'), false);
select pg_temp.ok('nor list who acts', has_function_privilege('authenticated', 'public.safeguarding_post_acting_people(text)', 'execute'), false);

-- The sample club starts with nobody in any post.
delete from public.safeguarding_post_holders;
update public.safeguarding_settings set child_safety_officer_id = null, complaints_manager_id = null, wwc_officer_id = null where id;

-- Every kind of member, with every post empty. Only Alex (01), an admin with
-- a current check, acts; Blair (02), an admin with no check, doesn't.
select pg_temp.as_member('01');
select pg_temp.ok('an admin with a check acts in every empty post', pg_temp.powers() = 'officer,cso,child_safety_officer,acting-cso,acting-cm,acting-wwc', true);
select pg_temp.ok('their held posts are still none', (select not (child_safety_officer or complaints_manager or wwc_registration_officer) from public.my_safeguarding_posts()), true);
select pg_temp.as_member('02');
select pg_temp.ok('an admin with no check doesn''t act', pg_temp.powers() = '', true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach doesn''t act', pg_temp.powers() = '', true);
select pg_temp.as_member('13');
select pg_temp.ok('a manager doesn''t act', pg_temp.powers() = '', true);
select pg_temp.as_member('14');
select pg_temp.ok('a physio doesn''t act', pg_temp.powers() = '', true);
select pg_temp.as_member('21');
select pg_temp.ok('a committee member doesn''t act', pg_temp.powers() = '', true);
select pg_temp.as_member('31');
select pg_temp.ok('an athlete under 18 doesn''t act', pg_temp.powers() = '', true);
select pg_temp.as_member('32');
select pg_temp.ok('an adult athlete doesn''t act', pg_temp.powers() = '', true);
select pg_temp.as_member('41');
select pg_temp.ok('a parent doesn''t act', pg_temp.powers() = '', true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in acts in nothing', (select count(*) = 0 from public.my_acting_safeguarding_posts()), true);

-- Everyone sees the acting admin as the contact, marked acting.
select pg_temp.as_member('32');
select pg_temp.ok('members see the admin as acting Child Safety Officer',
  (select child_safety_officers = '[{"id": "00000000-0000-0000-0000-000000000001", "name": "Alex Admin", "acting": true}]' from public.safeguarding_contacts()), true);
select pg_temp.ok('and as acting Complaints Manager',
  (select complaints_managers = '[{"id": "00000000-0000-0000-0000-000000000001", "name": "Alex Admin", "acting": true}]' from public.safeguarding_contacts()), true);

-- The acting Child Safety Officer has the post's powers: wellbeing flags.
reset role;
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood)
values (pg_temp.id('32'), public.club_today() - 1, 1, 1, 1, 1)
on conflict do nothing;
select pg_temp.as_member('01');
select pg_temp.works('the acting Child Safety Officer reads wellbeing flags', $s$ select count(*) from public.wellbeing_flags() $s$);
select pg_temp.as_member('02');
select pg_temp.fails('an admin who doesn''t act can''t', $s$ select count(*) from public.wellbeing_flags() $s$);
select pg_temp.as_member('11');
select pg_temp.fails('nor can a coach', $s$ select count(*) from public.wellbeing_flags() $s$);

-- A concern, and asking to read messages for it.
select pg_temp.as_member('32');
insert into s values ('concern', public.raise_concern('Something at training worried me', p_about_member_id => pg_temp.id('11')));
select pg_temp.as_member('01');
select pg_temp.ok('the acting admin sees the concern', (select count(*) = 1 from public.concern_register()), true);
insert into s values ('request', public.request_message_access(pg_temp.s('concern'), pg_temp.id('11'), 'about',
  public.club_today() - 30, public.club_today(), 'Need to see what was sent'));
select pg_temp.ok('the acting admin can ask to read messages', pg_temp.s('request') is not null, true);
reset role;
select pg_temp.ok('the request records they were acting, as Child Safety Officer',
  (select requested_acting and requested_post = 'child_safety_officer' from public.message_access_requests where id = pg_temp.s('request')), true);
select pg_temp.as_member('01');
select pg_temp.ok('they can''t answer their own request', (select not can_decide from public.message_access_requests() where id = pg_temp.s('request')), true);
select pg_temp.as_member('02');
select pg_temp.ok('the other admin sees it was asked while acting',
  (select requested_acting and can_decide from public.message_access_requests() where id = pg_temp.s('request')), true);
select pg_temp.as_member('02');
select pg_temp.fails('an admin who doesn''t act still can''t ask',
  format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('concern'), pg_temp.id('11')));
select pg_temp.as_member('21');
select pg_temp.fails('nor can the committee',
  format($s$ select public.request_message_access(%L, %L, 'about', public.club_today() - 30, public.club_today(), 'Need to see these messages') $s$, pg_temp.s('concern'), pg_temp.id('11')));
select pg_temp.as_member('11');
select pg_temp.ok('the coach the concern is about sees nothing', (select count(*) = 0 from public.concern_register()), true);

-- An admin a concern is about can't handle it, even while acting.
select pg_temp.as_member('32');
insert into s values ('about_admin', public.raise_concern('About the admin', p_about_member_id => pg_temp.id('01')));
select pg_temp.as_member('01');
select pg_temp.ok('an acting admin doesn''t see a concern about them', (select count(*) = 0 from public.concern_register() where id = pg_temp.s('about_admin')), true);

-- Someone named who can act ends acting in that post only.
reset role;
insert into public.safeguarding_post_holders (post, profile_id) values ('child_safety_officer', pg_temp.id('11'));
select pg_temp.as_member('01');
select pg_temp.ok('named Child Safety Officer: the admin stops acting in it, still acts as Complaints Manager',
  pg_temp.powers() = 'officer,complaints_manager,acting-cm,acting-wwc', true);
select pg_temp.as_member('11');
select pg_temp.ok('the named coach acts as a holder, not acting', pg_temp.powers() = 'officer,cso,child_safety_officer', true);
select pg_temp.as_member('32');
select pg_temp.ok('members see the coach, not marked acting',
  (select child_safety_officers = '[{"id": "00000000-0000-0000-0000-000000000011", "name": "Casey Coach", "acting": false}]' from public.safeguarding_contacts()), true);
select pg_temp.as_member('41');
insert into s values ('other', public.raise_concern('Something else worried me'));
select pg_temp.as_member('11');
insert into s values ('held_request', public.request_message_access(pg_temp.s('other'), pg_temp.id('41'), 'raised_by',
  public.club_today() - 30, public.club_today(), 'Need to see what was sent'));
reset role;
select pg_temp.ok('a holder''s request isn''t marked acting',
  (select not requested_acting from public.message_access_requests where id = pg_temp.s('held_request')), true);

-- A named holder whose check lapses can't act, so the admin acts again.
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('11');
select pg_temp.as_member('01');
select pg_temp.ok('a lapsed holder can''t act, so the admin acts again', pg_temp.powers() = 'officer,cso,child_safety_officer,acting-cso,acting-cm,acting-wwc', true);
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('11');

-- A stood-down admin doesn't act.
reset role;
update public.profiles set stood_down_at = now() where id = pg_temp.id('01');
select pg_temp.as_member('01');
select pg_temp.ok('a stood-down admin doesn''t act', (select count(*) = 0 from (select 1 where public.acting_in_safeguarding_post('complaints_manager', pg_temp.id('01'))) x), true);
reset role;
update public.profiles set stood_down_at = null where id = pg_temp.id('01');

-- WWC Registration Officer: a committee member with a check ends acting.
insert into public.safeguarding_post_holders (post, profile_id) values ('complaints_manager', pg_temp.id('13'));
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('21');
insert into public.safeguarding_post_holders (post, profile_id) values ('wwc_officer', pg_temp.id('21'));
select pg_temp.as_member('01');
select pg_temp.ok('every post filled: the admin acts in none', pg_temp.powers() = '', true);
select pg_temp.as_member('32');
select pg_temp.ok('and members see nobody marked acting',
  (select not (child_safety_officers || complaints_managers) @> '[{"acting": true}]' from public.safeguarding_contacts()), true);
