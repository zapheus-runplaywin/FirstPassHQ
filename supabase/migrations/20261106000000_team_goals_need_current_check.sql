-- Team goals need a current check for coaches (security audit run 1, 6
-- November 2026).
--
-- 20261017040000_coach_guide_audit.sql rewrote can_view_team_goals and
-- fixture_team_role to look for a coach or athlete placement in the game's
-- squad or team. The rewrite dropped the is_team_member() call, which admits
-- staff placements only while can_work_with_children() is true. Placements
-- stay when a coach's check lapses (coach rights need a current check each
-- time they are used, 20261012220000_stand_downs.sql), and a stand-down keeps
-- placements in archived groups. So a coach with a lapsed check could still
-- read a team's goals and the athletes' comments, including children's, and
-- post comments as a coach; a stood-down coach could still read them for an
-- archived group. Every sibling path (fixtures, save_team_game_goal, the goal
-- board, messages) already refuses them.
--
-- Now a coach placement counts only while can_work_with_children() is true:
-- approved, not stood down, not a locked child, and cleared. Athletes, the
-- athletes' guardians and admins are unchanged.
--
-- Additive only: two functions are replaced; no table or row changes.

begin;

create or replace function public.can_view_team_goals(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and exists (
    select 1 from public.fixtures f
    where f.id = p_fixture_id
      and f.team_id is not null
      and (
        public.is_admin()
        or exists (
          select 1 from public.team_members m
          where m.team_id = f.team_id
            and m.profile_id = auth.uid()
            and (
              m.team_role = 'athlete'
              or (m.team_role = 'coach' and public.can_work_with_children())
            )
        )
        or exists (
          select 1 from public.team_members a
          where a.team_id = f.team_id and a.team_role = 'athlete'
            and public.is_guardian_of(a.profile_id)
        )
      )
  );
$$;

revoke execute on function public.can_view_team_goals(uuid) from public, anon;
grant execute on function public.can_view_team_goals(uuid) to authenticated;

-- The signed-in member's part in the current squad or team a game is for
-- (coach or athlete), or null if they aren't in it as one of those. A coach
-- counts only with a current check and not stood down.
create or replace function public.fixture_team_role(p_fixture_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.team_role::text
  from public.fixtures f
  join public.teams t on t.id = f.team_id
  join public.team_members m on m.team_id = t.id and m.profile_id = auth.uid()
  where f.id = p_fixture_id
    and (
      m.team_role = 'athlete'
      or (m.team_role = 'coach' and public.can_work_with_children())
    )
    and not t.archived
    and public.is_approved()
  order by case m.team_role when 'coach' then 1 else 2 end
  limit 1;
$$;

revoke execute on function public.fixture_team_role(uuid) from public, anon;
grant execute on function public.fixture_team_role(uuid) to authenticated;

commit;
