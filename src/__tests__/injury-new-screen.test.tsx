/**
 * Reporting an injury (src/app/injuries/new.tsx), from "Reporting an injury"
 * in section 4 and section 12 of docs/user-guide.md.
 *
 * An athlete reports their own injury; a parent or guardian reports one for
 * a child an admin has linked them to (`my_athletes`), and can't until then.
 * The screen tells each of them who will see it: an athlete under 18's
 * coaches, physios and the committee only once a parent or guardian agrees.
 * The database (`report_injury`) decides whether the report is allowed.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import NewInjuryScreen from '@/app/injuries/new';
import { formatDateString } from '@/lib/injuries';

import { argsOf, clearCalls, isSelected, rpcNames, type } from './helpers/forms';
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

let replace: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
});
afterEach(() => replace.mockRestore());

const CHILDREN = [
  { profile_id: 'child-1', full_name: 'Sample Child' },
  { profile_id: 'child-2', full_name: null },
];

async function open(who: Who, options: BackendOptions = {}) {
  await openScreen(who, { 'injuries/new': NewInjuryScreen }, '/injuries/new', {}, {
    ...options,
    rpcs: { my_athletes: CHILDREN, report_injury: 'inj-new', ...options.rpcs },
  });
}

function fill() {
  type('Where is the injury?', 'Left ankle');
  type('What happened?', 'Rolled it landing a rebound');
  fireEvent.press(screen.getByText('2 weeks'));
}

async function send() {
  fireEvent.press(screen.getByText('Report injury'));
  await settle();
}

describe('an athlete’s own injury', () => {
  it('reports it for themselves, injured today by default, then opens it', async () => {
    await open('athlete');
    expect(rpcNames()).not.toContain('my_athletes');
    expect(screen.getByText(formatDateString('2026-10-18'))).toBeTruthy();
    fill();
    type('Restrictions (optional)', 'No jumping');
    await send();
    expect(argsOf('report_injury')).toEqual([
      {
        p_athlete_id: 'athlete',
        p_body_area: 'Left ankle',
        p_description: 'Rolled it landing a rebound',
        p_injured_on: '2026-10-18',
        p_restrictions: 'No jumping',
        p_expected_return: '2026-11-01',
      },
    ]);
    expect(replace).toHaveBeenCalledWith({ pathname: '/injuries/[id]', params: { id: 'inj-new' } });
  });

  it('can say it happened yesterday or earlier, but never after today', async () => {
    await open('athlete');
    fireEvent.press(screen.getByText('Yesterday'));
    expect(screen.getByText(formatDateString('2026-10-17'))).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText('Day before')[0]);
    expect(screen.getByText(formatDateString('2026-10-16'))).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText('Day after')[0]);
    fireEvent.press(screen.getAllByLabelText('Day after')[0]);
    fireEvent.press(screen.getAllByLabelText('Day after')[0]);
    expect(screen.getByText(formatDateString('2026-10-18'))).toBeTruthy();
    fill();
    await send();
    expect(argsOf('report_injury')[0]).toMatchObject({ p_injured_on: '2026-10-18' });
  });

  it.each([
    ['nowhere', '', 'Rolled it', 'Say where the injury is and what happened.'],
    ['nothing happened', 'Ankle', '   ', 'Say where the injury is and what happened.'],
  ])('refuses a report saying %s', async (_l, where, what, message) => {
    await open('athlete');
    type('Where is the injury?', where);
    type('What happened?', what);
    fireEvent.press(screen.getByText('2 weeks'));
    await send();
    expect(screen.getByText(message)).toBeTruthy();
    expect(rpcNames()).not.toContain('report_injury');
  });

  it('needs an expected return, which a physio can change later', async () => {
    await open('athlete');
    type('Where is the injury?', 'Knee');
    type('What happened?', 'Twisted');
    await send();
    expect(screen.getByText('Choose when you expect to be back. A physio can change it later.')).toBeTruthy();
    expect(rpcNames()).not.toContain('report_injury');
  });

  it.each([
    ['In 1 week', '2026-10-25'],
    ['4 weeks', '2026-11-15'],
    ['6 weeks', '2026-11-29'],
  ])('“%s” sets the return to %s', async (pick, day) => {
    await open('athlete');
    type('Where is the injury?', 'Knee');
    type('What happened?', 'Twisted');
    fireEvent.press(screen.getByText(pick));
    expect(isSelected(pick)).toBe(true);
    await send();
    expect(argsOf('report_injury')[0]).toMatchObject({ p_expected_return: day });
  });

  it('shows the database’s refusal and stays', async () => {
    await open('athlete', { rpcErrors: { report_injury: 'You can only report your own injuries.' } });
    fill();
    await send();
    expect(screen.getByText('You can only report your own injuries.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('who is told they’ll see it', () => {
  it('an adult athlete: their coaches, physios and the committee', async () => {
    await open('athlete');
    expect(screen.getByText(/^Your coaches, physios and the committee will see this\./)).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['under 17 by the admin’s choice', 'minorAthlete'],
    ['under 18 by date of birth', morePersonas.under18Athlete],
  ])('an athlete %s: parents and admins, and staff only once a parent agrees', async (_l, who) => {
    await open(who);
    expect(
      screen.getByText(
        /^Your parents or guardians and the club’s admins see this\. Your coaches, physios and the committee see it once a parent or guardian agrees\./,
      ),
    ).toBeTruthy();
  });

  it('a guardian: admins, and staff once they consent for a child', async () => {
    await open('guardian');
    expect(screen.getByText(/^Admins see this\. For an athlete under 18, their coaches, physios and the committee see it once you give consent for injuries\./)).toBeTruthy();
  });
});

describe('a parent or guardian reporting for their child', () => {
  it('must choose which child when they have more than one', async () => {
    await open('guardian');
    expect(screen.getByText('Athlete')).toBeTruthy();
    expect(screen.getByText('Unnamed athlete')).toBeTruthy();
    fill();
    await send();
    expect(screen.getByText('Choose which athlete is injured.')).toBeTruthy();
    expect(rpcNames()).not.toContain('report_injury');
    fireEvent.press(screen.getByText('Sample Child'));
    await send();
    expect(argsOf('report_injury')[0]).toMatchObject({ p_athlete_id: 'child-1' });
  });

  it('with one child, reports for them without asking', async () => {
    await open('guardian', { rpcs: { my_athletes: [CHILDREN[0]] } });
    expect(screen.getByText('For Sample Child')).toBeTruthy();
    fill();
    await send();
    expect(argsOf('report_injury')[0]).toMatchObject({ p_athlete_id: 'child-1' });
  });

  it.each<[string, Who]>([
    ['a guardian', 'guardian'],
    ['a coach who is a guardian', 'coachGuardian'],
  ])('%s not yet linked to a child can’t report, and never for themselves', async (_l, who) => {
    await open(who, { rpcs: { my_athletes: [] } });
    expect(screen.getByText('A club admin needs to link you to your athlete before you can report an injury for them.')).toBeTruthy();
    fill();
    await send();
    expect(screen.getByText('Choose which athlete is injured.')).toBeTruthy();
    expect(rpcNames()).not.toContain('report_injury');
  });
});
