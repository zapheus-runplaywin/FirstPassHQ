/**
 * HQ on a tablet ("Using HQ on a tablet" in section 3 of docs/user-guide.md).
 * Today puts what is next beside what needs you on an iPad on its side, a
 * hub's cards and the busiest coach lists (attendance sessions, a team's
 * people) sit two or three a row. A phone sees one column.
 */
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';
import { Dimensions } from 'react-native';

import AttendanceScreen from '@/app/attendance/index';
import TodayScreen from '@/app/(tabs)/index';
import TeamHubScreen from '@/app/(tabs)/team';
import TeamScreen from '@/app/team/[id]';
import type { AttendanceSession, RosterEntry } from '@/lib/types';

import { clearCalls } from './helpers/forms';
import { inTabs, openScreen, resetClub, TEAM, TEAM_B, DONE_SQUAD } from './helpers/harness';

/** Today, with what the tabs share loaded around it. */
const HomeScreen = inTabs(TodayScreen);

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

const PHONE = 430;
const IPAD_UPRIGHT = 820;
const IPAD_SIDEWAYS = 1180;

function setWindowWidth(width: number) {
  const size = { width, height: width > 1000 ? 820 : 1180, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
}

let push: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
});
afterEach(() => {
  push.mockRestore();
  setWindowWidth(PHONE);
});

type Node = ReturnType<typeof screen.getByTestId>;

/** Lays a card grid out at `width`, as the device would once it has measured it. */
async function layOut(grid: Node, width: number) {
  await fireEvent(grid, 'layout', { nativeEvent: { layout: { width, height: 600, x: 0, y: 0 } } });
}

const hasText = (node: Node, text: string) => within(node).queryAllByText(text).length > 0;

// ---------------------------------------------------------------------------
// Today and the hubs

/** Matches in the calendar: one later today, one in two days. */
const FIXTURES = [
  { id: 'f1', opponent: 'Sharks', starts_at: '2026-10-18T09:00:00Z' },
  { id: 'f2', opponent: 'Rays', starts_at: '2026-10-20T09:00:00Z' },
].map((f) => ({
  ...f,
  team_id: TEAM.id,
  team_name: TEAM.name,
  round_name: 'Round 6',
  grade_name: null,
  time_tbc: false,
  venue: 'Court 1',
  court: null,
  is_home: true,
  team: { kind: 'team' },
}));

describe('Today on a tablet', () => {
  const open = () =>
    openScreen('athlete', { index: HomeScreen }, '/', { fixtures: FIXTURES, check_ins: [] });

  it('on an iPad on its side, puts what is next on the left and what needs you on the right', async () => {
    setWindowWidth(IPAD_SIDEWAYS);
    await open();
    const [left, right] = screen.getByTestId('columns').children as Node[];
    expect(within(left).getByTestId('next-up')).toBeTruthy();
    expect(hasText(left, 'Later this week')).toBe(true);
    expect(within(left).queryByTestId('needs-you')).toBeNull();
    expect(within(right).getByTestId('needs-you')).toBeTruthy();
    expect(hasText(right, 'Do your daily check-in')).toBe(true);
    expect(within(right).queryByTestId('next-up')).toBeNull();
    // Raise a concern stays at the top, above both columns, on every screen size.
    expect(hasText(screen.getByTestId('columns'), 'Raise a concern')).toBe(false);
    expect(screen.getByText('Raise a concern')).toBeTruthy();
  });

  it.each([
    ['upright', IPAD_UPRIGHT],
    ['on a phone', PHONE],
  ])('%s, keeps one column: what is next, what needs you, then later this week', async (_l, width) => {
    setWindowWidth(width);
    await open();
    expect(screen.queryByTestId('columns')).toBeNull();
    const order = screen
      .getAllByText(/^(Raise a concern|Open A v Sharks|Do your daily check-in|Later this week)$/)
      .map((t) => t.props.children);
    expect(order).toEqual(['Raise a concern', 'Open A v Sharks', 'Do your daily check-in', 'Later this week']);
  });
});

describe('A hub on a tablet', () => {
  const open = () => openScreen('coach', { team: inTabs(TeamHubScreen) }, '/team');

  it('upright, puts the cards two a row', async () => {
    setWindowWidth(IPAD_UPRIGHT);
    await open();
    // Screen width (820) less the screen's padding.
    await layOut(screen.getByTestId('card-grid-1'), IPAD_UPRIGHT - 48);
    const grid = screen.getByTestId('card-grid-2');
    expect(hasText(grid, 'Take attendance and see past sessions')).toBe(true);
    // The member's squads lead the hub, above the grid.
    expect(hasText(grid, 'My squads and teams')).toBe(false);
    expect(screen.getByText('My squads and teams')).toBeTruthy();
  });

  it('on its side, three a row', async () => {
    setWindowWidth(IPAD_SIDEWAYS);
    await open();
    await layOut(screen.getByTestId('card-grid-1'), IPAD_SIDEWAYS - 48);
    const [row] = screen.getByTestId('card-grid-3').children as Node[];
    expect(
      within(row)
        .getAllByText(/^(Check-ins|Attendance|Injuries)$/)
        .map((t) => t.props.children),
    ).toEqual(['Check-ins', 'Attendance', 'Injuries']);
  });

  it('on a phone, one a row, in the same order', async () => {
    setWindowWidth(PHONE);
    await open();
    await layOut(screen.getByTestId('card-grid-1'), PHONE - 48);
    expect(screen.getByTestId('card-grid-1')).toBeTruthy();
    const order = screen
      .getAllByText(/^(My squads and teams|Check-ins|Attendance|Injuries|Surveys)$/)
      .map((t) => t.props.children);
    expect(order).toEqual(['My squads and teams', 'Check-ins', 'Attendance', 'Injuries', 'Surveys']);
  });

  it('opens a card from the grid', async () => {
    setWindowWidth(IPAD_SIDEWAYS);
    await open();
    await fireEvent.press(screen.getByText('Take attendance and see past sessions'));
    expect(push).toHaveBeenCalledWith('/attendance');
  });
});

// ---------------------------------------------------------------------------
// Attendance sessions

function session(n: number): AttendanceSession {
  return {
    id: `sess-${n}`,
    team_id: TEAM.id,
    team_name: TEAM.name,
    name: `Training ${n}`,
    held_at: `2026-10-1${n}T08:00:00Z`,
    taken_by_name: 'Sample coach',
    present_count: 1,
    marked_count: 2,
    can_edit: false,
  } as AttendanceSession;
}

describe('Attendance on a tablet', () => {
  it('puts past sessions two a row, newest first, and each still opens', async () => {
    setWindowWidth(IPAD_UPRIGHT);
    await openScreen('coach', { 'attendance/index': AttendanceScreen }, '/attendance', {}, {
      rpcs: {
        attendance_sessions_list: [session(3), session(2), session(1)],
        upcoming_absences: [],
        athlete_attendance_summary: [],
      },
    });
    await layOut(screen.getByTestId('card-grid-1'), IPAD_UPRIGHT - 48);
    const rows = screen.getByTestId('card-grid-2').children as Node[];
    expect(rows.map((r) => within(r).queryAllByText(/^Training \d$/).map((t) => t.props.children))).toEqual([
      ['Training 3', 'Training 2'],
      ['Training 1'],
    ]);
    await fireEvent.press(screen.getByText('Training 1'));
    expect(push).toHaveBeenCalledWith({ pathname: '/attendance/[id]', params: { id: 'sess-1' } });
  });
});

// ---------------------------------------------------------------------------
// A team's people

const ROSTER: RosterEntry[] = [
  { profile_id: 'coach', full_name: 'Sample coach', team_role: 'coach', coach_title: 'head_coach', selection: null },
  { profile_id: 'a1', full_name: 'Alice Athlete', team_role: 'athlete', coach_title: null, selection: 'touring' },
  { profile_id: 'a2', full_name: 'Bea Athlete', team_role: 'athlete', coach_title: null, selection: null },
  { profile_id: 'a3', full_name: 'Cal Athlete', team_role: 'athlete', coach_title: null, selection: null },
];

describe('A team’s people on a tablet', () => {
  it('puts people two a row on an iPad on its side, in the roster’s order', async () => {
    setWindowWidth(IPAD_SIDEWAYS);
    await openScreen('athlete', { 'team/[id]': TeamScreen }, `/team/${TEAM.id}`, {
      teams: [TEAM, TEAM_B, DONE_SQUAD],
      club_captains: [],
    }, {
      tableHandlers: { team_captains: () => [] },
      rpcs: { team_roster: ROSTER, goal_board: [], coach_team_games: [], goal_next_game: [], goal_past_games: [] },
    });
    // The page itself stays reading width (800) on a tablet: only home goes wider.
    await layOut(screen.getAllByTestId('card-grid-1').at(-1)!, 800 - 48);
    const rows = screen.getByTestId('card-grid-2').children as Node[];
    expect(rows.map((r) => within(r).queryAllByText(/^(Sample coach|\w+ Athlete)$/).map((t) => t.props.children))).toEqual([
      ['Sample coach', 'Alice Athlete'],
      ['Bea Athlete', 'Cal Athlete'],
    ]);
  });
});
