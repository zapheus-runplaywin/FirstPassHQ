-- Chat groups: a group an admin sets up shows in its members' Groups tab
-- straight away, even while they're the only one in it (Matt, 24 November
-- 2026: "I've created a chat group which includes me, but in the messages
-- area I can't access the chat"). Automatic groups still show only once
-- someone else is in them. Posting still needs someone else in the group.
--
-- Replaces my_chat_groups (from 20261124700000_chat_post_hiding.sql) with the
-- same signature; only the condition above changes.

begin;

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
    -- An automatic group shows once someone else is in it; a group an admin
    -- set up shows to its members straight away, even before anyone else is
    -- in it, so the admin who made it can find it.
    where (g.member and (g.n_people >= 2 or g.kind = 'custom')
        and (g.kind <> 'team_physio' or g.has_physio))
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

commit;
