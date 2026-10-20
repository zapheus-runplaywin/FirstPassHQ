-- A stood-down member stops reading messages they got as a coach, manager,
-- physio, committee member or admin.
--
-- Matt (2026-10-18): stood-down coaches should have no access, but they keep
-- their athlete and guardian rights. Until now they kept reading every
-- message sent to them before the stand-down, including messages to the
-- coaches of a squad, which can name and describe children.
--
-- While stood down, a member reads a message sent to them only when it
-- reached them as a member, athlete or parent:
-- - a whole-club message, which everyone gets;
-- - a message to a role they still hold that isn't paused (athlete,
--   guardian);
-- - a parent's copy, which names the children it was sent for;
-- - a message to a squad or team they are still an athlete in, or that a
--   child of theirs is still an athlete in.
-- Lifting the stand-down brings the rest back.
--
-- Members also see their own message_recipients rows only for messages they
-- may read, so the inbox and unread count match what they can open. This
-- also covers the physios who no longer get whole-club messages.
--
-- Additive only: replaced functions and one replaced policy. No rows change.

begin;

-- Whether a stood-down member may still read a message sent to them: only
-- when it reached them as a member, athlete or parent.
create or replace function public.reached_me_outside_paused_roles(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.message_recipients r on r.message_id = m.id and r.profile_id = auth.uid()
    where m.id = p_message_id
      and (
        m.audience = 'club'
        or (m.audience = 'role' and m.audience_role not in ('coach', 'manager', 'physio', 'committee', 'admin'))
        or r.for_children is not null
        or (m.audience = 'group' and exists (
          select 1 from public.team_members tm
          where tm.team_id = m.team_id
            and tm.team_role = 'athlete'
            and (tm.profile_id = auth.uid() or public.is_guardian_of(tm.profile_id))
        ))
      )
  );
$$;

revoke execute on function public.reached_me_outside_paused_roles(uuid) from public, anon;
grant execute on function public.reached_me_outside_paused_roles(uuid) to authenticated;

create or replace function public.is_message_recipient(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.message_recipients
    where message_id = p_message_id and profile_id = auth.uid()
  ) and not exists (
    -- Guests and temporary volunteers never see messages, including ones
    -- from before. Members who are only physios see messages to their role,
    -- and whole-club messages only while admins send them those.
    select 1 from public.profiles
    where id = auth.uid()
      and (role in ('guest', 'volunteer') or (
        public.is_view_only_member(role, extra_roles)
        and not public.physios_get_club_messages()
        and not exists (
          select 1 from public.messages m
          where m.id = p_message_id
            and ((m.audience = 'role' and m.audience_role = 'physio')
              -- Physios in a squad or team get its messages.
              or m.audience = 'group')
        )
      ))
  ) and (
    not public.is_stood_down() or public.reached_me_outside_paused_roles(p_message_id)
  );
$$;

drop policy if exists "Recipients, senders and admins see receipts" on public.message_recipients;
create policy "Recipients, senders and admins see receipts"
  on public.message_recipients for select to authenticated
  using (
    (profile_id = auth.uid() and public.is_message_recipient(message_id))
    or public.is_admin()
    or public.is_message_sender(message_id)
  );

commit;
