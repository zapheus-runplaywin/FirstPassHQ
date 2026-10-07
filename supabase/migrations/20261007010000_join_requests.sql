-- Join requests, admin approval, and team rosters.

-- ---------------------------------------------------------------------------
-- What the member asked for when they requested to join
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column requested_role public.app_role,
  add column requested_team_id uuid references public.teams (id) on delete set null,
  add column join_requested_at timestamptz;

-- Members submit their request through submit_join_request(); they can still
-- edit their name and PlayHQ email directly.

create function public.submit_join_request(
  p_full_name text,
  p_playhq_email text,
  p_requested_role public.app_role,
  p_requested_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
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

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- Saves an admin's changes to a member in one transaction: their role, status
-- and team memberships. p_teams is a JSON array of
-- {"team_id": "...", "coach_title": "head_coach" | "assistant_coach" | null}.
-- The team role comes from p_role, so it must be coach, manager or athlete
-- for p_teams to be non-empty.
create function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_role public.team_role;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  if p_profile_id = auth.uid() and (p_role <> 'admin' or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
  end if;
  if jsonb_typeof(p_teams) <> 'array' then
    raise exception 'p_teams must be a JSON array';
  end if;

  update public.profiles
  set role = p_role, status = p_status
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  delete from public.team_members where profile_id = p_profile_id;

  if jsonb_array_length(p_teams) = 0 or p_status <> 'approved' then
    return;
  end if;
  if p_role not in ('coach', 'manager', 'athlete') then
    raise exception 'Only coaches, managers and athletes can be added to a team';
  end if;
  v_team_role := p_role::text::public.team_role;

  insert into public.team_members (team_id, profile_id, team_role, coach_title)
  select
    (t ->> 'team_id')::uuid,
    p_profile_id,
    v_team_role,
    case when v_team_role = 'coach'
      then coalesce((t ->> 'coach_title')::public.coach_title, 'head_coach')
    end
  from jsonb_array_elements(p_teams) as t;
end;
$$;

-- ---------------------------------------------------------------------------
-- Team rosters: members see who else is in their teams (name and role only).
-- ---------------------------------------------------------------------------

create function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id and tm.profile_id = auth.uid() and p.status = 'approved'
  );
$$;

create function public.team_roster(p_team_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  team_role public.team_role,
  coach_title public.coach_title
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id, p.full_name, tm.team_role, tm.coach_title
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.team_id = p_team_id
    and p.status = 'approved'
    and (public.is_team_member(p_team_id) or public.is_admin())
  order by
    case tm.team_role when 'coach' then 0 when 'manager' then 1 else 2 end,
    case tm.coach_title when 'head_coach' then 0 else 1 end,
    p.full_name;
$$;

-- Functions are executable by PUBLIC by default; limit them to signed-in users.
revoke execute on function public.submit_join_request(text, text, public.app_role, uuid) from public, anon;
revoke execute on function public.admin_save_member(uuid, public.app_role, public.member_status, jsonb) from public, anon;
revoke execute on function public.is_team_member(uuid) from public, anon;
revoke execute on function public.team_roster(uuid) from public, anon;
grant execute on function public.submit_join_request(text, text, public.app_role, uuid) to authenticated;
grant execute on function public.admin_save_member(uuid, public.app_role, public.member_status, jsonb) to authenticated;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.team_roster(uuid) to authenticated;
