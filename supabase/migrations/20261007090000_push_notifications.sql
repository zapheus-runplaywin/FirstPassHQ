-- Push notifications to admins' phones when someone asks to join.
--
-- The app registers an Expo push token for each admin's phone. When a join
-- request is sent, a trigger posts a message for every admin token to Expo's
-- push service using pg_net, so no server or edge function is needed.

create extension if not exists pg_net;

create table public.push_tokens (
  token text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);

create index push_tokens_profile_id_idx on public.push_tokens (profile_id);

-- Changed only through the functions below.
alter table public.push_tokens enable row level security;

create policy "Members see their own push tokens"
  on public.push_tokens for select to authenticated
  using (profile_id = auth.uid());

-- Saves this phone's token for the signed-in member. A phone that changes
-- hands moves to the new member.
create function public.register_push_token(p_token text, p_platform text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_token !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'Not an Expo push token';
  end if;
  insert into public.push_tokens (token, profile_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set profile_id = excluded.profile_id,
        platform = excluded.platform,
        updated_at = now();
end;
$$;

create function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and profile_id = auth.uid();
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Tell admins about new join requests
-- ---------------------------------------------------------------------------

create function public.notify_admins_of_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', 'New request to join',
    'body', coalesce(nullif(new.full_name, ''), new.email, 'Someone')
      || ' asked to join as '
      || coalesce(initcap(new.requested_role::text), 'a member')
      || '.',
    'data', jsonb_build_object('memberId', new.id),
    'sound', 'default',
    'channelId', 'join-requests'
  ))
  into v_messages
  from public.push_tokens t
  join public.profiles p on p.id = t.profile_id
  where p.role = 'admin' and p.status = 'approved' and p.id <> new.id;

  if v_messages is not null then
    -- Sent in the background once the transaction commits.
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_messages,
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
  end if;
  return new;
end;
$$;

create trigger profiles_notify_admins_of_join_request
  after update of join_requested_at on public.profiles
  for each row
  when (
    new.join_requested_at is not null
    and new.join_requested_at is distinct from old.join_requested_at
    and new.status = 'pending'
  )
  execute function public.notify_admins_of_join_request();
