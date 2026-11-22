-- PlayHQ results for games nobody recorded, for the season view.
--
-- FirstPass Vision's season view adds up a team's games recorded in FirstPass
-- Vantage. A game with no statistician adds nothing, though the association's
-- scorer may have entered each shooter's goals in PlayHQ, where the public
-- can already read them. The playhq function (supabase/functions/playhq) now
-- reads those games from PlayHQ for the people who already see the team's
-- recorded games, so the season view can show them, marked as PlayHQ's.
--
-- Nothing is stored. This migration gives the function what it needs:
--
--   may_view_team_games(team)  the same rule as may_view_game, asked of a
--     team: statisticians and admins, and coaches and managers of the team
--     or its squad who may work with children.
--
--   playhq_unrecorded_games(team)  for those people only: the team's past
--     PlayHQ fixtures with no finished recording, newest first (40 at most),
--     each with its PlayHQ game id and the PlayHQ site it is on; and the
--     team's athletes' registered and lineup names, so the function can
--     give a player the name the lineup uses.
--
-- Additive: two functions, no table, no data changed.

begin;

create or replace function public.may_view_team_games(p_team_id uuid)
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
      from public.teams gt
      join public.team_members tm on tm.team_id in (gt.id, gt.squad_id)
      where gt.id = p_team_id
        and tm.profile_id = auth.uid()
        and tm.team_role in ('coach', 'manager')
    )
  );
$$;

comment on function public.may_view_team_games(uuid) is
  'The may_view_game rule asked of a team: statisticians and admins see every team''s games; coaches and managers who may work with children see the games of their squad or team, and of the teams in a squad they are on.';

revoke execute on function public.may_view_team_games(uuid) from public, anon;
grant execute on function public.may_view_team_games(uuid) to authenticated;

create or replace function public.playhq_unrecorded_games(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.may_view_team_games(p_team_id), false) then
    raise exception 'Only the team''s coaches and managers, statisticians and admins can read its PlayHQ results'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fixture_id', x.id,
        'playhq_game_id', x.playhq_game_id,
        'tenant', x.tenant,
        'starts_at', x.starts_at,
        'opponent', x.opponent,
        'round_name', x.round_name,
        'is_home', x.is_home
      ) order by x.starts_at desc)
      from (
        select f.id, f.playhq_game_id, f.starts_at, f.opponent, f.round_name, f.is_home,
          substring(s.url from 'playhq\.com/([a-z0-9-]+)/') as tenant
        from public.fixtures f
        join public.playhq_teams l on l.playhq_team_id = f.playhq_team_id
        join public.playhq_seasons s on s.playhq_season_id = l.playhq_season_id
        where f.team_id = p_team_id
          and f.playhq_game_id is not null
          and f.playhq_game_id not like 'bye-%'
          and f.opponent is not null
          and f.is_home is not null
          and f.starts_at < now()
          and substring(s.url from 'playhq\.com/([a-z0-9-]+)/') is not null
          and not exists (
            select 1 from public.games g
            where g.status = 'final'
              and (g.fixture_id = f.id or (g.playhq_game_id = f.playhq_game_id and g.team_id = f.team_id))
          )
        order by f.starts_at desc
        limit 40
      ) x
    ), '[]'::jsonb),
    'names', coalesce((
      select jsonb_agg(jsonb_build_object(
        'registered', p.full_name,
        'lineup', coalesce(nullif(trim(p.preferred_name), ''), p.full_name)
      ) order by p.full_name)
      from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = p_team_id
        and tm.team_role = 'athlete'
        and p.status = 'approved'
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.playhq_unrecorded_games(uuid) is
  'For the people who see a team''s recorded games: its past PlayHQ fixtures with no finished recording, and its athletes'' registered and lineup names. Read by the playhq function for the season view; nothing is stored.';

revoke execute on function public.playhq_unrecorded_games(uuid) from public, anon;
grant execute on function public.playhq_unrecorded_games(uuid) to authenticated;

commit;
