/**
 * An athlete's daily check-in (src/app/check-in.tsx), from "Daily check-in"
 * in section 4 of docs/user-guide.md: four questions scored 1 to 5 and an
 * optional note, saved through `save_check_in`. Today's check-in fills the
 * form so it can be changed. An athlete under 18 is told their coaches see
 * it only once a parent or guardian agrees, and that their parents can read
 * the note.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import CheckInScreen from '@/app/check-in';
import type { CheckIn } from '@/lib/types';

import { argsOf, clearCalls, field, recordTable, rpcNames, type } from './helpers/forms';
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

let back: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
});
afterEach(() => back.mockRestore());

function checkIn(day: string, extra: Partial<CheckIn> = {}): CheckIn {
  return {
    id: `ci-${day}`,
    athlete_id: 'athlete',
    day,
    sleep: 4,
    soreness: 2,
    stress: 3,
    mood: 5,
    note: null,
    updated_at: `${day}T07:00:00Z`,
    ...extra,
  } as CheckIn;
}

let checkIns: ReturnType<typeof recordTable>;

async function open(who: PersonaName | Persona = 'athlete', history: CheckIn[] = [], options: BackendOptions = {}) {
  checkIns = recordTable(() => history);
  await openScreen(who, { 'check-in': CheckInScreen }, '/check-in', {}, {
    ...options,
    tableHandlers: { check_ins: checkIns.handler, ...options.tableHandlers },
  });
}

function answerAll(scores: [number, number, number, number]) {
  const [sleep, soreness, stress, mood] = scores;
  const questions = [
    ['Very poorly', 'Poorly', 'OK', 'Well', 'Really well'],
    ['Very sore', 'Sore', 'A little sore', 'Fine', 'Fresh'],
    ['Very stressed', 'Stressed', 'Normal', 'Relaxed', 'Very relaxed'],
    ['Very low', 'Low', 'OK', 'Good', 'Great'],
  ];
  [sleep, soreness, stress, mood].forEach((score, i) => {
    // Two questions share "OK", so press by position within each scale.
    const label = `${score}: ${questions[i][score - 1]}`;
    const buttons = screen.getAllByLabelText(label);
    const nth = questions.slice(0, i).filter((q) => q[score - 1] === questions[i][score - 1]).length;
    fireEvent.press(buttons[nth]);
  });
}

async function save(title = 'Save check-in') {
  fireEvent.press(screen.getByText(title));
  await settle();
}

describe('a new check-in', () => {
  it('loads only the athlete’s own last two weeks', async () => {
    await open();
    const [filters] = checkIns.queries;
    expect(filters).toContainEqual({ method: 'eq', args: ['athlete_id', 'athlete'] });
    expect(filters).toContainEqual({ method: 'gte', args: ['day', '2026-10-04'] });
    expect(screen.getByText('No check-ins yet.')).toBeTruthy();
  });

  it('needs all four questions answered, and sends nothing until they are', async () => {
    await open();
    fireEvent.press(screen.getAllByLabelText('3: OK')[0]);
    fireEvent.press(screen.getByLabelText('5: Fresh'));
    fireEvent.press(screen.getByLabelText('2: Stressed'));
    await save();
    expect(screen.getByText('Answer all four questions.')).toBeTruthy();
    expect(rpcNames()).not.toContain('save_check_in');
    expect(back).not.toHaveBeenCalled();
  });

  it('saves today’s scores and note, then goes back', async () => {
    await open();
    answerAll([4, 2, 3, 5]);
    expect(screen.getByLabelText('4: Well').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByLabelText('5: Really well').props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByText('Well')).toBeTruthy();
    type('Anything your coach should know? (optional)', 'Tight calves after Sunday');
    await save();
    expect(argsOf('save_check_in')).toEqual([
      {
        p_day: '2026-10-18',
        p_sleep: 4,
        p_soreness: 2,
        p_stress: 3,
        p_mood: 5,
        p_note: 'Tight calves after Sunday',
      },
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('sends an empty note when there is none', async () => {
    await open();
    answerAll([1, 1, 1, 1]);
    await save();
    expect(argsOf('save_check_in')[0]).toMatchObject({ p_note: '' });
  });

  it('shows the database’s error and stays on the form', async () => {
    await open('athlete', [], { rpcErrors: { save_check_in: 'Check-ins are only for athletes.' } });
    answerAll([3, 3, 3, 3]);
    await save();
    expect(screen.getByText('Check-ins are only for athletes.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });
});

describe('today’s check-in already saved', () => {
  const todays = checkIn('2026-10-18', { sleep: 2, soreness: 4, stress: 4, mood: 4, note: 'Slept badly' });

  it('fills the form so it can be changed, and saves it as an update', async () => {
    await open('athlete', [todays, checkIn('2026-10-16')]);
    expect(screen.getByText('Update check-in')).toBeTruthy();
    expect(field('Anything your coach should know? (optional)').props.value).toBe('Slept badly');
    fireEvent.press(screen.getByLabelText('5: Really well'));
    await save('Update check-in');
    expect(argsOf('save_check_in')).toEqual([
      { p_day: '2026-10-18', p_sleep: 5, p_soreness: 4, p_stress: 4, p_mood: 4, p_note: 'Slept badly' },
    ]);
  });

  it('can clear the note', async () => {
    await open('athlete', [todays]);
    type('Anything your coach should know? (optional)', '');
    await save('Update check-in');
    expect(argsOf('save_check_in')[0]).toMatchObject({ p_note: '' });
  });

  it('lists the last two weeks, calling out low scores', async () => {
    await open('athlete', [todays, checkIn('2026-10-16', { note: 'Fine' })]);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Low sleep')).toBeTruthy();
    expect(screen.getByText('Low soreness')).toBeTruthy();
    expect(screen.getByText('Sleep 2 · Soreness 4 · Stress 4 · Mood 4')).toBeTruthy();
    expect(screen.getByText('“Fine”')).toBeTruthy();
  });

  it('a check-in from an earlier day doesn’t fill today’s form', async () => {
    await open('athlete', [checkIn('2026-10-17', { note: 'Yesterday' })]);
    expect(screen.getByText('Save check-in')).toBeTruthy();
    expect(field('Anything your coach should know? (optional)').props.value).toBe('');
  });
});

describe('who sees it', () => {
  it('tells an adult athlete their coaches read the note', async () => {
    await open('athlete');
    expect(screen.getByText('Your coaches can read this note.')).toBeTruthy();
    expect(screen.queryByText(/once a parent or guardian agrees/)).toBeNull();
  });

  it.each<[string, PersonaName | Persona]>([
    ['by date of birth', morePersonas.under18Athlete],
    ['born 2011', 'minorAthlete'],
  ])('tells an athlete under 18 (%s) their parents read it, and coaches once a parent agrees', async (_l, who) => {
    await open(who);
    expect(
      screen.getByText(
        'Your parents or guardians can read this note, and your coaches once a parent or guardian agrees.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/As you’re under 18, they see them once a parent or guardian agrees\./)).toBeTruthy();
  });

  it('offers a safe way to raise a worry', async () => {
    await open('minorAthlete');
    expect(screen.getByText('Something worrying you? Tell the club safely')).toBeTruthy();
  });
});
