-- Surveys (migration 20261017100000): committee and admins make anonymous,
-- named or optional-name surveys for everyone, a role or a squad or team.
-- Anonymous answers never carry who gave them; results only for committee
-- and admins; parents get a copy for their child under 18 and read only named
-- answers. Coaches and managers send to their own groups and the committee
-- sees those only when shared; captains send choice-only polls that their
-- group's coaches and managers can see. Run after the migrations and
-- seed-members.sql. Raises on any failure.

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
set role authenticated;

-- Members can't read the tables directly.
do $$ begin
  begin
    perform 1 from public.survey_responses;
    raise exception 'survey_responses readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.survey_recipients;
    raise exception 'survey_recipients readable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- An athlete can't make a survey.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000032';
do $$ begin
  begin
    perform public.create_survey('Nope', null, 'anonymous', 'club', null, null, null, now() + interval '7 days',
      '[{"kind":"text","prompt":"Hi"}]');
    raise exception 'athlete made a survey';
  exception when others then
    if sqlerrm not like 'Only the committee%' then raise; end if;
  end;
end $$;

-- The admin sends an anonymous survey to the squad.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into ids values ('anon', public.create_survey(
  'End of season', 'Tell us how it went', 'anonymous', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"rating","prompt":"How was training?","rating_max":5},
    {"kind":"choice","prompt":"Best night","options":["Tuesday","Thursday"]},
    {"kind":"multi_choice","prompt":"What helped","options":["Drills","Games","Fitness"],"required":false},
    {"kind":"text","prompt":"Anything else?","required":false}]'));

reset role;
do $$
declare v uuid := (select v from ids where k = 'anon');
begin
  -- Coaches 11, 12, 42, manager 13, physio 14, athletes 31, 32, and parent 41's copy.
  if (select count(*) from public.survey_recipients where survey_id = v) <> 8 then
    raise exception 'expected 8 recipients, got %', (select count(*) from public.survey_recipients where survey_id = v);
  end if;
  if (select for_child_names from public.survey_recipients where survey_id = v
      and profile_id = '00000000-0000-0000-0000-000000000041') <> array['Jordan Junior'] then
    raise exception 'parent copy does not name the child';
  end if;
  -- 42 is a coach in the squad, so answers in their own right.
  if (select for_children from public.survey_recipients where survey_id = v
      and profile_id = '00000000-0000-0000-0000-000000000042') is not null then
    raise exception 'coach-parent should answer in own right';
  end if;
end $$;
set role authenticated;

-- The parent can't answer for the child.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000041';
do $$ begin
  begin
    perform public.submit_survey_response((select v from ids where k = 'anon'), '[]', false);
    raise exception 'parent answered';
  exception when others then
    if sqlerrm not like 'This survey is for your child%' then raise; end if;
  end;
  if (select count(*) from public.my_surveys()) <> 1 then raise exception 'parent does not see the copy'; end if;
end $$;

-- The minor answers; a required question can't be skipped; they can't answer twice.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$
declare v uuid := (select v from ids where k = 'anon');
  q jsonb := public.survey_detail(v) -> 'questions';
begin
  if not (public.survey_detail(v) ->> 'can_answer')::boolean then raise exception 'cannot answer'; end if;
  begin
    perform public.submit_survey_response(v, jsonb_build_array(
      jsonb_build_object('question_id', q -> 0 ->> 'id', 'rating', 4)), false);
    raise exception 'skipped required question';
  exception when others then
    if sqlerrm not like 'Answer "Best night"%' then raise; end if;
  end;
  begin
    perform public.submit_survey_response(v, jsonb_build_array(
      jsonb_build_object('question_id', q -> 0 ->> 'id', 'rating', 9),
      jsonb_build_object('question_id', q -> 1 ->> 'id', 'choices', '[0]'::jsonb)), false);
    raise exception 'rating out of range';
  exception when others then
    if sqlerrm not like 'Choose a rating%' then raise; end if;
  end;
  perform public.submit_survey_response(v, jsonb_build_array(
    jsonb_build_object('question_id', q -> 0 ->> 'id', 'rating', 4),
    jsonb_build_object('question_id', q -> 1 ->> 'id', 'choices', '[0]'::jsonb),
    jsonb_build_object('question_id', q -> 2 ->> 'id', 'choices', '[0, 2]'::jsonb),
    jsonb_build_object('question_id', q -> 3 ->> 'id', 'text', 'More games please')), true);
  begin
    perform public.submit_survey_response(v, '[]', false);
    raise exception 'answered twice';
  exception when others then
    if sqlerrm not like 'You''ve already answered%' then raise; end if;
  end;
  -- Even their own anonymous answers aren't shown back.
  if public.survey_detail(v) -> 'my_answers' <> 'null'::jsonb then raise exception 'anonymous answers returned'; end if;
  begin
    perform public.survey_results(v);
    raise exception 'athlete read results';
  exception when others then
    if sqlerrm not like 'Survey not found%' then raise; end if;
  end;
end $$;

-- Two more answer.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000032';
select public.submit_survey_response((select v from ids where k = 'anon'), (
  select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'rating', 2, 'choices', '[1]'::jsonb, 'text', 'Zzz'))
  from jsonb_array_elements(public.survey_detail((select v from ids where k = 'anon')) -> 'questions') q), false);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000013';
select public.submit_survey_response((select v from ids where k = 'anon'), (
  select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'rating', 5, 'choices', '[1]'::jsonb))
  from jsonb_array_elements(public.survey_detail((select v from ids where k = 'anon')) -> 'questions') q), false);

-- Nothing links an anonymous answer to a member; the parent reads nothing.
reset role;
do $$
declare v uuid := (select v from ids where k = 'anon');
begin
  if exists (select 1 from public.survey_responses where survey_id = v
             and (respondent_id is not null or respondent_name is not null or submitted_at is not null)) then
    raise exception 'anonymous response carries who or when';
  end if;
  if (select count(*) from public.survey_responses where survey_id = v) <> 3 then raise exception 'expected 3 responses'; end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000041';
do $$ begin
  if jsonb_array_length(public.survey_detail((select v from ids where k = 'anon')) -> 'children') <> 0 then
    raise exception 'parent read anonymous answers';
  end if;
end $$;

-- Results stay hidden while it's open, then show without names once closed.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare v uuid := (select v from ids where k = 'anon'); r jsonb;
begin
  r := public.survey_results(v);
  if not (r ->> 'hidden')::boolean then raise exception 'anonymous results shown while open'; end if;
  if (r ->> 'answered')::int <> 3 or (r ->> 'sent_to')::int <> 7 then raise exception 'counts wrong: %', r; end if;
  perform public.set_survey_closing(v, now());
  r := public.survey_results(v);
  if (r ->> 'hidden')::boolean then raise exception 'results hidden after closing'; end if;
  if r -> 'questions' -> 0 -> 'counts' <> '[0, 1, 0, 1, 1]'::jsonb then raise exception 'rating counts %', r -> 'questions' -> 0; end if;
  if r -> 'questions' -> 1 -> 'counts' <> '[1, 2]'::jsonb then raise exception 'choice counts'; end if;
  if r -> 'questions' -> 2 -> 'counts' <> '[1, 2, 1]'::jsonb then raise exception 'multi counts %', r -> 'questions' -> 2; end if;
  if (r -> 'questions' -> 0 ->> 'average')::numeric <> 3.7 then raise exception 'average'; end if;
  if r -> 'questions' -> 3 -> 'texts' <> '[{"name": null, "text": "More games please"}, {"name": null, "text": "Zzz"}]'::jsonb then
    raise exception 'texts %', r -> 'questions' -> 3 -> 'texts';
  end if;
  if jsonb_array_length(r -> 'respondents') <> 0 or jsonb_array_length(r -> 'waiting') <> 0 then
    raise exception 'anonymous results name people';
  end if;
  -- Closed: no more answers.
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
  begin
    perform public.submit_survey_response(v, '[]', false);
    raise exception 'answered a closed survey';
  exception when others then
    if sqlerrm not like 'This survey is closed%' then raise; end if;
  end;
end $$;

-- The spreadsheet export: every set of answers, with no names or times.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ declare x jsonb := public.survey_export((select v from ids where k = 'anon')); begin
  if not (public.survey_results((select v from ids where k = 'anon')) ->> 'can_export')::boolean then
    raise exception 'admin cannot export';
  end if;
  if jsonb_array_length(x -> 'responses') <> 3 or jsonb_array_length(x -> 'questions') <> 4 then
    raise exception 'export rows %', x;
  end if;
  if exists (select 1 from jsonb_array_elements(x -> 'responses') r
      where r ->> 'name' is not null or r ->> 'submitted_at' is not null) then
    raise exception 'anonymous export carries names or times';
  end if;
  if x -> 'survey' ->> 'title' <> 'End of season' then raise exception 'export title'; end if;
end $$;

reset role;
do $$ begin
  if exists (select 1 from public.record_access_log where kind = 'survey_answers') then
    raise exception 'anonymous results were logged';
  end if;
end $$;
set role authenticated;

-- An anonymous survey with fewer than three answers stays hidden after closing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into ids values ('few', public.create_survey('Few', null, 'anonymous', 'role', 'manager', null, null,
  now() + interval '1 day', '[{"kind":"text","prompt":"Thoughts"}]'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000013';
select public.submit_survey_response((select v from ids where k = 'few'), jsonb_build_array(jsonb_build_object(
  'question_id', public.survey_detail((select v from ids where k = 'few')) -> 'questions' -> 0 ->> 'id', 'text', 'Only me')), false);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ declare v uuid := (select v from ids where k = 'few'); begin
  perform public.set_survey_closing(v, now());
  if not (public.survey_results(v) ->> 'hidden')::boolean then raise exception 'one anonymous answer shown'; end if;
  begin
    perform public.survey_export(v);
    raise exception 'exported one anonymous answer';
  exception when others then
    if sqlerrm not like 'The results aren''t ready%' then raise; end if;
  end;
end $$;

-- A named survey: the parent reads their child's answers, results name
-- people and who's waiting, and the view is logged against the child.
insert into ids values ('named', public.create_survey('Kit sizes', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"choice","prompt":"Dress size","options":["S","M","L"]}]'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
select public.submit_survey_response((select v from ids where k = 'named'), jsonb_build_array(jsonb_build_object(
  'question_id', public.survey_detail((select v from ids where k = 'named')) -> 'questions' -> 0 ->> 'id', 'choices', '[1]'::jsonb)), false);
do $$ begin
  if public.survey_detail((select v from ids where k = 'named')) -> 'my_answers' -> 0 -> 'choices' <> '[1]'::jsonb then
    raise exception 'own named answers not shown';
  end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000041';
do $$ declare c jsonb := public.survey_detail((select v from ids where k = 'named')) -> 'children'; begin
  if c -> 0 ->> 'name' <> 'Jordan Junior' or c -> 0 -> 'answers' -> 0 -> 'choices' <> '[1]'::jsonb then
    raise exception 'parent cannot read named answers: %', c;
  end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
-- Fewer than 3 answers: results wait (who hasn't answered still shows on a
-- named survey), then show once it's closed.
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'named')); begin
  if not (r ->> 'hidden')::boolean or r ->> 'wait' <> 'min' then raise exception 'named results not waiting: %', r; end if;
end $$;
reset role;
update public.surveys set closes_at = now() where id = (select v from ids where k = 'named');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'named')); begin
  if (r ->> 'hidden')::boolean then raise exception 'named results hidden'; end if;
  if r -> 'respondents' -> 0 ->> 'name' <> 'Jordan Junior' then raise exception 'named respondent missing'; end if;
  if jsonb_array_length(r -> 'waiting') <> 6 then raise exception 'waiting %', r -> 'waiting'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.record_access_log where kind = 'survey_answers'
      and subject_id = '00000000-0000-0000-0000-000000000031') <> 1 then
    raise exception 'named view of a child not logged';
  end if;
end $$;
set role authenticated;
-- Downloading named answers names the child and is logged too.
do $$ declare x jsonb := public.survey_export((select v from ids where k = 'named')); begin
  if x -> 'responses' -> 0 ->> 'name' <> 'Jordan Junior' or x -> 'responses' -> 0 ->> 'submitted_at' is null then
    raise exception 'named export %', x;
  end if;
  if jsonb_array_length(x -> 'waiting') <> 6 then raise exception 'export waiting'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.record_access_log where kind = 'survey_answers'
      and subject_id = '00000000-0000-0000-0000-000000000031') <> 2 then
    raise exception 'named export of a child not logged';
  end if;
end $$;
set role authenticated;

-- Optional names: each member chooses.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into ids values ('opt', public.create_survey('Social night', null, 'optional', 'club', null, null, null,
  now() + interval '7 days', '[{"kind":"text","prompt":"Ideas"}]'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000032';
select public.submit_survey_response((select v from ids where k = 'opt'), jsonb_build_array(jsonb_build_object(
  'question_id', public.survey_detail((select v from ids where k = 'opt')) -> 'questions' -> 0 ->> 'id', 'text', 'Bowling')), true);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000013';
select public.submit_survey_response((select v from ids where k = 'opt'), jsonb_build_array(jsonb_build_object(
  'question_id', public.survey_detail((select v from ids where k = 'opt')) -> 'questions' -> 0 ->> 'id', 'text', 'Quiz')), false);
reset role;
do $$ declare v uuid := (select v from ids where k = 'opt'); begin
  if (select count(*) from public.survey_responses where survey_id = v and respondent_name = 'Kai Senior') <> 1 then
    raise exception 'named optional answer missing';
  end if;
  if (select count(*) from public.survey_responses where survey_id = v and respondent_id is null and submitted_at is null) <> 1 then
    raise exception 'unnamed optional answer carries who or when';
  end if;
end $$;
set role authenticated;

-- Committee members manage surveys; only the maker or an admin changes closing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
do $$ begin
  if (select count(*) from public.manage_surveys()) <> 4 then raise exception 'committee list %', (select count(*) from public.manage_surveys()); end if;
  begin
    perform public.set_survey_closing((select v from ids where k = 'opt'), now());
    raise exception 'committee closed an admin survey';
  exception when others then
    if sqlerrm not like 'Only the person who made it%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$ begin
  if (select count(*) from public.manage_surveys()) <> 0 then raise exception 'athlete sees manage list'; end if;
end $$;

-- Coaches and managers send surveys to the groups they coach or manage, and
-- read the results of their own surveys only.
reset role;
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000a3', 'Other Squad', 'squad', 3);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  begin
    perform public.create_survey('Club wide', null, 'anonymous', 'club', null, null, null,
      now() + interval '1 day', '[{"kind":"text","prompt":"Hi"}]');
    raise exception 'coach sent to the club';
  exception when others then
    if sqlerrm not like 'Only the committee and admins can send surveys to the club%' then raise; end if;
  end;
  begin
    perform public.create_survey('Other', null, 'anonymous', 'group', null, '00000000-0000-0000-0000-0000000000a3', null,
      now() + interval '1 day', '[{"kind":"text","prompt":"Hi"}]');
    raise exception 'coach sent to a group they do not coach';
  exception when others then
    if sqlerrm not like 'You can only send surveys to squads and teams you coach, manage or captain%' then raise; end if;
  end;
  if (select count(*) from public.manage_surveys()) <> 0 then raise exception 'coach sees others'' surveys'; end if;
  begin
    perform public.survey_results((select v from ids where k = 'named'));
    raise exception 'coach read an admin survey''s results';
  exception when others then
    if sqlerrm not like 'Survey not found%' then raise; end if;
  end;
end $$;
insert into ids values ('poll', public.create_survey('Training on Friday?', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '2 days',
  '[{"kind":"choice","prompt":"Can you come?","options":["Yes","No"]}]'));
-- The coach's lapsed assistant can't send one.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
do $$ begin
  begin
    perform public.create_survey('Lapsed', null, 'named', 'group', null, '00000000-0000-0000-0000-0000000000a1', null,
      now() + interval '1 day', '[{"kind":"text","prompt":"Hi"}]');
    raise exception 'lapsed coach sent a survey';
  exception when others then
    if sqlerrm not like 'You can only send surveys%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
select public.submit_survey_response((select v from ids where k = 'poll'), jsonb_build_array(jsonb_build_object(
  'question_id', public.survey_detail((select v from ids where k = 'poll')) -> 'questions' -> 0 ->> 'id', 'choices', '[0]'::jsonb)), false);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
-- Fewer than 3 answers: results wait (who hasn't answered still shows on a
-- named survey), then show once it's closed.
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'poll')); begin
  if not (r ->> 'hidden')::boolean or r ->> 'wait' <> 'min' then raise exception 'poll results not waiting: %', r; end if;
end $$;
reset role;
update public.surveys set closes_at = now() where id = (select v from ids where k = 'poll');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'poll')); begin
  if r -> 'questions' -> 0 -> 'counts' <> '[1, 0]'::jsonb then raise exception 'poll counts %', r; end if;
  if (select count(*) from public.manage_surveys()) <> 1 then raise exception 'coach does not see own survey'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.record_access_log where kind = 'survey_answers'
      and subject_id = '00000000-0000-0000-0000-000000000031'
      and viewer_id = '00000000-0000-0000-0000-000000000011') <> 1 then
    raise exception 'coach view of a child''s named answers not logged';
  end if;
end $$;
set role authenticated;
-- The manager sees nothing they didn't send; nor does the committee or an
-- admin, unless the coach shares it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000013';
do $$ begin
  if (select count(*) from public.manage_surveys()) <> 0 then raise exception 'manager sees the coach poll'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
do $$ begin
  if (select count(*) from public.manage_surveys()) <> 4 then raise exception 'committee sees the unshared coach poll'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  begin
    perform public.survey_results((select v from ids where k = 'poll'));
    raise exception 'admin read an unshared coach poll';
  exception when others then
    if sqlerrm not like 'Survey not found%' then raise; end if;
  end;
  begin
    perform public.set_survey_closing((select v from ids where k = 'poll'), now());
    raise exception 'admin closed an unshared coach poll';
  exception when others then
    if sqlerrm not like 'Survey not found%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
insert into ids values ('shared', public.create_survey('Season review', null, 'anonymous', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '2 days',
  '[{"kind":"rating","prompt":"How was the season?"}]', true));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
do $$ begin
  if (select count(*) from public.manage_surveys()) <> 5 then raise exception 'committee does not see the shared survey'; end if;
  if not (public.survey_detail((select v from ids where k = 'shared')) ->> 'share_with_committee')::boolean then
    raise exception 'shared flag missing';
  end if;
end $$;
-- A coach's survey with a written answer, or more than 5 questions, always
-- goes to admins, even unshared; the committee sees it only if shared.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
insert into ids values ('written', public.create_survey('How are you finding training?', null, 'anonymous', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '2 days',
  '[{"kind":"text","prompt":"Tell us"}]'));
insert into ids values ('long', public.create_survey('Long one', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '2 days',
  '[{"kind":"choice","prompt":"1","options":["a","b"]},{"kind":"choice","prompt":"2","options":["a","b"]},
    {"kind":"choice","prompt":"3","options":["a","b"]},{"kind":"choice","prompt":"4","options":["a","b"]},
    {"kind":"choice","prompt":"5","options":["a","b"]},{"kind":"rating","prompt":"6"}]'));
insert into ids values ('pollrating', public.create_survey('Quick rating', null, 'anonymous', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '2 days',
  '[{"kind":"rating","prompt":"How was camp?"}]'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
do $$ begin
  if (select count(*) from public.manage_surveys()) <> 5 then raise exception 'committee sees unshared written/long surveys'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if not exists (select 1 from public.manage_surveys() where id = (select v from ids where k = 'written')) then
    raise exception 'admin does not see the written-answer survey';
  end if;
  if not exists (select 1 from public.manage_surveys() where id = (select v from ids where k = 'long')) then
    raise exception 'admin does not see the long survey';
  end if;
  if exists (select 1 from public.manage_surveys() where id in ((select v from ids where k = 'pollrating'), (select v from ids where k = 'poll'))) then
    raise exception 'admin sees a team-only poll';
  end if;
  if not (public.survey_detail((select v from ids where k = 'written')) ->> 'can_close')::boolean then
    raise exception 'admin cannot close a survey shared with admins';
  end if;
end $$;

-- Sharing only counts for coaches and managers: the committee's own surveys
-- are already the committee's.
reset role;
do $$ begin
  if (select sent_as from public.surveys where id = (select v from ids where k = 'shared')) <> 'leader' then
    raise exception 'coach survey not sent as leader';
  end if;
  if (select sent_as from public.surveys where id = (select v from ids where k = 'anon')) <> 'committee' then
    raise exception 'admin survey not sent as committee';
  end if;
end $$;

-- Captains and vice captains send polls with choices to their own group.
-- Jordan (under 18) captains the squad; their parents get a copy saying
-- Jordan sent it, and the squad's coaches and managers see the poll.
insert into public.team_captains (team_id, profile_id, captain_role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000031', 'captain');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$ begin
  begin
    perform public.create_survey('Chat', null, 'named', 'group', null, '00000000-0000-0000-0000-0000000000a1', null,
      now() + interval '1 day', '[{"kind":"text","prompt":"Hi"}]');
    raise exception 'captain sent a written-answer poll';
  exception when others then
    if sqlerrm not like 'Captains'' polls can only have questions with choices%' then raise; end if;
  end;
  begin
    perform public.create_survey('Other', null, 'named', 'group', null, '00000000-0000-0000-0000-0000000000a3', null,
      now() + interval '1 day', '[{"kind":"choice","prompt":"Hi","options":["a","b"]}]');
    raise exception 'captain sent to another group';
  exception when others then
    if sqlerrm not like 'You can only send surveys to squads and teams you coach, manage or captain%' then raise; end if;
  end;
end $$;
insert into ids values ('social', public.create_survey('Team dinner', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '3 days',
  '[{"kind":"multi_choice","prompt":"Which nights can you come?","options":["Friday","Saturday","Sunday"]}]', true));
reset role;
do $$
declare v uuid := (select v from ids where k = 'social');
begin
  if (select share_with_committee from public.surveys where id = v) then raise exception 'captain poll shared'; end if;
  if (select sent_as from public.surveys where id = v) <> 'captain' then raise exception 'not sent as captain'; end if;
  -- 41 is Jordan's parent and gets a copy naming Jordan, even though Jordan
  -- doesn't get the poll. 42 is in the squad in their own right.
  if (select for_children from public.survey_recipients where survey_id = v
      and profile_id = '00000000-0000-0000-0000-000000000041') <> array['00000000-0000-0000-0000-000000000031'::uuid] then
    raise exception 'captain''s parent has no copy';
  end if;
  if (select for_children from public.survey_recipients where survey_id = v
      and profile_id = '00000000-0000-0000-0000-000000000042') is not null then
    raise exception 'coach-parent should answer in own right';
  end if;
  if exists (select 1 from public.survey_recipients where survey_id = v
      and profile_id = '00000000-0000-0000-0000-000000000031') then
    raise exception 'captain sent the poll to themselves';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000041';
do $$ declare d jsonb := public.survey_detail((select v from ids where k = 'social')); begin
  if not (d ->> 'from_child')::boolean then raise exception 'parent copy does not say the child sent it'; end if;
  if d ->> 'can_answer' <> 'false' then raise exception 'parent can answer the captain poll'; end if;
  if jsonb_array_length(d -> 'children') <> 0 then raise exception 'sender listed as a child to answer'; end if;
  if (select from_child from public.my_surveys() where id = (select v from ids where k = 'social')) is not true then
    raise exception 'my_surveys from_child';
  end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000032';
select public.submit_survey_response((select v from ids where k = 'social'), jsonb_build_array(jsonb_build_object(
  'question_id', public.survey_detail((select v from ids where k = 'social')) -> 'questions' -> 0 ->> 'id', 'choices', '[0, 1]'::jsonb)), false);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
-- Fewer than 3 answers: results wait (who hasn't answered still shows on a
-- named survey), then show once it's closed.
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'social')); begin
  if not (r ->> 'hidden')::boolean or r ->> 'wait' <> 'min' then raise exception 'social results not waiting: %', r; end if;
end $$;
reset role;
update public.surveys set closes_at = now() where id = (select v from ids where k = 'social');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'social')); begin
  if r -> 'questions' -> 0 -> 'counts' <> '[1, 1, 0]'::jsonb then raise exception 'captain poll counts %', r; end if;
  if (select count(*) from public.manage_surveys()) <> 1 then raise exception 'captain list'; end if;
end $$;
-- Open it again for the checks below.
reset role;
update public.surveys set closes_at = now() + interval '7 days' where id = (select v from ids where k = 'social');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
-- A captain reads results in the app but can't download them.
do $$ begin
  if (public.survey_results((select v from ids where k = 'social')) ->> 'can_export')::boolean then
    raise exception 'captain can export';
  end if;
  begin
    perform public.survey_export((select v from ids where k = 'social'));
    raise exception 'captain exported';
  exception when others then
    if sqlerrm not like 'Survey not found%' then raise; end if;
  end;
end $$;
-- With Captains' polls switched off, captains can't send new ones.
reset role;
update public.club_settings set features = coalesce(features, '{}'::jsonb) || '{"captainPolls": false}' where id;
set role authenticated;
do $$ begin
  begin
    perform public.create_survey('Off', null, 'named', 'group', null, '00000000-0000-0000-0000-0000000000a1', null,
      now() + interval '1 day', '[{"kind":"choice","prompt":"Hi","options":["a","b"]}]');
    raise exception 'captain sent a poll while switched off';
  exception when others then
    if sqlerrm not like 'You can only send surveys%' then raise; end if;
  end;
end $$;
reset role;
update public.club_settings set features = features - 'captainPolls' where id;
set role authenticated;
-- The manager sees the captain's poll, can download and close it; the committee can't see it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000013';
do $$ begin
  if (select count(*) from public.manage_surveys()) <> 1 then raise exception 'manager does not see the captain poll'; end if;
  if not (public.survey_detail((select v from ids where k = 'social')) ->> 'can_close')::boolean then
    raise exception 'manager cannot close the captain poll';
  end if;
  -- One answer so far, so nothing to download yet.
  begin
    perform public.survey_export((select v from ids where k = 'social'));
    raise exception 'manager exported a poll with one answer';
  exception when others then
    if sqlerrm not like 'The results aren''t ready%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
do $$ begin
  if (select count(*) from public.manage_surveys()) <> 5 then raise exception 'committee sees the captain poll'; end if;
end $$;
-- A former captain no longer sees their poll's results.
reset role;
delete from public.team_captains where profile_id = '00000000-0000-0000-0000-000000000031';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$ begin
  if (select count(*) from public.manage_surveys()) <> 0 then raise exception 'former captain sees poll'; end if;
end $$;

-- Keeping records: three periods counted from closing, only once removal is on.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
do $$ begin
  begin
    perform public.admin_set_survey_retention(36, 24, 6);
    raise exception 'committee set survey keep periods';
  exception when others then
    if sqlerrm not like 'Only admins%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if (select row(surveys_months, shared_surveys_months, team_polls_months)::text from public.survey_retention()) <> '(36,24,6)' then
    raise exception 'survey keep defaults %', (select row(surveys_months, shared_surveys_months, team_polls_months)::text from public.survey_retention());
  end if;
  begin
    perform public.admin_set_survey_retention(36, 24, 1);
    raise exception 'odd poll period accepted';
  exception when others then
    if sqlerrm not like 'Team polls can be kept%' then raise; end if;
  end;
  perform public.admin_set_survey_retention(12, 24, 3);
end $$;
reset role;
-- Every survey closed 13 months ago: committee ones (12 months) and team-only
-- polls (3 months) go; shared team surveys (24 months) stay.
create temp table survey_counts as
  select sent_as, (share_with_admins or share_with_committee) as shared, count(*) as n
  from public.surveys group by 1, 2;
do $$ begin
  if (public.purge_expired_surveys() ->> 'enabled')::boolean then raise exception 'purged while removal off'; end if;
end $$;
update public.surveys set opens_at = now() - interval '14 months', closes_at = now() - interval '13 months';
update public.club_settings set retention_enabled = true where id;
do $$ declare r jsonb := public.purge_expired_surveys(); begin
  if exists (select 1 from public.surveys where sent_as = 'committee') then raise exception 'committee survey kept'; end if;
  if exists (select 1 from public.surveys where not (share_with_admins or share_with_committee) and sent_as <> 'committee') then
    raise exception 'team poll kept';
  end if;
  if (select count(*) from public.surveys) <> (select coalesce(sum(n), 0) from survey_counts where shared and sent_as <> 'committee') then
    raise exception 'shared team survey removed';
  end if;
  if (select count(*) from public.surveys) = 0 then raise exception 'no shared survey in the test'; end if;
  if exists (select 1 from public.survey_answers a where not exists (select 1 from public.survey_responses r where r.id = a.response_id)) then
    raise exception 'orphaned answers';
  end if;
  if (r ->> 'surveys')::int = 0 then raise exception 'purge count %', r; end if;
end $$;
update public.club_settings set retention_enabled = false where id;
set role authenticated;

-- Turned off in Club settings: nothing shows.
reset role;
update public.club_settings set features = coalesce(features, '{}'::jsonb) || '{"surveys": false}' where id;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$ begin
  if (select count(*) from public.my_surveys()) <> 0 then raise exception 'surveys shown while off'; end if;
end $$;
reset role;
update public.club_settings set features = features - 'surveys' where id;

select 'surveys.sql passed' as result;
