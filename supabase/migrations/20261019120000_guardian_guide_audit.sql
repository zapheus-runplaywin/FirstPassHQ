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
-- 3. A parent or guardian who was approved before an admin verified them
--    keeps a 6-digit code on their home screen until they're verified, so an
--    admin can still check it in person (Matt, 19 October). Everyone else
--    has a code only while they wait for approval.
-- 4. A parent or guardian placed in their child's squad or team is not in
--    that group's survey audience in their own right (Matt, 19 October): they
--    get the copy naming their child, read the child's named answers and
--    never answer a squad survey themselves. Messages are unchanged: one copy
--    each, as the guide says. create_survey_base (the body behind
--    create_survey, not callable by members) is replaced; its privileges stay.
--
-- Additive only: four functions replaced. No rows are changed or deleted.

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

-- The signed-in member's code, made (or remade once expired) on request:
-- while they wait for approval, or while an approved parent or guardian is
-- not yet verified.
create or replace function public.my_verification_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (status <> 'approved'
        or (verified_at is null and (role = 'guardian' or 'guardian' = any (extra_roles))))
  ) then
    return null;
  end if;

  select code into v_code
  from public.verification_codes
  where profile_id = auth.uid() and expires_at > now();
  if v_code is not null then
    return v_code;
  end if;

  -- 6 random digits from a secure source.
  v_code := lpad(
    ((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text,
    6,
    '0'
  );
  insert into public.verification_codes (profile_id, code, expires_at)
  values (auth.uid(), v_code, now() + interval '7 days')
  on conflict (profile_id) do update
    set code = excluded.code, expires_at = excluded.expires_at;
  return v_code;
end;
$$;

create or replace function public.create_survey_base(
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
  p_share_with_admins boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_intro text := nullif(btrim(coalesce(p_intro, '')), '');
  v_opens timestamptz := coalesce(p_opens_at, now());
  v_sender public.profiles;
  v_team public.teams;
  v_survey_id uuid;
  v_question jsonb;
  v_kind public.survey_question_kind;
  v_prompt text;
  v_options text[];
  v_rating_max int;
  v_order int := 0;
  v_count int;
  v_sent_as text;
  v_quick_poll boolean;
begin
  if not public.surveys_on() then
    raise exception 'Surveys are turned off for this club';
  end if;
  if not public.is_approved() then
    raise exception 'Only approved members can make surveys';
  end if;
  select * into v_sender from public.profiles where id = auth.uid();
  if v_title = '' then
    raise exception 'Give the survey a title';
  end if;
  if length(v_title) > 120 then
    raise exception 'Titles can be up to 120 characters';
  end if;
  if length(v_intro) > 2000 then
    raise exception 'The introduction can be up to 2000 characters';
  end if;
  if p_identity is null then
    raise exception 'Choose whether answers are anonymous or named';
  end if;
  if p_closes_at is null or p_closes_at <= v_opens then
    raise exception 'Choose a closing day after it opens';
  end if;
  if p_closes_at <= now() then
    raise exception 'Choose a closing day in the future';
  end if;
  if p_closes_at > v_opens + interval '1 year' then
    raise exception 'Surveys can be open for up to a year';
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'Add at least one question';
  end if;
  if jsonb_array_length(p_questions) > 30 then
    raise exception 'Surveys can have up to 30 questions';
  end if;

  if p_audience in ('club', 'role') and not public.can_manage_surveys() then
    raise exception 'Only the committee and admins can send surveys to the club or a role';
  end if;
  if p_audience = 'club' then
    null;
  elsif p_audience = 'role' then
    if p_role is null then
      raise exception 'Choose a role to send it to';
    end if;
    if p_role in ('guest', 'volunteer') then
      raise exception 'Guests and temporary helpers don''t get surveys';
    end if;
  elsif p_audience = 'group' then
    select * into v_team from public.teams where id = p_team_id and not archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team to send it to';
    end if;
  else
    raise exception 'Choose who to send it to';
  end if;

  if public.can_manage_surveys() then
    v_sent_as := 'committee';
  elsif public.survey_leads_group(v_team.id) then
    v_sent_as := 'leader';
  elsif public.is_group_captain(v_team.id) and public.captain_polls_on() then
    v_sent_as := 'captain';
  else
    raise exception 'You can only send surveys to squads and teams you coach, manage or captain';
  end if;

  v_quick_poll := jsonb_array_length(p_questions) <= 5 and not exists (
    select 1 from jsonb_array_elements(p_questions) q
    where coalesce(q ->> 'kind', '') not in ('choice', 'multi_choice', 'rating')
  );

  -- A captain's poll is a few questions with choices to pick from, such as a
  -- night everyone is free. No written answers or ratings between teammates.
  if v_sent_as = 'captain' then
    if jsonb_array_length(p_questions) > 5 then
      raise exception 'Captains'' polls can have up to 5 questions';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_questions) q
      where coalesce(q ->> 'kind', '') not in ('choice', 'multi_choice')
    ) then
      raise exception 'Captains'' polls can only have questions with choices';
    end if;
  end if;

  insert into public.surveys (
    title, intro, identity, audience, audience_role, team_id, audience_label,
    opens_at, closes_at, created_by, created_by_name, sent_as, share_with_committee,
    share_with_admins
  )
  values (
    v_title, v_intro, p_identity, p_audience,
    case when p_audience = 'role' then p_role end,
    v_team.id, v_team.name, v_opens, p_closes_at, v_sender.id,
    public.member_display_name(v_sender.id), v_sent_as,
    v_sent_as = 'leader' and coalesce(p_share_with_committee, false),
    -- Only a quick poll can stay in the team.
    v_sent_as = 'leader' and (not v_quick_poll or coalesce(p_share_with_admins, false)
      or coalesce(p_share_with_committee, false))
  )
  returning id into v_survey_id;

  for v_question in select * from jsonb_array_elements(p_questions) loop
    v_order := v_order + 1;
    begin
      v_kind := (v_question ->> 'kind')::public.survey_question_kind;
    exception when others then
      raise exception 'Question % has no type', v_order;
    end;
    v_prompt := btrim(coalesce(v_question ->> 'prompt', ''));
    if v_prompt = '' then
      raise exception 'Question % needs wording', v_order;
    end if;
    if length(v_prompt) > 300 then
      raise exception 'Question % can be up to 300 characters', v_order;
    end if;
    v_options := null;
    v_rating_max := null;
    if v_kind in ('choice', 'multi_choice') then
      select array_agg(btrim(o) order by n) into v_options
      from jsonb_array_elements_text(coalesce(v_question -> 'options', '[]'::jsonb))
        with ordinality as t(o, n)
      where btrim(o) <> '';
      if coalesce(array_length(v_options, 1), 0) < 2 then
        raise exception 'Question % needs at least two choices', v_order;
      end if;
      if array_length(v_options, 1) > 12 then
        raise exception 'Question % can have up to 12 choices', v_order;
      end if;
      if exists (select 1 from unnest(v_options) o where length(o) > 100) then
        raise exception 'Choices in question % can be up to 100 characters', v_order;
      end if;
    elsif v_kind = 'rating' then
      v_rating_max := coalesce((v_question ->> 'rating_max')::int, 5);
      if v_rating_max not between 2 and 10 then
        raise exception 'Question % needs a scale of 2 to 10', v_order;
      end if;
    end if;
    insert into public.survey_questions (survey_id, sort_order, kind, prompt, options, rating_max, required)
    values (
      v_survey_id, v_order, v_kind, v_prompt, v_options, v_rating_max,
      coalesce((v_question ->> 'required')::boolean, true)
    );
  end loop;

  -- The same people a message to this audience reaches.
  with audience as (
    select p.id, p.role, p.extra_roles, p.date_of_birth, p.under_17
    from public.profiles p
    where p.status = 'approved'
      and p.role not in ('guest', 'volunteer')
      and (not public.is_view_only_member(p.role, p.extra_roles)
        or p_audience = 'role'
        or p_audience = 'group'
        or (p_audience = 'club' and public.physios_get_club_messages()))
      and case p_audience
        when 'club' then true
        when 'role' then p.role = p_role or p_role = any (p.extra_roles)
        -- A parent or guardian placed in the squad or team isn't in its
        -- audience in their own right: they get the copy naming their child
        -- (Matt, 19 October).
        else exists (
          select 1 from public.team_members tm
          where tm.team_id = v_team.id and tm.profile_id = p.id
            and tm.team_role::text <> 'guardian'
        )
      end
  )
  -- A parent or guardian's copy names the children it's for. A member who is
  -- in the audience themselves answers it in their own right.
  insert into public.survey_recipients (survey_id, profile_id, for_children, for_child_names)
  select
    v_survey_id,
    r.id,
    case when bool_or(r.child_id is null) then null
      else array_agg(r.child_id order by r.child_name, r.child_id) end,
    case when bool_or(r.child_id is null) then null
      else array_agg(r.child_name order by r.child_name, r.child_id) end
  from (
    select a.id, null::uuid as child_id, null::text as child_name from audience a
    union all
    select g.guardian_id, a.id, public.member_display_name(a.id)
    from audience a
    join public.guardianships g on g.athlete_id = a.id
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where (a.role = 'athlete' or 'athlete' = any (a.extra_roles))
      and public.is_minor(a.date_of_birth, a.under_17)
      and a.id <> v_sender.id
  ) r
  where r.id <> v_sender.id
  group by r.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the survey too.
    raise exception 'Nobody else is in that group yet';
  end if;

  -- Parents and guardians of a child who sends one (a captain) get a copy
  -- too, as they do of the child's messages. They can't answer it.
  if (v_sender.role = 'athlete' or 'athlete' = any (v_sender.extra_roles))
     and public.is_minor(v_sender.date_of_birth, v_sender.under_17) then
    insert into public.survey_recipients (survey_id, profile_id, for_children, for_child_names)
    select v_survey_id, g.guardian_id, array[v_sender.id], array[public.member_display_name(v_sender.id)]
    from public.guardianships g
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where g.athlete_id = v_sender.id
    on conflict (survey_id, profile_id) do update
      set for_children = public.survey_recipients.for_children || excluded.for_children,
          for_child_names = public.survey_recipients.for_child_names || excluded.for_child_names
      -- A guardian who got it in their own right keeps no children named.
      where public.survey_recipients.for_children is not null
        and not (v_sender.id = any (public.survey_recipients.for_children));
  end if;

  return v_survey_id;
end;
$$;

commit;
