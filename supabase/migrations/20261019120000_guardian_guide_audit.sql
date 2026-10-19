-- Fixes from the parent and guardian guide audit (19 October 2026).
--
-- 1. A parent or guardian placed in a squad or team is a member of it again:
--    20261017070000 made is_team_member need can_work_with_children() for
--    every placement that isn't an athlete's, which guardians (who have no
--    Working With Children Check) never pass. Since then a guardian in their
--    child's squad has had no squad calendar, fixtures or roster, although the
--    guide promises them. Guardian placements now count like athletes'; paused
--    coaches, managers and physios are still shut out.
-- 2. A parent or guardian reads their child's named survey answers only until
--    the child turns 18, like every other guardian right (is_guardian_of).
--
-- Additive only: two functions replaced. No rows are changed or deleted.

begin;

-- A member of the squad or team: an athlete or a parent or guardian placed in
-- it, or a coach, manager or physio placed in it who may work with children
-- right now.
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id and tm.profile_id = auth.uid() and p.status = 'approved'
      and (tm.team_role::text in ('athlete', 'guardian') or public.can_work_with_children())
  );
$$;

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
  -- still that child's parent or guardian, which ends on the child's 18th
  -- birthday.
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
      -- Until the child turns 18, like every other guardian right.
      and public.is_guardian_of(c.child_id);
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

commit;
