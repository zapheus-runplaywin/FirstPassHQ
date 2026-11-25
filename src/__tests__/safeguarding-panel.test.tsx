/**
 * The safeguarding panel at the top of Today (SafeguardingPanel in
 * src/components/home/today.tsx, placed by src/app/(tabs)/index.tsx), from
 * "Today" in section 3 and "Concerns" in section 10 of docs/user-guide.md.
 * The people the concerns register is open to (admins, the safeguarding
 * posts, and someone a concern was escalated to) see its three counts and
 * every piece of safeguarding work before anything else; that work is no
 * longer repeated under Needs you. Nobody else has the panel. It shows
 * counts and references only.
 */
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';

import TodayScreen from '@/app/(tabs)/index';

import { clearCalls, rpcNames } from './helpers/forms';
import {
  inTabs,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
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

const Today = inTabs(TodayScreen);

let push: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
});
afterEach(() => push.mockRestore());

async function openToday(who: PersonaName | Persona, rpcs: Record<string, unknown> = {}) {
  await openScreen(who, { index: Today }, '/', {}, { rpcs });
}

const panel = () => within(screen.getByTestId('safeguarding-panel'));
const needsYou = () => within(screen.getByTestId('needs-you'));

const COUNTS = { new_count: 2, in_progress_count: 3, closed_recent_count: 4 };
const CLOCK = {
  concern_id: 'c1',
  reference: 'C-0011',
  stage: 'urgent',
  clock_from: '2026-10-01T00:00:00Z',
  escalated: false,
};

describe('who has the panel', () => {
  it.each<[string, PersonaName | Persona]>([
    ['an admin', 'admin'],
    ['an admin whose own check has expired', 'adminExpiredCheck'],
    ['a coach who is the Child Safety Officer or Complaints Manager', { ...personas.coach, isSafeguardingOfficer: true }],
    ['a committee member who is a safeguarding officer', { ...personas.committee, isSafeguardingOfficer: true }],
    ['a guest who is a safeguarding officer', { ...personas.guest, isSafeguardingOfficer: true }],
  ])('%s has it, with the register’s counts', async (_label, who) => {
    await openToday(who, { concern_counts: COUNTS });
    expect(screen.getByTestId('safeguarding-panel')).toBeTruthy();
    expect(panel().getByTestId('concern-lights')).toBeTruthy();
    expect(rpcNames()).toContain('concern_counts');
  });

  it.each<PersonaName>([
    'athlete',
    'minorAthlete',
    'guardian',
    'coach',
    'manager',
    'physio',
    'committee',
    'statistician',
    'guest',
    'stoodDownAdmin',
    'stoodDownCoach',
  ])('a %s has no panel, and the register’s counts are never asked for', async (who) => {
    // Even if the database had something to say, they aren't asked about it.
    await openToday(who, { concern_counts: COUNTS, new_concerns_count: 5, my_concern_clocks: [CLOCK] });
    expect(screen.queryByTestId('safeguarding-panel')).toBeNull();
    expect(screen.queryByTestId('concern-lights')).toBeNull();
    expect(screen.queryByText(/C-0011/)).toBeNull();
    expect(screen.queryByText(/new concern/)).toBeNull();
    expect(rpcNames()).not.toContain('concern_counts');
    expect(rpcNames()).not.toContain('new_concerns_count');
  });

  it('someone a concern was escalated to by name has it for that work', async () => {
    await openToday('coach', {
      has_escalated_concerns: true,
      my_concern_clocks: [{ ...CLOCK, escalated: true }],
    });
    expect(panel().getByText('C-0011 is urgent: nothing recorded for too long')).toBeTruthy();
    expect(panel().getByText('Escalated to you')).toBeTruthy();
  });
});

describe('what it shows', () => {
  it('leads Today: the counts, then each piece of work, most pressing first', async () => {
    setClubFeatures({ chatGroups: true });
    await openToday('admin', {
      concern_counts: COUNTS,
      new_concerns_count: 2,
      my_concern_clocks: [{ ...CLOCK, stage: 'important', reference: 'C-0008', concern_id: 'c8' }],
      chat_blocks_waiting: { waiting: 1 },
    });
    const view = panel();
    expect(view.getByText('Safeguarding')).toBeTruthy();
    // New, in progress, closed in the last 4 weeks.
    expect(view.getByTestId('concern-lights').props.accessibilityLabel).toBe(
      '2 new, 3 in progress, 4 closed in the last 4 weeks',
    );
    const titles = view
      .getAllByText(
        /^(Look at 2 new concerns|C-0008 has had nothing recorded for a while|Follow up a block in chat groups)$/,
      )
      .map((t) => String(t.props.children));
    // Urgent, then Important, then Needs checking.
    expect(titles).toEqual([
      'Look at 2 new concerns',
      'C-0008 has had nothing recorded for a while',
      'Follow up a block in chat groups',
    ]);
    // The new-concern row keeps what to do first.
    expect(view.getByText('Refer child abuse and serious crimes to Police straight away')).toBeTruthy();
    expect(view.getByText('Urgent')).toBeTruthy();
    expect(view.queryByTestId('safeguarding-quiet')).toBeNull();

    // Before the calendar and before Needs you.
    const order = screen
      .getAllByText(/^(Safeguarding|Next up|Needs you)$/)
      .map((t) => String(t.props.children));
    expect(order[0]).toBe('Safeguarding');
  });

  it('doesn’t repeat that work under Needs you, or count it there', async () => {
    await openToday('admin', { concern_counts: COUNTS, new_concerns_count: 1, my_concern_clocks: [CLOCK] });
    expect(panel().getByText('Look at 1 new concern')).toBeTruthy();
    expect(panel().getByText('C-0011 is urgent: nothing recorded for too long')).toBeTruthy();
    expect(needsYou().queryByText('Look at 1 new concern')).toBeNull();
    expect(needsYou().queryByText(/C-0011/)).toBeNull();
    expect(screen.getAllByText('Look at 1 new concern')).toHaveLength(1);
  });

  it('never says "You’re set for today" while safeguarding work is waiting', async () => {
    await openToday({ ...personas.guest, isSafeguardingOfficer: true }, {
      concern_counts: COUNTS,
      new_concerns_count: 1,
    });
    expect(panel().getByText('Look at 1 new concern')).toBeTruthy();
    expect(screen.queryByTestId('all-done')).toBeNull();
    expect(screen.queryByText('You’re set for today')).toBeNull();
  });

  it('with nothing waiting it is three counts and one quiet line, and Today can say it’s done', async () => {
    await openToday({ ...personas.guest, isSafeguardingOfficer: true }, {
      concern_counts: { new_count: 0, in_progress_count: 0, closed_recent_count: 1 },
    });
    const view = panel();
    expect(view.getByTestId('concern-lights')).toBeTruthy();
    expect(view.getByText('Nothing is waiting on you.')).toBeTruthy();
    expect(view.queryByText(/Look at/)).toBeNull();
    expect(screen.getByTestId('all-done')).toBeTruthy();
  });

  it('shows counts and references only: nothing a concern says', async () => {
    await openToday('admin', { concern_counts: COUNTS, new_concerns_count: 1, my_concern_clocks: [CLOCK] });
    // The register's rows (who raised it, about whom, what happened) are never loaded for Today.
    expect(rpcNames()).not.toContain('concern_register');
    expect(rpcNames().filter((n) => /^concern/.test(n)).sort()).toEqual(['concern_counts']);
  });
});

describe('where it goes', () => {
  it('its heading opens the concerns register, and says the counts to a screen reader', async () => {
    await openToday('admin', { concern_counts: COUNTS });
    const head = screen.getByLabelText(
      'Safeguarding. 2 new, 3 in progress, 4 closed in the last 4 weeks. Opens the concerns register',
    );
    await fireEvent.press(head);
    expect(push).toHaveBeenCalledWith('/concerns');
  });

  it('each row opens its own work', async () => {
    await openToday('admin', { concern_counts: COUNTS, new_concerns_count: 1, my_concern_clocks: [CLOCK] });
    await fireEvent.press(panel().getByText('C-0011 is urgent: nothing recorded for too long'));
    expect(push).toHaveBeenLastCalledWith('/concerns/c1');
    await fireEvent.press(panel().getByText('Look at 1 new concern'));
    expect(push).toHaveBeenLastCalledWith('/concerns');
  });
});
