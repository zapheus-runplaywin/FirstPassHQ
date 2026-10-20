-- A stood-down coach no longer reads the records they made as a coach.
--
-- The role access tests (PR #149) found three ways a stood-down coach kept
-- reading records about children after their coach rights stopped:
--
-- - Attendance registers they took, with each child's mark. Whoever took a
--   session could always read it. Now they read it only while they may still
--   take attendance, the same rule as correcting it, so it also stops when
--   their Working With Children Check lapses.
-- - Their own session plans. The author could read a plan while approved. Now
--   they read it only while they may still work with children, the same rule
--   as changing it. Admins still read every plan.
-- - Messages they sent, with who received and read each one. Now a stood-down
--   member doesn't see the messages they sent or their receipts.
--
-- Matt (2026-10-18): stood-down coaches should have no access, but their
-- athlete and guardian rights stay, so a parent still sees their own child.
-- Messages sent to them, as a parent or otherwise, are unchanged.
-- Lifting the stand-down brings all three back.
--
-- Additive only: replaced functions and one replaced policy. No rows change.

begin;

-- Whether the signed-in member is stood down right now.
create or replace function public.is_stood_down()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and stood_down_at is not null
  );
$$;

revoke execute on function public.is_stood_down() from public, anon;
grant execute on function public.is_stood_down() to authenticated;

create or replace function public.can_see_attendance_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_sessions s
    where s.id = p_session_id
      and (
        public.is_committee()
        or (s.taken_by = auth.uid() and public.is_attendance_taker())
        or (s.club_wide and public.is_attendance_taker())
        or (s.team_id is not null
          and (public.can_view_team_attendance(s.team_id) or public.leads_group(s.team_id)))
      )
  );
$$;

create or replace function public.can_view_session_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.session_plans_on() and exists (
    select 1 from public.session_plans p
    where p.id = p_plan_id
      and (
        public.is_admin()
        or (p.author_id = auth.uid() and public.is_approved() and public.can_work_with_children())
        or public.session_plan_shared_with_me(p)
      )
  );
$$;

create or replace function public.is_message_sender(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.messages
    where id = p_message_id and sender_id = auth.uid()
  ) and not public.is_stood_down();
$$;

drop policy if exists "Senders, recipients and admins see messages" on public.messages;
create policy "Senders, recipients and admins see messages"
  on public.messages for select to authenticated
  using (
    (sender_id = auth.uid() and not public.is_stood_down())
    or public.is_admin()
    or public.is_message_recipient(id)
  );

create or replace function public.my_sent_messages()
returns table (
  id uuid,
  body text,
  audience public.message_audience,
  audience_role public.app_role,
  audience_label text,
  created_at timestamptz,
  recipient_count int,
  read_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id, m.body, m.audience, m.audience_role, m.audience_label, m.created_at,
    count(r.profile_id)::int,
    count(r.read_at)::int
  from public.messages m
  left join public.message_recipients r on r.message_id = m.id
  where m.sender_id = auth.uid() and not public.is_stood_down()
  group by m.id
  order by m.created_at desc
  limit 100;
$$;

commit;
