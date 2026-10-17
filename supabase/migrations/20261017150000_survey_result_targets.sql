-- When survey and poll results show, and sharing them with the team (Matt,
-- 17 October 2026).
--
-- - "Everyone must answer": any survey or poll can be marked so. Its results
--   stay hidden until everyone it went to has answered. Otherwise named
--   results show once at least 3 people have answered.
-- - Club surveys (from the committee or an admin) can instead show named
--   results once 20%, 50% or 80% of the people they went to have answered;
--   100% is "Everyone must answer".
-- - Anonymous and name-optional results still show only once the survey has
--   closed, or once everyone has answered, and only with at least 3 answers
--   (Matt kept this rule): before then every new answer would change the
--   counts, and anyone watching could tell what the person who just
--   answered picked.
-- - Whatever the target, results show once the survey closes, so a club
--   survey that never reaches its target is never locked away. Whoever can
--   close it can close it early and accept the answers as they are.
-- - Coaches, managers and captains can share a poll or survey's results with
--   the squad or team they sent it to. Everyone it went to (and parents and
--   guardians with a copy) then sees the counts and averages once results
--   show: never names, written answers or who has answered.
--
-- Additive only: three columns with defaults on surveys, new functions, and
-- the existing survey functions replaced. create_survey becomes
-- create_survey_base (no longer callable by members) behind a new
-- create_survey that also takes these choices. No rows are changed.

begin;

alter table public.surveys add column if not exists everyone_answers boolean not null default false;
alter table public.surveys add column if not exists results_at_percent integer;
alter table public.surveys add column if not exists results_to_group boolean not null default false;

do $$ begin
  alter table public.surveys add constraint surveys_results_at_percent
    check (results_at_percent in (20, 50, 80));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- When results show
-- ---------------------------------------------------------------------------

-- Null once a survey's results show, otherwise what they're waiting for:
--   'closing'  an anonymous or optional survey that's open and not everyone
--              has answered;
--   'min'      fewer than 3 answers (survey_min_responses);
--   'everyone' everyone must answer and someone hasn't;
--   'percent'  a club survey's target hasn't been reached.
-- Called by the survey functions below, never by members directly.
create or replace function public.survey_results_wait(s public.surveys)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_sent int;
  v_answered int;
  v_closed boolean := now() >= s.closes_at;
  v_everyone boolean;
begin
  select count(*) into v_sent from public.survey_recipients
  where survey_id = s.id and for_children is null;
  select count(*) into v_answered from public.survey_responses where survey_id = s.id;
  v_everyone := v_sent > 0 and v_answered >= v_sent;

  if s.identity <> 'named' then
    if not v_closed and not v_everyone then
      return 'closing';
    end if;
    if v_answered < public.survey_min_responses() then
      return 'min';
    end if;
    return null;
  end if;

  if v_closed then
    return null;
  end if;
  if s.everyone_answers then
    return case when v_everyone then null else 'everyone' end;
  end if;
  if s.results_at_percent is not null then
    return case when v_answered * 100 >= s.results_at_percent * v_sent then null else 'percent' end;
  end if;
  return case when v_answered >= public.survey_min_responses() then null else 'min' end;
end;
$$;
revoke execute on function public.survey_results_wait(public.surveys) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Making a survey
-- ---------------------------------------------------------------------------

do $$ begin
  if to_regprocedure('public.create_survey_base(text, text, public.survey_identity, public.survey_audience, public.app_role, uuid, timestamptz, timestamptz, jsonb, boolean, boolean)') is null then
    alter function public.create_survey(text, text, public.survey_identity, public.survey_audience, public.app_role, uuid, timestamptz, timestamptz, jsonb, boolean, boolean)
      rename to create_survey_base;
  end if;
end $$;
revoke execute on function public.create_survey_base(text, text, public.survey_identity, public.survey_audience, public.app_role, uuid, timestamptz, timestamptz, jsonb, boolean, boolean) from public, anon, authenticated;

-- As create_survey_base, plus:
--   p_everyone_answers: everyone must answer, and results wait until they have;
--   p_results_at_percent: for club surveys with names, show results once 20,
--     50 or 80 percent have answered (100 means everyone must answer);
--   p_results_to_group: for coaches', managers' and captains' surveys, share
--     the counts and averages with the squad or team.
create or replace function public.create_survey(
  p_title text,
  p_intro text,
  p_identity public.survey_identity,
  p_audience public.survey_audience,
  p_role public.app_role,
  p_team_id uuid,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_questions jsonb,
  p_share_with_committee boolean default false,
  p_share_with_admins boolean default false,
  p_everyone_answers boolean default false,
  p_results_at_percent integer default null,
  p_results_to_group boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  s public.surveys;
  v_everyone boolean := coalesce(p_everyone_answers, false) or coalesce(p_results_at_percent = 100, false);
begin
  if p_results_at_percent is not null and p_results_at_percent not in (20, 50, 80, 100) then
    raise exception 'Choose 20%%, 50%%, 80%% or everyone';
  end if;
  v_id := public.create_survey_base(
    p_title, p_intro, p_identity, p_audience, p_role, p_team_id, p_opens_at, p_closes_at,
    p_questions, p_share_with_committee, p_share_with_admins
  );
  select * into s from public.surveys where id = v_id;
  update public.surveys
  set everyone_answers = v_everyone,
      -- Only club surveys with names have a percentage target.
      results_at_percent = case
        when s.sent_as = 'committee' and s.identity = 'named' and not v_everyone
          and p_results_at_percent in (20, 50, 80)
        then p_results_at_percent end,
      results_to_group = s.sent_as in ('leader', 'captain') and coalesce(p_results_to_group, false)
  where id = v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_survey(text, text, public.survey_identity, public.survey_audience, public.app_role, uuid, timestamptz, timestamptz, jsonb, boolean, boolean, boolean, integer, boolean) from public, anon;
grant execute on function public.create_survey(text, text, public.survey_identity, public.survey_audience, public.app_role, uuid, timestamptz, timestamptz, jsonb, boolean, boolean, boolean, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Members' surveys
-- ---------------------------------------------------------------------------

-- The return type gains a column, so it's dropped and made again.
drop function if exists public.my_surveys();
create or replace function public.my_surveys()
returns table (
  id uuid,
  title text,
  identity public.survey_identity,
  opens_at timestamptz,
  closes_at timestamptz,
  created_by_name text,
  for_child_names text[],
  -- A parent or guardian's copy of a poll their child sent.
  from_child boolean,
  responded boolean,
  is_open boolean,
  -- Everyone it went to must answer.
  everyone_answers boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.identity, s.opens_at, s.closes_at, s.created_by_name,
    r.for_child_names, coalesce(s.created_by = any (r.for_children), false), r.responded,
    now() >= s.opens_at and now() < s.closes_at, s.everyone_answers
  from public.survey_recipients r
  join public.surveys s on s.id = r.survey_id
  where r.profile_id = auth.uid()
    and public.is_approved()
    and public.surveys_on()
    and s.opens_at <= now()
  order by s.opens_at desc;
$$;
revoke execute on function public.my_surveys() from public, anon;
grant execute on function public.my_surveys() to authenticated;

create or replace function public.survey_detail(p_survey_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.surveys;
  r public.survey_recipients;
  v_manager boolean := public.survey_can_see_results(p_survey_id);
  v_mine uuid;
  v_children jsonb := '[]'::jsonb;
begin
  select * into s from public.surveys where id = p_survey_id;
  select * into r from public.survey_recipients where survey_id = p_survey_id and profile_id = auth.uid();
  if s.id is null or not public.is_approved() or not public.surveys_on()
     or not (v_manager or (r.profile_id is not null and s.opens_at <= now())) then
    raise exception 'Survey not found';
  end if;

  if s.identity <> 'anonymous' then
    select id into v_mine from public.survey_responses
    where survey_id = s.id and respondent_id = auth.uid();
  end if;

  -- A parent or guardian reads each child's named answers while they're
  -- still that child's parent or guardian.
  if r.for_children is not null and s.identity <> 'anonymous' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.name,
      'responded', exists (
        select 1 from public.survey_recipients cr
        where cr.survey_id = s.id and cr.profile_id = c.child_id and cr.responded
      ),
      'answers', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'question_id', a.question_id, 'choices', a.choices, 'rating', a.rating, 'text', a.text_answer
        )), '[]'::jsonb)
        from public.survey_responses sr
        join public.survey_answers a on a.response_id = sr.id
        where sr.survey_id = s.id and sr.respondent_id = c.child_id
      )
    ) order by c.name), '[]'::jsonb)
    into v_children
    from unnest(r.for_children, r.for_child_names) as c(child_id, name)
    where c.child_id is distinct from s.created_by
      and exists (
      select 1 from public.guardianships g
      where g.guardian_id = auth.uid() and g.athlete_id = c.child_id
    );
  end if;

  return jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'intro', s.intro,
    'identity', s.identity,
    'audience', s.audience,
    'audience_role', s.audience_role,
    'audience_label', s.audience_label,
    'opens_at', s.opens_at,
    'closes_at', s.closes_at,
    'created_by', s.created_by,
    'created_by_name', s.created_by_name,
    'created_at', s.created_at,
    'is_open', now() >= s.opens_at and now() < s.closes_at,
    'is_scheduled', now() < s.opens_at,
    'is_recipient', r.profile_id is not null,
    'can_see_results', v_manager,
    'sent_as', s.sent_as,
    'share_with_committee', s.share_with_committee,
    'share_with_admins', s.share_with_admins,
    'everyone_answers', s.everyone_answers,
    'results_at_percent', s.results_at_percent,
    'results_to_group', s.results_to_group,
    'can_close', v_manager and public.survey_can_close(s.id) and now() < s.closes_at,
    'for_child_names', r.for_child_names,
    'from_child', coalesce(s.created_by = any (r.for_children), false),
    'can_answer', r.profile_id is not null and r.for_children is null and not r.responded
      and now() >= s.opens_at and now() < s.closes_at,
    'responded', coalesce(r.responded, false),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options,
        'rating_max', q.rating_max, 'required', q.required
      ) order by q.sort_order), '[]'::jsonb)
      from public.survey_questions q where q.survey_id = s.id
    ),
    'my_answers', case when v_mine is null then null else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'question_id', a.question_id, 'choices', a.choices, 'rating', a.rating, 'text', a.text_answer
      )), '[]'::jsonb)
      from public.survey_answers a where a.response_id = v_mine
    ) end,
    'children', v_children
  );
end;
$$;
revoke execute on function public.survey_detail(uuid) from public, anon;
grant execute on function public.survey_detail(uuid) to authenticated;

-- The counts and averages of a survey whose results were shared with the
-- squad or team, for anyone it went to (and parents and guardians with a
-- copy), once results show. Never names, written answers, or who answered.
create or replace function public.survey_group_results(p_survey_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.surveys;
  v_wait text;
begin
  select * into s from public.surveys where id = p_survey_id;
  if s.id is null or not s.results_to_group or not public.is_approved() or not public.surveys_on()
     or s.opens_at > now()
     or not exists (
       select 1 from public.survey_recipients r
       where r.survey_id = s.id and r.profile_id = auth.uid()
     ) then
    raise exception 'Survey not found';
  end if;
  v_wait := public.survey_results_wait(s);
  return jsonb_build_object(
    'sent_to', (select count(*) from public.survey_recipients r
      where r.survey_id = s.id and r.for_children is null),
    'answered', (select count(*) from public.survey_responses x where x.survey_id = s.id),
    'wait', v_wait,
    'closed', now() >= s.closes_at,
    'questions', case when v_wait is not null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id,
        'kind', q.kind,
        'prompt', q.prompt,
        'options', q.options,
        'rating_max', q.rating_max,
        'answered', (select count(*) from public.survey_answers a where a.question_id = q.id),
        'counts', case
          when q.kind in ('choice', 'multi_choice') then (
            select jsonb_agg((
              select count(*) from public.survey_answers a
              where a.question_id = q.id and (i - 1) = any (a.choices)
            ) order by i)
            from generate_series(1, array_length(q.options, 1)) i
          )
          else (
            select jsonb_agg((
              select count(*) from public.survey_answers a
              where a.question_id = q.id and a.rating = i
            ) order by i)
            from generate_series(1, q.rating_max) i
          )
        end,
        'average', case when q.kind = 'rating' then (
          select round(avg(a.rating), 1) from public.survey_answers a where a.question_id = q.id
        ) end
      ) order by q.sort_order), '[]'::jsonb)
      from public.survey_questions q
      -- Written answers stay with whoever sent it.
      where q.survey_id = s.id and q.kind <> 'text'
    ) end
  );
end;
$$;
revoke execute on function public.survey_group_results(uuid) from public, anon;
grant execute on function public.survey_group_results(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------

create or replace function public.survey_summary(s public.surveys)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'title', s.title, 'identity', s.identity, 'audience', s.audience,
    'audience_role', s.audience_role, 'audience_label', s.audience_label,
    'opens_at', s.opens_at, 'closes_at', s.closes_at,
    'created_by_name', s.created_by_name, 'sent_as', s.sent_as,
    'everyone_answers', s.everyone_answers, 'results_at_percent', s.results_at_percent,
    'results_to_group', s.results_to_group
  );
$$;
revoke execute on function public.survey_summary(public.surveys) from public, anon;
grant execute on function public.survey_summary(public.surveys) to authenticated;

-- A survey's results, for whoever survey_can_see_results allows, once
-- survey_results_wait says they show; until then, how many have answered,
-- what the results wait for, and who hasn't answered a named survey. Named
-- answers carry the member's name. Opening results that name a child under
-- 18 is logged against that child.
create or replace function public.survey_results(p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.surveys;
  v_sent int;
  v_answered int;
  v_wait text;
  v_waiting jsonb;
  v_child uuid;
begin
  select * into s from public.surveys where id = p_survey_id;
  if s.id is null or not public.survey_can_see_results(s.id) then
    raise exception 'Survey not found';
  end if;

  select count(*) into v_sent from public.survey_recipients
  where survey_id = s.id and for_children is null;
  select count(*) into v_answered from public.survey_responses where survey_id = s.id;
  v_wait := public.survey_results_wait(s);
  -- Who hasn't answered, for named surveys only, even while results wait, so
  -- whoever sent it can remind them.
  select case when s.identity = 'named' then (
    select coalesce(jsonb_agg(public.member_display_name(r.profile_id)
      order by public.member_display_name(r.profile_id)), '[]'::jsonb)
    from public.survey_recipients r
    where r.survey_id = s.id and r.for_children is null and not r.responded
  ) else '[]'::jsonb end
  into v_waiting;

  if v_wait is not null then
    return jsonb_build_object(
      'survey', public.survey_summary(s), 'can_export', false,
      'sent_to', v_sent, 'answered', v_answered, 'hidden', true, 'wait', v_wait,
      'closed', now() >= s.closes_at,
      'can_close', public.survey_can_close(s.id) and now() < s.closes_at,
      'min_responses', public.survey_min_responses(),
      'questions', '[]'::jsonb, 'respondents', '[]'::jsonb, 'waiting', v_waiting
    );
  end if;

  -- Named answers from children under 18 go in each child's access log.
  for v_child in
    select x.respondent_id from public.survey_responses x
    join public.profiles p on p.id = x.respondent_id
    where x.survey_id = s.id and public.is_minor(p.date_of_birth, p.under_17)
  loop
    perform public.write_record_access(v_child, 'survey_answers', s.id);
  end loop;

  return jsonb_build_object(
    'survey', public.survey_summary(s),
    'can_export', public.survey_can_export(s.id),
    'sent_to', v_sent,
    'answered', v_answered,
    'hidden', false,
    'wait', null,
    'closed', now() >= s.closes_at,
    'can_close', public.survey_can_close(s.id) and now() < s.closes_at,
    'min_responses', public.survey_min_responses(),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id,
        'kind', q.kind,
        'prompt', q.prompt,
        'options', q.options,
        'rating_max', q.rating_max,
        'answered', (select count(*) from public.survey_answers a where a.question_id = q.id),
        -- How many picked each choice, or each point on the scale.
        'counts', case
          when q.kind in ('choice', 'multi_choice') then (
            select jsonb_agg((
              select count(*) from public.survey_answers a
              where a.question_id = q.id and (i - 1) = any (a.choices)
            ) order by i)
            from generate_series(1, array_length(q.options, 1)) i
          )
          when q.kind = 'rating' then (
            select jsonb_agg((
              select count(*) from public.survey_answers a
              where a.question_id = q.id and a.rating = i
            ) order by i)
            from generate_series(1, q.rating_max) i
          )
        end,
        'average', case when q.kind = 'rating' then (
          select round(avg(a.rating), 1) from public.survey_answers a where a.question_id = q.id
        ) end,
        -- Free text in alphabetical order, so the order can't hint at who wrote it.
        'texts', case when q.kind = 'text' then (
          select coalesce(jsonb_agg(jsonb_build_object('text', a.text_answer, 'name', x.respondent_name)
            order by a.text_answer, x.respondent_name nulls first), '[]'::jsonb)
          from public.survey_answers a
          join public.survey_responses x on x.id = a.response_id
          where a.question_id = q.id
        ) end
      ) order by q.sort_order), '[]'::jsonb)
      from public.survey_questions q where q.survey_id = s.id
    ),
    -- Each named set of answers in full, by name.
    'respondents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', x.respondent_name,
        'submitted_at', x.submitted_at,
        'answers', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'question_id', a.question_id, 'choices', a.choices, 'rating', a.rating, 'text', a.text_answer
          )), '[]'::jsonb)
          from public.survey_answers a where a.response_id = x.id
        )
      ) order by x.respondent_name), '[]'::jsonb)
      from public.survey_responses x
      where x.survey_id = s.id and x.respondent_id is not null
    ),
    'waiting', v_waiting
  );
end;
$$;
revoke execute on function public.survey_results(uuid) from public, anon;
grant execute on function public.survey_results(uuid) to authenticated;

-- Every set of answers, for a spreadsheet: one row each. Only once results
-- show (see survey_results_wait). Named answers carry the name and time; anonymous
-- and unnamed ones carry neither and are listed in order of their answers,
-- not the order they came in. Downloading answers that name a child under 18
-- is logged against the child, as viewing them is.
create or replace function public.survey_export(p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.surveys;
  v_answered int;
  v_child uuid;
begin
  select * into s from public.surveys where id = p_survey_id;
  if s.id is null or not public.survey_can_export(s.id) then
    raise exception 'Survey not found';
  end if;
  select count(*) into v_answered from public.survey_responses where survey_id = s.id;
  if public.survey_results_wait(s) is not null then
    raise exception 'The results aren''t ready yet';
  end if;

  for v_child in
    select x.respondent_id from public.survey_responses x
    join public.profiles p on p.id = x.respondent_id
    where x.survey_id = s.id and public.is_minor(p.date_of_birth, p.under_17)
  loop
    -- Every download is logged, even soon after viewing them.
    perform public.write_record_access(v_child, 'survey_answers', s.id, true);
  end loop;

  return jsonb_build_object(
    'survey', public.survey_summary(s),
    'sent_to', (select count(*) from public.survey_recipients r
      where r.survey_id = s.id and r.for_children is null),
    'answered', v_answered,
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options,
        'rating_max', q.rating_max
      ) order by q.sort_order), '[]'::jsonb)
      from public.survey_questions q where q.survey_id = s.id
    ),
    'responses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', x.respondent_name, 'submitted_at', x.submitted_at, 'answers', x.answers
      ) order by x.respondent_name nulls last, x.answers::text), '[]'::jsonb)
      from (
        select r.respondent_name, r.submitted_at, (
          select coalesce(jsonb_agg(jsonb_build_object(
            'question_id', a.question_id, 'choices', a.choices, 'rating', a.rating, 'text', a.text_answer
          ) order by q.sort_order), '[]'::jsonb)
          from public.survey_answers a
          join public.survey_questions q on q.id = a.question_id
          where a.response_id = r.id
        ) as answers
        from public.survey_responses r
        where r.survey_id = s.id
      ) x
    ),
    'waiting', case when s.identity = 'named' then (
      select coalesce(jsonb_agg(public.member_display_name(r.profile_id)
        order by public.member_display_name(r.profile_id)), '[]'::jsonb)
      from public.survey_recipients r
      where r.survey_id = s.id and r.for_children is null and not r.responded
    ) else '[]'::jsonb end
  );
end;
$$;
revoke execute on function public.survey_export(uuid) from public, anon;
grant execute on function public.survey_export(uuid) to authenticated;

commit;
