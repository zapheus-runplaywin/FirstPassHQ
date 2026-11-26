/**
 * A squad or team's page (src/app/team/[id].tsx) and choosing its captains
 * (team/captains/[id].tsx). From "Squads and teams" in section 3, "Game
 * goals" in sections 4 and 6, "Captains" in section 4 and "Choosing captains"
 * in section 6 of docs/user-guide.md.
 *
 * The database decides who is on the roster a member gets (`team_roster`).
 * Only the group's coaches and admins choose captains; game goals show on a
 * team's page (not a squad's) for its athletes and its coaches while the
 * squad phase is open. Team goals stay with the team: an admin who isn't its
 * coach has none (Matt, 27 November 2026). The same rows and people are the
 * member's Team tab (team-hub.test.tsx).
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import ChooseCaptainsScreen from '@/app/team/captains/[id]';
import TeamScreen from '@/app/team/[id]';
import type { CoachTeamGame, GoalBoardRow, GoalGame, RosterEntry } from '@/lib/types';

import { argsOf, clearCalls, rpcNames } from './helpers/forms';
import {
  DONE_SQUAD,
  morePersonas,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  TEAM_B,
  type BackendOptions,
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

let push: jest.SpyInstance;
let back: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
});
afterEach(() => {
  push.mockRestore();
  back.mockRestore();
});

const ROSTER: RosterEntry[] = [
  { profile_id: 'coach', full_name: 'Sample coach', team_role: 'coach', coach_title: 'head_coach', selection: null },
  { profile_id: 'a1', full_name: 'Alice Athlete', team_role: 'athlete', coach_title: null, selection: 'touring' },
  { profile_id: 'a2', full_name: 'Bea Athlete', team_role: 'athlete', coach_title: null, selection: 'training_partner' },
  { profile_id: 'a3', full_name: null, team_role: 'athlete', coach_title: null, selection: null },
  { profile_id: 'm1', full_name: 'Sample manager', team_role: 'manager', coach_title: null, selection: null },
];

const TEAMS = [TEAM, TEAM_B, DONE_SQUAD];

async function openTeam(
  who: Who,
  id = TEAM.id,
  extra: { roster?: RosterEntry[]; captains?: unknown[]; clubCaptains?: unknown[] } = {},
  options: BackendOptions = {},
) {
  await openScreen(who, { 'team/[id]': TeamScreen }, `/team/${id}`, {
    teams: TEAMS,
    club_captains: extra.clubCaptains ?? [],
  }, {
    ...options,
    tableHandlers: {
      // The member's own captaincies load through the same table, by profile.
      team_captains: (q) => (q.eq('team_id') ? (extra.captains ?? []) : undefined),
      ...options.tableHandlers,
    },
    rpcs: { team_roster: extra.roster ?? ROSTER, goal_board: [], coach_team_games: [], goal_next_game: [], goal_past_games: [], ...options.rpcs },
  });
}

describe('a squad or team’s people', () => {
  it('lists everyone the database returns, with their position', async () => {
    await openTeam('athlete');
    // Asked again once the group's season is known; always for this group only.
    expect(argsOf('team_roster').length).toBeGreaterThan(0);
    expect(new Set(argsOf('team_roster').map((a) => a?.p_team_id))).toEqual(new Set([TEAM.id]));
    expect(screen.getByText('Sample coach')).toBeTruthy();
    expect(screen.getByText('Head Coach')).toBeTruthy();
    expect(screen.getByText('Final team athlete')).toBeTruthy();
    expect(screen.getByText('Training partner')).toBeTruthy();
    expect(screen.getByText('Unnamed member')).toBeTruthy();
    expect(screen.getByText('Manager')).toBeTruthy();
  });

  it('marks captains, vice captains and club captains, athletes only', async () => {
    await openTeam('athlete', TEAM.id, {
      captains: [
        { team_id: TEAM.id, profile_id: 'a1', captain_role: 'captain' },
        { team_id: TEAM.id, profile_id: 'a2', captain_role: 'vice_captain' },
        // A captain row for a coach is never shown as one.
        { team_id: TEAM.id, profile_id: 'coach', captain_role: 'captain' },
      ],
      clubCaptains: [{ profile_id: 'a2' }],
    });
    expect(screen.getByText('Final team athlete · Captain')).toBeTruthy();
    expect(screen.getByText('Training partner · Vice captain · Club captain')).toBeTruthy();
    expect(screen.getByText('Head Coach')).toBeTruthy();
  });

  it('asks for this season’s club captains', async () => {
    const seen: unknown[][] = [];
    await openTeam('athlete', TEAM.id, {}, {
      tableHandlers: {
        club_captains: (q) => {
          seen.push(q.calls.map((c) => [c.method, ...c.args]));
          return [];
        },
      },
    });
    expect(seen[0]).toContainEqual(['eq', 'season', 2026]);
  });

  it('says when no one has been added', async () => {
    await openTeam('athlete', TEAM.id, { roster: [] });
    expect(screen.getByText('No one has been added yet.')).toBeTruthy();
    expect(screen.queryByText('Choose captains')).toBeNull();
  });
});

describe('choosing captains', () => {
  it.each<[string, Who]>([
    ['the group’s coach', 'coach'],
    ['an assistant coach of the group', morePersonas.assistantCoach],
    ['an admin', 'admin'],
  ])('%s can open Choose captains', async (_l, who) => {
    await openTeam(who);
    await fireEvent.press(screen.getByText('Choose captains'));
    expect(push).toHaveBeenCalledWith({ pathname: '/team/captains/[id]', params: { id: TEAM.id } });
  });

  it.each<[string, Who, string]>([
    ['an athlete', 'athlete', TEAM.id],
    ['a captain', 'captain', TEAM.id],
    ['a manager', 'manager', TEAM.id],
    ['a committee member', 'committee', TEAM.id],
    ['a coach of another group', morePersonas.athleteCoach, TEAM.id],
    ['a coach whose check has expired', 'coachExpiredCheck', TEAM.id],
    ['a stood-down coach', 'stoodDownCoach', TEAM.id],
  ])('%s can’t', async (_l, who, id) => {
    await openTeam(who, id);
    expect(screen.getByText('Alice Athlete')).toBeTruthy();
    expect(screen.queryByText('Choose captains')).toBeNull();
  });

  it('a squad has no captains: its coach and admins aren’t offered them (Matt, 20 November 2026)', async () => {
    for (const who of ['doneSquadCoach', 'admin'] as const) {
      await openTeam(who, DONE_SQUAD.id);
      expect(screen.getByText('Alice Athlete')).toBeTruthy();
      expect(screen.queryByText('Choose captains')).toBeNull();
    }
  });

  it('a squad captaincy chosen before then isn’t shown on the squad’s page', async () => {
    await openTeam('admin', DONE_SQUAD.id, {
      captains: [{ team_id: DONE_SQUAD.id, profile_id: 'a1', captain_role: 'captain' }],
    });
    expect(screen.getByText('Alice Athlete')).toBeTruthy();
    expect(screen.queryByText(/Captain/)).toBeNull();
  });

  it('a coach is offered it only once there are athletes', async () => {
    await openTeam('coach', TEAM.id, { roster: ROSTER.filter((m) => m.team_role !== 'athlete') });
    expect(screen.queryByText('Choose captains')).toBeNull();
  });
});

describe('game goals on a team’s page', () => {
  const BOARD: GoalBoardRow[] = [
    {
      team_id: TEAM.id,
      team_name: TEAM.name,
      team_kind: 'team',
      athlete_id: 'a1',
      athlete_name: 'Alice Athlete',
      next_fixture_id: 'fx1',
      next_label: 'Round 3 v Sample Storm',
      next_starts_at: '2026-10-24T02:00:00Z',
      next_goal_count: 2,
      reflections_to_answer: 1,
    },
    {
      ...{
        team_id: TEAM_B.id,
        team_name: TEAM_B.name,
        team_kind: 'team' as const,
        athlete_id: 'a2',
        athlete_name: 'Bea Athlete',
        next_fixture_id: null,
        next_label: null,
        next_starts_at: null,
        next_goal_count: 0,
        reflections_to_answer: 0,
      },
    },
  ];

  const GAME: CoachTeamGame = {
    team_id: TEAM.id,
    team_name: TEAM.name,
    team_kind: 'team',
    fixture_id: 'fx1',
    is_next: true,
    round_name: 'Round 3',
    opponent: 'Sample Storm',
    starts_at: '2026-10-24T02:00:00Z',
    time_tbc: false,
    goals_close_at: '2026-10-24T02:00:00Z',
    played_at: '2026-10-24T03:00:00Z',
    goal_count: 0,
    reviewed_count: 0,
  };

  const NEXT: GoalGame = {
    fixture_id: 'fx1',
    team_id: TEAM.id,
    team_name: TEAM.name,
    round_name: 'Round 3',
    opponent: 'Sample Storm',
    starts_at: '2099-10-24T02:00:00Z',
    time_tbc: false,
    venue: null,
    court: null,
    is_home: null,
    goals_close_at: '2099-10-24T02:00:00Z',
    played_at: '2099-10-24T03:00:00Z',
    goal_count: 2,
    reflected_count: 0,
    comment_count: 0,
  };
  const PLAYED: GoalGame = {
    ...NEXT,
    fixture_id: 'fx0',
    round_name: 'Round 2',
    opponent: 'Sample Comets',
    starts_at: '2026-10-10T02:00:00Z',
    goals_close_at: '2026-10-10T02:00:00Z',
    played_at: '2026-10-10T03:00:00Z',
    reflected_count: 1,
  };

  it('an athlete opens their next game’s goals in one tap, and their played games', async () => {
    await openTeam('athlete', TEAM.id, {}, { rpcs: { goal_next_game: [NEXT], goal_past_games: [PLAYED] } });
    expect(screen.getByText(/^Round 3 v Sample Storm · .* · 2 goals$/)).toBeTruthy();
    await fireEvent.press(screen.getByText('My game goals'));
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/goals/game',
      params: { athlete: 'athlete', fixture: 'fx1', name: '' },
    });
    expect(screen.getByText('Round 2 v Sample Comets · 2 goals · 1 of 2 reflected')).toBeTruthy();
    await fireEvent.press(screen.getByText('Played games'));
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/goals/athlete/[id]',
      params: { id: 'athlete', team: TEAM.id },
    });
    expect(screen.getByText('People')).toBeTruthy();
  });

  it('an athlete with no goals yet is asked to set them', async () => {
    await openTeam('athlete', TEAM.id, {}, { rpcs: { goal_next_game: [{ ...NEXT, goal_count: 0 }] } });
    expect(screen.getByText(/· set your goals$/)).toBeTruthy();
  });

  it('an athlete with no game this week is told so, and the row opens nothing', async () => {
    await openTeam('athlete');
    expect(screen.getByText('No game in the next 7 days')).toBeTruthy();
    expect(screen.getByText('No games played yet')).toBeTruthy();
    await fireEvent.press(screen.getByText('My game goals'));
    expect(push).not.toHaveBeenCalled();
  });

  it('an athlete’s next game for another team isn’t this team’s', async () => {
    await openTeam('athlete', TEAM.id, {}, { rpcs: { goal_next_game: [{ ...NEXT, team_id: TEAM_B.id }] } });
    expect(screen.getByText('No game in the next 7 days')).toBeTruthy();
  });

  it('an athlete’s team mates are names and positions: their rows open nothing', async () => {
    await openTeam('athlete', TEAM.id, {}, { rpcs: { goal_board: BOARD } });
    await fireEvent.press(screen.getByText('Alice Athlete'));
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText('1 reflection waiting for a comment')).toBeNull();
  });

  it('a coach sees team goals for this team’s games, and opens each athlete’s goals', async () => {
    await openTeam('coach', TEAM.id, {}, { rpcs: { goal_board: BOARD, coach_team_games: [GAME, { ...GAME, team_id: TEAM_B.id, fixture_id: 'fx9', opponent: 'Elsewhere' }] } });
    expect(screen.getByText(/^Round 3 v Sample Storm · .* · no team goals yet$/)).toBeTruthy();
    expect(screen.queryByText(/Elsewhere/)).toBeNull();
    expect(screen.getByText('1 reflection waiting for a comment')).toBeTruthy();
    expect(screen.getByText(/^Round 3 v Sample Storm · .* · 2 goals$/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Alice Athlete'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/goals/athlete/[id]',
      params: { id: 'a1', name: 'Alice Athlete', team: TEAM.id },
    });
    await fireEvent.press(screen.getByText('Team goals'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/goals/team', params: { fixture: 'fx1' } });
  });

  it('a coach’s last game has a row of its own', async () => {
    const LAST = { ...GAME, fixture_id: 'fx0', is_next: false, goals_close_at: '2026-10-10T00:00:00Z', played_at: '2026-10-10T01:00:00Z', goal_count: 1 };
    await openTeam('coach', TEAM.id, {}, { rpcs: { coach_team_games: [GAME, LAST] } });
    await fireEvent.press(screen.getByText('Team goals, last game'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/goals/team', params: { fixture: 'fx0' } });
  });

  it('a coach’s athlete with nothing waiting says so plainly, and one elsewhere isn’t a link', async () => {
    await openTeam('coach', TEAM.id, {}, { rpcs: { goal_board: [{ ...BOARD[0], reflections_to_answer: 3 }, BOARD[1]] } });
    expect(screen.getByText('3 reflections waiting for a comment')).toBeTruthy();
    // Bea's goals are in another team's board: here she is a name and a position.
    await fireEvent.press(screen.getByText('Bea Athlete'));
    expect(push).not.toHaveBeenCalled();
  });

  // Team goals stay with the team (Matt, 27 November 2026).
  it('an admin who isn’t in the team has no team goals, and the database isn’t asked for any', async () => {
    await openTeam('admin', TEAM.id, {}, {
      rpcs: { admin_team_games: [GAME], coach_team_games: [GAME], goal_board: BOARD },
    });
    expect(screen.getByText('Alice Athlete')).toBeTruthy();
    expect(screen.queryByText(/Team goals/)).toBeNull();
    expect(screen.queryByText(/Sample Storm/)).toBeNull();
    expect(screen.queryByText('My game goals')).toBeNull();
    expect(rpcNames()).not.toContain('admin_team_games');
    expect(rpcNames()).not.toContain('coach_team_games');
    expect(rpcNames()).not.toContain('goal_board');
    // The athletes are names and positions, not links to goals.
    await fireEvent.press(screen.getByText('Alice Athlete'));
    expect(push).not.toHaveBeenCalled();
  });

  it('a coach with no game this week is told when team goals open', async () => {
    await openTeam('coach');
    expect(screen.getByText('No game in the next 7 days. They open a week before each game.')).toBeTruthy();
  });

  it.each<[string, Partial<CoachTeamGame>, string]>([
    ['goals set', { goal_count: 2 }, '2 team goals set'],
    ['game on', { goals_close_at: '2026-10-17T00:00:00Z', played_at: '2099-10-19T00:00:00Z', goal_count: 1 }, '1 team goal · game on'],
    ['played, none set', { is_next: false, goals_close_at: '2026-10-10T00:00:00Z', played_at: '2026-10-10T01:00:00Z' }, 'no team goals were set'],
    ['played, part reviewed', { is_next: false, goals_close_at: '2026-10-10T00:00:00Z', played_at: '2026-10-10T01:00:00Z', goal_count: 3, reviewed_count: 1 }, '3 team goals · 1 of 3 reviewed'],
    ['played, all reviewed', { is_next: false, goals_close_at: '2026-10-10T00:00:00Z', played_at: '2026-10-10T01:00:00Z', goal_count: 2, reviewed_count: 2 }, '2 team goals · ✓ Reviewed'],
  ])('sums up team goals: %s', async (_l, extra, line) => {
    await openTeam('coach', TEAM.id, {}, { rpcs: { coach_team_games: [{ ...GAME, ...extra }] } });
    expect(screen.getByText(new RegExp(`· ${line.replace(/[·✓]/g, (c) => c)}$`))).toBeTruthy();
  });

  it.each<[string, Who, string]>([
    ['a squad’s page', { ...personas.athlete, memberships: [{ ...personas.athlete.memberships[0], team: { ...TEAM, kind: 'squad' as const } }] }, TEAM.id],
    ['a member not in the group', 'committee', TEAM.id],
    ['a manager', 'manager', TEAM.id],
    ['a physio', 'physio', TEAM.id],
  ])('there are no game goals on %s', async (_l, who, id) => {
    await openTeam(who, id, {}, { rpcs: { goal_board: BOARD, goal_next_game: [NEXT], coach_team_games: [GAME] } });
    expect(screen.getByText('Alice Athlete')).toBeTruthy();
    expect(screen.queryByText('My game goals')).toBeNull();
    expect(screen.queryByText('Played games')).toBeNull();
    expect(screen.queryByText(/Team goals/)).toBeNull();
  });

  it('a coach of a squad whose phase is complete gets no goals', async () => {
    await openTeam('doneSquadCoach', DONE_SQUAD.id);
    expect(screen.queryByText('Team goals')).toBeNull();
  });

  it('none when the club has game goals off', async () => {
    setClubFeatures({ goals: false });
    await openTeam('coach', TEAM.id, {}, { rpcs: { goal_board: BOARD } });
    expect(screen.queryByText('Team goals')).toBeNull();
    expect(rpcNames()).not.toContain('goal_board');
    // Athletes are names and positions, not links to goals.
    await fireEvent.press(screen.getByText('Alice Athlete'));
    expect(push).not.toHaveBeenCalled();
    setClubFeatures({ goals: false });
    await openTeam('athlete', TEAM.id, {}, { rpcs: { goal_next_game: [NEXT] } });
    expect(screen.queryByText('My game goals')).toBeNull();
  });
});

describe('medical and emergency details', () => {
  it.each<[string, Who]>([
    ['the group’s coach', 'coach'],
    ['its manager', 'manager'],
    ['its physio', 'physio'],
  ])('%s opens them from the team’s rows', async (_l, who) => {
    await openTeam(who);
    expect(screen.getByText('3 athletes')).toBeTruthy();
    await fireEvent.press(screen.getByText('Medical and emergency details'));
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/medical/team/[id]',
      params: { id: TEAM.id, name: TEAM.name },
    });
  });

  it.each<[string, Who]>([
    ['an athlete', 'athlete'],
    ['an athlete under 18', 'minorAthlete'],
    ['a captain', 'captain'],
    ['an admin who isn’t in it', 'admin'],
    ['a committee member', 'committee'],
    ['a coach of another group', morePersonas.athleteCoach],
  ])('%s has no such row', async (_l, who) => {
    await openTeam(who);
    expect(screen.getByText('Alice Athlete')).toBeTruthy();
    expect(screen.queryByText('Medical and emergency details')).toBeNull();
  });

  it('there is no row until the group has athletes', async () => {
    await openTeam('manager', TEAM.id, { roster: ROSTER.filter((m) => m.team_role !== 'athlete') });
    expect(screen.queryByText('Medical and emergency details')).toBeNull();
  });
});

describe('an admin’s page for a team, from Squads and teams', () => {
  it('leads with changing who is in it, then captains, and names who they are', async () => {
    await openTeam('admin', TEAM.id, {
      captains: [
        { team_id: TEAM.id, profile_id: 'a2', captain_role: 'vice_captain' },
        { team_id: TEAM.id, profile_id: 'a1', captain_role: 'captain' },
      ],
    });
    expect(screen.getByText('Alice Athlete · Bea Athlete')).toBeTruthy();
    await fireEvent.press(screen.getByText('Change who’s in it'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/admin/team/[id]', params: { id: TEAM.id } });
  });

  it('says when no captain is chosen yet', async () => {
    await openTeam('admin');
    expect(screen.getByText('None chosen yet')).toBeTruthy();
  });

  it('a squad’s page has no such row: its members are changed from Squads and teams', async () => {
    await openTeam('admin', DONE_SQUAD.id);
    expect(screen.getByText('Alice Athlete')).toBeTruthy();
    expect(screen.queryByText('Change who’s in it')).toBeNull();
  });

  it.each<[string, Who]>([
    ['the team’s coach', 'coach'],
    ['an athlete', 'athlete'],
    ['a manager', 'manager'],
    ['a committee member', 'committee'],
  ])('%s is never offered Change who’s in it', async (_l, who) => {
    await openTeam(who);
    expect(screen.getByText('Alice Athlete')).toBeTruthy();
    expect(screen.queryByText('Change who’s in it')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The captains screen

async function openCaptains(options: BackendOptions = {}, captains: unknown[] = []) {
  await openScreen('coach', { 'team/captains/[id]': ChooseCaptainsScreen }, `/team/captains/${TEAM.id}`, { teams: TEAMS }, {
    ...options,
    tableHandlers: { team_captains: (q) => (q.eq('team_id') ? captains : undefined) },
    rpcs: { team_roster: ROSTER, ...options.rpcs },
  });
}

describe('the captains screen', () => {
  it('for a squad, points to its teams instead and saves nothing', async () => {
    await openScreen('admin', { 'team/captains/[id]': ChooseCaptainsScreen }, `/team/captains/${DONE_SQUAD.id}`, { teams: TEAMS }, {
      tableHandlers: { team_captains: (q) => (q.eq('team_id') ? [] : undefined) },
      rpcs: { team_roster: ROSTER },
    });
    expect(
      screen.getByText(
        'Captains are chosen for each team, not for the squad. Open one of the squad’s teams to choose its captains.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Save captains')).toBeNull();
    expect(screen.queryByText('Alice Athlete')).toBeNull();
  });

  it('lists only the athletes, each with their current pick', async () => {
    await openCaptains({}, [{ team_id: TEAM.id, profile_id: 'a2', captain_role: 'vice_captain' }]);
    expect(screen.getByText('Alice Athlete')).toBeTruthy();
    expect(screen.queryByText('Sample coach')).toBeNull();
    expect(screen.queryByText('Sample manager')).toBeNull();
    expect(screen.getAllByText('Vice captain')).toHaveLength(3);
    expect(screen.getByText(/Messages from athletes under\s+18 are copied to their parents or guardians\./)).toBeTruthy();
  });

  it('saves any number of captains and vice captains', async () => {
    await openCaptains({}, [{ team_id: TEAM.id, profile_id: 'a2', captain_role: 'vice_captain' }]);
    const [alice, bea, unnamed] = [0, 1, 2];
    await fireEvent.press(screen.getAllByText('Captain')[alice]);
    await fireEvent.press(screen.getAllByText('Captain')[unnamed]);
    await fireEvent.press(screen.getAllByText('Neither')[bea]);
    await fireEvent.press(screen.getAllByText('Vice captain')[bea]);
    await fireEvent.press(screen.getByText('Save captains'));
    await settle();
    expect(argsOf('set_group_captains')).toEqual([
      { p_team_id: TEAM.id, p_captain_ids: ['a1', 'a3'], p_vice_captain_ids: ['a2'] },
    ]);
    expect(back).toHaveBeenCalled();
  });

  it('Neither removes a captain', async () => {
    await openCaptains({}, [{ team_id: TEAM.id, profile_id: 'a1', captain_role: 'captain' }]);
    await fireEvent.press(screen.getAllByText('Neither')[0]);
    await fireEvent.press(screen.getByText('Save captains'));
    await settle();
    expect(argsOf('set_group_captains')[0]).toMatchObject({ p_captain_ids: [], p_vice_captain_ids: [] });
  });

  it('shows the database’s refusal and stays', async () => {
    await openCaptains({ rpcErrors: { set_group_captains: 'Only the group’s coaches can choose captains.' } });
    await fireEvent.press(screen.getByText('Save captains'));
    await settle();
    expect(screen.getByText('Only the group’s coaches can choose captains.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('says when there are no athletes', async () => {
    await openCaptains({ rpcs: { team_roster: ROSTER.filter((m) => m.team_role !== 'athlete') } });
    expect(screen.getByText('No athletes are in this team yet.')).toBeTruthy();
  });

  it('the chosen pick shows as selected', async () => {
    await openCaptains({}, [{ team_id: TEAM.id, profile_id: 'a1', captain_role: 'captain' }]);
    const chosen = screen
      .getAllByRole('button')
      .filter((b) => b.props.accessibilityState?.selected)
      .map((b) => b.queryAll((n) => n.type === 'Text')[0].props.children);
    // Alice, Bea and the unnamed athlete, in order.
    expect(chosen).toEqual(['Captain', 'Neither', 'Neither']);
  });
});
