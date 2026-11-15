-- Coaches and managers open a game in Vision without a pair code (Matt,
-- cross-product review 2026-11-15, "Drop the pair code for coaches").
--
-- Until now a coach or manager typed the game's six-digit pair code into
-- Vision, which made them a game member (is_game_member), and membership is
-- what lets them read the game's events and snapshots and join its live
-- Realtime topic. The code expired 24 hours after full time and five misses
-- in ten minutes locked them out, so tapping an older finished game in
-- Vision locked a coach out (revocation test section 5). They could already
-- see the game itself (may_view_game), so the code added nothing.
--
-- follow_game(p_game_id uuid) returns public.games: anyone for whom
-- may_view_game(p_game_id) is true joins the game as a viewer by its id, with
-- no code, no expiry and no failed-attempt count. Calling it again is
-- harmless, and it never lowers a recorder or shadow to a viewer. Anyone
-- else, and a game that doesn't exist, gets
--   'You can''t follow this game'  (errcode 42501)
-- so the call doesn't reveal which game ids exist.
--
-- pair_game(code) stays only for shadow statisticians: pair_game(code, false)
-- now refuses with 'Open the game from your games list' (42501) before
-- anything else, without counting a failed attempt.
--
-- Access still runs through may_view_game on every read: is_game_member asks
-- it as well as membership, so a coach who leaves the squad or team, is stood
-- down or whose check lapses stops reading at once, as before. No table or
-- row changes; pair_game keeps its signature, so there are no overloads.

begin;

create or replace function public.follow_game(p_game_id uuid)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if p_game_id is null or not public.may_view_game(p_game_id) then
    raise exception 'You can''t follow this game' using errcode = '42501';
  end if;
  insert into public.game_members (game_id, profile_id, game_role)
  values (p_game_id, auth.uid(), 'viewer')
  on conflict (game_id, profile_id) do nothing;
  select * into g from public.games where id = p_game_id;
  return g;
end;
$$;

comment on function public.follow_game(uuid) is
  'Vision: anyone who may see a game (may_view_game) follows it by id as a viewer, with no pair code, expiry or attempt count.';

revoke execute on function public.follow_game(uuid) from public, anon;
grant execute on function public.follow_game(uuid) to authenticated;

-- A shadow statistician pairs with a live game by its six-digit code. Only
-- works for a statistician or admin; coaches and managers use follow_game.
-- A miss returns null (raising would roll back the attempt record); five
-- misses in ten minutes lock the member out.
create or replace function public.pair_game(p_code text, p_as_shadow boolean default false)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if not coalesce(p_as_shadow, false) then
    raise exception 'Open the game from your games list' using errcode = '42501';
  end if;
  if (
    select count(*) from public.game_pair_attempts
    where profile_id = auth.uid() and attempted_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Too many tries. Wait ten minutes and try again' using errcode = '54000';
  end if;

  select * into g from public.games
  where pair_code = regexp_replace(p_code, '\D', '', 'g')
    and (pair_code_expires_at is null or pair_code_expires_at > now());

  if g.id is null or not public.may_view_game(g.id) then
    insert into public.game_pair_attempts (profile_id) values (auth.uid());
    return null;
  end if;

  if not public.is_statistician() then
    raise exception 'Only statisticians can shadow a game' using errcode = '42501';
  end if;

  insert into public.game_members (game_id, profile_id, game_role)
  values (g.id, auth.uid(), 'shadow')
  on conflict (game_id, profile_id) do update
    set game_role = case
      when public.game_members.game_role = 'recorder' then 'recorder'::public.game_role
      else 'shadow'::public.game_role
    end;
  return g;
end;
$$;

comment on function public.pair_game(text, boolean) is
  'Vantage: a shadow statistician pairs with a live game by its code. Coaches and managers use follow_game instead.';

revoke execute on function public.pair_game(text, boolean) from public, anon;
grant execute on function public.pair_game(text, boolean) to authenticated;

commit;
