-- Tests for 20261127300000_selection_auditors.sql: committee members an admin
-- makes auditors of a round read everything in it, never their own child's
-- assessment, and change nothing. Admins keep set-up and the counts-only
-- report. Run on a fresh database with the migrations and seed-members.sql
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
-- The same checks, first acting as sample member n, so one statement can run
-- a check for each kind of member and still print one line per check.
create or replace function pg_temp.m_ok(n text, label text, expression text, expected boolean) returns text language plpgsql as
$$ declare v boolean; begin perform pg_temp.as_member(n); execute 'select ' || expression into v;
   return pg_temp.ok(label, v, expected); end $$;
create or replace function pg_temp.m_fails(n text, label text, statement text) returns text language plpgsql as
$$ begin perform pg_temp.as_member(n); return pg_temp.fails(label, statement); end $$;
create or replace function pg_temp.set_feature(p_on boolean) returns void language sql as
$$ update public.club_settings set features = features || jsonb_build_object('selectionAssessments', p_on) where id $$;
create or replace function pg_temp.crit() returns jsonb language sql as
$$ select '{"groups": [{"key": "skills", "name": "Skills", "scale": ["Below", "Meets", "Exceeds"],
     "items": [{"key": "passing", "name": "Passing"}]}], "recommendations": ["Select", "Not this time"]}'::jsonb $$;
create or replace function pg_temp.round(p_name text default 'Audited') returns uuid language sql as
$$ select id from public.selection_rounds where name = p_name $$;
create or replace function pg_temp.views(n text, p_kind text) returns bigint language sql as
$$ select count(*) from public.record_access_log l where l.subject_id = pg_temp.id(n) and l.kind = p_kind $$;
create or replace function pg_temp.add(p_round uuid, n text) returns text language plpgsql as
$$ begin perform pg_temp.as_member('01');
   return pg_temp.works('an admin adds ' || n || ' as auditor', format('select public.admin_add_selection_auditor(%L, %L)', p_round, pg_temp.id(n))); end $$;

-- Sample people: 71 an auditor (committee, current check), 72 a committee
-- member who is Jordan's (31) parent, with a check, 73 an admin also on the
-- committee, with a check, 74 a committee member who also coaches, 51 a guest.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('71'), 'auditor@example.test', now()),
  (pg_temp.id('72'), 'parent.auditor@example.test', now()),
  (pg_temp.id('73'), 'admin.committee@example.test', now()),
  (pg_temp.id('74'), 'auditor.two@example.test', now()),
  (pg_temp.id('51'), 'guest.au@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  extra_roles = v.extra::public.app_role[], wwcc_number = v.wwcc, wwcc_expires_on = public.club_today() + 400,
  verified_at = now()
from (values
  ('71', 'Ari Auditor', 'committee', '{}', 'WWC0071'),
  ('72', 'Pia Parent', 'committee', '{guardian}', 'WWC0072'),
  ('73', 'Ada Admin', 'admin', '{committee}', 'WWC0073'),
  ('74', 'Cal Auditor', 'committee', '{coach}', 'WWC0074'),
  ('51', 'Gus Guest', 'guest', '{}', 'WWC0051')
) v(n, name, role, extra, wwcc)
where p.id = pg_temp.id(v.n);
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('72'), pg_temp.id('31'));
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);

-- ---------------------------------------------------------------------------
-- The migration
-- ---------------------------------------------------------------------------

select pg_temp.ok('the auditors table is closed to signed-in members',
  has_table_privilege('authenticated', 'public.selection_round_auditors', 'select')
  or has_table_privilege('authenticated', 'public.selection_round_auditors', 'insert'), false);
select pg_temp.ok('the helpers are closed to members',
  (select bool_or(has_function_privilege('authenticated', f, 'execute')) from unnest(array[
    'public.can_audit_selections(uuid)', 'public.can_read_selection_audit(uuid)',
    'public.selection_auditors_json(uuid, boolean)']) f), false);
select pg_temp.ok('anon can call none of the new functions',
  (select bool_or(has_function_privilege('anon', f, 'execute')) from unnest(array[
    'public.audits_selection_round(uuid)', 'public.can_audit_athlete(uuid, uuid)',
    'public.admin_selection_auditors(uuid)', 'public.admin_selection_auditor_choices(uuid)',
    'public.admin_add_selection_auditor(uuid, uuid)', 'public.admin_remove_selection_auditor(uuid, uuid)',
    'public.my_selection_audits()', 'public.auditor_selection_round(uuid)',
    'public.auditor_athlete_assessment(uuid, uuid)']) f), false);

-- ---------------------------------------------------------------------------
-- A round with something in it
-- ---------------------------------------------------------------------------

select pg_temp.set_feature(true);
select pg_temp.as_member('01');
select pg_temp.works('an admin adds a set', $$select public.admin_save_criteria_set(null, 'Club set', pg_temp.crit(), true, null)$$);
select pg_temp.works('an admin opens a squad round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Audited', public.club_today() - 5, public.club_today() + 20)$$);
select pg_temp.works('and another squad''s round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000b1', 'Other', public.club_today() - 5, public.club_today() + 20)$$);
select pg_temp.as_member('11');
select pg_temp.works('the head coach writes about Kai',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('32'), 'training', public.club_today(), 'Strong drive', '[{"item_key": "passing", "rating": 3}]')$$);
select pg_temp.works('and about Jordan',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'game', public.club_today(), 'Quick hands', '[{"item_key": "passing", "rating": 2}]')$$);
select pg_temp.works('signs a summary of Kai',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'), '[{"item_key": "passing", "rating": 3}]', 'Select', 'Signed strengths', 'Signed priorities', 'Signed comments', true)$$);
select pg_temp.works('shares feedback with Kai',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('32'), 'Shared well', 'Shared work on', true)$$);
select pg_temp.works('keeps a draft for Jordan',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('31'), 'Draft words', 'Draft work', false)$$);
select pg_temp.as_member('42');
select pg_temp.works('another selector drafts a summary of Kai',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'), '[]', 'Not this time', 'Draft strengths', '', '', false)$$);

-- ---------------------------------------------------------------------------
-- Assigning
-- ---------------------------------------------------------------------------

select pg_temp.m_fails(n, 'member ' || n || ' is refused ' || f, 'select ' || f)
from unnest(array['11', '12', '13', '14', '21', '22', '23', '31', '32', '41', '42', '51', '71', '72', '74']) n,
  unnest(array[
    format('public.admin_selection_auditors(%L)', pg_temp.round()),
    format('public.admin_selection_auditor_choices(%L)', pg_temp.round()),
    format('public.admin_add_selection_auditor(%L, %L)', pg_temp.round(), pg_temp.id('71')),
    format('public.admin_remove_selection_auditor(%L, %L)', pg_temp.round(), pg_temp.id('71'))]) f;

select pg_temp.as_member('01');
select pg_temp.eq('the choices are the committee, with who is cleared',
  (select string_agg(name || ':' || cleared, ', ' order by name) from public.admin_selection_auditor_choices(pg_temp.round())),
  'Ada Admin:true, Ari Auditor:true, Cal Auditor:true, Gale Committee:false, Harper Committee:false, Indy Treasurer:false, Pia Parent:true');
select pg_temp.add(pg_temp.round(), '71');
select pg_temp.add(pg_temp.round(), '72');
select pg_temp.add(pg_temp.round(), '73');
select pg_temp.add(pg_temp.round('Other'), '71');
select pg_temp.works('adding someone twice does nothing',
  format('select public.admin_add_selection_auditor(%L, %L)', pg_temp.round(), pg_temp.id('71')));
select pg_temp.eq('one row each', (select count(*)::text from public.selection_round_auditors where round_id = pg_temp.round()), '3');
select pg_temp.fails('a committee member without a check is refused',
  format('select public.admin_add_selection_auditor(%L, %L)', pg_temp.round(), pg_temp.id('22')));
select pg_temp.fails('a coach is refused', format('select public.admin_add_selection_auditor(%L, %L)', pg_temp.round(), pg_temp.id('11')));
select pg_temp.fails('a guest is refused', format('select public.admin_add_selection_auditor(%L, %L)', pg_temp.round(), pg_temp.id('51')));
select pg_temp.fails('an athlete under 18 is refused', format('select public.admin_add_selection_auditor(%L, %L)', pg_temp.round(), pg_temp.id('31')));
update public.profiles set stood_down_at = now() where id = pg_temp.id('74');
select pg_temp.fails('a stood-down committee member is refused', format('select public.admin_add_selection_auditor(%L, %L)', pg_temp.round(), pg_temp.id('74')));
update public.profiles set stood_down_at = null where id = pg_temp.id('74');
select pg_temp.works('an admin puts the second auditor on the panel',
  format('select public.admin_add_selection_panel_member(%L, %L)', pg_temp.round(), pg_temp.id('74')));
select pg_temp.eq('choices say who is on the panel',
  (select name || ':' || on_panel from public.admin_selection_auditor_choices(pg_temp.round()) where profile_id = pg_temp.id('74')), 'Cal Auditor:true');
select pg_temp.fails('a panel member can''t audit the round',
  format('select public.admin_add_selection_auditor(%L, %L)', pg_temp.round(), pg_temp.id('74')));
select pg_temp.fails('an auditor can''t join the panel',
  format('select public.admin_add_selection_panel_member(%L, %L)', pg_temp.round(), pg_temp.id('73')));
select pg_temp.eq('admin_selection_auditors lists them with their notes',
  (select string_agg((a ->> 'name') || ' kids=' || (a ->> 'own_children') || ' admin=' || (a ->> 'is_admin') || ' other=' || (a ->> 'other_rounds'), '; ')
   from jsonb_array_elements(public.admin_selection_auditors(pg_temp.round())) a),
  'Ari Auditor kids=0 admin=false other=1; Pia Parent kids=1 admin=false other=0; Ada Admin kids=0 admin=true other=0');

-- A removed auditor keeps their row.
select pg_temp.add(pg_temp.round('Other'), '73');
select pg_temp.works('an admin takes Ada off the other round',
  format('select public.admin_remove_selection_auditor(%L, %L)', pg_temp.round('Other'), pg_temp.id('73')));
select pg_temp.eq('the row is kept with who removed it',
  (select removed_by_name from public.selection_round_auditors where round_id = pg_temp.round('Other') and profile_id = pg_temp.id('73')), 'Alex Admin');
select pg_temp.fails('removing again is refused',
  format('select public.admin_remove_selection_auditor(%L, %L)', pg_temp.round('Other'), pg_temp.id('73')));

-- A next round for the same squad offers last round's auditors first.
select pg_temp.works('an admin opens the squad''s next round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Next', public.club_today() + 30, public.club_today() + 60)$$);
select pg_temp.eq('those who audited the last round are marked',
  (select string_agg(name, ', ' order by name) from public.admin_selection_auditor_choices(pg_temp.round('Next')) where audited_last),
  'Ada Admin, Ari Auditor, Pia Parent');

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

create or replace function pg_temp.reads(n text) returns text language plpgsql as
$$ declare v text := ''; begin
  perform pg_temp.as_member(n);
  begin perform public.auditor_selection_round(pg_temp.round()); v := v || 'R'; exception when others then null; end;
  begin perform public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('32')); v := v || 'A'; exception when others then null; end;
  begin perform public.admin_selection_audit(pg_temp.round()); v := v || 'U'; exception when others then null; end;
  begin perform public.admin_selection_milestones(pg_temp.round()); v := v || 'M'; exception when others then null; end;
  begin perform public.admin_selection_summaries(pg_temp.round()); v := v || 'S'; exception when others then null; end;
  begin perform public.admin_selection_feedback(pg_temp.round()); v := v || 'F'; exception when others then null; end;
  if exists (select 1 from public.my_selection_audits() a where a.id = pg_temp.round()) then v := v || 'L'; end if;
  return v; end $$;

select pg_temp.eq('the round''s auditor reads everything', pg_temp.reads('71'), 'RAUMSFL');
select pg_temp.eq('an admin who audits reads everything too', pg_temp.reads('73'), 'RAUMSFL');
select pg_temp.eq('an admin who doesn''t audit keeps the report only', pg_temp.reads('01'), 'UMSF');
select pg_temp.eq('member ' || n || ' reads nothing of the auditor''s', pg_temp.reads(n), '')
from unnest(array['12', '13', '14', '21', '22', '23', '31', '32', '41', '51', '74']) n;
select pg_temp.eq('a coach on the panel gets none of the auditor''s functions or the report', pg_temp.reads('11'), '');
select pg_temp.m_fails('01', 'an admin still can''t read an athlete''s assessment',
  format('select public.athlete_assessment(%L, %L)', pg_temp.round(), pg_temp.id('32')));
select pg_temp.m_fails('71', 'an auditor can''t use the panel''s athlete_assessment',
  format('select public.athlete_assessment(%L, %L)', pg_temp.round(), pg_temp.id('32')));
select pg_temp.m_fails('71', 'an auditor of another round can''t open it',
  format('select public.auditor_selection_round(%L)', pg_temp.round('Next')));

-- Losing the place, the check, the committee role or the switch.
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('71');
select pg_temp.eq('an auditor whose check lapsed reads nothing', pg_temp.reads('71'), '');
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('71');
update public.profiles set stood_down_at = now() where id = pg_temp.id('71');
select pg_temp.eq('a stood-down auditor reads nothing', pg_temp.reads('71'), '');
update public.profiles set stood_down_at = null where id = pg_temp.id('71');
update public.profiles set role = 'coach' where id = pg_temp.id('71');
select pg_temp.eq('an auditor no longer on the committee reads nothing', pg_temp.reads('71'), '');
update public.profiles set role = 'committee' where id = pg_temp.id('71');
select pg_temp.set_feature(false);
select pg_temp.eq('nobody reads with the switch off: auditor', pg_temp.reads('71'), '');
select pg_temp.eq('nobody reads with the switch off: admin', pg_temp.reads('01'), '');
select pg_temp.set_feature(true);
select pg_temp.eq('back again', pg_temp.reads('71'), 'RAUMSFL');

-- Own child.
select pg_temp.as_member('72');
select pg_temp.eq('the parent auditor''s child is hidden',
  (select (r ->> 'hidden') || ' ' || (select string_agg(a ->> 'name', ',') from jsonb_array_elements(r -> 'athletes') a)
   from public.auditor_selection_round(pg_temp.round()) r), '1 Kai Senior');
select pg_temp.fails('and their child''s assessment is refused',
  format('select public.auditor_athlete_assessment(%L, %L)', pg_temp.round(), pg_temp.id('31')));
select pg_temp.eq('my_selection_audits counts only the athletes they can check',
  (select athletes || '/' || observations from public.my_selection_audits() where id = pg_temp.round()), '1/1');

-- What they read.
select pg_temp.as_member('71');
select pg_temp.eq('the round''s athletes with counts and feedback state',
  (select string_agg((a ->> 'name') || ' ' || (a ->> 'observations') || '/' || (a ->> 'summaries_signed') || ' ' || (a ->> 'feedback'), '; ' order by a ->> 'name')
   from jsonb_array_elements(public.auditor_selection_round(pg_temp.round()) -> 'athletes') a),
  'Jordan Junior 1/0 draft; Kai Senior 1/1 shared');
select pg_temp.eq('the round names its panel and auditors',
  (select jsonb_array_length(r -> 'panel') > 0 and jsonb_array_length(r -> 'auditors') = 3 from public.auditor_selection_round(pg_temp.round()) r)::text, 'true');
select pg_temp.eq('an observation''s evidence and rating',
  (select (o ->> 'note') || ' ' || (o #>> '{ratings,0,rating}') || ' ' || (o ->> 'can_change')
   from jsonb_array_elements(public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('32')) -> 'observations') o), 'Strong drive 3 false');
select pg_temp.eq('the signed summary''s words, not the draft''s',
  (select string_agg((s ->> 'recommendation') || ' ' || (s ->> 'strengths'), ',') || ' unsigned=' || (a ->> 'unsigned')
   from public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('32')) a, jsonb_array_elements(a -> 'summaries') s group by a),
  'Select Signed strengths unsigned=1');
select pg_temp.ok('no draft words anywhere',
  (select public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('32'))::text ~ 'Draft strengths'), false);
select pg_temp.eq('a signing event', (select string_agg(e ->> 'kind', ',') from jsonb_array_elements(public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('32')) -> 'summary_events') e), 'signed');
select pg_temp.eq('shared feedback''s words',
  (select (a #>> '{feedback,went_well}') || ' / ' || (a #>> '{feedback_events,0,kind}') from public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('32')) a), 'Shared well / shared');
select pg_temp.eq('a draft shows as a draft, with no words',
  (select (a -> 'feedback')::text from public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('31')) a), '{"draft": true}');
select pg_temp.eq('the audit report lists the auditors without ids',
  (select string_agg(x ->> 'name', ',') || ' ' || bool_or(x ? 'profile_id')::text from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'auditors') x),
  'Ari Auditor,Pia Parent,Ada Admin false');

-- Read-only.
select pg_temp.m_fails('71', 'an auditor can''t ' || label, stmt)
from (values
  ('write an observation', format($f$select public.save_assessment_observation(null, %L, %L, 'training', public.club_today(), 'x', '[{"item_key": "passing", "rating": 1}]')$f$, pg_temp.round(), pg_temp.id('32'))),
  ('write a summary', format($f$select public.save_assessment_summary(%L, %L, '[]', 'Select', 'x', '', '', false)$f$, pg_temp.round(), pg_temp.id('32'))),
  ('reopen a summary', format('select public.reopen_assessment_summary(%L)', (select id from public.assessment_summaries where signed_at is not null limit 1))),
  ('write feedback', format($f$select public.save_assessment_feedback(%L, %L, 'x', 'y', true)$f$, pg_temp.round(), pg_temp.id('32'))),
  ('take feedback back', format('select public.withdraw_assessment_feedback(%L, %L)', pg_temp.round(), pg_temp.id('32'))),
  ('open a round', $f$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000b1', 'Mine', public.club_today() + 90, public.club_today() + 99)$f$),
  ('change a round', format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round(), 'x', public.club_today() - 5, public.club_today() + 20)),
  ('close a round', format('select public.admin_close_selection_round(%L, true)', pg_temp.round())),
  ('add to the panel', format('select public.admin_add_selection_panel_member(%L, %L)', pg_temp.round(), pg_temp.id('71')))
) v(label, stmt);

-- Record views.
delete from public.record_access_log where subject_id = pg_temp.id('31');
select pg_temp.as_member('73');
select pg_temp.ok('an auditor opens Jordan''s assessment',
  (public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('31')) ->> 'athlete_name') is not null, true);
select pg_temp.eq('it goes in Jordan''s record views', pg_temp.views('31', 'assessment')::text, '1');
select pg_temp.ok('building the report as auditor', public.admin_selection_audit(pg_temp.round()) is not null, true);
select pg_temp.ok('adds an audit view for Jordan', pg_temp.views('31', 'assessment_audit') >= 1, true);
