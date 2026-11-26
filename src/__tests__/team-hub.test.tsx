/**
 * The Team tab for coaches, managers and physios (src/components/home/team-hub.tsx,
 * placed by src/components/home/hub-screen.tsx), from "Team" in section 3 and
 * "The Team tab" in section 6 of docs/user-guide.md.
 *
 * Check-ins, attendance and injuries are tiles that lead with their number,
 * in the order that suits the member's job; each squad or team shows its
 * people, with an injury status beside an athlete only for the group's
 * coaches and physios. Nobody gains a card, a number or a name they didn't
 * already have: the tiles are the same three cards, and the people are the
 * roster the database gives the group's own members.
 *
 * The chosen squad or team is on the Team tab itself (Matt, 27 November
 * 2026): rows for game goals, team goals, medical and emergency details and
 * choosing captains, each only for the people who could open them before,
 * and no second page that lists the same people again.
 */
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';
import { Dimensions } from 'react-native';

import ClubHubScreen from '@/app/(tabs)/club';
import FamilyHubScreen from '@/app/(tabs)/family';
import TeamHubScreen from '@/app/(tabs)/team';
import type { RosterEntry } from '@/lib/types';

import { argsOf, clearCalls, rpcNames } from './helpers/forms';
import {
  inTabs,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
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

function setFontScale(fontScale: number, width = 430) {
  const size = { width, height: 900, scale: 2, fontScale };
  Dimensions.set({ window: size, screen: size });
}

let push: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  setFontScale(1);
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
});
afterEach(() => {
  push.mockRestore();
  setFontScale(1);
});

const ROSTER: RosterEntry[] = [
  // The database's order: coaches, managers, physios, then athletes.
  { profile_id: 'coach', full_name: 'Casey Coach', team_role: 'coach', coach_title: 'head_coach', selection: null },
  { profile_id: 'manager', full_name: 'Morgan Manager', team_role: 'manager', coach_title: null, selection: null },
  { profile_id: 'a1', full_name: 'Alex Nguyen', team_role: 'athlete', coach_title: null, selection: 'touring' },
  { profile_id: 'a2', full_name: 'Bo Tran', team_role: 'athlete', coach_title: null, selection: 'touring' },
  { profile_id: 'a3', full_name: 'Jordan Kim', team_role: 'athlete', coach_title: null, selection: null },
];

const INJURIES = [
  { id: 'inj-1', athlete_id: 'a2', athlete_name: 'Bo Tran', status: 'injured', waiting_for_me: false },
  { id: 'inj-2', athlete_id: 'a3', athlete_name: 'Jordan Kim', status: 'clearance_requested', waiting_for_me: true },
];

const SUMMARY = [
  { team_id: TEAM.id, team_name: TEAM.name, team_kind: 'team', squad_id: null, athlete_count: 12, checked_in_count: 9, flagged_count: 2 },
];

async function openTeam(who: Who, rpcs: Record<string, unknown> = {}, tables: Record<string, unknown[]> = {}) {
  await openScreen(who, { team: inTabs(TeamHubScreen) }, '/team', tables, {
    rpcs: { team_roster: ROSTER, ...rpcs },
  });
}

const tiles = () => within(screen.getByTestId('readiness-tiles'));
const tileOrder = () =>
  tiles()
    .getAllByText(/^(Check-ins|Attendance|Injuries)$/)
    .map((t) => String(t.props.children));
const people = () => within(screen.getByTestId('people-list'));
const names = () =>
  people()
    .getAllByText(/^(Casey Coach|Morgan Manager|Alex Nguyen|Bo Tran|Jordan Kim)$/)
    .map((t) => String(t.props.children));

describe('the readiness tiles', () => {
  it('a coach: check-ins, then attendance, then injuries', async () => {
    await openTeam('coach');
    expect(tileOrder()).toEqual(['Check-ins', 'Attendance', 'Injuries']);
  });

  it('a physio: injuries first', async () => {
    await openTeam('physio');
    expect(tileOrder()).toEqual(['Injuries', 'Check-ins']);
  });

  it('a manager: attendance first, and no check-ins tile, as before', async () => {
    await openTeam('manager');
    expect(tileOrder()).toEqual(['Attendance', 'Injuries']);
  });

  it('someone who coaches one team and plays in another has the coach’s tiles', async () => {
    await openTeam({
      ...personas.coach,
      memberships: [
        { ...personas.athlete.memberships[0] },
        { ...personas.coach.memberships[0], team: TEAM_B },
      ],
    });
    expect(tileOrder()).toEqual(['Check-ins', 'Attendance', 'Injuries']);
  });

  it.each<PersonaName>(['athlete', 'minorAthlete', 'captain'])(
    'a %s has no tiles: their Team tab is their squads and teams',
    async (who) => {
      await openTeam(who);
      expect(screen.queryByTestId('readiness-tiles')).toBeNull();
      expect(screen.getByTestId('team-people')).toBeTruthy();
      expect(rpcNames()).not.toContain('athlete_attendance_summary');
      expect(rpcNames()).not.toContain('check_in_summary');
    },
  );

  it('Family and Club keep their cards as they were', async () => {
    await openScreen('guardian', { family: inTabs(FamilyHubScreen) }, '/family');
    expect(screen.queryByTestId('readiness-tiles')).toBeNull();
    await openScreen('committee', { club: inTabs(ClubHubScreen) }, '/club');
    expect(screen.queryByTestId('readiness-tiles')).toBeNull();
  });

  it('the tiles aren’t repeated as cards below', async () => {
    await openTeam('coach');
    expect(screen.getAllByText('Check-ins')).toHaveLength(1);
    expect(screen.getAllByText('Attendance')).toHaveLength(1);
    expect(screen.getAllByText('Injuries')).toHaveLength(1);
    // The other tools stay as cards.
    expect(screen.getByText('Surveys')).toBeTruthy();
    expect(tiles().queryByText('Surveys')).toBeNull();
  });

  it.each([
    ['at large text sizes', 1.3, 430],
    ['on the narrowest phones', 1, 320],
  ])('stack one a row %s, with the same words', async (_label, fontScale, width) => {
    setFontScale(fontScale, width);
    await openTeam('coach', { check_in_summary: SUMMARY });
    expect(screen.getByTestId('readiness-tiles').props.style).not.toMatchObject({ flexDirection: 'row' });
    expect(tileOrder()).toEqual(['Check-ins', 'Attendance', 'Injuries']);
    expect(tiles().getByText('9/12')).toBeTruthy();
    expect(tiles().getByText('checked in today')).toBeTruthy();
    expect(tiles().getByLabelText('Check-ins. 9 of 12 checked in today. 2 flagged')).toBeTruthy();
  });

  it('sit side by side on an ordinary phone', async () => {
    setFontScale(1, 360);
    await openTeam('coach');
    expect(screen.getByTestId('readiness-tiles').props.style).toMatchObject({ flexDirection: 'row' });
  });
});

describe('check-ins', () => {
  it('a coach sees how many of their athletes checked in today, and how many are flagged', async () => {
    await openTeam('coach', { check_in_summary: SUMMARY });
    expect(tiles().getByText('9/12')).toBeTruthy();
    expect(tiles().getByText('checked in today')).toBeTruthy();
    expect(tiles().getByText('2 flagged')).toBeTruthy();
    expect(
      tiles().getByLabelText('Check-ins. 9 of 12 checked in today. 2 flagged'),
    ).toBeTruthy();
  });

  it('says nothing about flags when nobody is flagged', async () => {
    await openTeam('coach', { check_in_summary: [{ ...SUMMARY[0], flagged_count: 0 }] });
    expect(tiles().getByText('9/12')).toBeTruthy();
    expect(tiles().queryByText(/flagged/)).toBeNull();
  });

  it('a physio sees squad and team totals only, never who is flagged', async () => {
    await openTeam('physio', {
      check_in_overview: [
        { team_id: TEAM.id, team_name: TEAM.name, team_kind: 'team', season: 2026, athlete_count: 12, checked_in_count: 9, flagged_count: 2 },
        { team_id: TEAM_B.id, team_name: TEAM_B.name, team_kind: 'team', season: 2026, athlete_count: 10, checked_in_count: 4, flagged_count: null },
      ],
    });
    expect(tiles().getByText('13/22')).toBeTruthy();
    expect(tiles().getByText('athletes checked in today')).toBeTruthy();
    expect(tiles().queryByText(/flagged/)).toBeNull();
    expect(rpcNames()).not.toContain('check_in_summary');
  });

  it('with nothing to count, says what it opens', async () => {
    await openTeam('coach');
    expect(tiles().getByText('See how squads and teams are feeling')).toBeTruthy();
  });

  it('opens Check-ins', async () => {
    await openTeam('coach', { check_in_summary: SUMMARY });
    await fireEvent.press(tiles().getByText('9/12'));
    expect(push).toHaveBeenLastCalledWith('/check-ins');
  });
});

describe('attendance', () => {
  const MARKS = [
    { profile_id: 'a1', full_name: 'Alex Nguyen', session_count: 8, present_count: 8, last_present_at: null },
    { profile_id: 'a2', full_name: 'Bo Tran', session_count: 8, present_count: 6, last_present_at: null },
  ];

  it('a coach sees attendance over the last four weeks', async () => {
    await openTeam('coach', { athlete_attendance_summary: MARKS });
    expect(tiles().getByText('88%')).toBeTruthy();
    expect(tiles().getByText('at sessions in 4 weeks')).toBeTruthy();
    expect(tiles().getByLabelText('Attendance. 88% at sessions in 4 weeks')).toBeTruthy();
    // The same question the Attendance screen asks, from four weeks back (today is 18 October 2026).
    const [args] = argsOf('athlete_attendance_summary');
    expect(Object.keys(args ?? {})).toEqual(['p_since']);
  });

  it('with no sessions in four weeks, says what it opens', async () => {
    await openTeam('coach', { athlete_attendance_summary: [] });
    expect(tiles().queryByText(/%/)).toBeNull();
    expect(tiles().getByText('Take attendance and see past sessions')).toBeTruthy();
  });

  it('a manager takes attendance and doesn’t see records: no figure, and the database isn’t asked', async () => {
    await openTeam('manager', { athlete_attendance_summary: MARKS });
    expect(tiles().queryByText('88%')).toBeNull();
    expect(tiles().getByText('Take attendance and see past sessions')).toBeTruthy();
    expect(rpcNames()).not.toContain('athlete_attendance_summary');
  });

  it.each<PersonaName>(['coach', 'manager'])(
    'tells a %s about new or changed absences',
    async (who) => {
      await openTeam(who, { absences_to_review: [{ id: 'ab-1' }, { id: 'ab-2' }] });
      expect(tiles().getByText('2 new or changed absences')).toBeTruthy();
    },
  );

  it('opens Attendance', async () => {
    await openTeam('coach');
    await fireEvent.press(tiles().getByText('Attendance'));
    expect(push).toHaveBeenLastCalledWith('/attendance');
  });
});

describe('injuries', () => {
  it('a coach sees how many current injuries, and how many wait on them', async () => {
    await openTeam('coach', { visible_injuries: INJURIES });
    expect(tiles().getByText('2')).toBeTruthy();
    expect(tiles().getByText('current injuries')).toBeTruthy();
    expect(tiles().getByText('1 waiting for you')).toBeTruthy();
    expect(tiles().getByLabelText('Injuries. 2 current injuries. 1 waiting for you')).toBeTruthy();
  });

  it('one injury is one injury', async () => {
    await openTeam('physio', { visible_injuries: [INJURIES[0]] });
    expect(tiles().getByText('1')).toBeTruthy();
    expect(tiles().getByText('current injury')).toBeTruthy();
    expect(tiles().queryByText(/waiting for you/)).toBeNull();
  });

  it('with none, says so', async () => {
    await openTeam('coach');
    expect(tiles().getByText('No current injuries')).toBeTruthy();
  });

  it('a manager logs injuries and doesn’t see them: no count, and the database isn’t asked', async () => {
    await openTeam('manager', { visible_injuries: INJURIES });
    expect(tiles().getByText('Log an injury at training or a game')).toBeTruthy();
    expect(tiles().queryByText('current injuries')).toBeNull();
    expect(rpcNames()).not.toContain('visible_injuries');
  });

  it('opens Injuries', async () => {
    await openTeam('coach', { visible_injuries: INJURIES });
    await fireEvent.press(tiles().getByText('current injuries'));
    expect(push).toHaveBeenLastCalledWith('/injuries');
  });
});

describe('a squad or team’s people', () => {
  it('lists its athletes, then its staff, each with their position, and counts them', async () => {
    await openTeam('coach');
    expect(names()).toEqual(['Alex Nguyen', 'Bo Tran', 'Jordan Kim', 'Casey Coach', 'Morgan Manager']);
    expect(screen.getByTestId('people-count').props.children).toBe('3 athletes · 2 staff');
    expect(people().getByText('Head Coach')).toBeTruthy();
    expect(people().getByText('Manager')).toBeTruthy();
    expect(argsOf('team_roster')).toContainEqual({ p_team_id: TEAM.id });
  });

  it('shows captains, as the team’s page does', async () => {
    await openTeam(
      // The harness keeps the team's captains with the member signed in.
      {
        ...personas.coach,
        captaincies: [{ team_id: TEAM.id, profile_id: 'a1', captain_role: 'captain' }],
      },
      {},
      { club_captains: [{ profile_id: 'a2', season: 2026 }] },
    );
    expect(people().getByText('Final team athlete · Captain')).toBeTruthy();
    expect(people().getByText('Final team athlete · Club captain')).toBeTruthy();
  });

  it.each<PersonaName>(['coach', 'physio'])(
    'the team’s %s sees an injury status beside each athlete who has one',
    async (who) => {
      await openTeam(who, { visible_injuries: INJURIES });
      expect(people().getByText('Injured')).toBeTruthy();
      expect(people().getByText('Clearance to review')).toBeTruthy();
      expect(people().getByLabelText(/^Bo Tran, .*\. Injured$/)).toBeTruthy();
      expect(screen.getByText('2 with a current injury')).toBeTruthy();
      // An athlete with no injury has nothing beside their name, and isn't a button.
      expect(people().queryByLabelText(/^Alex Nguyen/)).toBeNull();
    },
  );

  it('an injured athlete’s row opens that injury', async () => {
    await openTeam('coach', { visible_injuries: INJURIES });
    await fireEvent.press(people().getByText('Bo Tran'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/injuries/[id]', params: { id: 'inj-1' } });
  });

  it('an athlete with no injury opens nothing: there are no profile pages', async () => {
    await openTeam('coach', { visible_injuries: INJURIES });
    await fireEvent.press(people().getByText('Alex Nguyen'));
    await fireEvent.press(people().getByText('Casey Coach'));
    expect(push).not.toHaveBeenCalled();
  });

  it.each<PersonaName>(['athlete', 'minorAthlete', 'captain'])(
    'a %s sees names and positions only, even for an injury of their own',
    async (who) => {
      const me = personas[who].session!.user.id;
      await openTeam(who, {
        team_roster: [...ROSTER, { profile_id: me, full_name: 'Me Myself', team_role: 'athlete', coach_title: null, selection: null }],
        // What the database gives an athlete: their own injury only.
        visible_injuries: [{ id: 'mine', athlete_id: me, status: 'injured', waiting_for_me: false }],
      });
      expect(people().getByText('Me Myself')).toBeTruthy();
      expect(people().queryByText('Injured')).toBeNull();
      expect(screen.queryByText(/with a current injury/)).toBeNull();
      await fireEvent.press(people().getByText('Me Myself'));
      expect(push).not.toHaveBeenCalled();
    },
  );

  it('a manager sees names and positions only', async () => {
    await openTeam('manager', { visible_injuries: INJURIES });
    expect(names()).toHaveLength(5);
    expect(people().queryByText('Injured')).toBeNull();
    expect(screen.queryByText(/with a current injury/)).toBeNull();
  });

  it('a manager who is also an athlete’s parent still sees no status in the team they manage', async () => {
    // As a parent the database gives them their child's injury.
    await openTeam(
      {
        ...personas.manager,
        profile: { ...personas.manager.profile!, extra_roles: ['guardian'] },
      },
      { visible_injuries: [INJURIES[0]] },
    );
    expect(people().queryByText('Injured')).toBeNull();
  });

  it('with injuries switched off for the club, nobody sees a status', async () => {
    setClubFeatures({ injuries: false });
    await openTeam('coach', { visible_injuries: INJURIES });
    expect(names()).toHaveLength(5);
    expect(people().queryByText('Injured')).toBeNull();
  });

  it('nothing opens a second page of the same people: the team’s name and the member’s place are words', async () => {
    await openTeam('coach');
    expect(screen.getByTestId('group-name').props.children).toBe(TEAM.name);
    await fireEvent.press(screen.getByText('Team · Head Coach'));
    await fireEvent.press(screen.getByTestId('group-name'));
    expect(push).not.toHaveBeenCalled();
    expect(JSON.stringify(push.mock.calls)).not.toContain('/team/[id]');
  });

  it('with nobody added yet, says so', async () => {
    await openTeam('coach', { team_roster: [] });
    expect(screen.getByText('No one has been added yet.')).toBeTruthy();
    expect(screen.queryByTestId('people-list')).toBeNull();
  });

  it('someone in no squad or team is told so, and the database isn’t asked for anyone', async () => {
    await openTeam({ ...personas.coach, memberships: [] });
    expect(screen.getByText('You are not in a squad yet.')).toBeTruthy();
    expect(rpcNames()).not.toContain('team_roster');
  });
});

describe('more than one squad or team', () => {
  const two: Persona = {
    ...personas.coach,
    memberships: [
      personas.coach.memberships[0],
      { ...personas.coach.memberships[0], coach_title: 'assistant_coach', team: TEAM_B },
    ],
  };
  const OTHER: RosterEntry[] = [
    { profile_id: 'b1', full_name: 'Priya Shah', team_role: 'athlete', coach_title: null, selection: null },
  ];

  it('one group has no switch, only its name', async () => {
    await openTeam('coach');
    expect(screen.getAllByText(TEAM.name)).toHaveLength(1);
    expect(screen.queryByText(`${TEAM.name} · Team`)).toBeNull();
  });

  it('starts on the first, and switches to another’s card and people', async () => {
    await openScreen(two, { team: inTabs(TeamHubScreen) }, '/team', {}, {
      rpcHandlers: {
        team_roster: (args) => ((args as { p_team_id: string }).p_team_id === TEAM_B.id ? OTHER : ROSTER),
      },
    });
    // The switch names each; nothing repeats the chosen one's name.
    expect(screen.getAllByText(TEAM.name)).toHaveLength(1);
    expect(screen.getAllByText(TEAM_B.name)).toHaveLength(1);
    expect(screen.queryByTestId('group-name')).toBeNull();
    expect(screen.getByText('Team · Head Coach')).toBeTruthy();
    expect(people().getByText('Alex Nguyen')).toBeTruthy();

    await fireEvent.press(screen.getByText(TEAM_B.name));
    expect(screen.getByText('Team · Assistant Coach')).toBeTruthy();
    expect(screen.queryByText('Team · Head Coach')).toBeNull();
    expect(people().getByText('Priya Shah')).toBeTruthy();
    expect(people().queryByText('Alex Nguyen')).toBeNull();
    expect(screen.getByTestId('people-count').props.children).toBe('1 athlete');
    // The rows are the chosen team's.
    await fireEvent.press(screen.getByText('Choose captains'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/team/captains/[id]', params: { id: TEAM_B.id } });
  });

  it('a member in a squad and a team has chips that say which is which, the team first', async () => {
    const SQUAD = { ...TEAM_B, name: TEAM.name, kind: 'squad' as const };
    await openScreen(
      {
        ...personas.athlete,
        memberships: [
          { ...personas.athlete.memberships[0], team: SQUAD },
          personas.athlete.memberships[0],
        ],
      },
      { team: inTabs(TeamHubScreen) },
      '/team',
      {},
      { rpcs: { team_roster: ROSTER } },
    );
    expect(screen.getByText(`${TEAM.name} · Team`)).toBeTruthy();
    expect(screen.getByText(`${TEAM.name} · Squad`)).toBeTruthy();
    // The team is chosen first.
    expect(screen.getByTestId('my-place').props.children).toMatch(/^Team · /);
    await fireEvent.press(screen.getByText(`${TEAM.name} · Squad`));
    expect(screen.getByTestId('my-place').props.children).toMatch(/^Squad · /);
  });

  it('status follows the member’s place in the chosen group: a coach in one, an athlete in the other', async () => {
    const both: Persona = {
      ...personas.coach,
      memberships: [
        personas.coach.memberships[0],
        { ...personas.athlete.memberships[0], team: TEAM_B },
      ],
    };
    await openScreen(both, { team: inTabs(TeamHubScreen) }, '/team', {}, {
      rpcs: { team_roster: ROSTER, visible_injuries: INJURIES },
    });
    expect(people().getByText('Injured')).toBeTruthy();
    await fireEvent.press(screen.getByText(TEAM_B.name));
    expect(people().getByText('Bo Tran')).toBeTruthy();
    expect(people().queryByText('Injured')).toBeNull();
  });
});

// The chosen squad or team's rows: what used to sit behind its card on a
// second page (Matt, 27 November 2026). Each row shows only for the people
// who could open its screen before; team-screens.test.tsx goes through the
// same rows role by role on the page an admin opens.
describe('the chosen team’s rows', () => {
  const rows = () => within(screen.getByTestId('team-rows'));
  const rowTitles = () =>
    rows()
      .queryAllByText(/^(My game goals|Played games|Team goals|Medical and emergency details|Choose captains|Change who’s in it)$/)
      .map((t) => String(t.props.children));
  const BOARD = [
    {
      team_id: TEAM.id,
      team_name: TEAM.name,
      team_kind: 'team',
      athlete_id: 'a2',
      athlete_name: 'Bo Tran',
      next_fixture_id: 'fx1',
      next_label: 'Round 3 v Sample Storm',
      next_starts_at: '2099-10-24T02:00:00Z',
      next_goal_count: 2,
      reflections_to_answer: 1,
    },
  ];

  it('a coach: team goals, medical and emergency details, then captains, each one tap from the tab', async () => {
    await openTeam('coach');
    expect(rowTitles()).toEqual(['Team goals', 'Medical and emergency details', 'Choose captains']);
    await fireEvent.press(rows().getByText('Medical and emergency details'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/medical/team/[id]', params: { id: TEAM.id, name: TEAM.name } });
    await fireEvent.press(rows().getByText('Choose captains'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/team/captains/[id]', params: { id: TEAM.id } });
  });

  it.each<[string, PersonaName, string[]]>([
    ['an athlete', 'athlete', ['My game goals', 'Played games']],
    ['an athlete under 18', 'minorAthlete', ['My game goals', 'Played games']],
    ['a captain', 'captain', ['My game goals', 'Played games']],
    ['a manager', 'manager', ['Medical and emergency details']],
    ['a physio', 'physio', ['Medical and emergency details']],
  ])('%s has only their own rows', async (_l, who, expected) => {
    await openTeam(who, { goal_next_game: [], goal_past_games: [] });
    expect(rowTitles()).toEqual(expected);
    // Never the admin's row, and never another role's.
    expect(screen.queryByText('Change who’s in it')).toBeNull();
  });

  it('an admin who coaches the team has the coach’s rows, and changes its people from Club', async () => {
    await openTeam({ ...personas.admin, memberships: personas.coach.memberships });
    expect(rowTitles()).toEqual(['Team goals', 'Medical and emergency details', 'Choose captains']);
  });

  it('with game goals off, an athlete has no rows at all', async () => {
    setClubFeatures({ goals: false });
    await openTeam('athlete');
    expect(screen.queryByTestId('team-rows')).toBeNull();
    expect(names()).toHaveLength(5);
  });

  it('a coach’s athlete row says how their goals stand and opens them; the injury line opens the injury', async () => {
    await openTeam('coach', { goal_board: BOARD, visible_injuries: [INJURIES[0]] });
    expect(people().getByText(/^Round 3 v Sample Storm · .* · 2 goals$/)).toBeTruthy();
    expect(people().getByText('1 reflection waiting for a comment')).toBeTruthy();
    await fireEvent.press(people().getByText('Bo Tran'));
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/goals/athlete/[id]',
      params: { id: 'a2', name: 'Bo Tran', team: TEAM.id },
    });
    await fireEvent.press(people().getByText('Injured'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/injuries/[id]', params: { id: 'inj-1' } });
    // An athlete the board doesn't cover stays a name and a position.
    push.mockClear();
    await fireEvent.press(people().getByText('Alex Nguyen'));
    expect(push).not.toHaveBeenCalled();
  });

  it('a physio sees no goals beside a name, whatever the board says', async () => {
    await openTeam('physio', { goal_board: BOARD, visible_injuries: [INJURIES[0]] });
    expect(people().queryByText(/Sample Storm/)).toBeNull();
    await fireEvent.press(people().getByText('Bo Tran'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/injuries/[id]', params: { id: 'inj-1' } });
  });
});
