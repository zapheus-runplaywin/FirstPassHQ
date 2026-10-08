import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { formatShortDay } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type {
  CoachTeamGame,
  GameGoal,
  GameGoalComment,
  GoalBoardRow,
  GoalGame,
  GoalOutcome,
  TeamGameGoal,
} from '@/lib/types';

export const GOAL_COLUMNS =
  'id, athlete_id, fixture_id, body, set_by, set_by_name, set_by_coach, outcome, reflection, reflected_at, created_at';
export const GOAL_COMMENT_COLUMNS = 'id, goal_id, author_id, author_name, body, created_at';
export const TEAM_GOAL_COLUMNS =
  'id, fixture_id, body, set_by_name, outcome, review, reviewed_by_name, created_at';

/** Played games shown at a time. */
export const PAST_PAGE_SIZE = 10;

/** A game holds up to this many goals (the database says the same). */
export const MAX_GOALS = 10;

export const outcomeOptions: { value: GoalOutcome; label: string }[] = [
  { value: 'achieved', label: 'Achieved' },
  { value: 'partly', label: 'Partly' },
  { value: 'not_yet', label: 'Not yet' },
];

export function outcomeLabel(outcome: GoalOutcome | null) {
  return outcomeOptions.find((o) => o.value === outcome)?.label ?? null;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** Such as "Round 3 v Swans". */
export function gameTitle(game: Pick<GoalGame, 'round_name' | 'opponent'>) {
  return [game.round_name ?? 'Match', game.opponent].filter(Boolean).join(' v ');
}

/** Such as "Sat 11 Oct · 2:00 pm · 17 & Under". */
export function gameWhen(game: Pick<GoalGame, 'starts_at' | 'time_tbc' | 'team_name'>) {
  const start = new Date(game.starts_at);
  return [
    formatShortDay(start),
    game.time_tbc ? 'time TBC' : timeFormat.format(start),
    game.team_name,
  ].join(' · ');
}

export type GamePhase = 'open' | 'playing' | 'played';

/** Goals are set until the game starts and reflected on once it's been played. */
export function gamePhase(game: Pick<GoalGame, 'goals_close_at' | 'played_at'>, now = new Date()) {
  if (now < new Date(game.goals_close_at)) return 'open';
  if (now < new Date(game.played_at)) return 'playing';
  return 'played';
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Such as "2 goals · 1 reflected · 1 coach comment". */
export function goalCountsLine(game: GoalGame) {
  if (game.goal_count === 0) return 'No goals set';
  const parts = [plural(game.goal_count, 'goal', 'goals')];
  if (gamePhase(game) === 'played') {
    parts.push(
      game.reflected_count === game.goal_count
        ? '✓ Reflected'
        : `${game.reflected_count} of ${game.goal_count} reflected`,
    );
    if (game.comment_count > 0) {
      parts.push(plural(game.comment_count, 'coach comment', 'coach comments'));
    }
  }
  return parts.join(' · ');
}

/** Athletes set goals for their own games. */
export function useIsGoalAthlete() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && profile.role === 'athlete';
}

/** Parents and guardians act for their athletes. */
export function useIsGoalGuardian() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && profile.role === 'guardian';
}

/**
 * Coaches of a current squad or team add goals and comment. Like check-ins, a
 * squad's coaches stop once its squad phase is complete.
 */
export function useIsGoalCoach() {
  const { profile, memberships } = useAuth();
  if (profile?.status !== 'approved') return false;
  return memberships.some((m) => m.team_role === 'coach' && !m.team.selections_completed_at);
}

export async function fetchNextGame(athleteId: string) {
  const { data } = await supabase.rpc('goal_next_game', { p_athlete_id: athleteId });
  return ((data as GoalGame[] | null) ?? [])[0] ?? null;
}

/** A page of played games, and whether there are more after it. */
export async function fetchPastGames(athleteId: string, offset: number) {
  const { data, error } = await supabase.rpc('goal_past_games', {
    p_athlete_id: athleteId,
    p_limit: PAST_PAGE_SIZE + 1,
    p_offset: offset,
  });
  if (error) throw error;
  const rows = (data as GoalGame[] | null) ?? [];
  return { games: rows.slice(0, PAST_PAGE_SIZE), more: rows.length > PAST_PAGE_SIZE };
}

export async function fetchGame(athleteId: string, fixtureId: string) {
  const { data } = await supabase.rpc('goal_game', {
    p_athlete_id: athleteId,
    p_fixture_id: fixtureId,
  });
  return ((data as GoalGame[] | null) ?? [])[0] ?? null;
}

export async function fetchGoals(athleteId: string, fixtureId: string) {
  const { data: goals } = await supabase
    .from('game_goals')
    .select(GOAL_COLUMNS)
    .eq('athlete_id', athleteId)
    .eq('fixture_id', fixtureId)
    .order('created_at');
  const list = (goals as GameGoal[] | null) ?? [];
  if (list.length === 0) return { goals: list, comments: [] as GameGoalComment[] };
  const { data: comments } = await supabase
    .from('game_goal_comments')
    .select(GOAL_COMMENT_COLUMNS)
    .in(
      'goal_id',
      list.map((g) => g.id),
    )
    .order('created_at');
  return { goals: list, comments: (comments as GameGoalComment[] | null) ?? [] };
}

/** The coaches' goals for the whole squad or team in a game. */
export async function fetchTeamGoals(fixtureId: string) {
  const { data } = await supabase
    .from('team_game_goals')
    .select(TEAM_GOAL_COLUMNS)
    .eq('fixture_id', fixtureId)
    .order('created_at');
  return (data as TeamGameGoal[] | null) ?? [];
}

/**
 * For the home screen: the athlete's next game and their last played one,
 * for the Goals card and to-do list.
 */
export function useMyGoals() {
  const { session } = useAuth();
  const { features } = useClub();
  const isAthlete = useIsGoalAthlete();
  const userId = session?.user.id;
  const on = features.goals && isAthlete && !!userId;
  // undefined while loading, so the to-do list doesn't flash an item.
  const [state, setState] = useState<{ next: GoalGame | null; last: GoalGame | null }>();

  const load = useCallback(async () => {
    if (!on || !userId) return;
    const [next, past] = await Promise.all([
      fetchNextGame(userId),
      fetchPastGames(userId, 0).catch(() => ({ games: [] as GoalGame[] })),
    ]);
    setState({ next, last: past.games[0] ?? null });
  }, [on, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { myGoals: on ? state : undefined, reloadMyGoals: load };
}

/** For coaches: their athletes' next games and reflections waiting for a comment. */
export function useGoalBoard() {
  const { features } = useClub();
  const isCoach = useIsGoalCoach();
  const on = features.goals && isCoach;
  const [board, setBoard] = useState<GoalBoardRow[] | null>(null);

  const load = useCallback(async () => {
    if (!on) return;
    const { data } = await supabase.rpc('goal_board');
    setBoard((data as GoalBoardRow[] | null) ?? []);
  }, [on]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { goalBoard: on ? board : null, reloadGoalBoard: load };
}

/** For coaches: each group's next game (or last played one), for team goals. */
export function useCoachTeamGames() {
  const { features } = useClub();
  const isCoach = useIsGoalCoach();
  const on = features.goals && isCoach;
  const [games, setGames] = useState<CoachTeamGame[] | null>(null);

  const load = useCallback(async () => {
    if (!on) return;
    const { data } = await supabase.rpc('coach_team_games');
    setGames((data as CoachTeamGame[] | null) ?? []);
  }, [on]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { teamGames: on ? games : null, reloadTeamGames: load };
}

/** Reflections across the coach's athletes that no coach has commented on. An athlete in a squad and its team is counted once. */
export function reflectionsToAnswer(board: GoalBoardRow[] | null) {
  const byAthlete = new Map<string, number>();
  for (const row of board ?? []) byAthlete.set(row.athlete_id, row.reflections_to_answer);
  let total = 0;
  for (const n of byAthlete.values()) total += n;
  return total;
}
