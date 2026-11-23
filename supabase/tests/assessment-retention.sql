-- Tests for 20261123210000_assessment_retention.sql: how long a selection
-- round is kept, who sets it, and what the nightly clean-up removes. Run on a
-- fresh database with the migrations and seed-members.sql loaded. Prints one
-- line per check.
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
create or replace function pg_temp.reads_months() returns integer language sql as
$$ select public.assessment_keep_months() $$;
create or replace function pg_temp.sets_months(p integer) returns boolean language plpgsql as
$$ begin perform public.admin_set_assessment_keep_months(p); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.rounds() returns text language sql as
$$ select coalesce(string_agg(name, ', ' order by name), 'none') from public.selection_rounds $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select pg_temp.ok('anon cannot call ' || f, has_function_privilege('anon', f, 'execute'), false)
from unnest(array['public.assessment_keep_months()', 'public.admin_set_assessment_keep_months(integer)',
  'public.purge_expired_assessments()']) f;
select pg_temp.ok('signed-in members cannot run the clean-up',
  has_function_privilege('authenticated', 'public.purge_expired_assessments()', 'execute'), false);
select pg_temp.ok('the nightly job can',
  has_function_privilege('service_role', 'public.purge_expired_assessments()', 'execute'), true);

-- ---------------------------------------------------------------------------
-- The keep period: admins only, every kind of member
-- ---------------------------------------------------------------------------

select pg_temp.m_eq('01', 'an admin sees the default: 1 year', 'pg_temp.reads_months()', '12');
select pg_temp.m_eq(v.n, v.who || ' is told nothing about the keep period', 'pg_temp.reads_months()', null)
from (values ('11', 'a coach'), ('13', 'a manager'), ('14', 'a physio'), ('21', 'a committee member'),
  ('31', 'an athlete under 18'), ('32', 'an adult athlete'), ('41', 'a parent')) as v(n, who);
select pg_temp.m_ok(v.n, v.who || ' cannot change the keep period', 'pg_temp.sets_months(24)', false)
from (values ('11', 'a coach'), ('13', 'a manager'), ('14', 'a physio'), ('21', 'a committee member'),
  ('31', 'an athlete under 18'), ('32', 'an adult athlete'), ('41', 'a parent')) as v(n, who);
select pg_temp.ok('and it is still 1 year', (select retention_assessments_months = 12 from public.club_settings where id), true);

select pg_temp.as_member('01');
select pg_temp.works('an admin chooses ' || m || ' months', format('select public.admin_set_assessment_keep_months(%s)', m))
from unnest(array[24, 36, 60, 84, 12]) m;
select pg_temp.fails('but not 6 months', $$select public.admin_set_assessment_keep_months(6)$$);
select pg_temp.fails('or 4 years', $$select public.admin_set_assessment_keep_months(48)$$);
select pg_temp.fails('or 10 years', $$select public.admin_set_assessment_keep_months(120)$$);
select pg_temp.fails('or nothing', $$select public.admin_set_assessment_keep_months(null)$$);
select pg_temp.ok('the change is signed',
  (select retention_updated_by_name is not null and retention_updated_at is not null from public.club_settings where id), true);

-- ---------------------------------------------------------------------------
-- The clean-up
-- ---------------------------------------------------------------------------

select pg_temp.set_feature(true);
select pg_temp.works('an admin saves criteria', $$select public.admin_save_assessment_criteria(
  '{"groups": [{"key": "skills", "name": "Skills", "scale": ["Below", "Meets", "Exceeds"],
    "items": [{"key": "passing", "name": "Passing"}]}]}')$$);
-- One round at a time is open for a squad, so each is opened, written in and
-- closed before the next: a date, and one observation about Kai (32), or
-- about Jordan (31) in the round a concern will hold.
create or replace function pg_temp.make_round(p_name text, p_athlete text, p_close boolean) returns text
language plpgsql as $$
begin
  perform pg_temp.as_member('01');
  perform public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', p_name,
    public.club_today() - 20, public.club_today() + 40);
  perform public.admin_save_selection_milestone(null, pg_temp.round(p_name), 'Teams named', public.club_today() + 30, true);
  perform pg_temp.as_member('11');
  perform public.save_assessment_observation(null, pg_temp.round(p_name), pg_temp.id(p_athlete), 'training',
    public.club_today(), 'Strong drive', '[{"item_key": "passing", "rating": 2}]');
  if p_close then
    perform pg_temp.as_member('01');
    perform public.admin_close_selection_round(pg_temp.round(p_name), true);
  end if;
  return 'PASS the ' || p_name || ' round is set up';
exception when others then return 'FAIL the ' || p_name || ' round is set up (' || sqlerrm || ')';
end $$;
select pg_temp.make_round('Old', '32', true);
select pg_temp.make_round('Old on hold', '31', true);
select pg_temp.make_round('Recent', '32', true);
select pg_temp.make_round('Closed lately', '32', true);
select pg_temp.make_round('Open', '32', false);
select pg_temp.as_member('01');

-- Old and Old on hold ended 13 months ago; Recent ended 11 months ago; Closed
-- lately ended 13 months ago and was closed last month; Open is still running.
update public.selection_rounds set starts_on = public.club_today() - 500,
  ends_on = (public.club_today() - interval '13 months')::date
where name in ('Old', 'Old on hold', 'Closed lately');
update public.selection_rounds set starts_on = public.club_today() - 500,
  ends_on = (public.club_today() - interval '11 months')::date
where name = 'Recent';
update public.selection_rounds set closed_at = now() - interval '13 months' where name in ('Old', 'Old on hold');
update public.selection_rounds set closed_at = now() - interval '1 month' where name = 'Closed lately';
update public.selection_rounds set closed_at = now() - interval '11 months' where name = 'Recent';
insert into public.concerns (raised_by, raised_by_name, body, about_member_id, about_member_name)
values (pg_temp.id('01'), 'Admin', 'A concern for the retention test', pg_temp.id('31'), 'Jordan Junior');

select pg_temp.eq('with Remove old records off the clean-up says so',
  public.purge_expired_assessments() ->> 'enabled', 'false');
select pg_temp.eq('and removes nothing', pg_temp.rounds(), 'Closed lately, Old, Old on hold, Open, Recent');

update public.club_settings set retention_enabled = true where id;
select pg_temp.eq('turned on, it removes the one round past a year', public.purge_expired_assessments()::text,
  '{"enabled": true, "selection_rounds": 1}');
select pg_temp.eq('the round on hold, the recent one, the one closed lately and the open one stay',
  pg_temp.rounds(), 'Closed lately, Old on hold, Open, Recent');
select pg_temp.ok('the removed round''s observations, ratings, panel and dates went with it',
  (select count(*) from public.assessment_observations) = 4
  and (select count(*) from public.assessment_observation_ratings) = 4
  and (select count(distinct round_id) from public.selection_round_panel) = 4
  and (select count(*) from public.selection_round_milestones) = 4, true);
select pg_temp.eq('running it again removes nothing more', public.purge_expired_assessments() ->> 'selection_rounds', '0');

-- A longer keep period keeps what a shorter one would remove.
select pg_temp.as_member('01');
select public.admin_set_assessment_keep_months(24);
update public.selection_rounds set ends_on = (public.club_today() - interval '13 months')::date,
  closed_at = now() - interval '13 months' where name = 'Recent';
select pg_temp.eq('kept 2 years, a round that ended 13 months ago stays',
  public.purge_expired_assessments() ->> 'selection_rounds', '0');
select public.admin_set_assessment_keep_months(12);
select pg_temp.eq('kept 1 year, it goes', public.purge_expired_assessments() ->> 'selection_rounds', '1');

-- Once the concern no longer names the athlete, the held round goes too.
delete from public.concerns where body = 'A concern for the retention test';
select pg_temp.eq('a round is only held while a concern names someone assessed in it',
  public.purge_expired_assessments() ->> 'selection_rounds', '1');
select pg_temp.eq('leaving the round closed lately and the open one', pg_temp.rounds(), 'Closed lately, Open');
select pg_temp.ok('no athlete or selector was removed',
  (select count(*) from public.profiles where id in (pg_temp.id('11'), pg_temp.id('31'), pg_temp.id('32'))) = 3, true);
update public.club_settings set retention_enabled = false where id;
