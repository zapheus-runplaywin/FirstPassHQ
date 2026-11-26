-- Team goals stay with the team (Matt, 27 November 2026): "An admin doesn't
-- need to see the team goals. This is a team thing and somewhat private to
-- that team."
--
-- Until now an admin read every team's goals and the comments on them
-- (20261020000000_admin_guide_audit.sql, part 3): can_view_team_goals let
-- any admin through, and admin_team_games listed every team's next and last
-- game for them. Now an admin reads a team's goals only when they would
-- without being an admin: as one of its athletes, one of its coaches with a
-- current check, or the parent or guardian of one of its athletes.
--
-- can_view_team_goals is the read rule of team_game_goals and
-- team_game_goal_comments, so both tables follow. admin_team_games stays, so
-- that an app not yet updated gets an empty list rather than an error, and
-- lists nothing for anyone.
--
-- Two functions are replaced. No table or row changes: nothing is deleted.

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
        exists (
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

-- Kept for apps from before this change, which ask for it: it lists nothing.
create or replace function public.admin_team_games()
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  fixture_id uuid,
  is_next boolean,
  round_name text,
  opponent text,
  starts_at timestamptz,
  time_tbc boolean,
  goals_close_at timestamptz,
  played_at timestamptz,
  goal_count int,
  reviewed_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    null::uuid, null::text, null::text, null::uuid, null::boolean, null::text, null::text,
    null::timestamptz, null::boolean, null::timestamptz, null::timestamptz, null::int, null::int
  where false;
$$;
revoke execute on function public.admin_team_games() from public, anon;
grant execute on function public.admin_team_games() to authenticated;

commit;
