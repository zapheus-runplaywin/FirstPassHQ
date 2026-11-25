/**
 * Reporting an absence (src/app/attendance/absence.tsx), from **Report an
 * absence** in docs/user-guide.md.
 *
 * When the club has absence reasons, one must be chosen before the absence is
 * sent. The screen only knows whether the club has any once they have loaded,
 * so Report absence waits for them: a quick tap before then could otherwise
 * send an absence with no reason (the race behind a flaky browser test).
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import ReportAbsenceScreen from '@/app/attendance/absence';
import type { AbsenceReason } from '@/lib/absences';

import { argsOf, clearCalls, rpcNames } from './helpers/forms';
import { openScreen, resetClub } from './helpers/harness';

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

/** The club's reasons as the screen sees them: null while they are loading. */
let mockReasons: AbsenceReason[] | null = null;
jest.mock('@/lib/absences', () => ({
  ...jest.requireActual('@/lib/absences'),
  useAbsenceReasons: () => ({ reasons: mockReasons, reload: jest.fn() }),
}));

const REASONS: AbsenceReason[] = [
  { id: 'r-ill', name: 'Illness', active: true, sort_order: 0 },
  { id: 'r-hol', name: 'Planned holidays', active: true, sort_order: 1 },
];

let back: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
});
afterEach(() => back.mockRestore());

async function openAbsence(reasons: AbsenceReason[] | null, day = '') {
  mockReasons = reasons;
  await openScreen(
    'guardian',
    { 'attendance/absence': ReportAbsenceScreen },
    `/attendance/absence?id=child-1&name=Sample%20Child${day ? `&day=${day}` : ''}`,
    {},
    { rpcs: { report_absence: null } },
  );
}

/** The Report absence button, found by role so it is found while it shows a spinner. */
function reportButton() {
  const buttons = screen.getAllByRole('button');
  return buttons[buttons.length - 1];
}

describe('reporting an absence', () => {
  it('waits for the club’s reasons before Report absence can be pressed', async () => {
    await openAbsence(null);
    // The button shows a spinner instead of its title, and does nothing.
    expect(screen.queryByText('Report absence')).toBeNull();
    const button = reportButton();
    expect(button.props.accessibilityState?.disabled ?? button.props['aria-disabled']).toBe(true);
    await fireEvent.press(button);
    expect(rpcNames()).not.toContain('report_absence');
    expect(screen.queryByText('Choose a reason.')).toBeNull();
    expect(back).not.toHaveBeenCalled();
  });

  it('asks for a reason when the club has some, and sends nothing', async () => {
    await openAbsence(REASONS);
    await fireEvent.press(screen.getByText('Report absence'));
    expect(screen.getByText('Choose a reason.')).toBeTruthy();
    expect(rpcNames()).not.toContain('report_absence');
    expect(back).not.toHaveBeenCalled();
  });

  it('sends the chosen reason, then goes back', async () => {
    await openAbsence(REASONS);
    await fireEvent.press(screen.getByText('Planned holidays'));
    await fireEvent.press(screen.getByText('Report absence'));
    expect(argsOf('report_absence')).toEqual([
      {
        p_athlete_id: 'child-1',
        p_from: '2026-10-18',
        p_to: '2026-10-18',
        p_category_id: 'r-hol',
        p_reason: '',
      },
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('sends without a reason in a club that has none', async () => {
    await openAbsence([]);
    expect(screen.queryByText('Reason')).toBeNull();
    await fireEvent.press(screen.getByText('Report absence'));
    expect(argsOf('report_absence')).toEqual([
      expect.objectContaining({ p_athlete_id: 'child-1', p_category_id: null }),
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('opened from a session on the calendar, starts on that session’s day', async () => {
    await openAbsence([], '2026-10-24');
    await fireEvent.press(screen.getByText('Report absence'));
    expect(argsOf('report_absence')).toEqual([
      expect.objectContaining({ p_athlete_id: 'child-1', p_from: '2026-10-24', p_to: '2026-10-24' }),
    ]);
  });

  it.each(['tomorrow', '2026-13-99x', '24/10/2026'])('ignores a day that isn’t a date (%s) and starts today', async (day) => {
    await openAbsence([], encodeURIComponent(day));
    await fireEvent.press(screen.getByText('Report absence'));
    expect(argsOf('report_absence')).toEqual([
      expect.objectContaining({ p_from: '2026-10-18', p_to: '2026-10-18' }),
    ]);
  });
});
