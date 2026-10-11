-- Any number of captains and vice captains per squad or team.
--
-- Matt (2026-10-09): it's up to the coach. Sometimes a group has co-captains
-- and no vice captains, sometimes one captain and four vice captains.
--
-- - Removes the one-captain-per-group index. Each athlete is still either a
--   captain or a vice captain of a group, never both (the primary key).
-- - New set_group_captains(p_team_id, p_captain_ids, p_vice_captain_ids)
--   takes a list of captains. The old one-captain version stays so app builds
--   that haven't updated yet keep working.
--
-- Additive only: drops an index (no data), adds a function. No rows change.

begin;

drop index if exists public.team_captains_one_captain_idx;

-- Admins and the group's coaches. Sets the captains and vice captains; all
-- must be athletes in the group, and nobody can be both.
create or replace function public.set_group_captains(
  p_team_id uuid,
  p_captain_ids uuid[],
  p_vice_captain_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_captains uuid[] := coalesce(p_captain_ids, '{}');
  v_vice uuid[] := coalesce(p_vice_captain_ids, '{}');
begin
  if not exists (select 1 from public.teams where id = p_team_id and not archived) then
    raise exception 'Choose a current squad or team';
  end if;
  if not (public.is_admin() or exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role = 'coach'
      and p.status = 'approved'
  )) then
    raise exception 'Only admins and this group''s coaches can choose its captains';
  end if;
  if v_captains && v_vice then
    raise exception 'A captain can''t also be a vice captain';
  end if;

  if exists (
    select 1 from unnest(v_captains || v_vice) as i(id)
    where not exists (
      select 1 from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = p_team_id and tm.profile_id = i.id
        and tm.team_role = 'athlete' and p.status = 'approved'
    )
  ) then
    raise exception 'Captains must be athletes in this squad or team';
  end if;

  delete from public.team_captains where team_id = p_team_id;

  insert into public.team_captains (team_id, profile_id, captain_role)
  select p_team_id, i.id, 'captain'::public.captain_role
  from (select distinct unnest(v_captains) as id) i;

  insert into public.team_captains (team_id, profile_id, captain_role)
  select p_team_id, i.id, 'vice_captain'::public.captain_role
  from (select distinct unnest(v_vice) as id) i;
end;
$$;

revoke execute on function public.set_group_captains(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.set_group_captains(uuid, uuid[], uuid[]) to authenticated;

commit;
