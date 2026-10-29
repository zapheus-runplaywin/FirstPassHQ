/**
 * Screens a parent or guardian uses for their child under 18, and the code of
 * conduct every member accepts: consent (src/app/consent/[id].tsx), the code
 * of conduct (conduct/[id].tsx), who has viewed the child's records
 * (records/[id].tsx) and what has changed around them (activity/[id].tsx).
 * From "Giving consent", "The code of conduct for your child", "Who has
 * viewed your child's records" and "What's changed for your child" in
 * section 5, and section 12 of docs/user-guide.md.
 *
 * The database decides who may see and change each one, so the tests seed
 * what it would return for each member and check the screen shows that and
 * sends the right call: consent only for a verified guardian, and a child's
 * code of conduct accepted only by their verified guardian.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import ChildActivityScreen from '@/app/activity/[id]';
import ConductScreen from '@/app/conduct/[id]';
import ConsentScreen from '@/app/consent/[id]';
import RecordAccessScreen from '@/app/records/[id]';
import type { ConductAcceptance, ConductTodo } from '@/lib/conduct';
import type { ChildConsent, ConsentRecord } from '@/lib/consents';
import { formatDateTime } from '@/lib/format';
import type { RecordAccess } from '@/lib/record-access';
import { localDay } from '@/lib/reports';

import { argsOf, clearCalls, rpcNames } from './helpers/forms';
import {
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
let canGoBack: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
  canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(true);
});
afterEach(() => {
  back.mockRestore();
  canGoBack.mockRestore();
});

// ---------------------------------------------------------------------------
// Consent

const CHILD: ChildConsent = {
  athlete_id: 'child-1',
  full_name: 'Sample Child',
  data: false,
  health: true,
  can_consent: true,
};

const HISTORY: ConsentRecord[] = [
  {
    kind: 'health',
    given_by_name: 'Sample guardian',
    policy_version: '2026.1',
    given_at: '2026-09-01T02:00:00Z',
    withdrawn_at: null,
    withdrawn_by_name: null,
  },
  {
    kind: 'data',
    given_by_name: null,
    policy_version: '2025.2',
    given_at: '2026-02-01T02:00:00Z',
    withdrawn_at: '2026-03-01T02:00:00Z',
    withdrawn_by_name: 'Other Guardian',
  },
];

async function openConsent(who: Who, children: ChildConsent[], options: BackendOptions = {}) {
  await openScreen(who, { 'consent/[id]': ConsentScreen }, '/consent/child-1', {}, {
    ...options,
    rpcs: {
      my_child_consents: children,
      child_consent_history: HISTORY,
      club_policies: [{ policy_version: '2026.1' }],
      ...options.rpcs,
    },
  });
}

const toggle = (title: string) => screen.getByLabelText(`I consent: ${title}`);

describe('consent for a child', () => {
  it('shows the consents in force, and asks only for this child’s history', async () => {
    await openConsent('guardian', [CHILD]);
    expect(toggle('Daily check-ins').props.value).toBe(false);
    expect(toggle('Injuries and health information').props.value).toBe(true);
    expect(screen.getByText(/never their check-in answers/)).toBeTruthy();
    expect(
      screen.getByText(/the club’s Child Safety Officer sees the day and the lowest score, never their answers or note\. Without this, neither sees/),
    ).toBeTruthy();
    expect(screen.getByText(/ Policy version 2026\.1\./)).toBeTruthy();
    expect(argsOf('child_consent_history')).toEqual([{ p_athlete_id: 'child-1' }]);
  });

  it('saves both choices for the child, then goes back', async () => {
    await openConsent('guardian', [CHILD]);
    await fireEvent(toggle('Daily check-ins'), 'valueChange', true);
    await fireEvent(toggle('Injuries and health information'), 'valueChange', false);
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(argsOf('set_child_consent')).toEqual([
      { p_athlete_id: 'child-1', p_data: true, p_health: false },
    ]);
    expect(back).toHaveBeenCalled();
  });

  it('shows the database’s refusal and stays', async () => {
    await openConsent('guardian', [CHILD], { rpcErrors: { set_child_consent: 'Only a verified guardian can consent.' } });
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Only a verified guardian can consent.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('a guardian not yet verified can’t give consent', async () => {
    await openConsent('guardian', [{ ...CHILD, can_consent: false }]);
    expect(screen.getByText(/A club admin needs to verify your identity before you can give consent\./)).toBeTruthy();
    expect(screen.queryByLabelText('I consent: Daily check-ins')).toBeNull();
    expect(screen.queryByText('Save')).toBeNull();
  });

  it.each<[string, Who, ChildConsent[]]>([
    ['a guardian of another child', 'guardian', [{ ...CHILD, athlete_id: 'child-2' }]],
    ['a guardian whose child has turned 18', 'guardianOfAdult', []],
    ['a coach', 'coach', []],
  ])('gives %s nothing to consent to', async (_l, who, children) => {
    await openConsent(who, children);
    expect(screen.getByText('Consent is only for parents and guardians of athletes under 18.')).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('lists every change, naming a former guardian who has gone', async () => {
    await openConsent('guardian', [CHILD]);
    expect(
      screen.getByText(
        `Injuries and health information: given by Sample guardian ${formatDateTime(new Date('2026-09-01T02:00:00Z'))} (version 2026.1)`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Daily check-ins: given by a former guardian ${formatDateTime(new Date('2026-02-01T02:00:00Z'))} (version 2025.2), withdrawn by Other Guardian ${formatDateTime(new Date('2026-03-01T02:00:00Z'))}`,
      ),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The code of conduct

const STATEMENT = 'I will respect players, coaches and officials.';

function todo(extra: Partial<ConductTodo> = {}): ConductTodo {
  return {
    profile_id: 'athlete',
    full_name: 'Sample athlete',
    for_child: false,
    statement: STATEMENT,
    code_of_conduct_url: 'https://example.test/conduct.pdf',
    ...extra,
  };
}

const ACCEPTED: ConductAcceptance[] = [
  {
    season: 2026,
    accepted_by_name: 'Sample guardian',
    accepted_as: 'guardian',
    policy_version: '3',
    statement: 'Old words',
    accepted_at: '2026-02-01T02:00:00Z',
  },
  {
    season: 2025,
    accepted_by_name: null,
    accepted_as: 'self',
    policy_version: '2',
    statement: 'Older words',
    accepted_at: '2025-02-01T02:00:00Z',
  },
];

async function openConduct(
  who: Who,
  id: string,
  rpcs: { todos?: ConductTodo[]; history?: ConductAcceptance[]; waiting?: boolean } = {},
  options: BackendOptions = {},
) {
  await openScreen(who, { 'conduct/[id]': ConductScreen }, `/conduct/${id}`, {}, {
    ...options,
    rpcs: {
      my_conduct_todos: rpcs.todos ?? [],
      conduct_history: rpcs.history ?? [],
      conduct_waiting_for_guardian: rpcs.waiting ?? false,
      ...options.rpcs,
    },
  });
}

describe('the code of conduct', () => {
  it('asks the member to read and accept it for themselves, and records it', async () => {
    await openConduct('athlete', 'athlete', { todos: [todo()] });
    expect(screen.getByText('Each season every member accepts the club’s code of conduct. Read it, then agree below.')).toBeTruthy();
    expect(screen.getByText(STATEMENT)).toBeTruthy();
    await fireEvent.press(screen.getByText('I agree'));
    await settle();
    expect(argsOf('accept_code_of_conduct')).toEqual([{ p_profile_id: 'athlete' }]);
    expect(back).toHaveBeenCalled();
  });

  it('opens the club’s code of conduct document', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await openConduct('athlete', 'athlete', { todos: [todo()] });
    await fireEvent.press(screen.getByText('Read the code of conduct'));
    expect(open).toHaveBeenCalledWith('https://example.test/conduct.pdf');
    open.mockRestore();
  });

  it('a guardian accepts it for their child, by name', async () => {
    await openConduct('guardian', 'child-1', {
      todos: [todo({ profile_id: 'child-1', full_name: 'Sample Child', for_child: true, code_of_conduct_url: null })],
    });
    expect(screen.getByText(/accepts the club’s code of conduct for Sample Child\. Read it, go through it with them/)).toBeTruthy();
    expect(screen.queryByText('Read the code of conduct')).toBeNull();
    await fireEvent.press(screen.getByText('I agree'));
    await settle();
    expect(argsOf('accept_code_of_conduct')).toEqual([{ p_profile_id: 'child-1' }]);
  });

  it('asks about only the person in the link', async () => {
    await openConduct('guardian', 'child-1', { todos: [todo({ profile_id: 'guardian' })] });
    expect(screen.queryByText('I agree')).toBeNull();
    expect(screen.getByText('Nothing to accept for them.')).toBeTruthy();
    expect(argsOf('conduct_history')).toEqual([{ p_profile_id: 'child-1' }]);
    expect(argsOf('conduct_waiting_for_guardian')).toEqual([{ p_profile_id: 'child-1' }]);
  });

  it('a child under 18 waits for their verified parent to accept it', async () => {
    await openConduct('minorAthlete', 'minor-athlete', { waiting: true });
    expect(screen.getByText(/^Waiting for verification\. Your parent or guardian accepts the code of conduct for you/)).toBeTruthy();
    expect(screen.queryByText('I agree')).toBeNull();
  });

  it('a guardian not yet verified is told the same about their child', async () => {
    await openConduct('guardian', 'child-1', { waiting: true });
    expect(screen.getByText(/^Waiting for verification\. A parent or guardian accepts the code of conduct for them/)).toBeTruthy();
  });

  it('says there is nothing to accept for the member themselves', async () => {
    await openConduct('athlete', 'athlete');
    expect(screen.getByText(/^Nothing to accept\. The club hasn’t added a code of conduct/)).toBeTruthy();
  });

  it('lists each season’s acceptance, who accepted it and the words', async () => {
    await openConduct('guardian', 'child-1', { history: ACCEPTED });
    expect(screen.getByText('2026–27 season')).toBeTruthy();
    expect(
      screen.getByText(`By Sample guardian, as parent or guardian on ${localDay('2026-02-01T02:00:00Z')} · version 3`),
    ).toBeTruthy();
    expect(screen.getByText(`By the member on ${localDay('2025-02-01T02:00:00Z')} · version 2`)).toBeTruthy();
    expect(screen.getByText('Old words')).toBeTruthy();
    expect(screen.queryByText('Nothing to accept for them.')).toBeNull();
  });

  it('shows the database’s refusal and stays', async () => {
    await openConduct('athlete', 'athlete', { todos: [todo()] }, {
      rpcErrors: { accept_code_of_conduct: 'Already accepted this season.' },
    });
    await fireEvent.press(screen.getByText('I agree'));
    await settle();
    expect(screen.getByText('Already accepted this season.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('opened from a link with nowhere to go back to, reloads instead', async () => {
    canGoBack.mockReturnValue(false);
    await openConduct('athlete', 'athlete', { todos: [todo()] });
    clearCalls();
    await fireEvent.press(screen.getByText('I agree'));
    await settle();
    expect(back).not.toHaveBeenCalled();
    expect(rpcNames()).toEqual(
      expect.arrayContaining(['accept_code_of_conduct', 'my_conduct_todos', 'conduct_history']),
    );
  });
});

// ---------------------------------------------------------------------------
// Who has viewed a child's records

const VIEWS: RecordAccess[] = [
  {
    id: 'v1',
    viewer_name: 'Sample coach',
    viewer_role: 'Coach',
    kind: 'injury',
    record_id: 'inj-1',
    created_at: '2026-10-17T03:00:00Z',
  },
  {
    id: 'v2',
    viewer_name: 'Sample admin',
    viewer_role: null,
    kind: 'member_record',
    record_id: null,
    created_at: '2026-10-16T03:00:00Z',
  },
];

async function openRecords(who: Who, allowed: boolean, views: RecordAccess[]) {
  await openScreen(who, { 'records/[id]': RecordAccessScreen }, '/records/child-1?name=Sample%20Child', {}, {
    rpcs: { can_see_record_access: allowed, record_access_history: views },
  });
}

describe('who has viewed a child’s records', () => {
  it.each<[string, Who]>([
    ['verified guardian', 'guardian'],
    ['admin', 'admin'],
  ])('lists each view for a %s, newest first, with the viewer’s role', async (_l, who) => {
    await openRecords(who, true, VIEWS);
    expect(screen.getByText('Sample coach (Coach)')).toBeTruthy();
    expect(screen.getByText(`Opened an injury, ${formatDateTime(new Date('2026-10-17T03:00:00Z'))}`)).toBeTruthy();
    expect(screen.getByText('Sample admin')).toBeTruthy();
    expect(screen.getByText(/^Opened their member record, /)).toBeTruthy();
    expect(argsOf('record_access_history')).toEqual([{ p_subject_id: 'child-1' }]);
    expect(argsOf('can_see_record_access')).toEqual([{ p_subject_id: 'child-1' }]);
  });

  it('says when nobody else has opened them', async () => {
    await openRecords('guardian', true, []);
    expect(screen.getByText('Nobody else has opened Sample Child’s records yet.')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['guardian not yet verified', 'guardian'],
    ['the child', 'minorAthlete'],
  ])('shows none of the views to a %s the database refuses', async (_l, who) => {
    await openRecords(who, false, VIEWS);
    expect(screen.getByText('Only the child’s verified parents and guardians, and admins, can see this.')).toBeTruthy();
    expect(screen.queryByText('Sample coach (Coach)')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What's changed for a child

describe('what’s changed for a child', () => {
  async function openActivity(rows: { kind: string; summary: string; happened_at: string }[]) {
    await openScreen('guardian', { 'activity/[id]': ChildActivityScreen }, '/activity/child-1?name=Sample%20Child', {}, {
      rpcs: { child_activity: rows, mark_child_activity_seen: null },
    });
  }

  it('lists the changes, then marks them seen', async () => {
    await openActivity([
      { kind: 'staff', summary: 'Sample coach joined Open A as coach', happened_at: '2026-10-17T03:00:00Z' },
      { kind: 'consent', summary: 'Check-ins consent given', happened_at: '2026-10-10T03:00:00Z' },
    ]);
    expect(screen.getByText('Sample coach joined Open A as coach')).toBeTruthy();
    expect(screen.getByText(formatDateTime(new Date('2026-10-17T03:00:00Z')))).toBeTruthy();
    expect(screen.getByText('Check-ins consent given')).toBeTruthy();
    expect(screen.getByText(/added to or leaving Sample Child’s squads and teams/)).toBeTruthy();
    expect(argsOf('child_activity')).toEqual([{ p_athlete_id: 'child-1' }]);
    expect(argsOf('mark_child_activity_seen')).toEqual([{ p_athlete_id: 'child-1' }]);
    const names = rpcNames();
    expect(names.indexOf('child_activity')).toBeLessThan(names.indexOf('mark_child_activity_seen'));
  });

  it('says when nothing has changed', async () => {
    await openActivity([]);
    expect(screen.getByText('Nothing has changed yet.')).toBeTruthy();
  });
});
