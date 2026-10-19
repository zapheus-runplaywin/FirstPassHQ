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
import { Text, TextInput } from 'react-native';

import AthleteGoalsScreen from '@/app/goals/athlete/[id]';
import GameGoalsScreen from '@/app/goals/game';
import TeamGoalsScreen from '@/app/goals/team';
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
  useAdminPushNotifications: jest.fn(),
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
  fireEvent.press(screen.getAllByText(text)[index]);
  await settle(6);
};

const type = async (placeholder: string, value: string, index = 0) => {
  fireEvent.changeText(screen.getAllByPlaceholderText(placeholder)[index], value);
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
};

async function openGame(
  who: Who,
  { shown = game(), goals = [], comments = [], teamGoals = [], teamComments = [], errors = {} }: GameSetup = {},
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
    { rpcs: { goal_game: shown ? [shown] : [] }, rpcErrors: errors },
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
    fireEvent.changeText(screen.getByDisplayValue('Win 3 centre pass receives'), 'Win 4 receives');
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
    fireEvent.changeText(screen.getByDisplayValue('Win 3 centre pass receives'), 'Changed');
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
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
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
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  });

  it('says when no goals were set', async () => {
    await openGame('athlete', { shown: game(PLAYED) });
    expect(screen.getByText('No goals were set for this game.')).toBeTruthy();
  });
});

describe('team goals on a game', () => {
  const comments = [
    teamComment(),
    teamComment({ id: 'tc2', author_id: 'other-athlete', author_name: 'Other Athlete', body: 'Me too' }),
    teamComment({ id: 'tc3', author_id: 'coach', author_name: 'Sample coach', author_role: 'coach', body: 'Love it' }),
  ];

  it('shows the team’s goals above the athlete’s own, with who set them', async () => {
    await openGame('athlete', { teamGoals: [teamGoal()], goals: [goal()] });
    expect(screen.getByText('Team goals')).toBeTruthy();
    expect(screen.getByText('Set by Coach Sample coach')).toBeTruthy();
    expect(screen.getByText('Win the third quarter')).toBeTruthy();
    expect(screen.getByText('Personal goals')).toBeTruthy();
  });

  it('lets an athlete in the team comment, and remove only their own comment', async () => {
    await openGame('athlete', { teamGoals: [teamGoal()], teamComments: comments });
    expect(screen.getByText('Sample athlete')).toBeTruthy();
    expect(screen.getByText('Other Athlete')).toBeTruthy();
    expect(screen.getByText('Coach Sample coach')).toBeTruthy();
    expect(screen.getAllByText('Remove')).toHaveLength(1);
    await press('Remove');
    expect(screen.getByText('Remove this comment?')).toBeTruthy();
    await press('Remove comment');
    expect(onlyRpcCall('delete_team_game_goal_comment')).toEqual({ p_comment_id: 'tc1' });
  });

  it('sends an athlete’s comment on a team goal', async () => {
    await openGame('athlete', { teamGoals: [teamGoal()] });
    await press('Comment');
    await type('What you think, and what you’ll do to help', 'I’ll talk more');
    await press('Add comment');
    expect(onlyRpcCall('add_team_game_goal_comment')).toEqual({ p_goal_id: 'tg1', p_body: 'I’ll talk more' });
  });

  it('drops an unsent comment on Cancel', async () => {
    await openGame('athlete', { teamGoals: [teamGoal()] });
    await press('Comment');
    await type('What you think, and what you’ll do to help', 'Draft');
    await press('Cancel');
    expect(screen.queryByPlaceholderText('What you think, and what you’ll do to help')).toBeNull();
    expect(rpcCalls('add_team_game_goal_comment')).toEqual([]);
  });

  it.each<[string, Who]>([
    ['guardian', 'guardian'],
    ['physio of the team', 'physio'],
    ['manager of the team', 'manager'],
  ])('lets a %s read the team’s comments with no way to add or remove one', async (_l, who) => {
    await openGame(who, { teamGoals: [teamGoal()], teamComments: comments });
    expect(screen.getByText('I’ll push hard in the third')).toBeTruthy();
    expect(screen.queryByText('Comment')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('doesn’t let an athlete of another team comment', async () => {
    await openGame('athlete', { shown: game({ team_id: TEAM_B.id }), teamGoals: [teamGoal()] });
    expect(screen.queryByText('Comment')).toBeNull();
  });

  it('shows how the coaches think the team went after the game', async () => {
    await openGame('athlete', {
      shown: game(PLAYED),
      teamGoals: [teamGoal({ outcome: 'achieved', review: 'Best quarter all year', reviewed_by_name: 'Sample coach' })],
    });
    expect(screen.getByText('Achieved')).toBeTruthy();
    expect(screen.getByText('Best quarter all year')).toBeTruthy();
    expect(screen.getByText('Coach Sample coach')).toBeTruthy();
  });

  it('asks for the comments of this game’s team goals only', async () => {
    await openGame('athlete', { teamGoals: [teamGoal()] });
    const tables = (jest.requireMock('@/lib/supabase').supabase.from as jest.Mock).mock.calls.map(([t]: [string]) => t);
    expect(tables).toEqual(expect.arrayContaining(['team_game_goals', 'team_game_goal_comments', 'game_goals']));
  });

  it('doesn’t ask for team goal comments when the game has no team goals', async () => {
    await openGame('athlete', {});
    const tables = (jest.requireMock('@/lib/supabase').supabase.from as jest.Mock).mock.calls.map(([t]: [string]) => t);
    expect(tables).not.toContain('team_game_goal_comments');
    expect(tables).not.toContain('game_goal_comments');
  });
});

// ---------------------------------------------------------------------------
// An athlete's games

function GamePlaceholder() {
  return <Text>screen:goals/game</Text>;
}

async function openAthlete(
  who: Who,
  { next = game() as GoalGame | null, past = [] as GoalGame[], query = '', pastError }: { next?: GoalGame | null; past?: GoalGame[]; query?: string; pastError?: string } = {},
) {
  await openScreen(
    who,
    { 'goals/athlete/[id]': AthleteGoalsScreen, 'goals/game': GamePlaceholder },
    `/goals/athlete/athlete?name=Sample%20athlete${query}`,
    {},
    {
      rpcs: { goal_next_game: next ? [next] : [] },
      rpcHandlers: {
        goal_past_games: (args) => past.slice(args.p_offset as number, (args.p_offset as number) + (args.p_limit as number)),
      },
      rpcErrors: pastError ? { goal_past_games: pastError } : {},
    },
  );
}

function played(n: number): GoalGame {
  return game({ ...PLAYED, fixture_id: `p${n}`, round_name: `Round ${n}`, goal_count: 2, reflected_count: 1, comment_count: 1 });
}

describe('an athlete’s games', () => {
  it('shows a coach the next game and asks for played games 10 at a time', async () => {
    await openAthlete('coach', { next: game({ goal_count: 2 }) });
    expect(screen.getByText('Add goals for the next game. Once it’s played, read the athlete’s reflections and comment on each goal.')).toBeTruthy();
    expect(screen.getByText('2 of up to 5 goals set · they close when the game starts')).toBeTruthy();
    expect(rpcCalls('goal_next_game')).toEqual([{ p_athlete_id: 'athlete' }]);
    expect(rpcCalls('goal_past_games')).toEqual([
      { p_athlete_id: 'athlete', p_limit: 11, p_offset: 0, p_team_id: null },
    ]);
    expect(rpcCalls('log_record_view')).toEqual([{ p_subject_id: 'athlete', p_kind: 'goals', p_record_id: null }]);
  });

  it('opens the next game for a coach to add goals', async () => {
    await openAthlete('coach');
    await press('Round 3 v Swans');
    expect(screen.getByText('screen:goals/game')).toBeTruthy();
    expect(screen).toHaveSearchParams({ athlete: 'athlete', fixture: 'fx1', name: 'Sample athlete' });
  });

  it.each<[string, Who, string]>([
    ['guardian', 'guardian', ''],
    ['coach who opened it as a guardian', morePersonas.coachGuardian, '&view=guardian'],
  ])('opens games read-only for a %s', async (_l, who, query) => {
    await openAthlete(who, { query });
    expect(screen.getByText(/^See the goals your athlete and their coaches set for each game/)).toBeTruthy();
    expect(screen.getByText('No goals set yet')).toBeTruthy();
    await press('Round 3 v Swans');
    expect(screen).toHaveSearchParams({ athlete: 'athlete', fixture: 'fx1', name: 'Sample athlete', view: 'guardian' });
  });

  it('says when there’s no game in the next week', async () => {
    await openAthlete('coach', { next: null });
    expect(screen.getByText('No game in the next 7 days. Goals open a week before each game.')).toBeTruthy();
    expect(screen.getByText('No games played yet.')).toBeTruthy();
  });

  it('says a game being played is closed', async () => {
    await openAthlete('coach', { next: game(PLAYING) });
    expect(screen.getByText('Game on. Reflections open after the game.')).toBeTruthy();
  });

  it('shows each played game’s goals, reflections and coach comments', async () => {
    await openAthlete('coach', {
      past: [
        played(1),
        game({ ...PLAYED, fixture_id: 'p2', round_name: 'Round 2', goal_count: 1, reflected_count: 1, comment_count: 0 }),
        game({ ...PLAYED, fixture_id: 'p3', round_name: 'Round 1', goal_count: 0 }),
      ],
    });
    expect(screen.getByText('2 goals · 1 of 2 reflected · 1 coach comment')).toBeTruthy();
    expect(screen.getByText('1 goal · ✓ Reflected')).toBeTruthy();
    expect(screen.getByText('No goals set')).toBeTruthy();
  });

  it('loads older games with Load more', async () => {
    const past = Array.from({ length: 12 }, (_, i) => played(i + 1));
    await openAthlete('coach', { past });
    expect(screen.getAllByText(/^Round \d+ v Swans$/)).toHaveLength(11);
    await press('Load more');
    expect(rpcCalls('goal_past_games')[1]).toEqual({ p_athlete_id: 'athlete', p_limit: 11, p_offset: 10, p_team_id: null });
    expect(screen.getAllByText(/^Round \d+ v Swans$/)).toHaveLength(13);
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('opened from a team’s page, shows only that team’s games', async () => {
    await openAthlete('coach', { next: game({ team_id: TEAM_B.id }), query: `&team=${TEAM.id}` });
    expect(rpcCalls('goal_past_games')[0]).toMatchObject({ p_team_id: TEAM.id });
    // The athlete's next game is another team's, so it isn't shown here.
    expect(screen.getByText('No game in the next 7 days. Goals open a week before each game.')).toBeTruthy();
  });

  it('shows why the games didn’t load', async () => {
    await openAthlete('coach', { pastError: 'Not your athlete' });
    // The fake backend's errors are plain objects, so the screen's own words show.
    expect(screen.getByText('Couldn’t load games')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A coach's team goals

function teamGame(extra: Partial<CoachTeamGame> = {}): CoachTeamGame {
  return {
    team_id: TEAM.id,
    team_name: TEAM.name,
    team_kind: 'team',
    fixture_id: 'fx1',
    is_next: true,
    round_name: 'Round 3',
    opponent: 'Swans',
    starts_at: OPEN.starts_at,
    time_tbc: false,
    goals_close_at: OPEN.goals_close_at,
    played_at: OPEN.played_at,
    goal_count: 0,
    reviewed_count: 0,
    ...extra,
  };
}

async function openTeam(
  who: Who,
  { games = [teamGame()], goals = [] as TeamGameGoal[], comments = [] as TeamGameGoalComment[], errors = {} as Record<string, string> } = {},
) {
  await openScreen(
    who,
    { 'goals/team': TeamGoalsScreen },
    '/goals/team?fixture=fx1',
    { team_game_goals: goals, team_game_goal_comments: comments },
    { rpcs: { coach_team_games: games }, rpcErrors: errors },
  );
}

describe('a coach’s team goals', () => {
  it('adds a goal for the whole team before the game', async () => {
    await openTeam('coach');
    expect(screen.getByText(/^Goals for the whole team\. Everyone in it, and their parents or guardians, can see them/)).toBeTruthy();
    expect(screen.getByText('No team goals yet.')).toBeTruthy();
    await type('For example, win the third quarter', 'Win the third quarter');
    await press('Add team goal');
    expect(onlyRpcCall('save_team_game_goal')).toEqual({ p_goal_id: null, p_fixture_id: 'fx1', p_body: 'Win the third quarter' });
    expect(rpcCalls('coach_team_games')).toHaveLength(2);
  });

  it('changes and removes a team goal before the game', async () => {
    await openTeam('coach', { goals: [teamGoal()] });
    expect(screen.getByText('Team goal 1 · set by Coach Sample coach')).toBeTruthy();
    await press('Edit');
    fireEvent.changeText(screen.getByDisplayValue('Win the third quarter'), 'Win the last quarter');
    await press('Save');
    expect(onlyRpcCall('save_team_game_goal')).toEqual({ p_goal_id: 'tg1', p_fixture_id: 'fx1', p_body: 'Win the last quarter' });
  });

  it('removes a team goal only after asking once more', async () => {
    await openTeam('coach', { goals: [teamGoal()] });
    await press('Edit');
    await press('Remove goal');
    expect(screen.getByText('Remove this team goal from the game?')).toBeTruthy();
    await press('Remove goal');
    expect(onlyRpcCall('delete_team_game_goal')).toEqual({ p_goal_id: 'tg1' });
  });

  it('lets a coach remove anyone’s comment on the team’s goals', async () => {
    await openTeam('coach', {
      goals: [teamGoal()],
      comments: [teamComment(), teamComment({ id: 'tc2', author_id: 'other', author_name: 'Other Athlete', body: 'Me too' })],
    });
    expect(screen.getAllByText('Remove')).toHaveLength(2);
    await press('Remove', 1);
    await press('Remove comment');
    expect(onlyRpcCall('delete_team_game_goal_comment')).toEqual({ p_comment_id: 'tc2' });
  });

  it('shows why a comment couldn’t be removed', async () => {
    await openTeam('coach', { goals: [teamGoal()], comments: [teamComment()], errors: { delete_team_game_goal_comment: 'Already removed' } });
    await press('Remove');
    await press('Remove comment');
    expect(screen.getByText('Already removed')).toBeTruthy();
  });

  it('stops adding at 5 team goals', async () => {
    await openTeam('coach', { goals: [1, 2, 3, 4, 5].map((n) => teamGoal({ id: `tg${n}`, body: `Goal ${n}` })) });
    expect(screen.queryByText('Add team goal')).toBeNull();
  });

  it('closes team goals while the game is on', async () => {
    await openTeam('coach', { games: [teamGame(PLAYING)], goals: [teamGoal()] });
    expect(screen.getByText('Game on. You can say how each goal went after the game.')).toBeTruthy();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByText('Add team goal')).toBeNull();
    expect(screen.queryByText('Save review')).toBeNull();
  });

  it('reviews how the team went after the game', async () => {
    await openTeam('coach', { games: [teamGame({ ...PLAYED, is_next: false })], goals: [teamGoal()] });
    expect(screen.getByText('How did the team go? Pick how each goal went and add a few words for the team.')).toBeTruthy();
    expect(screen.queryByText('Edit')).toBeNull();
    await press('Save review');
    expect(rpcCalls('review_team_game_goal')).toEqual([]);
    await press('Partly');
    await type('What worked, and what to work on at training', 'Close, keep at it');
    await press('Save review');
    expect(onlyRpcCall('review_team_game_goal')).toEqual({ p_goal_id: 'tg1', p_outcome: 'partly', p_review: 'Close, keep at it' });
  });

  it('updates a review already saved', async () => {
    await openTeam('coach', { games: [teamGame(PLAYED)], goals: [teamGoal({ outcome: 'achieved', review: 'Great' })] });
    await type('What worked, and what to work on at training', 'Great, again');
    await press('Update review');
    expect(onlyRpcCall('review_team_game_goal')).toEqual({ p_goal_id: 'tg1', p_outcome: 'achieved', p_review: 'Great, again' });
  });

  it('says the game isn’t available when it isn’t one of the coach’s', async () => {
    await openTeam('coach', { games: [teamGame({ fixture_id: 'other' })] });
    expect(screen.getByText('This game isn’t available any more.')).toBeTruthy();
    expect(rpcNames()).not.toContain('save_team_game_goal');
    expect(screen.queryByText('Add team goal')).toBeNull();
  });
});
