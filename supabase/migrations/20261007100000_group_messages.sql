-- Group messages with read receipts.
--
-- Admins can message the whole club, everyone with a role, or a squad or team.
-- Coaches and managers can message the squads and teams they coach or manage.
-- Recipients are fixed when a message is sent, so read receipts always count
-- against the people it actually went to. Admins can read every message, so
-- the club can see what is sent to its athletes.
--
-- Additive only: two new tables and new functions.

create type public.message_audience as enum ('club', 'role', 'group');

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  -- Kept when the sender leaves, with their name as it was.
  sender_id uuid references public.profiles (id) on delete set null,
  sender_name text,
  body text not null check (length(body) between 1 and 4000),
  audience public.message_audience not null,
  -- Set when the message went to everyone with one role.
  audience_role public.app_role,
  -- Set when the message went to a squad or team; its name is kept too.
  team_id uuid references public.teams (id) on delete set null,
  audience_label text,
  created_at timestamptz not null default now(),
  constraint role_messages_name_a_role
    check ((audience = 'role') = (audience_role is not null)),
  constraint only_group_messages_name_a_team
    check (audience = 'group' or team_id is null)
);

create index messages_sender_id_idx on public.messages (sender_id, created_at desc);

create table public.message_recipients (
  message_id uuid not null references public.messages (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, profile_id)
);

create index message_recipients_inbox_idx
  on public.message_recipients (profile_id, created_at desc);

-- Written only through the functions below.
alter table public.messages enable row level security;
alter table public.message_recipients enable row level security;

-- ---------------------------------------------------------------------------
-- Who can see what
-- ---------------------------------------------------------------------------

-- security definer so the two policies can look at each other's table
-- without recursing.
create function public.is_message_recipient(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.message_recipients
    where message_id = p_message_id and profile_id = auth.uid()
  );
$$;

create function public.is_message_sender(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.messages
    where id = p_message_id and sender_id = auth.uid()
  );
$$;

revoke execute on function public.is_message_recipient(uuid) from public, anon;
grant execute on function public.is_message_recipient(uuid) to authenticated;
revoke execute on function public.is_message_sender(uuid) from public, anon;
grant execute on function public.is_message_sender(uuid) to authenticated;

create policy "Senders, recipients and admins see messages"
  on public.messages for select to authenticated
  using (sender_id = auth.uid() or public.is_admin() or public.is_message_recipient(id));

create policy "Recipients, senders and admins see receipts"
  on public.message_recipients for select to authenticated
  using (
    profile_id = auth.uid() or public.is_admin() or public.is_message_sender(message_id)
  );

-- Admins can message any squad or team; coaches and managers the ones they
-- coach or manage.
create function public.can_message_group(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role in ('coach', 'manager')
      and p.status = 'approved'
  );
$$;

revoke execute on function public.can_message_group(uuid) from public, anon;
grant execute on function public.can_message_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Sending and reading
-- ---------------------------------------------------------------------------

create function public.send_group_message(
  p_body text,
  p_audience public.message_audience,
  p_role public.app_role default null,
  p_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

  if p_audience in ('club', 'role') then
    if not public.is_admin() then
      raise exception 'Only admins can message the whole club or a role';
    end if;
    if p_audience = 'role' and p_role is null then
      raise exception 'Choose a role to message';
    end if;
  else
    select * into v_team from public.teams where id = p_team_id and not archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team to message';
    end if;
    if not public.can_message_group(v_team.id) then
      raise exception 'You can only message squads and teams you coach or manage';
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

  insert into public.message_recipients (message_id, profile_id)
  select distinct v_message_id, p.id
  from public.profiles p
  where p.status = 'approved'
    and p.id <> v_sender.id
    and case p_audience
      when 'club' then true
      when 'role' then p.role = p_role
      else exists (
        select 1 from public.team_members tm
        where tm.team_id = v_team.id and tm.profile_id = p.id
      )
    end;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the message too.
    raise exception 'Nobody else is in that group yet';
  end if;

  return v_message_id;
end;
$$;

revoke execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid)
  from public, anon;
grant execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid)
  to authenticated;

create function public.mark_message_read(p_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.message_recipients
  set read_at = now()
  where message_id = p_message_id and profile_id = auth.uid() and read_at is null;
$$;

revoke execute on function public.mark_message_read(uuid) from public, anon;
grant execute on function public.mark_message_read(uuid) to authenticated;

-- Messages the signed-in member sent, with how many people have read each.
create function public.my_sent_messages()
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
  where m.sender_id = auth.uid()
  group by m.id
  order by m.created_at desc
  limit 100;
$$;

revoke execute on function public.my_sent_messages() from public, anon;
grant execute on function public.my_sent_messages() to authenticated;

-- Who a message went to and when each person read it, for its sender and
-- admins. Recipients can't read each other's profiles, so names come from here.
create function public.message_receipts(p_message_id uuid)
returns table (profile_id uuid, full_name text, read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.profile_id, coalesce(nullif(p.full_name, ''), p.email), r.read_at
  from public.message_recipients r
  join public.profiles p on p.id = r.profile_id
  where r.message_id = p_message_id
    and (public.is_message_sender(p_message_id) or public.is_admin())
  order by r.read_at is null, r.read_at desc, p.full_name;
$$;

revoke execute on function public.message_receipts(uuid) from public, anon;
grant execute on function public.message_receipts(uuid) to authenticated;
