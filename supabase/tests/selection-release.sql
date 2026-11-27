-- Tests for 20261127500000_assessment_release.sql: the head coach releases parts
-- of their signed summary to an athlete and, for an under 18, their verified
-- parents. Who may, what is read (filtered in the database), taking back, the
-- record. Run on a fresh database with the migrations and seed-members.sql loaded.
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
create or replace function pg_temp.round(p_name text default 'Release round') returns uuid language sql as
$$ select id from public.selection_rounds where name = p_name $$;
create or replace function pg_temp.set_feature(p_on boolean) returns void language sql as
$$ update public.club_settings set features = features || jsonb_build_object('selectionAssessments', p_on) where id $$;
create or replace function pg_temp.crit() returns jsonb language sql as
$$ select '{"groups": [
     {"key": "technical", "name": "Technical ability", "scale": ["Below standard", "Meets standard", "Exceeds standard"],
      "items": [{"key": "passing", "name": "Passing ITEM-pass"}, {"key": "catching", "name": "Catching ITEM-catch"}]},
     {"key": "tactical", "name": "Tactical ITEM-group", "scale": ["Below standard", "Meets standard", "Exceeds standard"],
      "items": [{"key": "reading", "name": "Reading ITEM-read"}]},
     {"key": "mental", "name": "Mental ITEM-mental", "scale": ["Below standard", "Meets standard", "Exceeds standard"],
      "items": [{"key": "focus", "name": "Focus ITEM-focus"}]}],
   "recommendations": ["Select", "Not this time"]}'::jsonb $$;
create or replace function pg_temp.mine() returns jsonb language sql as
$$ select public.my_released_assessments() $$;
create or replace function pg_temp.jordan() returns jsonb language sql as
$$ select x from jsonb_array_elements(public.my_released_assessments()) x where x ->> 'athlete_name' = 'Jordan Junior' $$;
create or replace function pg_temp.releases(n text, p_parts jsonb default '{"strengths": true}') returns boolean language plpgsql as
$$ begin perform public.release_assessment(pg_temp.round(), pg_temp.id(n), p_parts); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.withdraws(n text) returns boolean language plpgsql as
$$ begin perform public.withdraw_assessment_release(pg_temp.round(), pg_temp.id(n)); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.bulk() returns boolean language plpgsql as
$$ begin perform public.release_assessments(pg_temp.round(), '{"strengths": true}'); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.record_reads() returns boolean language plpgsql as
$$ begin perform public.admin_selection_releases(pg_temp.round()); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.events(n text) returns text language sql as
$$ select coalesce(string_agg(e.kind || coalesce(' (' || e.detail || ')', ''), ', ' order by e.at, e.id), 'none')
   from public.assessment_release_events e join public.assessment_releases x on x.id = e.release_id
   where x.athlete_id = pg_temp.id(n) $$;
create or replace function pg_temp.leaks(p jsonb) returns text language sql as
$$ select coalesce(string_agg(w, ','), 'none') from unnest(array['PRIORITIES-def', 'COMMENTS-xyz', 'ITEM-mental', 'ITEM-focus',
     'SECOND-words', 'SECOND-prio', 'EVIDENCE-zzz', 'item_key', 'rating', 'summary_id']) w
   where position(w in coalesce(p::text, '')) > 0
   union all select 'a summary id' where exists (select 1 from public.assessment_summaries s where position(s.id::text in coalesce(p::text, '')) > 0) $$;

-- Sample people for this file: 62 a guest selector with a check, 43 a parent
-- of Jordan's who isn't verified, 63 an athlete under 18 whose parent is the
-- head coach (11), 64 the head coach of another squad, 71 an auditor, 51 a guest.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('62'), 'guest.sel@example.test', now()),
  (pg_temp.id('43'), 'parent.unverified@example.test', now()),
  (pg_temp.id('63'), 'coach.child@example.test', now()),
  (pg_temp.id('64'), 'other.head@example.test', now()),
  (pg_temp.id('71'), 'auditor.rel@example.test', now()),
  (pg_temp.id('51'), 'guest.rel@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = case when v.wwcc is null then null else public.club_today() + 400 end,
  date_of_birth = v.dob::date, verified_at = case when v.verified then now() end
from (values
  ('62', 'Ola Selector', 'guest', 'WWC0062', '1980-01-01', true),
  ('43', 'Una Unverified', 'guardian', null, '1980-01-01', false),
  ('63', 'Cody Coachkid', 'athlete', null, '2011-01-01', true),
  ('64', 'Hana Head', 'coach', 'WWC0064', '1980-01-01', true),
  ('71', 'Ari Auditor', 'committee', 'WWC0071', '1980-01-01', true),
  ('51', 'Gus Guest', 'guest', null, '1980-01-01', true)
) v(n, name, role, wwcc, dob, verified)
where p.id = pg_temp.id(v.n);
insert into public.guardianships (guardian_id, athlete_id) values
  (pg_temp.id('43'), pg_temp.id('31')), (pg_temp.id('11'), pg_temp.id('63'));
insert into public.teams (id, name, kind, sort_order, season)
select '00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3, season from public.teams where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.id('63'), 'athlete', null),
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.id('64'), 'coach', 'head_coach');

-- ---------------------------------------------------------------------------
-- The migration
-- ---------------------------------------------------------------------------

select pg_temp.ok('signed-in members cannot reach ' || t || ' directly',
  has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'insert')
  or has_table_privilege('anon', 'public.' || t, 'select'), false)
  || E'\n' || pg_temp.ok('row level security is on for ' || t, (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), true)
from unnest(array['assessment_releases', 'assessment_release_events']) t;
select pg_temp.ok('the helpers are closed to members',
  (select bool_or(has_function_privilege('authenticated', f, 'execute')) from unnest(array[
    'public.check_release_parts(uuid, jsonb)', 'public.release_one(uuid, uuid, jsonb)',
    'public.released_assessment_json(public.assessment_releases)']) f), false);
select pg_temp.ok('anon can call none of the new functions',
  (select bool_or(has_function_privilege('anon', f, 'execute')) from unnest(array[
    'public.athlete_release(uuid, uuid)', 'public.release_assessment(uuid, uuid, jsonb)',
    'public.withdraw_assessment_release(uuid, uuid)', 'public.release_assessments(uuid, jsonb)',
    'public.selection_round_releases(uuid)', 'public.my_released_assessments()',
    'public.mark_assessment_release_seen(uuid, uuid)', 'public.admin_selection_releases(uuid)']) f), false);

-- ---------------------------------------------------------------------------
-- A round: Casey (11) head coach, Morgan (42, Jordan's parent) and Ola (62)
-- on the panel. Jordan (31) under 18, Kai (32) adult, Cody (63) Casey's child.
-- ---------------------------------------------------------------------------

select pg_temp.set_feature(true);
select pg_temp.as_member('01');
select pg_temp.works('an admin adds a set', $$select public.admin_save_criteria_set(null, 'Release set', pg_temp.crit(), true, null)$$);
select pg_temp.works('opens the round', $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Release round',
  public.club_today() - 10, public.club_today() + 20, (select id from public.assessment_criteria_sets where name = 'Release set'), 1, 1)$$);
select pg_temp.works('adds the guest selector', $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.works('adds the auditor', $$select public.admin_add_selection_auditor(pg_temp.round(), pg_temp.id('71'))$$);
select pg_temp.as_member('11');
select pg_temp.works('the head coach writes evidence',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), 'EVIDENCE-zzz', '[{"item_key": "passing", "rating": 2}]')$$);
select pg_temp.works('drafts a summary of Jordan',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('31'), '[{"item_key": "passing", "rating": 2}, {"item_key": "reading", "rating": 3}]',
    'Select', 'STRENGTHS-abc', 'PRIORITIES-def', 'COMMENTS-xyz', false)$$);

select pg_temp.m_ok('11', 'release is refused before the summary is signed', 'pg_temp.releases(''31'')', false);
select pg_temp.m_eq('11', 'and the head coach is told it isn''t signed',
  $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) ->> 'my_summary_signed'$$, 'false');
select pg_temp.m_eq('11', 'with no summary sent', $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) ->> 'summary'$$, null);

select pg_temp.as_member('11');
select pg_temp.works('signs it',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('31'), '[{"item_key": "passing", "rating": 2}, {"item_key": "reading", "rating": 3}]',
    'Select', 'STRENGTHS-abc', 'PRIORITIES-def', 'COMMENTS-xyz', true)$$);
select pg_temp.works('signs a summary of Kai with no comments',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'), '[{"item_key": "focus", "rating": 1}]', 'Select', 'KAI-strong', '', '', true)$$);
select pg_temp.as_member('62');
select pg_temp.works('the second selector signs their own summary of Jordan',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('31'), '[{"item_key": "focus", "rating": 1}]', 'Not this time', 'SECOND-words', 'SECOND-prio', '', true)$$);

-- ---------------------------------------------------------------------------
-- Who may release, take back and release in bulk
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || ': releases Jordan''s', 'pg_temp.releases(''31'')', false)
  || E'\n' || pg_temp.m_ok(n, who || ': releases in bulk', 'pg_temp.bulk()', false)
from (values ('62', 'the second selector'), ('42', 'an assistant coach on the panel'), ('01', 'an admin'),
  ('71', 'the auditor'), ('13', 'a manager'), ('31', 'the athlete'), ('41', 'a parent'), ('51', 'a guest'),
  ('64', 'the head coach of another squad'), ('12', 'a coach whose check lapsed'), ('21', 'the committee')) v(n, who);
select pg_temp.m_ok('11', 'the head coach can''t release for their own child', 'pg_temp.releases(''63'')', false);
select pg_temp.ok('none of them left a row', (select count(*) from public.assessment_releases) = 0, true);
select pg_temp.set_feature(false);
select pg_temp.m_ok('11', 'with the switch off the head coach is refused', 'pg_temp.releases(''31'')', false);
select pg_temp.m_ok('11', 'and refused the bulk release', 'pg_temp.bulk()', false);
select pg_temp.set_feature(true);

select pg_temp.m_eq('11', 'the head coach can release', $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) ->> 'can_release'$$, 'true');
select pg_temp.m_eq('11', 'and gets their own summary', $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) #>> '{summary,strengths}'$$, 'STRENGTHS-abc');
select pg_temp.m_eq('62', 'the second selector can''t', $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) ->> 'can_release'$$, 'false');
select pg_temp.m_eq('62', 'and gets no summary', $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) ->> 'summary'$$, null);
select pg_temp.as_member('42');
select pg_temp.fails('Jordan''s parent on the panel is refused the release screen', $$select public.athlete_release(pg_temp.round(), pg_temp.id('31'))$$);

-- ---------------------------------------------------------------------------
-- Parts
-- ---------------------------------------------------------------------------

select pg_temp.as_member('11');
select pg_temp.fails('parts must be an object', $$select public.release_assessment(pg_temp.round(), pg_temp.id('31'), '[]')$$);
select pg_temp.fails('a group not in the round is refused', $$select public.release_assessment(pg_temp.round(), pg_temp.id('31'), '{"groups": ["nope"]}')$$);
select pg_temp.fails('a group twice is refused', $$select public.release_assessment(pg_temp.round(), pg_temp.id('31'), '{"groups": ["technical", "technical"]}')$$);
select pg_temp.fails('nothing ticked is refused', $$select public.release_assessment(pg_temp.round(), pg_temp.id('31'), '{"groups": [], "strengths": false}')$$);
select pg_temp.fails('a part that isn''t true or false is refused', $$select public.release_assessment(pg_temp.round(), pg_temp.id('31'), '{"strengths": "yes"}')$$);
select pg_temp.fails('only empty parts left is refused', $$select public.release_assessment(pg_temp.round(), pg_temp.id('32'), '{"comments": true, "groups": ["technical"]}')$$);
select pg_temp.ok('and left no row', (select count(*) from public.assessment_releases) = 0, true);

-- ---------------------------------------------------------------------------
-- Releasing some parts, and what the athlete reads
-- ---------------------------------------------------------------------------

select pg_temp.works('the head coach releases Jordan''s strengths and technical ratings, ticking an empty group too',
  $$select public.release_assessment(pg_temp.round(), pg_temp.id('31'), '{"groups": ["technical", "mental"], "strengths": true}')$$);
select pg_temp.eq('the empty group was switched off', (select parts::text from public.assessment_releases where athlete_id = pg_temp.id('31')),
  '{"groups": ["technical"], "comments": false, "strengths": true, "priorities": false, "recommendation": false}');
select pg_temp.eq('a released event with the parts', pg_temp.events('31'), 'released');
select pg_temp.fails('releasing again while released is refused',
  $$select public.release_assessment(pg_temp.round(), pg_temp.id('31'), '{"strengths": true}')$$);

select pg_temp.m_eq('31', 'Jordan reads the strengths', $$pg_temp.jordan() ->> 'strengths'$$, 'STRENGTHS-abc');
select pg_temp.m_eq('31', 'and one group', $$pg_temp.jordan() -> 'groups'$$,
  '[{"name": "Technical ability", "items": [{"name": "Passing ITEM-pass", "step": "Meets standard"}], "scale": ["Below standard", "Meets standard", "Exceeds standard"]}]');
select pg_temp.m_eq('31', 'with nothing else of the summary, the other selector, the evidence or any id', $$pg_temp.leaks(pg_temp.jordan())$$, 'none');
select pg_temp.m_eq('31', 'no recommendation', $$pg_temp.jordan() ->> 'recommendation'$$, null);
select pg_temp.m_eq('31', 'from the head coach', $$pg_temp.jordan() ->> 'from_name'$$, 'Casey Coach');
select pg_temp.m_eq('31', 'with the set''s name', $$pg_temp.jordan() ->> 'criteria_set_name'$$, 'Release set');
select pg_temp.m_eq('31', 'as their own', $$pg_temp.jordan() ->> 'is_me'$$, 'true');
select pg_temp.m_eq('41', 'the verified parent reads the same', $$pg_temp.jordan() ->> 'strengths'$$, 'STRENGTHS-abc');
select pg_temp.m_eq('41', 'not as their own', $$pg_temp.jordan() ->> 'is_me'$$, 'false');
select pg_temp.m_eq('41', 'and nothing more', $$pg_temp.leaks(pg_temp.jordan())$$, 'none');

select pg_temp.m_eq(n, who || ' is shown nothing', 'jsonb_array_length(pg_temp.mine())::text', '0')
from (values ('43', 'the parent who isn''t verified'), ('32', 'another athlete'), ('11', 'the head coach'),
  ('62', 'a selector'), ('01', 'an admin'), ('71', 'the auditor'), ('13', 'a manager'), ('51', 'a guest')) v(n, who);
select pg_temp.set_feature(false);
select pg_temp.m_eq(n, 'with the switch off ' || n || ' is shown nothing', 'jsonb_array_length(pg_temp.mine())::text', '0')
from unnest(array['31', '41']) n;
select pg_temp.set_feature(true);

-- The list for the panel, and the head coach's view
select pg_temp.m_eq('62', 'the panel''s list shows it released, not read', $$select string_agg(public.member_display_name(athlete_id) || ' ' || seen, ',') from public.selection_round_releases(pg_temp.round())$$, 'Jordan Junior false');
select pg_temp.as_member('31');
select pg_temp.fails('an athlete can''t list releases', $$select public.selection_round_releases(pg_temp.round())$$);
select pg_temp.m_eq('62', 'the second selector reads the release status', $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) #>> '{release,parts,strengths}'$$, 'true');

select pg_temp.m_ok(n, who || ' leads the round: ' || v, 'public.i_lead_selection_round(pg_temp.round())', v)
from (values ('11', 'the head coach', true), ('62', 'the second selector', false), ('42', 'an assistant coach', false),
  ('01', 'an admin', false), ('31', 'the athlete', false), ('64', 'another squad''s head coach', false)) x(n, who, v);

-- Seen
select pg_temp.m_eq('31', 'it is new', $$pg_temp.jordan() ->> 'is_new'$$, 'true');
select pg_temp.as_member('32');
select public.mark_assessment_release_seen(pg_temp.round(), pg_temp.id('31'));
select pg_temp.m_eq('31', 'another athlete marking it changes nothing', $$pg_temp.jordan() ->> 'is_new'$$, 'true');
select pg_temp.as_member('43');
select public.mark_assessment_release_seen(pg_temp.round(), pg_temp.id('31'));
select pg_temp.m_eq('31', 'nor does the parent who isn''t verified', $$pg_temp.jordan() ->> 'is_new'$$, 'true');
select pg_temp.as_member('41');
select public.mark_assessment_release_seen(pg_temp.round(), pg_temp.id('31'));
select pg_temp.m_eq('31', 'the verified parent reading it marks it seen', $$pg_temp.jordan() ->> 'is_new'$$, 'false');

-- ---------------------------------------------------------------------------
-- Taking back, and releasing everything
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || ': takes it back', 'pg_temp.withdraws(''31'')', false)
from (values ('62', 'the second selector'), ('42', 'an assistant coach'), ('01', 'an admin'), ('71', 'the auditor'), ('31', 'the athlete'), ('41', 'a parent')) v(n, who);
select pg_temp.m_ok('11', 'the head coach takes it back', 'pg_temp.withdraws(''31'')', true);
select pg_temp.m_eq('31', 'Jordan reads nothing now', 'jsonb_array_length(pg_temp.mine())::text', '0');
select pg_temp.m_eq('41', 'nor the parent', 'jsonb_array_length(pg_temp.mine())::text', '0');
select pg_temp.m_ok('11', 'taking back twice is refused', 'pg_temp.withdraws(''31'')', false);
select pg_temp.m_ok('11', 'it can be released again, everything ticked',
  'pg_temp.releases(''31'', ''{"groups": ["technical", "tactical", "mental"], "strengths": true, "priorities": true, "comments": true, "recommendation": true}'')', true);
select pg_temp.m_eq('31', 'all five parts are there',
  $$(select concat_ws('|', x ->> 'strengths', x ->> 'priorities', x ->> 'comments', x ->> 'recommendation', jsonb_array_length(x -> 'groups')) from (select pg_temp.jordan() x) y)$$,
  'STRENGTHS-abc|PRIORITIES-def|COMMENTS-xyz|Select|2');
select pg_temp.m_eq('31', 'still nothing of the second selector, no evidence and no criterion without a step',
  $$(select coalesce(string_agg(w, ','), 'none') from unnest(array['SECOND-words', 'SECOND-prio', 'EVIDENCE-zzz', 'ITEM-focus', 'ITEM-catch', 'Not this time']) w where position(w in pg_temp.jordan()::text) > 0)$$, 'none');
select pg_temp.m_eq('31', 'releasing again makes it new again', $$pg_temp.jordan() ->> 'is_new'$$, 'true');
select pg_temp.eq('the history', pg_temp.events('31'), 'released, withdrawn, released');

-- Reopening takes it back: by the head coach, then by an admin
select pg_temp.as_member('11');
select pg_temp.works('the head coach reopens their summary', $$select public.reopen_assessment_summary(
  (select id from public.assessment_summaries where athlete_id = pg_temp.id('31') and author_id = pg_temp.id('11')))$$);
select pg_temp.m_eq('31', 'Jordan reads nothing', 'jsonb_array_length(pg_temp.mine())::text', '0');
select pg_temp.eq('withdrawn with the reason', pg_temp.events('31'), 'released, withdrawn, released, withdrawn (The summary was reopened)');
select pg_temp.m_ok('11', 'release is refused while the summary is open', 'pg_temp.releases(''31'')', false);
select pg_temp.as_member('11');
select pg_temp.works('signs again', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('31'),
  '[{"item_key": "passing", "rating": 2}, {"item_key": "reading", "rating": 3}]', 'Select', 'STRENGTHS-abc', 'PRIORITIES-def', 'COMMENTS-xyz', true)$$);
select pg_temp.m_ok('11', 'releases again', 'pg_temp.releases(''31'')', true);
select pg_temp.as_member('01');
select pg_temp.works('an admin reopens the summary', $$select public.reopen_assessment_summary(
  (select id from public.assessment_summaries where athlete_id = pg_temp.id('31') and author_id = pg_temp.id('11')))$$);
select pg_temp.m_eq('41', 'the parent reads nothing', 'jsonb_array_length(pg_temp.mine())::text', '0');
select pg_temp.ok('and a withdrawn event by the admin', (select e.by_name = public.member_display_name(pg_temp.id('01')) and e.detail = 'The summary was reopened'
  from public.assessment_release_events e join public.assessment_releases x on x.id = e.release_id
  where x.athlete_id = pg_temp.id('31') order by e.at desc, e.id desc limit 1), true);
select pg_temp.as_member('11');
select pg_temp.works('signs again', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('31'),
  '[{"item_key": "passing", "rating": 2}, {"item_key": "reading", "rating": 3}]', 'Select', 'STRENGTHS-abc', 'PRIORITIES-def', 'COMMENTS-xyz', true)$$);

-- Bulk
select pg_temp.as_member('11');
select pg_temp.eq('the bulk release releases the two signed athletes', public.release_assessments(pg_temp.round(), '{"groups": ["technical"], "strengths": true}')::text, '2');
select pg_temp.eq('never the head coach''s own child', (select count(*)::text from public.assessment_releases where athlete_id = pg_temp.id('63')), '0');
select pg_temp.eq('Kai''s has only what his summary holds', (select parts::text from public.assessment_releases where athlete_id = pg_temp.id('32')),
  '{"groups": [], "comments": false, "strengths": true, "priorities": false, "recommendation": false}');
select pg_temp.eq('again, nothing is left to release', public.release_assessments(pg_temp.round(), '{"strengths": true}')::text, '0');
select pg_temp.m_eq('32', 'Kai reads his', $$(select x ->> 'strengths' from jsonb_array_elements(pg_temp.mine()) x)$$, 'KAI-strong');
select pg_temp.m_eq('32', 'and not Jordan''s', 'jsonb_array_length(pg_temp.mine())::text', '1');

-- ---------------------------------------------------------------------------
-- The record, the auditor and the register
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || ': reads the release record', 'pg_temp.record_reads()', ok)
from (values ('01', 'an admin', true), ('71', 'the round''s auditor', true), ('11', 'the head coach', false),
  ('62', 'a selector', false), ('21', 'the committee', false), ('31', 'the athlete', false), ('41', 'a parent', false), ('51', 'a guest', false)) v(n, who, ok);
select pg_temp.as_member('01');
delete from public.record_access_log where subject_id = pg_temp.id('31') and kind = 'assessment_audit';
select pg_temp.eq('the record holds no words', (select coalesce(string_agg(w, ','), 'none') from unnest(array['STRENGTHS-abc', 'PRIORITIES-def', 'COMMENTS-xyz', 'KAI-strong', 'Meets standard', 'Select']) w
  where position(w in public.admin_selection_releases(pg_temp.round())::text) > 0), 'none');
select pg_temp.eq('it counts the parts', (select concat_ws('|', r ->> 'groups', r ->> 'groups_total', r ->> 'strengths', r ->> 'priorities', r ->> 'withdrawn')
  from jsonb_array_elements(public.admin_selection_releases(pg_temp.round()) -> 'released') r where r ->> 'athlete_name' = 'Jordan Junior'), '1|3|true|false|3');
select pg_temp.ok('building it is in Jordan''s record views', (select count(*) from public.record_access_log where subject_id = pg_temp.id('31') and kind = 'assessment_audit') > 0, true);
select pg_temp.m_eq('71', 'the auditor sees the release', $$select public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('31')) #>> '{release,parts,strengths}'$$, 'true');
select pg_temp.m_eq('71', 'and its history', $$select jsonb_array_length(public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('31')) -> 'release_events')::text$$, '7');
select pg_temp.m_eq('01', 'the register counts current releases', $$select r ->> 'released' from jsonb_array_elements(public.admin_selection_register() -> 'rounds') r where r ->> 'name' = 'Release round'$$, '2');
select pg_temp.as_member('11');
select pg_temp.works('taking Kai''s back', $$select public.withdraw_assessment_release(pg_temp.round(), pg_temp.id('32'))$$);
select pg_temp.m_eq('01', 'the register counts one now', $$select r ->> 'released' from jsonb_array_elements(public.admin_selection_register() -> 'rounds') r where r ->> 'name' = 'Release round'$$, '1');

-- ---------------------------------------------------------------------------
-- A closed round, and retention
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.works('an admin closes the round', $$select public.admin_close_selection_round(pg_temp.round(), true)$$);
select pg_temp.m_eq('31', 'Jordan still reads it in the closed round', $$pg_temp.jordan() ->> 'strengths'$$, 'STRENGTHS-abc');
select pg_temp.m_ok('11', 'nothing can be taken back in a closed round', 'pg_temp.withdraws(''31'')', false);
select pg_temp.m_ok('11', 'nor released', 'pg_temp.releases(''32'')', false);
select pg_temp.m_eq('11', 'and the head coach is told they can''t', $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) ->> 'can_release'$$, 'false');
delete from public.selection_rounds where id = pg_temp.round();
select pg_temp.ok('deleting the round removes its releases and their history',
  (select count(*) from public.assessment_releases) = 0 and (select count(*) from public.assessment_release_events) = 0, true);
