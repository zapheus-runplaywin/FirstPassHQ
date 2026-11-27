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
create or replace function pg_temp.round(p_name text default 'Notes round') returns uuid language sql as
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

create or replace function pg_temp.has_note(p jsonb) returns text language sql as
$$ select coalesce(string_agg(w, ','), 'none') from unnest(array['NOTE-7f3a-never-released', 'NOTE-2b9c-second']) w
   where position(w in coalesce(p::text, '')) > 0 $$;
create or replace function pg_temp.mine_notes(n text, a text) returns jsonb language plpgsql as
$$ begin perform pg_temp.as_member(n); return public.my_assessment_summary(pg_temp.round(), pg_temp.id(a)) -> 'mine' -> 'notes'; end $$;
create or replace function pg_temp.save(n text, a text, p_notes jsonb, p_sign boolean default false) returns text language plpgsql as
$$ begin perform pg_temp.as_member(n);
   perform public.save_assessment_summary(pg_temp.round(), pg_temp.id(a), '[{"item_key": "passing", "rating": 2}]',
     'Select', 'STRENGTHS-n', 'PRIORITIES-n', 'COMMENTS-n', p_sign, p_notes); return 'saved';
   exception when others then return sqlerrm; end $$;

-- Sample people: 62 a guest selector with a check, 63 Casey's (11) child,
-- 64 a head coach of another squad, 71 this round's auditor, 72 another
-- round's auditor, 51 a guest.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('62'), 'guest.sel@example.test', now()),
  (pg_temp.id('63'), 'coach.child@example.test', now()),
  (pg_temp.id('64'), 'other.head@example.test', now()),
  (pg_temp.id('71'), 'auditor.n@example.test', now()),
  (pg_temp.id('72'), 'auditor.other@example.test', now()),
  (pg_temp.id('51'), 'guest.n@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = case when v.wwcc is null then null else public.club_today() + 400 end,
  date_of_birth = v.dob::date, verified_at = now()
from (values
  ('62', 'Ola Selector', 'guest', 'WWC0062', '1980-01-01'),
  ('63', 'Cody Coachkid', 'athlete', null, '2011-01-01'),
  ('64', 'Hana Head', 'coach', 'WWC0064', '1980-01-01'),
  ('71', 'Ari Auditor', 'committee', 'WWC0071', '1980-01-01'),
  ('72', 'Bo Otherauditor', 'committee', 'WWC0072', '1980-01-01'),
  ('51', 'Gus Guest', 'guest', null, '1980-01-01')
) v(n, name, role, wwcc, dob)
where p.id = pg_temp.id(v.n);
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('11'), pg_temp.id('63'));
insert into public.teams (id, name, kind, sort_order, season)
select '00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3, season from public.teams where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.id('63'), 'athlete', null),
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.id('64'), 'coach', 'head_coach');

-- ---------------------------------------------------------------------------
-- The migration
-- ---------------------------------------------------------------------------

select pg_temp.ok('summaries have a notes column that starts as a list',
  (select column_default like '''[]''::jsonb%' and is_nullable = 'NO' from information_schema.columns
   where table_schema = 'public' and table_name = 'assessment_summaries' and column_name = 'notes'), true);
select pg_temp.eq('there is one save_assessment_summary, with nine arguments',
  (select string_agg(pg_get_function_identity_arguments(oid), ' | ') from pg_proc where proname = 'save_assessment_summary'),
  'p_round_id uuid, p_athlete_id uuid, p_ratings jsonb, p_recommendation text, p_strengths text, p_priorities text, p_comments text, p_sign boolean, p_notes jsonb');
select pg_temp.ok('anon cannot save a summary',
  has_function_privilege('anon', 'public.save_assessment_summary(uuid, uuid, jsonb, text, text, text, text, boolean, jsonb)', 'execute'), false);
select pg_temp.ok('signed-in members can',
  has_function_privilege('authenticated', 'public.save_assessment_summary(uuid, uuid, jsonb, text, text, text, text, boolean, jsonb)', 'execute'), true);

-- ---------------------------------------------------------------------------
-- A round: Casey (11) head coach, Morgan (42, Jordan's parent) and Ola (62)
-- on the panel, Ari (71) auditing. Another round in Other Squad, audited by Bo (72).
-- ---------------------------------------------------------------------------

select pg_temp.set_feature(true);
select pg_temp.as_member('01');
select pg_temp.works('an admin adds a set', $$select public.admin_save_criteria_set(null, 'Notes set', pg_temp.crit(), true, null)$$);
select pg_temp.works('opens the round', $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Notes round',
  public.club_today() - 10, public.club_today() + 20, (select id from public.assessment_criteria_sets where name = 'Notes set'), 1, 1)$$);
select pg_temp.works('opens another round', $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000b1', 'Other round',
  public.club_today() - 10, public.club_today() + 20, (select id from public.assessment_criteria_sets where name = 'Notes set'), 1, 1)$$);
select pg_temp.works('adds the guest selector', $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.works('adds the auditor', $$select public.admin_add_selection_auditor(pg_temp.round(), pg_temp.id('71'))$$);
select pg_temp.works('adds the other round''s auditor', $$select public.admin_add_selection_auditor(pg_temp.round('Other round'), pg_temp.id('72'))$$);

-- ---------------------------------------------------------------------------
-- Saving
-- ---------------------------------------------------------------------------

select pg_temp.eq('a note saves with a draft',
  pg_temp.save('11', '31', '[{"item_key": "passing", "note": "  NOTE-7f3a-never-released  "}, {"item_key": "focus", "note": "   "}]'), 'saved');
select pg_temp.eq('and comes back to its author trimmed, with the empty one dropped',
  pg_temp.mine_notes('11', '31')::text, '[{"note": "NOTE-7f3a-never-released", "item_key": "passing"}]');
select pg_temp.eq('a criterion can have a note without a step',
  pg_temp.save('11', '32', '[{"item_key": "reading", "note": "Only a note"}]'), 'saved');
select pg_temp.eq('not a list is refused', pg_temp.save('11', '31', '{"item_key": "passing"}'), 'The internal notes must be a list');
select pg_temp.eq('a criterion not in the round is refused', pg_temp.save('11', '31', '[{"item_key": "nope", "note": "x"}]'), 'One of the criteria isn’t in this round');
select pg_temp.eq('the same criterion twice is refused',
  pg_temp.save('11', '31', '[{"item_key": "passing", "note": "a"}, {"item_key": "passing", "note": "b"}]'), 'One of the criteria is there twice');
select pg_temp.eq('501 characters is refused',
  pg_temp.save('11', '31', jsonb_build_array(jsonb_build_object('item_key', 'passing', 'note', repeat('x', 501)))), 'Keep each internal note to 500 characters');
select pg_temp.eq('500 characters saves',
  pg_temp.save('11', '32', jsonb_build_array(jsonb_build_object('item_key', 'passing', 'note', repeat('x', 500)))), 'saved');
select pg_temp.eq('a refused save left the note as it was', pg_temp.mine_notes('11', '31') -> 0 ->> 'note', 'NOTE-7f3a-never-released');

select pg_temp.as_member('11');
select pg_temp.works('an app that hasn''t updated saves with eight named arguments',
  $$select public.save_assessment_summary(p_round_id => pg_temp.round(), p_athlete_id => pg_temp.id('31'),
    p_ratings => '[{"item_key": "passing", "rating": 2}, {"item_key": "reading", "rating": 3}]', p_recommendation => 'Select',
    p_strengths => 'STRENGTHS-abc', p_priorities => 'PRIORITIES-def', p_comments => 'COMMENTS-xyz', p_sign => false)$$);
select pg_temp.eq('and leaves the saved note untouched', pg_temp.mine_notes('11', '31') -> 0 ->> 'note', 'NOTE-7f3a-never-released');
select pg_temp.as_member('62');
select pg_temp.works('an old app''s first save starts with no notes',
  $$select public.save_assessment_summary(p_round_id => pg_temp.round(), p_athlete_id => pg_temp.id('32'),
    p_ratings => '[{"item_key": "passing", "rating": 2}]', p_recommendation => 'Select',
    p_strengths => 's', p_priorities => '', p_comments => '', p_sign => false)$$);
select pg_temp.eq('so the column holds an empty list', pg_temp.mine_notes('62', '32')::text, '[]');

select pg_temp.eq('the second selector saves a note and signs',
  pg_temp.save('62', '31', '[{"item_key": "catching", "note": "NOTE-2b9c-second"}]'), 'saved');
select pg_temp.m_eq('62', 'before the head coach''s second selector signs, others hold nothing',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('31')) -> 'others'$$, '[]');
select pg_temp.as_member('11');
select pg_temp.works('the head coach signs with the note',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('31'),
    '[{"item_key": "passing", "rating": 2}, {"item_key": "reading", "rating": 3}]', 'Select', 'STRENGTHS-abc', 'PRIORITIES-def',
    'COMMENTS-xyz', true, '[{"item_key": "passing", "note": "NOTE-7f3a-never-released"}]')$$);
select pg_temp.eq('a signed summary''s note can''t be changed',
  pg_temp.save('11', '31', '[]'), 'This summary is signed. The head coach or an admin can reopen it.');
select pg_temp.m_eq('62', 'the second selector still sees no others before signing',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('31')) -> 'others'$$, '[]');
select pg_temp.eq('the second selector signs', pg_temp.save('62', '31', '[{"item_key": "catching", "note": "NOTE-2b9c-second"}]', true), 'saved');

-- ---------------------------------------------------------------------------
-- Who reads, both ways
-- ---------------------------------------------------------------------------

select pg_temp.m_eq('11', 'the author reads their own', $$select pg_temp.has_note(public.my_assessment_summary(pg_temp.round(), pg_temp.id('31')) -> 'mine')$$, 'NOTE-7f3a-never-released');
select pg_temp.m_eq('11', 'and, signed, the other selector''s', $$select pg_temp.has_note(public.my_assessment_summary(pg_temp.round(), pg_temp.id('31')) -> 'others')$$, 'NOTE-2b9c-second');
select pg_temp.m_eq('62', 'the second selector, once signed, reads the head coach''s', $$select pg_temp.has_note(public.my_assessment_summary(pg_temp.round(), pg_temp.id('31')) -> 'others')$$, 'NOTE-7f3a-never-released');
select pg_temp.as_member('42');
select pg_temp.fails('a selector who is the athlete''s parent is refused', $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.as_member('11');
select pg_temp.fails('the head coach is refused their own child''s', $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('63'))$$);
select pg_temp.m_eq('71', 'the round''s auditor reads both signed notes',
  $$select pg_temp.has_note(public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('31')) -> 'summaries')$$, 'NOTE-7f3a-never-released,NOTE-2b9c-second');
select pg_temp.m_eq('71', 'but not an unsigned summary''s note',
  $$select position('Only a note' in (public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('32')))::text) > 0$$, 'false');
select pg_temp.as_member('72');
select pg_temp.fails('another round''s auditor is refused', $$select public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.fails('and can''t read a summary', $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.as_member('21');
select pg_temp.fails('a committee member is refused the summary', $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.fails('and the auditor''s view', $$select public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.as_member('64');
select pg_temp.fails('a coach not on the panel is refused', $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.as_member('13');
select pg_temp.fails('a manager is refused', $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.as_member('51');
select pg_temp.fails('a guest is refused', $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.as_member('01');
select pg_temp.fails('an admin off the panel is refused the summary', $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.fails('and the auditor''s view', $$select public.auditor_athlete_assessment(pg_temp.round(), pg_temp.id('31'))$$);

-- ---------------------------------------------------------------------------
-- Release everything, share feedback; nothing reaches athletes, parents or admins
-- ---------------------------------------------------------------------------

select pg_temp.as_member('11');
select pg_temp.works('the head coach releases every part',
  $$select public.release_assessment(pg_temp.round(), pg_temp.id('31'),
    '{"groups": ["technical", "tactical"], "strengths": true, "priorities": true, "comments": true, "recommendation": true}')$$);
select pg_temp.works('and shares feedback', $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('31'), 'Went well', 'Work on', true)$$);
select pg_temp.m_eq('11', 'the release screen counts the head coach''s note',
  $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) ->> 'notes_count'$$, '1');
select pg_temp.m_eq('11', 'and holds no note text', $$select pg_temp.has_note(public.athlete_release(pg_temp.round(), pg_temp.id('31')))$$, 'none');
select pg_temp.m_eq('11', 'its summary keeps exactly the releasable parts',
  $$select string_agg(k, ',' order by k) from jsonb_object_keys(public.athlete_release(pg_temp.round(), pg_temp.id('31')) -> 'summary') k$$,
  'comments,priorities,ratings,recommendation,strengths');
select pg_temp.m_eq('62', 'another selector''s release screen counts no notes',
  $$select public.athlete_release(pg_temp.round(), pg_temp.id('31')) ->> 'notes_count'$$, '0');

select pg_temp.m_eq('11', 'the panel''s round list holds no note', $$select pg_temp.has_note((select jsonb_agg(to_jsonb(x)) from public.selection_round_summaries(pg_temp.round()) x))$$, 'none');
select pg_temp.m_eq('11', 'nor the round sheet', $$select pg_temp.has_note(to_jsonb(public.selection_round_sheet(pg_temp.round())))$$, 'none');
select pg_temp.m_eq('11', 'nor the athlete''s assessment', $$select pg_temp.has_note(to_jsonb(public.athlete_assessment(pg_temp.round(), pg_temp.id('31'))))$$, 'none');

select pg_temp.m_eq('01', 'admin: ' || f || ' holds no note',
  format('select pg_temp.has_note(to_jsonb(public.%s(pg_temp.round())))', f), 'none')
from unnest(array['admin_selection_audit', 'admin_selection_summaries', 'admin_selection_feedback',
  'admin_selection_releases', 'admin_selection_round_record']) f;
select pg_temp.m_eq('01', 'admin: the register holds no note', $$select pg_temp.has_note(public.admin_selection_register())$$, 'none');
select pg_temp.m_eq('01', 'the round record counts signed notes only',
  $$select public.admin_selection_round_record(pg_temp.round()) -> 'internal_notes'$$, '{"notes": 2, "athletes": 1, "selectors": 2}');
select pg_temp.m_eq('71', 'the auditor sees the same counts',
  $$select public.admin_selection_round_record(pg_temp.round()) -> 'internal_notes' ->> 'notes'$$, '2');

create or replace function pg_temp.family_leaks(n text) returns text language plpgsql as
$$ begin perform pg_temp.as_member(n);
   return pg_temp.has_note(jsonb_build_array(public.my_released_assessments(), (select jsonb_agg(to_jsonb(x)) from public.my_selection_feedback() x), (select jsonb_agg(to_jsonb(x)) from public.my_selection_info() x))); end $$;
select pg_temp.m_ok('31', 'the athlete has the release', $$jsonb_array_length(public.my_released_assessments()) = 1$$, true);
select pg_temp.m_ok('31', 'with the comments part released', $$position('COMMENTS-xyz' in public.my_released_assessments()::text) > 0$$, true);
select pg_temp.eq('the athlete sees no note anywhere', pg_temp.family_leaks('31'), 'none');
select pg_temp.m_ok('41', 'the verified parent has the release', $$jsonb_array_length(public.my_released_assessments()) = 1$$, true);
select pg_temp.eq('the parent sees no note anywhere', pg_temp.family_leaks('41'), 'none');

select pg_temp.as_member('11');
select pg_temp.works('the head coach reopens the summary',
  $$select public.reopen_assessment_summary((select id from public.assessment_summaries where round_id = pg_temp.round() and athlete_id = pg_temp.id('31') and author_id = pg_temp.id('11')))$$);
select pg_temp.eq('a reopened summary''s note can be changed',
  pg_temp.save('11', '31', '[{"item_key": "passing", "note": "NOTE-7f3a-never-released again"}]'), 'saved');
select pg_temp.as_member('11');
select pg_temp.works('signs again',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('31'),
    '[{"item_key": "passing", "rating": 2}, {"item_key": "reading", "rating": 3}]', 'Select', 'STRENGTHS-abc', 'PRIORITIES-def',
    'COMMENTS-xyz', true, null)$$);
select pg_temp.m_eq('11', 'signing with no notes sent kept the note', $$select pg_temp.has_note(public.my_assessment_summary(pg_temp.round(), pg_temp.id('31')) -> 'mine')$$, 'NOTE-7f3a-never-released');
select pg_temp.works('and releases every part again',
  $$select public.release_assessment(pg_temp.round(), pg_temp.id('31'),
    '{"groups": ["technical", "tactical"], "strengths": true, "priorities": true, "comments": true, "recommendation": true}')$$);
select pg_temp.eq('after release again, the athlete sees no note', pg_temp.family_leaks('31'), 'none');
select pg_temp.eq('nor the parent', pg_temp.family_leaks('41'), 'none');
select pg_temp.eq('nor the second parent', pg_temp.family_leaks('42'), 'none');
