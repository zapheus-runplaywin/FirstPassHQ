/**
 * Injuries logged by staff, physio updates and the concussion pathway, from
 * "Logging an injury", "Physio updates" and "Concussion" in docs/user-guide.md
 * (sections 5 to 8 and 12).
 *
 * Coaches, managers and physios log an injury for one of their athletes when
 * it happens (src/app/injuries/log.tsx); the database (`log_injury`) decides
 * which athletes. The athlete and their parents or guardians then get a to-do
 * until they open it. A physio adds updates themselves, and only a physio can
 * rule a concussion out. After a concussion, clearance waits for the club's
 * minimum days and needs a doctor's clearance, and only a physio endorses it.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import InjuriesScreen from '@/app/injuries/index';
import InjuryScreen from '@/app/injuries/[id]';
import LogInjuryScreen from '@/app/injuries/log';
import { formatDateString } from '@/lib/injuries';
import type { Injury, InjuryUpdate } from '@/lib/types';

import { argsOf, clearCalls, field, isSelected, rpcNames, type } from './helpers/forms';
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

beforeEach(() => {
  resetClub();
  clearCalls();
});

function injury(extra: Partial<Injury> = {}): Injury {
  return {
    id: 'inj-1',
    athlete_id: 'child-1',
    athlete_name: 'Sample Child',
    body_area: 'Head',
    description: 'Knock to the head in a contest',
    injured_on: '2026-10-10',
    restrictions: null,
    expected_return: '2026-10-31',
    status: 'injured',
    coach_endorsed_by: null,
    cleared_at: null,
    created_at: '2026-10-10T08:00:00Z',
    last_update_at: null,
    can_report: false,
    waiting_for_me: false,
    concussion: false,
    earliest_clearance: null,
    needs_physio: false,
    can_update: false,
    logged_by_role: null,
    ...extra,
  };
}

function update(extra: Partial<InjuryUpdate> = {}): InjuryUpdate {
  return {
    id: 'upd-1',
    author_name: 'Sample coach',
    author_role: null,
    kind: 'reported',
    notes: 'Fell at training',
    restrictions: null,
    expected_return: null,
    concussion: null,
    doctor_clearance: false,
    document_path: null,
    document_name: null,
    document_removed_at: null,
    created_at: '2026-10-10T08:00:00Z',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The injuries list

async function openList(who: Who) {
  await openScreen(who, { 'injuries/index': InjuriesScreen, 'injuries/log': LogInjuryScreen }, '/injuries', {}, {
    rpcs: { visible_injuries: [] },
  });
}

describe('Log an injury on the injuries list', () => {
  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['assistant coach', morePersonas.assistantCoach],
    ['manager', 'manager'],
    ['physio', 'physio'],
    ['Head Physio', morePersonas.headPhysio],
    ['athlete who also coaches', morePersonas.athleteCoach],
    ['coach who is also a guardian', morePersonas.coachGuardian],
  ])('is offered to a %s', async (_label, who) => {
    await openList(who);
    await fireEvent.press(screen.getByText('Log an injury'));
    expect(screen).toHavePathname('/injuries/log');
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['guardian', 'guardian'],
    ['committee', 'committee'],
    ['admin', 'admin'],
  ])('isn’t offered to a %s', async (_label, who) => {
    await openList(who);
    expect(screen.queryByText('Log an injury')).toBeNull();
  });

  it('tells a manager they log injuries but don’t see the records', async () => {
    await openList('manager');
    expect(screen.getByText(/Managers don’t see injury records\.$/)).toBeTruthy();
  });

  it('doesn’t tell a coach that, as coaches see their athletes’ records', async () => {
    await openList('coach');
    expect(screen.queryByText(/Managers don’t see injury records/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Logging an injury

const ATHLETES = [
  { athlete_id: 'athlete', athlete_name: 'Sample athlete', logged_as: 'coach' },
  { athlete_id: 'child-1', athlete_name: 'Sample Child', logged_as: 'coach' },
];

async function openLog(who: Who, athletes: unknown[] = ATHLETES, options: BackendOptions = {}) {
  await openScreen(who, { 'injuries/log': LogInjuryScreen }, '/injuries/log', {}, {
    ...options,
    rpcs: { injury_loggable_athletes: athletes, ...options.rpcs },
  });
}

async function fillLog() {
  await type('Where is the injury?', 'Right knee');
  await type('What happened?', 'Landed awkwardly, iced on the bench');
}

describe('logging an injury', () => {
  it('needs an athlete chosen when there is more than one', async () => {
    await openLog('coach');
    await fillLog();
    await fireEvent.press(screen.getByText('Log injury'));
    await settle();
    expect(screen.getByText('Choose which athlete is injured.')).toBeTruthy();
    expect(rpcNames()).not.toContain('log_injury');
  });

  it('needs where and what happened, but not an expected return', async () => {
    await openLog('coach');
    await fireEvent.press(screen.getByText('Sample Child'));
    await fireEvent.press(screen.getByText('Log injury'));
    await settle();
    expect(screen.getByText('Say where the injury is and what happened.')).toBeTruthy();
    await fillLog();
    await fireEvent.press(screen.getByText('Log injury'));
    await settle();
    expect(argsOf('log_injury')).toEqual([
      {
        p_athlete_id: 'child-1',
        p_body_area: 'Right knee',
        p_description: 'Landed awkwardly, iced on the bench',
        p_injured_on: '2026-10-18',
        p_restrictions: '',
        p_expected_return: null,
        p_concussion: false,
      },
    ]);
  });

  it('chooses the only athlete for them, and says who has been told', async () => {
    await openLog('manager', [ATHLETES[1]]);
    expect(isSelected('Sample Child')).toBe(true);
    await fillLog();
    await fireEvent(screen.getByLabelText('Possible concussion'), 'valueChange', true);
    expect(screen.getByText(/^If in doubt, sit them out\./)).toBeTruthy();
    await fireEvent.press(screen.getByText('Log injury'));
    await settle();
    expect(argsOf('log_injury')[0]).toMatchObject({ p_athlete_id: 'child-1', p_concussion: true });
    expect(screen.getByText('Injury logged')).toBeTruthy();
    expect(screen.getByText(/^Sample Child and their parents or guardians have been told\./)).toBeTruthy();
  });

  it('can log another, starting afresh', async () => {
    await openLog('physio');
    await fireEvent.press(screen.getByText('Sample athlete'));
    await fillLog();
    await fireEvent.press(screen.getByText('Log injury'));
    await settle();
    await fireEvent.press(screen.getByText('Log another'));
    expect(isSelected('Sample athlete')).toBe(false);
    expect(field('Where is the injury?').props.value).toBe('');
  });

  it('shows what the database refuses', async () => {
    await openLog('coach', ATHLETES, {
      rpcErrors: { log_injury: 'Only the athlete’s coaches, managers and physios can log an injury for them' },
    });
    await fireEvent.press(screen.getByText('Sample Child'));
    await fillLog();
    await fireEvent.press(screen.getByText('Log injury'));
    await settle();
    expect(
      screen.getByText('Only the athlete’s coaches, managers and physios can log an injury for them'),
    ).toBeTruthy();
    expect(screen.queryByText('Injury logged')).toBeNull();
  });

  it('explains when they have no athletes to log for', async () => {
    await openLog('coach', []);
    expect(screen.getByText(/There aren’t any right now\.$/)).toBeTruthy();
    expect(screen.queryByText('Log injury')).toBeNull();
  });

  it('goes back when done', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    await openLog('coach', [ATHLETES[0]]);
    await fillLog();
    await fireEvent.press(screen.getByText('Log injury'));
    await settle();
    await fireEvent.press(screen.getByText('Done'));
    expect(back).toHaveBeenCalled();
    back.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// One injury

async function openInjury(who: Who, shown: Injury, updates: InjuryUpdate[] = []) {
  await openScreen(who, { 'injuries/[id]': InjuryScreen }, '/injuries/inj-1', { injury_updates: updates }, {
    rpcs: { visible_injuries: [shown], can_share_injury: false, injury_document_rule: 'photos' },
    rpcErrors: { injury_document_log: 'Only the athlete, their guardians and admins see who opened documents' },
  });
}

describe('an injury someone else logged', () => {
  it('clears the family’s to-do once the athlete or a guardian opens it', async () => {
    await openInjury('guardian', injury({ logged_by_role: 'coach', can_report: true, can_update: true }));
    expect(argsOf('mark_logged_injury_seen')).toEqual([{ p_injury_id: 'inj-1' }]);
  });

  it('doesn’t mark it seen for the coach who logged it, or one the family reported', async () => {
    await openInjury('coach', injury({ logged_by_role: 'coach' }));
    expect(rpcNames()).not.toContain('mark_logged_injury_seen');
    clearCalls();
    await openInjury('guardian', injury({ can_report: true, can_update: true }));
    expect(rpcNames()).not.toContain('mark_logged_injury_seen');
  });

  it('shows who logged it and their role in the history', async () => {
    await openInjury('guardian', injury({ logged_by_role: 'coach', can_report: true }), [
      update({ author_role: 'coach' }),
    ]);
    expect(screen.getByText('Logged the injury')).toBeTruthy();
    expect(screen.getByText('Sample coach (coach)')).toBeTruthy();
  });
});

describe('physio updates', () => {
  it('lets the athlete’s physio add an update, but not ask for clearance', async () => {
    await openInjury('physio', injury({ can_update: true }));
    expect(screen.getByText('Add physio update')).toBeTruthy();
    expect(screen.queryByText('Ask for clearance')).toBeNull();
  });

  it('gives a coach no update button', async () => {
    await openInjury('coach', injury());
    expect(screen.queryByText('Add physio update')).toBeNull();
  });

  it('lets a physio mark a possible concussion, sent once', async () => {
    await openInjury('physio', injury({ can_update: true }));
    await fireEvent.press(screen.getByText('Add physio update'));
    await type('What did the physio say?', 'Headache since the knock');
    await fireEvent(screen.getByLabelText('Possible concussion'), 'valueChange', true);
    await fireEvent.press(screen.getByText('Save update'));
    await settle();
    expect(argsOf('add_injury_update')[0]).toMatchObject({
      p_injury_id: 'inj-1',
      p_notes: 'Headache since the knock',
      p_concussion: true,
    });
  });

  it('sends no concussion change when the switch isn’t touched', async () => {
    await openInjury('athlete', injury({ athlete_id: 'athlete', can_report: true, can_update: true }));
    await fireEvent.press(screen.getByText('Add physio update'));
    await type('What did the physio say?', 'Two more weeks');
    await fireEvent.press(screen.getByText('Save update'));
    await settle();
    expect(argsOf('add_injury_update')[0]).toMatchObject({ p_concussion: null });
  });

  it('lets a physio rule a concussion out', async () => {
    await openInjury('physio', injury({ concussion: true, needs_physio: true, can_update: true }));
    await fireEvent.press(screen.getByText('Add physio update'));
    expect(screen.getByText(/^Still a possible concussion\./)).toBeTruthy();
    await type('What did the physio say?', 'Doctor ruled out concussion');
    await fireEvent(screen.getByLabelText('Possible concussion'), 'valueChange', false);
    await fireEvent.press(screen.getByText('Save update'));
    await settle();
    expect(argsOf('add_injury_update')[0]).toMatchObject({ p_concussion: false });
  });

  it('doesn’t let the athlete or a guardian rule a concussion out', async () => {
    await openInjury('guardian', injury({ concussion: true, can_report: true, can_update: true }));
    await fireEvent.press(screen.getByText('Add physio update'));
    expect(screen.queryByLabelText('Possible concussion')).toBeNull();
  });

  it.each([
    [true, 'Marked as a possible concussion'],
    [false, 'Concussion ruled out'],
  ])('titles an update that set concussion to %s', async (value, title) => {
    await openInjury('physio', injury(), [
      update({ kind: 'physio_update', concussion: value, author_name: 'Sample physio', author_role: 'physio' }),
    ]);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText('Sample physio (physio)')).toBeTruthy();
  });
});

describe('after a concussion', () => {
  const concussed = injury({
    concussion: true,
    needs_physio: true,
    earliest_clearance: '2026-10-31',
    expected_return: '2026-11-07',
    can_report: true,
    can_update: true,
  });

  it('says what it means and when clearance can be asked for', async () => {
    await openInjury('guardian', concussed);
    expect(screen.getByText('Possible concussion')).toBeTruthy();
    expect(screen.getByText(/^If in doubt, sit them out\./)).toBeTruthy();
    expect(screen.getByText('Clearance from')).toBeTruthy();
    expect(screen.getByText(formatDateString('2026-10-31'))).toBeTruthy();
  });

  it('refuses a clearance request before the club’s minimum days', async () => {
    await openInjury('guardian', concussed);
    await fireEvent.press(screen.getByText('Ask for clearance'));
    await fireEvent.press(screen.getAllByText('Ask for clearance').at(-1)!);
    await settle();
    expect(
      screen.getByText(`After a concussion, clearance can be asked for from ${formatDateString('2026-10-31')}.`),
    ).toBeTruthy();
    expect(rpcNames()).not.toContain('request_clearance');
  });

  it('asks for a doctor’s clearance, and needs it confirmed', async () => {
    await openInjury('guardian', { ...concussed, earliest_clearance: '2026-10-18' });
    await fireEvent.press(screen.getByText('Ask for clearance'));
    expect(screen.getByText('Doctor’s clearance')).toBeTruthy();
    await fireEvent.press(screen.getAllByText('Ask for clearance').at(-1)!);
    await settle();
    expect(screen.getByText('Attach the doctor’s clearance.')).toBeTruthy();
    expect(screen.getByLabelText('This is a doctor’s clearance').props.value).toBe(false);
  });

  it('only waits for a physio to endorse it', async () => {
    await openInjury('guardian', { ...concussed, status: 'clearance_requested' });
    expect(screen.getByText('Waiting for one of the athlete’s physios to endorse it.')).toBeTruthy();
  });

  it('shows a clearance confirmed as a doctor’s in the history', async () => {
    await openInjury('physio', { ...concussed, status: 'clearance_requested', can_report: false }, [
      update({ kind: 'clearance_requested', doctor_clearance: true, author_name: 'Sample Guardian' }),
    ]);
    expect(screen.getByText('Confirmed as a doctor’s clearance.')).toBeTruthy();
  });

  it('asks for no doctor’s clearance for other injuries', async () => {
    await openInjury('guardian', injury({ can_report: true, can_update: true }));
    await fireEvent.press(screen.getByText('Ask for clearance'));
    expect(screen.getByText('Proof of clearance')).toBeTruthy();
    expect(screen.queryByLabelText('This is a doctor’s clearance')).toBeNull();
  });
});
