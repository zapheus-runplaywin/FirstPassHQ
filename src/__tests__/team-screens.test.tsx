/**
 * A squad or team's page (src/app/team/[id].tsx) and choosing its captains
 * (team/captains/[id].tsx). From "Squads and teams" in section 3, "Game
 * goals" in sections 4 and 6, "Captains" in section 4 and "Choosing captains"
 * in section 6 of docs/user-guide.md.
 *
 * The database decides who is on the roster a member gets (`team_roster`).
 * Only the group's coaches and admins choose captains; game goals show on a
 * team's page (not a squad's) for its athletes and its coaches while the
 * squad phase is open.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import ChooseCaptainsScreen from '@/app/team/captains/[id]';
import TeamScreen from '@/app/team/[id]';
import type { CoachTeamGame, GoalBoardRow, RosterEntry } from '@/lib/types';

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
    fireEvent.press(screen.getByText('Choose captains'));
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

  it('an athlete sees their own game goals, and that their coaches see them', async () => {
    await openTeam('athlete');
    expect(screen.getByText('Game goals')).toBeTruthy();
    expect(screen.getByText(/Your coaches can see your goals\.$/)).toBeTruthy();
    expect(screen.getByText('People')).toBeTruthy();
  });

  it('an athlete under 18 is told their parents see them too', async () => {
    await openTeam('minorAthlete');
    expect(screen.getByText(/Your coaches and your parents or guardians can see your goals\.$/)).toBeTruthy();
  });

  it('a coach sees team goals for this team’s games, and opens each athlete’s goals', async () => {
    await openTeam('coach', TEAM.id, {}, { rpcs: { goal_board: BOARD, coach_team_games: [GAME, { ...GAME, team_id: TEAM_B.id, fixture_id: 'fx9', opponent: 'Elsewhere' }] } });
    expect(screen.getByText('Team goals')).toBeTruthy();
    expect(screen.getByText('Round 3 v Sample Storm')).toBeTruthy();
    expect(screen.getByText('No team goals yet')).toBeTruthy();
    expect(screen.queryByText('Round 3 v Elsewhere')).toBeNull();
    expect(screen.getByText('1 reflection waiting for a comment')).toBeTruthy();
    expect(screen.getByText(/^Round 3 v Sample Storm · .* · 2 goals$/)).toBeTruthy();
    fireEvent.press(screen.getByText('Alice Athlete'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/goals/athlete/[id]',
      params: { id: 'a1', name: 'Alice Athlete', team: TEAM.id },
    });
    fireEvent.press(screen.getByText('Round 3 v Sample Storm'));
    expect(push).toHaveBeenCalledWith({ pathname: '/goals/team', params: { fixture: 'fx1' } });
  });

  it('an admin reads this team’s goals through the admin list, and opens them', async () => {
    await openTeam('admin', TEAM.id, {}, { rpcs: { admin_team_games: [GAME, { ...GAME, team_id: TEAM_B.id, fixture_id: 'fx9', opponent: 'Elsewhere' }] } });
    expect(screen.getByText('Team goals')).toBeTruthy();
    expect(screen.getByText(/^The goals its coaches set for the whole team before each game/)).toBeTruthy();
    expect(screen.getByText('Round 3 v Sample Storm')).toBeTruthy();
    expect(screen.queryByText('Round 3 v Elsewhere')).toBeNull();
    fireEvent.press(screen.getByText('Round 3 v Sample Storm'));
    expect(push).toHaveBeenCalledWith({ pathname: '/goals/team', params: { fixture: 'fx1' } });
  });

  it('an admin gets no team goals on a squad’s page', async () => {
    await openTeam('admin', DONE_SQUAD.id, {}, { rpcs: { admin_team_games: [{ ...GAME, team_id: DONE_SQUAD.id }] } });
    expect(screen.queryByText('Team goals')).toBeNull();
  });

  it('a coach with no game this week is told when team goals open', async () => {
    await openTeam('coach');
    expect(screen.getByText('No game in the next 7 days. Team goals open a week before each game.')).toBeTruthy();
  });

  it.each<[string, Partial<CoachTeamGame>, string]>([
    ['goals set', { goal_count: 2 }, '2 team goals set'],
    ['game on', { goals_close_at: '2026-10-17T00:00:00Z', played_at: '2026-10-19T00:00:00Z', goal_count: 1 }, '1 team goal · game on'],
    ['played, none set', { is_next: false, goals_close_at: '2026-10-10T00:00:00Z', played_at: '2026-10-10T01:00:00Z' }, 'No team goals were set'],
    ['played, part reviewed', { is_next: false, goals_close_at: '2026-10-10T00:00:00Z', played_at: '2026-10-10T01:00:00Z', goal_count: 3, reviewed_count: 1 }, '3 team goals · 1 of 3 reviewed'],
    ['played, all reviewed', { is_next: false, goals_close_at: '2026-10-10T00:00:00Z', played_at: '2026-10-10T01:00:00Z', goal_count: 2, reviewed_count: 2 }, '2 team goals · ✓ Reviewed'],
  ])('sums up team goals: %s', async (_l, extra, line) => {
    await openTeam('coach', TEAM.id, {}, { rpcs: { coach_team_games: [{ ...GAME, ...extra }] } });
    expect(screen.getByText(line)).toBeTruthy();
  });

  it.each<[string, Who, string]>([
    ['a squad’s page', { ...personas.athlete, memberships: [{ ...personas.athlete.memberships[0], team: { ...TEAM, kind: 'squad' as const } }] }, TEAM.id],
    ['a member not in the group', 'committee', TEAM.id],
    ['a manager', 'manager', TEAM.id],
  ])('there are no game goals on %s', async (_l, who, id) => {
    await openTeam(who, id, {}, { rpcs: { goal_board: BOARD } });
    expect(screen.queryByText('Game goals')).toBeNull();
    expect(screen.queryByText('Team goals')).toBeNull();
    expect(screen.queryByText('People')).toBeNull();
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
    // Athletes are plain cards, not links to goals.
    fireEvent.press(screen.getByText('Alice Athlete'));
    expect(push).not.toHaveBeenCalled();
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
    fireEvent.press(screen.getAllByText('Captain')[alice]);
    fireEvent.press(screen.getAllByText('Captain')[unnamed]);
    fireEvent.press(screen.getAllByText('Neither')[bea]);
    fireEvent.press(screen.getAllByText('Vice captain')[bea]);
    fireEvent.press(screen.getByText('Save captains'));
    await settle();
    expect(argsOf('set_group_captains')).toEqual([
      { p_team_id: TEAM.id, p_captain_ids: ['a1', 'a3'], p_vice_captain_ids: ['a2'] },
    ]);
    expect(back).toHaveBeenCalled();
  });

  it('Neither removes a captain', async () => {
    await openCaptains({}, [{ team_id: TEAM.id, profile_id: 'a1', captain_role: 'captain' }]);
    fireEvent.press(screen.getAllByText('Neither')[0]);
    fireEvent.press(screen.getByText('Save captains'));
    await settle();
    expect(argsOf('set_group_captains')[0]).toMatchObject({ p_captain_ids: [], p_vice_captain_ids: [] });
  });

  it('shows the database’s refusal and stays', async () => {
    await openCaptains({ rpcErrors: { set_group_captains: 'Only the group’s coaches can choose captains.' } });
    fireEvent.press(screen.getByText('Save captains'));
    await settle();
    expect(screen.getByText('Only the group’s coaches can choose captains.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('says when there are no athletes', async () => {
    await openCaptains({ rpcs: { team_roster: ROSTER.filter((m) => m.team_role !== 'athlete') } });
    expect(screen.getByText('No athletes are in this group yet.')).toBeTruthy();
  });

  it('the chosen pick shows as selected', async () => {
    await openCaptains({}, [{ team_id: TEAM.id, profile_id: 'a1', captain_role: 'captain' }]);
    const chosen = screen
      .getAllByRole('button')
      .filter((b) => b.props.accessibilityState?.selected)
      .map((b) => b.findByType(Text).props.children);
    // Alice, Bea and the unnamed athlete, in order.
    expect(chosen).toEqual(['Captain', 'Neither', 'Neither']);
  });
});
