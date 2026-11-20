/**
 * The Home screen's states that home-by-role.test.tsx doesn't cover
 * (src/app/index.tsx): asking to join, waiting for approval (with the
 * verification code, an under-18 athlete's link code for a parent, and a
 * parent's box for their child's code), a locked child, a request
 * turned down for each reason, roles paused for each reason, the committee
 * checks date, the order of the to-do list, and the footer links. From "Ask to
 * join the club", "Wait for approval" and "The home screen" in sections 2 and
 * 3 of docs/user-guide.md.
 */
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';

import { Share } from 'react-native';

import HomeScreen from '@/app/index';
import { formatDateString } from '@/lib/injuries';
import { taskDetail, type PersonalTask } from '@/lib/personal-tasks';
import { supabase } from '@/lib/supabase';
import type {
  MyVolunteerExemption,
  MyWwccApplication,
  MyWwccSubmission,
  Profile,
  RejectionReason,
} from '@/lib/types';

import { argsOf, clearCalls, field, recordTable, rpcNames, type } from './helpers/forms';
import {
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
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
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

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
    await fireEvent.press(screen.getByText('Request to join'));
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
    await fireEvent.press(screen.getByText('Edit request'));
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

  const linkCode = {
    waiting: true,
    code: '7KQ4MD',
    expires_at: '2026-10-25T12:00:00Z',
    parents_waiting: [] as string[],
  };

  it('shows an athlete under 18 their link code to share with a parent, and who can help', async () => {
    await openHome(child, {}, { rpcs: { safeguarding_contacts: null, my_link_code: linkCode } });
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText('Waiting for your parent or guardian')).toBeTruthy();
    expect(screen.getByText('7KQ-4MD')).toBeTruthy();
    expect(screen.getByLabelText('Your link code is 7 K Q 4 M D')).toBeTruthy();
    expect(screen.getByText(`Works once, until ${formatDateString('2026-10-25')}`)).toBeTruthy();
    expect(screen.getByText(/needs to join the club in the app too\. Share this code/)).toBeTruthy();
    expect(screen.getByText(/links you before approving you\./)).toBeTruthy();
    expect(screen.getByText('If anything worries you, these people can help:')).toBeTruthy();
    // They can still change their request.
    expect(screen.getByText('Edit request')).toBeTruthy();
  });

  it('says which parents have entered the code', async () => {
    await openHome(child, {}, {
      rpcs: { my_link_code: { ...linkCode, parents_waiting: ['Pat Parent', 'Sam Parent'] } },
    });
    expect(
      screen.getByText('✓ Pat Parent has entered your code. A club admin will check and link them.'),
    ).toBeTruthy();
    expect(
      screen.getByText('✓ Sam Parent has entered your code. A club admin will check and link them.'),
    ).toBeTruthy();
  });

  it('shares the code with the child’s name, the club and the app', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await openHome(child, {}, { rpcs: { my_link_code: linkCode } });
    await fireEvent.press(screen.getByText('Share code'));
    expect(share).toHaveBeenCalledWith({
      message:
        'Sample pending is joining Sample Club on FirstPass HQ. Install the FirstPass HQ app, sign in, ' +
        'ask to join as a parent or guardian and enter this code: 7KQ-4MD. It works once, for 7 days.',
    });
    share.mockRestore();
  });

  it('copies the code, and says so', async () => {
    await openHome(child, {}, { rpcs: { my_link_code: linkCode } });
    await fireEvent.press(screen.getByText('Copy code'));
    await settle();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('7KQ-4MD');
    expect(screen.getByText('Code copied')).toBeTruthy();
  });

  it('makes a new code, and shows it', async () => {
    let current = linkCode;
    await openHome(child, {}, {
      rpcHandlers: {
        my_link_code: () => current,
        new_link_code: () => {
          current = { ...linkCode, code: 'ABC234' };
          return [current];
        },
      },
    });
    await fireEvent.press(screen.getByText('Make a new code'));
    await settle();
    expect(rpcNames()).toContain('new_link_code');
    expect(screen.getByText('ABC-234')).toBeTruthy();
    expect(screen.queryByText('7KQ-4MD')).toBeNull();
  });

  it('says why a new code couldn’t be made', async () => {
    await openHome(child, {}, {
      rpcs: { my_link_code: linkCode },
      rpcErrors: { new_link_code: 'Only a child waiting for a parent or guardian has a link code' },
    });
    await fireEvent.press(screen.getByText('Make a new code'));
    await settle();
    expect(
      screen.getByText('Only a child waiting for a parent or guardian has a link code'),
    ).toBeTruthy();
  });

  it.each<[string, Partial<Profile>]>([
    ['an adult athlete', { requested_role: 'athlete', declared_date_of_birth: '1990-05-05' }],
    ['a child asking to be a guest', { requested_role: 'guest', declared_date_of_birth: '2011-03-02' }],
    ['an athlete with no date of birth', { requested_role: 'athlete', declared_date_of_birth: null }],
  ])('asks %s for no parent: the database says they aren’t waiting for one', async (_l, extra) => {
    await openHome(withProfile(personas.pending, extra), {}, {
      rpcs: { my_link_code: { waiting: false, code: null, expires_at: null, parents_waiting: [] } },
    });
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.queryByText('Waiting for your parent or guardian')).toBeNull();
    expect(screen.queryByText('If anything worries you, these people can help:')).toBeNull();
  });

  it('asks a parent or guardian for their child’s code', async () => {
    await openHome(withProfile(personas.pending, { requested_role: 'guardian' }));
    expect(screen.getByText(/then approves you, which links you to them\./)).toBeTruthy();
    expect(screen.getByText('Enter your child’s code')).toBeTruthy();
    expect(screen.queryByText('Waiting for your parent or guardian')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A parent or guardian entering their child's link code

describe('entering a child’s code', () => {
  const guardianWaiting = withProfile(personas.pending, { requested_role: 'guardian' });

  it('sends the code as typed, and shows the child once it’s taken', async () => {
    let requests: unknown[] = [];
    await openHome(guardianWaiting, {}, {
      rpcHandlers: {
        my_link_requests: () => requests,
        enter_child_code: () => {
          requests = [
            { athlete_id: 'kid', athlete_name: 'Jordan Sample', requested_at: '2026-10-18T01:00:00Z' },
          ];
          return null;
        },
      },
    });
    await type('Child’s code', '7kq-4md');
    await fireEvent.press(screen.getByText('Enter code'));
    await settle();
    expect(argsOf('enter_child_code')).toEqual([{ p_code: '7kq-4md' }]);
    expect(
      screen.getByText('✓ You’ve entered Jordan Sample’s code. A club admin will check and link you.'),
    ).toBeTruthy();
    expect(field('Child’s code').props.value).toBe('');
  });

  it('says why the database turned a code down, and keeps it to fix', async () => {
    await openHome(guardianWaiting, {}, {
      rpcHandlers: {
        enter_child_code: () =>
          'That code isn’t right, or it has expired. Check it with your child, or ask them to make a new one.',
      },
    });
    await type('Child’s code', '7KQ4MD');
    await fireEvent.press(screen.getByText('Enter code'));
    await settle();
    expect(screen.getByText(/^That code isn’t right, or it has expired\./)).toBeTruthy();
    expect(field('Child’s code').props.value).toBe('7KQ4MD');
  });

  it('shows a refusal that comes back as an error', async () => {
    await openHome(guardianWaiting, {}, {
      rpcErrors: { enter_child_code: 'Ask to join as a parent or guardian first' },
    });
    await type('Child’s code', '7KQ4MD');
    await fireEvent.press(screen.getByText('Enter code'));
    await settle();
    expect(screen.getByText('Ask to join as a parent or guardian first')).toBeTruthy();
  });

  it.each(['', '7KQ4M', '7KQ-4M0'])('checks %j looks like a code before asking', async (typed) => {
    await openHome(guardianWaiting);
    await type('Child’s code', typed);
    await fireEvent.press(screen.getByText('Enter code'));
    await settle();
    expect(screen.getByText('Enter the 6-letter code from your child’s app, such as 7KQ-4MD.')).toBeTruthy();
    expect(rpcNames()).not.toContain('enter_child_code');
  });

  it('lists the children whose code they already entered', async () => {
    await openHome(guardianWaiting, {}, {
      rpcs: {
        my_link_requests: [
          { athlete_id: 'a', athlete_name: 'Jordan Sample', requested_at: '2026-10-18T01:00:00Z' },
          { athlete_id: 'b', athlete_name: null, requested_at: '2026-10-18T02:00:00Z' },
        ],
      },
    });
    expect(screen.getByText(/You’ve entered Jordan Sample’s code\./)).toBeTruthy();
    expect(screen.getByText(/You’ve entered your child’s code\./)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A parent asking the club to add a child who won't use the app

describe('a child who won’t use the app', () => {
  const guardianWaiting = withProfile(personas.pending, { requested_role: 'guardian' });

  it('asks the club to add the child, then shows the request', async () => {
    let requests: unknown[] = [];
    await openHome(guardianWaiting, {}, {
      rpcHandlers: {
        my_no_app_child_requests: () => requests,
        request_no_app_child: () => {
          requests = [
            { id: 'r1', full_name: 'Sam Small', date_of_birth: '2016-05-04', team_name: null, requested_at: '2026-10-18T01:00:00Z' },
          ];
          return 'r1';
        },
      },
    });
    expect(screen.getByText('Child who won’t use the app')).toBeTruthy();
    await fireEvent.press(screen.getByText('Add a child who won’t use the app'));
    await settle();
    await type('Child’s name', 'Sam Small');
    await type('Child’s date of birth', '4/5/2016');
    await fireEvent.press(screen.getByText('Ask the club to add them'));
    await settle();
    expect(argsOf('request_no_app_child')).toEqual([
      { p_full_name: 'Sam Small', p_date_of_birth: '2016-05-04', p_team_id: null },
    ]);
    expect(
      screen.getByText('✓ You’ve asked the club to add Sam Small. A club admin will check and add them.'),
    ).toBeTruthy();
    expect(screen.queryByText('Ask the club to add them')).toBeNull();
  });

  it('checks the child is under 18 before asking', async () => {
    await openHome(guardianWaiting);
    await fireEvent.press(screen.getByText('Add a child who won’t use the app'));
    await settle();
    await type('Child’s name', 'Sam Small');
    await type('Child’s date of birth', '01/01/2000');
    await fireEvent.press(screen.getByText('Ask the club to add them'));
    await settle();
    expect(screen.getByText(/^Only children under 18 can be added/)).toBeTruthy();
    expect(rpcNames()).not.toContain('request_no_app_child');
  });

  it('shows why the database turned it down', async () => {
    await openHome(guardianWaiting, {}, {
      rpcErrors: { request_no_app_child: 'You’ve asked for 6 children already.' },
    });
    await fireEvent.press(screen.getByText('Add a child who won’t use the app'));
    await settle();
    await type('Child’s name', 'Sam Small');
    await type('Child’s date of birth', '04/05/2016');
    await fireEvent.press(screen.getByText('Ask the club to add them'));
    await settle();
    expect(screen.getByText('You’ve asked for 6 children already.')).toBeTruthy();
  });

  it('withdraws a request', async () => {
    let requests: unknown[] = [
      { id: 'r1', full_name: 'Sam Small', date_of_birth: '2016-05-04', team_name: 'Open A', requested_at: '2026-10-18T01:00:00Z' },
    ];
    await openHome(guardianWaiting, {}, {
      rpcHandlers: {
        my_no_app_child_requests: () => requests,
        withdraw_no_app_child_request: () => {
          requests = [];
          return null;
        },
      },
    });
    expect(screen.getByText(/You’ve asked the club to add Sam Small \(Open A\)\./)).toBeTruthy();
    await fireEvent.press(screen.getByText('Withdraw'));
    await settle();
    expect(argsOf('withdraw_no_app_child_request')).toEqual([{ p_request_id: 'r1' }]);
    expect(screen.queryByText(/You’ve asked the club to add Sam Small/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A child under 18 with no verified parent or guardian linked: locked

describe('a locked child', () => {
  const linkCode = { waiting: true, code: '7KQ4MD', expires_at: null, parents_waiting: [] };
  const locked: Persona = {
    ...personas.minorAthlete,
    rpcs: { ...personas.minorAthlete.rpcs, my_link_code: linkCode },
  };

  it('sees only their link code, who can help, Raise a concern and how to leave', async () => {
    await openHome(locked);
    expect(screen.getByText('Waiting for your parent or guardian')).toBeTruthy();
    expect(screen.getByText('7KQ-4MD')).toBeTruthy();
    expect(screen.getByText(/the app stays locked until a parent or guardian is linked to you\./)).toBeTruthy();
    expect(screen.getByText(/and then the app opens for you\./)).toBeTruthy();
    expect(screen.getByText('If anything worries you, these people can help:')).toBeTruthy();
    expect(screen.getByText('Raise a concern')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
    expect(screen.getByText('Switch club')).toBeTruthy();
    expect(screen.getByText('Delete account')).toBeTruthy();
    // Nothing of the club, and no request to change.
    for (const hidden of [
      'Waiting for approval',
      'Edit request',
      'To do',
      'Coming up',
      'My squads and teams',
      'Messages',
      'Your details',
    ]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    // The header doesn't call them an athlete yet.
    expect(screen.queryByText('Athlete')).toBeNull();
  });

  it('is unlocked once the database says a verified parent is linked', async () => {
    await openHome(personas.minorAthlete, {}, {
      rpcs: { my_link_code: { waiting: false, code: null, expires_at: null, parents_waiting: [] } },
    });
    expect(screen.queryByText('Waiting for your parent or guardian')).toBeNull();
    expect(screen.getByText('Your details')).toBeTruthy();
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
    await fireEvent.press(screen.getByText('Request again'));
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
        "Your Working With Children Check has expired or isn't recorded, so your coach role is paused. Apply for one or renew it, then add your card below. A club admin checks it, and your role starts again once they accept it. If you never work with children, ask an admin to exempt you with the reason.",
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
        `${start}, so your coach role is paused. Apply for a Working With Children Check, then add your card below. A club admin checks it, and your role starts again once they accept it.`,
      ),
    ).toBeTruthy();
  });

  it('a coach whose exemption applies is not paused', async () => {
    await openHome(exemptCoach(exemption({ valid: true })));
    expect(screen.queryByText('Coach paused')).toBeNull();
    expect(screen.getByText('Open A')).toBeTruthy();
  });
});

describe('sending in your own check', () => {
  const sent = (extra: Partial<MyWwccSubmission> = {}): MyWwccSubmission => ({
    id: 'sub-1',
    card_number: 'WWC1234567',
    expires_on: '2029-10-01',
    card_name: 'Casey Coach',
    submitted_at: '2026-10-17T00:00:00Z',
    status: 'waiting',
    decided_at: null,
    return_note: null,
    ...extra,
  });

  it('a paused coach adds their card from the paused card and from the to-do list', async () => {
    await openHome('coachExpiredCheck');
    expect(screen.getByText('Add your Working With Children Check')).toBeTruthy();
    expect(screen.getByText('Your role is paused until a club admin checks it')).toBeTruthy();
    await fireEvent.press(screen.getByText('Add your card'));
    expect(push).toHaveBeenCalledWith('/wwcc');
    push.mockClear();
    await fireEvent.press(screen.getByText('Add your Working With Children Check'));
    expect(push).toHaveBeenCalledWith('/wwcc');
  });

  it('shows a card waiting for an admin, keeps the role paused, and lists nothing to do', async () => {
    await openHome('coachExpiredCheck', {}, { rpcs: { my_wwcc_submission: sent() } });
    expect(screen.getByText('Coach paused')).toBeTruthy();
    expect(
      screen.getByText(
        `You sent in your card WWC1234567, expiring 01/10/2029. A club admin will check it with the Screening Unit. Your role starts again once they accept it.`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Change what you sent')).toBeTruthy();
    expect(screen.queryByText('Add your Working With Children Check')).toBeNull();
  });

  it('shows a card an admin sent back, with their note, and lists it to send again', async () => {
    await openHome('coachExpiredCheck', {}, {
      rpcs: {
        my_wwcc_submission: sent({
          status: 'returned',
          decided_at: '2026-10-18T00:00:00Z',
          return_note: 'The expiry is different',
        }),
      },
    });
    expect(screen.getByText('Send your Working With Children Check again')).toBeTruthy();
    expect(screen.getByText('Sent back: The expiry is different')).toBeTruthy();
    await fireEvent.press(screen.getByText('Send it again'));
    expect(push).toHaveBeenCalledWith('/wwcc');
  });

  it('offers nothing to a stood-down coach, whose card isn’t the reason', async () => {
    await openHome('stoodDownCoach');
    expect(screen.queryByText('Add your card')).toBeNull();
    expect(screen.queryByText('Add your Working With Children Check')).toBeNull();
  });

  it('offers nothing while an exemption declaration waits to be accepted', async () => {
    await openHome(exemptCoach(exemption({ declared_at: null })));
    expect(screen.queryByText('Add your card')).toBeNull();
    expect(screen.queryByText('Add your Working With Children Check')).toBeNull();
  });

  it('asks a coach whose card expires soon for the renewed one, without pausing them', async () => {
    await openHome(withProfile(personas.coach, { wwcc_expires_on: '2026-11-01' }));
    expect(screen.queryByText('Coach paused')).toBeNull();
    expect(screen.getByText('Add your renewed Working With Children Check')).toBeTruthy();
  });

  it('asks a coach with a current card for nothing', async () => {
    await openHome('coach');
    expect(screen.queryByText('Add your renewed Working With Children Check')).toBeNull();
    expect(screen.queryByText('Add your Working With Children Check')).toBeNull();
  });

  it('asks admins to check cards members sent in, and opens those members', async () => {
    await openHome('admin', {}, {
      rpcs: {
        admin_safety_todos: {},
        admin_wwcc_submissions: [{ id: 's1', profile_id: 'm1' }, { id: 's2', profile_id: 'm2' }],
      },
    });
    await fireEvent.press(
      screen.getByText('Check 2 Working With Children Checks members sent in'),
    );
    expect(push).toHaveBeenCalledWith({ pathname: '/admin', params: { todo: 'wwcc-sent' } });
  });
});

describe('a lodged check application', () => {
  const application = (extra: Partial<MyWwccApplication> = {}): MyWwccApplication => ({
    id: 'application-1',
    application_number: 'APL 123',
    lodged_on: '2026-10-10',
    kind: 'new',
    declaration_text: 'I applied for a Working With Children Check…',
    declared_at: '2026-10-11T00:00:00Z',
    lapses_on: '2027-01-08',
    status: 'in_force',
    valid: true,
    ...extra,
  });
  const appliedCoach = (a: MyWwccApplication): Persona => ({
    ...withProfile(personas.coach, { wwcc_number: null, wwcc_expires_on: null }),
    wwccApplication: a,
  });

  it('keeps a coach coaching while their application is in force', async () => {
    await openHome(appliedCoach(application()));
    expect(screen.queryByText('Coach paused')).toBeNull();
    expect(screen.getByText('Open A')).toBeTruthy();
    expect(screen.queryByText('Confirm your Working With Children Check application')).toBeNull();
  });

  it('waits for the declaration, and opens it from the to-do list', async () => {
    await openHome(
      appliedCoach(application({ declared_at: null, status: 'waiting_for_declaration', valid: false })),
    );
    expect(
      screen.getByText(
        'Your coach role is paused until you accept the declaration for your Working With Children Check application. Open it from your to-do list.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm your Working With Children Check application'));
    expect(push).toHaveBeenCalledWith('/wwcc-application');
  });

  it('says when it has lapsed, and lists nothing to accept', async () => {
    await openHome(appliedCoach(application({ status: 'lapsed', valid: false })));
    expect(
      screen.getByText(
        'Your Working With Children Check application has lapsed because nobody confirmed it’s still being assessed, so your coach role is paused. Ask a club admin to check it, or add your card below if it has arrived.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Confirm your Working With Children Check application')).toBeNull();
  });

  it('lists nothing to accept for a stopped application that was never accepted', async () => {
    await openHome(
      appliedCoach(application({ declared_at: null, status: 'stopped', valid: false })),
    );
    expect(screen.queryByText('Confirm your Working With Children Check application')).toBeNull();
    expect(screen.getByText('Coach paused')).toBeTruthy();
  });

  it('asks admins to confirm applications that are due, and opens the members whose are due', async () => {
    await openHome('admin', {}, {
      rpcs: {
        admin_safety_todos: {},
        admin_wwcc_applications: [
          { id: 'a1', profile_id: 'm1', status: 'in_force', check_due_on: '2026-10-18', ended_at: null },
          { id: 'a2', profile_id: 'm2', status: 'lapsed', check_due_on: '2026-09-01', ended_at: null },
        ],
      },
    });
    expect(screen.getByText('Confirm 2 check applications are still being assessed')).toBeTruthy();
    expect(screen.getByText('1 lapsed. Check online, then confirm on the member’s page.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm 2 check applications are still being assessed'));
    expect(push).toHaveBeenCalledWith({ pathname: '/admin', params: { todo: 'wwcc-application' } });
  });

  it('asks admins nothing for applications not yet due', async () => {
    await openHome('admin', {}, {
      rpcs: {
        admin_safety_todos: {},
        admin_wwcc_applications: [
          { id: 'a1', profile_id: 'm1', status: 'in_force', check_due_on: '2026-10-19', ended_at: null },
        ],
      },
    });
    expect(screen.queryByText(/check applications? (is|are) still being assessed/)).toBeNull();
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

describe('the statistician checks date', () => {
  it('warns a statistician with no check before the date', async () => {
    await openHome('statisticianBeforeChecksDate');
    expect(
      screen.getByText('Your statistician role needs a Working With Children Check from 21/01/2099'),
    ).toBeTruthy();
    expect(screen.getByText(/pauses on that day, in HQ and in Vantage/)).toBeTruthy();
    expect(screen.queryByText('Statistician paused')).toBeNull();
  });

  it('once the date has passed, pauses the role instead', async () => {
    await openHome('statisticianPastChecksDate');
    expect(screen.getByText('Statistician paused')).toBeTruthy();
    expect(screen.queryByText(/needs a Working With Children Check from/)).toBeNull();
  });

  it.each<[string, Partial<Profile>]>([
    ['who has a check', { wwcc_number: 'WWC1234567', wwcc_expires_on: '2028-01-01' }],
    ['who is exempt', { wwcc_exempt_reason: 'Opens games only' }],
  ])('doesn’t warn a statistician %s', async (_l, extra) => {
    await openHome({
      ...withProfile(personas.statistician, extra),
      rpcs: { statistician_checks_from: '2099-01-21' },
    });
    expect(screen.queryByText(/needs a Working With Children Check from/)).toBeNull();
  });

  it('doesn’t warn a committee member about the statistician date', async () => {
    await openHome({
      ...withProfile(personas.committee, { wwcc_number: null, wwcc_expires_on: null }),
      rpcs: { statistician_checks_from: '2099-01-21' },
    });
    expect(screen.queryByText(/statistician role needs/)).toBeNull();
  });
});

describe('an admin whose check lapsed over 30 days ago', () => {
  it('is told they can’t see under 18s’ injuries, and keeps the admin home', async () => {
    await openHome('adminLapsedCheck');
    expect(screen.getByText('You can’t see under 18s’ injuries right now')).toBeTruthy();
    expect(screen.getByText(/You keep everything else an admin can do/)).toBeTruthy();
    expect(screen.queryByText('Admin paused')).toBeNull();
  });

  it('says nothing to an admin who still sees them', async () => {
    await openHome('admin');
    expect(screen.queryByText('You can’t see under 18s’ injuries right now')).toBeNull();
  });

  it('never asks for members who aren’t admins', async () => {
    await openHome({ ...personas.coach, rpcs: { my_admin_sees_children_injuries: false } });
    expect(screen.queryByText('You can’t see under 18s’ injuries right now')).toBeNull();
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
    await fireEvent.press(screen.getByText('Do your daily check-in'));
    expect(push).toHaveBeenCalledWith('/check-in');
  });

  it('tells admins when nobody can endorse an athlete’s clearance, and opens the club’s physios', async () => {
    await openHome('admin', {}, {
      rpcs: {
        admin_safety_todos: {},
        admin_unendorsable_clearances: [{ injury_id: 'i1', athlete_id: 'a1', athlete_name: 'Kai Senior', body_area: 'Knee' }],
      },
    });
    expect(screen.getByText('Nobody can endorse Kai Senior’s clearance')).toBeTruthy();
    expect(screen.getByText('Make a physio Head Physio, or place a physio in their squad or team')).toBeTruthy();
    await fireEvent.press(screen.getByText('Nobody can endorse Kai Senior’s clearance'));
    expect(push).toHaveBeenCalledWith({ pathname: '/admin', params: { todo: 'unendorsable' } });
  });

  it('warns admins when the nightly removal has stopped, and opens Record keeping', async () => {
    await openHome('admin', {}, {
      rpcs: {
        admin_safety_todos: {},
        removal_run_status: { last_run_at: null, last_ok_at: null, failed_step: null, overdue: true },
      },
    });
    expect(rpcNames().filter((n) => n === 'removal_run_status')).toHaveLength(1);
    expect(screen.getByText('Old records haven’t been removed yet')).toBeTruthy();
    expect(screen.getByText('The nightly removal hasn’t finished for 2 days. Ask FirstPass to check it.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Old records haven’t been removed yet'));
    expect(push).toHaveBeenCalledWith('/admin/club/records');
  });

  it('shows no removal warning while the nightly removal runs', async () => {
    await openHome('admin', {}, {
      rpcs: {
        admin_safety_todos: {},
        removal_run_status: { last_run_at: '2026-10-22T18:17:00Z', last_ok_at: '2026-10-22T18:17:00Z', failed_step: null, overdue: false },
      },
    });
    expect(screen.queryByText(/^Old records haven’t been removed/)).toBeNull();
  });

  it('never asks for the removal status for members who aren’t admins', async () => {
    await openHome('committee');
    expect(rpcNames()).not.toContain('removal_run_status');
  });

  it('shows no clearance tile when every clearance has someone to endorse it', async () => {
    await openHome('admin', {}, { rpcs: { admin_safety_todos: {}, admin_unendorsable_clearances: [] } });
    expect(screen.queryByText(/^Nobody can endorse/)).toBeNull();
  });

  it('says they’re caught up when there’s nothing', async () => {
    await openHome('committee');
    expect(screen.getByText('✓ You’re all caught up.')).toBeTruthy();
  });

  it('ticking off a task saves it as done and offers Undo, which puts it back', async () => {
    const tasks = recordTable(() => [TASKS[3]]);
    await openHome('committee', {}, { tableHandlers: { personal_tasks: tasks.handler } });
    await fireEvent.press(screen.getByLabelText('Tick off Pay fees'));
    await settle();
    expect(screen.queryByLabelText('Tick off Pay fees')).toBeNull();
    expect(screen.getByText('Ticked off Pay fees')).toBeTruthy();
    expect(tasks.writes('update')).toEqual([{ done_at: '2026-10-18T02:00:00.000Z' }]);
    expect(tasks.filtersOf('update')).toEqual([[['id', 't-soon']]]);
    await fireEvent.press(screen.getByText('Undo'));
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
    await fireEvent.press(screen.getByText('Your details'));
    expect(push).toHaveBeenCalledWith('/my-details');
    await fireEvent.press(screen.getByText('Delete account'));
    expect(push).toHaveBeenCalledWith('/delete-account');
  });

  it('signs out', async () => {
    await openHome('athlete');
    await fireEvent.press(screen.getByText('Sign out'));
    await settle();
    expect((supabase.auth as unknown as { signOut: jest.Mock }).signOut).toHaveBeenCalled();
  });

  it('shows an approved guardian their code until an admin verifies them', async () => {
    await openHome(withProfile(personas.guardian, { verified_at: null }), {}, {
      rpcs: { my_verification_code: '654321' },
    });
    expect(screen.getByText('Confirm who you are')).toBeTruthy();
    expect(screen.getByText('654 321')).toBeTruthy();
    expect(screen.getByLabelText('Your code is 6 5 4 3 2 1')).toBeTruthy();
  });

  it('shows a verified guardian no code', async () => {
    await openHome('guardian');
    expect(screen.queryByText('Confirm who you are')).toBeNull();
    expect(rpcNames()).not.toContain('my_verification_code');
  });

  it('greets the member by preferred name, then full name', async () => {
    await openHome(withProfile(personas.athlete, { preferred_name: 'Sam' }));
    expect(screen.getByText('Hi Sam')).toBeTruthy();
  });

  it('every member can raise a concern, even before approval', async () => {
    await openHome('pending');
    await fireEvent.press(screen.getByText('Raise a concern'));
    expect(push).toHaveBeenCalledWith('/concern/new');
    expect(argsOf('my_verification_code')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Wellbeing flags, for the Child Safety Officer

describe('athletes flagged 3 times in a week', () => {
  it('puts them on the Child Safety Officer’s to-do list, opening the flags', async () => {
    await openHome('safeguardingOfficer', {}, { rpcs: { wellbeing_flag_alerts: 2 } });
    await fireEvent.press(screen.getByText('Look at 2 athletes flagged 3 times this week'));
    expect(push).toHaveBeenCalledWith('/concerns/wellbeing');
  });

  it('adds nothing when nobody was flagged 3 times', async () => {
    await openHome('safeguardingOfficer', {}, { rpcs: { wellbeing_flag_alerts: 0 } });
    expect(screen.queryByText(/flagged 3 times this week/)).toBeNull();
  });

  it('never asks for members who don’t handle concerns', async () => {
    await openHome('coach', {}, { rpcs: { wellbeing_flag_alerts: 2 } });
    expect(rpcNames()).not.toContain('wellbeing_flag_alerts');
    expect(screen.queryByText(/flagged 3 times this week/)).toBeNull();
  });

  it('shows admins nothing, as the database gives them no count', async () => {
    await openHome('admin', {}, { rpcs: { wellbeing_flag_alerts: null } });
    expect(rpcNames()).toContain('wellbeing_flag_alerts');
    expect(screen.queryByText(/flagged 3 times this week/)).toBeNull();
  });

  it('adds nothing, without asking, when the club has check-ins turned off', async () => {
    setClubFeatures({ checkIns: false });
    await openHome('safeguardingOfficer', {}, { rpcs: { wellbeing_flag_alerts: 2 } });
    expect(rpcNames()).not.toContain('wellbeing_flag_alerts');
    expect(screen.queryByText(/flagged 3 times this week/)).toBeNull();
  });
});
