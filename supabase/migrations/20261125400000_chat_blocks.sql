-- Blocking in chat groups (Matt, 25 November 2026: "Just add the blocking
-- feature ... Ensure admin and safeguarding get alerted to this so they can
-- follow up. Allow an unblocking feature too.").
--
-- A member blocks the author of a post in one of their chat groups. From
-- then on the blocked member's posts no longer show to them in any group
-- (the list, the last post and the unread count). It is one way: the blocked
-- member isn't told, still posts, and still sees the blocker's posts. The
-- member unblocks them again from Blocked people.
--
-- What blocking never touches, for child safety:
--   * a parent's or guardian's copy of a post to or from their child, which
--     sits in their inbox: blocking hides posts in the blocker's own groups
--     only, so a parent always sees everything their child is sent or writes;
--   * club messages (Inbox), which are how the club tells members things;
--   * nothing is deleted: the posts stay with everyone else, for the Child
--     Safety Officer's and Complaints Manager's approved access, concerns and
--     legal hold.
-- An adult can't block a member under 18: a child's posts must stay in front
-- of the adults in their group, so a coach or adult worried about a child's
-- posts hides the post or raises a concern instead. A member under 18 can
-- block anyone, adults included.
--
-- Every block is told to the club's admins, Child Safety Officer and
-- Complaints Manager (acting admins too), never to either member involved: a
-- to-do (and a push, where pushes are on) until one of them records that it
-- was followed up, and a register under Concerns that shows who blocked whom,
-- when, from which group, whether either is under 18, any unblocking, and the
-- follow-up. The register never shows the posts themselves.
--
-- Kept until either member's account is deleted (on delete cascade), like a
-- member's other personal settings; a block that needs keeping longer becomes
-- a concern.
--
-- Additive: one new table (reached only through the functions below), new
-- functions, and my_chat_groups, chat_group_posts and member_todos replaced
-- with the same signatures (member_todos keeps its old body under a new
-- name). No stored rows change.

begin;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists public.chat_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  -- Names and ages as they were, for the register.
  blocker_name text not null,
  blocked_name text not null,
  blocker_under_18 boolean not null default false,
  blocked_under_18 boolean not null default false,
  -- The group the post was in, by name.
  group_name text,
  created_at timestamptz not null default now(),
  unblocked_at timestamptz,
  followed_up_at timestamptz,
  followed_up_by uuid references public.profiles (id) on delete set null,
  followed_up_by_name text,
  follow_up_note text check (follow_up_note is null or length(follow_up_note) <= 1000),
  constraint chat_blocks_not_self check (blocker_id <> blocked_id)
);

-- One standing block per pair; unblocking keeps the row, and blocking again
-- adds a new one.
create unique index if not exists chat_blocks_standing_idx
  on public.chat_blocks (blocker_id, blocked_id)
  where unblocked_at is null;
create index if not exists chat_blocks_blocked_idx on public.chat_blocks (blocked_id);
create index if not exists chat_blocks_waiting_idx on public.chat_blocks (created_at)
  where followed_up_at is null;

alter table public.chat_blocks enable row level security;
-- Reached only through the functions below.
revoke all on public.chat_blocks from public, anon, authenticated;
grant all on public.chat_blocks to service_role;

-- ---------------------------------------------------------------------------
-- 2. What a block hides
-- ---------------------------------------------------------------------------

-- Whether a group post's author is blocked by the signed-in member. Only the
-- group lists use it (my_chat_groups, chat_group_posts), never
-- is_message_recipient, so a parent's inbox copy of a post to or from their
-- child always stays. Not for the app to call.
create or replace function public.chat_post_blocked_for_me(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.chat_blocks b
      on b.blocked_id = m.sender_id and b.blocker_id = auth.uid() and b.unblocked_at is null
    where m.id = p_message_id
      and m.audience = 'chat'
  );
$$;

revoke execute on function public.chat_post_blocked_for_me(uuid) from public, anon, authenticated;

-- As in 20261125100000_chat_groups_show_new.sql, plus: posts by someone the
-- member blocked don't count as the last post or as unread.
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
      and not public.chat_post_blocked_for_me(m.id)
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
        and not public.chat_post_hidden_from_me(r.message_id)
        and not public.chat_post_blocked_for_me(r.message_id)),
    lp.created_at, lp.body, coalesce(lp.sender_name, 'Club')
  from mine g
  left join last_posts lp on lp.chat_group_id = g.id
  order by lp.created_at desc nulls last, g.group_name;
end;
$$;

revoke execute on function public.my_chat_groups() from public, anon;
grant execute on function public.my_chat_groups() to authenticated;

-- As in 20261124700000_chat_post_hiding.sql, plus: no posts by someone the
-- member blocked.
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
      and not public.chat_post_blocked_for_me(m.id)
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
-- ---------------------------------------------------------------------------
-- 3. Blocking and unblocking
-- ---------------------------------------------------------------------------

-- The signed-in member blocks the author of a group post they were sent.
-- Returns the block's id. Blocking someone already blocked does nothing new.
create or replace function public.block_chat_member(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_message public.messages;
  v_sender public.profiles;
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null or v_me.status <> 'approved' then
    raise exception 'Only approved members can block';
  end if;
  if not public.chat_groups_on() then
    raise exception 'Chat groups are turned off for the club';
  end if;
  select * into v_message from public.messages where id = p_message_id and audience = 'chat';
  if v_message.id is not null and v_message.sender_id = v_me.id then
    raise exception 'You can''t block yourself';
  end if;
  -- Only a post the member was sent in one of their own groups (not a
  -- parent's copy, and not one they can no longer read).
  if v_message.id is null
     or not exists (
       select 1 from public.message_recipients r
       where r.message_id = p_message_id and r.profile_id = v_me.id and r.chat_group_id is not null
     )
     or not public.is_message_recipient(p_message_id) then
    raise exception 'You can block only the author of a post in one of your groups';
  end if;
  if v_message.sender_id is null then
    raise exception 'That member has left the club';
  end if;
  select * into v_sender from public.profiles where id = v_message.sender_id;
  if v_sender.id is null then
    raise exception 'That member has left the club';
  end if;
  if public.is_minor(v_sender.date_of_birth, v_sender.under_17)
     and not public.is_minor(v_me.date_of_birth, v_me.under_17) then
    raise exception 'Adults can''t block a member under 18. Ask a coach to hide the post, or raise a concern';
  end if;

  select b.id into v_id from public.chat_blocks b
  where b.blocker_id = v_me.id and b.blocked_id = v_sender.id and b.unblocked_at is null;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.chat_blocks (
    blocker_id, blocked_id, blocker_name, blocked_name,
    blocker_under_18, blocked_under_18, group_name
  )
  values (
    v_me.id, v_sender.id,
    public.member_display_name(v_me.id), public.member_display_name(v_sender.id),
    public.is_minor(v_me.date_of_birth, v_me.under_17),
    public.is_minor(v_sender.date_of_birth, v_sender.under_17),
    v_message.audience_label
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.block_chat_member(uuid) from public, anon;
grant execute on function public.block_chat_member(uuid) to authenticated;

-- The signed-in member unblocks someone. The record stays, marked unblocked,
-- for the register.
create or replace function public.unblock_chat_member(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  update public.chat_blocks
  set unblocked_at = now()
  where blocker_id = auth.uid() and blocked_id = p_profile_id and unblocked_at is null;
end;
$$;

revoke execute on function public.unblock_chat_member(uuid) from public, anon;
grant execute on function public.unblock_chat_member(uuid) to authenticated;

-- The people the signed-in member has blocked now, for Blocked people.
create or replace function public.my_chat_blocks()
returns table (profile_id uuid, name text, blocked_at timestamptz, group_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id, coalesce(public.member_display_name(b.blocked_id), b.blocked_name),
    b.created_at, b.group_name
  from public.chat_blocks b
  where b.blocker_id = auth.uid() and b.unblocked_at is null
  order by b.created_at desc;
$$;

revoke execute on function public.my_chat_blocks() from public, anon;
grant execute on function public.my_chat_blocks() to authenticated;

-- Whether the signed-in member blocks someone now, for the post screen's
-- Block or Unblock button.
create or replace function public.chat_member_blocked(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_blocks b
    where b.blocker_id = auth.uid() and b.blocked_id = p_profile_id and b.unblocked_at is null
  );
$$;

revoke execute on function public.chat_member_blocked(uuid) from public, anon;
grant execute on function public.chat_member_blocked(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Telling admins and safeguarding
-- ---------------------------------------------------------------------------

-- Whether the signed-in member looks after this block: admins, the Child
-- Safety Officer and the Complaints Manager (acting admins too), but never
-- the member who blocked or the one blocked. Not for the app to call.
create or replace function public.can_follow_up_chat_block(p_block public.chat_blocks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and auth.uid() not in (p_block.blocker_id, p_block.blocked_id)
    and (public.is_admin() or public.is_safeguarding_officer());
$$;

revoke execute on function public.can_follow_up_chat_block(public.chat_blocks) from public, anon, authenticated;

-- Every block the signed-in member looks after, newest first: waiting for a
-- follow-up first. Names and groups only, never the posts.
create or replace function public.chat_block_register()
returns table (
  id uuid,
  created_at timestamptz,
  blocker_name text,
  blocked_name text,
  blocker_under_18 boolean,
  blocked_under_18 boolean,
  group_name text,
  unblocked_at timestamptz,
  followed_up_at timestamptz,
  followed_up_by_name text,
  follow_up_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.created_at, b.blocker_name, b.blocked_name, b.blocker_under_18,
    b.blocked_under_18, b.group_name, b.unblocked_at, b.followed_up_at,
    b.followed_up_by_name, b.follow_up_note
  from public.chat_blocks b
  where public.can_follow_up_chat_block(b)
  order by b.followed_up_at is not null, b.created_at desc;
$$;

revoke execute on function public.chat_block_register() from public, anon;
grant execute on function public.chat_block_register() to authenticated;

-- How many blocks wait for the signed-in member's follow-up, and the newest,
-- for the to-do.
create or replace function public.chat_blocks_waiting()
returns table (waiting int, newest uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int,
    (array_agg(b.id order by b.created_at desc))[1]
  from public.chat_blocks b
  where b.followed_up_at is null and public.can_follow_up_chat_block(b);
$$;

revoke execute on function public.chat_blocks_waiting() from public, anon;
grant execute on function public.chat_blocks_waiting() to authenticated;

-- Records that a block was followed up, with an optional note. Once only.
create or replace function public.follow_up_chat_block(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block public.chat_blocks;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_block from public.chat_blocks where id = p_id;
  if v_block.id is null or not public.can_follow_up_chat_block(v_block) then
    raise exception 'Only admins, the Child Safety Officer and the Complaints Manager follow up blocks';
  end if;
  if v_block.followed_up_at is not null then
    raise exception 'This block was already followed up';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Notes can be up to 1000 characters';
  end if;
  update public.chat_blocks
  set followed_up_at = now(), followed_up_by = auth.uid(),
    followed_up_by_name = public.member_display_name(auth.uid()), follow_up_note = v_note
  where id = p_id;
end;
$$;

revoke execute on function public.follow_up_chat_block(uuid, text) from public, anon;
grant execute on function public.follow_up_chat_block(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pushes: the to-do push job's list, with blocks added
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'member_todos_before_blocks'
  ) then
    alter function public.member_todos(uuid, timestamptz) rename to member_todos_before_blocks;
  end if;
end;
$$;

revoke execute on function public.member_todos_before_blocks(uuid, timestamptz) from public, anon, authenticated;

-- As before, plus one to-do while blocks wait for the member's follow-up. It
-- names nobody, because push text leaves the club's project; a new block
-- changes the key, so it is pushed again.
create or replace function public.member_todos(p_profile_id uuid, p_now timestamptz default now())
returns table (todo_key text, title text, detail text, href text)
language plpgsql
set search_path = ''
as $$
declare
  v_old_claims text;
  v_old_sub text;
  r record;
begin
  return query select * from public.member_todos_before_blocks(p_profile_id, p_now);

  v_old_claims := current_setting('request.jwt.claims', true);
  v_old_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);

  if public.is_approved() then
    select * into r from public.chat_blocks_waiting();
    if r.waiting > 0 then
      todo_key := 'chat-blocks:' || r.newest;
      title := case when r.waiting = 1 then 'Follow up a block in chat groups'
        else 'Follow up ' || r.waiting || ' blocks in chat groups' end;
      detail := 'A member blocked someone. Check in with them';
      href := '/concerns/blocks';
      return next;
    end if;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
end;
$$;

revoke execute on function public.member_todos(uuid, timestamptz) from public, anon, authenticated;

commit;
