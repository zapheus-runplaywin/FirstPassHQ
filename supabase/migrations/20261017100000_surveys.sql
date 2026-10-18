-- Surveys (Matt, 17 October 2026).
--
-- The committee and admins create surveys and send them to everyone, a role,
-- or a squad or team, the same audiences as messages. Coaches and managers
-- send surveys and quick polls to the squads and teams they coach or manage,
-- and captains and vice captains send polls with choices to the squad or team
-- they captain, such as finding a night everyone is free (Matt, 17 October
-- 2026). Each survey is one of:
--   - anonymous: nobody can ever see who gave which answers;
--   - named: every answer carries the member's name;
--   - optional: each member chooses whether to give their name.
-- Questions are a single choice, several choices, a rating, or free text.
-- A survey opens and closes on set days; the person who made it, or an
-- admin, can close it early or change the closing day. Questions can't be
-- changed once it's sent, so every answer was given to the same questions.
--
-- Who sees results: the committee and admins for the surveys the committee
-- and admins send. A coach or manager's quick poll (up to 5 questions with
-- choices or ratings) can stay a team thing: only they see it, while they
-- still coach or manage that group with a current check. Anything longer, or
-- with a written answer, always goes to admins too, so the club can see what
-- coaches ask children (Matt, 17 October 2026). Coaches can also share with
-- admins, or with admins and the committee, by choice. A
-- captain's poll is seen by the captain who sent it and by the group's
-- coaches and managers. Members never see each other's answers.
--
-- Anonymous answers are kept apart from who answered:
--   - survey_recipients records only whether each member has answered, with
--     no time, so it can't be lined up with an answer;
--   - an anonymous answer (or an optional one without a name) is stored with
--     no member, no name and no time;
--   - anonymous and optional surveys show results only once they've closed
--     and at least three people have answered (so nobody can watch results
--     change as each person answers), free text is listed in alphabetical order rather
--     than the order it came in, and nobody is told who has or hasn't
--     answered (only how many);
--   - nothing about an anonymous answer goes in the record access log.
-- Nobody reads these tables directly: everything goes through the functions
-- below.
--
-- Children: a parent or guardian gets a copy of every survey sent to their
-- child under 18, naming the child, so they know what their child is asked.
-- Only the child answers. A parent or guardian can read their child's named
-- answers; nobody, including them, can read an anonymous one. When anyone
-- opens results that name a child under 18, the view
-- goes in the child's record access log.
--
-- Keep periods for surveys go under Club settings > Keeping records.
--
-- Additive only: new types, tables and functions, three club_settings
-- columns with defaults, and the record access log gains a kind. No rows are
-- changed. Surveys are removed after their keep period only by the nightly
-- clean-up, and only once an admin switches on "Remove old records".

begin;

do $$ begin
  create type public.survey_identity as enum ('anonymous', 'named', 'optional');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.survey_audience as enum ('club', 'role', 'group');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.survey_question_kind as enum ('choice', 'multi_choice', 'rating', 'text');
exception when duplicate_object then null; end $$;

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  intro text check (length(intro) <= 2000),
  identity public.survey_identity not null,
  audience public.survey_audience not null,
  audience_role public.app_role,
  team_id uuid references public.teams (id) on delete set null,
  -- The squad or team's name when it was sent, kept if it's renamed.
  audience_label text,
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  -- Who it was sent as: 'committee' (the committee or an admin), 'leader' (a
  -- coach or manager of the group) or 'captain' (a captain or vice captain).
  sent_as text not null default 'committee' check (sent_as in ('committee', 'leader', 'captain')),
  -- Who else sees a coach or manager's survey: admins (always, for a survey
  -- longer than a quick poll or with a written answer), and the committee
  -- if the coach chooses. Sharing with the committee shares with admins too.
  share_with_admins boolean not null default false,
  share_with_committee boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint surveys_dates check (closes_at > opens_at)
);

create index if not exists surveys_created_idx on public.surveys (created_at desc);

create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  sort_order int not null,
  kind public.survey_question_kind not null,
  prompt text not null check (length(btrim(prompt)) between 1 and 300),
  -- The choices, for choice and multi_choice questions.
  options text[],
  -- The top of the scale, for rating questions (1 to rating_max).
  rating_max int check (rating_max between 2 and 10),
  required boolean not null default true,
  unique (survey_id, sort_order)
);

-- Who it was sent to, taken when it was sent, like message_recipients.
-- `responded` has no time on purpose: see the note at the top.
create table if not exists public.survey_recipients (
  survey_id uuid not null references public.surveys (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- For a parent or guardian's copy: the children it was sent for. Null when
  -- the survey is the member's own to answer.
  for_children uuid[],
  for_child_names text[],
  responded boolean not null default false,
  primary key (survey_id, profile_id)
);

create index if not exists survey_recipients_profile_idx on public.survey_recipients (profile_id);

-- One set of answers. respondent_id, respondent_name and submitted_at are
-- null for anonymous answers and for optional ones given without a name.
create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  respondent_id uuid references public.profiles (id) on delete set null,
  respondent_name text,
  submitted_at timestamptz
);

create index if not exists survey_responses_survey_idx on public.survey_responses (survey_id);
create unique index if not exists survey_responses_named_idx
  on public.survey_responses (survey_id, respondent_id) where respondent_id is not null;

create table if not exists public.survey_answers (
  response_id uuid not null references public.survey_responses (id) on delete cascade,
  question_id uuid not null references public.survey_questions (id) on delete cascade,
  -- Positions in survey_questions.options, counting from 0.
  choices int[],
  rating int,
  text_answer text check (length(text_answer) <= 2000),
  primary key (response_id, question_id)
);

create index if not exists survey_answers_question_idx on public.survey_answers (question_id);

alter table public.surveys enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_recipients enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_answers enable row level security;
revoke all on public.surveys from public, anon, authenticated;
revoke all on public.survey_questions from public, anon, authenticated;
revoke all on public.survey_recipients from public, anon, authenticated;
revoke all on public.survey_responses from public, anon, authenticated;
revoke all on public.survey_answers from public, anon, authenticated;

-- The access log gains named survey answers.
alter table public.record_access_log drop constraint if exists record_access_log_kind_check;
alter table public.record_access_log add constraint record_access_log_kind_check check (
  kind in (
    'injury', 'injury_document', 'injury_document_shared', 'check_ins', 'goals', 'member_record',
    'kpis', 'survey_answers'
  )
);

-- ---------------------------------------------------------------------------
-- Who can do what
-- ---------------------------------------------------------------------------

-- Whether the club has surveys switched on (Club settings). On unless an
-- admin has turned them off.
create or replace function public.surveys_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.features ->> 'surveys')::boolean is distinct from false
     from public.club_settings s where s.id),
    true
  );
$$;
revoke execute on function public.surveys_on() from public, anon;
grant execute on function public.surveys_on() to authenticated;

-- Whether captains and vice captains can send polls (Club settings, on
-- unless an admin turns it off). Polls already sent stay readable.
create or replace function public.captain_polls_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.features ->> 'captainPolls')::boolean is distinct from false
     from public.club_settings s where s.id),
    true
  );
$$;
revoke execute on function public.captain_polls_on() from public, anon;
grant execute on function public.captain_polls_on() to authenticated;

-- The committee and admins make surveys and read their results.
-- is_committee() is true for admins too.
create or replace function public.can_manage_surveys()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and public.is_committee();
$$;
revoke execute on function public.can_manage_surveys() from public, anon;
grant execute on function public.can_manage_surveys() to authenticated;

-- Whether the signed-in member coaches or manages this squad or team with a
-- current check. Archived groups count only when p_archived_too, so a coach
-- can still read their survey's results after the season ends.
create or replace function public.survey_leads_group(p_team_id uuid, p_archived_too boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and public.can_work_with_children() and exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role in ('coach', 'manager')
      and (p_archived_too or not t.archived)
  );
$$;
revoke execute on function public.survey_leads_group(uuid, boolean) from public, anon;
grant execute on function public.survey_leads_group(uuid, boolean) to authenticated;

-- Whether the signed-in member manages this survey and reads its results:
--   - the committee and admins, for surveys sent as the committee and ones a
--     coach or manager shared with the committee;
--   - admins, for coach and manager surveys shared with admins (every one
--     longer than a quick poll or with a written answer);
--   - a coach or manager, for one they sent to a group they still coach or
--     manage;
--   - a captain or vice captain, for a poll they sent while they still
--     captain that group;
--   - the group's coaches and managers, for a captain's poll.
create or replace function public.survey_can_see_results(p_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.surveys_on() and exists (
    select 1 from public.surveys s
    where s.id = p_survey_id
      and (
        (public.can_manage_surveys() and (s.sent_as = 'committee' or s.share_with_committee))
        or (public.is_approved() and public.is_admin() and s.share_with_admins)
        or (s.created_by = auth.uid() and s.team_id is not null and (
          (s.sent_as = 'leader' and public.survey_leads_group(s.team_id, true))
          or (s.sent_as = 'captain' and public.is_group_captain(s.team_id))
        ))
        or (s.sent_as = 'captain' and s.team_id is not null
          and public.survey_leads_group(s.team_id, true))
      )
  );
$$;
revoke execute on function public.survey_can_see_results(uuid) from public, anon;
grant execute on function public.survey_can_see_results(uuid) to authenticated;

-- Results show for anonymous and optional surveys only once this many have answered.
create or replace function public.survey_min_responses()
returns int
language sql
immutable
set search_path = ''
as $$ select 3 $$;
revoke execute on function public.survey_min_responses() from public, anon;
grant execute on function public.survey_min_responses() to authenticated;

-- ---------------------------------------------------------------------------
-- Making a survey
-- ---------------------------------------------------------------------------

-- p_questions is a JSON array of
--   {"kind": "choice"|"multi_choice"|"rating"|"text", "prompt": "...",
--    "options": ["...", ...], "rating_max": 5, "required": true}
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
        else exists (
          select 1 from public.team_members tm
          where tm.team_id = v_team.id and tm.profile_id = p.id
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
revoke execute on function public.create_survey(text, text, public.survey_identity, public.survey_audience, public.app_role, uuid, timestamptz, timestamptz, jsonb, boolean, boolean) from public, anon;
grant execute on function public.create_survey(text, text, public.survey_identity, public.survey_audience, public.app_role, uuid, timestamptz, timestamptz, jsonb, boolean, boolean) to authenticated;

-- Whether the signed-in member can change when this survey closes.
create or replace function public.survey_can_close(p_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.survey_can_see_results(p_survey_id) and exists (
    select 1 from public.surveys s
    where s.id = p_survey_id
      and (s.created_by = auth.uid()
        or (public.is_admin() and (s.sent_as = 'committee' or s.share_with_committee
          or s.share_with_admins))
        or (s.sent_as = 'captain' and public.survey_leads_group(s.team_id, true)))
  );
$$;
revoke execute on function public.survey_can_close(uuid) from public, anon;
grant execute on function public.survey_can_close(uuid) to authenticated;

-- The person who made it, an admin who can see it, or the group's coaches and
-- managers for a captain's poll, change the closing time. A time in the past
-- (or now) closes it straight away.
create or replace function public.set_survey_closing(p_survey_id uuid, p_closes_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.surveys;
begin
  select * into s from public.surveys where id = p_survey_id;
  if s.id is null or not public.survey_can_see_results(s.id) then
    raise exception 'Survey not found';
  end if;
  if not public.survey_can_close(s.id) then
    raise exception 'Only the person who made it or an admin can change when it closes';
  end if;
  if p_closes_at is null then
    raise exception 'Choose when it closes';
  end if;
  if p_closes_at <= s.opens_at then
    raise exception 'Choose a closing time after it opens';
  end if;
  if p_closes_at > s.opens_at + interval '1 year' then
    raise exception 'Surveys can be open for up to a year';
  end if;
  update public.surveys
  set closes_at = greatest(p_closes_at, least(now(), closes_at)),
      updated_at = now()
  where id = p_survey_id;
end;
$$;
revoke execute on function public.set_survey_closing(uuid, timestamptz) from public, anon;
grant execute on function public.set_survey_closing(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Members' surveys
-- ---------------------------------------------------------------------------

-- Surveys sent to the signed-in member that have opened, newest first. A
-- parent or guardian's copy names the children it's for and can't be answered.
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
  is_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.identity, s.opens_at, s.closes_at, s.created_by_name,
    r.for_child_names, coalesce(s.created_by = any (r.for_children), false), r.responded,
    now() >= s.opens_at and now() < s.closes_at
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

-- One survey and its questions, for a member it was sent to or for whoever
-- can read its results. For the member: whether they can answer, and their
-- own named answers. For a parent or guardian's copy: each child's named
-- answers. Anonymous answers are never returned, to anyone.
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

-- p_answers is a JSON array of
--   {"question_id": "...", "choices": [0, 2]} (choice: one position),
--   {"question_id": "...", "rating": 4} or {"question_id": "...", "text": "..."}.
-- p_give_name only counts for optional surveys. Answers can't be changed
-- once sent, so an anonymous answer never needs to be found again.
create or replace function public.submit_survey_response(
  p_survey_id uuid,
  p_answers jsonb,
  p_give_name boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.surveys;
  r public.survey_recipients;
  q public.survey_questions;
  v_named boolean;
  v_response_id uuid;
  v_answer jsonb;
  v_choices int[];
  v_rating int;
  v_text text;
begin
  select * into s from public.surveys where id = p_survey_id;
  select * into r from public.survey_recipients
  where survey_id = p_survey_id and profile_id = auth.uid()
  for update;
  if s.id is null or r.profile_id is null or not public.is_approved() or not public.surveys_on() then
    raise exception 'Survey not found';
  end if;
  if r.for_children is not null then
    raise exception 'This survey is for your child to answer';
  end if;
  if now() < s.opens_at or now() >= s.closes_at then
    raise exception 'This survey is closed';
  end if;
  if r.responded then
    raise exception 'You''ve already answered this survey';
  end if;
  if jsonb_typeof(coalesce(p_answers, '[]'::jsonb)) <> 'array' then
    raise exception 'Answers are missing';
  end if;

  v_named := s.identity = 'named' or (s.identity = 'optional' and coalesce(p_give_name, false));

  insert into public.survey_responses (survey_id, respondent_id, respondent_name, submitted_at)
  values (
    s.id,
    case when v_named then auth.uid() end,
    case when v_named then public.member_display_name(auth.uid()) end,
    case when v_named then now() end
  )
  returning id into v_response_id;

  for q in select * from public.survey_questions where survey_id = s.id order by sort_order loop
    select e into v_answer from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) e
    where e ->> 'question_id' = q.id::text
    limit 1;
    v_choices := null;
    v_rating := null;
    v_text := null;
    if v_answer is not null then
      if q.kind in ('choice', 'multi_choice') then
        select array_agg(distinct c::int order by c::int) into v_choices
        from jsonb_array_elements_text(coalesce(v_answer -> 'choices', '[]'::jsonb)) c;
        if v_choices is not null then
          if exists (select 1 from unnest(v_choices) c where c < 0 or c >= array_length(q.options, 1)) then
            raise exception 'Choose from the choices given';
          end if;
          if q.kind = 'choice' and array_length(v_choices, 1) > 1 then
            raise exception 'Choose one answer to "%"', q.prompt;
          end if;
        end if;
      elsif q.kind = 'rating' then
        v_rating := (v_answer ->> 'rating')::int;
        if v_rating is not null and v_rating not between 1 and q.rating_max then
          raise exception 'Choose a rating from 1 to %', q.rating_max;
        end if;
      else
        v_text := nullif(btrim(coalesce(v_answer ->> 'text', '')), '');
        if length(v_text) > 2000 then
          raise exception 'Answers can be up to 2000 characters';
        end if;
      end if;
    end if;
    if v_choices is null and v_rating is null and v_text is null then
      if q.required then
        raise exception 'Answer "%"', q.prompt;
      end if;
      continue;
    end if;
    insert into public.survey_answers (response_id, question_id, choices, rating, text_answer)
    values (v_response_id, q.id, v_choices, v_rating, v_text);
  end loop;

  update public.survey_recipients set responded = true
  where survey_id = s.id and profile_id = auth.uid();
end;
$$;
revoke execute on function public.submit_survey_response(uuid, jsonb, boolean) from public, anon;
grant execute on function public.submit_survey_response(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The committee and admins
-- ---------------------------------------------------------------------------

-- The surveys the member can read results for (see survey_can_see_results),
-- newest first, with how many
-- it went to and how many answered.
-- Parents' and guardians' copies aren't counted: only the child answers.
create or replace function public.manage_surveys()
returns table (
  id uuid,
  title text,
  identity public.survey_identity,
  audience public.survey_audience,
  audience_role public.app_role,
  audience_label text,
  opens_at timestamptz,
  closes_at timestamptz,
  created_by uuid,
  created_by_name text,
  sent_as text,
  share_with_committee boolean,
  share_with_admins boolean,
  sent_to int,
  answered int,
  -- 'scheduled', 'open' or 'closed'
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.identity, s.audience, s.audience_role, s.audience_label,
    s.opens_at, s.closes_at, s.created_by, s.created_by_name,
    s.sent_as, s.share_with_committee, s.share_with_admins,
    (select count(*)::int from public.survey_recipients r
     where r.survey_id = s.id and r.for_children is null),
    (select count(*)::int from public.survey_responses x where x.survey_id = s.id),
    case when now() < s.opens_at then 'scheduled' when now() < s.closes_at then 'open' else 'closed' end
  from public.surveys s
  where public.survey_can_see_results(s.id)
  order by s.created_at desc;
$$;
revoke execute on function public.manage_surveys() from public, anon;
grant execute on function public.manage_surveys() to authenticated;

-- A survey's title, who it went to and when, for results and reports.
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
    'created_by_name', s.created_by_name, 'sent_as', s.sent_as
  );
$$;
revoke execute on function public.survey_summary(public.surveys) from public, anon;
grant execute on function public.survey_summary(public.surveys) to authenticated;

-- Whether the signed-in member can download a survey's results as a PDF or
-- spreadsheet: whoever reads its results, except a captain, who reads their
-- own poll's results in the app only. Files leave the app, so a child's
-- teammates' names aren't put in a child's hands.
create or replace function public.survey_can_export(p_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.survey_can_see_results(p_survey_id) and exists (
    select 1 from public.surveys s
    where s.id = p_survey_id
      and (s.sent_as <> 'captain' or public.survey_leads_group(s.team_id, true))
  );
$$;
revoke execute on function public.survey_can_export(uuid) from public, anon;
grant execute on function public.survey_can_export(uuid) to authenticated;

-- A survey's results, for whoever survey_can_see_results allows. Anonymous
-- and optional surveys show nothing until they've closed and enough people
-- have answered. Named answers carry the member's name, and named surveys
-- show who hasn't answered yet. Opening results that name a child under 18 is logged against
-- that child.
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
  v_hidden boolean;
  v_child uuid;
begin
  select * into s from public.surveys where id = p_survey_id;
  if s.id is null or not public.survey_can_see_results(s.id) then
    raise exception 'Survey not found';
  end if;

  select count(*) into v_sent from public.survey_recipients
  where survey_id = s.id and for_children is null;
  select count(*) into v_answered from public.survey_responses where survey_id = s.id;
  v_hidden := s.identity <> 'named'
    and (now() < s.closes_at or v_answered < public.survey_min_responses());

  if v_hidden then
    return jsonb_build_object(
      'survey', public.survey_summary(s), 'can_export', false,
      'sent_to', v_sent, 'answered', v_answered, 'hidden', true,
      'closed', now() >= s.closes_at,
      'min_responses', public.survey_min_responses(),
      'questions', '[]'::jsonb, 'respondents', '[]'::jsonb, 'waiting', '[]'::jsonb
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
    'closed', now() >= s.closes_at,
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
    -- Who hasn't answered, for named surveys only.
    'waiting', case when s.identity = 'named' then (
      select coalesce(jsonb_agg(public.member_display_name(r.profile_id)
        order by public.member_display_name(r.profile_id)), '[]'::jsonb)
      from public.survey_recipients r
      where r.survey_id = s.id and r.for_children is null and not r.responded
    ) else '[]'::jsonb end
  );
end;
$$;
revoke execute on function public.survey_results(uuid) from public, anon;
grant execute on function public.survey_results(uuid) to authenticated;

-- Every set of answers, for a spreadsheet: one row each. Only once results
-- show (see survey_results). Named answers carry the name and time; anonymous
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
  if s.identity <> 'named'
     and (now() < s.closes_at or v_answered < public.survey_min_responses()) then
    raise exception 'Results show once the survey closes and at least % people have answered',
      public.survey_min_responses();
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

-- ---------------------------------------------------------------------------
-- Keeping records (Matt, 17 October 2026)
-- ---------------------------------------------------------------------------

-- Three keep periods, counted from when a survey closes:
--   - surveys sent by the committee or an admin: 1, 2, 3, 5 or 7 years,
--     default 3 years (as message text);
--   - squad and team surveys shared with admins or the committee: 1, 2, 3, 5
--     or 7 years, default 2 years;
--   - squad and team polls that stay in the team (coaches' quick polls and
--     captains' polls): 3 or 6 months, 1 or 2 years, default 6 months.
-- Past its period a survey goes with its questions, answers and who it went
-- to, but only once an admin has switched on "Remove old records". Who
-- viewed a child's answers stays in the record views for their own period.
alter table public.club_settings
  add column if not exists retention_surveys_months integer not null default 36;
alter table public.club_settings
  add column if not exists retention_shared_surveys_months integer not null default 24;
alter table public.club_settings
  add column if not exists retention_team_polls_months integer not null default 6;

-- The three survey keep periods, for admins.
create or replace function public.survey_retention()
returns table (surveys_months integer, shared_surveys_months integer, team_polls_months integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.retention_surveys_months, 36),
    coalesce(s.retention_shared_surveys_months, 24),
    coalesce(s.retention_team_polls_months, 6)
  from (select 1) as one
  left join public.club_settings s on s.id
  where public.is_admin();
$$;
revoke execute on function public.survey_retention() from public, anon;
grant execute on function public.survey_retention() to authenticated;

create or replace function public.admin_set_survey_retention(
  p_surveys_months integer,
  p_shared_surveys_months integer,
  p_team_polls_months integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change how long records are kept';
  end if;
  select * into s from public.club_settings where id;
  if not public.retention_choice_ok(p_surveys_months, array[12, 24, 36, 60, 84], s.retention_surveys_months)
     or not public.retention_choice_ok(p_shared_surveys_months, array[12, 24, 36, 60, 84], s.retention_shared_surveys_months) then
    raise exception 'Surveys can be kept 1, 2, 3, 5 or 7 years';
  end if;
  if not public.retention_choice_ok(p_team_polls_months, array[3, 6, 12, 24], s.retention_team_polls_months) then
    raise exception 'Team polls can be kept 3 or 6 months, or 1 or 2 years';
  end if;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set retention_surveys_months = p_surveys_months,
      retention_shared_surveys_months = p_shared_surveys_months,
      retention_team_polls_months = p_team_polls_months,
      retention_updated_by_name = public.member_display_name(auth.uid()),
      retention_updated_at = now()
  where id;
end;
$$;
revoke execute on function public.admin_set_survey_retention(integer, integer, integer) from public, anon;
grant execute on function public.admin_set_survey_retention(integer, integer, integer) to authenticated;

-- Removes surveys past their keep period and returns how many went. Does
-- nothing while "Remove old records" is off. Run each night by the
-- purge-expired-injuries function after purge_expired_records().
create or replace function public.purge_expired_surveys()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
  v_count int := 0;
begin
  select * into s from public.club_settings where id;
  if not found or not s.retention_enabled then
    return jsonb_build_object('enabled', false);
  end if;
  delete from public.surveys v
  where v.closes_at < now() - make_interval(months => case
    when v.sent_as = 'committee' then s.retention_surveys_months
    when v.share_with_admins or v.share_with_committee then s.retention_shared_surveys_months
    else s.retention_team_polls_months
  end);
  get diagnostics v_count = row_count;
  return jsonb_build_object('enabled', true, 'surveys', v_count);
end;
$$;
revoke execute on function public.purge_expired_surveys() from public, anon, authenticated;
grant execute on function public.purge_expired_surveys() to service_role;

commit;
