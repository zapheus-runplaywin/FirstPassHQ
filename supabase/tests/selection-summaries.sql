-- Tests for 20261123300000_selection_summaries.sql: a selector's signed
-- summary of an athlete, who sees whose and when, reopening, what an admin
-- is shown, the recommendations in the criteria, and the to-do. Run on a
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
-- Whether the signed-in member can do each thing.
create or replace function pg_temp.reads(p_round uuid, n text) returns boolean language plpgsql as
$$ begin perform public.my_assessment_summary(p_round, pg_temp.id(n)); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.drafts(p_round uuid, n text) returns boolean language plpgsql as
$$ begin perform public.save_assessment_summary(p_round, pg_temp.id(n), '[{"item_key": "passing", "rating": 2}]',
     null, 'Probe', '', '', false); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.lists(p_round uuid) returns boolean language plpgsql as
$$ begin perform public.selection_round_summaries(p_round); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.admin_reads(p_round uuid) returns boolean language plpgsql as
$$ begin perform public.admin_selection_summaries(p_round); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.summary_id(author text, athlete text) returns uuid language sql as
$$ select id from public.assessment_summaries where author_id = pg_temp.id(author) and athlete_id = pg_temp.id(athlete) $$;
create or replace function pg_temp.reopens(author text, athlete text) returns boolean language plpgsql as
$$ begin perform public.reopen_assessment_summary(pg_temp.summary_id(author, athlete)); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.sign(p_round uuid, athlete text, p_recommendation text default 'Select') returns uuid language sql as
$$ select public.save_assessment_summary(p_round, pg_temp.id(athlete), '[{"item_key": "passing", "rating": 3}]',
     p_recommendation, 'Reads the play early', 'Left hand', 'Signed by ' || right(current_setting('request.jwt.claim.sub'), 2), true) $$;
create or replace function pg_temp.todo(p_kind text) returns text language sql as
$$ select coalesce((select athletes::text from public.my_selection_todos() t where t.kind = p_kind), 'none') $$;
create or replace function pg_temp.views(n text) returns bigint language sql as
$$ select count(*) from public.record_access_log l where l.subject_id = pg_temp.id(n) and l.kind like 'assessment%' $$;

-- A guest with a current check (an independent selector), only for this file.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('62'), 'guest.checked@example.test', now());
update public.profiles p set status = 'approved', full_name = 'Ola Selector', role = 'guest',
  wwcc_number = 'WWC0062', wwcc_expires_on = public.club_today() + 400, verified_at = now()
where p.id = pg_temp.id('62');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select pg_temp.ok('signed-in members cannot read or write ' || t || ' directly',
  has_table_privilege('authenticated', 'public.' || t, 'select')
  or has_table_privilege('authenticated', 'public.' || t, 'insert')
  or has_table_privilege('authenticated', 'public.' || t, 'update')
  or has_table_privilege('authenticated', 'public.' || t, 'delete')
  or has_table_privilege('anon', 'public.' || t, 'select'), false)
  || E'\n' || pg_temp.ok('row level security is on for ' || t,
  (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), true)
from unnest(array['assessment_summaries', 'assessment_summary_events']) t;
select pg_temp.ok('anon cannot call ' || f, has_function_privilege('anon', f, 'execute'), false)
from unnest(array[
  'public.my_assessment_summary(uuid, uuid)',
  'public.save_assessment_summary(uuid, uuid, jsonb, text, text, text, text, boolean, jsonb)',
  'public.reopen_assessment_summary(uuid)', 'public.selection_round_summaries(uuid)',
  'public.admin_selection_summaries(uuid)', 'public.leads_selection_round(uuid)',
  'public.check_assessment_criteria(jsonb)']) f;
select pg_temp.ok('signed-in members cannot call the helper ' || f, has_function_privilege('authenticated', f, 'execute'), false)
from unnest(array['public.leads_selection_round(uuid)', 'public.check_assessment_criteria(jsonb)']) f;

-- ---------------------------------------------------------------------------
-- Recommendations in the criteria
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.set_feature(true);
create or replace function pg_temp.criteria(p_recommendations text) returns jsonb language sql as
$$ select ('{"groups": [{"key": "skills", "name": "Skills", "scale": ["Below", "Meets", "Exceeds"],
    "items": [{"key": "passing", "name": "Passing"}, {"key": "catching", "name": "Catching"}]}]'
    || coalesce(', "recommendations": ' || p_recommendations, '') || '}')::jsonb $$;
select pg_temp.works('criteria save with no recommendations, as before',
  $$select public.admin_save_assessment_criteria(pg_temp.criteria(null))$$);
select pg_temp.eq('and are stored with an empty list',
  (select criteria ->> 'recommendations' from public.assessment_criteria_sets where archived_at is null order by created_at limit 1), '[]');
select pg_temp.works('an empty list is the same', $$select public.admin_save_assessment_criteria(pg_temp.criteria('[]'))$$);
select pg_temp.works('and so is null', $$select public.admin_save_assessment_criteria(pg_temp.criteria('null'))$$);
select pg_temp.fails('one recommendation is no choice',
  $$select public.admin_save_assessment_criteria(pg_temp.criteria('["Select"]'))$$);
select pg_temp.fails('nine are too many', $$select public.admin_save_assessment_criteria(
  pg_temp.criteria('["a","b","c","d","e","f","g","h","i"]'))$$);
select pg_temp.fails('two the same are refused, whatever their capitals',
  $$select public.admin_save_assessment_criteria(pg_temp.criteria('["Select", "select "]'))$$);
select pg_temp.fails('a blank one is refused',
  $$select public.admin_save_assessment_criteria(pg_temp.criteria('["Select", "  "]'))$$);
select pg_temp.fails('one over 40 characters is refused', format(
  $$select public.admin_save_assessment_criteria(pg_temp.criteria('["Select", "%s"]'))$$, repeat('x', 41)));
select pg_temp.fails('a number is refused',
  $$select public.admin_save_assessment_criteria(pg_temp.criteria('["Select", 2]'))$$);
select pg_temp.fails('anything but a list is refused',
  $$select public.admin_save_assessment_criteria(pg_temp.criteria('"Select"'))$$);
select pg_temp.works('an admin saves three recommendations, tidied', $$select public.admin_save_assessment_criteria(
  pg_temp.criteria('[" Select ", "Training partner", "Not this time"]'))$$);
select pg_temp.eq('they are stored trimmed, in order',
  (select criteria ->> 'recommendations' from public.assessment_criteria_sets where archived_at is null order by created_at limit 1),
  '["Select", "Training partner", "Not this time"]');
select pg_temp.eq('and the groups are untouched',
  (select criteria #>> '{groups,0,items,1,name}' from public.assessment_criteria_sets where archived_at is null order by created_at limit 1), 'Catching');

-- ---------------------------------------------------------------------------
-- Setting up: a round for the Sample Squad that started 20 days ago and ends
-- in 40. Panel: Casey (11, head coach), Morgan (42, assistant, parent of
-- Jordan 31) and Ola (62, guest). Drew (12)'s check has lapsed.
-- ---------------------------------------------------------------------------

select pg_temp.works('an admin opens a round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Sample selections',
    public.club_today() - 20, public.club_today() + 40)$$);
select pg_temp.eq('the round takes the recommendations with the criteria',
  (select criteria ->> 'recommendations' from public.selection_rounds where name = 'Sample selections'),
  '["Select", "Training partner", "Not this time"]');
select pg_temp.works('an admin adds the guest selector',
  $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.as_member('11');
select pg_temp.works('Casey writes about Kai: passing meets, then exceeds; catching seen',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('32'), 'training', public.club_today() - 3,
      'Early ball', '[{"item_key": "passing", "rating": 2}]'),
    public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('32'), 'game', public.club_today() - 1,
      'Held the feed', '[{"item_key": "passing", "rating": 3}, {"item_key": "catching", "rating": null}]')$$);
select pg_temp.as_member('62');
select pg_temp.works('Ola writes about Kai',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('32'), 'trial', public.club_today(),
      'Strong drive', '[{"item_key": "passing", "rating": 1}]')$$);

-- ---------------------------------------------------------------------------
-- Who may read, write and list summaries, for every kind of member
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || ': reads their summary of Kai', 'pg_temp.reads(pg_temp.round(), ''32'')', kai)
  || E'\n' || pg_temp.m_ok(n, who || ': reads their summary of Jordan', 'pg_temp.reads(pg_temp.round(), ''31'')', jordan)
  || E'\n' || pg_temp.m_ok(n, who || ': lists where summaries stand', 'pg_temp.lists(pg_temp.round())', panel)
  || E'\n' || pg_temp.m_ok(n, who || ': sees who has signed, as an admin', 'pg_temp.admin_reads(pg_temp.round())', admin)
from (values
  ('01', 'an admin', false, false, false, true),
  ('02', 'another admin', false, false, false, true),
  ('11', 'the head coach on the panel', true, true, true, false),
  ('42', 'a coach on the panel who is Jordan''s parent', true, false, true, false),
  ('62', 'a guest selector with a check', true, true, true, false),
  ('12', 'a coach whose check lapsed', false, false, false, false),
  ('13', 'a manager', false, false, false, false),
  ('14', 'a physio', false, false, false, false),
  ('21', 'the committee', false, false, false, false),
  ('31', 'an athlete under 18 in the round', false, false, false, false),
  ('32', 'an adult athlete in the round', false, false, false, false),
  ('41', 'a parent of an athlete in the round', false, false, false, false)
) as v(n, who, kai, jordan, panel, admin);

select pg_temp.m_ok(n, who || ': writes a summary of Kai', 'pg_temp.drafts(pg_temp.round(), ''32'')', kai)
  || E'\n' || pg_temp.m_ok(n, who || ': writes a summary of Jordan', 'pg_temp.drafts(pg_temp.round(), ''31'')', jordan)
from (values
  ('01', 'an admin', false, false),
  ('12', 'a coach whose check lapsed', false, false),
  ('13', 'a manager', false, false),
  ('14', 'a physio', false, false),
  ('21', 'the committee', false, false),
  ('31', 'an athlete under 18 in the round', false, false),
  ('32', 'an adult athlete in the round', false, false),
  ('41', 'a parent of an athlete in the round', false, false),
  ('42', 'a coach on the panel who is Jordan''s parent', true, false)
) as v(n, who, kai, jordan);
select pg_temp.ok('only the one allowed draft was kept', (select count(*) from public.assessment_summaries) = 1, true);
select pg_temp.ok('nobody may write their own', (select count(*) from public.assessment_summaries where athlete_id = author_id) = 0, true);

-- ---------------------------------------------------------------------------
-- What a selector starts from
-- ---------------------------------------------------------------------------

select pg_temp.m_eq('11', 'Casey has no summary of Kai yet',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'mine'$$, null);
select pg_temp.m_eq('11', 'the app is given Casey''s own latest step for each item rated, and nothing for one only seen',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'prefill'$$,
  '[{"rating": 3, "item_key": "passing"}]');
select pg_temp.m_eq('62', 'Ola is given Ola''s own, never Casey''s',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'prefill'$$,
  '[{"rating": 1, "item_key": "passing"}]');
select pg_temp.m_eq('42', 'Morgan, who has rated nothing, is given nothing',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'prefill'$$, '[]');
select pg_temp.m_eq('11', 'with how many observations Casey wrote, and where',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'my_observations'$$,
  '{"game": 1, "other": 0, "total": 2, "trial": 0, "training": 1}');
select pg_temp.m_eq('11', 'and the round''s recommendations',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) #>> '{criteria,recommendations}'$$,
  '["Select", "Training partner", "Not this time"]');

-- ---------------------------------------------------------------------------
-- Drafts and signing
-- ---------------------------------------------------------------------------

select pg_temp.as_member('11');
select pg_temp.works('Casey saves a draft with no recommendation yet',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
    '[{"item_key": "passing", "rating": 3}]', null, ' Reads the play early ', '', '', false)$$);
select pg_temp.eq('it is kept unsigned, tidied, under Casey''s name',
  (select author_name || ' / ' || strengths || ' / ' || (signed_at is null) from public.assessment_summaries
    where id = pg_temp.summary_id('11', '32')), 'Casey Coach / Reads the play early / true');
select pg_temp.works('saving again changes the same summary',
  $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
    '[{"item_key": "passing", "rating": 3}, {"item_key": "catching", "rating": 2}]', 'Select', 'Reads the play early', 'Left hand', '', false)$$);
select pg_temp.ok('there is still one each for Casey and Morgan', (select count(*) from public.assessment_summaries) = 2, true);
select pg_temp.fails('a step outside 1 to 3 is refused', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[{"item_key": "passing", "rating": 4}]', null, '', '', '', false)$$);
select pg_temp.fails('a step with no number is refused', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[{"item_key": "passing", "rating": null}]', null, '', '', '', false)$$);
select pg_temp.fails('a criterion the round doesn''t have is refused', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[{"item_key": "speed", "rating": 2}]', null, '', '', '', false)$$);
select pg_temp.fails('the same criterion twice is refused', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[{"item_key": "passing", "rating": 2}, {"item_key": "passing", "rating": 3}]', null, '', '', '', false)$$);
select pg_temp.fails('steps that aren''t a list are refused', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '{"passing": 2}', null, '', '', '', false)$$);
select pg_temp.fails('a recommendation the round doesn''t list is refused', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[{"item_key": "passing", "rating": 2}]', 'Captain', '', '', '', false)$$);
select pg_temp.fails('a box over 1,000 characters is refused', format($$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[{"item_key": "passing", "rating": 2}]', null, '%s', '', '', false)$$, repeat('x', 1001)));
select pg_temp.fails('signing with no step is refused', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[]', 'Select', 'Good', '', '', true)$$);
select pg_temp.fails('signing with no recommendation is refused, when the round lists them', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[{"item_key": "passing", "rating": 2}]', null, 'Good', '', '', true)$$);
select pg_temp.eq('none of those changed the draft',
  (select recommendation || ' / ' || jsonb_array_length(ratings) from public.assessment_summaries where id = pg_temp.summary_id('11', '32')),
  'Select / 2');

-- Before anyone signs: nobody sees anyone else's.
select pg_temp.m_eq('62', 'Ola sees none of Casey''s draft, and no count of it',
  $$select (j ->> 'others') || ' / ' || (j ->> 'others_signed') from public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) j$$,
  '[] / 0');

select pg_temp.as_member('11');
select pg_temp.works('Casey signs', $$select pg_temp.sign(pg_temp.round(), '32')$$);
select pg_temp.ok('the signing is kept, on time, with who',
  (select count(*) = 1 from public.assessment_summary_events e
    where e.summary_id = pg_temp.summary_id('11', '32') and e.kind = 'signed' and not e.late
      and e.by_id = pg_temp.id('11') and e.by_name = 'Casey Coach'), true);
select pg_temp.fails('a signed summary can''t be changed', $$select pg_temp.sign(pg_temp.round(), '32', 'Not this time')$$);
select pg_temp.fails('or saved as a draft again', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[{"item_key": "passing", "rating": 1}]', 'Not this time', '', '', '', false)$$);
select pg_temp.eq('it stands as signed',
  (select recommendation from public.assessment_summaries where id = pg_temp.summary_id('11', '32')), 'Select');

-- ---------------------------------------------------------------------------
-- Others' summaries show only after signing your own
-- ---------------------------------------------------------------------------

select pg_temp.m_eq('62', 'Ola, who hasn''t signed, is told one selector has signed and shown nothing of it',
  $$select (j ->> 'others') || ' / ' || (j ->> 'others_signed') from public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) j$$,
  '[] / 1');
select pg_temp.m_ok('62', 'nothing Casey wrote in it reaches Ola',
  $$(select j::text !~ 'Reads the play early|Left hand|Signed by 11' from public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) j)$$, true);
select pg_temp.m_eq('11', 'Casey, signed, still sees no drafts: Morgan''s probe stays Morgan''s',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'others'$$, '[]');
select pg_temp.as_member('62');
select pg_temp.works('Ola saves a draft', $$select public.save_assessment_summary(pg_temp.round(), pg_temp.id('32'),
  '[{"item_key": "passing", "rating": 1}]', 'Not this time', '', '', '', false)$$);
select pg_temp.m_eq('62', 'a draft doesn''t open the others'' either',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'others'$$, '[]');
select pg_temp.works('Ola signs', $$select pg_temp.sign(pg_temp.round(), '32', 'Not this time')$$);
select pg_temp.m_eq('62', 'now Ola reads Casey''s signed summary, by name',
  $$select string_agg((o ->> 'author_name') || ': ' || (o ->> 'recommendation') || ' / ' || (o ->> 'strengths') || ' / ' || (o ->> 'priorities'), '; ')
    from jsonb_array_elements(public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) -> 'others') o$$,
  'Casey Coach: Select / Reads the play early / Left hand');
select pg_temp.m_eq('11', 'and Casey reads Ola''s',
  $$select string_agg((o ->> 'author_name') || ': ' || (o ->> 'recommendation'), '; ')
    from jsonb_array_elements(public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) -> 'others') o$$,
  'Ola Selector: Not this time');
select pg_temp.m_eq('42', 'Morgan, with only a draft, still reads neither',
  $$select (j ->> 'others') || ' / ' || (j ->> 'others_signed') from public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) j$$,
  '[] / 2');

-- A summary of Jordan (under 18): Morgan, the parent, never reaches it.
select pg_temp.as_member('11');
select pg_temp.works('Casey signs a summary of Jordan', $$select pg_temp.sign(pg_temp.round(), '31')$$);
select pg_temp.m_ok('42', 'the parent on the panel can''t read Jordan''s summaries', 'pg_temp.reads(pg_temp.round(), ''31'')', false);
select pg_temp.m_eq('42', 'and Jordan isn''t on the parent''s list of summaries',
  $$select string_agg(public.member_display_name(athlete_id) || ' ' || mine || ' ' || signed, ', ') from public.selection_round_summaries(pg_temp.round())$$,
  'Kai Senior draft 2');
select pg_temp.m_eq('11', 'the head coach''s list shows where each stands',
  $$select string_agg(public.member_display_name(athlete_id) || ' ' || mine || ' ' || signed, ', ' order by public.member_display_name(athlete_id))
    from public.selection_round_summaries(pg_temp.round())$$,
  'Jordan Junior signed 1, Kai Senior signed 2');
select pg_temp.m_eq('62', 'and the guest''s shows nothing started for Jordan',
  $$select string_agg(public.member_display_name(athlete_id) || ' ' || mine || ' ' || signed, ', ' order by public.member_display_name(athlete_id))
    from public.selection_round_summaries(pg_temp.round())$$,
  'Jordan Junior none 1, Kai Senior signed 2');

-- Opening an under 18's summary is recorded; an adult's isn't.
select pg_temp.ok('opening Jordan''s summary went in Jordan''s record views', pg_temp.views('31') > 0, true);
select pg_temp.ok('nothing is recorded for Kai, an adult', pg_temp.views('32') = 0, true);

-- ---------------------------------------------------------------------------
-- Reopening
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || ': reopens Ola''s summary of Kai', 'pg_temp.reopens(''62'', ''32'')', false)
from (values
  ('62', 'the guest who signed it'),
  ('42', 'an assistant coach on the panel'),
  ('12', 'a coach whose check lapsed'),
  ('13', 'a manager'), ('14', 'a physio'), ('21', 'the committee'),
  ('31', 'an athlete under 18'), ('32', 'the athlete it is about'), ('41', 'a parent')
) as v(n, who);
select pg_temp.ok('it is still signed', (select signed_at is not null from public.assessment_summaries where id = pg_temp.summary_id('62', '32')), true);
select pg_temp.m_eq('11', 'the head coach is told they can reopen',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'can_reopen'$$, 'true');
select pg_temp.m_eq('62', 'the guest is told they can''t',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'can_reopen'$$, 'false');
select pg_temp.m_ok('11', 'the head coach reopens Ola''s summary of Kai', 'pg_temp.reopens(''62'', ''32'')', true);
select pg_temp.ok('it is unsigned, with its words kept',
  (select signed_at is null and recommendation = 'Not this time' from public.assessment_summaries where id = pg_temp.summary_id('62', '32')), true);
select pg_temp.ok('the reopening is kept with who did it',
  (select count(*) = 1 from public.assessment_summary_events e
    where e.summary_id = pg_temp.summary_id('62', '32') and e.kind = 'reopened' and e.by_name = 'Casey Coach'), true);
select pg_temp.m_ok('11', 'a summary that isn''t signed can''t be reopened', 'pg_temp.reopens(''62'', ''32'')', false);
select pg_temp.m_eq('62', 'Ola is told who reopened it, and no longer reads Casey''s',
  $$select (j #>> '{last_reopened,by_name}') || ' / ' || (j ->> 'others') from public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) j$$,
  'Casey Coach / []');
select pg_temp.m_eq('11', 'and Casey no longer reads Ola''s',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'others'$$, '[]');
select pg_temp.as_member('62');
select pg_temp.works('Ola changes it and signs again', $$select pg_temp.sign(pg_temp.round(), '32', 'Training partner')$$);
select pg_temp.ok('both signings are kept',
  (select count(*) = 2 from public.assessment_summary_events e where e.summary_id = pg_temp.summary_id('62', '32') and e.kind = 'signed'), true);
select pg_temp.m_ok('01', 'an admin reopens Casey''s own summary of Kai', 'pg_temp.reopens(''11'', ''32'')', true);
select pg_temp.m_ok('11', 'and the head coach can reopen their own', 'true', true);
select pg_temp.as_member('11');
select pg_temp.works('Casey signs again', $$select pg_temp.sign(pg_temp.round(), '32')$$);
select pg_temp.m_ok('11', 'the head coach reopens their own', 'pg_temp.reopens(''11'', ''32'')', true);
select pg_temp.works('and signs once more', $$select pg_temp.sign(pg_temp.round(), '32')$$);
select pg_temp.as_member('01');
select pg_temp.fails('reopening a summary that doesn''t exist is refused',
  $$select public.reopen_assessment_summary('00000000-0000-0000-0000-00000000dead')$$);

-- ---------------------------------------------------------------------------
-- What an admin is shown: who signed for whom and when, never what
-- ---------------------------------------------------------------------------

select pg_temp.m_eq('01', 'each selector''s counts: athletes they can assess, signed, drafts, reopened',
  $$select string_agg((s ->> 'name') || ' ' || (s ->> 'athletes') || '/' || (s ->> 'signed') || '/' || (s ->> 'drafts') || '/' || (s ->> 'reopened'), ', ' order by s ->> 'name')
    from jsonb_array_elements(public.admin_selection_summaries(pg_temp.round()) -> 'selectors') s$$,
  'Casey Coach 2/2/0/2, Morgan Coach-Parent 1/0/1/0, Ola Selector 2/1/0/1');
select pg_temp.m_eq('01', 'every signed summary by selector and athlete',
  $$select string_agg((s ->> 'selector_name') || ' > ' || (s ->> 'athlete_name') || ' ' || (s ->> 'late'), ', ')
    from jsonb_array_elements(public.admin_selection_summaries(pg_temp.round()) -> 'signed') s$$,
  'Casey Coach > Jordan Junior false, Casey Coach > Kai Senior false, Ola Selector > Kai Senior false');
select pg_temp.m_eq('01', 'and every reopening, with who did it',
  $$select string_agg((s ->> 'selector_name') || ' > ' || (s ->> 'athlete_name') || ' by ' || (s ->> 'by_name'), ', ')
    from jsonb_array_elements(public.admin_selection_summaries(pg_temp.round()) -> 'reopenings') s$$,
  'Ola Selector > Kai Senior by Casey Coach, Casey Coach > Kai Senior by Alex Admin, Casey Coach > Kai Senior by Casey Coach');
select pg_temp.m_ok('01', 'no step, recommendation or word of a summary is in it',
  $$(select j::text !~* 'Reads the play|Left hand|Signed by|Training partner|Not this time|"Select"|rating|passing|Probe'
     from public.admin_selection_summaries(pg_temp.round()) j)$$, true);
select pg_temp.m_eq('01', 'its keys are these only',
  $$select string_agg(k, ', ' order by k) from jsonb_object_keys(public.admin_selection_summaries(pg_temp.round())) k$$,
  'closed, ends_on, reopenings, selectors, signed');
select pg_temp.m_ok('01', 'an admin off the panel still can''t read a summary', 'pg_temp.reads(pg_temp.round(), ''32'')', false);
select pg_temp.as_member('01');
select pg_temp.fails('a round that doesn''t exist is refused',
  $$select public.admin_selection_summaries('00000000-0000-0000-0000-00000000dead')$$);

-- ---------------------------------------------------------------------------
-- To-dos: summaries still to sign
-- ---------------------------------------------------------------------------

select pg_temp.m_eq('62', 'with 40 days to go there is no to-do yet', 'pg_temp.todo(''summaries'')', 'none');
update public.selection_rounds set ends_on = public.club_today() + 8 where name = 'Sample selections';
select pg_temp.m_eq('62', 'nor with 8 days to go', 'pg_temp.todo(''summaries'')', 'none');
update public.selection_rounds set ends_on = public.club_today() + 7 where name = 'Sample selections';
select pg_temp.m_eq('62', 'from 7 days before the last day, the guest has one athlete to sign for', 'pg_temp.todo(''summaries'')', '1');
select pg_temp.m_eq('42', 'the parent on the panel has one too: a draft isn''t signed, and their child never counts', 'pg_temp.todo(''summaries'')', '1');
select pg_temp.m_eq('11', 'the head coach, who has signed both, has none', 'pg_temp.todo(''summaries'')', 'none');
select pg_temp.m_eq(n, who || ' gets no summaries to-do', 'pg_temp.todo(''summaries'')', 'none')
from (values ('01', 'an admin'), ('12', 'a coach whose check lapsed'), ('13', 'a manager'), ('21', 'the committee'),
  ('31', 'an athlete'), ('41', 'a parent')) as v(n, who);
select pg_temp.m_eq('62', 'it is due on the round''s last day',
  $$select (due_on - public.club_today())::text from public.my_selection_todos() where kind = 'summaries'$$, '7');
update public.selection_rounds set ends_on = public.club_today() - 2 where name = 'Sample selections';
select pg_temp.m_eq('62', 'it stays after the last day, until the round is closed', 'pg_temp.todo(''summaries'')', '1');

-- Signed after the last day: late.
select pg_temp.as_member('62');
select pg_temp.works('the guest signs for Jordan after the last day', $$select pg_temp.sign(pg_temp.round(), '31')$$);
select pg_temp.ok('that signing is marked late',
  (select e.late from public.assessment_summary_events e where e.summary_id = pg_temp.summary_id('62', '31')), true);
select pg_temp.m_eq('01', 'and the admin''s counts say so',
  $$select string_agg((s ->> 'name') || ' ' || (s ->> 'signed_late'), ', ' order by s ->> 'name')
    from jsonb_array_elements(public.admin_selection_summaries(pg_temp.round()) -> 'selectors') s$$,
  'Casey Coach 0, Morgan Coach-Parent 0, Ola Selector 1');
select pg_temp.m_eq('62', 'with everything signed the guest''s to-do goes', 'pg_temp.todo(''summaries'')', 'none');
select pg_temp.m_eq('11', 'the dates and thin-evidence to-dos still work beside it',
  $$select count(*)::text from public.my_selection_todos() where kind not in ('summaries')$$, '0');

-- ---------------------------------------------------------------------------
-- A closed round, the feature off, and people who leave
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), true);
select pg_temp.m_ok('42', 'nothing is saved in a closed round', 'pg_temp.drafts(pg_temp.round(), ''32'')', false);
select pg_temp.m_ok('11', 'nothing is reopened in a closed round', 'pg_temp.reopens(''62'', ''32'')', false);
select pg_temp.m_ok('01', 'not even by an admin', 'pg_temp.reopens(''62'', ''32'')', false);
select pg_temp.m_eq('11', 'the head coach is told they can''t reopen now',
  $$select public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) ->> 'can_reopen'$$, 'false');
select pg_temp.m_ok('11', 'the panel still reads it', 'pg_temp.reads(pg_temp.round(), ''32'')', true);
select pg_temp.m_eq('42', 'a closed round gives no to-do', 'pg_temp.todo(''summaries'')', 'none');
select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), false);

select pg_temp.set_feature(false);
select pg_temp.m_ok(n, who || ': nothing opens while the feature is off',
  'pg_temp.reads(pg_temp.round(), ''32'') or pg_temp.drafts(pg_temp.round(), ''32'') or pg_temp.lists(pg_temp.round())
   or pg_temp.admin_reads(pg_temp.round()) or pg_temp.reopens(''62'', ''32'')', false)
from (values ('01', 'an admin'), ('11', 'the head coach'), ('62', 'the guest selector')) as v(n, who);
select pg_temp.set_feature(true);

-- Taken off the panel: no access, and what they signed stays.
select pg_temp.as_member('01');
select public.admin_remove_selection_panel_member(pg_temp.round(), pg_temp.id('62'));
select pg_temp.m_ok('62', 'a selector taken off the panel reads nothing', 'pg_temp.reads(pg_temp.round(), ''32'')', false);
select pg_temp.m_eq('11', 'their signed summary is still read by the panel',
  $$select string_agg(o ->> 'author_name', ', ') from jsonb_array_elements(public.my_assessment_summary(pg_temp.round(), pg_temp.id('32')) -> 'others') o$$,
  'Ola Selector');
select pg_temp.m_eq('01', 'and still counted for the admin, as no longer on the panel',
  $$select string_agg((s ->> 'name') || ' ' || (s ->> 'on_panel') || ' ' || (s ->> 'signed'), ', ' order by s ->> 'name')
    from jsonb_array_elements(public.admin_selection_summaries(pg_temp.round()) -> 'selectors') s$$,
  'Casey Coach true 2, Morgan Coach-Parent true 0, Ola Selector false 2');

-- The clean-up removes a round's summaries and their history with it.
update public.selection_rounds set starts_on = public.club_today() - 800,
  ends_on = (public.club_today() - interval '13 months')::date, closed_at = now() - interval '13 months'
where name = 'Sample selections';
update public.club_settings set retention_enabled = true where id;
select pg_temp.eq('the nightly clean-up removes the old round', public.purge_expired_assessments() ->> 'selection_rounds', '1');
select pg_temp.ok('with every summary and its history',
  (select count(*) from public.assessment_summaries) = 0 and (select count(*) from public.assessment_summary_events) = 0, true);
update public.club_settings set retention_enabled = false where id;
