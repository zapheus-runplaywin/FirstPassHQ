/**
 * Session logs beside check-ins (customer review R10, section 4 "Training
 * sessions" of docs/user-guide.md): an athlete logs each session's minutes
 * and how hard it felt (1 to 10) from the check-in screen, saved through
 * `save_session_log`, and can change or delete one. Load is minutes times
 * effort, totalled for each of the last four weeks. Coaches and guardians
 * see an athlete's sessions on the athlete's check-ins page; which sessions
 * come back is the database's rule (the same as check-ins), so the tests seed
 * what it would return.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import CheckInScreen from '@/app/check-in';
import { dayLabel } from '@/components/session-log';
import AthleteCheckInsScreen from '@/app/check-ins/athlete/[id]';
import type { SessionLog } from '@/lib/types';

import { argsOf, clearCalls, field, isSelected, recordTable, rpcNames, type } from './helpers/forms';
import {
  morePersonas,
  openScreen,
  resetClub,
  settle,
  type BackendOptions,
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

let back: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
});
afterEach(() => back.mockRestore());

function session(day: string, minutes: number, rpe: number, extra: Partial<SessionLog> = {}): SessionLog {
  return {
    id: `s-${day}-${minutes}`,
    athlete_id: 'athlete',
    day,
    kind: 'training',
    minutes,
    rpe,
    updated_at: `${day}T08:00:00Z`,
    ...extra,
  };
}

let sessions: ReturnType<typeof recordTable>;

async function open(who: Who = 'athlete', rows: SessionLog[] = [], options: BackendOptions = {}) {
  sessions = recordTable(() => rows);
  await openScreen(who, { 'check-in': CheckInScreen }, '/check-in', {}, {
    ...options,
    tableHandlers: { session_logs: sessions.handler, ...options.tableHandlers },
  });
}

async function press(text: string) {
  await fireEvent.press(screen.getByText(text));
  await settle();
}

describe('an athlete’s training sessions', () => {
  it('asks only for the athlete’s own last four weeks', async () => {
    await open();
    const [filters] = sessions.queries;
    expect(filters).toContainEqual({ method: 'eq', args: ['athlete_id', 'athlete'] });
    expect(filters).toContainEqual({ method: 'gte', args: ['day', '2026-09-20'] });
    expect(screen.getByText('Training sessions')).toBeTruthy();
  });

  it('shows four weeks with no sessions, and nothing to compare', async () => {
    await open();
    expect(screen.getByText('Last 7 days')).toBeTruthy();
    expect(screen.getAllByText('No sessions')).toHaveLength(4);
    expect(screen.queryByText(/on the (week|\d weeks) before/)).toBeNull();
    expect(screen.queryByText('Tap a session to change or delete it.')).toBeNull();
  });

  it('totals each week and compares this week with the weeks before', async () => {
    await open('athlete', [
      session('2026-10-18', 90, 6),
      session('2026-10-15', 60, 5, { kind: 'game' }),
      session('2026-10-09', 60, 5),
    ]);
    expect(screen.getByText('2 sessions · 150 min · load 840')).toBeTruthy();
    expect(screen.getByText('1 session · 60 min · load 300')).toBeTruthy();
    expect(screen.getByText('Up 180% on the week before')).toBeTruthy();
    expect(screen.getByText('Training · 90 min · effort 6 · load 540')).toBeTruthy();
    expect(screen.getByText('Game · 60 min · effort 5 · load 300')).toBeTruthy();
  });

  it('tells an adult their coaches see them and teammates never do', async () => {
    await open('athlete');
    expect(screen.getByText(/Your coaches see them\. Your teammates never do\./)).toBeTruthy();
    expect(screen.queryByText(/once a parent or guardian agrees\. Your teammates/)).toBeNull();
  });

  it.each<[string, Who]>([
    ['by date of birth', morePersonas.under18Athlete],
    ['born 2011', 'minorAthlete'],
  ])('tells an under 18 (%s) their parents see them, and coaches once a parent agrees', async (_l, who) => {
    await open(who);
    expect(
      screen.getByText(
        /Your parents or guardians see them, and your coaches once a parent or guardian agrees\. Your teammates never do\./,
      ),
    ).toBeTruthy();
  });
});

describe('logging a session', () => {
  it('starts on today’s training, offering today and the past week', async () => {
    await open();
    await press('Log a session');
    expect(isSelected('Today')).toBe(true);
    expect(isSelected('Training')).toBe(true);
    expect(field('Minutes').props.value).toBe('');
    expect(field('Minutes').props.maxLength).toBe(3);
    expect(field('Minutes').props.keyboardType).toBe('number-pad');
    for (const kind of ['Game', 'Gym', 'Other']) expect(screen.getByText(kind)).toBeTruthy();
    expect(screen.getByLabelText('Effort 1: Very easy')).toBeTruthy();
    expect(screen.getByLabelText('Effort 10: Maximal')).toBeTruthy();
  });

  it('needs the minutes and an effort before sending anything', async () => {
    await open();
    await press('Log a session');
    await press('Save session');
    expect(screen.getByText('Enter the minutes, from 1 to 300.')).toBeTruthy();
    await type('Minutes', '400');
    await press('Save session');
    expect(screen.getByText('Enter the minutes, from 1 to 300.')).toBeTruthy();
    await type('Minutes', '60');
    await press('Save session');
    expect(screen.getByText('Choose how hard it felt, from 1 to 10.')).toBeTruthy();
    expect(rpcNames()).not.toContain('save_session_log');
  });

  it('saves a session, then closes the form and reloads, staying on the check-in', async () => {
    await open();
    await press('Log a session');
    await press('Game');
    await type('Minutes', ' 75 ');
    await fireEvent.press(screen.getByLabelText('Effort 8: Very hard'));
    expect(screen.getByLabelText('Effort 8: Very hard').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByText('Very hard')).toBeTruthy();
    const loads = sessions.queries.length;
    await press('Save session');
    expect(argsOf('save_session_log')).toEqual([
      { p_id: null, p_day: '2026-10-18', p_kind: 'game', p_minutes: 75, p_rpe: 8 },
    ]);
    expect(sessions.queries.length).toBe(loads + 1);
    expect(screen.queryByText('Save session')).toBeNull();
    expect(screen.getByText('Log a session')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('logs a session for an earlier day, back to a week ago and no further', async () => {
    await open();
    await press('Log a session');
    expect(screen.getByText(dayLabel('2026-10-11'))).toBeTruthy();
    expect(screen.queryByText(dayLabel('2026-10-10'))).toBeNull();
    await fireEvent.press(screen.getByText(dayLabel('2026-10-11')));
    await fireEvent.press(screen.getByText('Gym'));
    await type('Minutes', '45');
    await fireEvent.press(screen.getByLabelText('Effort 4: Somewhat hard'));
    await press('Save session');
    expect(argsOf('save_session_log')[0]).toMatchObject({ p_day: '2026-10-11', p_kind: 'gym', p_minutes: 45, p_rpe: 4 });
  });

  it('shows the database’s refusal and keeps the form', async () => {
    await open('athlete', [], { rpcErrors: { save_session_log: 'You can log up to 6 sessions a day.' } });
    await press('Log a session');
    await type('Minutes', '30');
    await fireEvent.press(screen.getByLabelText('Effort 2: Easy'));
    await press('Save session');
    expect(screen.getByText('You can log up to 6 sessions a day.')).toBeTruthy();
    expect(screen.getByText('Save session')).toBeTruthy();
  });

  it('can cancel without saving', async () => {
    await open();
    await press('Log a session');
    await type('Minutes', '30');
    await press('Cancel');
    expect(screen.queryByText('Save session')).toBeNull();
    expect(rpcNames()).not.toContain('save_session_log');
  });
});

describe('changing a session', () => {
  const logged = session('2026-10-16', 90, 6, { id: 'logged', kind: 'game' });

  it('fills the form from the session tapped, and saves it as an update', async () => {
    await open('athlete', [logged]);
    expect(screen.getByText('Tap a session to change or delete it.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Change .*Game · 90 min · effort 6 · load 540$/));
    await settle();
    expect(field('Minutes').props.value).toBe('90');
    expect(isSelected('Game')).toBe(true);
    expect(screen.getByLabelText('Effort 6: Hard').props.accessibilityState).toEqual({ selected: true });
    await type('Minutes', '80');
    await press('Update session');
    expect(argsOf('save_session_log')).toEqual([
      { p_id: 'logged', p_day: '2026-10-16', p_kind: 'game', p_minutes: 80, p_rpe: 6 },
    ]);
  });

  it('keeps an older session’s own day among the choices', async () => {
    await open('athlete', [session('2026-09-25', 30, 3, { id: 'old' })]);
    await fireEvent.press(screen.getByLabelText(/^Change .*Training · 30 min/));
    await settle();
    await press('Update session');
    expect(argsOf('save_session_log')[0]).toMatchObject({ p_id: 'old', p_day: '2026-09-25' });
  });

  it('deletes a session', async () => {
    await open('athlete', [logged]);
    await fireEvent.press(screen.getByLabelText(/^Change .*Game · 90 min/));
    await settle();
    await press('Delete session');
    expect(argsOf('delete_session_log')).toEqual([{ p_id: 'logged' }]);
    expect(screen.queryByText('Update session')).toBeNull();
  });

  it('shows a refused delete', async () => {
    await open('athlete', [logged], { rpcErrors: { delete_session_log: 'Session not found.' } });
    await fireEvent.press(screen.getByLabelText(/^Change .*Game · 90 min/));
    await settle();
    await press('Delete session');
    expect(screen.getByText('Session not found.')).toBeTruthy();
    expect(screen.getByText('Update session')).toBeTruthy();
  });

  it('offers no delete for a new session', async () => {
    await open('athlete', [logged]);
    await press('Log a session');
    expect(screen.queryByText('Delete session')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// An athlete's check-ins page, for their coaches and guardians

async function openAthlete(who: Who, rows: SessionLog[]) {
  sessions = recordTable(() => rows);
  await openScreen(
    who,
    { 'check-ins/athlete/[id]': AthleteCheckInsScreen },
    '/check-ins/athlete/child-1?name=Sample%20Child',
    {},
    { tableHandlers: { session_logs: sessions.handler } },
  );
}

describe('one athlete’s training sessions', () => {
  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['guardian', 'guardian'],
  ])('shows a %s the weekly load and each session the database returns, read only', async (_l, who) => {
    await openAthlete(who, [session('2026-10-18', 90, 6), session('2026-10-10', 60, 5)]);
    expect(screen.getByText('Training sessions')).toBeTruthy();
    expect(screen.getByText('1 session · 90 min · load 540')).toBeTruthy();
    expect(screen.getByText('Up 80% on the week before')).toBeTruthy();
    expect(screen.getByText('Training · 90 min · effort 6 · load 540')).toBeTruthy();
    expect(screen.queryByLabelText(/^Change /)).toBeNull();
    expect(screen.queryByText('Log a session')).toBeNull();
  });

  it('asks only for this athlete’s last 28 days', async () => {
    await openAthlete('coach', []);
    const [filters] = sessions.queries;
    expect(filters).toContainEqual({ method: 'eq', args: ['athlete_id', 'child-1'] });
    expect(filters).toContainEqual({ method: 'gte', args: ['day', '2026-09-20'] });
    expect(screen.getByText('No sessions logged.')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['committee member', 'committee'],
    ['physio', 'physio'],
    ['admin', 'admin'],
  ])('shows a %s no sessions when the database returns none', async (_l, who) => {
    await openAthlete(who, []);
    expect(screen.getByText('No sessions logged.')).toBeTruthy();
    expect(screen.getAllByText('No sessions')).toHaveLength(4);
  });
});
