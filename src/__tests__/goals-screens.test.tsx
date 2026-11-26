/**
 * Game goals: one athlete's goals for one game (src/app/goals/game.tsx), an
 * athlete's games for their coaches and parents (src/app/goals/athlete/[id].tsx,
 * through src/components/goal-games.tsx), and a coach's team goals
 * (src/app/goals/team.tsx, with src/components/team-goals.tsx).
 *
 * Only the next game is open for goals, until it starts. The athlete sets and
 * reflects on their own goals; their coaches add goals (which only a coach can
 * change) and comment once it's played; parents and guardians only read.
 * Comments on team goals stay inside the team: its athletes and coaches add
 * them, parents read them, an athlete removes only their own and coaches
 * remove any (user guide sections 4 and 6, and AGENTS.md "No social media
 * features for children").
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import AthleteGoalsScreen from '@/app/goals/athlete/[id]';
import GameGoalsScreen from '@/app/goals/game';
import TeamGoalsScreen from '@/app/goals/team';
import type { GameStats } from '@/lib/game-stats';
import { supabase } from '@/lib/supabase';
import type {
  CoachTeamGame,
  GameGoal,
  GameGoalComment,
  GoalGame,
  TeamGameGoal,
  TeamGameGoalComment,
} from '@/lib/types';

import { clearCalls, onlyRpcCall, rpcCalls, rpcNames } from './helpers/calls';
import {
  morePersonas,
  openScreen,
  resetClub,
  settle,
  TEAM,
  TEAM_B,
  type Persona,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));

type Who = PersonaName | Persona;

// Each test fills in forms screen by screen; on a busy CI runner that can take
// longer than Jest's 5 second default.
jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  clearCalls();
});

const press = async (text: string | RegExp, index = 0) => {
  await fireEvent.press(screen.getAllByText(text)[index]);
  await settle(6);
};

const type = async (placeholder: string, value: string, index = 0) => {
  await fireEvent.changeText(screen.getAllByPlaceholderText(placeholder)[index], value);
  await settle(2);
};

// Today is 18 October 2026, 02:00 UTC.
const OPEN = { starts_at: '2026-10-20T08:00:00Z', goals_close_at: '2026-10-20T08:00:00Z', played_at: '2026-10-20T09:30:00Z' };
const PLAYING = { starts_at: '2026-10-18T01:00:00Z', goals_close_at: '2026-10-18T01:00:00Z', played_at: '2026-10-18T02:30:00Z' };
const PLAYED = { starts_at: '2026-10-11T08:00:00Z', goals_close_at: '2026-10-11T08:00:00Z', played_at: '2026-10-11T09:30:00Z' };

function game(extra: Partial<GoalGame> = {}): GoalGame {
  return {
    fixture_id: 'fx1',
    team_id: TEAM.id,
    team_name: TEAM.name,
    round_name: 'Round 3',
    opponent: 'Swans',
    time_tbc: false,
    venue: 'Stadium',
    court: 'Court 2',
    is_home: true,
    goal_count: 0,
    reflected_count: 0,
    comment_count: 0,
    ...OPEN,
    ...extra,
  };
}

function goal(extra: Partial<GameGoal> = {}): GameGoal {
  return {
    id: 'g1',
    athlete_id: 'athlete',
    fixture_id: 'fx1',
    body: 'Win 3 centre pass receives',
    set_by: 'athlete',
    set_by_name: 'Sample athlete',
    set_by_coach: false,
    outcome: null,
    reflection: null,
    reflected_at: null,
    created_at: '2026-10-17T00:00:00Z',
    ...extra,
  };
}

const COACH_GOAL = goal({
  id: 'g2',
  body: 'Talk on defence',
  set_by: 'coach',
  set_by_name: 'Sample coach',
  set_by_coach: true,
});

function teamGoal(extra: Partial<TeamGameGoal> = {}): TeamGameGoal {
  return {
    id: 'tg1',
    fixture_id: 'fx1',
    body: 'Win the third quarter',
    set_by_name: 'Sample coach',
    outcome: null,
    review: null,
    reviewed_by_name: null,
    created_at: '2026-10-16T00:00:00Z',
    ...extra,
  };
}

function teamComment(extra: Partial<TeamGameGoalComment> = {}): TeamGameGoalComment {
  return {
    id: 'tc1',
    goal_id: 'tg1',
    author_id: 'athlete',
    author_name: 'Sample athlete',
    author_role: 'athlete',
    body: 'I’ll push hard in the third',
    created_at: '2026-10-17T00:00:00Z',
    ...extra,
  };
}

type GameSetup = {
  shown?: GoalGame | null;
  goals?: GameGoal[];
  comments?: GameGoalComment[];
  teamGoals?: TeamGameGoal[];
  teamComments?: TeamGameGoalComment[];
  errors?: Record<string, string>;
  /** What the game-stats function answers: the athlete's figures, none, or a failure. */
  stats?: GameStats | null | 'fails';
};

const invoke = () => (supabase as unknown as { functions: { invoke: jest.Mock } }).functions.invoke;

const STATS: GameStats = {
  goals: 18,
  shots: 24,
  gains: 3,
  turnovers: 5,
  feeds: 7,
  offensiveRebounds: 2,
  defensiveRebounds: 0,
  minutes: 37.5,
  positions: ['GS', 'GA'],
};

async function openGame(
  who: Who,
  { shown = game(), goals = [], comments = [], teamGoals = [], teamComments = [], errors = {}, stats = null }: GameSetup = {},
  query = 'athlete=athlete&fixture=fx1&name=Sample%20athlete',
) {
  await openScreen(
    who,
    { 'goals/game': GameGoalsScreen },
    `/goals/game?${query}`,
    {
      game_goals: goals,
      game_goal_comments: comments,
      team_game_goals: teamGoals,
      team_game_goal_comments: teamComments,
    },
    {
      rpcs: { goal_game: shown ? [shown] : [] },
      rpcErrors: errors,
      functions: {
        'game-stats':
          stats === 'fails'
            ? { error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code' } }
            : { data: { stats } },
      },
    },
  );
}

const asCoach = 'athlete=athlete&fixture=fx1&name=Sample%20athlete';
const asGuardian = `${asCoach}&view=guardian`;

describe('one game’s goals before the game', () => {
  it('asks for this athlete’s game and records that their goals were viewed', async () => {
    await openGame('athlete');
    expect(rpcCalls('goal_game')).toEqual([{ p_athlete_id: 'athlete', p_fixture_id: 'fx1' }]);
    expect(rpcCalls('log_record_view')).toEqual([
      { p_subject_id: 'athlete', p_kind: 'goals', p_record_id: null },
    ]);
    expect(screen.getByText('Round 3 v Swans')).toBeTruthy();
    expect(screen.getByText(/ · Stadium, Court 2$/)).toBeTruthy();
  });

  it('lets the athlete add their own goal', async () => {
    await openGame('athlete');
    expect(screen.getByText('Goals can be added and changed until the game starts.')).toBeTruthy();
    expect(screen.getByText('No goals yet.')).toBeTruthy();
    await type('For example, win 3 centre pass receives', 'Hit the post less');
    await press('Add goal');
    expect(onlyRpcCall('save_game_goal')).toEqual({
      p_goal_id: null,
      p_athlete_id: 'athlete',
      p_fixture_id: 'fx1',
      p_body: 'Hit the post less',
    });
    // It loads the goals again.
    expect(rpcCalls('goal_game')).toHaveLength(2);
  });

  it('won’t add an empty goal', async () => {
    await openGame('athlete');
    await type('For example, win 3 centre pass receives', '   ');
    await press('Add goal');
    expect(rpcCalls('save_game_goal')).toEqual([]);
  });

  it('shows why a goal wasn’t added', async () => {
    await openGame('athlete', { errors: { save_game_goal: 'Goals for this game have closed' } });
    await type('For example, win 3 centre pass receives', 'Goal');
    await press('Add goal');
    expect(screen.getByText('Goals for this game have closed')).toBeTruthy();
  });

  it('lets the athlete change or remove their own goal, but not one a coach set', async () => {
    await openGame('athlete', { goals: [goal(), COACH_GOAL] });
    expect(screen.getByText('Goal 1 · set by Sample athlete')).toBeTruthy();
    expect(screen.getByText('Goal 2 · set by Coach Sample coach')).toBeTruthy();
    expect(screen.getAllByText('Edit')).toHaveLength(1);
    await press('Edit');
    await fireEvent.changeText(screen.getByDisplayValue('Win 3 centre pass receives'), 'Win 4 receives');
    await press('Save');
    expect(onlyRpcCall('save_game_goal')).toEqual({
      p_goal_id: 'g1',
      p_athlete_id: 'athlete',
      p_fixture_id: 'fx1',
      p_body: 'Win 4 receives',
    });
  });

  it('removes a goal only after asking once more', async () => {
    await openGame('athlete', { goals: [goal()] });
    await press('Edit');
    await press('Remove goal');
    expect(screen.getByText('Remove this goal from the game?')).toBeTruthy();
    expect(rpcCalls('delete_game_goal')).toEqual([]);
    await press('Remove goal');
    expect(onlyRpcCall('delete_game_goal')).toEqual({ p_goal_id: 'g1' });
  });

  it('puts a goal back as it was on Cancel', async () => {
    await openGame('athlete', { goals: [goal()] });
    await press('Edit');
    await fireEvent.changeText(screen.getByDisplayValue('Win 3 centre pass receives'), 'Changed');
    await press('Cancel');
    expect(screen.getByText('Win 3 centre pass receives')).toBeTruthy();
    expect(rpcCalls('save_game_goal')).toEqual([]);
  });

  it('stops adding at 5 goals', async () => {
    const five = [1, 2, 3, 4, 5].map((n) => goal({ id: `g${n}`, body: `Goal ${n}` }));
    await openGame('athlete', { goals: five });
    expect(screen.queryByText('Add goal')).toBeNull();
  });

  it.each<[string, Who]>([
    ['head coach', 'coach'],
    ['assistant coach', morePersonas.assistantCoach],
  ])('lets a %s add goals for the athlete and change only coaches’ goals', async (_l, who) => {
    await openGame(who, { goals: [goal(), COACH_GOAL] }, asCoach);
    expect(screen.getByText('Add a goal for the athlete')).toBeTruthy();
    expect(screen.getAllByText('Edit')).toHaveLength(1);
    await press('Edit');
    expect(screen.getByDisplayValue('Talk on defence')).toBeTruthy();
    // Only the athlete gets the note on who sees their goals.
    expect(screen.queryByText(/^Your coaches see your goals/)).toBeNull();
  });

  it.each<[string, Who, string]>([
    ['guardian', 'guardian', asCoach],
    ['coach opening it as a guardian', morePersonas.coachGuardian, asGuardian],
    ['coach whose check lapsed', 'coachExpiredCheck', asCoach],
    ['coach of a squad whose squad phase is done', 'doneSquadCoach', asCoach],
    ['physio', 'physio', asCoach],
  ])('lets a %s only read the goals', async (_l, who, query) => {
    await openGame(who, { goals: [goal(), COACH_GOAL] }, query);
    expect(screen.getByText('Your athlete and their coaches can add goals until the game starts.')).toBeTruthy();
    expect(screen.getByText('Win 3 centre pass receives')).toBeTruthy();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByText('Add goal')).toBeNull();
    expect(screen.container.queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
  });

  it('says a game being played is closed, with no way to change anything', async () => {
    await openGame('athlete', { shown: game(PLAYING), goals: [goal()] });
    expect(screen.getByText('Game on. Reflections open after the game.')).toBeTruthy();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByText('Add goal')).toBeNull();
    expect(screen.queryByText('How did it go?')).toBeNull();
  });

  it('says when the game isn’t available any more', async () => {
    await openGame('athlete', { shown: null });
    expect(screen.getByText('This game isn’t available any more.')).toBeTruthy();
  });

  it('tells the athlete who sees their goals', async () => {
    await openGame('athlete');
    expect(
      screen.getByText(
        'Your coaches see your goals and reflections. If you’re under 18, your parents or guardians do too.',
      ),
    ).toBeTruthy();
  });
});

describe('one game’s goals after the game', () => {
  const reflected = goal({ outcome: 'partly', reflection: 'Got two of them' });

  it('lets the athlete say how each goal went', async () => {
    await openGame('athlete', { shown: game(PLAYED), goals: [goal()] });
    expect(screen.getByText('How did it go? Pick how each goal went and add a few words.')).toBeTruthy();
    expect(screen.queryByText('Add goal')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
    // Nothing to save until something is picked or written.
    await press('Save reflection');
    expect(rpcCalls('reflect_on_game_goal')).toEqual([]);
    await press('Achieved');
    await type('What worked, and what will you try next time?', 'Strong leads');
    await press('Save reflection');
    expect(onlyRpcCall('reflect_on_game_goal')).toEqual({
      p_goal_id: 'g1',
      p_outcome: 'achieved',
      p_reflection: 'Strong leads',
    });
  });

  it('lets the athlete update a reflection, and take the outcome off', async () => {
    await openGame('athlete', { shown: game(PLAYED), goals: [reflected] });
    expect(screen.getByDisplayValue('Got two of them')).toBeTruthy();
    await press('Partly');
    await press('Update reflection');
    expect(onlyRpcCall('reflect_on_game_goal')).toEqual({
      p_goal_id: 'g1',
      p_outcome: null,
      p_reflection: 'Got two of them',
    });
  });

  it('shows why a reflection wasn’t saved', async () => {
    await openGame('athlete', { shown: game(PLAYED), goals: [goal()], errors: { reflect_on_game_goal: 'Too late' } });
    await press('Not yet');
    await press('Save reflection');
    expect(screen.getByText('Too late')).toBeTruthy();
  });

  it('lets a coach read the reflection and comment on each goal', async () => {
    await openGame('coach', { shown: game(PLAYED), goals: [reflected], comments: [{ id: 'c1', goal_id: 'g1', author_id: 'coach-2', author_name: 'Other Coach', body: 'Great work', created_at: '2026-10-12T00:00:00Z' }] }, asCoach);
    expect(screen.getByText('Read how the athlete thinks it went and add your comments.')).toBeTruthy();
    expect(screen.getByText('Partly')).toBeTruthy();
    expect(screen.getByText('Got two of them')).toBeTruthy();
    expect(screen.getByText('Coach Other Coach')).toBeTruthy();
    expect(screen.getByText('Great work')).toBeTruthy();
    // A coach can't reflect for the athlete.
    expect(screen.queryByText('Save reflection')).toBeNull();
    await press('Comment on this goal');
    await type('Feedback for the athlete', 'Keep leading early');
    await press('Add comment');
    expect(onlyRpcCall('add_game_goal_comment')).toEqual({ p_goal_id: 'g1', p_body: 'Keep leading early' });
    expect(screen.queryByPlaceholderText('Feedback for the athlete')).toBeNull();
  });

  it('shows why a comment wasn’t added and keeps it', async () => {
    await openGame('coach', { shown: game(PLAYED), goals: [reflected], errors: { add_game_goal_comment: 'Not your athlete' } }, asCoach);
    await press('Comment on this goal');
    await type('Feedback for the athlete', 'Nice');
    await press('Add comment');
    expect(screen.getByText('Not your athlete')).toBeTruthy();
    expect(screen.getByDisplayValue('Nice')).toBeTruthy();
  });

  it('lets a parent read how it went and what the coaches said, and nothing more', async () => {
    await openGame('guardian', { shown: game(PLAYED), goals: [reflected], comments: [{ id: 'c1', goal_id: 'g1', author_id: 'coach', author_name: 'Sample coach', body: 'Great work', created_at: '2026-10-12T00:00:00Z' }] });
    expect(screen.getByText('How the athlete thinks it went, and what their coaches said.')).toBeTruthy();
    expect(screen.getByText('Got two of them')).toBeTruthy();
    expect(screen.getByText('Great work')).toBeTruthy();
    expect(screen.queryByText('Comment on this goal')).toBeNull();
    expect(screen.queryByText('Save reflection')).toBeNull();
    expect(screen.container.queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
  });

  it('says when no goals were set', async () => {
    await openGame('athlete', { shown: game(PLAYED) });
    expect(screen.getByText('No goals were set for this game.')).toBeTruthy();
  });
});

describe('the athlete’s own stats from the recorded game, for their coaches', () => {
  it('asks for nothing before the game or while it is on', async () => {
    await openGame('coach', { stats: STATS }, asCoach);
    expect(invoke()).not.toHaveBeenCalled();
    expect(screen.queryByText('Game stats')).toBeNull();
    await openGame('coach', { shown: game(PLAYING), stats: STATS }, asCoach);
    expect(invoke()).not.toHaveBeenCalled();
    expect(screen.queryByText('Game stats')).toBeNull();
  });

  it('shows a coach the athlete’s figures after the game, with Net Points, and says only coaches see them', async () => {
    await openGame('coach', { shown: game(PLAYED), stats: { ...STATS, netPoints: 12.5 } }, asCoach);
    expect(invoke()).toHaveBeenCalledWith('game-stats', { body: { athleteId: 'athlete', fixtureId: 'fx1' } });
    expect(screen.getByText('Game stats')).toBeTruthy();
    expect(screen.getByText('37.5 min · GS, GA')).toBeTruthy();
    expect(screen.getByText('18 from 24 (75%)')).toBeTruthy();
    expect(screen.getByText('2 (2 attacking, 0 defending)')).toBeTruthy();
    expect(screen.getByText('Net Points')).toBeTruthy();
    expect(screen.getByText('+12.5')).toBeTruthy();
    expect(screen.getByText('From the game recorded in FirstPass Vantage. Only the athlete’s coaches see these, and their selectors during a selection round.')).toBeTruthy();
  });

  // Coaches only (Matt, 22 November 2026): the app doesn't ask for the athlete or a parent, and
  // shows nothing even if figures came back. The database refuses them too (game-stats-in-goals.sql).
  it('never asks for or shows them to the athlete', async () => {
    await openGame('athlete', { shown: game(PLAYED), goals: [goal()], stats: { ...STATS, netPoints: 12.5 } });
    expect(invoke()).not.toHaveBeenCalled();
    expect(screen.queryByText('Game stats')).toBeNull();
    expect(screen.queryByText('Your game stats')).toBeNull();
    expect(screen.queryByText('Net Points')).toBeNull();
    expect(screen.getByText('Win 3 centre pass receives')).toBeTruthy();
  });

  it('never asks for or shows them to a parent, even one who also coaches', async () => {
    await openGame('guardian', { shown: game(PLAYED), stats: { ...STATS, netPoints: 12.5 } }, asCoach);
    expect(invoke()).not.toHaveBeenCalled();
    expect(screen.queryByText('Game stats')).toBeNull();
    expect(screen.queryByText('Turnovers')).toBeNull();
    await openGame('guardian', { shown: game(PLAYED), stats: STATS });
    expect(invoke()).not.toHaveBeenCalled();
    expect(screen.queryByText('Game stats')).toBeNull();
  });

  it.each<[string, GameStats | null | 'fails']>([
    ['the game wasn’t recorded or the athlete didn’t play', null],
    ['the stats can’t be reached', 'fails'],
  ])('shows a coach the goals as before when %s', async (_l, stats) => {
    await openGame('coach', { shown: game(PLAYED), goals: [goal()], stats }, asCoach);
    expect(screen.queryByText('Game stats')).toBeNull();
    expect(screen.getByText('Win 3 centre pass receives')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// An athlete's games (goals/athlete/[id]): the athlete's own Played games from
// their Team tab, their coach from the team's people, and a parent.

async function openGames(who: Who, query = `name=Sample%20athlete&team=${TEAM.id}`) {
  await openScreen(who, { 'goals/athlete/[id]': AthleteGoalsScreen }, `/goals/athlete/athlete?${query}`, {}, {
    rpcs: {
      goal_next_game: [game({ goal_count: 0 })],
      goal_past_games: [game({ fixture_id: 'fx0', opponent: 'Sample Comets', goals_close_at: '2026-10-10T02:00:00Z', played_at: '2026-10-10T03:00:00Z', goal_count: 2, reflected_count: 1 })],
    },
  });
}

describe('an athlete’s games', () => {
  it('the athlete sees their own: asked to set goals, told who sees them, and no look is logged', async () => {
    await openGames('athlete', `team=${TEAM.id}`);
    expect(screen.getByText('Set your goals for this game')).toBeTruthy();
    expect(screen.getByText(/Your coaches can see your goals\.$/)).toBeTruthy();
    expect(screen.getByText(/Sample Comets/)).toBeTruthy();
    expect(rpcNames()).not.toContain('log_record_view');
    // Only this team's played games are asked for.
    expect(rpcCalls('goal_past_games')[0]).toMatchObject({ p_athlete_id: 'athlete', p_team_id: TEAM.id });
  });

  it('an athlete under 18 is told their parents or guardians see them too', async () => {
    await openScreen('minorAthlete', { 'goals/athlete/[id]': AthleteGoalsScreen }, '/goals/athlete/minor-athlete', {}, {
      rpcs: { goal_next_game: [], goal_past_games: [] },
    });
    expect(screen.getByText(/Your coaches and your parents or guardians can see your goals\.$/)).toBeTruthy();
  });

  it('their coach is told to add goals and comment, and the look is logged', async () => {
    await openGames('coach');
    expect(screen.getByText(/^Add goals for the next game\./)).toBeTruthy();
    expect(screen.getByText('No goals set yet')).toBeTruthy();
    expect(rpcCalls('log_record_view')[0]).toMatchObject({ p_subject_id: 'athlete', p_kind: 'goals' });
  });

  it('a parent only reads, and the look is logged', async () => {
    await openGames('guardian', 'name=Sample%20athlete&view=guardian');
    expect(screen.getByText(/^See the goals your athlete and their coaches set/)).toBeTruthy();
    expect(rpcCalls('log_record_view')[0]).toMatchObject({ p_subject_id: 'athlete', p_kind: 'goals' });
  });
});

// ---------------------------------------------------------------------------
// A team's goals for one game (goals/team). They stay with the team: only its
// coaches open them, and an admin no longer reads them (Matt, 27 November 2026).

function coachGame(extra: Partial<CoachTeamGame> = {}): CoachTeamGame {
  return {
    team_id: TEAM.id,
    team_name: TEAM.name,
    team_kind: 'team',
    fixture_id: 'fx1',
    is_next: true,
    round_name: 'Round 3',
    opponent: 'Sample Storm',
    starts_at: '2099-10-24T02:00:00Z',
    time_tbc: false,
    goals_close_at: '2099-10-24T02:00:00Z',
    played_at: '2099-10-24T03:00:00Z',
    goal_count: 1,
    reviewed_count: 0,
    ...extra,
  };
}

async function openTeamGoals(who: Who, rpcs: Record<string, unknown> = {}) {
  await openScreen(who, { 'goals/team': TeamGoalsScreen }, '/goals/team?fixture=fx1', {
    team_game_goals: [teamGoal()],
    team_game_goal_comments: [teamComment()],
  }, { rpcs: { coach_team_games: [coachGame()], ...rpcs } });
}

describe('a team’s goals for one game', () => {
  it('the team’s coach sets and changes them before the game, and reads the team’s comments', async () => {
    await openTeamGoals('coach');
    expect(screen.getByText('Round 3 v Sample Storm')).toBeTruthy();
    expect(screen.getByText('Win the third quarter')).toBeTruthy();
    expect(screen.getByText('I’ll push hard in the third')).toBeTruthy();
    expect(screen.getByText('Add team goal')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('a coach of another team is told the game isn’t available', async () => {
    await openTeamGoals('coach', { coach_team_games: [coachGame({ fixture_id: 'fx9' })] });
    expect(screen.getByText('This game isn’t available any more.')).toBeTruthy();
    expect(screen.queryByText('Add team goal')).toBeNull();
  });

  it('the admin list is never asked for, whoever opens the page', async () => {
    for (const who of ['coach', morePersonas.assistantCoach] as Who[]) {
      clearCalls();
      // Even if an older database still answered the admin list, the app doesn't ask.
      await openTeamGoals(who, { coach_team_games: [], admin_team_games: [coachGame()] });
      expect(screen.getByText('This game isn’t available any more.')).toBeTruthy();
      expect(rpcNames()).not.toContain('admin_team_games');
    }
  });
});
