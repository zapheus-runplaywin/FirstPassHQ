/**
 * The daily check-in as a sheet over Today (src/components/check-in-sheet.tsx,
 * opened by the "Do your daily check-in" to-do in src/app/(tabs)/index.tsx),
 * from "Daily check-in" in section 4 of docs/user-guide.md: four taps, the
 * last answer saves through `save_check_in`, Today says "Check-in saved for
 * today" with Change, and the note, the last two weeks and the training log
 * stay on the full page (src/app/check-in.tsx), one tap away with the answers
 * given so far. Who sees the answers is said on the sheet, and is unchanged.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen, within } from 'expo-router/testing-library';

import TodayScreen from '@/app/(tabs)/index';
import CheckInScreen from '@/app/check-in';
import { CHECK_IN_SAVED_MS } from '@/components/home/today';
import type { CheckIn } from '@/lib/types';

import { argsOf, clearCalls, field, rpcNames } from './helpers/forms';
import {
  inTabs,
  morePersonas,
  openScreen,
  resetClub,
  setClubFeatures,
  settle,
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

const Today = inTabs(TodayScreen);
const TODO = 'Do your daily check-in';

let push: jest.SpyInstance;
/** Today's check-in as the database holds it: none until the sheet saves. */
let stored: CheckIn | null;

beforeEach(() => {
  resetClub();
  clearCalls();
  stored = null;
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
});
afterEach(() => {
  push.mockRestore();
  jest.useRealTimers();
});

function checkIn(extra: Partial<CheckIn> = {}): CheckIn {
  return {
    id: 'ci-today',
    athlete_id: 'athlete',
    day: '2026-10-18',
    sleep: 4,
    soreness: 2,
    stress: 3,
    mood: 5,
    note: null,
    updated_at: '2026-10-18T07:00:00Z',
    ...extra,
  } as CheckIn;
}

/** Today for `who`, on a backend that keeps what `save_check_in` saves. */
async function openToday(who: PersonaName | Persona = 'athlete', options: BackendOptions = {}) {
  await openScreen(who, { index: Today }, '/', {}, {
    ...options,
    tableHandlers: { check_ins: () => (stored ? [stored] : []), ...options.tableHandlers },
    rpcHandlers: {
      save_check_in: (args) => {
        const a = args as Record<string, unknown>;
        stored = checkIn({
          sleep: a.p_sleep as number,
          soreness: a.p_soreness as number,
          stress: a.p_stress as number,
          mood: a.p_mood as number,
          note: (a.p_note as string) || null,
        });
        return stored.id;
      },
      ...options.rpcHandlers,
    },
  });
}

async function openSheet() {
  await fireEvent.press(screen.getByText(TODO));
  await settle();
  return within(screen.getByTestId('check-in-sheet'));
}

const sheet = () => within(screen.getByTestId('check-in-sheet'));

const QUESTIONS = [
  ['Very poorly', 'Poorly', 'OK', 'Well', 'Really well'],
  ['Very sore', 'Sore', 'A little sore', 'Fine', 'Fresh'],
  ['Very stressed', 'Stressed', 'Normal', 'Relaxed', 'Very relaxed'],
  ['Very low', 'Low', 'OK', 'Good', 'Great'],
];

/** Taps `score` on question `i` (0 is sleep): two questions share "OK", so by position. */
async function tap(i: number, score: number) {
  const label = `${score}: ${QUESTIONS[i][score - 1]}`;
  const nth = QUESTIONS.slice(0, i).filter((q) => q[score - 1] === QUESTIONS[i][score - 1]).length;
  await fireEvent.press(sheet().getAllByLabelText(label)[nth]);
  await settle();
}

const progress = () => String(sheet().getByTestId('check-in-progress').props.children.join(''));
const status = () => sheet().getByTestId('check-in-status').props.children as string;

describe('opening it', () => {
  it('opens over Today from the to-do, without leaving Today', async () => {
    await openToday();
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
    const view = await openSheet();
    expect(push).not.toHaveBeenCalled();
    expect(view.getByText('Daily check-in')).toBeTruthy();
    expect(progress()).toBe('0 of 4');
    expect(status()).toBe('Saves when you answer the last one.');
    for (const question of ['How did you sleep?', 'How does your body feel?', 'How stressed are you?', 'How’s your mood?']) {
      expect(view.getByText(question)).toBeTruthy();
    }
    // Nothing to press to save, and nothing to finish with.
    expect(view.queryByText('Save check-in')).toBeNull();
    expect(view.queryByText('Done')).toBeNull();
    // Today is still underneath.
    expect(screen.getByText(TODO)).toBeTruthy();
  });

  it('checks again for a check-in done somewhere else as it opens', async () => {
    await openToday();
    clearCalls();
    stored = checkIn({ note: 'From my other phone' });
    await openSheet();
    // It was done on another phone: the sheet's save keeps that note.
    await tap(0, 5);
    await tap(1, 5);
    await tap(2, 5);
    await tap(3, 5);
    expect(argsOf('save_check_in')[0]).toMatchObject({ p_note: 'From my other phone' });
  });

  it.each(['Close', 'backdrop'])('closes by %s and saves nothing', async (how) => {
    await openToday();
    await openSheet();
    await tap(0, 4);
    await tap(1, 2);
    await fireEvent.press(
      how === 'Close' ? sheet().getByLabelText('Close') : screen.getByTestId('check-in-backdrop', { includeHiddenElements: true }),
    );
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
    expect(rpcNames()).not.toContain('save_check_in');
    expect(screen.getByText(TODO)).toBeTruthy();
    expect(screen.queryByTestId('check-in-saved')).toBeNull();
    // Opened again, it starts fresh.
    await openSheet();
    expect(progress()).toBe('0 of 4');
  });

  it('has no to-do, and so no sheet, when check-ins are off', async () => {
    setClubFeatures({ checkIns: false });
    await openToday();
    expect(screen.queryByText(TODO)).toBeNull();
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
  });

  it.each<PersonaName>(['coach', 'guardian', 'manager', 'physio', 'committee', 'admin', 'guest', 'statistician'])(
    'a %s has no daily check-in to do',
    async (who) => {
      await openToday(who);
      expect(screen.queryByText(TODO)).toBeNull();
      expect(rpcNames()).not.toContain('save_check_in');
    },
  );
});

describe('four taps', () => {
  it('says each answer in words, counts them, and sends nothing until the last', async () => {
    await openToday();
    const view = await openSheet();
    await tap(0, 4);
    expect(view.getByText('Well')).toBeTruthy();
    expect(view.getByLabelText('4: Well').props.accessibilityState).toMatchObject({ selected: true });
    expect(progress()).toBe('1 of 4');
    await tap(1, 2);
    expect(view.getByText('Sore')).toBeTruthy();
    await tap(2, 3);
    expect(progress()).toBe('3 of 4');
    // Changing one already given doesn't finish it.
    await tap(0, 5);
    expect(progress()).toBe('3 of 4');
    expect(rpcNames()).not.toContain('save_check_in');
    expect(screen.getByTestId('check-in-sheet')).toBeTruthy();
  });

  it('saves on the last answer, closes, and Today says so with nothing left to do', async () => {
    await openToday();
    await openSheet();
    await tap(0, 4);
    await tap(1, 2);
    await tap(2, 3);
    await tap(3, 5);
    expect(argsOf('save_check_in')).toEqual([
      { p_day: '2026-10-18', p_sleep: 4, p_soreness: 2, p_stress: 3, p_mood: 5, p_note: '' },
    ]);
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
    expect(push).not.toHaveBeenCalled();
    // The to-do is gone, and Today says the check-in is saved.
    expect(screen.queryByText(TODO)).toBeNull();
    const saved = within(screen.getByTestId('check-in-saved'));
    expect(saved.getByText('Check-in saved for today')).toBeTruthy();
    expect(saved.getByText('Change')).toBeTruthy();
    expect(screen.getByTestId('all-done')).toBeTruthy();
  });

  it('saves whichever question is answered last', async () => {
    await openToday();
    await openSheet();
    await tap(3, 1);
    await tap(1, 1);
    await tap(2, 1);
    expect(rpcNames()).not.toContain('save_check_in');
    await tap(0, 1);
    expect(argsOf('save_check_in')).toEqual([
      { p_day: '2026-10-18', p_sleep: 1, p_soreness: 1, p_stress: 1, p_mood: 1, p_note: '' },
    ]);
  });

  it('shows the database’s refusal, stays open, and Try again sends it again', async () => {
    await openToday('athlete', { rpcErrors: { save_check_in: 'You can only check in for today.' } });
    const view = await openSheet();
    await tap(0, 3);
    await tap(1, 3);
    await tap(2, 3);
    await tap(3, 3);
    expect(view.getByText('You can only check in for today.')).toBeTruthy();
    expect(screen.getByTestId('check-in-sheet')).toBeTruthy();
    expect(screen.queryByTestId('check-in-saved')).toBeNull();
    expect(screen.getByText(TODO)).toBeTruthy();
    await fireEvent.press(view.getByText('Try again'));
    await settle();
    expect(argsOf('save_check_in')).toHaveLength(2);
    expect(argsOf('save_check_in')[1]).toEqual(argsOf('save_check_in')[0]);
  });
});

describe('changing it afterwards', () => {
  async function saved() {
    await openToday();
    await openSheet();
    await tap(0, 4);
    await tap(1, 2);
    await tap(2, 3);
    await tap(3, 5);
  }

  it('Change opens it again with the answers given, and each tap saves the correction', async () => {
    await saved();
    await fireEvent.press(within(screen.getByTestId('check-in-saved')).getByText('Change'));
    await settle();
    const view = sheet();
    expect(progress()).toBe('4 of 4');
    expect(status()).toBe('Tap an answer to change it. Each change saves.');
    expect(view.getByLabelText('2: Sore').props.accessibilityState).toMatchObject({ selected: true });
    expect(view.getByLabelText('5: Great').props.accessibilityState).toMatchObject({ selected: true });

    await tap(1, 4);
    expect(argsOf('save_check_in')).toHaveLength(2);
    expect(argsOf('save_check_in')[1]).toEqual({
      p_day: '2026-10-18',
      p_sleep: 4,
      p_soreness: 4,
      p_stress: 3,
      p_mood: 5,
      p_note: '',
    });
    // It stays open for another correction, and says it saved.
    expect(status()).toBe('Saved.');
    await tap(3, 4);
    expect(argsOf('save_check_in')[2]).toMatchObject({ p_soreness: 4, p_mood: 4 });

    await fireEvent.press(view.getByText('Done'));
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
    expect(screen.getByTestId('check-in-saved')).toBeTruthy();
  });

  it('never removes the check-in: there is no undo that deletes it', async () => {
    await saved();
    expect(screen.queryByText('Undo')).toBeNull();
    expect(stored).not.toBeNull();
  });

  it('stops saying so after a few seconds, and the check-in stays done', async () => {
    jest.useFakeTimers();
    await saved();
    expect(screen.getByTestId('check-in-saved')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(CHECK_IN_SAVED_MS - 1);
    });
    expect(screen.getByTestId('check-in-saved')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('check-in-saved')).toBeNull();
    expect(screen.queryByText(TODO)).toBeNull();
  });
});

describe('the note, the last two weeks and the training log', () => {
  it('Add a note opens the full check-in with the answers given so far', async () => {
    await openToday();
    const view = await openSheet();
    await tap(0, 4);
    await tap(2, 1);
    await fireEvent.press(view.getByText('Add a note'));
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
    expect(push).toHaveBeenCalledWith({ pathname: '/check-in', params: { sleep: '4', stress: '1' } });
    expect(rpcNames()).not.toContain('save_check_in');
  });

  it('Last two weeks opens the full check-in too', async () => {
    await openToday();
    const view = await openSheet();
    await fireEvent.press(view.getByText('Last two weeks'));
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
    expect(push).toHaveBeenCalledWith({ pathname: '/check-in', params: {} });
  });

  it('the full check-in starts from those answers, and saves them with the note', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    await openScreen('athlete', { 'check-in': CheckInScreen }, '/check-in?sleep=4&stress=1', { check_ins: [] });
    expect(screen.getByLabelText('4: Well').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('1: Very stressed').props.accessibilityState).toMatchObject({ selected: true });
    // The two not answered yet are still to do.
    await fireEvent.press(screen.getByText('Save check-in'));
    await settle();
    expect(screen.getByText('Answer all four questions.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('5: Fresh'));
    // Sleep and mood both have "OK": the second is mood.
    await fireEvent.press(screen.getAllByLabelText('3: OK')[1]);
    await fireEvent.changeText(field('Anything your coach should know? (optional)'), 'Tight calves');
    await fireEvent.press(screen.getByText('Save check-in'));
    await settle();
    expect(argsOf('save_check_in')).toEqual([
      { p_day: '2026-10-18', p_sleep: 4, p_soreness: 5, p_stress: 1, p_mood: 3, p_note: 'Tight calves' },
    ]);
    back.mockRestore();
  });

  it.each([
    ['sleep=9&stress=0', 'out of range'],
    ['sleep=4.5&mood=abc', 'not whole numbers'],
    ['sleep=&soreness=%204', 'blank or padded'],
  ])('the full check-in ignores answers in its link that are %s (%s)', async (query) => {
    await openScreen('athlete', { 'check-in': CheckInScreen }, `/check-in?${query}`, { check_ins: [] });
    for (const label of ['4: Well', '5: Really well', '1: Very poorly', '4: Fine', '1: Very stressed']) {
      expect(screen.getByLabelText(label).props.accessibilityState).toMatchObject({ selected: false });
    }
  });

  it('keeps a note already saved today when an answer is changed on the sheet', async () => {
    stored = null;
    await openToday();
    await openSheet();
    await tap(0, 4);
    await tap(1, 2);
    await tap(2, 3);
    await tap(3, 5);
    // A note was added from another phone since.
    stored = checkIn({ note: 'Slept badly' });
    await fireEvent.press(within(screen.getByTestId('check-in-saved')).getByText('Change'));
    await settle();
    expect(sheet().getByText('Change your note')).toBeTruthy();
    await tap(0, 1);
    const saves = argsOf('save_check_in');
    expect(saves[saves.length - 1]).toMatchObject({ p_sleep: 1, p_note: 'Slept badly' });
    expect(stored?.note).toBe('Slept badly');
  });
});

describe('something worrying you', () => {
  it('raises a concern from the sheet, as from the full check-in, and closes the sheet', async () => {
    await openToday();
    const view = await openSheet();
    await tap(0, 1);
    await fireEvent.press(view.getByText('Something worrying you? Tell the club safely'));
    expect(push).toHaveBeenCalledWith({ pathname: '/concern/new', params: { context: 'Daily check-in' } });
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
    expect(rpcNames()).not.toContain('save_check_in');
  });
});

describe('who sees it', () => {
  it('tells an adult athlete their coaches see the answers', async () => {
    await openToday();
    const view = await openSheet();
    expect(
      view.getByText(
        'Your coaches see your answers so they can adjust training, and a low score lets them know to check in with you.',
      ),
    ).toBeTruthy();
    expect(view.queryByText(/once a parent or guardian agrees/)).toBeNull();
  });

  it.each<[string, PersonaName | Persona]>([
    ['by date of birth', morePersonas.under18Athlete],
    ['born 2011', 'minorAthlete'],
  ])('tells an athlete under 18 (%s) their coaches see them once a parent agrees', async (_label, who) => {
    await openToday(who);
    const view = await openSheet();
    expect(
      view.getByText(
        'Your coaches see your answers so they can adjust training, and a low score lets them know to check in with you. As you’re under 18, they see them once a parent or guardian agrees.',
      ),
    ).toBeTruthy();
  });
});
