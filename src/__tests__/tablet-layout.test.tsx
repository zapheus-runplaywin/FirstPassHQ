/**
 * HQ on a tablet ("Using HQ on a tablet" in section 3 of docs/user-guide.md).
 * Home puts To do, Messages and Coming up beside the other cards on an iPad on
 * its side, and the busiest coach lists (attendance sessions, a team's people)
 * sit two or three a row. A phone sees exactly what it saw before.
 */
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';
import { Dimensions } from 'react-native';

import AttendanceScreen from '@/app/attendance/index';
import HomeScreen from '@/app/index';
import TeamScreen from '@/app/team/[id]';
import type { AttendanceSession, RosterEntry } from '@/lib/types';

import { clearCalls } from './helpers/forms';
import { openScreen, resetClub, TEAM, TEAM_B, DONE_SQUAD } from './helpers/harness';

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
// Home

describe('Home on a tablet', () => {
  const open = () => openScreen('coach', { index: HomeScreen }, '/');

  it('on an iPad on its side, puts To do, Messages and Coming up on the left, the rest on the right', async () => {
    setWindowWidth(IPAD_SIDEWAYS);
    await open();
    const [left, right] = screen.getByTestId('columns').children as Node[];
    expect(hasText(left, 'No new messages')).toBe(true);
    expect(hasText(left, 'Coming up')).toBe(true);
    expect(hasText(left, 'Take attendance and see past sessions')).toBe(false);
    expect(hasText(right, 'Take attendance and see past sessions')).toBe(true);
    expect(hasText(right, 'Injuries')).toBe(true);
    expect(hasText(right, 'No new messages')).toBe(false);
    // Raise a concern and the footer stay below both columns, on every screen size.
    expect(hasText(screen.getByTestId('columns'), 'Raise a concern')).toBe(false);
    expect(screen.getByText('Raise a concern')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('upright, keeps one column and puts the cards two a row', async () => {
    setWindowWidth(IPAD_UPRIGHT);
    await open();
    expect(screen.queryByTestId('columns')).toBeNull();
    // Screen width (820) less the screen's padding.
    await layOut(screen.getByTestId('card-grid-1'), IPAD_UPRIGHT - 48);
    const grid = screen.getByTestId('card-grid-2');
    expect(hasText(grid, 'Take attendance and see past sessions')).toBe(true);
    expect(hasText(grid, 'No new messages')).toBe(false);
  });

  it('on a phone, shows the same cards in the same order as before, one a row', async () => {
    setWindowWidth(PHONE);
    await open();
    expect(screen.queryByTestId('columns')).toBeNull();
    await layOut(screen.getByTestId('card-grid-1'), PHONE - 48);
    expect(screen.getByTestId('card-grid-1')).toBeTruthy();
    const order = screen
      .getAllByText(/^(No new messages|Coming up|Take attendance and see past sessions|Raise a concern)$/)
      .map((t) => t.props.children);
    expect(order).toEqual([
      'No new messages',
      'Coming up',
      'Take attendance and see past sessions',
      'Raise a concern',
    ]);
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
