-- Tests for 20261123400000_selection_feedback.sql: feedback the head coach
-- writes for an athlete and chooses to share, who reads it and when, taking
-- it back, the first read, and the record an admin is shown. Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
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
$$ begin perform public.athlete_feedback(p_round, pg_temp.id(n)); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.writes(p_round uuid, n text, p_share boolean default false) returns boolean language plpgsql as
$$ begin perform public.save_assessment_feedback(p_round, pg_temp.id(n), 'Probe well', 'Probe work', p_share); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.withdraws(p_round uuid, n text) returns boolean language plpgsql as
$$ begin perform public.withdraw_assessment_feedback(p_round, pg_temp.id(n)); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.lists(p_round uuid) returns boolean language plpgsql as
$$ begin perform public.selection_round_feedback(p_round); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.admin_reads(p_round uuid) returns boolean language plpgsql as
$$ begin perform public.admin_selection_feedback(p_round); return true;
   exception when others then return false; end $$;
-- What the signed-in member is shown under Selection: "athlete: well / work".
create or replace function pg_temp.mine() returns text language sql as
$$ select coalesce(string_agg(athlete_name || ': ' || went_well || ' / ' || work_on, '; ' order by athlete_name), 'nothing')
   from public.my_selection_feedback() $$;
create or replace function pg_temp.row_of(athlete text) returns public.assessment_feedback language sql as
$$ select f from public.assessment_feedback f where f.athlete_id = pg_temp.id(athlete) $$;
create or replace function pg_temp.events(athlete text) returns text language sql as
$$ select coalesce(string_agg(e.kind || ' by ' || e.by_name, ', ' order by e.at, e.kind), 'none')
   from public.assessment_feedback_events e join public.assessment_feedback f on f.id = e.feedback_id
   where f.athlete_id = pg_temp.id(athlete) $$;
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
from unnest(array['assessment_feedback', 'assessment_feedback_events']) t;
select pg_temp.ok('anon cannot call ' || f, has_function_privilege('anon', f, 'execute'), false)
  || E'\n' || pg_temp.ok('signed-in members can call ' || f, has_function_privilege('authenticated', f, 'execute'), true)
from unnest(array[
  'public.athlete_feedback(uuid, uuid)',
  'public.save_assessment_feedback(uuid, uuid, text, text, boolean)',
  'public.withdraw_assessment_feedback(uuid, uuid)', 'public.selection_round_feedback(uuid)',
  'public.my_selection_feedback()', 'public.mark_selection_feedback_seen(uuid, uuid)',
  'public.admin_selection_feedback(uuid)']) f;

-- ---------------------------------------------------------------------------
-- Setting up: a round for the Sample Squad. Panel: Casey (11, head coach),
-- Morgan (42, assistant, parent of Jordan 31) and Ola (62, guest). Jordan
-- (31) is under 18 with Logan (41) and Morgan as parents; Kai (32) is an
-- adult.
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.set_feature(true);
select pg_temp.works('an admin saves criteria', $$select public.admin_save_assessment_criteria(
  '{"groups": [{"key": "skills", "name": "Skills", "scale": ["Below", "Meets", "Exceeds"],
    "items": [{"key": "passing", "name": "Passing"}]}]}'::jsonb)$$);
select pg_temp.works('and opens a round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Sample selections',
    public.club_today() - 20, public.club_today() + 40)$$);
select pg_temp.works('and adds the guest selector',
  $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);

-- ---------------------------------------------------------------------------
-- Who may read, write, share and take back, for every kind of member, with
-- nothing written yet
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || ': opens Kai''s feedback', 'pg_temp.reads(pg_temp.round(), ''32'')', kai)
  || E'\n' || pg_temp.m_ok(n, who || ': opens Jordan''s feedback', 'pg_temp.reads(pg_temp.round(), ''31'')', jordan)
  || E'\n' || pg_temp.m_ok(n, who || ': lists where feedback stands', 'pg_temp.lists(pg_temp.round())', panel)
  || E'\n' || pg_temp.m_ok(n, who || ': sees the feedback record, as an admin', 'pg_temp.admin_reads(pg_temp.round())', admin)
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

select pg_temp.m_ok(n, who || ': saves feedback for Kai', 'pg_temp.writes(pg_temp.round(), ''32'')', false)
  || E'\n' || pg_temp.m_ok(n, who || ': shares feedback for Jordan', 'pg_temp.writes(pg_temp.round(), ''31'', true)', false)
  || E'\n' || pg_temp.m_ok(n, who || ': takes feedback back', 'pg_temp.withdraws(pg_temp.round(), ''32'')', false)
from (values
  ('01', 'an admin'),
  ('42', 'an assistant coach on the panel'),
  ('62', 'a guest selector'),
  ('12', 'a coach whose check lapsed'),
  ('13', 'a manager'),
  ('14', 'a physio'),
  ('21', 'the committee'),
  ('31', 'an athlete under 18 in the round'),
  ('32', 'an adult athlete in the round'),
  ('41', 'a parent of an athlete in the round')
) as v(n, who);
select pg_temp.ok('none of them left a row', (select count(*) from public.assessment_feedback) = 0, true);
select pg_temp.m_eq('11', 'the head coach is told they can write', $$select public.athlete_feedback(pg_temp.round(), pg_temp.id('32')) ->> 'can_write'$$, 'true');
select pg_temp.m_eq('62', 'the guest is told they can''t', $$select public.athlete_feedback(pg_temp.round(), pg_temp.id('32')) ->> 'can_write'$$, 'false');
select pg_temp.m_eq('11', 'and that Jordan is under 18, so parents will read it', $$select public.athlete_feedback(pg_temp.round(), pg_temp.id('31')) ->> 'is_minor'$$, 'true');
select pg_temp.m_eq('11', 'and that Kai is an adult', $$select public.athlete_feedback(pg_temp.round(), pg_temp.id('32')) ->> 'is_minor'$$, 'false');
select pg_temp.m_eq('11', 'with nothing written there is no feedback', $$select public.athlete_feedback(pg_temp.round(), pg_temp.id('32')) ->> 'feedback'$$, null);

-- ---------------------------------------------------------------------------
-- A draft: only the head coach's
-- ---------------------------------------------------------------------------

select pg_temp.as_member('11');
select pg_temp.works('the head coach saves a draft for Kai',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('32'), '  Strong hands ', ' Left side  ', false)$$);
select pg_temp.eq('it is kept tidied, unshared, under their name',
  (select went_well || ' / ' || work_on || ' / ' || author_name || ' / ' || (shared_at is null) from pg_temp.row_of('32')),
  'Strong hands / Left side / Casey Coach / true');
select pg_temp.works('saving again changes the same one',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('32'), 'Strong hands', 'Left side passing', null)$$);
select pg_temp.ok('there is one row', (select count(*) from public.assessment_feedback) = 1, true);
select pg_temp.fails('a box over 1,000 characters is refused', format(
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('32'), '%s', '', false)$$, repeat('x', 1001)));
select pg_temp.fails('an athlete who isn''t in the round is refused',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('41'), 'a', 'b', false)$$);
select pg_temp.fails('the head coach can''t write their own',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('11'), 'a', 'b', false)$$);
select pg_temp.fails('a draft can''t be taken back', $$select public.withdraw_assessment_feedback(pg_temp.round(), pg_temp.id('32'))$$);
select pg_temp.eq('a draft leaves no history', pg_temp.events('32'), 'none');
select pg_temp.m_eq('11', 'the head coach reads their draft',
  $$select public.athlete_feedback(pg_temp.round(), pg_temp.id('32')) #>> '{feedback,work_on}'$$, 'Left side passing');
select pg_temp.m_eq(n, who || ' sees no draft', $$select public.athlete_feedback(pg_temp.round(), pg_temp.id('32')) ->> 'feedback'$$, null)
  || E'\n' || pg_temp.m_eq(n, who || ' has no draft on the list', $$select count(*) from public.selection_round_feedback(pg_temp.round())$$, '0')
from (values ('42', 'the assistant coach'), ('62', 'the guest selector')) as v(n, who);
select pg_temp.m_eq('11', 'the head coach''s list shows the draft',
  $$select string_agg(public.member_display_name(athlete_id) || ' ' || state || ' ' || seen, ', ') from public.selection_round_feedback(pg_temp.round())$$,
  'Kai Senior draft false');
select pg_temp.m_eq('32', 'the athlete is shown nothing of a draft', 'pg_temp.mine()', 'nothing');
select pg_temp.m_eq('01', 'a draft is not in the admin''s record',
  $$select public.admin_selection_feedback(pg_temp.round()) ->> 'shared'$$, '[]');

-- ---------------------------------------------------------------------------
-- Sharing
-- ---------------------------------------------------------------------------

select pg_temp.as_member('11');
select pg_temp.fails('sharing with nothing written is refused',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('31'), '  ', '', true)$$);
select pg_temp.ok('and leaves no row for Jordan', (select count(*) from public.assessment_feedback where athlete_id = pg_temp.id('31')) = 0, true);
select pg_temp.works('the head coach shares Kai''s',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('32'), 'Strong hands', 'Left side passing', true)$$);
select pg_temp.works('and writes and shares Jordan''s in one go, with one box filled',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('31'), 'Reads the play', '', true)$$);
select pg_temp.eq('the sharing is kept with who did it', pg_temp.events('32'), 'shared by Casey Coach');
select pg_temp.fails('shared feedback can''t be changed',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('32'), 'Changed', 'Changed', false)$$);
select pg_temp.fails('or shared again',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('32'), 'Changed', 'Changed', true)$$);
select pg_temp.eq('it stands as shared', (select went_well from pg_temp.row_of('32')), 'Strong hands');

-- Who is shown what under Selection, for every kind of member.
select pg_temp.m_eq(n, who || ' is shown under Selection', 'pg_temp.mine()', shown)
from (values
  ('32', 'Kai, an adult athlete,', 'Kai Senior: Strong hands / Left side passing'),
  ('31', 'Jordan, under 18,', 'Jordan Junior: Reads the play / '),
  ('41', 'Jordan''s parent', 'Jordan Junior: Reads the play / '),
  ('42', 'Jordan''s parent on the panel', 'Jordan Junior: Reads the play / '),
  ('01', 'an admin', 'nothing'),
  ('11', 'the head coach who wrote it', 'nothing'),
  ('62', 'the guest selector', 'nothing'),
  ('12', 'a coach whose check lapsed', 'nothing'),
  ('13', 'a manager', 'nothing'),
  ('14', 'a physio', 'nothing'),
  ('21', 'the committee', 'nothing')
) as v(n, who, shown);
select pg_temp.m_eq('31', 'the athlete is told who it is from, the round, and that it is theirs',
  $$select from_name || ' / ' || round_name || ' / ' || is_me || ' / ' || (shared_on = public.club_today()) from public.my_selection_feedback()$$,
  'Casey Coach / Sample selections / true / true');
select pg_temp.m_eq('41', 'a parent is told it is their child''s',
  $$select athlete_name || ' / ' || is_me from public.my_selection_feedback()$$, 'Jordan Junior / false');

-- The panel reads shared feedback; the parent on the panel still not through the panel.
select pg_temp.m_eq('62', 'the guest selector now reads Kai''s shared feedback',
  $$select (j #>> '{feedback,went_well}') || ' / ' || (j #>> '{feedback,author_name}') from public.athlete_feedback(pg_temp.round(), pg_temp.id('32')) j$$,
  'Strong hands / Casey Coach');
select pg_temp.m_ok('42', 'the parent on the panel still can''t open Jordan''s assessment', 'pg_temp.reads(pg_temp.round(), ''31'')', false);
select pg_temp.m_eq('42', 'and their list leaves Jordan out',
  $$select string_agg(public.member_display_name(athlete_id) || ' ' || state, ', ') from public.selection_round_feedback(pg_temp.round())$$,
  'Kai Senior shared');
select pg_temp.m_eq('62', 'the guest''s list shows both',
  $$select string_agg(public.member_display_name(athlete_id) || ' ' || state || ' ' || seen, ', ' order by public.member_display_name(athlete_id))
    from public.selection_round_feedback(pg_temp.round())$$,
  'Jordan Junior shared false, Kai Senior shared false');

-- Opening an under 18's feedback is recorded; an adult's isn't.
select pg_temp.ok('opening Jordan''s feedback went in Jordan''s record views', pg_temp.views('31') > 0, true);
select pg_temp.ok('nothing is recorded for Kai, an adult', pg_temp.views('32') = 0, true);

-- ---------------------------------------------------------------------------
-- The first read
-- ---------------------------------------------------------------------------

select pg_temp.as_member(n) || pg_temp.works(who || ' marking Jordan''s as read changes nothing',
  $$select public.mark_selection_feedback_seen(pg_temp.round(), pg_temp.id('31'))$$)
from (values ('01', 'an admin'), ('11', 'the head coach'), ('62', 'a selector'), ('13', 'a manager'),
  ('21', 'the committee'), ('32', 'another athlete'), ('14', 'a physio'), ('12', 'a coach whose check lapsed')) as v(n, who);
select pg_temp.ok('Jordan''s is still unread', (select seen_at is null from pg_temp.row_of('31')), true);
select pg_temp.as_member('41');
select pg_temp.works('Jordan''s parent reads it', $$select public.mark_selection_feedback_seen(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.ok('the first read is kept', (select seen_at is not null from pg_temp.row_of('31')), true);
update public.assessment_feedback set seen_at = now() - interval '2 days' where athlete_id = pg_temp.id('31');
select pg_temp.as_member('31');
select pg_temp.works('Jordan reads it later', $$select public.mark_selection_feedback_seen(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.ok('the first read stays the first', (select seen_at < now() - interval '1 day' from pg_temp.row_of('31')), true);
select pg_temp.ok('Kai''s is untouched by that', (select seen_at is null from pg_temp.row_of('32')), true);
select pg_temp.m_eq('11', 'the head coach''s list says Jordan''s was read',
  $$select string_agg(public.member_display_name(athlete_id) || ' ' || seen, ', ' order by public.member_display_name(athlete_id))
    from public.selection_round_feedback(pg_temp.round())$$,
  'Jordan Junior true, Kai Senior false');
select pg_temp.m_ok('11', 'and so does the feedback itself',
  $$(select (j #>> '{feedback,seen_at}') is not null from public.athlete_feedback(pg_temp.round(), pg_temp.id('31')) j)$$, true);

-- ---------------------------------------------------------------------------
-- Taking back
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || ': takes Jordan''s shared feedback back', 'pg_temp.withdraws(pg_temp.round(), ''31'')', false)
from (values ('01', 'an admin'), ('42', 'Jordan''s parent on the panel'), ('62', 'a guest selector'), ('13', 'a manager'),
  ('21', 'the committee'), ('31', 'the athlete'), ('41', 'a parent'), ('12', 'a coach whose check lapsed'), ('14', 'a physio')) as v(n, who);
select pg_temp.ok('it is still shared', (select shared_at is not null from pg_temp.row_of('31')), true);
select pg_temp.m_ok('11', 'the head coach takes it back', 'pg_temp.withdraws(pg_temp.round(), ''31'')', true);
select pg_temp.ok('it is a draft again, unread, with its words kept',
  (select shared_at is null and seen_at is null and went_well = 'Reads the play' from pg_temp.row_of('31')), true);
select pg_temp.eq('both steps are kept', pg_temp.events('31'), 'shared by Casey Coach, withdrawn by Casey Coach');
select pg_temp.m_ok('11', 'it can''t be taken back twice', 'pg_temp.withdraws(pg_temp.round(), ''31'')', false);
select pg_temp.m_eq(n, who || ' no longer sees it', 'pg_temp.mine()', 'nothing')
from (values ('31', 'Jordan'), ('41', 'Jordan''s parent'), ('42', 'Jordan''s parent on the panel')) as v(n, who);
select pg_temp.m_eq('62', 'nor does the rest of the panel',
  $$select public.athlete_feedback(pg_temp.round(), pg_temp.id('31')) ->> 'feedback'$$, null);
select pg_temp.as_member('41');
select pg_temp.works('reading feedback that was taken back records nothing',
  $$select public.mark_selection_feedback_seen(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.ok('it stays unread', (select seen_at is null from pg_temp.row_of('31')), true);
select pg_temp.as_member('11');
select pg_temp.works('the head coach changes it and shares it again',
  $$select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('31'), 'Reads the play early', 'Footwork', true)$$);
select pg_temp.m_eq('41', 'the parent sees the new words', 'pg_temp.mine()', 'Jordan Junior: Reads the play early / Footwork');
select pg_temp.ok('and it is unread until someone opens it', (select seen_at is null from pg_temp.row_of('31')), true);

-- ---------------------------------------------------------------------------
-- What an admin is shown: who was given feedback and when, never the words
-- ---------------------------------------------------------------------------

select pg_temp.as_member('32');
select public.mark_selection_feedback_seen(pg_temp.round(), pg_temp.id('32'));
select pg_temp.m_eq('01', 'each athlete given feedback: shared, by whom, read, times taken back',
  $$select string_agg((s ->> 'athlete_name') || ' ' || ((s ->> 'shared_at') is not null) || ' ' || (s ->> 'shared_by_name')
      || ' ' || ((s ->> 'seen_at') is not null) || ' ' || (s ->> 'withdrawn'), ', ')
    from jsonb_array_elements(public.admin_selection_feedback(pg_temp.round()) -> 'shared') s$$,
  'Jordan Junior true Casey Coach false 1, Kai Senior true Casey Coach true 0');
select pg_temp.m_eq('01', 'and how many athletes are in the round',
  $$select public.admin_selection_feedback(pg_temp.round()) ->> 'athletes'$$,
  (select count(*)::text from public.team_members where team_id = pg_temp.id('a1') and team_role = 'athlete'));
select pg_temp.m_ok('01', 'no word of any feedback is in it',
  $$(select j::text !~* 'Strong hands|Left side|Reads the play|Footwork|went_well|work_on' from public.admin_selection_feedback(pg_temp.round()) j)$$, true);
select pg_temp.m_eq('01', 'its keys are these only',
  $$select string_agg(k, ', ' order by k) from jsonb_object_keys(public.admin_selection_feedback(pg_temp.round())) k$$,
  'athletes, shared');
select pg_temp.m_eq('01', 'each row''s keys are these only',
  $$select string_agg(k, ', ' order by k) from jsonb_object_keys(public.admin_selection_feedback(pg_temp.round()) #> '{shared,0}') k$$,
  'athlete_name, seen_at, shared_at, shared_by_name, withdrawn');
select pg_temp.ok('building the record went in an under 18''s record views',
  (select count(*) from public.record_access_log l where l.subject_id = pg_temp.id('31') and l.kind = 'assessment_audit') > 0, true);
select pg_temp.as_member('11');
select public.withdraw_assessment_feedback(pg_temp.round(), pg_temp.id('32'));
select pg_temp.m_eq('01', 'feedback taken back stays in the record, as not shared now',
  $$select string_agg((s ->> 'athlete_name') || ' ' || ((s ->> 'shared_at') is not null) || ' ' || (s ->> 'withdrawn'), ', ')
    from jsonb_array_elements(public.admin_selection_feedback(pg_temp.round()) -> 'shared') s$$,
  'Jordan Junior true 1, Kai Senior false 1');
select pg_temp.as_member('01');
select pg_temp.fails('a round that doesn''t exist is refused',
  $$select public.admin_selection_feedback('00000000-0000-0000-0000-00000000dead')$$);
select pg_temp.as_member('11');
select public.save_assessment_feedback(pg_temp.round(), pg_temp.id('32'), 'Strong hands', 'Left side passing', true);

-- ---------------------------------------------------------------------------
-- A closed round, the feature off, and people who leave
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), true);
select pg_temp.m_ok('11', 'nothing is taken back in a closed round', 'pg_temp.withdraws(pg_temp.round(), ''32'')', false);
select pg_temp.m_ok('11', 'and nothing is written', 'pg_temp.writes(pg_temp.round(), ''32'')', false);
select pg_temp.m_eq('11', 'the head coach is told they can''t write now',
  $$select public.athlete_feedback(pg_temp.round(), pg_temp.id('32')) ->> 'can_write'$$, 'false');
select pg_temp.m_eq('32', 'the athlete still reads feedback from a closed round', 'pg_temp.mine()', 'Kai Senior: Strong hands / Left side passing');
select pg_temp.m_eq('41', 'and so does a parent', 'pg_temp.mine()', 'Jordan Junior: Reads the play early / Footwork');
select pg_temp.as_member('31');
select pg_temp.works('a first read in a closed round is still kept',
  $$select public.mark_selection_feedback_seen(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.ok('it was', (select seen_at is not null from pg_temp.row_of('31')), true);
select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), false);

select pg_temp.set_feature(false);
select pg_temp.m_ok(n, who || ': nothing opens while the feature is off',
  'pg_temp.reads(pg_temp.round(), ''32'') or pg_temp.writes(pg_temp.round(), ''32'') or pg_temp.lists(pg_temp.round())
   or pg_temp.admin_reads(pg_temp.round()) or pg_temp.withdraws(pg_temp.round(), ''32'') or pg_temp.mine() <> ''nothing''', false)
from (values ('01', 'an admin'), ('11', 'the head coach'), ('62', 'the guest selector'), ('32', 'an athlete'), ('41', 'a parent')) as v(n, who);
update public.assessment_feedback set seen_at = null where athlete_id = pg_temp.id('32');
select pg_temp.as_member('32');
select public.mark_selection_feedback_seen(pg_temp.round(), pg_temp.id('32'));
select pg_temp.ok('and no read is recorded', (select seen_at is null from pg_temp.row_of('32')), true);
select pg_temp.set_feature(true);

-- A parent who isn't verified, and one who is no longer a parent.
update public.profiles set verified_at = null where id = pg_temp.id('41');
select pg_temp.m_eq('41', 'a parent who isn''t verified is shown nothing', 'pg_temp.mine()', 'nothing');
select pg_temp.as_member('41');
update public.assessment_feedback set seen_at = null where athlete_id = pg_temp.id('31');
select public.mark_selection_feedback_seen(pg_temp.round(), pg_temp.id('31'));
select pg_temp.ok('and can''t mark it read', (select seen_at is null from pg_temp.row_of('31')), true);
update public.profiles set verified_at = now() where id = pg_temp.id('41');
select pg_temp.m_eq('41', 'verified again, it is back', 'pg_temp.mine()', 'Jordan Junior: Reads the play early / Footwork');

-- The head coach leaves: the feedback stays, under the name it was written with.
select pg_temp.as_member('01');
update public.assessment_feedback set author_id = null where athlete_id = pg_temp.id('32');
select pg_temp.m_eq('32', 'feedback whose author has gone keeps their name',
  $$select from_name from public.my_selection_feedback()$$, 'Casey Coach');

-- The clean-up removes a round's feedback and its history with it.
update public.selection_rounds set starts_on = public.club_today() - 800,
  ends_on = (public.club_today() - interval '13 months')::date, closed_at = now() - interval '13 months'
where name = 'Sample selections';
update public.club_settings set retention_enabled = true where id;
select pg_temp.eq('the nightly clean-up removes the old round', public.purge_expired_assessments() ->> 'selection_rounds', '1');
select pg_temp.ok('with all feedback and its history',
  (select count(*) from public.assessment_feedback) = 0 and (select count(*) from public.assessment_feedback_events) = 0, true);
update public.club_settings set retention_enabled = false where id;
