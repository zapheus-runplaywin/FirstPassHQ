-- Chat groups: a coach hides a post with a swipe (Matt, 24 November 2026:
-- "swipe to hide for everyone other than the coach and the author ... greyed
-- out style"). A hidden post goes from everyone else in the group and from
-- their parents' copies; its author, the group's coaches and the author's own
-- verified parents still see it, greyed out with who hid it. Coaches can show
-- it again. The text is kept, as before, for the Child Safety Officer and
-- Complaints Manager, concerns and legal hold.
--
-- Replaces my_chat_groups, chat_group_posts, remove_chat_post and
-- is_message_recipient with the same signatures, and adds
-- chat_post_hidden_from_me (internal) and show_chat_post.

begin;

-- Whether a post a coach hid is hidden from the signed-in member. A hidden
-- post stays with its author, the group's coaches (who can show it again) and
-- the author's own verified parents or guardians, greyed out; everyone else
-- in the group, and their parents' copies, lose it (Matt, 24 November 2026:
-- "swipe to hide for everyone other than the coach and the author"). Its text
-- is kept for the Child Safety Officer. False for every other message.
create or replace function public.chat_post_hidden_from_me(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.chat_groups g on g.id = m.chat_group_id
    where m.id = p_message_id
      and m.audience = 'chat'
      and m.removed_at is not null
      and m.sender_id is distinct from auth.uid()
      and not public.chat_can_remove(g, auth.uid())
      and not exists (
        select 1
        from public.guardianships gs
        join public.profiles gp on gp.id = gs.guardian_id
        where gs.athlete_id = m.sender_id
          and gs.guardian_id = auth.uid()
          and gp.status = 'approved'
          and gp.verified_at is not null
      )
  );
$$;

revoke execute on function public.chat_post_hidden_from_me(uuid) from public, anon, authenticated;

-- The signed-in member's groups: the ones they're in now, and ones they were
-- sent posts in before leaving (read only). An automatic group shows once
-- there are two people in it; coaches and physios only when it has a physio.
create or replace function public.my_chat_groups()
returns table (
  id uuid,
  kind text,
  name text,
  team_id uuid,
  is_member boolean,
  can_post boolean,
  -- Why the member can't post: 'under_18' (an admin's group, or no coach in
  -- it now), 'left' or 'closed'.
  read_only_reason text,
  -- Whether the member can remove posts (the group's coaches).
  can_remove boolean,
  member_count int,
  hidden boolean,
  unread_count int,
  last_post_at timestamptz,
  last_post text,
  last_sender text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_minor boolean;
begin
  select * into v_me from public.profiles p where p.id = auth.uid();
  if v_me.id is null or v_me.status <> 'approved' or not public.chat_groups_on()
     or public.chat_minor_unguarded(v_me.id) then
    return;
  end if;
  v_minor := public.is_minor(v_me.date_of_birth, v_me.under_17);
  perform public.ensure_automatic_chat_groups();

  return query
  with groups as (
    select g.*,
      public.chat_group_name(g) as group_name,
      public.chat_can_post(g, v_me.id) as can_post_now,
      public.chat_can_remove(g, v_me.id) as can_remove_now,
      public.chat_group_coach_led(g) as coach_led,
      (select count(*)::int from public.chat_group_people(g) x) as n_people,
      v_me.id in (select x from public.chat_group_people(g) x) as member,
      exists (
        select 1 from public.chat_group_people(g) x
        join public.profiles p on p.id = x
        where 'physio' = any (public.roles_of(p.role, p.extra_roles))
      ) as has_physio
    from public.chat_groups g
  ),
  mine as (
    select g.*
    from groups g
    where (g.member and g.n_people >= 2 and (g.kind <> 'team_physio' or g.has_physio))
      -- A group the member has left, while they can still read a post in it
      -- (a stood-down coach can't).
      or exists (
        select 1 from public.message_recipients r
        where r.profile_id = v_me.id and r.chat_group_id = g.id
          and public.is_message_recipient(r.message_id)
      )
      or exists (
        select 1 from public.messages m
        where m.chat_group_id = g.id and m.sender_id = v_me.id and not public.is_stood_down()
      )
  ),
  last_posts as (
    select distinct on (m.chat_group_id) m.chat_group_id, m.created_at, m.body, m.sender_name
    from public.messages m
    join mine g on g.id = m.chat_group_id
    where not public.chat_post_hidden_from_me(m.id)
      and ((m.sender_id = v_me.id and not public.is_stood_down())
      or exists (
        select 1 from public.message_recipients r
        where r.message_id = m.id and r.profile_id = v_me.id and r.chat_group_id = m.chat_group_id
      ))
    order by m.chat_group_id, m.created_at desc
  )
  select g.id, g.kind, g.group_name, g.team_id,
    g.member,
    g.can_post_now,
    case
      when g.closed_at is not null then 'closed'
      when not g.member then 'left'
      when v_minor and not g.coach_led then 'under_18'
    end,
    g.can_remove_now,
    g.n_people,
    exists (select 1 from public.chat_group_hidden h where h.group_id = g.id and h.profile_id = v_me.id),
    (select count(*)::int from public.message_recipients r
      where r.profile_id = v_me.id and r.chat_group_id = g.id and r.unread
        and not public.chat_post_hidden_from_me(r.message_id)),
    lp.created_at, lp.body, coalesce(lp.sender_name, 'Club')
  from mine g
  left join last_posts lp on lp.chat_group_id = g.id
  order by lp.created_at desc nulls last, g.group_name;
end;
$$;

revoke execute on function public.my_chat_groups() from public, anon;
grant execute on function public.my_chat_groups() to authenticated;

-- A group's posts the signed-in member sent or was sent, oldest first, 50 at a
-- time: the latest, or with p_before the 50 before that time, as the member
-- scrolls up. Read counts are for the member's own posts only.
create or replace function public.chat_group_posts(p_group_id uuid, p_before timestamptz default null)
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  body text,
  created_at timestamptz,
  mine boolean,
  -- Removed after the club's keep period.
  body_removed boolean,
  -- Hidden by a coach: only its author, the group's coaches and the author's
  -- parents still get it, greyed out.
  removed_by_name text,
  read_count int,
  recipient_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select m.id, m.sender_id, coalesce(m.sender_name, 'Club'),
      m.body,
      m.created_at,
      m.sender_id = auth.uid(),
      m.body_removed_at is not null,
      case when m.removed_at is not null then coalesce(m.removed_by_name, 'a coach') end,
      case when m.sender_id = auth.uid() then
        (select count(r.read_at)::int from public.message_recipients r where r.message_id = m.id) end,
      case when m.sender_id = auth.uid() then
        (select count(*)::int from public.message_recipients r where r.message_id = m.id) end
    from public.messages m
    where m.chat_group_id = p_group_id
      and (p_before is null or m.created_at < p_before)
      and not public.chat_post_hidden_from_me(m.id)
      and public.chat_groups_on()
      and not public.chat_minor_unguarded(auth.uid())
      and (
        (m.sender_id = auth.uid() and not public.is_stood_down())
        or (
          exists (
            select 1 from public.message_recipients r
            where r.message_id = m.id and r.profile_id = auth.uid() and r.chat_group_id = p_group_id
          )
          and public.is_message_recipient(m.id)
        )
      )
    order by m.created_at desc
    limit 50
  ) latest
  order by created_at;
$$;

revoke execute on function public.chat_group_posts(uuid, timestamptz) from public, anon;
grant execute on function public.chat_group_posts(uuid, timestamptz) to authenticated;

-- A coach hides a post (a swipe in the app). It then stays only with its
-- author, the group's coaches and the author's parents, greyed out with who
-- hid it (chat_post_hidden_from_me). Nothing is deleted: the text stays with
-- the message for the Child Safety Officer and Complaints Manager (approved
-- message access), a concern that reported it, and legal hold.
create or replace function public.remove_chat_post(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_group public.chat_groups;
begin
  if auth.uid() is null or not public.chat_groups_on() then
    raise exception 'Chat groups are turned off for the club';
  end if;
  select * into v_message from public.messages where id = p_message_id and audience = 'chat';
  if v_message.id is null then
    raise exception 'That post doesn''t exist';
  end if;
  select * into v_group from public.chat_groups where id = v_message.chat_group_id;
  if v_group.id is null or not public.chat_can_remove(v_group, auth.uid()) then
    raise exception 'Only the group''s coaches can hide posts';
  end if;
  if v_message.removed_at is not null then
    return;
  end if;
  update public.messages
  set removed_at = now(), removed_by = auth.uid(), removed_by_name = public.member_display_name(auth.uid())
  where id = p_message_id;
end;
$$;

revoke execute on function public.remove_chat_post(uuid) from public, anon;
grant execute on function public.remove_chat_post(uuid) to authenticated;

-- A coach shows a hidden post to the group again.
create or replace function public.show_chat_post(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_group public.chat_groups;
begin
  if auth.uid() is null or not public.chat_groups_on() then
    raise exception 'Chat groups are turned off for the club';
  end if;
  select * into v_message from public.messages where id = p_message_id and audience = 'chat';
  if v_message.id is null then
    raise exception 'That post doesn''t exist';
  end if;
  select * into v_group from public.chat_groups where id = v_message.chat_group_id;
  if v_group.id is null or not public.chat_can_remove(v_group, auth.uid()) then
    raise exception 'Only the group''s coaches can hide posts';
  end if;
  update public.messages
  set removed_at = null, removed_by = null, removed_by_name = null
  where id = p_message_id and removed_at is not null;
end;
$$;

revoke execute on function public.show_chat_post(uuid) from public, anon;
grant execute on function public.show_chat_post(uuid) to authenticated;

-- As 20261018020000, plus: members who are only physios read the posts of
-- groups they're in, as they read their squad's and team's messages.
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
              or m.audience = 'group'
              -- And the posts of chat groups they're in.
              or m.audience = 'chat')
        )
      ))
  ) and (
    not public.is_stood_down() or public.reached_me_outside_paused_roles(p_message_id)
  ) and not public.is_locked_child(auth.uid())
    -- Group posts stay hidden from a member under 18 until a verified parent
    -- or guardian is linked.
    and not (
      public.chat_minor_unguarded(auth.uid())
      and exists (select 1 from public.messages m where m.id = p_message_id and m.audience = 'chat')
    )
    -- A group post a coach hid stays only with its author, the group's
    -- coaches and the author's parents.
    and not public.chat_post_hidden_from_me(p_message_id);
$$;

commit;
