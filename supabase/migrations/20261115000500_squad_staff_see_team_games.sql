-- A coach or manager placed on a squad follows the games of the teams in
-- that squad (Matt, cross-product review 2026-11-15).
--
-- may_view_game let a coach or manager see a game only when they were on
-- the exact squad or team the game was recorded for. Games are usually
-- recorded for a team (Open A, 17 & under...), while assistant coaches and
-- managers are often placed on the squad only, so they couldn't follow their
-- own athletes' games in Vision (revocation test section 6: Emery and
-- Morgan).
--
-- Now a coach or manager also sees a game recorded for a team whose squad
-- they're on. The same can_work_with_children() rule applies (approved, not
-- stood down, check current), and nothing else changes: statisticians and
-- admins see every game, a team's own staff see its games, physios,
-- athletes, guardians and the committee see none, and a squad's staff don't
-- see another squad's games. Everything that asks may_view_game (the games
-- and game_members row rules, is_game_member for events, snapshots and the
-- live Realtime topic, follow_game and pair_game) follows the new rule.
--
-- No table or row changes; same signature, so no overload.

begin;

create or replace function public.may_view_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_statistician() or (
    public.can_work_with_children()
    and exists (
      select 1
      from public.games g
      join public.teams gt on gt.id = g.team_id
      join public.team_members tm on tm.team_id in (gt.id, gt.squad_id)
      where g.id = p_game_id
        and tm.profile_id = auth.uid()
        and tm.team_role in ('coach', 'manager')
    )
  );
$$;

comment on function public.may_view_game(uuid) is
  'Statisticians and admins see every game; coaches and managers who may work with children see the games of their squad or team, and of the teams in a squad they are on.';

revoke execute on function public.may_view_game(uuid) from public, anon;
grant execute on function public.may_view_game(uuid) to authenticated;

commit;
