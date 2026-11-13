-- What the Studio role can read, and a parent's consent to show their child's
-- stats on a live stream.
--
-- Matt (2026-11-13): FirstPass Studio makes the graphics for live streams of
-- games. Once it shows FirstPass stats it holds private data about athletes,
-- many under 18, that PlayHQ never publishes, so instead of a key it signs in
-- to each club like a member. The person running Studio signs in with their
-- own Google account and a club admin gives them the Studio role, so the club
-- knows who sees its stats and can cut one person off at any time.
--
-- What the role reads (design: the architecture doc's "Studio access" tab):
-- - Games with a PlayHQ game id that are live or final: the game's header
--   (PlayHQ game id, status, squad or team, setup), its primary-stream events
--   and its break snapshots, through studio_games and studio_live, row level
--   security on game_events and game_snapshots, and the game's private
--   Realtime topic game:<id>. One rule decides: studio_game_ids.
-- - The line-up for those games, with whether each athlete may be shown by
--   name with their own stats (studio_lineup).
-- - Never: scratch or practice games (no PlayHQ game id), games still being
--   set up, shadow streams, pair codes, who recorded or paired, members'
--   contact details, guardians, injuries, medical details or anything else in
--   HQ. Studio writes nothing.
-- - A stand-down pauses the role, and removing it cuts Studio off from every
--   one of these at once.
-- - No Working With Children Check (Matt, 2026-11-13): a Studio operator
--   isn't with the team and the role never reads sensitive data.
--
-- Someone whose main role is Studio, such as a streamer from outside the
-- club, isn't a club member: like a temporary helper they aren't an "approved
-- member" for squads, calendars, awards or training, and like a guest they
-- get no messages or surveys, aren't nominated for awards and aren't asked to
-- accept the code of conduct. A member can also hold Studio alongside their
-- own roles.
--
-- Stats on a live stream (Matt, 2026-11-13, decision 14): an athlete under 18
-- is shown by name with their own stats only when a verified parent or
-- guardian has given the new "publish" consent; otherwise Studio shows team
-- totals only. Adults don't need it, as for the other consents. It is given
-- and withdrawn through set_child_publish_consent, and my_child_consents
-- returns it beside the other two.
--
-- Additive only: new functions, new versions of existing ones and new
-- policies. No rows change.

begin;

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

-- A stand-down pauses Studio, like Admin. Same as before otherwise.
CREATE OR REPLACE FUNCTION public.has_role(p_role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved'
      and (p.role = p_role or p_role = any (p.extra_roles))
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
      and case
        when p_role in ('coach', 'manager', 'physio') then
          p.stood_down_at is null and public.is_cleared(p.id)
        when p_role = 'committee' then
          p.stood_down_at is null and (
            coalesce(trim(p.wwcc_exempt_reason), '') <> ''
            or (
              coalesce(trim(p.wwcc_number), '') = ''
              and current_date < coalesce(public.committee_checks_from(), current_date + 1)
            )
            or public.has_current_wwcc(p.id)
            or public.wwcc_application_valid(p.id)
          )
        when p_role = 'statistician' then
          p.stood_down_at is null and (
            coalesce(trim(p.wwcc_exempt_reason), '') <> ''
            or (
              coalesce(trim(p.wwcc_number), '') = ''
              and current_date < coalesce(public.statistician_checks_from(), current_date + 1)
            )
            or public.is_cleared(p.id)
          )
        when p_role in ('admin', 'studio') then p.stood_down_at is null
        else true
      end
  );
$function$

;

-- Someone whose main role is Studio isn't an approved member of the club,
-- like a temporary helper. Same as before otherwise.
CREATE OR REPLACE FUNCTION public.is_approved()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved' and p.role not in ('volunteer', 'studio')
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
  );
$function$

;

-- Nor do they get messages, as for guests and temporary helpers. Same as
-- before otherwise.
CREATE OR REPLACE FUNCTION public.send_group_message(p_body text, p_audience message_audience, p_role app_role DEFAULT NULL::app_role, p_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_sender public.profiles;
  v_team public.teams;
  v_message_id uuid;
  v_count int;
begin
  select * into v_sender from public.profiles where id = auth.uid();
  if v_sender.id is null or v_sender.status <> 'approved' then
    raise exception 'Only approved members can send messages';
  end if;
  if v_body = '' then
    raise exception 'Write a message first';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Messages can be up to 4000 characters';
  end if;

  if p_audience = 'club' then
    -- is_committee() is true for admins too.
    if not (public.is_committee() or public.is_club_captain()) then
      raise exception 'Only admins, the committee and club captains can message the whole club';
    end if;
  elsif p_audience = 'role' then
    if not public.is_admin() then
      raise exception 'Only admins can message a role';
    end if;
    if p_role is null then
      raise exception 'Choose a role to message';
    end if;
    if p_role in ('guest', 'volunteer', 'studio') then
      raise exception 'Guests, temporary helpers and Studio don''t get messages';
    end if;
  else
    select * into v_team from public.teams where id = p_team_id and not archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team to message';
    end if;
    if not public.can_message_group(v_team.id) then
      raise exception 'You can only message squads and teams you coach, manage or captain';
    end if;
  end if;

  insert into public.messages (
    sender_id, sender_name, body, audience, audience_role, team_id, audience_label
  )
  values (
    v_sender.id,
    coalesce(nullif(v_sender.full_name, ''), v_sender.email),
    v_body,
    p_audience,
    case when p_audience = 'role' then p_role end,
    v_team.id,
    v_team.name
  )
  returning id into v_message_id;

  with audience as (
    select p.id, p.role, p.extra_roles, p.date_of_birth, p.under_17
    from public.profiles p
    where p.status = 'approved'
      and p.role not in ('guest', 'volunteer', 'studio')
      and (not public.is_view_only_member(p.role, p.extra_roles)
        or p_audience = 'role'
        or p_audience = 'group'
        or (p_audience = 'club' and public.physios_get_club_messages()))
      and case p_audience
        when 'club' then true
        when 'role' then p.role = p_role or p_role = any (p.extra_roles)
        -- A placement as a guardian doesn't put someone in the audience in
        -- their own right: they get the copy that names their child, as for
        -- surveys (admin guide audit, 20 October: guardians are placed in a
        -- team with their athlete).
        else exists (
          select 1 from public.team_members tm
          where tm.team_id = v_team.id and tm.profile_id = p.id
            and tm.team_role::text <> 'guardian'
        )
      end
  )
  -- A guardian's copy names the children it's for. A member who is in the
  -- audience themselves has no children named, since the message is theirs.
  insert into public.message_recipients (message_id, profile_id, for_children, for_child_names)
  select
    v_message_id,
    r.id,
    case when bool_or(r.child_id is null) then null
      else array_agg(r.child_id order by r.child_name, r.child_id) end,
    case when bool_or(r.child_id is null) then null
      else array_agg(r.child_name order by r.child_name, r.child_id) end
  from (
    select a.id, null::uuid as child_id, null::text as child_name from audience a
    union all
    -- Guardians of children who received it.
    select g.guardian_id, a.id, public.member_display_name(a.id)
    from audience a
    join public.guardianships g on g.athlete_id = a.id
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where (a.role = 'athlete' or 'athlete' = any (a.extra_roles))
      and public.is_minor(a.date_of_birth, a.under_17)
  ) r
  where r.id <> v_sender.id
  group by r.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the message too.
    raise exception 'Nobody else is in that group yet';
  end if;

  -- Guardians of a child who sends a message (a captain or junior coach) get a copy too.
  if (v_sender.role = 'athlete' or 'athlete' = any (v_sender.extra_roles))
     and public.is_minor(v_sender.date_of_birth, v_sender.under_17) then
    insert into public.message_recipients (message_id, profile_id, for_children, for_child_names)
    select v_message_id, g.guardian_id, array[v_sender.id], array[public.member_display_name(v_sender.id)]
    from public.guardianships g
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where g.athlete_id = v_sender.id
    on conflict (message_id, profile_id) do update
      set for_children = public.message_recipients.for_children || excluded.for_children,
          for_child_names = public.message_recipients.for_child_names || excluded.for_child_names
      -- A guardian who got it in their own right keeps no children named, and
      -- a child already named isn't named twice.
      where public.message_recipients.for_children is not null
        and not (v_sender.id = any (public.message_recipients.for_children));
  end if;

  return v_message_id;
end;
$function$

;

-- Or surveys. Same as before otherwise.
CREATE OR REPLACE FUNCTION public.create_survey_base(p_title text, p_intro text, p_identity survey_identity, p_audience survey_audience, p_role app_role, p_team_id uuid, p_opens_at timestamp with time zone, p_closes_at timestamp with time zone, p_questions jsonb, p_share_with_committee boolean DEFAULT false, p_share_with_admins boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if p_role in ('guest', 'volunteer', 'studio') then
      raise exception 'Guests, temporary helpers and Studio don''t get surveys';
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
      and p.role not in ('guest', 'volunteer', 'studio')
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
$function$

;

-- They aren't nominated for awards given to every member. Same as before
-- otherwise.
CREATE OR REPLACE FUNCTION public.award_nominee_pool(p_award_id uuid, p_team_id uuid)
 RETURNS TABLE(id uuid, is_candidate boolean, name text, date_of_birth date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select distinct p.id, false, coalesce(nullif(p.full_name, ''), p.email), p.date_of_birth
  from public.awards a
  join public.team_members tm
    on tm.team_role = case a.nominees when 'coaches' then 'coach'::public.team_role
                                      else 'athlete'::public.team_role end
  join public.profiles p on p.id = tm.profile_id and p.status = 'approved'
  where a.id = p_award_id
    and a.nominees in ('athletes', 'coaches')
    and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
    and p.id is distinct from auth.uid()
  union all
  select p.id, false, coalesce(nullif(p.full_name, ''), p.email), p.date_of_birth
  from public.awards a
  join public.profiles p on p.status = 'approved' and p.role not in ('guest', 'volunteer', 'studio')
  where a.id = p_award_id
    and a.nominees = 'members'
    and (not a.per_group or exists (
      select 1 from public.team_members tm
      join public.teams g on g.id = p_team_id
      where tm.profile_id = p.id
        and (tm.team_id = g.id or tm.team_id in (select c.id from public.teams c where c.squad_id = g.id))
    ))
    and p.id is distinct from auth.uid()
  union all
  select c.id, true, c.name, null::date
  from public.awards a
  join public.award_candidates c on c.award_id = a.id
  where a.id = p_award_id
    and a.nominees = 'listed';
$function$

;

-- And Studio on its own doesn't ask for the code of conduct, as for guests.
CREATE OR REPLACE FUNCTION public.conduct_required(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
      select 1 from public.safeguarding_settings s
      where s.id and s.conduct_each_season and coalesce(trim(s.code_of_conduct_url), '') <> ''
    )
    and exists (
      select 1 from public.profiles p
      where p.id = p_profile_id
        and p.status = 'approved'
        and exists (
          select 1 from unnest(array[p.role] || coalesce(p.extra_roles, '{}'::public.app_role[])) r
          where r not in ('guest', 'volunteer', 'studio')
        )
    );
$function$

;

-- An admin can stand a Studio operator down, which pauses the role. Same as
-- before otherwise.
CREATE OR REPLACE FUNCTION public.admin_stand_down(p_profile_id uuid, p_reason text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.profiles;
  v_note text := nullif(trim(p_note), '');
  v_placements jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can stand members down';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if not public.roles_of(v_member.role, v_member.extra_roles)
     && array['coach', 'manager', 'physio', 'committee', 'admin', 'volunteer', 'statistician', 'studio']::public.app_role[] then
    raise exception 'Only coaches, managers, physios, committee members, admins, Studio operators, statisticians and temporary helpers can be stood down';
  end if;
  if v_member.stood_down_at is not null then
    raise exception 'They''re already stood down';
  end if;
  if p_reason is null or p_reason not in (
    'interim_negative_notice', 'negative_notice', 'interstate_decision', 'allegation', 'other'
  ) then
    raise exception 'Choose why they''re being stood down';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'Say why they''re being stood down';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', tm.team_id, 'team_role', tm.team_role, 'coach_title', tm.coach_title
  )), '[]'::jsonb)
  into v_placements
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.profile_id = p_profile_id
    and tm.team_role in ('coach', 'manager', 'physio')
    and not t.archived;

  delete from public.team_members tm
  using public.teams t
  where t.id = tm.team_id
    and tm.profile_id = p_profile_id
    and tm.team_role in ('coach', 'manager', 'physio')
    and not t.archived;

  update public.profiles set stood_down_at = now() where id = p_profile_id;

  insert into public.stand_downs (
    profile_id, member_name, reason, note, placements, started_by, started_by_name
  )
  values (
    p_profile_id,
    coalesce(nullif(v_member.full_name, ''), v_member.email, 'Unnamed member'),
    p_reason,
    v_note,
    v_placements,
    auth.uid(),
    public.my_display_name()
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Which games Studio reads
-- ---------------------------------------------------------------------------

-- The games the signed-in member reads as Studio: live or final games with a
-- PlayHQ game id, the ones a stream shows. None for anyone else, or while
-- their Studio role is paused. Worked out once per read, for the row level
-- security below.
create or replace function public.studio_game_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.id
  from public.games g
  where g.status in ('live', 'final')
    and coalesce(trim(g.playhq_game_id), '') <> ''
    and public.has_role('studio');
$$;

revoke execute on function public.studio_game_ids() from public, anon;
grant execute on function public.studio_game_ids() to authenticated;

-- Whether the signed-in member reads this game as Studio.
create or replace function public.can_studio_read_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_game_id in (select public.studio_game_ids());
$$;

revoke execute on function public.can_studio_read_game(uuid) from public, anon;
grant execute on function public.can_studio_read_game(uuid) to authenticated;

-- Primary events and snapshots of those games. Never a shadow stream.
drop policy if exists "Studio reads streamed games' events" on public.game_events;
create policy "Studio reads streamed games' events"
  on public.game_events for select to authenticated
  using (stream = 'primary' and game_id in (select public.studio_game_ids()));

drop policy if exists "Studio reads streamed games' snapshots" on public.game_snapshots;
create policy "Studio reads streamed games' snapshots"
  on public.game_snapshots for select to authenticated
  using (game_id in (select public.studio_game_ids()));

-- Live events arrive on the game's private Realtime topic, as for Vision.
-- Only primary events are ever sent there.
drop policy if exists "Studio follows streamed games" on realtime.messages;
create policy "Studio follows streamed games"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'game:%'
    and substring(realtime.topic() from 6) in (select g::text from public.studio_game_ids() g)
  );

-- The games Studio can show, newest first: what it needs to match a game on
-- its scoreboard to the club's record by PlayHQ game id. Not who recorded or
-- paired, the device, or the pair code.
create or replace function public.studio_games()
returns table (
  id uuid,
  playhq_game_id text,
  status public.game_status,
  team_id uuid,
  team_name text,
  config jsonb,
  created_at timestamptz,
  finished_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.playhq_game_id, g.status, g.team_id, t.name, g.config, g.created_at, g.finished_at
  from public.games g
  left join public.teams t on t.id = g.team_id
  where g.id in (select public.studio_game_ids())
  order by g.created_at desc;
$$;

revoke execute on function public.studio_games() from public, anon;
grant execute on function public.studio_games() to authenticated;

-- Catching up on a game: its header, the latest snapshot after p_after_seq
-- (if any), and up to 1000 primary events after that, oldest first. Studio
-- calls it when it starts showing a game or after a gap, and follows the
-- Realtime topic otherwise. "more" says there are more events to fetch.
create or replace function public.studio_live(p_game_id uuid, p_after_seq int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_game jsonb;
  v_snapshot public.game_snapshots;
  v_from int := greatest(coalesce(p_after_seq, 0), 0);
  v_events jsonb;
  v_more boolean;
begin
  if not public.can_studio_read_game(p_game_id) then
    raise exception 'Studio can only read live and finished PlayHQ games' using errcode = '42501';
  end if;

  select to_jsonb(s) into v_game
  from public.studio_games() s
  where s.id = p_game_id;

  select * into v_snapshot
  from public.game_snapshots
  where game_id = p_game_id and through_seq > v_from
  order by through_seq desc
  limit 1;
  if v_snapshot.game_id is not null then
    v_from := v_snapshot.through_seq;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'gameId', e.game_id, 'stream', e.stream, 'seq', e.seq,
           'type', e.type, 'payload', e.payload, 'recordedAt', e.recorded_at
         ) order by e.seq), '[]'::jsonb)
  into v_events
  from (
    select * from public.game_events
    where game_id = p_game_id and stream = 'primary' and seq > v_from
    order by seq
    limit 1000
  ) e;

  select exists (
    select 1 from public.game_events
    where game_id = p_game_id and stream = 'primary'
      and seq > coalesce((select max((x ->> 'seq')::int) from jsonb_array_elements(v_events) x), v_from)
  ) into v_more;

  return jsonb_build_object(
    'game', v_game,
    'snapshot', case when v_snapshot.game_id is null then null else jsonb_build_object(
      'throughSeq', v_snapshot.through_seq,
      'engineVersion', v_snapshot.engine_version,
      'state', v_snapshot.state,
      'createdAt', v_snapshot.created_at
    ) end,
    'events', v_events,
    'more', v_more
  );
end;
$$;

revoke execute on function public.studio_live(uuid, int) from public, anon;
grant execute on function public.studio_live(uuid, int) to authenticated;

-- The athletes of a streamed game's squad or team, as for the line-up in
-- Vantage: their name as they like it, final team or training partner, and
-- whether they may be shown by name with their own stats. An athlete under 18
-- may only when a verified parent or guardian has given the publish consent;
-- for the rest Studio shows team totals.
create or replace function public.studio_lineup(p_game_id uuid)
returns table (
  profile_id uuid,
  name text,
  selection public.team_selection,
  may_publish boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_studio_read_game(p_game_id) then
    raise exception 'Studio can only read live and finished PlayHQ games' using errcode = '42501';
  end if;
  return query
    select tm.profile_id, coalesce(nullif(trim(p.preferred_name), ''), p.full_name), tm.selection,
           public.has_child_consent(tm.profile_id, 'publish')
    from public.games g
    join public.team_members tm on tm.team_id = g.team_id and tm.team_role = 'athlete'
    join public.profiles p on p.id = tm.profile_id
    where g.id = p_game_id
      and p.status = 'approved'
    order by
      case tm.selection when 'touring' then 0 when 'training_partner' then 1 else 2 end,
      p.full_name;
end;
$$;

revoke execute on function public.studio_lineup(uuid) from public, anon;
grant execute on function public.studio_lineup(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Consent to show a child's stats on a live stream
-- ---------------------------------------------------------------------------

-- A verified parent or guardian gives or withdraws the publish consent for
-- their child, kept like the others with who, when and the policy version.
-- Separate from set_child_consent, so apps that don't ask for it yet are
-- unchanged.
create or replace function public.set_child_publish_consent(p_athlete_id uuid, p_publish boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := (select policy_version from public.safeguarding_settings where id);
begin
  if not public.is_verified_guardian_of(p_athlete_id) then
    raise exception 'Only a verified parent or guardian of an athlete under 18 can give consent';
  end if;
  if p_publish is null then
    raise exception 'Choose yes or no for each consent';
  end if;
  if p_publish then
    insert into public.child_consents (athlete_id, kind, given_by, given_by_name, policy_version)
    values (p_athlete_id, 'publish', auth.uid(), public.my_display_name(), coalesce(v_version, '1'))
    on conflict (athlete_id, kind) where withdrawn_at is null do nothing;
  else
    update public.child_consents
    set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_by_name = public.my_display_name()
    where athlete_id = p_athlete_id and kind = 'publish' and withdrawn_at is null;
  end if;
end;
$$;

revoke execute on function public.set_child_publish_consent(uuid, boolean) from public, anon;
grant execute on function public.set_child_publish_consent(uuid, boolean) to authenticated;

-- A guardian's children under 18 and the consents in force, now with publish.
drop function if exists public.my_child_consents();
create or replace function public.my_child_consents()
returns table (
  athlete_id uuid,
  full_name text,
  data boolean,
  health boolean,
  publish boolean,
  can_consent boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.profile_id, a.full_name,
    public.has_child_consent(a.profile_id, 'data'),
    public.has_child_consent(a.profile_id, 'health'),
    public.has_child_consent(a.profile_id, 'publish'),
    public.is_verified_guardian_of(a.profile_id)
  from public.my_athletes() a;
$$;

revoke execute on function public.my_child_consents() from public, anon;
grant execute on function public.my_child_consents() to authenticated;

commit;
