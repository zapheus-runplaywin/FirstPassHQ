/**
 * A join request as one decision, at the top of the member's page
 * (src/app/admin/[id].tsx with src/components/join-request.tsx): what an admin
 * sees for each kind of person asking to join, and what Approve and Don't
 * approve send.
 *
 * The rules ("Approving members" in section 10 of the user guide): the checks
 * come before Approve; Approve shows only when nothing is in its way, and
 * sends exactly what the full record's Approve sends; Don't approve always
 * needs a reason; and everything else is in the full record, one tap away.
 * Only admins reach this screen (the route tests cover that), so what changes
 * here is who is asking. The checks themselves are tested in
 * src/lib/__tests__/join-request.test.ts.
 */
import { screen, within } from 'expo-router/testing-library';

import MemberScreen from '@/app/admin/[id]';
import { supabase } from '@/lib/supabase';
import type { AppRole, Profile, Team } from '@/lib/types';

import {
  adminWrites,
  fieldFor,
  inSection,
  isChosen,
  onEveryTab,
  press,
  pressInSection,
  rpcsNamed,
  spyOnBack,
  typeInto,
} from './helpers/admin-screens';
import {
  openScreen,
  personas,
  resetClub,
  type BackendOptions,
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

jest.setTimeout(20_000);

let back: jest.SpyInstance;

// The full record is in tabs: these tests are about what the page holds and sends, on any tab.
onEveryTab();

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
  back = spyOnBack();
});

afterEach(() => {
  back.mockRestore();
});

const p = (name: PersonaName) => personas[name].profile!;

const SQUAD: Team = {
  id: 'squad-open',
  name: 'Open Squad',
  sort_order: 1,
  kind: 'squad',
  season: 2026,
  squad_id: null,
  selections_completed_at: null,
};

// Today is 18 October 2026 (the harness's TODAY).
const ADULT = '2001-03-09';
const CHILD = '2010-06-01';
const NO_CARD = { wwcc_number: null, wwcc_expires_on: null, wwcc_exempt_reason: null };

/** Someone waiting for approval who asked to join as `role`, with nothing checked yet. */
function asking(role: AppRole, extra: Partial<Profile> = {}): Profile {
  return {
    ...p('pending'),
    id: `asking-${role}`,
    full_name: 'Robin New',
    email: 'robin@example.test',
    role: 'guest',
    requested_role: role,
    requested_team_id: null,
    join_requested_at: '2026-10-15T08:00:00Z',
    verified_at: null,
    date_of_birth: null,
    declared_date_of_birth: null,
    guardian_email: null,
    ...NO_CARD,
    ...extra,
  };
}

const PARENT: Profile = {
  ...asking('guardian'),
  id: 'asking-parent',
  full_name: 'Sam New',
  email: 'sam@example.test',
};

/** Opens `target`'s page for an admin, with what the database holds about them. */
async function openRequest(
  target: Profile,
  {
    todo = '',
    people = [] as Profile[],
    // Link codes entered, and the people on the other side whatever their status.
    requests = [] as { guardian_id: string; athlete_id: string }[],
    others = [] as Profile[],
    placements = [] as { team_id: string; team_role: string; coach_title: string | null; selection: string | null }[],
    rpcErrors = {} as BackendOptions['rpcErrors'],
  } = {},
) {
  await openScreen(
    'admin',
    { 'admin/[id]': MemberScreen },
    `/admin/${target.id}${todo ? `?todo=${todo}` : ''}`,
    {
      teams: [SQUAD],
      guardianships: [],
      guardian_link_requests: requests,
      stand_downs: [],
      screening_notices: [],
      guardianship_history: [],
      policy_acknowledgements: [],
    },
    {
      tableHandlers: {
        profiles: (q) => {
          if (q.eq('id') === target.id) return [target];
          if (q.eq('status') === 'approved') return people;
          const ids = q.calls.find((c) => c.method === 'in')?.args[1] as string[] | undefined;
          if (ids) return [...people, ...others].filter((o) => ids.includes(o.id));
          return undefined;
        },
        team_members: (q) => (q.eq('profile_id') === target.id ? placements : []),
      },
      rpcs: {
        admin_volunteer_exemptions: [],
        admin_date_of_birth_record: null,
        admin_no_app_child_requests: [],
        admin_wwcc_submissions: [],
      },
      rpcErrors,
    },
  );
}

/** The summary's Approve button, named for the person: null while Approve waits. */
const approve = () => screen.queryByText(/^Approve( \S+)?$/);
const onSummary = () => screen.queryByTestId('join-request') !== null;
/** What a check says, by its key; null when the request has no such check. */
const check = (key: string) => {
  const row = screen.queryByTestId(`join-check-${key}`);
  return row ? (row.props.accessibilityLabel as string) : null;
};
/** The answers under the checks, as "label: value". */
function answers() {
  const rows = within(screen.getByTestId('join-answers')).getAllByText(/./);
  const texts = rows.map((row) => row.props.children as string);
  const pairs: string[] = [];
  for (let i = 0; i < texts.length; i += 2) pairs.push(`${texts[i]}: ${texts[i + 1]}`);
  return pairs;
}
const writeNames = () => adminWrites().map(([name]) => name);
const savedMember = () => {
  const calls = rpcsNamed('admin_save_member');
  expect(calls).toHaveLength(1);
  return calls[0][1];
};

describe('a join request, opened by an admin', () => {
  it('shows an adult athlete’s checks and answers, and approves them in one tap with what they asked for', async () => {
    await openRequest(
      asking('athlete', {
        declared_date_of_birth: ADULT,
        requested_team_id: SQUAD.id,
        playhq_email: 'robin.playhq@example.test',
        preferred_name: 'Rob',
      }),
    );
    expect(onSummary()).toBe(true);
    expect(screen.getByText('Asked to join as an athlete · Open Squad')).toBeTruthy();
    expect(screen.getByText(/^Asked on /)).toBeTruthy();
    expect(check('identity')).toBe(
      'To check: Not verified yet. Check them against PlayHQ, or ask for their 6-digit code and check it below.',
    );
    expect(check('date-of-birth')).toBe(
      'To check: Date of birth they gave: 09/03/2001 (25). Check it against PlayHQ or ID. Approving records it as checked.',
    );
    expect(check('parent')).toBeNull();
    expect(answers()).toEqual([
      'Role: Athlete',
      'Squad: Open Squad',
      'Preferred name: Rob',
      'Sign-in email: robin@example.test',
      'PlayHQ email: robin.playhq@example.test',
    ]);
    // Nothing from the full record crowds the decision.
    expect(screen.queryByText('Other roles')).toBeNull();
    expect(screen.queryByText('Delete member')).toBeNull();
    expect(screen.queryByText('Reason if not approving')).toBeNull();

    await press('Approve Rob');
    // Exactly what the full record's Approve sends: their details first, then the member.
    expect(adminWrites()).toEqual([
      [
        'admin_set_member_details',
        { p_profile_id: 'asking-athlete', p_date_of_birth: ADULT, p_wwcc_number: '', p_wwcc_expires_on: null },
      ],
      [
        'admin_save_member',
        {
          p_profile_id: 'asking-athlete',
          p_role: 'athlete',
          p_status: 'approved',
          p_teams: [{ team_id: SQUAD.id, team_role: 'athlete', coach_title: null, selection: null }],
          p_rejection_reason: null,
          p_under_17: false,
          p_guardian_ids: [],
          p_extra_roles: [],
          p_guardian_reason: null,
        },
      ],
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('says before Approve that a child stays locked until a verified parent is linked', async () => {
    const child = asking('athlete', {
      declared_date_of_birth: CHILD,
      guardian_email: 'sam@example.test',
      requested_team_id: SQUAD.id,
    });
    await openRequest(child, {
      requests: [{ guardian_id: PARENT.id, athlete_id: child.id }],
      others: [PARENT],
    });
    expect(check('date-of-birth')).toBe(
      'To check: Date of birth they gave: 01/06/2010 (16). Check it against PlayHQ or ID. Approving records it as checked.',
    );
    expect(check('parent')).toBe(
      'To check: Under 18: Robin’s app stays locked until a verified parent or guardian is linked. Sam New entered their code: approve or link them next.',
    );
    await press('Approve Robin');
    // Approved as a child with no guardian yet: the database keeps them locked.
    expect(savedMember()).toMatchObject({ p_status: 'approved', p_under_17: true, p_guardian_ids: [] });
  });

  it('names the guardian email a child gave when no parent has entered their code', async () => {
    await openRequest(asking('athlete', { declared_date_of_birth: CHILD, guardian_email: 'sam@example.test' }));
    expect(check('parent')).toBe(
      'To check: Under 18: Robin’s app stays locked until a verified parent or guardian is linked. No parent has entered their code yet. Guardian email they gave: sam@example.test.',
    );
  });

  it('never offers Approve for someone under 13, and still lets the admin decline them', async () => {
    await openRequest(asking('athlete', { declared_date_of_birth: '2014-04-01' }));
    expect(check('under-13')).toBe(
      'Needs sorting out: Under 13. FirstPass HQ is for members aged 13 and over, so don’t approve this request.',
    );
    expect(approve()).toBeNull();
    expect(screen.getByText('The checks marked ! come before Approve.')).toBeTruthy();
    await press("Don't approve");
    await pressInSection('Reason if not approving', 'Other');
    await press("Don't approve");
    expect(savedMember()).toMatchObject({ p_status: 'rejected', p_rejection_reason: 'other' });
  });

  it('waits for an athlete’s date of birth, and opens the full record to add it', async () => {
    await openRequest(asking('athlete'));
    expect(check('date-of-birth')).toBe(
      'Needs sorting out: No date of birth. Add it in the full record, checked against PlayHQ or ID, before you approve an athlete.',
    );
    expect(approve()).toBeNull();
    // With Approve waiting, the one way on is the full record: no second button for it.
    expect(screen.queryByText('Full record')).toBeNull();

    await press('Open the full record');
    expect(onSummary()).toBe(false);
    await typeInto('Date of birth', '09/03/2001');
    await press('Back to the request’s summary');
    // The summary is what Approve will save, so it has the date just typed.
    expect(check('date-of-birth')).toBe(
      'To check: Date of birth 09/03/2001 (25), as you entered it. Approving records it as checked.',
    );
    await press('Approve Robin');
    expect(adminWrites()[0][1]).toMatchObject({ p_date_of_birth: ADULT });
    expect(savedMember()).toMatchObject({ p_role: 'athlete', p_status: 'approved' });
  });

  it('shows the database’s refusal on the summary and stays there', async () => {
    await openRequest(asking('athlete', { declared_date_of_birth: ADULT }), {
      rpcErrors: { admin_save_member: 'Members can only be added to this season’s squads and teams' },
    });
    await press('Approve Robin');
    expect(screen.getByText('Members can only be added to this season’s squads and teams')).toBeTruthy();
    expect(onSummary()).toBe(true);
    expect(back).not.toHaveBeenCalled();
  });

  it('has no FirstPass logo at its foot', async () => {
    await openRequest(asking('athlete', { declared_date_of_birth: ADULT }));
    expect(screen.queryByText('Powered by')).toBeNull();
    await press('Full record');
    expect(screen.queryByText('Powered by')).toBeNull();
  });
});

describe('not approving a request from its summary', () => {
  it('shows the reasons on the first tap, needs one, and sends nothing without it', async () => {
    await openRequest(asking('athlete', { declared_date_of_birth: ADULT }));
    await press("Don't approve");
    expect(screen.getByText('Reason if not approving')).toBeTruthy();
    expect(screen.getByText('They see the reason. Choose one, then tap Don’t approve again.')).toBeTruthy();
    expect(writeNames()).toEqual([]);

    await press("Don't approve");
    expect(screen.getByText('Choose a reason before turning this request down.')).toBeTruthy();
    expect(writeNames()).toEqual([]);
    expect(back).not.toHaveBeenCalled();
  });

  it('turns the request down with the reason chosen', async () => {
    await openRequest(asking('athlete', { declared_date_of_birth: ADULT }));
    await press("Don't approve");
    await pressInSection('Reason if not approving', 'Not registered with the club');
    await press("Don't approve");
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_save_member']);
    expect(savedMember()).toMatchObject({
      p_profile_id: 'asking-athlete',
      p_status: 'rejected',
      p_rejection_reason: 'not_registered',
    });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('keeps the reason chosen when the admin opens the full record', async () => {
    await openRequest(asking('athlete', { declared_date_of_birth: ADULT }));
    await press("Don't approve");
    await pressInSection('Reason if not approving', 'Other');
    await press('Full record');
    expect(isChosen(inSection('Reason if not approving', 'Other'))).toBe(true);
  });
});

describe('a parent or guardian asking to join', () => {
  const child: Profile = { ...p('athlete'), id: 'their-child', full_name: 'Robin New', date_of_birth: CHILD, under_17: true };
  const entered = { requests: [{ guardian_id: PARENT.id, athlete_id: child.id }], others: [child] };

  it('waits until they’re verified, checks their code on the summary, then approves and links them', async () => {
    await openRequest(PARENT, entered);
    expect(check('identity')).toBe(
      'Needs sorting out: Not verified yet. A parent or guardian is verified before they’re approved: check their 6-digit code below, or record what you checked in the full record.',
    );
    expect(check('child')).toBe('Checked: Parent or guardian of Robin New. Approving links them.');
    expect(approve()).toBeNull();

    await typeInto('Their code', '123456');
    await press('Check code');
    expect(rpcsNamed('admin_verify_member')).toEqual([
      ['admin_verify_member', { p_profile_id: PARENT.id, p_code: '123456' }],
    ]);
    expect(check('identity')).toMatch(/^Checked: Verified on .*, with their code\.$/);
    // Verified: the code box goes and Approve comes.
    expect(screen.queryByText('Their code')).toBeNull();
    expect(answers()).toEqual(['Role: Guardian', 'Sign-in email: sam@example.test', 'PlayHQ email: Not given']);

    await press('Approve Sam');
    expect(savedMember()).toMatchObject({
      p_profile_id: PARENT.id,
      p_role: 'guardian',
      p_status: 'approved',
      p_teams: [],
      p_under_17: false,
    });
  });

  it('shows a wrong code and leaves them unverified, with no Approve', async () => {
    await openRequest(PARENT, { ...entered, rpcErrors: { admin_verify_member: 'That code doesn’t match' } });
    await typeInto('Their code', '000000');
    await press('Check code');
    expect(screen.getByText('That code doesn’t match')).toBeTruthy();
    expect(check('identity')).toMatch(/^Needs sorting out: Not verified yet/);
    expect(approve()).toBeNull();
  });

  it('waits for their child to be approved first', async () => {
    const waiting = { ...child, status: 'pending' as const };
    await openRequest(
      { ...PARENT, verified_at: '2026-10-16T03:00:00Z', verification_method: 'code' },
      { requests: entered.requests, others: [waiting] },
    );
    expect(check('child')).toBe('Needs sorting out: Approve their child first: Robin New is still waiting.');
    expect(approve()).toBeNull();
    expect(screen.getByText('Open the full record')).toBeTruthy();
  });

  it('waits for a child’s link code, with the full record for a child who won’t use the app', async () => {
    await openRequest({ ...PARENT, verified_at: '2026-10-16T03:00:00Z', verification_method: 'id_sighted' });
    expect(check('identity')).toMatch(/^Checked: Verified on .*, with ID sighted\.$/);
    expect(check('child')).toMatch(/^Needs sorting out: They haven’t entered a child’s link code yet\./);
    await press('Open the full record');
    expect(onSummary()).toBe(false);
    expect(screen.getByText('Role')).toBeTruthy();
  });
});

describe('coaches, managers, physios, the committee, statisticians and admins asking to join', () => {
  const STAFF: AppRole[] = ['coach', 'manager', 'physio', 'committee', 'statistician', 'admin'];
  const CARD = { wwcc_number: 'WWC0100001', wwcc_expires_on: '2028-03-01' };

  it.each(STAFF)('waits for a %s’s Working With Children Check, which the full record holds', async (role) => {
    await openRequest(asking(role));
    expect(check('wwcc')).toMatch(/^Needs sorting out: No current Working With Children Check\./);
    expect(approve()).toBeNull();
    await press('Open the full record');
    expect(screen.getByText('Working With Children Check')).toBeTruthy();
    expect(fieldFor('Card number')).toBeTruthy();
  });

  it.each(STAFF)('approves a %s whose card is on record', async (role) => {
    await openRequest(asking(role, CARD));
    expect(check('wwcc')).toBe('Checked: Working With Children Check on record, expires 01/03/2028.');
    await press('Approve Robin');
    expect(savedMember()).toMatchObject({ p_role: role, p_status: 'approved' });
  });

  it('shows a coach the squad they asked for and the title they’ll get there', async () => {
    await openRequest(asking('coach', { ...CARD, requested_team_id: SQUAD.id }));
    expect(screen.getByText('Asked to join as a coach · Open Squad')).toBeTruthy();
    expect(answers().slice(0, 2)).toEqual(['Role: Coach', 'Squad: Open Squad (Head Coach)']);
    await press('Approve Robin');
    expect(savedMember()).toMatchObject({
      p_teams: [{ team_id: SQUAD.id, team_role: 'coach', coach_title: 'head_coach', selection: null }],
    });
  });

  it('says so when a coach asked for no squad, and still approves them', async () => {
    await openRequest(asking('coach', CARD));
    expect(answers()[1]).toBe('Squad: None yet: choose one in the full record');
    await press('Approve Robin');
    expect(savedMember()).toMatchObject({ p_teams: [] });
  });

  it('shows what the admin changed in the full record once they come back to the summary', async () => {
    await openRequest(asking('committee', CARD));
    await press('Full record');
    await pressInSection('Other roles', 'Coach');
    await press('Back to the request’s summary');
    expect(answers()[0]).toBe('Roles: Committee, Coach');
    await press('Approve Robin');
    expect(savedMember()).toMatchObject({ p_role: 'committee', p_extra_roles: ['coach'] });
  });
});

describe('a guest asking to join', () => {
  it('approves an adult on the date of birth they gave', async () => {
    await openRequest(asking('guest', { declared_date_of_birth: ADULT }));
    expect(check('date-of-birth')).toMatch(/^To check: Date of birth they gave: 09\/03\/2001 \(25\)\./);
    expect(answers()).toEqual(['Role: Guest', 'Sign-in email: robin@example.test', 'PlayHQ email: Not given']);
    await press('Approve Robin');
    expect(adminWrites()[0][1]).toMatchObject({ p_date_of_birth: ADULT });
    expect(savedMember()).toMatchObject({ p_role: 'guest', p_status: 'approved', p_under_17: false });
  });

  it('never offers Approve for a guest under 18', async () => {
    await openRequest(asking('guest', { declared_date_of_birth: CHILD }));
    expect(check('guest-age')).toMatch(/^Needs sorting out: Under 18\. Guests must be 18 or over/);
    expect(check('parent')).toBeNull();
    expect(approve()).toBeNull();
  });
});

describe('who opens on the full record instead', () => {
  it('a temporary helper, who is set up there over several steps', async () => {
    await openRequest({ ...p('volunteer'), status: 'pending', requested_role: 'volunteer' });
    expect(onSummary()).toBe(false);
    expect(screen.getByText('Save for now')).toBeTruthy();
    expect(screen.queryByText('Back to the request’s summary')).toBeNull();
  });

  it.each<[string, Profile]>([
    ['an approved member', p('athlete')],
    ['someone turned down', p('rejected')],
    ['someone who signed in but hasn’t asked to join', { ...asking('athlete'), requested_role: null, join_requested_at: null }],
  ])('%s', async (_l, target) => {
    await openRequest(target);
    expect(onSummary()).toBe(false);
    expect(screen.queryByText('Back to the request’s summary')).toBeNull();
    expect(screen.getByText('Role')).toBeTruthy();
  });

  it('a request an admin has already saved places for', async () => {
    // Saved while still waiting: the role and places are the admin's, not the request's.
    await openRequest(asking('athlete', { role: 'athlete', declared_date_of_birth: ADULT }), {
      placements: [{ team_id: SQUAD.id, team_role: 'athlete', coach_title: null, selection: null }],
    });
    expect(onSummary()).toBe(false);
    expect(isChosen(inSection('Squads', 'Open Squad'))).toBe(true);
  });

  it('a waiting member opened by a to-do about another part of their page', async () => {
    await openRequest(asking('athlete'), { todo: 'dob' });
    expect(onSummary()).toBe(false);
    expect(screen.getAllByTestId('focus-anchor')).toHaveLength(1);
  });

  it('but the join request to-do opens the summary, saying what to do', async () => {
    await openRequest(asking('athlete', { declared_date_of_birth: ADULT }), { todo: 'join' });
    expect(onSummary()).toBe(true);
    expect(within(screen.getByTestId('todo-banner')).getByText(/^Read the checks, then Approve/)).toBeTruthy();
  });
});

// The summary only reorders what the full record already does: both buttons
// send the same thing for the same request.
describe('Approve on the summary and in the full record', () => {
  it.each<[string, Profile]>([
    ['an adult athlete', asking('athlete', { declared_date_of_birth: ADULT, requested_team_id: SQUAD.id })],
    ['a child', asking('athlete', { declared_date_of_birth: CHILD, requested_team_id: SQUAD.id })],
    ['a guest', asking('guest', { declared_date_of_birth: ADULT })],
    ['a coach with a card', asking('coach', { wwcc_number: 'WWC0100001', wwcc_expires_on: '2028-03-01', requested_team_id: SQUAD.id })],
  ])('send the same for %s', async (_l, target) => {
    await openRequest(target);
    await press(/^Approve /);
    const fromSummary = adminWrites();
    expect(fromSummary.map(([name]) => name)).toEqual(['admin_set_member_details', 'admin_save_member']);
    (supabase.rpc as jest.Mock).mockClear();

    await openRequest(target);
    await press('Full record');
    await press('Approve');
    expect(adminWrites()).toEqual(fromSummary);
  });
});
