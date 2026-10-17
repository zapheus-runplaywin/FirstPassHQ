-- Surveys (Matt, 17 October 2026).
--
-- The committee and admins create surveys and send them to everyone, a role,
-- or a squad or team, the same audiences as messages. Each survey is one of:
--   - anonymous: nobody can ever see who gave which answers;
--   - named: every answer carries the member's name;
--   - optional: each member chooses whether to give their name.
-- Questions are a single choice, several choices, a rating, or free text.
-- A survey opens and closes on set days; the person who made it, or an
-- admin, can close it early or change the closing day. Questions can't be
-- changed once it's sent, so every answer was given to the same questions.
--
-- Who sees results: the committee and admins only. Members never see each
-- other's answers.
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
-- answers; nobody, including them, can read an anonymous one. When the
-- committee or an admin opens results that name a child under 18, the view
-- goes in the child's record access log.
--
-- Additive only: new types, tables and functions, and the record access log
-- gains a kind.

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
  p_questions jsonb
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
begin
  if not public.surveys_on() then
    raise exception 'Surveys are turned off for this club';
  end if;
  if not public.can_manage_surveys() then
    raise exception 'Only the committee and admins can make surveys';
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

  insert into public.surveys (
    title, intro, identity, audience, audience_role, team_id, audience_label,
    opens_at, closes_at, created_by, created_by_name
  )
  values (
    v_title, v_intro, p_identity, p_audience,
    case when p_audience = 'role' then p_role end,
    v_team.id, v_team.name, v_opens, p_closes_at, v_sender.id,
    public.member_display_name(v_sender.id)
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
  ) r
  where r.id <> v_sender.id
  group by r.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the survey too.
    raise exception 'Nobody else is in that group yet';
  end if;

  return v_survey_id;
end;
$$;
revoke execute on function public.create_survey(text, text, public.survey_identity, public.survey_audience, public.app_role, uuid, timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function public.create_survey(text, text, public.survey_identity, public.survey_audience, public.app_role, uuid, timestamptz, timestamptz, jsonb) to authenticated;

-- The person who made it, or an admin, changes the closing time. A time in
-- the past (or now) closes it straight away.
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
  if s.id is null or not public.can_manage_surveys() then
    raise exception 'Survey not found';
  end if;
  if not (public.is_admin() or s.created_by = auth.uid()) then
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
  responded boolean,
  is_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.identity, s.opens_at, s.closes_at, s.created_by_name,
    r.for_child_names, r.responded,
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

-- One survey and its questions, for a member it was sent to or for the
-- committee and admins. For the member: whether they can answer, and their
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
  v_manager boolean := public.can_manage_surveys();
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
    where exists (
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
    'for_child_names', r.for_child_names,
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

-- Every survey, newest first, with how many it went to and how many answered.
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
    (select count(*)::int from public.survey_recipients r
     where r.survey_id = s.id and r.for_children is null),
    (select count(*)::int from public.survey_responses x where x.survey_id = s.id),
    case when now() < s.opens_at then 'scheduled' when now() < s.closes_at then 'open' else 'closed' end
  from public.surveys s
  where public.can_manage_surveys() and public.surveys_on()
  order by s.created_at desc;
$$;
revoke execute on function public.manage_surveys() from public, anon;
grant execute on function public.manage_surveys() to authenticated;

-- A survey's results, for the committee and admins. Anonymous and optional
-- surveys show nothing until they've closed and enough people have answered. Named answers carry
-- the member's name; the committee and admins see who hasn't answered a named
-- survey yet. Opening results that name a child under 18 is logged against
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
  if s.id is null or not public.can_manage_surveys() or not public.surveys_on() then
    raise exception 'Survey not found';
  end if;

  select count(*) into v_sent from public.survey_recipients
  where survey_id = s.id and for_children is null;
  select count(*) into v_answered from public.survey_responses where survey_id = s.id;
  v_hidden := s.identity <> 'named'
    and (now() < s.closes_at or v_answered < public.survey_min_responses());

  if v_hidden then
    return jsonb_build_object(
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

commit;
