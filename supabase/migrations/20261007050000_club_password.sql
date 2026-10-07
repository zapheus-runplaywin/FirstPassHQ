-- A club password that new members enter when they ask to join, so people
-- outside the club can't send join requests. Admins set and share it. Only a
-- hash is stored, and nobody can read it back; admins can only replace it.

create table public.club_settings (
  -- Always true: the table holds a single row.
  id boolean primary key default true check (id),
  join_password_hash text
);

insert into public.club_settings default values;

-- No policies: the table is only reached through the functions below.
alter table public.club_settings enable row level security;

-- Whether new members need the club password. The join screen asks for it
-- only when one is set.
create function public.join_password_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select join_password_hash is not null from public.club_settings;
$$;

revoke execute on function public.join_password_required() from public, anon;
grant execute on function public.join_password_required() to authenticated;

-- Sets the club password. An empty password turns the check off.
create function public.admin_set_join_password(p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can set the club password';
  end if;
  update public.club_settings
  set join_password_hash = case
    when coalesce(trim(p_password), '') = '' then null
    else extensions.crypt(trim(p_password), extensions.gen_salt('bf'))
  end;
end;
$$;

revoke execute on function public.admin_set_join_password(text) from public, anon;
grant execute on function public.admin_set_join_password(text) to authenticated;

-- Same as before, plus the club password when one is set.
drop function public.submit_join_request(text, text, public.app_role, uuid);

create function public.submit_join_request(
  p_full_name text,
  p_playhq_email text,
  p_requested_role public.app_role,
  p_requested_team_id uuid,
  p_join_password text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select join_password_hash into v_hash from public.club_settings;
  if v_hash is not null
     and extensions.crypt(coalesce(trim(p_join_password), ''), v_hash) <> v_hash then
    raise exception 'That club password is not right. Ask a club admin for it.';
  end if;
  if p_requested_role = 'admin' then
    raise exception 'Admin access cannot be requested';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      playhq_email = nullif(lower(trim(p_playhq_email)), ''),
      requested_role = p_requested_role,
      requested_team_id = p_requested_team_id,
      join_requested_at = now(),
      -- A rejected member can ask again.
      status = case when status = 'rejected' then 'pending'::public.member_status else status end
  where id = auth.uid() and status <> 'approved';
end;
$$;

revoke execute on function public.submit_join_request(text, text, public.app_role, uuid, text)
  from public, anon;
grant execute on function public.submit_join_request(text, text, public.app_role, uuid, text)
  to authenticated;
