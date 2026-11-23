-- Tests for 20261124100000_independent_selectors.sql: a round's panel and the
-- Selection audit report say which panel members are independent (a guest
-- with no other role and no squad or team). Only admins read either, as
-- before. Run on a fresh database with the migrations and seed-members.sql
-- loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.eq(label text, actual text, expected text) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- The same checks, first acting as sample member n.
create or replace function pg_temp.m_ok(n text, label text, expression text, expected boolean) returns text language plpgsql as
$$ declare v boolean; begin perform pg_temp.as_member(n); execute 'select ' || expression into v;
   return pg_temp.ok(label, v, expected); end $$;
create or replace function pg_temp.m_eq(n text, label text, expression text, expected text) returns text language plpgsql as
$$ declare v text; begin perform pg_temp.as_member(n); execute 'select (' || expression || ')::text' into v;
   return pg_temp.eq(label, v, expected); end $$;
create or replace function pg_temp.round(p_name text default 'Sample selections') returns uuid language sql as
$$ select id from public.selection_rounds where name = p_name $$;
create or replace function pg_temp.date_id(p_title text) returns uuid language sql as
$$ select id from public.selection_round_milestones where title = p_title order by created_at limit 1 $$;
create or replace function pg_temp.set_feature(p_on boolean) returns void language sql as
$$ update public.club_settings set features = features || jsonb_build_object('selectionAssessments', p_on) where id $$;
-- "independent" for one panel member, as an admin reads the round.
create or replace function pg_temp.in_round(p_name text) returns text language plpgsql as
$$ declare v text; begin perform pg_temp.as_member('01');
     select string_agg(coalesce(m ->> 'independent', 'missing'), ',') into v
     from public.admin_selection_rounds() r, jsonb_array_elements(r.panel) m
     where r.id = pg_temp.round() and m ->> 'name' = p_name;
     return coalesce(v, 'not on the panel'); end $$;
-- The same in the audit report.
create or replace function pg_temp.in_audit(p_name text) returns text language plpgsql as
$$ declare v text; begin perform pg_temp.as_member('01');
     select string_agg(coalesce(m ->> 'independent', 'missing'), ',') into v
     from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'panel') m
     where m ->> 'name' = p_name;
     return coalesce(v, 'not on the panel'); end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;

-- A guest with a current check, from outside the club.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('62'), 'guest.checked@example.test', now());
update public.profiles p set status = 'approved', full_name = 'Ola Selector', role = 'guest',
  wwcc_number = 'WWC0062', wwcc_expires_on = public.club_today() + 400, verified_at = now()
where p.id = pg_temp.id('62');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select pg_temp.ok('nobody calls is_independent_selector themselves',
  has_function_privilege('anon', 'public.is_independent_selector(uuid)', 'execute')
  or has_function_privilege('authenticated', 'public.is_independent_selector(uuid)', 'execute'), false);
select pg_temp.ok('anon still cannot read rounds or the audit',
  has_function_privilege('anon', 'public.admin_selection_rounds()', 'execute')
  or has_function_privilege('anon', 'public.admin_selection_audit(uuid)', 'execute'), false);
select pg_temp.ok('signed-in members can still ask (each checks who they are)',
  has_function_privilege('authenticated', 'public.admin_selection_rounds()', 'execute')
  and has_function_privilege('authenticated', 'public.admin_selection_audit(uuid)', 'execute'), true);
select pg_temp.ok('all three run as their owner with a fixed search path',
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
   where proname in ('is_independent_selector', 'admin_selection_rounds', 'admin_selection_audit') and pronamespace = 'public'::regnamespace), true);
select pg_temp.ok('there is still one of each',
  (select count(*) from pg_proc
   where proname in ('admin_selection_rounds', 'admin_selection_audit') and pronamespace = 'public'::regnamespace) = 2, true);

-- ---------------------------------------------------------------------------
-- A round with the squad's coaches and a guest on its panel
-- ---------------------------------------------------------------------------

select pg_temp.set_feature(true);
select pg_temp.as_member('01');
select pg_temp.works('an admin saves criteria', $$select public.admin_save_assessment_criteria(
  '{"groups": [{"key": "skills", "name": "Skills", "scale": ["Below", "Meets", "Exceeds"],
    "items": [{"key": "passing", "name": "Passing"}]}]}'::jsonb)$$);
select pg_temp.works('an admin opens a round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Sample selections',
      public.club_today() - 20, public.club_today() + 40)$$);
select pg_temp.works('and adds the guest as a selector',
  $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.works('and themselves',
  $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('01'))$$);

select pg_temp.eq('the round: the guest is independent', pg_temp.in_round('Ola Selector'), 'true');
select pg_temp.eq('the audit: the guest is independent', pg_temp.in_audit('Ola Selector'), 'true');
select pg_temp.eq('the round: every other panel member is not',
  (select string_agg(distinct m ->> 'independent', ',') from public.admin_selection_rounds() r, jsonb_array_elements(r.panel) m
   where r.id = pg_temp.round() and m ->> 'name' <> 'Ola Selector'), 'false');
select pg_temp.eq('the audit: every other panel member is not',
  (select string_agg(distinct m ->> 'independent', ',')
   from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'panel') m
   where m ->> 'name' <> 'Ola Selector'), 'false');
select pg_temp.ok('the round: more than the guest is on the panel',
  (select jsonb_array_length(r.panel) from public.admin_selection_rounds() r where r.id = pg_temp.round()) >= 3, true);
select pg_temp.ok('the audit still names nobody by id',
  (select bool_and(not (m ? 'profile_id')) from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'panel') m), true);
select pg_temp.ok('the round keeps every key it had',
  (select bool_and(m ?& array['profile_id', 'name', 'added_at', 'added_by_name', 'removed_at', 'removed_by_name', 'declared_conflict', 'can_assess', 'own_children'])
   from public.admin_selection_rounds() r, jsonb_array_elements(r.panel) m where r.id = pg_temp.round()), true);
select pg_temp.ok('the audit keeps every part it had',
  public.admin_selection_audit(pg_temp.round()) ?& array['round', 'panel', 'selectors', 'athletes'], true);

-- ---------------------------------------------------------------------------
-- What stops a guest being independent
-- ---------------------------------------------------------------------------

update public.profiles set extra_roles = '{coach}' where id = pg_temp.id('62');
select pg_temp.eq('a guest who is also a coach is not independent (round)', pg_temp.in_round('Ola Selector'), 'false');
select pg_temp.eq('a guest who is also a coach is not independent (audit)', pg_temp.in_audit('Ola Selector'), 'false');
update public.profiles set extra_roles = '{}' where id = pg_temp.id('62');
select pg_temp.eq('with the extra role gone they are independent again', pg_temp.in_round('Ola Selector'), 'true');

insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.id('a1'), pg_temp.id('62'), 'manager');
select pg_temp.eq('a guest in a squad is not independent (round)', pg_temp.in_round('Ola Selector'), 'false');
select pg_temp.eq('a guest in a squad is not independent (audit)', pg_temp.in_audit('Ola Selector'), 'false');
delete from public.team_members where team_id = pg_temp.id('a1') and profile_id = pg_temp.id('62');
select pg_temp.eq('out of the squad they are independent again', pg_temp.in_audit('Ola Selector'), 'true');

update public.profiles set role = 'coach' where id = pg_temp.id('62');
select pg_temp.eq('a guest made a coach is not independent', pg_temp.in_round('Ola Selector'), 'false');
update public.profiles set role = 'guest' where id = pg_temp.id('62');

-- An independent selector whose check lapses keeps the label, and is shown without access.
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('62');
select pg_temp.eq('a lapsed check does not change who is independent', pg_temp.in_round('Ola Selector'), 'true');
select pg_temp.eq('and the round says they have no access now',
  (select m ->> 'can_assess' from public.admin_selection_rounds() r, jsonb_array_elements(r.panel) m
   where r.id = pg_temp.round() and m ->> 'name' = 'Ola Selector'), 'false');
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('62');

-- Taken off the panel, the kept line still says they were independent.
select pg_temp.as_member('01');
select pg_temp.works('an admin takes the guest off the panel',
  $$select public.admin_remove_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.eq('the kept line in the round still says independent', pg_temp.in_round('Ola Selector'), 'true');
select pg_temp.eq('and in the audit', pg_temp.in_audit('Ola Selector'), 'true');

-- A panel member whose account is gone is nobody's independent selector.
update public.selection_round_panel set profile_id = null
where round_id = pg_temp.round() and profile_id = pg_temp.id('62');
select pg_temp.eq('a panel line with no account left is not independent (round)', pg_temp.in_round('Ola Selector'), 'false');
select pg_temp.eq('a panel line with no account left is not independent (audit)', pg_temp.in_audit('Ola Selector'), 'false');

-- ---------------------------------------------------------------------------
-- Who may read either: admins only, as before
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || ': reads the rounds', $$exists (select 1 from public.admin_selection_rounds())$$, true)
from (values ('01', 'an admin'), ('02', 'another admin')) v(n, who);
select pg_temp.m_ok(n, who || ': builds the audit', $$public.admin_selection_audit(pg_temp.round()) is not null$$, true)
from (values ('01', 'an admin'), ('02', 'another admin')) v(n, who);

create or replace function pg_temp.refused(n text, statement text) returns boolean language plpgsql as
$$ begin perform pg_temp.as_member(n); execute statement; return false;
   exception when others then return true; end $$;
select pg_temp.ok(who || ': refused the rounds', pg_temp.refused(n, 'select * from public.admin_selection_rounds()'), true)
from (values
  ('11', 'the head coach on the panel'), ('12', 'a lapsed coach'), ('13', 'a manager'), ('14', 'a physio'),
  ('21', 'a committee member'), ('31', 'an under-18 athlete'), ('32', 'an adult athlete'),
  ('41', 'a parent'), ('42', 'a coach who is a parent'), ('62', 'the guest selector')) v(n, who);
select pg_temp.ok(who || ': refused the audit', pg_temp.refused(n, 'select public.admin_selection_audit(pg_temp.round())'), true)
from (values
  ('11', 'the head coach on the panel'), ('12', 'a lapsed coach'), ('13', 'a manager'), ('14', 'a physio'),
  ('21', 'a committee member'), ('31', 'an under-18 athlete'), ('32', 'an adult athlete'),
  ('41', 'a parent'), ('42', 'a coach who is a parent'), ('62', 'the guest selector')) v(n, who);

select pg_temp.set_feature(false);
select pg_temp.ok('with the feature off an admin is refused the rounds', pg_temp.refused('01', 'select * from public.admin_selection_rounds()'), true);
select pg_temp.ok('with the feature off an admin is refused the audit', pg_temp.refused('01', 'select public.admin_selection_audit(pg_temp.round())'), true);
