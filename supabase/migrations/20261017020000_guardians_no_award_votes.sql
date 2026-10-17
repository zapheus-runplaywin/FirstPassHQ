-- Parents and guardians don't vote in club awards (Matt, 17 October 2026).
-- Someone who is a guardian and also holds another role, such as a coach who
-- is a parent, still votes in that other role. Integrity training is
-- unchanged: guardians can still be given courses and still upload
-- certificates for their children under 18.
--
-- This migration changes no rows. It replaces one function. Awards already
-- saved with Guardians among their voter roles keep that value, but it no
-- longer counts; the app stops offering Guardians as a choice.

begin;

-- Who can vote in an award: as before, without the guardian role.
create or replace function public.award_voters(p_award_id uuid, p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.awards a
  join public.profiles p
    on p.status = 'approved' and not public.is_view_only_member(p.role, p.extra_roles)
  where a.id = p_award_id
    and (
      ('member' = any (a.voter_roles)
        -- Every member means every member who holds a role besides guardian.
        and exists (
          select 1 from unnest(public.roles_of(p.role, p.extra_roles)) as r
          where r <> 'guardian'
        )
        -- An award with a winner for each team or squad is for the people in it.
        and (not a.per_group or public.in_award_group(p.id, p_team_id)))
      -- Committee, admin and partner aren't tied to a group.
      or exists (
        select 1 from unnest(public.roles_of(p.role, p.extra_roles)) as r
        where r <> 'guardian'
          and r::text = any (a.voter_roles)
          and (a.club_wide or r in ('committee', 'admin', 'partner'))
      )
      or exists (
        select 1 from public.team_members tm
        where tm.profile_id = p.id
          and tm.team_role::text <> 'guardian'
          and tm.team_role::text = any (a.voter_roles)
          and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
      )
    );
$$;

revoke execute on function public.award_voters(uuid, uuid) from public, anon, authenticated;

commit;
