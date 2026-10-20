-- When survey results show, and sharing them with the team (migration
-- 20261017150000). "Everyone must answer" holds results until everyone has
-- answered; named results otherwise wait for 3 answers, or a club survey's
-- 20/50/80% target; anonymous and optional ones still wait for closing
-- unless everyone has answered; everything shows once closed. Coaches,
-- managers and captains can share counts (never names or written answers)
-- with the group. Run after the migrations and seed-members.sql. Raises on
-- any failure.

create temp table ids (k text primary key, v uuid);
create temp table people (n serial, id uuid);
grant all on ids, people to authenticated;
grant usage on sequence people_n_seq to authenticated;
-- Everyone a survey to the group reaches. A guardian placed in the squad with
-- their child (20261020020000) isn't in its audience in their own right.
insert into people (id)
select tm.profile_id from public.team_members tm join public.profiles p on p.id = tm.profile_id
where tm.team_id = '00000000-0000-0000-0000-0000000000a1' and p.status = 'approved'
  and tm.team_role <> 'guardian'
  and p.role not in ('guest', 'volunteer') and p.id <> '00000000-0000-0000-0000-000000000011'
order by tm.profile_id;
set role authenticated;

-- Answers a survey's first question as the given people: choices[0] = 0.
create or replace function pg_temp.answer(p_key text, p_from int, p_to int) returns void language plpgsql as $$
declare p record; v uuid := (select v from ids where k = p_key); q text; begin
  for p in select id from people where n between p_from and p_to order by n loop
    perform set_config('request.jwt.claim.sub', p.id::text, false);
    q := public.survey_detail(v) -> 'questions' -> 0 ->> 'id';
    perform public.submit_survey_response(v, jsonb_build_array(jsonb_build_object(
      'question_id', q, 'choices', '[0]'::jsonb)), false);
  end loop;
end $$;

-- A member can't call the old function directly.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  begin
    perform public.create_survey_base('x', null, 'named', 'group', null,
      '00000000-0000-0000-0000-0000000000a1', null, now() + interval '1 day',
      '[{"kind":"choice","prompt":"Hi","options":["a","b"]}]', false, false);
    raise exception 'member called create_survey_base';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A coach's named poll that everyone must answer, shared with the team.
insert into ids values ('must', public.create_survey('Training night', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"choice","prompt":"Which night?","options":["Tue","Thu"]}]',
  p_everyone_answers => true, p_results_to_group => true, p_results_at_percent => 50));
reset role;
do $$ declare s public.surveys := (select s from public.surveys s where id = (select v from ids where k = 'must')); begin
  if not s.everyone_answers or not s.results_to_group or s.results_at_percent is not null then
    raise exception 'coach poll flags %', row_to_json(s);
  end if;
end $$;
set role authenticated;
select pg_temp.answer('must', 1, 3);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'must'));
  total int := (select count(*) from people); begin
  if not (r ->> 'hidden')::boolean or r ->> 'wait' <> 'everyone' then raise exception 'must not waiting: %', r; end if;
  if jsonb_array_length(r -> 'waiting') <> total - 3 then raise exception 'waiting list hidden: %', r -> 'waiting'; end if;
  if not (r ->> 'can_close')::boolean then raise exception 'coach cannot close'; end if;
end $$;
-- The team sees how many have answered, not the counts.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000032';
do $$ declare g jsonb := public.survey_group_results((select v from ids where k = 'must')); begin
  if g ->> 'wait' <> 'everyone' or jsonb_array_length(g -> 'questions') <> 0 then raise exception 'group early %', g; end if;
  if (g ->> 'answered')::int <> 3 then raise exception 'group answered %', g; end if;
  if (select everyone_answers from public.my_surveys() where id = (select v from ids where k = 'must')) is not true then
    raise exception 'my_surveys everyone_answers';
  end if;
  if not (public.survey_detail((select v from ids where k = 'must')) ->> 'results_to_group')::boolean then
    raise exception 'detail results_to_group';
  end if;
end $$;
select pg_temp.answer('must', 4, 1000);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'must')); begin
  if (r ->> 'hidden')::boolean then raise exception 'must hidden after everyone answered'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000032';
do $$ declare g jsonb := public.survey_group_results((select v from ids where k = 'must'));
  total int := (select count(*) from people); begin
  if g ->> 'wait' is not null then raise exception 'group still waiting %', g; end if;
  if g -> 'questions' -> 0 -> 'counts' <> jsonb_build_array(total, 0) then raise exception 'group counts %', g; end if;
  if g::text like '%Junior%' or g ? 'respondents' or g ? 'waiting' then raise exception 'group results name people %', g; end if;
end $$;
-- A parent with a copy sees them; someone it didn't go to doesn't.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000041';
do $$ begin perform public.survey_group_results((select v from ids where k = 'must')); end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  begin
    perform public.survey_group_results((select v from ids where k = 'must'));
    raise exception 'non-recipient read group results';
  exception when others then
    if sqlerrm not like 'Survey not found%' then raise; end if;
  end;
end $$;

-- A club survey with names shows results at 50%; it can't be shared with the group.
insert into ids values ('half', public.create_survey('Kit order', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"choice","prompt":"Size","options":["S","M"]}]',
  p_results_at_percent => 50, p_results_to_group => true));
-- Anonymous club surveys have no percentage target.
insert into ids values ('anonclub', public.create_survey('Feedback', null, 'anonymous', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"choice","prompt":"Happy?","options":["Yes","No"]}]', p_results_at_percent => 80));
do $$ begin
  begin
    perform public.create_survey('Bad', null, 'named', 'club', null, null, null, now() + interval '7 days',
      '[{"kind":"choice","prompt":"Hi","options":["a","b"]}]', p_results_at_percent => 30);
    raise exception 'took 30 percent';
  exception when others then
    if sqlerrm not like 'Choose 20%' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select results_at_percent from public.surveys where id = (select v from ids where k = 'half')) <> 50
     or (select results_to_group from public.surveys where id = (select v from ids where k = 'half')) then
    raise exception 'club survey flags';
  end if;
  if (select results_at_percent from public.surveys where id = (select v from ids where k = 'anonclub')) is not null then
    raise exception 'anonymous club survey kept a percentage';
  end if;
end $$;
set role authenticated;
-- It went to the group and its coach: 3 of 7 is under half.
select pg_temp.answer('half', 1, 3);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'half')); begin
  if (r ->> 'sent_to')::int <> 7 then raise exception 'half sent to %', r ->> 'sent_to'; end if;
  if r ->> 'wait' <> 'percent' then raise exception 'half not waiting %', r; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
select public.submit_survey_response((select v from ids where k = 'half'), jsonb_build_array(jsonb_build_object(
  'question_id', public.survey_detail((select v from ids where k = 'half')) -> 'questions' -> 0 ->> 'id',
  'choices', '[0]'::jsonb)), false);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'half')); begin
  if (r ->> 'hidden')::boolean then raise exception 'half hidden at 50%%: %', r; end if;
end $$;

-- An anonymous coach poll waits for closing even with 3 answers, then shows
-- once everyone has answered.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
insert into ids values ('anon', public.create_survey('Mood', null, 'anonymous', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"choice","prompt":"Mood?","options":["Good","Bad"]}]', p_results_to_group => true));
select pg_temp.answer('anon', 1, 3);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'anon')); begin
  if r ->> 'wait' <> 'closing' then raise exception 'anonymous shown before closing %', r; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000032';
do $$ begin
  if public.survey_group_results((select v from ids where k = 'anon')) ->> 'wait' <> 'closing' then
    raise exception 'anonymous group results before closing';
  end if;
end $$;
select pg_temp.answer('anon', 4, 1000);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ declare r jsonb := public.survey_results((select v from ids where k = 'anon')); begin
  if (r ->> 'hidden')::boolean then raise exception 'anonymous hidden after everyone answered %', r; end if;
end $$;

-- A named poll without a target waits for 3 answers.
insert into ids values ('three', public.create_survey('Bus', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"choice","prompt":"Need a seat?","options":["Yes","No"]}]'));
select pg_temp.answer('three', 1, 2);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  if public.survey_results((select v from ids where k = 'three')) ->> 'wait' <> 'min' then raise exception 'two named shown'; end if;
end $$;
select pg_temp.answer('three', 3, 3);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  if (public.survey_results((select v from ids where k = 'three')) ->> 'hidden')::boolean then raise exception 'three named hidden'; end if;
end $$;

-- Everyone must answer, but whoever sent it closes it early and accepts the
-- answers as they are.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into ids values ('club', public.create_survey('AGM', null, 'named', 'club', null, null, null,
  now() + interval '7 days', '[{"kind":"choice","prompt":"Coming?","options":["Yes","No"]}]',
  p_results_at_percent => 100));
reset role;
do $$ begin
  if not (select everyone_answers from public.surveys where id = (select v from ids where k = 'club')) then
    raise exception '100 percent is not everyone';
  end if;
end $$;
set role authenticated;
select pg_temp.answer('club', 1, 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ declare v uuid := (select v from ids where k = 'club'); begin
  if public.survey_results(v) ->> 'wait' <> 'everyone' then raise exception 'club not waiting'; end if;
  perform public.set_survey_closing(v, now());
  if (public.survey_results(v) ->> 'hidden')::boolean then raise exception 'closed survey still hidden'; end if;
end $$;

reset role;
