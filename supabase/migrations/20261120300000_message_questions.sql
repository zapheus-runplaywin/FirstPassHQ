-- Questions on messages (Matt, 20 November 2026).
--
-- A message can ask one question with 2 to 4 answers the sender sets, such as
-- Yes / No / Not sure. Each person it went to taps one answer, once. It's a
-- one-question named quick poll that lives with its message, so it keeps the
-- message's own keep period and the guardian copies:
--
--   * no free text, and nobody can answer an answer;
--   * members never see each other's answers. Names are seen by whoever sent
--     it, the squad or team's coaches and managers, and admins. Captains are
--     treated like coaches here (Matt, 20 November 2026);
--   * the sender can share the totals with everyone it went to;
--   * a parent or guardian can answer for their child under 18, and sees the
--     question, their child's answer, who gave it and when (Matt: "auditable
--     for guardians"). The first answer stands, whoever gives it, and it can't
--     be changed;
--   * the sender, the group's coaches and managers, or an admin can close it.
--
-- See docs/security/privacy-and-social-media-assessment-2026-10-13.md,
-- section 2, for why this is not a reply feature.
--
-- Additive only: new nullable columns and new functions. No rows change.

begin;

alter table public.messages
  add column if not exists answer_options text[],
  add column if not exists answer_totals_shared boolean not null default false,
  add column if not exists question_closed_at timestamptz;

alter table public.messages drop constraint if exists messages_answer_options_check;
alter table public.messages add constraint messages_answer_options_check
  check (answer_options is null or cardinality(answer_options) between 2 and 4);

alter table public.message_recipients
  add column if not exists answer smallint,
  add column if not exists answered_by uuid references public.profiles (id) on delete set null,
  add column if not exists answered_by_name text,
  add column if not exists answered_at timestamptz;

alter table public.message_recipients drop constraint if exists message_recipients_answer_check;
alter table public.message_recipients add constraint message_recipients_answer_check
  check ((answer is null) = (answered_at is null) and (answer is null or answer between 0 and 3));

-- ---------------------------------------------------------------------------
-- Who sees names: whoever sent it (while not stood down), admins, and the
-- coaches and managers of the squad or team it went to.
-- ---------------------------------------------------------------------------

create or replace function public.sees_message_answers(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_message_sender(p_message_id)
    or public.is_admin()
    or exists (
      select 1 from public.messages m
      where m.id = p_message_id and m.team_id is not null
        and public.survey_leads_group(m.team_id, true)
    );
$$;
revoke execute on function public.sees_message_answers(uuid) from public, anon;
grant execute on function public.sees_message_answers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Sending: send_group_message's rules, then the question.
-- ---------------------------------------------------------------------------

create or replace function public.send_group_question(
  p_body text,
  p_audience public.message_audience,
  p_options text[],
  p_share_totals boolean default false,
  p_role public.app_role default null,
  p_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_options text[];
  v_id uuid;
begin
  select coalesce(array_agg(btrim(o) order by n), '{}')
  into v_options
  from unnest(coalesce(p_options, '{}')) with ordinality as x (o, n)
  where btrim(coalesce(o, '')) <> '';

  if cardinality(v_options) < 2 or cardinality(v_options) > 4 then
    raise exception 'Give 2 to 4 answers';
  end if;
  if exists (select 1 from unnest(v_options) o where length(o) > 30) then
    raise exception 'Answers can be up to 30 characters';
  end if;
  if (select count(distinct lower(o)) from unnest(v_options) o) <> cardinality(v_options) then
    raise exception 'Each answer must be different';
  end if;

  -- Every rule about who can message whom lives in send_group_message.
  v_id := public.send_group_message(p_body, p_audience, p_role, p_team_id);

  update public.messages
  set answer_options = v_options,
      answer_totals_shared = coalesce(p_share_totals, false)
  where id = v_id;

  return v_id;
end;
$$;
revoke execute on function public.send_group_question(text, public.message_audience, text[], boolean, public.app_role, uuid) from public, anon;
grant execute on function public.send_group_question(text, public.message_audience, text[], boolean, public.app_role, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Answering, for yourself or for your child.
-- ---------------------------------------------------------------------------

create or replace function public.answer_message_question(
  p_message_id uuid,
  p_answer int,
  p_for_child uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_message public.messages;
  v_target uuid;
  v_rows int;
begin
  if v_me is null or not public.is_approved() then
    raise exception 'Message not found';
  end if;
  select * into v_message from public.messages where id = p_message_id;
  if v_message.id is null or not public.is_message_recipient(p_message_id) then
    raise exception 'Message not found';
  end if;
  if v_message.answer_options is null then
    raise exception 'This message doesn''t ask a question';
  end if;
  if v_message.question_closed_at is not null then
    raise exception 'This question is closed';
  end if;
  if p_answer is null or p_answer < 0 or p_answer >= cardinality(v_message.answer_options) then
    raise exception 'Choose one of the answers';
  end if;

  if p_for_child is null then
    -- A copy sent only because of a child is answered for that child.
    if not exists (
      select 1 from public.message_recipients
      where message_id = p_message_id and profile_id = v_me and for_children is null
    ) then
      raise exception 'Answer for your child instead';
    end if;
    v_target := v_me;
  else
    -- Any copy of their own will do: a parent who coaches the squad gets
    -- the message in their own right, with no child named on it.
    if not public.is_guardian_of(p_for_child) or not exists (
      select 1 from public.message_recipients
      where message_id = p_message_id and profile_id = v_me
    ) or not exists (
      select 1 from public.message_recipients
      where message_id = p_message_id and profile_id = p_for_child
    ) then
      raise exception 'You can only answer for your own child';
    end if;
    -- A child who sent the message has nothing to answer.
    if v_message.sender_id = p_for_child then
      raise exception 'You can only answer for your own child';
    end if;
    v_target := p_for_child;
  end if;

  update public.message_recipients
  set answer = p_answer,
      answered_by = v_me,
      answered_by_name = public.member_display_name(v_me),
      answered_at = now()
  where message_id = p_message_id and profile_id = v_target and answer is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This has already been answered';
  end if;

  -- Answering means it was read.
  update public.message_recipients set read_at = now()
  where message_id = p_message_id and profile_id = v_me and read_at is null;
end;
$$;
revoke execute on function public.answer_message_question(uuid, int, uuid) from public, anon;
grant execute on function public.answer_message_question(uuid, int, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Closing.
-- ---------------------------------------------------------------------------

create or replace function public.close_message_question(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.messages where id = p_message_id and answer_options is not null)
     or not public.sees_message_answers(p_message_id) then
    raise exception 'Only whoever sent it, its coaches and managers, or an admin can close this question';
  end if;
  update public.messages set question_closed_at = now()
  where id = p_message_id and question_closed_at is null;
end;
$$;
revoke execute on function public.close_message_question(uuid) from public, anon;
grant execute on function public.close_message_question(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Everything one viewer may see about a message's question, as JSON:
--   options, closed, can_close, my_answer (their own copy), children (a
--   guardian's children under 18 it went to: each child's answer, who gave
--   it and when), totals (to whoever sees names, and to everyone it went to
--   when shared), answers (names, only to whoever sees names) and
--   not_answered (names).
-- Null when the message asks nothing or the viewer can't read it.
-- ---------------------------------------------------------------------------

create or replace function public.message_question(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  m public.messages;
  v_mine public.message_recipients;
  v_sees boolean;
  v_children jsonb := '[]'::jsonb;
  v_totals jsonb;
  v_answers jsonb;
  v_waiting jsonb;
begin
  select * into m from public.messages where id = p_message_id;
  if m.id is null or m.answer_options is null then
    return null;
  end if;
  v_sees := public.sees_message_answers(p_message_id);
  if not v_sees and not public.is_message_recipient(p_message_id) then
    return null;
  end if;

  select * into v_mine from public.message_recipients
  where message_id = p_message_id and profile_id = v_me;

  -- Their children under 18 it went to (not a child who sent it).
  if v_mine.profile_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.profile_id,
        'name', public.member_display_name(r.profile_id),
        'answer', r.answer,
        'answered_by_name', r.answered_by_name,
        'answered_by_parent', r.answered_by is not null and r.answered_by <> r.profile_id,
        'answered_at', r.answered_at
      ) order by public.member_display_name(r.profile_id)), '[]'::jsonb)
    into v_children
    from public.guardianships g
    join public.message_recipients r on r.message_id = p_message_id and r.profile_id = g.athlete_id
    where g.guardian_id = v_me and public.is_guardian_of(g.athlete_id)
      and r.profile_id is distinct from m.sender_id;
  end if;

  if v_sees or m.answer_totals_shared then
    select jsonb_agg(coalesce(t.n, 0) order by i)
    into v_totals
    from generate_series(0, cardinality(m.answer_options) - 1) as i
    left join (
      select answer, count(*)::int as n from public.message_recipients
      where message_id = p_message_id and answer is not null group by answer
    ) t on t.answer = i;
  end if;

  if v_sees then
    select coalesce(jsonb_agg(jsonb_build_object(
        'profile_id', r.profile_id,
        'name', public.message_recipient_name(r.profile_id, r.member_name),
        'answer', r.answer,
        'answered_by_name', r.answered_by_name,
        'answered_by_parent', r.answered_by is not null and r.answered_by <> r.profile_id,
        'answered_at', r.answered_at
      ) order by r.answer, 2), '[]'::jsonb)
    into v_answers
    from public.message_recipients r
    where r.message_id = p_message_id and r.answer is not null;

    -- Everyone it went to in their own right who hasn't answered.
    select coalesce(jsonb_agg(public.message_recipient_name(r.profile_id, r.member_name)
        order by public.message_recipient_name(r.profile_id, r.member_name)), '[]'::jsonb)
    into v_waiting
    from public.message_recipients r
    where r.message_id = p_message_id and r.answer is null and r.for_children is null
      and r.profile_id is distinct from m.sender_id;
  end if;

  return jsonb_build_object(
    'options', to_jsonb(m.answer_options),
    'closed', m.question_closed_at is not null,
    'totals_shared', m.answer_totals_shared,
    'can_close', v_sees and m.question_closed_at is null,
    'my_answer', v_mine.answer,
    'my_answer_by_name', v_mine.answered_by_name,
    'my_answer_by_parent', v_mine.answered_by is not null and v_mine.answered_by <> v_mine.profile_id,
    'can_answer_myself', v_mine.profile_id is not null and v_mine.for_children is null,
    'children', v_children,
    'totals', v_totals,
    'answers', v_answers,
    'not_answered', v_waiting
  );
end;
$$;

-- A recipient's name as message_receipts shows it.
create or replace function public.message_recipient_name(p_profile_id uuid, p_member_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = p_profile_id),
    p_member_name || ' (deleted)',
    'Unnamed member'
  );
$$;
revoke execute on function public.message_recipient_name(uuid, text) from public, anon, authenticated;

revoke execute on function public.message_question(uuid) from public, anon;
grant execute on function public.message_question(uuid) to authenticated;

commit;
