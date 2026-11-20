/**
 * The member's own screens: Your details (src/app/my-details.tsx), Delete
 * account (delete-account.tsx), the volunteer exemption declaration
 * (declaration.tsx), the declaration for a lodged Working With Children
 * Check application (wwcc-application.tsx) and their personal tasks (tasks/index.tsx, new.tsx,
 * [id].tsx with components/task-form.tsx). From "Your preferred name", "Your
 * own tasks" and "Deleting your account" in section 3, and "Volunteer
 * exemptions" in section 6 of docs/user-guide.md.
 *
 * Only committee members and admins hold a club title; a coach's or manager's
 * title comes from their squads and teams. Personal tasks are private to the
 * member, so every write goes to their own `personal_tasks` rows (the
 * database's row security keeps them theirs).
 */
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { fireEvent, screen } from 'expo-router/testing-library';

import DeclarationScreen from '@/app/declaration';
import DeleteAccountScreen from '@/app/delete-account';
import MyDetailsScreen from '@/app/my-details';
import EditTaskScreen from '@/app/tasks/[id]';
import TasksScreen from '@/app/tasks/index';
import NewTaskScreen from '@/app/tasks/new';
import WwccApplicationScreen from '@/app/wwcc-application';
import { formatDate } from '@/lib/age';
import type { PersonalTask } from '@/lib/personal-tasks';
import { localDay } from '@/lib/reports';
import { revokeAppleSignIn } from '@/lib/sign-in';
import { supabase } from '@/lib/supabase';
import type { MyVolunteerExemption, MyWwccApplication } from '@/lib/types';

import { argsOf, clearCalls, field, recordTable, rpcNames, type } from './helpers/forms';
import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
  settle,
  type BackendOptions,
  type QueryInfo,
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
// Revoking with Apple is tested in src/lib/__tests__/sign-in.test.ts; here
// only what the delete screen does with each answer.
jest.mock('@/lib/sign-in', () => ({
  ...jest.requireActual('@/lib/sign-in'),
  revokeAppleSignIn: jest.fn(),
}));

type Who = PersonaName | Persona;

let back: jest.SpyInstance;
let push: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
});
afterEach(() => {
  back.mockRestore();
  push.mockRestore();
});

const signOut = () => (supabase.auth as unknown as { signOut: jest.Mock }).signOut;

// ---------------------------------------------------------------------------
// Your details

describe('your details', () => {
  async function open(who: Who, options: BackendOptions = {}) {
    await openScreen(who, { 'my-details': MyDetailsScreen }, '/my-details', {}, options);
  }

  it.each<[string, Who]>([
    ['committee member', 'committee'],
    ['admin', 'admin'],
  ])('lets a %s set a club title, and saves it with the preferred name', async (_l, who) => {
    await open(who);
    await type('Preferred name', 'Sam');
    await type('Title', 'Treasurer');
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(argsOf('save_my_details')).toEqual([{ p_preferred_name: 'Sam', p_title: 'Treasurer' }]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['guardian', 'guardian'],
    ['physio', 'physio'],
    ['under-18 athlete', 'minorAthlete'],
    ['committee member waiting for approval', { ...personas.committee, profile: { ...personas.committee.profile!, status: 'pending' } }],
  ])('gives a %s no club title, and sends none', async (_l, who) => {
    await open(who);
    expect(screen.queryByText('Title')).toBeNull();
    await type('Preferred name', 'Jo');
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(argsOf('save_my_details')).toEqual([{ p_preferred_name: 'Jo', p_title: null }]);
  });

  it('a committee member with a paused role keeps no title field', async () => {
    await open('committeeExpiredCheck');
    expect(screen.queryByText('Title')).toBeNull();
  });

  it('fills in what they saved before, with their full name as the hint', async () => {
    await open({
      ...personas.committee,
      profile: { ...personas.committee.profile!, preferred_name: 'Chair', title: 'President' },
    });
    expect(field('Preferred name').props.value).toBe('Chair');
    expect(field('Preferred name').props.placeholder).toBe('Sample committee');
    expect(field('Title').props.value).toBe('President');
    expect(screen.getByText(/Leave it blank to use your name, Sample committee\./)).toBeTruthy();
  });

  it.each<[string, Who, string]>([
    ['head coach', 'coach', 'Head Coach, Open A'],
    ['assistant coach', morePersonas.assistantCoach, 'Assistant Coach, Open A'],
  ])('shows a %s the title the app sets from their teams, which they can’t edit', async (_l, who, title) => {
    await open(who);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(/A club admin can change whether you’re a head or assistant coach\./)).toBeTruthy();
    expect(screen.queryByPlaceholderText('President, Secretary, Treasurer…')).toBeNull();
  });

  it('calls a coach’s team title “Team title” beside an admin’s own title', async () => {
    await open('adminLapsedCoach');
    // The coach role is paused, so no team title shows.
    expect(screen.queryByText('Team title')).toBeNull();
    expect(screen.getByPlaceholderText('President, Secretary, Treasurer…')).toBeTruthy();
  });

  it('shows the database’s error and stays', async () => {
    await open('athlete', { rpcErrors: { save_my_details: 'Preferred name is too long.' } });
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Preferred name is too long.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Deleting the account

describe('deleting the account', () => {
  async function open(options: BackendOptions = {}) {
    await openScreen('athlete', { 'delete-account': DeleteAccountScreen }, '/delete-account', {}, options);
  }

  it('explains what goes and what the club keeps, naming the club', async () => {
    await open();
    expect(screen.getByText('Delete your Sample Club account')).toBeTruthy();
    expect(
      screen.getByText(
        /The club keeps your injury records after you leave, .* for its keep period for injuries \(7 years unless the club chose 3, 5 or 10\), counted from when you leave, and then deletes them\. Nothing is deleted while the club has removing old records switched off\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/12 months after you leave/)).toBeNull();
    expect(screen.getByText(/you’ll need to ask to join again\./)).toBeTruthy();
    // Only a parent or guardian is told about their child's app locking.
    expect(screen.queryByText(/their app locks\s+again/)).toBeNull();
  });

  it('tells a parent or guardian their child’s app locks if they were the last verified one', async () => {
    await openScreen('guardian', { 'delete-account': DeleteAccountScreen }, '/delete-account');
    expect(
      screen.getByText(/^If you’re the only verified parent or guardian linked to a child under 18, their app locks\s+again/),
    ).toBeTruthy();
    expect(screen.getByText(/the club’s admins are told\.$/)).toBeTruthy();
  });

  describe('a parent of a child who won’t use the app', () => {
    // The parent's linked children, as guardianships and profiles return them.
    function children(rows: { id: string; full_name: string; no_sign_in: boolean }[]) {
      return {
        tableHandlers: {
          guardianships: (q: QueryInfo) =>
            q.calls.some((c) => c.method === 'eq' && c.args[0] === 'guardian_id')
              ? rows.map((r) => ({ athlete_id: r.id }))
              : undefined,
          profiles: (q: QueryInfo) =>
            q.calls.some((c) => c.method === 'in' && c.args[0] === 'id')
              ? rows.map((r) => ({ ...r, preferred_name: null }))
              : undefined,
        },
      };
    }

    it('says who would be left with nobody to act for them, not that their app locks', async () => {
      await openScreen(
        'guardian',
        { 'delete-account': DeleteAccountScreen },
        '/delete-account',
        {},
        children([{ id: 'c1', full_name: 'Charlie Lee', no_sign_in: true }]),
      );
      await settle();
      expect(
        screen.getByText(
          /^Charlie Lee doesn’t use the app\. If\s+you’re the only verified parent or guardian linked to\s+them, nobody can report their absences or\s+injuries, give consent or answer surveys for them until the club links another parent or\s+guardian, and the club’s admins are told\.$/,
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/their app locks\s+again/)).toBeNull();
    });

    it('names every such child, and keeps the app note for a child who has the app', async () => {
      await openScreen(
        'guardian',
        { 'delete-account': DeleteAccountScreen },
        '/delete-account',
        {},
        children([
          { id: 'c1', full_name: 'Charlie Lee', no_sign_in: true },
          { id: 'c2', full_name: 'Alex Lee', no_sign_in: true },
          { id: 'c3', full_name: 'Jo Lee', no_sign_in: false },
        ]),
      );
      await settle();
      expect(screen.getByText(/^Alex Lee and Charlie Lee don’t use the app\./)).toBeTruthy();
      expect(screen.getByText(/linked to\s+any of them, nobody can/)).toBeTruthy();
      expect(screen.getByText(/their app locks\s+again/)).toBeTruthy();
    });

    it('says nothing about it to a parent whose children all use the app', async () => {
      await openScreen(
        'guardian',
        { 'delete-account': DeleteAccountScreen },
        '/delete-account',
        {},
        children([{ id: 'c3', full_name: 'Jo Lee', no_sign_in: false }]),
      );
      await settle();
      expect(screen.queryByText(/use the app\./)).toBeNull();
      expect(screen.getByText(/their app locks\s+again/)).toBeTruthy();
    });
  });

  it('asks once more before deleting, and Cancel deletes nothing', async () => {
    await open();
    await fireEvent.press(screen.getByText('Delete my account'));
    expect(screen.getByText('Are you sure? This can’t be undone.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Cancel'));
    await settle();
    expect(rpcNames()).not.toContain('delete_my_account');
    expect(screen.queryByText('Delete my account permanently')).toBeNull();
  });

  it('deletes the account, then signs out on this phone', async () => {
    await open();
    await fireEvent.press(screen.getByText('Delete my account'));
    await fireEvent.press(screen.getByText('Delete my account permanently'));
    await settle();
    expect(argsOf('delete_my_account')).toEqual([undefined]);
    expect(signOut()).toHaveBeenCalled();
  });

  it('asks a member the club must keep to contact an admin, without saying why', async () => {
    await open({ rpcErrors: { delete_my_account: 'Your account can’t be deleted at the moment. Please contact a club admin.' } });
    await fireEvent.press(screen.getByText('Delete my account'));
    await fireEvent.press(screen.getByText('Delete my account permanently'));
    await settle();
    expect(screen.getByText('Your account can’t be deleted at the moment. Please contact a club admin.')).toBeTruthy();
    expect(screen.queryByText(/concern names/i)).toBeNull();
    expect(signOut()).not.toHaveBeenCalled();
  });

  it('when deleting fails, says why and stays signed in', async () => {
    await open({ rpcErrors: { delete_my_account: 'Admins can’t delete their own account.' } });
    await fireEvent.press(screen.getByText('Delete my account'));
    await fireEvent.press(screen.getByText('Delete my account permanently'));
    await settle();
    expect(screen.getByText('Admins can’t delete their own account.')).toBeTruthy();
    expect(signOut()).not.toHaveBeenCalled();
  });

  describe('a member who signed in with Apple', () => {
    const revoke = revokeAppleSignIn as jest.Mock;
    const athlete = personas.athlete;
    const withApple = (app_metadata: Record<string, unknown>): Persona => ({
      ...athlete,
      session: { ...athlete.session!, user: { ...athlete.session!.user, app_metadata } },
    });
    const appleAthlete = withApple({ provider: 'apple', providers: ['apple'] });
    let rpcsWhenRevoking: string[] | null;

    beforeEach(() => {
      rpcsWhenRevoking = null;
      revoke.mockReset().mockImplementation(async () => {
        rpcsWhenRevoking = [...rpcNames()];
        return 'revoked';
      });
    });

    async function deleteAs(who: Persona, options: BackendOptions = {}) {
      await openScreen(who, { 'delete-account': DeleteAccountScreen }, '/delete-account', {}, options);
      await fireEvent.press(screen.getByText('Delete my account'));
      await fireEvent.press(screen.getByText('Delete my account permanently'));
      await settle();
    }

    it('is told Apple asks them to confirm once more', async () => {
      await openScreen(appleAthlete, { 'delete-account': DeleteAccountScreen }, '/delete-account');
      expect(screen.getByText(/^You signed in with Apple, so Apple asks you to confirm once more\./)).toBeTruthy();
      // Apple's permission is for the whole app, so other clubs are named.
      expect(screen.getByText(/your account there stays: Apple just asks you to agree\s+again next time you sign in there\.$/)).toBeTruthy();
    });

    it('revokes with Apple first, then deletes the account and signs out', async () => {
      await deleteAs(appleAthlete);
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(rpcsWhenRevoking).not.toContain('delete_my_account');
      expect(argsOf('delete_my_account')).toEqual([undefined]);
      expect(signOut()).toHaveBeenCalled();
    });

    it('also when Apple was added to a Google account', async () => {
      await deleteAs(withApple({ provider: 'google', providers: ['google', 'apple'] }));
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(argsOf('delete_my_account')).toEqual([undefined]);
    });

    it('still deletes the account when revoking fails', async () => {
      revoke.mockResolvedValue('failed');
      await deleteAs(appleAthlete);
      expect(argsOf('delete_my_account')).toEqual([undefined]);
      expect(signOut()).toHaveBeenCalled();
    });

    it('keeps the account when they cancel Apple’s sheet, and they can try again', async () => {
      revoke.mockResolvedValueOnce('cancelled');
      await deleteAs(appleAthlete);
      expect(rpcNames()).not.toContain('delete_my_account');
      expect(signOut()).not.toHaveBeenCalled();
      // Still asking to confirm, so one more tap tries again.
      await fireEvent.press(screen.getByText('Delete my account permanently'));
      await settle();
      expect(revoke).toHaveBeenCalledTimes(2);
      expect(argsOf('delete_my_account')).toEqual([undefined]);
    });

    it.each(['android', 'web'] as const)(
      'on %s, where Apple can’t be asked, shows no Apple note and deletes without revoking',
      async (os) => {
        const realOS = Platform.OS;
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
        try {
          await deleteAs(appleAthlete);
          expect(screen.queryByText(/You signed in with Apple/)).toBeNull();
          expect(revoke).not.toHaveBeenCalled();
          expect(argsOf('delete_my_account')).toEqual([undefined]);
        } finally {
          Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
        }
      },
    );

    it('a Google member is never asked about Apple', async () => {
      await deleteAs(athlete);
      expect(revoke).not.toHaveBeenCalled();
      expect(screen.queryByText(/You signed in with Apple/)).toBeNull();
      expect(argsOf('delete_my_account')).toEqual([undefined]);
    });
  });
});

// ---------------------------------------------------------------------------
// The exemption declaration

function exemption(extra: Partial<MyVolunteerExemption> = {}): MyVolunteerExemption {
  return {
    basis: 'parent_volunteer',
    child_name: 'Sample Child',
    declared_at: null,
    declaration_text: 'I am the parent of Sample Child, an athlete at the club.',
    valid: false,
    ends_on: null,
    starts_on: null,
    event_name: null,
    organiser: null,
    ...extra,
  };
}

describe('the exemption declaration', () => {
  /** A coach volunteering without a check. */
  const coach = (e: MyVolunteerExemption | null): Persona => ({
    ...personas.coach,
    profile: { ...personas.coach.profile!, wwcc_number: null, wwcc_expires_on: null },
    exemption: e,
  });

  async function open(who: Persona, options: BackendOptions = {}) {
    await openScreen(who, { declaration: DeclarationScreen }, '/declaration', {}, options);
  }

  it('says so when they have no exemption, with nothing to agree to', async () => {
    await open(coach(null));
    expect(screen.getByText(/^You don’t have a volunteer exemption\./)).toBeTruthy();
    expect(screen.queryByText('I agree')).toBeNull();
  });

  it.each<[MyVolunteerExemption['basis'], string, RegExp]>([
    ['parent_volunteer', 'Parent volunteer', /a parent who volunteers at the club their child is in/],
    ['under_18_volunteer', 'Under-18 volunteer', /a volunteer under 18 doesn’t need/],
    ['short_term_visitor', 'Short-term visitor', /for the first two weeks after they arrive/],
    ['national_event', 'National event or tour', /for up to 30 days at a national event or tour/],
  ])('explains a %s exemption and shows the words to accept', async (basis, label, intro) => {
    await open(coach(exemption({ basis })));
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(intro)).toBeTruthy();
    expect(screen.getByText('I am the parent of Sample Child, an athlete at the club.')).toBeTruthy();
    expect(screen.getByText('I agree')).toBeTruthy();
  });

  it('accepting sends the declaration and reloads their roles', async () => {
    await open(coach(exemption()));
    clearCalls();
    await fireEvent.press(screen.getByText('I agree'));
    await settle();
    expect(argsOf('accept_volunteer_declaration')).toEqual([undefined]);
    // The member's exemption is read again, so the coach role starts.
    expect(rpcNames()).toContain('my_volunteer_exemption');
  });

  it('when accepting fails, says why and keeps I agree', async () => {
    await open(coach(exemption()), { rpcErrors: { accept_volunteer_declaration: 'This exemption has ended.' } });
    await fireEvent.press(screen.getByText('I agree'));
    await settle();
    expect(screen.getByText('This exemption has ended.')).toBeTruthy();
    expect(screen.getByText('I agree')).toBeTruthy();
  });

  it('once accepted, shows when and until when it applies', async () => {
    await open(
      coach(exemption({ basis: 'national_event', declared_at: '2026-10-10T03:00:00Z', valid: true, ends_on: '2026-11-01' })),
    );
    expect(screen.queryByText('I agree')).toBeNull();
    expect(
      screen.getByText(`You accepted this on ${localDay('2026-10-10T03:00:00Z')}. It applies until 01/11/2026.`),
    ).toBeTruthy();
  });

  it('a visit that starts later says the days it covers', async () => {
    await open(
      coach(
        exemption({
          basis: 'short_term_visitor',
          declared_at: '2026-10-10T03:00:00Z',
          valid: false,
          starts_on: '2026-10-25',
          ends_on: '2026-11-07',
        }),
      ),
    );
    expect(
      screen.getByText(
        `You accepted this on ${localDay('2026-10-10T03:00:00Z')}. It applies from ${formatDate('2026-10-25')} to ${formatDate('2026-11-07')}.`,
      ),
    ).toBeTruthy();
  });

  it('one that has ended says they now need a check', async () => {
    await open(coach(exemption({ declared_at: '2026-01-10T03:00:00Z', valid: false })));
    expect(screen.getByText(/It no longer applies, so you need a Working With Children Check\.$/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The declaration for a lodged check application

describe('the check application declaration', () => {
  const application = (extra: Partial<MyWwccApplication> = {}): MyWwccApplication => ({
    id: 'application-1',
    application_number: 'APL 123',
    lodged_on: '2026-10-10',
    kind: 'new',
    declaration_text: 'I applied for a Working With Children Check on 10 October 2026 (application APL 123)…',
    declared_at: null,
    lapses_on: '2027-01-08',
    status: 'waiting_for_declaration',
    valid: false,
    ...extra,
  });
  /** A coach waiting for their card. */
  const coach = (a: MyWwccApplication | null): Persona => ({
    ...personas.coach,
    profile: { ...personas.coach.profile!, wwcc_number: null, wwcc_expires_on: null },
    wwccApplication: a,
  });

  async function open(who: Persona, options: BackendOptions = {}) {
    await openScreen(who, { 'wwcc-application': WwccApplicationScreen }, '/wwcc-application', {}, options);
  }

  it('says so when no application is recorded, with nothing to agree to', async () => {
    await open(coach(null));
    expect(screen.getByText(/^You don’t have a Working With Children Check application recorded\./)).toBeTruthy();
    expect(screen.queryByText('I agree')).toBeNull();
  });

  it('explains the rule, names the application and shows the words to accept', async () => {
    await open(coach(application()));
    expect(screen.getByText('Working With Children Check application')).toBeTruthy();
    expect(screen.getByText(/A club admin has recorded your application APL 123, lodged 10\/10\/2026\./)).toBeTruthy();
    expect(screen.getByText(/^I applied for a Working With Children Check on 10 October 2026/)).toBeTruthy();
    expect(screen.getByText('I agree')).toBeTruthy();
    expect(screen.getByText('If any of this isn’t true, don’t agree. Talk to a club admin instead.')).toBeTruthy();
  });

  it('accepting sends the declaration and reloads their roles', async () => {
    await open(coach(application()));
    clearCalls();
    await fireEvent.press(screen.getByText('I agree'));
    await settle();
    expect(argsOf('accept_wwcc_application_declaration')).toEqual([undefined]);
    expect(rpcNames()).toContain('my_wwcc_application');
  });

  it('when accepting fails, says why and keeps I agree', async () => {
    await open(coach(application()), {
      rpcErrors: { accept_wwcc_application_declaration: 'You’ve already accepted this' },
    });
    await fireEvent.press(screen.getByText('I agree'));
    await settle();
    expect(screen.getByText('You’ve already accepted this')).toBeTruthy();
    expect(screen.getByText('I agree')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<MyWwccApplication>, string]>([
    [
      'in force',
      { status: 'in_force', valid: true },
      ' It counts as your check until your card arrives. Add your card from the home screen as soon as it does, for a club admin to check.',
    ],
    [
      'lapsed',
      { status: 'lapsed' },
      ' It has lapsed because nobody at the club confirmed it’s still being assessed. Ask a club admin to check it.',
    ],
    ['stopped', { status: 'stopped' }, ' It no longer counts. Talk to a club admin.'],
  ])('once accepted and %s, says when and where it’s up to', async (_what, extra, words) => {
    await open(coach(application({ declared_at: '2026-10-11T03:00:00Z', ...extra })));
    expect(screen.queryByText('I agree')).toBeNull();
    expect(screen.getByText(`You accepted this on ${localDay('2026-10-11T03:00:00Z')}.${words}`)).toBeTruthy();
  });

  it('one stopped by a notice before it was accepted can’t be accepted', async () => {
    await open(coach(application({ status: 'stopped' })));
    expect(screen.queryByText('I agree')).toBeNull();
    expect(
      screen.getByText('A notice from the Screening Unit means this application doesn’t count. Talk to a club admin.'),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Personal tasks

function task(extra: Partial<PersonalTask> & { id: string; title: string }): PersonalTask {
  return { due_on: null, done_at: null, created_at: '2026-10-01T00:00:00Z', ...extra };
}

describe('your tasks', () => {
  const OPEN = [
    task({ id: 't1', title: 'No date task' }),
    task({ id: 't2', title: 'Soon task', due_on: '2026-10-19' }),
  ];
  const DONE = [task({ id: 't3', title: 'Done task', done_at: '2026-10-16T05:00:00Z' })];

  function tasksTable(open: PersonalTask[], done: PersonalTask[]) {
    return recordTable((q) => {
      const doneQuery = q.calls.some((c) => c.method === 'not');
      if (q.calls.some((c) => c.method === 'delete' || c.method === 'update')) return [];
      return doneQuery ? done : open;
    });
  }

  it('lists what’s to do, soonest due first, and the last ticked off', async () => {
    const t = tasksTable(OPEN, DONE);
    await openScreen('athlete', { 'tasks/index': TasksScreen }, '/tasks', {}, { tableHandlers: { personal_tasks: t.handler } });
    const titles = screen.getAllByText(/^(Soon|No date|Done) task$/).map((n) => n.props.children);
    expect(titles).toEqual(['Soon task', 'No date task', 'Done task']);
    expect(screen.getByLabelText('Put back Done task')).toBeTruthy();
    // The done list asks for the 30 most recent.
    expect(t.queries).toContainEqual(
      expect.arrayContaining([{ method: 'limit', args: [30] }, { method: 'order', args: ['done_at', { ascending: false }] }]),
    );
  });

  it('says when there is nothing to do, with no done section', async () => {
    const t = tasksTable([], []);
    await openScreen('athlete', { 'tasks/index': TasksScreen }, '/tasks', {}, { tableHandlers: { personal_tasks: t.handler } });
    expect(screen.getByText('Nothing to do.')).toBeTruthy();
    expect(screen.queryByText('Delete done tasks')).toBeNull();
    await fireEvent.press(screen.getByText('Add a task'));
    expect(push).toHaveBeenCalledWith('/tasks/new');
  });

  it('putting a done task back clears its done date', async () => {
    const t = tasksTable(OPEN, DONE);
    await openScreen('athlete', { 'tasks/index': TasksScreen }, '/tasks', {}, { tableHandlers: { personal_tasks: t.handler } });
    await fireEvent.press(screen.getByLabelText('Put back Done task'));
    await settle();
    expect(t.writes('update')).toEqual([{ done_at: null }]);
    expect(t.filtersOf('update')).toEqual([[['id', 't3']]]);
    expect(screen.getByLabelText('Tick off Done task')).toBeTruthy();
  });

  it('deletes only ticked-off tasks, after asking', async () => {
    const t = tasksTable(OPEN, DONE);
    await openScreen('athlete', { 'tasks/index': TasksScreen }, '/tasks', {}, { tableHandlers: { personal_tasks: t.handler } });
    await fireEvent.press(screen.getByText('Delete done tasks'));
    expect(screen.getByText('This deletes every task you’ve ticked off, for good.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Delete them'));
    await settle();
    const deletes = t.queries.filter((calls) => calls.some((c) => c.method === 'delete'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContainEqual({ method: 'not', args: ['done_at', 'is', null] });
    expect(deletes[0].some((c) => c.method === 'eq')).toBe(false);
  });

  it('a minor’s tasks work the same, and are theirs alone', async () => {
    const t = tasksTable(OPEN, []);
    await openScreen('minorAthlete', { 'tasks/index': TasksScreen }, '/tasks', {}, { tableHandlers: { personal_tasks: t.handler } });
    expect(screen.getByText(/Only you can see\s+them\./)).toBeTruthy();
    expect(screen.getByText('Soon task')).toBeTruthy();
  });
});

describe('adding and changing a task', () => {
  it('needs a title', async () => {
    const t = recordTable();
    await openScreen('athlete', { 'tasks/new': NewTaskScreen }, '/tasks/new', {}, { tableHandlers: { personal_tasks: t.handler } });
    await type('Task', '   ');
    await fireEvent.press(screen.getByText('Add task'));
    await settle();
    expect(screen.getByText('Say what the task is.')).toBeTruthy();
    expect(t.writes('insert')).toEqual([]);
  });

  it('adds a task with no due date, trimmed', async () => {
    const t = recordTable();
    await openScreen('athlete', { 'tasks/new': NewTaskScreen }, '/tasks/new', {}, { tableHandlers: { personal_tasks: t.handler } });
    expect(screen.getByText('No due date')).toBeTruthy();
    await type('Task', '  Wash my training kit  ');
    await fireEvent.press(screen.getByText('Add task'));
    await settle();
    expect(t.writes('insert')).toEqual([{ title: 'Wash my training kit', due_on: null }]);
    expect(back).toHaveBeenCalled();
  });

  it('picks a due day from the week, moving a week at a time', async () => {
    const t = recordTable();
    await openScreen('athlete', { 'tasks/new': NewTaskScreen }, '/tasks/new', {}, { tableHandlers: { personal_tasks: t.handler } });
    await type('Task', 'Book a physio follow-up');
    await fireEvent.press(screen.getByLabelText('Next week'));
    await fireEvent.press(screen.getByLabelText('Wed Oct 21 2026'));
    expect(screen.getByText('Remove due date')).toBeTruthy();
    await fireEvent.press(screen.getByText('Add task'));
    await settle();
    expect(t.writes('insert')).toEqual([{ title: 'Book a physio follow-up', due_on: '2026-10-21' }]);
  });

  it('Remove due date takes it off', async () => {
    const t = recordTable();
    await openScreen('athlete', { 'tasks/new': NewTaskScreen }, '/tasks/new', {}, { tableHandlers: { personal_tasks: t.handler } });
    await type('Task', 'Thing');
    await fireEvent.press(screen.getByLabelText('Fri Oct 16 2026'));
    await fireEvent.press(screen.getByText('Remove due date'));
    await fireEvent.press(screen.getByText('Add task'));
    await settle();
    expect(t.writes('insert')).toEqual([{ title: 'Thing', due_on: null }]);
  });

  it('shows the database’s error, such as the 100-task limit, and stays', async () => {
    await openScreen('athlete', { 'tasks/new': NewTaskScreen }, '/tasks/new');
    // The next table call is the insert, which the database refuses.
    (supabase.from as jest.Mock).mockImplementationOnce(() => ({
      insert: async () => ({ error: { message: 'You can have up to 100 tasks to do.' } }),
    }));
    await type('Task', 'One too many');
    await fireEvent.press(screen.getByText('Add task'));
    await settle();
    expect(screen.getByText('You can have up to 100 tasks to do.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  const EXISTING = task({ id: 't9', title: 'Return the club bib', due_on: '2026-10-20' });

  it('opens a task with its title and due day, and saves changes to it', async () => {
    const t = recordTable((q) => (q.eq('id') === 't9' && !q.calls.some((c) => c.method === 'update') ? [EXISTING] : []));
    await openScreen('athlete', { 'tasks/[id]': EditTaskScreen }, '/tasks/t9', {}, { tableHandlers: { personal_tasks: t.handler } });
    expect(field('Task').props.value).toBe('Return the club bib');
    expect(screen.getByLabelText('Tue Oct 20 2026').props.accessibilityState).toEqual({ selected: true });
    await type('Task', 'Return the bib and socks');
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(t.writes('update')).toEqual([{ title: 'Return the bib and socks', due_on: '2026-10-20' }]);
    expect(t.filtersOf('update')).toEqual([[['id', 't9']]]);
    expect(t.writes('insert')).toEqual([]);
  });

  it('marks a task done, which deletes it, with a note that says so and no delete button', async () => {
    const t = recordTable((q) => (q.calls.some((c) => c.method === 'delete') ? [] : [EXISTING]));
    await openScreen('athlete', { 'tasks/[id]': EditTaskScreen }, '/tasks/t9', {}, { tableHandlers: { personal_tasks: t.handler } });
    expect(screen.getByText('Marking it done deletes it, so it won’t be on your list any more.')).toBeTruthy();
    expect(screen.queryByText('Delete task')).toBeNull();
    await fireEvent.press(screen.getByText('Mark as done'));
    await settle();
    expect(t.filtersOf('delete')).toEqual([[['id', 't9']]]);
    expect(t.writes('update')).toEqual([]);
    expect(back).toHaveBeenCalled();
  });

  it('stays on the task and shows why when marking it done fails', async () => {
    const t = recordTable(() => [EXISTING]);
    await openScreen('athlete', { 'tasks/[id]': EditTaskScreen }, '/tasks/t9', {}, { tableHandlers: { personal_tasks: t.handler } });
    // The next table call is the delete, which fails.
    (supabase.from as jest.Mock).mockImplementationOnce(() => ({
      delete: () => ({ eq: async () => ({ error: { message: 'Network request failed' } }) }),
    }));
    await fireEvent.press(screen.getByText('Mark as done'));
    await settle();
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('has no Mark as done on a new task', async () => {
    const t = recordTable(() => []);
    await openScreen('athlete', { 'tasks/new': NewTaskScreen }, '/tasks/new', {}, { tableHandlers: { personal_tasks: t.handler } });
    expect(screen.queryByText('Mark as done')).toBeNull();
    expect(screen.queryByText(/Marking it done/)).toBeNull();
  });

  it('says so when the task has been deleted', async () => {
    const t = recordTable(() => []);
    await openScreen('athlete', { 'tasks/[id]': EditTaskScreen }, '/tasks/gone', {}, { tableHandlers: { personal_tasks: t.handler } });
    expect(screen.getByText('This task has been deleted.')).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
  });
});
