/**
 * The Home screen's states that home-by-role.test.tsx doesn't cover
 * (src/app/index.tsx): asking to join, waiting for approval (with the
 * verification code, and an under-18 athlete's ask for a parent), a request
 * turned down for each reason, roles paused for each reason, the committee
 * checks date, the order of the to-do list, and the footer links. From "Ask to
 * join the club", "Wait for approval" and "The home screen" in sections 2 and
 * 3 of docs/user-guide.md.
 */
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';

import HomeScreen from '@/app/index';
import { formatDateString } from '@/lib/injuries';
import { taskDetail, type PersonalTask } from '@/lib/personal-tasks';
import { supabase } from '@/lib/supabase';
import type { MyVolunteerExemption, Profile, RejectionReason } from '@/lib/types';

import { argsOf, clearCalls, recordTable, rpcNames } from './helpers/forms';
import {
  openScreen,
  personas,
  resetClub,
  settle,
  type BackendOptions,
  type Persona,
  TODAY,
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

let push: jest.SpyInstance;

beforeEach(() => {
  resetClub();
  clearCalls();
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
});

afterEach(() => push.mockRestore());

async function openHome(
  who: PersonaName | Persona,
  tables: Record<string, unknown[]> = {},
  options: BackendOptions = {},
) {
  await openScreen(who, { index: HomeScreen }, '/', tables, options);
}

function withProfile(base: Persona, extra: Partial<Profile>): Persona {
  return { ...base, profile: { ...base.profile!, ...extra } };
}

// ---------------------------------------------------------------------------
// Before approval

describe('asking to join', () => {
  const newcomer = withProfile(personas.pending, { join_requested_at: null, requested_role: null });

  it('asks a new member to request to join, and nothing of the club', async () => {
    await openHome(newcomer);
    expect(screen.getByText('Request to join the club')).toBeTruthy();
    expect(screen.queryByText('Waiting for approval')).toBeNull();
    expect(screen.queryByText('To do')).toBeNull();
    expect(screen.queryByText('Coming up')).toBeNull();
    // The code is only shown once they've asked.
    expect(rpcNames()).not.toContain('my_verification_code');
    fireEvent.press(screen.getByText('Request to join'));
    expect(push).toHaveBeenCalledWith('/join');
  });
});

describe('waiting for approval', () => {
  it('shows their 6-digit code, read out digit by digit, and lets them edit the request', async () => {
    await openHome('pending');
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText('123 456')).toBeTruthy();
    expect(screen.getByLabelText('Your code is 1 2 3 4 5 6')).toBeTruthy();
    expect(screen.getByText(/Never share it with anyone else\./)).toBeTruthy();
    fireEvent.press(screen.getByText('Edit request'));
    expect(push).toHaveBeenCalledWith('/join');
  });

  it('once an admin has confirmed who they are, shows no code', async () => {
    await openHome(withProfile(personas.pending, { verified_at: '2026-10-17T00:00:00Z' }));
    expect(screen.getByText('✓ A club admin has confirmed who you are.')).toBeTruthy();
    expect(screen.queryByText('123 456')).toBeNull();
    expect(rpcNames()).not.toContain('my_verification_code');
  });

  it('shows no code when the database has none for them', async () => {
    await openHome('pending', {}, { rpcs: { my_verification_code: null } });
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.queryByText('Your code')).toBeNull();
  });

  const child = withProfile(personas.pending, {
    requested_role: 'athlete',
    declared_date_of_birth: '2011-03-02',
    guardian_email: 'parent@example.test',
  });

  it('asks an athlete under 18 to have the parent they named join, and who can help', async () => {
    await openHome(child, {}, { rpcs: { safeguarding_contacts: null } });
    expect(screen.getByText('Ask your parent or guardian to join')).toBeTruthy();
    expect(screen.getByText(/, signing in with parent@example\.test\./)).toBeTruthy();
    expect(screen.getByText('If anything worries you, these people can help:')).toBeTruthy();
  });

  it('leaves the email out when the child gave none', async () => {
    await openHome(withProfile(child, { guardian_email: null }));
    expect(screen.getByText(/needs to join the club in the app too\. A club admin/)).toBeTruthy();
  });

  it.each<[string, Partial<Profile>]>([
    ['an adult athlete', { requested_role: 'athlete', declared_date_of_birth: '1990-05-05' }],
    ['a child asking to be a guest', { requested_role: 'guest', declared_date_of_birth: '2011-03-02' }],
    ['an athlete with no date of birth', { requested_role: 'athlete', declared_date_of_birth: null }],
  ])('asks %s for no parent', async (_l, extra) => {
    await openHome(withProfile(personas.pending, extra));
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.queryByText('Ask your parent or guardian to join')).toBeNull();
  });
});

describe('a request turned down', () => {
  it.each<[RejectionReason, RegExp]>([
    ['playhq_email_mismatch', /^Your PlayHQ email didn't match our registrations\./],
    ['not_registered', /^We couldn't find you in our club registrations\./],
    ['other', /^Contact the club, or show a club admin the code below/],
  ])('says why (%s), shows the code and offers Request again', async (reason, message) => {
    await openHome(withProfile(personas.rejected, { rejection_reason: reason }));
    expect(screen.getByText('Request not approved')).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByText('123 456')).toBeTruthy();
    fireEvent.press(screen.getByText('Request again'));
    expect(push).toHaveBeenCalledWith('/join');
  });

  it('with no reason given, says so plainly', async () => {
    await openHome(withProfile(personas.rejected, { rejection_reason: null }));
    expect(screen.getByText(/^Your request to join was not approved\./)).toBeTruthy();
  });

  it('a turned-down helper sees the request card, not the helper steps', async () => {
    await openHome(withProfile(personas.rejected, { requested_role: 'volunteer' }));
    expect(screen.getByText('Request not approved')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Paused roles

function exemption(extra: Partial<MyVolunteerExemption>): MyVolunteerExemption {
  return {
    basis: 'parent_volunteer',
    child_name: 'Sample Child',
    declared_at: '2026-09-01T00:00:00Z',
    declaration_text: 'I declare…',
    valid: false,
    ends_on: null,
    starts_on: null,
    event_name: null,
    organiser: null,
    ...extra,
  };
}

/** A coach with no check, relying on an exemption. */
const exemptCoach = (e: MyVolunteerExemption): Persona => ({
  ...withProfile(personas.coach, { wwcc_number: null, wwcc_expires_on: null }),
  exemption: e,
});

describe('paused roles', () => {
  it('a stood-down coach is told to talk to an admin, with no reason given', async () => {
    await openHome('stoodDownCoach');
    expect(screen.getByText('Coach paused')).toBeTruthy();
    expect(
      screen.getByText('Your coach role is paused by a club admin. Talk to a club admin about it.'),
    ).toBeTruthy();
    // The header shows the role as paused, not as a guest.
    expect(screen.getByText('Coach (paused)')).toBeTruthy();
  });

  it('a coach with an expired check is told to renew it', async () => {
    await openHome('coachExpiredCheck');
    expect(
      screen.getByText(
        "Your Working With Children Check has expired or isn't recorded, so your coach role is paused. Renew it, then send a club admin the new card number and expiry date.",
      ),
    ).toBeTruthy();
  });

  it('names every paused role, keeping the usable ones in the header', async () => {
    await openHome('adminLapsedCoach');
    expect(screen.getByText('Coach paused')).toBeTruthy();
    expect(screen.getByText('Admin, Coach (paused)')).toBeTruthy();
  });

  it('waits for the exemption declaration, and lists it to do', async () => {
    await openHome(exemptCoach(exemption({ declared_at: null })));
    expect(
      screen.getByText(
        'Your coach role is paused until you accept the exemption declaration. Open it from your to-do list.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Accept the exemption declaration')).toBeTruthy();
  });

  it.each<[string, Partial<MyVolunteerExemption>, string]>([
    ['a parent’s', {}, 'Your exemption as Sample Child’s parent no longer applies'],
    ['a parent’s, unnamed child', { child_name: null }, 'Your exemption as your child’s parent no longer applies'],
    [
      'a national event',
      { basis: 'national_event', ends_on: '2026-10-10' },
      `Your national event exemption ended on ${formatDateString('2026-10-10')}`,
    ],
    ['a visitor’s', { basis: 'short_term_visitor', ends_on: null }, 'Your short-term visitor exemption ended'],
    ['an under-18 volunteer’s', { basis: 'under_18_volunteer' }, 'Your exemption as an under-18 volunteer ended when you turned 18'],
  ])('says when %s exemption has ended, and to apply for a check', async (_l, extra, start) => {
    await openHome(exemptCoach(exemption(extra)));
    expect(
      screen.getByText(
        `${start}, so your coach role is paused. Apply for a Working With Children Check, then send a club admin the card number and expiry date.`,
      ),
    ).toBeTruthy();
  });

  it('a coach whose exemption applies is not paused', async () => {
    await openHome(exemptCoach(exemption({ valid: true })));
    expect(screen.queryByText('Coach paused')).toBeNull();
    expect(screen.getByText('Open A')).toBeTruthy();
  });
});

describe('the committee checks date', () => {
  it('warns a committee member with no check before the date', async () => {
    await openHome({
      ...withProfile(personas.committee, { wwcc_number: null, wwcc_expires_on: null }),
      rpcs: { committee_checks_from: '2026-12-01' },
    });
    expect(
      screen.getByText('Your committee role needs a Working With Children Check from 01/12/2026'),
    ).toBeTruthy();
    expect(screen.queryByText('Committee paused')).toBeNull();
  });

  it('once the date has passed, pauses the role instead', async () => {
    await openHome('committeePastChecksDate');
    expect(screen.getByText('Committee paused')).toBeTruthy();
    expect(screen.queryByText(/needs a Working With Children Check from/)).toBeNull();
  });

  it.each<[string, Partial<Profile>]>([
    ['who has a check', {}],
    ['who is exempt', { wwcc_number: null, wwcc_expires_on: null, wwcc_exempt_reason: 'Never works with children' }],
  ])('doesn’t warn a committee member %s', async (_l, extra) => {
    await openHome({ ...withProfile(personas.committee, extra), rpcs: { committee_checks_from: '2026-12-01' } });
    expect(screen.queryByText(/needs a Working With Children Check from/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The to-do list

function task(id: string, title: string, due_on: string | null, created_at = '2026-10-01T00:00:00Z'): PersonalTask {
  return { id, title, due_on, done_at: null, created_at };
}

const TASKS = [
  task('t-later', 'Book a physio follow-up', '2026-11-30'),
  task('t-none', 'Wash my training kit', null),
  task('t-overdue', 'Return the club bib', '2026-10-15'),
  task('t-soon', 'Pay fees', '2026-10-20'),
];

describe('the to-do list', () => {
  /** Titles of the to-do rows, top to bottom. */
  function rows() {
    const titles = [
      'Return the club bib',
      'Pay fees',
      'Do your daily check-in',
      'Book a physio follow-up',
      'Wash my training kit',
    ];
    const all = screen.getAllByText(new RegExp(`^(${titles.join('|')})$`));
    return all.map((n) => n.props.children as string);
  }

  it('puts overdue first, then due soon, then the club’s items, then other tasks', async () => {
    await openHome('athlete', { personal_tasks: TASKS, check_ins: [] });
    expect(rows()).toEqual([
      'Return the club bib',
      'Pay fees',
      'Do your daily check-in',
      'Book a physio follow-up',
      'Wash my training kit',
    ]);
    expect(screen.getByText(taskDetail(TASKS[2], TODAY))).toBeTruthy();
    expect(screen.getByText(taskDetail(TASKS[3], TODAY))).toBeTruthy();
    expect(taskDetail(TASKS[2], TODAY)).toMatch(/^Personal · Overdue since /);
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Due soon')).toBeTruthy();
  });

  it('counts every item on the badge', async () => {
    await openHome('athlete', { personal_tasks: TASKS, check_ins: [] });
    // The heading's badge: four tasks and the check-in.
    const heading = screen.getByText('To do');
    let row = heading.parent!;
    while (!within(row).queryByText('5')) row = row.parent!;
    expect(within(row).getAllByText(/^\d+$/).map((n) => String(n.props.children))).toEqual(['5']);
  });

  it('opens a club item where it’s done', async () => {
    await openHome('athlete', { check_ins: [] });
    fireEvent.press(screen.getByText('Do your daily check-in'));
    expect(push).toHaveBeenCalledWith('/check-in');
  });

  it('says they’re caught up when there’s nothing', async () => {
    await openHome('committee');
    expect(screen.getByText('✓ You’re all caught up.')).toBeTruthy();
  });

  it('ticking off a task saves it as done and offers Undo, which puts it back', async () => {
    const tasks = recordTable(() => [TASKS[3]]);
    await openHome('committee', {}, { tableHandlers: { personal_tasks: tasks.handler } });
    fireEvent.press(screen.getByLabelText('Tick off Pay fees'));
    await settle();
    expect(screen.queryByLabelText('Tick off Pay fees')).toBeNull();
    expect(screen.getByText('Ticked off Pay fees')).toBeTruthy();
    expect(tasks.writes('update')).toEqual([{ done_at: '2026-10-18T02:00:00.000Z' }]);
    expect(tasks.filtersOf('update')).toEqual([[['id', 't-soon']]]);
    fireEvent.press(screen.getByText('Undo'));
    await settle();
    expect(tasks.writes('update')[1]).toEqual({ done_at: null });
    expect(screen.getByLabelText('Tick off Pay fees')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The footer

describe('the footer', () => {
  it('opens Your details and Delete account', async () => {
    await openHome('athlete');
    fireEvent.press(screen.getByText('Your details'));
    expect(push).toHaveBeenCalledWith('/my-details');
    fireEvent.press(screen.getByText('Delete account'));
    expect(push).toHaveBeenCalledWith('/delete-account');
  });

  it('signs out', async () => {
    await openHome('athlete');
    fireEvent.press(screen.getByText('Sign out'));
    await settle();
    expect((supabase.auth as unknown as { signOut: jest.Mock }).signOut).toHaveBeenCalled();
  });

  it('greets the member by preferred name, then full name', async () => {
    await openHome(withProfile(personas.athlete, { preferred_name: 'Sam' }));
    expect(screen.getByText('Hi Sam')).toBeTruthy();
  });

  it('every member can raise a concern, even before approval', async () => {
    await openHome('pending');
    fireEvent.press(screen.getByText('Raise a concern'));
    expect(push).toHaveBeenCalledWith('/concern/new');
    expect(argsOf('my_verification_code')).toHaveLength(1);
  });
});
