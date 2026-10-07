-- Rejection reasons and in-person verification.
--
-- When an admin doesn't approve someone, they can say why (for example a
-- guardian whose PlayHQ email doesn't match a registration), and the member
-- sees it. Anyone not yet approved, or not approved, is shown a 6-digit code
-- in the app. If an admin can't match them to PlayHQ, they meet in person or
-- use a channel the admin already trusts, the member reads out the code, and
-- the admin enters it to confirm who they are.

create type public.rejection_reason as enum (
  'playhq_email_mismatch',
  'not_registered',
  'other'
);

alter table public.profiles
  add column rejection_reason public.rejection_reason,
  add column verified_at timestamptz,
  add column verified_by uuid references public.profiles (id) on delete set null;

-- One live code per member. Only reached through the functions below.
create table public.verification_codes (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  expires_at timestamptz not null
);

alter table public.verification_codes enable row level security;

-- The signed-in member's code, made (or remade once expired) on request.
-- Approved members don't need one.
create function public.my_verification_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and status <> 'approved'
  ) then
    return null;
  end if;

  select code into v_code
  from public.verification_codes
  where profile_id = auth.uid() and expires_at > now();
  if v_code is not null then
    return v_code;
  end if;

  -- 6 random digits from a secure source.
  v_code := lpad(
    ((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text,
    6,
    '0'
  );
  insert into public.verification_codes (profile_id, code, expires_at)
  values (auth.uid(), v_code, now() + interval '7 days')
  on conflict (profile_id) do update
    set code = excluded.code, expires_at = excluded.expires_at;
  return v_code;
end;
$$;

revoke execute on function public.my_verification_code() from public, anon;
grant execute on function public.my_verification_code() to authenticated;

-- An admin enters the code the member shows them. A match marks the member as
-- verified; approving them is still a separate step.
create function public.admin_verify_member(p_profile_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can verify members';
  end if;
  if not exists (
    select 1 from public.verification_codes
    where profile_id = p_profile_id
      and code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g')
      and expires_at > now()
  ) then
    raise exception 'That code doesn''t match. Ask them to open the app and read out the code shown now.';
  end if;

  update public.profiles
  set verified_at = now(), verified_by = auth.uid()
  where id = p_profile_id;
  delete from public.verification_codes where profile_id = p_profile_id;
end;
$$;

revoke execute on function public.admin_verify_member(uuid, text) from public, anon;
grant execute on function public.admin_verify_member(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Saving a member can now record why they weren't approved.
-- ---------------------------------------------------------------------------

drop function public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[]
);

create function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb,
  p_under_17 boolean default false,
  p_guardian_ids uuid[] default '{}',
  p_rejection_reason public.rejection_reason default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_role public.team_role;
  v_under_17 boolean := p_role = 'athlete' and coalesce(p_under_17, false);
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
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
  if cardinality(v_guardian_ids) > 0 and not v_under_17 then
    raise exception 'Only athletes under 17 have guardians';
  end if;
  if p_profile_id = any (v_guardian_ids) then
    raise exception 'A member cannot be their own guardian';
  end if;
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    where not exists (
      select 1 from public.profiles p
      where p.id = g.id and p.role = 'guardian' and p.status = 'approved'
    )
  ) then
    raise exception 'Guardians must be approved members with the Guardian role';
  end if;

  update public.profiles
  set role = p_role,
      status = p_status,
      under_17 = v_under_17,
      rejection_reason = case when p_status = 'rejected' then p_rejection_reason end
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  -- Guardian links: replace this athlete's guardians, and drop links from
  -- anyone who is no longer an approved guardian.
  delete from public.guardianships where athlete_id = p_profile_id;
  if p_role <> 'guardian' or p_status <> 'approved' then
    delete from public.guardianships where guardian_id = p_profile_id;
  end if;
  if p_status = 'approved' then
    insert into public.guardianships (guardian_id, athlete_id)
    select distinct g.id, p_profile_id from unnest(v_guardian_ids) as g (id);
  end if;

  delete from public.team_members where profile_id = p_profile_id;

  if jsonb_array_length(p_teams) = 0 or p_status <> 'approved' then
    return;
  end if;
  if p_role not in ('coach', 'manager', 'athlete', 'guardian') then
    raise exception 'Only coaches, managers, athletes and guardians can be added to a squad or team';
  end if;
  v_team_role := p_role::text::public.team_role;

  -- Teams are named from a squad, so a member of a team must be in its squad.
  if exists (
    select 1
    from jsonb_array_elements(p_teams) as t
    join public.teams g on g.id = (t ->> 'team_id')::uuid
    where g.kind = 'team'
      and not exists (
        select 1 from jsonb_array_elements(p_teams) as s
        where (s ->> 'team_id')::uuid = g.squad_id
      )
  ) then
    raise exception 'Add them to the squad before naming them in one of its teams';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    g.id,
    p_profile_id,
    v_team_role,
    case when p_role = 'coach'
      then coalesce((t ->> 'coach_title')::public.coach_title, 'head_coach')
    end,
    case when p_role = 'athlete' and g.kind = 'team'
      then coalesce((t ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(p_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;
end;
$$;


revoke execute on function public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason
) from public, anon;
grant execute on function public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason
) to authenticated;
