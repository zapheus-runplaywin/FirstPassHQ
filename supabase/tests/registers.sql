-- Tests for 20261023220000_registers.sql: the policy register and the
-- conflict-of-interest register (customer review R9). Run on a fresh database
-- with the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
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
create or replace function pg_temp.policy(p_title text) returns uuid language sql as
$$ select id from public.policy_register where title = p_title $$;
-- How many policies the signed-in member reads.
create or replace function pg_temp.policies() returns bigint language sql as
$$ select count(*) from public.policy_register_list() $$;
-- Who is listed in this season's conflict register for the signed-in member.
create or replace function pg_temp.listed(n text) returns boolean language sql as
$$ select exists (select 1 from public.conflict_register(public.conduct_season()) where profile_id = pg_temp.id(n)) $$;
create or replace function pg_temp.reads_conflicts() returns boolean language sql as
$$ select exists (select 1 from public.conflict_register(public.conduct_season())) $$;
create or replace function pg_temp.required() returns boolean language sql as
$$ select coalesce((select required from public.my_conflict_declaration()), false) $$;

-- Gale (21)'s check is current, so the committee role works; Harper (22) has
-- no check before the club's checks date; Indy (23) is exempt as treasurer.
update public.profiles set wwcc_expires_on = current_date + 400 where id = pg_temp.id('21');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select pg_temp.ok('signed-in members cannot read the policy table', has_table_privilege('authenticated', 'public.policy_register', 'select'), false);
select pg_temp.ok('signed-in members cannot write the policy table', has_table_privilege('authenticated', 'public.policy_register', 'insert,update,delete'), false);
select pg_temp.ok('signed-in members cannot read declarations directly', has_table_privilege('authenticated', 'public.conflict_declarations', 'select'), false);
select pg_temp.ok('signed-in members cannot write declarations directly', has_table_privilege('authenticated', 'public.conflict_declarations', 'insert,update,delete'), false);
select pg_temp.ok('anon reads neither', has_table_privilege('anon', 'public.policy_register', 'select') or has_table_privilege('anon', 'public.conflict_declarations', 'select'), false);
select pg_temp.ok('row level security is on for policies', (select relrowsecurity from pg_class where oid = 'public.policy_register'::regclass), true);
select pg_temp.ok('row level security is on for declarations', (select relrowsecurity from pg_class where oid = 'public.conflict_declarations'::regclass), true);
select pg_temp.ok('the service role can manage both', has_table_privilege('service_role', 'public.policy_register', 'delete') and has_table_privilege('service_role', 'public.conflict_declarations', 'delete'), true);
select pg_temp.ok('anon cannot call any register function',
  (select bool_or(has_function_privilege('anon', f, 'execute')) from unnest(array[
    'public.policy_register_list()', 'public.my_policy_reviews()', 'public.admin_save_policy(uuid, text, uuid, text, text, date, text)',
    'public.admin_delete_policy(uuid)', 'public.review_policy(uuid, text, text, date)', 'public.my_conflict_declaration()',
    'public.declare_conflicts(boolean, text)', 'public.conflict_register(integer)', 'public.conflict_register_seasons()',
    'public.admin_set_conflict_declaration(uuid, integer, boolean, text)', 'public.can_read_registers()']) f), false);
select pg_temp.ok('the helpers are closed to members',
  (select bool_or(has_function_privilege('authenticated', f, 'execute')) from unnest(array[
    'public.can_own_policy(uuid)', 'public.declares_conflicts(uuid)', 'public.check_policy_link(text)',
    'public.check_conflict_details(boolean, text)']) f), false);

-- ---------------------------------------------------------------------------
-- Who reads the registers
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.ok('an admin reads the registers', public.can_read_registers(), true);
select pg_temp.as_member('02');
select pg_temp.ok('an admin with no check reads them (the admin role never pauses)', public.can_read_registers(), true);
select pg_temp.as_member('21');
select pg_temp.ok('a committee member with a check reads them', public.can_read_registers(), true);
select pg_temp.as_member('22');
select pg_temp.ok('a committee member before the checks date reads them', public.can_read_registers(), true);
select pg_temp.as_member('23');
select pg_temp.ok('the exempt treasurer reads them', public.can_read_registers(), true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach doesn''t', public.can_read_registers(), false);
select pg_temp.as_member('13');
select pg_temp.ok('a manager doesn''t', public.can_read_registers(), false);
select pg_temp.as_member('14');
select pg_temp.ok('a physio doesn''t', public.can_read_registers(), false);
select pg_temp.as_member('32');
select pg_temp.ok('an athlete doesn''t', public.can_read_registers(), false);
select pg_temp.as_member('41');
select pg_temp.ok('a guardian doesn''t', public.can_read_registers(), false);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in doesn''t', public.can_read_registers(), false);

-- ---------------------------------------------------------------------------
-- Policy register
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.works('an admin adds a policy owned by a committee member', $s$
  select public.admin_save_policy(null, '  Child safeguarding  ', pg_temp.id('21'), ' 2026-1 ', 'https://club.example/safeguarding', current_date + 20, ' Board approved ') $s$);
select pg_temp.ok('saved trimmed', (select title = 'Child safeguarding' and version = '2026-1' and notes = 'Board approved' and created_by = pg_temp.id('01') from public.policy_register), true);
select pg_temp.works('a policy owned by a coach, due in a year', $s$
  select public.admin_save_policy(null, 'Concussion', pg_temp.id('11'), null, null, current_date + 365, null) $s$);
select pg_temp.works('a policy with no owner, overdue', $s$
  select public.admin_save_policy(null, 'Privacy', null, '1', 'http://club.example/privacy', current_date - 3, '') $s$);
select pg_temp.ok('empty notes are saved as none', (select notes is null from public.policy_register where title = 'Privacy'), true);
select pg_temp.fails('no title is refused', $s$ select public.admin_save_policy(null, '   ', null, null, null, current_date + 10, null) $s$);
select pg_temp.fails('a title over 120 characters is refused', $s$ select public.admin_save_policy(null, repeat('x', 121), null, null, null, current_date + 10, null) $s$);
select pg_temp.fails('no review date is refused', $s$ select public.admin_save_policy(null, 'Travel', null, null, null, null, null) $s$);
select pg_temp.fails('a review over 5 years away is refused', $s$ select public.admin_save_policy(null, 'Travel', null, null, null, current_date + 1900, null) $s$);
select pg_temp.fails('a link that isn''t a web address is refused', $s$ select public.admin_save_policy(null, 'Travel', null, null, 'club.example/travel', current_date + 10, null) $s$);
select pg_temp.fails('a link with a space is refused', $s$ select public.admin_save_policy(null, 'Travel', null, null, 'https://club.example/a b', current_date + 10, null) $s$);
select pg_temp.fails('a long version is refused', $s$ select public.admin_save_policy(null, 'Travel', null, repeat('1', 31), null, current_date + 10, null) $s$);
select pg_temp.fails('long notes are refused', $s$ select public.admin_save_policy(null, 'Travel', null, null, null, current_date + 10, repeat('n', 1001)) $s$);
select pg_temp.fails('an athlete can''t own a policy', $s$ select public.admin_save_policy(null, 'Travel', pg_temp.id('32'), null, null, current_date + 10, null) $s$);
select pg_temp.fails('a guardian can''t own a policy', $s$ select public.admin_save_policy(null, 'Travel', pg_temp.id('41'), null, null, current_date + 10, null) $s$);
select pg_temp.fails('a member who isn''t there can''t own a policy', $s$ select public.admin_save_policy(null, 'Travel', gen_random_uuid(), null, null, current_date + 10, null) $s$);
select pg_temp.fails('changing a policy that isn''t there is refused', $s$ select public.admin_save_policy(gen_random_uuid(), 'Travel', null, null, null, current_date + 10, null) $s$);
select pg_temp.ok('refusals saved nothing', (select count(*) = 3 from public.policy_register), true);
select pg_temp.works('an admin changes a policy''s owner', $s$
  select public.admin_save_policy(pg_temp.policy('Privacy'), 'Privacy', pg_temp.id('23'), '1', 'http://club.example/privacy', current_date - 3, null) $s$);
select pg_temp.ok('changed, with who changed it', (select owner_id = pg_temp.id('23') and updated_by = pg_temp.id('01') from public.policy_register where title = 'Privacy'), true);

-- Only admins add, change or remove.
select pg_temp.as_member('21');
select pg_temp.fails('a committee member can''t add a policy', $s$ select public.admin_save_policy(null, 'Travel', null, null, null, current_date + 10, null) $s$);
select pg_temp.fails('a committee member can''t remove a policy', $s$ select public.admin_delete_policy(pg_temp.policy('Privacy')) $s$);
select pg_temp.as_member('11');
select pg_temp.fails('a coach (even an owner) can''t change a policy', $s$ select public.admin_save_policy(pg_temp.policy('Concussion'), 'Concussion', pg_temp.id('11'), null, null, current_date + 10, null) $s$);
select pg_temp.as_member('32');
select pg_temp.fails('an athlete can''t add a policy', $s$ select public.admin_save_policy(null, 'Travel', null, null, null, current_date + 10, null) $s$);

-- Who reads the policy register.
select pg_temp.as_member('01');
select pg_temp.ok('an admin reads every policy', pg_temp.policies() = 3, true);
select pg_temp.ok('with owner names', (select owner_name = 'Gale Committee' from public.policy_register_list() where title = 'Child safeguarding'), true);
select pg_temp.ok('overdue first', (select title = 'Privacy' from public.policy_register_list() limit 1), true);
select pg_temp.as_member('22');
select pg_temp.ok('a committee member reads every policy', pg_temp.policies() = 3, true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach reads only the policy they own', (select count(*) = 1 and bool_and(title = 'Concussion') from public.policy_register_list()), true);
select pg_temp.as_member('42');
select pg_temp.ok('another coach reads none', pg_temp.policies() = 0, true);
select pg_temp.as_member('13');
select pg_temp.ok('a manager reads none', pg_temp.policies() = 0, true);
select pg_temp.as_member('32');
select pg_temp.ok('an athlete reads none', pg_temp.policies() = 0, true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in reads none', pg_temp.policies() = 0, true);

-- The owner's to-do, 30 days before the review.
select pg_temp.as_member('21');
select pg_temp.ok('Gale is asked to review a policy due in 20 days', (select count(*) = 1 from public.my_policy_reviews()), true);
select pg_temp.as_member('23');
select pg_temp.ok('Indy is asked to review an overdue one', (select count(*) = 1 and bool_and(title = 'Privacy') from public.my_policy_reviews()), true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach whose policy is due in a year isn''t asked yet', (select count(*) = 0 from public.my_policy_reviews()), true);
select pg_temp.as_member('01');
select pg_temp.works('due in exactly 30 days', $s$ select public.admin_save_policy(pg_temp.policy('Concussion'), 'Concussion', pg_temp.id('11'), null, null, current_date + 30, null) $s$);
select pg_temp.as_member('11');
select pg_temp.ok('a coach is asked 30 days before', (select count(*) = 1 from public.my_policy_reviews()), true);
select pg_temp.as_member('01');
select pg_temp.works('due in 31 days', $s$ select public.admin_save_policy(pg_temp.policy('Concussion'), 'Concussion', pg_temp.id('11'), null, null, current_date + 31, null) $s$);
select pg_temp.as_member('11');
select pg_temp.ok('but not 31 days before', (select count(*) = 0 from public.my_policy_reviews()), true);
select pg_temp.as_member('01');
select pg_temp.ok('an admin isn''t asked about policies others own', (select count(*) = 0 from public.my_policy_reviews()), true);

-- Recording a review.
select pg_temp.as_member('22');
select pg_temp.fails('a committee member who doesn''t own it can''t record a review', $s$ select public.review_policy(pg_temp.policy('Child safeguarding'), '2027-1', null, current_date + 365) $s$);
select pg_temp.as_member('21');
select pg_temp.fails('a next review today is refused', $s$ select public.review_policy(pg_temp.policy('Child safeguarding'), '2027-1', null, current_date) $s$);
select pg_temp.fails('no next review is refused', $s$ select public.review_policy(pg_temp.policy('Child safeguarding'), '2027-1', null, null) $s$);
select pg_temp.fails('a next review over 5 years away is refused', $s$ select public.review_policy(pg_temp.policy('Child safeguarding'), '2027-1', null, current_date + 1900) $s$);
select pg_temp.fails('a bad link is refused', $s$ select public.review_policy(pg_temp.policy('Child safeguarding'), '2027-1', 'ftp://x', current_date + 365) $s$);
select pg_temp.fails('a long version is refused', $s$ select public.review_policy(pg_temp.policy('Child safeguarding'), repeat('9', 31), null, current_date + 365) $s$);
select pg_temp.fails('a policy that isn''t there is refused', $s$ select public.review_policy(gen_random_uuid(), '1', null, current_date + 365) $s$);
select pg_temp.works('the owner records a review', $s$ select public.review_policy(pg_temp.policy('Child safeguarding'), '2027-1', 'https://club.example/safeguarding-2027', current_date + 365) $s$);
select pg_temp.ok('the new version, link, date and reviewer are kept', (select version = '2027-1' and link = 'https://club.example/safeguarding-2027' and review_on = current_date + 365
  and last_reviewed_by = pg_temp.id('21') and last_reviewed_at is not null from public.policy_register where title = 'Child safeguarding'), true);
select pg_temp.ok('so the to-do goes', (select count(*) = 0 from public.my_policy_reviews()), true);
select pg_temp.ok('the reviewer is named in the register', (select last_reviewed_by_name = 'Gale Committee' from public.policy_register_list() where title = 'Child safeguarding'), true);
select pg_temp.as_member('01');
select pg_temp.works('an admin records a review of a policy they don''t own', $s$ select public.review_policy(pg_temp.policy('Privacy'), '2', null, current_date + 200) $s$);
select pg_temp.ok('clearing the link', (select link is null and version = '2' from public.policy_register where title = 'Privacy'), true);

-- A stood-down owner gets no to-do and can't record a review.
select pg_temp.as_member('01');
select pg_temp.works('the Privacy policy is due again', $s$ select public.admin_save_policy(pg_temp.policy('Privacy'), 'Privacy', pg_temp.id('23'), '2', null, current_date + 5, null) $s$);
update public.profiles set stood_down_at = now() where id = pg_temp.id('23');
select pg_temp.as_member('23');
select pg_temp.ok('a stood-down owner has no review to-do', (select count(*) = 0 from public.my_policy_reviews()), true);
select pg_temp.fails('and can''t record a review', $s$ select public.review_policy(pg_temp.policy('Privacy'), '3', null, current_date + 200) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('a stood-down member can''t be made an owner', $s$ select public.admin_save_policy(null, 'Travel', pg_temp.id('23'), null, null, current_date + 10, null) $s$);
update public.profiles set stood_down_at = null where id = pg_temp.id('23');

-- Removing a policy.
select pg_temp.as_member('01');
select pg_temp.works('an admin removes a policy', $s$ select public.admin_delete_policy(pg_temp.policy('Concussion')) $s$);
select pg_temp.ok('it''s gone', (select count(*) = 2 from public.policy_register), true);
select pg_temp.fails('removing it again is refused', $s$ select public.admin_delete_policy(gen_random_uuid()) $s$);

-- ---------------------------------------------------------------------------
-- Conflict-of-interest register
-- ---------------------------------------------------------------------------

-- Who is asked to declare.
select pg_temp.as_member('11');
select pg_temp.ok('a coach is asked', pg_temp.required(), true);
select pg_temp.as_member('42');
select pg_temp.ok('a coach-parent is asked', pg_temp.required(), true);
select pg_temp.as_member('21');
select pg_temp.ok('a committee member is asked', pg_temp.required(), true);
select pg_temp.as_member('23');
select pg_temp.ok('the exempt treasurer is asked', pg_temp.required(), true);
select pg_temp.as_member('13');
select pg_temp.ok('a manager isn''t', pg_temp.required(), false);
select pg_temp.as_member('14');
select pg_temp.ok('a physio isn''t', pg_temp.required(), false);
select pg_temp.as_member('32');
select pg_temp.ok('an athlete isn''t', pg_temp.required(), false);
select pg_temp.as_member('41');
select pg_temp.ok('a guardian isn''t', pg_temp.required(), false);
select pg_temp.as_member('01');
select pg_temp.ok('an admin who isn''t on the committee or coaching isn''t', pg_temp.required(), false);
select pg_temp.ok('this season', (select season = public.conduct_season() from public.my_conflict_declaration()), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in gets nothing', (select count(*) = 0 from public.my_conflict_declaration()), true);

-- An athlete who coaches a team (no coach role) is asked.
update public.team_members set team_role = 'coach' where profile_id = pg_temp.id('32') and team_id = pg_temp.id('a1');
select pg_temp.as_member('32');
select pg_temp.ok('an athlete coaching a squad is asked', pg_temp.required(), true);
update public.teams set archived = true where id = pg_temp.id('a1');
select pg_temp.ok('not once that squad is archived', pg_temp.required(), false);
update public.teams set archived = false where id = pg_temp.id('a1');
update public.team_members set team_role = 'athlete' where profile_id = pg_temp.id('32') and team_id = pg_temp.id('a1');

-- Declaring.
select pg_temp.as_member('11');
select pg_temp.fails('saying nothing is refused', $s$ select public.declare_conflicts(null, null) $s$);
select pg_temp.fails('a conflict needs details', $s$ select public.declare_conflicts(true, '   ') $s$);
select pg_temp.fails('details over 2,000 characters are refused', $s$ select public.declare_conflicts(true, repeat('d', 2001)) $s$);
select pg_temp.works('a coach declares none', $s$ select public.declare_conflicts(false, 'ignored') $s$);
select pg_temp.ok('saved without details', (select has_conflict = false and details is null and declared_at is not null from public.my_conflict_declaration()), true);
select pg_temp.works('and changes it to a conflict', $s$ select public.declare_conflicts(true, '  My niece trials for Sample Team  ') $s$);
select pg_temp.ok('one declaration, changed', (select count(*) = 1 and bool_and(has_conflict and details = 'My niece trials for Sample Team') from public.conflict_declarations where profile_id = pg_temp.id('11')), true);
select pg_temp.as_member('21');
select pg_temp.works('a committee member declares none', $s$ select public.declare_conflicts(false, null) $s$);
select pg_temp.as_member('13');
select pg_temp.fails('a manager can''t declare', $s$ select public.declare_conflicts(false, null) $s$);
select pg_temp.as_member('32');
select pg_temp.fails('an athlete can''t declare', $s$ select public.declare_conflicts(false, null) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('an admin not on the committee can''t declare for themselves', $s$ select public.declare_conflicts(false, null) $s$);
update public.profiles set stood_down_at = now() where id = pg_temp.id('42');
select pg_temp.as_member('42');
select pg_temp.ok('a stood-down coach isn''t asked', pg_temp.required(), false);
select pg_temp.fails('and can''t declare', $s$ select public.declare_conflicts(false, null) $s$);
update public.profiles set stood_down_at = null where id = pg_temp.id('42');

-- Who reads the register, and who it lists.
select pg_temp.as_member('22');
select pg_temp.ok('a committee member reads it', pg_temp.reads_conflicts(), true);
select pg_temp.ok('the coach''s conflict is shown', (select has_conflict and details = 'My niece trials for Sample Team' from public.conflict_register(public.conduct_season()) where profile_id = pg_temp.id('11')), true);
select pg_temp.ok('Gale declared none', (select declared and has_conflict = false from public.conflict_register(public.conduct_season()) where profile_id = pg_temp.id('21')), true);
select pg_temp.ok('Harper is listed as still to declare', (select declared = false from public.conflict_register(public.conduct_season()) where profile_id = pg_temp.id('22')), true);
select pg_temp.ok('the coach-parent is listed as still to declare', (select declared = false from public.conflict_register(public.conduct_season()) where profile_id = pg_temp.id('42')), true);
select pg_temp.ok('the lapsed coach is listed', pg_temp.listed('12'), true);
select pg_temp.ok('the manager isn''t listed', pg_temp.listed('13'), false);
select pg_temp.ok('athletes aren''t listed', pg_temp.listed('31') or pg_temp.listed('32'), false);
select pg_temp.ok('admins not on the committee aren''t listed', pg_temp.listed('01'), false);
select pg_temp.ok('still to declare come first', (select declared = false from public.conflict_register(public.conduct_season()) limit 1), true);
select pg_temp.ok('the roles are given', (select roles = array['coach'] from public.conflict_register(public.conduct_season()) where profile_id = pg_temp.id('11')), true);
select pg_temp.as_member('01');
select pg_temp.ok('an admin reads it', pg_temp.reads_conflicts(), true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach doesn''t read it', pg_temp.reads_conflicts(), false);
select pg_temp.ok('nor its seasons', (select count(*) = 0 from public.conflict_register_seasons()), true);
select pg_temp.as_member('13');
select pg_temp.ok('a manager doesn''t', pg_temp.reads_conflicts(), false);
select pg_temp.as_member('41');
select pg_temp.ok('a guardian doesn''t', pg_temp.reads_conflicts(), false);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in doesn''t', pg_temp.reads_conflicts(), false);

-- A committee member whose recorded check lapsed has the role paused: still
-- asked to declare, but doesn't read the register.
update public.profiles set wwcc_expires_on = current_date - 1 where id = pg_temp.id('21');
select pg_temp.as_member('21');
select pg_temp.ok('a paused committee member doesn''t read it', pg_temp.reads_conflicts(), false);
update public.profiles set wwcc_expires_on = current_date + 400 where id = pg_temp.id('21');

-- Earlier seasons.
insert into public.conflict_declarations (profile_id, season, has_conflict, details)
values (pg_temp.id('11'), public.conduct_season() - 1, true, 'Last season''s conflict');
select pg_temp.as_member('22');
select pg_temp.ok('the seasons are this one and last, newest first', (select array_agg(s) = array[public.conduct_season(), public.conduct_season() - 1] from public.conflict_register_seasons() s), true);
select pg_temp.ok('last season lists only who declared', (select count(*) = 1 and bool_and(details = 'Last season''s conflict') from public.conflict_register(public.conduct_season() - 1)), true);

-- Admins change a declaration.
select pg_temp.as_member('22');
select pg_temp.fails('a committee member can''t change one', $s$ select public.admin_set_conflict_declaration(pg_temp.id('11'), public.conduct_season(), false, null) $s$);
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t change another''s', $s$ select public.admin_set_conflict_declaration(pg_temp.id('21'), public.conduct_season(), true, 'x') $s$);
select pg_temp.as_member('01');
select pg_temp.works('an admin records a paper declaration for Harper', $s$ select public.admin_set_conflict_declaration(pg_temp.id('22'), public.conduct_season(), true, 'Sponsor''s director') $s$);
select pg_temp.ok('saved, naming the admin', (select declared and has_conflict and changed_by_name = 'Alex Admin' from public.conflict_register(public.conduct_season()) where profile_id = pg_temp.id('22')), true);
select pg_temp.works('an admin changes the coach''s declaration', $s$ select public.admin_set_conflict_declaration(pg_temp.id('11'), public.conduct_season(), true, 'Niece trials for Sample Team; stepping out of that selection') $s$);
select pg_temp.ok('changed', (select details like 'Niece%' and updated_by = pg_temp.id('01') from public.conflict_declarations where profile_id = pg_temp.id('11') and season = public.conduct_season()), true);
select pg_temp.fails('a conflict needs details here too', $s$ select public.admin_set_conflict_declaration(pg_temp.id('22'), public.conduct_season(), true, '') $s$);
select pg_temp.fails('a later season is refused', $s$ select public.admin_set_conflict_declaration(pg_temp.id('22'), public.conduct_season() + 1, false, null) $s$);
select pg_temp.fails('no season is refused', $s$ select public.admin_set_conflict_declaration(pg_temp.id('22'), null, false, null) $s$);
select pg_temp.fails('a member who isn''t there is refused', $s$ select public.admin_set_conflict_declaration(gen_random_uuid(), public.conduct_season(), false, null) $s$);
select pg_temp.works('an admin corrects last season', $s$ select public.admin_set_conflict_declaration(pg_temp.id('11'), public.conduct_season() - 1, false, null) $s$);
select pg_temp.ok('last season corrected', (select has_conflict = false and details is null from public.conflict_declarations where profile_id = pg_temp.id('11') and season = public.conduct_season() - 1), true);
-- The member declaring again takes it back as their own.
select pg_temp.as_member('22');
select pg_temp.works('Harper declares in the app', $s$ select public.declare_conflicts(false, null) $s$);
select pg_temp.ok('their own now, with no admin named', (select has_conflict = false and changed_by_name is null from public.conflict_register(public.conduct_season()) where profile_id = pg_temp.id('22')), true);

-- Deleting an account deletes its declarations; a policy owner's goes to nobody.
select pg_temp.as_member('11');
select pg_temp.works('the coach deletes their account', $$select public.delete_my_account()$$);
select pg_temp.ok('their declarations went with it', (select count(*) = 0 from public.conflict_declarations where profile_id = pg_temp.id('11')), true);

-- ---------------------------------------------------------------------------
-- No rows change, and the migration runs again cleanly
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
select count(*) as policies_before from public.policy_register \gset
select count(*) as declarations_before from public.conflict_declarations \gset
\ir ../migrations/20261023220000_registers.sql
select pg_temp.ok('re-running keeps every policy', (select count(*) = :policies_before from public.policy_register), true);
select pg_temp.ok('re-running keeps every declaration', (select count(*) = :declarations_before from public.conflict_declarations), true);
