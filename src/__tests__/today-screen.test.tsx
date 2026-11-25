/**
 * Today, the first tab (src/app/(tabs)/index.tsx): the club and the date,
 * what is next on the calendar with its time, what needs the member, and the
 * few events after that. home-states.test.tsx covers the list of what needs
 * them and every state before approval; home-by-role.test.tsx covers who sees
 * what. From "Today" in section 3 of docs/user-guide.md.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen, within } from 'expo-router/testing-library';
import { AppState, type AppStateStatus } from 'react-native';

import TodayScreen from '@/app/(tabs)/index';
import { clubDay } from '@/lib/club-time';
import { todayLabel } from '@/lib/today';

import { clearCalls } from './helpers/forms';
import {
  inTabs,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  TEAM,
  TODAY,
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

/** A time on the day the tests run in (TODAY), `days` later, in the tester's own time zone. */
const at = (days: number, hour: number, minute = 0) =>
  new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + days, hour, minute);

/** A match in the calendar. Matches last an hour. */
function match(id: string, opponent: string, start: Date, extra: Record<string, unknown> = {}) {
  return {
    id,
    opponent,
    starts_at: start.toISOString(),
    team_id: TEAM.id,
    team_name: TEAM.name,
    round_name: 'Round 6',
    grade_name: null,
    time_tbc: false,
    venue: 'Court 1',
    court: null,
    is_home: true,
    team: { kind: 'team' },
    ...extra,
  };
}

let push: jest.SpyInstance;
let navigate: jest.SpyInstance;

beforeEach(() => {
  resetClub();
  clearCalls();
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
  navigate = jest.spyOn(router, 'navigate').mockImplementation(() => {});
});

afterEach(() => {
  push.mockRestore();
  navigate.mockRestore();
});

async function openToday(who: PersonaName | Persona, fixtures: unknown[] = [], tables: Record<string, unknown[]> = {}) {
  await openScreen(who, { index: Today }, '/', { fixtures, ...tables });
}

describe('the top of Today', () => {
  it('shows the club, today’s date and a greeting, with Raise a concern beside them', async () => {
    await openToday('athlete');
    expect(screen.getByTestId('home-club-logo')).toBeTruthy();
    expect(screen.getByText(todayLabel(TODAY))).toBeTruthy();
    expect(screen.getByText(`Hi ${personas.athlete.profile!.full_name}`)).toBeTruthy();
    expect(screen.getByText('Athlete')).toBeTruthy();
    await fireEvent.press(screen.getByText('Raise a concern'));
    expect(push).toHaveBeenCalledWith('/concern/new');
  });
});

describe('Next up', () => {
  it('shows the next thing on the calendar with its time, where it is, and opens it', async () => {
    await openToday('athlete', [match('f1', 'Sharks', at(0, 18, 30))]);
    const card = screen.getByTestId('next-up');
    expect(within(card).getByText('Next up · Tonight')).toBeTruthy();
    expect(within(card).getByText(/^6:30/)).toBeTruthy();
    expect(within(card).getByText('Open A v Sharks')).toBeTruthy();
    expect(within(card).getByText('Court 1')).toBeTruthy();
    expect(card.props.accessibilityLabel).toMatch(/^Next up, Tonight, .*Open A v Sharks, Court 1$/);
    await fireEvent.press(card);
    expect(push).toHaveBeenCalledWith({ pathname: '/event/[id]', params: { id: 'fixture:f1' } });
  });

  it.each([
    ['later today', at(0, 15), 'Next up · Today'],
    ['tomorrow', at(1, 9), 'Next up · Tomorrow'],
  ])('says when it is: %s', async (_when, start, label) => {
    await openToday('athlete', [match('f1', 'Sharks', start)]);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('says "Now" while it is on', async () => {
    // Started half an hour before the test's clock, and runs for an hour.
    await openToday('athlete', [match('f1', 'Sharks', new Date(TODAY.getTime() - 30 * 60 * 1000))]);
    expect(screen.getByText('Next up · Now')).toBeTruthy();
  });

  it('leaves out where it is when the calendar doesn’t say', async () => {
    await openToday('athlete', [match('f1', 'Sharks', at(0, 18), { venue: null })]);
    const card = screen.getByTestId('next-up');
    expect(card.props.accessibilityLabel).toMatch(/Open A v Sharks$/);
  });

  // What the member can do about the next session, one tap from Today
  // (src/lib/session.ts has the rules for every kind of member).
  describe('shortcuts under it', () => {
    const tonight = () => [match('f1', 'Sharks', at(0, 18, 30))];
    const actions = () => {
      const row = screen.queryByTestId('next-up-actions');
      return row ? within(row).getAllByRole('button').map((b) => within(b).getByText(/./).props.children) : [];
    };
    const parentInTeam: Persona = {
      ...personas.guardian,
      memberships: [{ team_role: 'guardian', coach_title: null, selection: null, team: TEAM }],
    };

    it.each<[string, PersonaName | Persona, string[]]>([
      ['an athlete', 'athlete', ['Can’t make it']],
      ['a parent whose child is in the team', parentInTeam, ['Sample Child can’t make it']],
      ['a parent whose child isn’t', 'guardian', []],
      // The plan and check-ins are on the session's page, not here.
      ['the coach', 'coach', ['Take attendance']],
      ['the manager', 'manager', ['Take attendance']],
      ['the physio', 'physio', []],
      ['an admin', 'admin', ['Take attendance']],
      ['a committee member', 'committee', []],
      ['a guest', 'guest', []],
    ])('%s has the shortcuts for them', async (_label, who, expected) => {
      await openToday(who, tonight());
      expect(actions()).toEqual(expected);
    });

    it('Can’t make it opens the absence form on the session’s day', async () => {
      await openToday('athlete', [match('f1', 'Sharks', at(1, 9))]);
      await fireEvent.press(screen.getByText('Can’t make it'));
      expect(push).toHaveBeenCalledWith({
        pathname: '/attendance/absence',
        params: { id: 'athlete', day: clubDay(at(1, 9)) },
      });
    });

    it('Take attendance opens the register for that team and session', async () => {
      await openToday('coach', tonight());
      await fireEvent.press(screen.getByText('Take attendance'));
      expect(push).toHaveBeenCalledWith({
        pathname: '/attendance/new',
        params: { team: TEAM.id, event: 'fixture:f1' },
      });
    });

    it('a coach isn’t offered attendance for tomorrow’s session', async () => {
      await openToday('coach', [match('f1', 'Sharks', at(1, 9))]);
      expect(actions()).toEqual([]);
    });

    it('the card itself still opens the session', async () => {
      await openToday('athlete', tonight());
      await fireEvent.press(screen.getByTestId('next-up'));
      expect(push).toHaveBeenCalledWith({ pathname: '/event/[id]', params: { id: 'fixture:f1' } });
    });

    it('nothing is offered while the club has Attendance switched off', async () => {
      setClubFeatures({ attendance: false });
      await openToday('athlete', tonight());
      expect(actions()).toEqual([]);
    });
  });

  it('says so, plainly, with nothing on the calendar', async () => {
    await openToday('athlete');
    expect(within(screen.getByTestId('next-up')).getByText('Nothing on the calendar yet.')).toBeTruthy();
    expect(screen.queryByText('Later this week')).toBeNull();
    expect(screen.queryByText('Coming up')).toBeNull();
    expect(screen.queryByText('Full calendar')).toBeNull();
  });

  it('skips what is already over', async () => {
    await openToday('athlete', [
      match('f0', 'Rays', new Date(TODAY.getTime() - 3 * 60 * 60 * 1000)),
      match('f1', 'Sharks', at(1, 9)),
    ]);
    expect(within(screen.getByTestId('next-up')).getByText('Open A v Sharks')).toBeTruthy();
    expect(screen.queryByText('Open A v Rays')).toBeNull();
  });

  it('moves on when the member comes back to the app after it has finished', async () => {
    await openToday('athlete', [
      match('f1', 'Sharks', new Date(TODAY.getTime() + 30 * 60 * 1000)),
      match('f2', 'Rays', new Date(TODAY.getTime() + 5 * 60 * 60 * 1000)),
    ]);
    expect(within(screen.getByTestId('next-up')).getByText('Open A v Sharks')).toBeTruthy();
    // What Today asked the phone to tell it: the app going away and coming back.
    const listeners = (AppState.addEventListener as jest.Mock).mock.calls;
    const onChange = listeners.at(-1)![1] as (state: AppStateStatus) => void;
    // Two hours on, the first match is over. Nothing changes until they look again.
    jest.setSystemTime(new Date(TODAY.getTime() + 2 * 60 * 60 * 1000));
    await act(async () => onChange('background'));
    expect(within(screen.getByTestId('next-up')).getByText('Open A v Sharks')).toBeTruthy();
    await act(async () => onChange('active'));
    expect(within(screen.getByTestId('next-up')).getByText('Open A v Rays')).toBeTruthy();
  });

  it('isn’t there with the calendar switched off', async () => {
    setClubFeatures({ calendar: false });
    await openToday('athlete', [match('f1', 'Sharks', at(0, 18))]);
    expect(screen.queryByTestId('next-up')).toBeNull();
    expect(screen.queryByText('Later this week')).toBeNull();
    expect(screen.getByTestId('needs-you')).toBeTruthy();
  });
});

describe('Later this week', () => {
  const WEEK = [
    match('f1', 'Sharks', at(0, 18)),
    match('f2', 'Rays', at(1, 17)),
    match('f3', 'Gulls', at(3, 10), { venue: null }),
  ];

  it('lists the next few after it, each with when and where, and opens them', async () => {
    await openToday('athlete', WEEK);
    expect(screen.getByText('Later this week')).toBeTruthy();
    expect(screen.getByText(/^Tomorrow · 5:00.* · Court 1$/)).toBeTruthy();
    // With no place on the calendar, just when.
    expect(screen.getByText('Open A v Gulls')).toBeTruthy();
    expect(screen.queryAllByText(/ · Court 1$/)).toHaveLength(1);
    await fireEvent.press(screen.getByText('Open A v Rays'));
    expect(push).toHaveBeenCalledWith({ pathname: '/event/[id]', params: { id: 'fixture:f2' } });
  });

  it('opens the Calendar tab from "Full calendar"', async () => {
    await openToday('athlete', WEEK);
    await fireEvent.press(screen.getByText('Full calendar'));
    expect(navigate).toHaveBeenCalledWith('/calendar');
  });

  it('with nothing else this week, shows what is coming up instead', async () => {
    await openToday('athlete', [match('f1', 'Sharks', at(0, 18)), match('f2', 'Rays', at(20, 17))]);
    expect(screen.queryByText('Later this week')).toBeNull();
    expect(screen.getByText('Coming up')).toBeTruthy();
    expect(screen.getByText('Open A v Rays')).toBeTruthy();
  });

  it('with only one thing on the calendar, says there is nothing else', async () => {
    await openToday('athlete', [match('f1', 'Sharks', at(0, 18))]);
    expect(screen.getByText('Nothing else on the calendar yet.')).toBeTruthy();
    expect(screen.getByText('Full calendar')).toBeTruthy();
  });
});

describe('what leads Today', () => {
  /** The pieces of Today, top to bottom. */
  function order() {
    return screen
      .getAllByText(/^(Confirm who you are|Concerns|Next up|Selection assessments|Selection|Needs you|Later this week)$/)
      .map((t) => String(t.props.children));
  }

  const ROUND = {
    id: 'r1',
    name: '2027 selection phase',
    status: 'open',
    opens_on: '2026-10-01',
    closes_on: '2026-10-30',
    athlete_count: 14,
    is_head: false,
  };

  it('a parent confirming who they are comes before everything', async () => {
    await openScreen(
      { ...personas.guardian, profile: { ...personas.guardian.profile!, verified_at: null } },
      { index: Today },
      '/',
      {},
      { rpcs: { my_verification_code: '654321' } },
    );
    expect(order()).toEqual(['Confirm who you are', 'Next up', 'Needs you']);
  });

  it('safeguarding work comes before the calendar', async () => {
    await openToday('admin', [], { check_ins: [] });
    expect(order().slice(0, 2)).toEqual(['Concerns', 'Next up']);
  });

  it('a selection round that is running sits with what needs the panel, under what is next', async () => {
    setClubFeatures({ selectionAssessments: true });
    await openScreen('coach', { index: Today }, '/', {}, { rpcs: { my_selection_rounds: [ROUND] } });
    expect(order().slice(0, 2)).toEqual(['Next up', 'Selection assessments']);
    expect(screen.getByTestId('needs-you')).toBeTruthy();
  });
});
