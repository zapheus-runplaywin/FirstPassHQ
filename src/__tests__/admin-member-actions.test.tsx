/**
 * What an admin's actions on a member's page (src/app/admin/[id].tsx) send to
 * the database, in what order, and what the page refuses before sending
 * anything. admin-member-screen.test.tsx covers which controls each kind of
 * member's page shows; this file presses them.
 *
 * The rules are in section 10 of the user guide ("Approving members",
 * "Changing or removing members"): details and card first, then the check
 * exemption, the volunteer exemption and a temporary helper's dates, then the
 * member, and only then a committee title or Head Physio (which depend on
 * the role). Every refusal stops the sequence there and shows why.
 */
import { fireEvent, screen } from 'expo-router/testing-library';

import MemberScreen from '@/app/admin/[id]';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type {
  Profile,
  ScreeningNotice,
  StandDown,
  Team,
  VolunteerExemption,
} from '@/lib/types';

import {
  adminWrites,
  fieldFor,
  inSection,
  isChosen,
  press,
  pressInSection,
  rpcsNamed,
  spyOnBack,
  typeInto,
} from './helpers/admin-screens';
import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
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

// Every wait in this file is on the screen settling (untilQuiet) or on fake
// timers, never on the clock. A test's wall time only grows when the machine
// is busy, so allow for that instead of failing at Jest's default 5 seconds.
jest.setTimeout(20_000);

let back: jest.SpyInstance;

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
const SQUAD_TEAM: Team = { ...SQUAD, id: 'team-open-a', name: 'Open A', kind: 'team', squad_id: SQUAD.id };

const GUARDIAN = { ...p('guardian'), email: 'parent@example.test' };
const UNVERIFIED_GUARDIAN: Profile = {
  ...p('guardian'),
  id: 'unverified-guardian',
  full_name: 'Unverified Parent',
  email: 'parent2@example.test',
  verified_at: null,
};
const OTHER_GUARDIAN: Profile = {
  ...p('guardian'),
  id: 'other-guardian',
  full_name: 'Other Parent',
  email: 'other@example.test',
};
const CHILD: Profile = { ...morePersonas.under18Athlete.profile, full_name: 'Sample Child' };

type Placement = { team_id: string; team_role: string; coach_title: string | null; selection: string | null };

/** Opens `target`'s page for an admin, with what the database holds about them. */
async function openMember(
  target: Profile,
  {
    viewer = 'admin' as PersonaName | Persona,
    placements = [] as Placement[],
    guardianships = [] as { guardian_id: string; athlete_id: string }[],
    people = [] as Profile[],
    standDowns = [] as StandDown[],
    notices = [] as ScreeningNotice[],
    exemptions = [] as VolunteerExemption[],
    dobRecord = null as { recorded_by_name: string | null; recorded_at: string | null } | null,
    acknowledgedAt = null as string | null,
    rpcErrors = {} as BackendOptions['rpcErrors'],
  } = {},
) {
  await openScreen(
    viewer,
    { 'admin/[id]': MemberScreen },
    `/admin/${target.id}`,
    {
      teams: [SQUAD, SQUAD_TEAM],
      guardianships,
      stand_downs: standDowns,
      screening_notices: notices,
      guardianship_history: [],
      policy_acknowledgements: acknowledgedAt ? [{ acknowledged_at: acknowledgedAt }] : [],
    },
    {
      tableHandlers: {
        profiles: (q) => {
          if (q.eq('id') === target.id) return [target];
          if (q.eq('status') === 'approved') return people;
          return undefined;
        },
        team_members: (q) => (q.eq('profile_id') === target.id ? placements : undefined),
      },
      rpcs: { admin_volunteer_exemptions: exemptions, admin_date_of_birth_record: dobRecord },
      rpcErrors,
    },
  );
}

/** The arguments admin_save_member was sent. */
function savedMember() {
  const calls = rpcsNamed('admin_save_member');
  expect(calls).toHaveLength(1);
  return calls[0][1];
}

const writeNames = () => adminWrites().map(([name]) => name);

// ---------------------------------------------------------------------------
// Saving

describe('saving a member', () => {
  it('saves the details and card first, then the member with their squads and teams', async () => {
    await openMember(p('coach'), {
      placements: [
        { team_id: SQUAD.id, team_role: 'coach', coach_title: 'assistant_coach', selection: null },
      ],
    });
    await press('Save changes');
    expect(adminWrites()).toEqual([
      [
        'admin_set_member_details',
        {
          p_profile_id: 'coach',
          p_date_of_birth: '1990-05-05',
          p_wwcc_number: '1234567A',
          p_wwcc_expires_on: '2029-06-30',
        },
      ],
      [
        'admin_save_member',
        {
          p_profile_id: 'coach',
          p_role: 'coach',
          p_status: 'approved',
          p_teams: [
            { team_id: SQUAD.id, team_role: 'coach', coach_title: 'assistant_coach', selection: null },
          ],
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

  it('lets an admin save their own page without sending their own card details', async () => {
    // The database refuses an admin's own date of birth or card details.
    await openMember(p('admin'), { rpcErrors: { admin_set_member_details: 'Ask another admin to change your date of birth or card details' } });
    await press('Save changes');
    expect(adminWrites().map(([name]) => name)).toEqual(['admin_save_member']);
    expect(screen.queryByText(/Ask another admin/)).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('sends an admin’s own changed card details, and shows why they’re refused', async () => {
    await openMember(p('admin'), { rpcErrors: { admin_set_member_details: 'Ask another admin to change your date of birth or card details' } });
    await typeInto('Card number', '7654321B');
    await press('Save changes');
    expect(adminWrites().map(([name]) => name)).toEqual(['admin_set_member_details']);
    expect(screen.getByText('Ask another admin to change your date of birth or card details')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('sends the coach title chosen for each group', async () => {
    await openMember(p('coach'), {
      placements: [{ team_id: SQUAD.id, team_role: 'coach', coach_title: 'head_coach', selection: null }],
    });
    expect(screen.getByText(/^Their title in the app: Head Coach, Open Squad\./)).toBeTruthy();
    await pressInSection('Head or assistant coach in Open Squad', 'Assistant Coach');
    expect(screen.getByText(/^Their title in the app: Assistant Coach, Open Squad\./)).toBeTruthy();
    await press('Save changes');
    expect(savedMember()!.p_teams).toEqual([
      { team_id: SQUAD.id, team_role: 'coach', coach_title: 'assistant_coach', selection: null },
    ]);
  });

  it('takes a member out of a squad’s teams when they leave the squad', async () => {
    await openMember(p('athlete'), {
      placements: [
        { team_id: SQUAD.id, team_role: 'athlete', coach_title: null, selection: null },
        { team_id: SQUAD_TEAM.id, team_role: 'athlete', coach_title: null, selection: 'training_partner' },
      ],
    });
    expect(screen.getByText('Selected in Open A as')).toBeTruthy();
    expect(isChosen(inSection('Selected in Open A as', 'Training partner'))).toBe(true);
    await pressInSection('Squads', 'Open Squad');
    expect(screen.queryByText('Selected in Open A as')).toBeNull();
    await press('Save changes');
    expect(savedMember()!.p_teams).toEqual([]);
  });

  it('adds an extra role and picks which role they hold in each squad', async () => {
    await openMember(p('athlete'), {
      placements: [{ team_id: SQUAD.id, team_role: 'athlete', coach_title: null, selection: null }],
    });
    await pressInSection('Other roles', 'Coach');
    expect(screen.getByText('Role in Open Squad')).toBeTruthy();
    await pressInSection('Role in Open Squad', 'Coach');
    // A coach needs a check: the card fields appear.
    expect(screen.getByText('Working With Children Check')).toBeTruthy();
    await press('Save changes');
    const saved = savedMember()!;
    expect(saved.p_role).toBe('athlete');
    expect(saved.p_extra_roles).toEqual(['coach']);
    expect(saved.p_teams).toEqual([
      { team_id: SQUAD.id, team_role: 'coach', coach_title: 'head_coach', selection: null },
    ]);
  });

  it('refuses a role combination the club doesn’t allow before sending anything', async () => {
    await openMember(p('athlete'));
    await pressInSection('Other roles', 'Manager');
    expect(screen.getAllByText('Athletes can’t also be managers.')).toHaveLength(1);
    await press('Save changes');
    // Shown under Other roles and above the buttons.
    expect(screen.getAllByText('Athletes can’t also be managers.')).toHaveLength(2);
    expect(adminWrites()).toEqual([]);
    expect(back).not.toHaveBeenCalled();
  });

  it('refuses a guest with another role', async () => {
    await openMember({ ...p('guest'), extra_roles: [] });
    await pressInSection('Role', 'Coach');
    await pressInSection('Other roles', 'Guest');
    await press('Save changes');
    expect(screen.getAllByText('Guests can’t have another role.').length).toBeGreaterThan(0);
    expect(adminWrites()).toEqual([]);
  });

  it.each([
    ['a date of birth that isn’t a real day', 'Date of birth', '31/02/2010', 'Enter the date of birth as DD/MM/YYYY.'],
    ['a date of birth written the wrong way', 'Date of birth', '2010-02-01', 'Enter the date of birth as DD/MM/YYYY.'],
  ])('refuses %s', async (_l, label, value, message) => {
    await openMember(p('athlete'));
    await typeInto(label, value);
    await press('Save changes');
    expect(screen.getByText(message)).toBeTruthy();
    expect(adminWrites()).toEqual([]);
  });

  it('refuses a card expiry that isn’t a date', async () => {
    await openMember(p('coach'));
    await typeInto('Expires', '30-06-29');
    await press('Save changes');
    expect(screen.getByText('Enter the check expiry date as DD/MM/YYYY.')).toBeTruthy();
    expect(adminWrites()).toEqual([]);
  });

  it('refuses a new card that expires more than three years from today', async () => {
    await openMember(p('coach'));
    await typeInto('Expires', '19/10/2029');
    await press('Save changes');
    expect(
      screen.getByText('A Working With Children Check lasts three years. Check the expiry date on the card.'),
    ).toBeTruthy();
    expect(adminWrites()).toEqual([]);
  });

  it('accepts a new card that expires exactly three years from today', async () => {
    await openMember(p('coach'));
    await typeInto('Card number', '7654321b');
    await typeInto('Expires', '18/10/2029');
    await press('Save changes');
    expect(adminWrites()[0]).toEqual([
      'admin_set_member_details',
      { p_profile_id: 'coach', p_date_of_birth: '1990-05-05', p_wwcc_number: '7654321b', p_wwcc_expires_on: '2029-10-18' },
    ]);
    expect(writeNames()).toContain('admin_save_member');
  });

  it('still saves a card recorded earlier with a longer expiry, as long as it isn’t changed', async () => {
    await openMember({ ...p('coach'), wwcc_expires_on: '2030-03-01' });
    await press('Save changes');
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_save_member']);
  });

  it('asks to save a changed card before it can be validated', async () => {
    await openMember(p('coach'));
    expect(screen.getByText('Validation')).toBeTruthy();
    await typeInto('Card number', '9999999Z');
    expect(screen.queryByText('Validation')).toBeNull();
    expect(screen.getByText('Save the new card, then open this page again to validate it.')).toBeTruthy();
  });

  it.each([
    ['details', 'admin_set_member_details', ['admin_set_member_details']],
    ['member', 'admin_save_member', ['admin_set_member_details', 'admin_save_member']],
  ])('stops and shows the database’s refusal when saving the %s fails', async (_l, rpc, sent) => {
    await openMember({ ...p('committee'), title: null }, { rpcErrors: { [rpc]: 'Refused by the database' } });
    await typeInto('Title', 'Secretary');
    await press('Save changes');
    expect(screen.getByText('Refused by the database')).toBeTruthy();
    expect(writeNames()).toEqual(sent);
    expect(back).not.toHaveBeenCalled();
  });

  it('sets a committee member’s title after saving the member', async () => {
    await openMember(p('committee'));
    await typeInto('Title', 'Treasurer');
    await press('Save changes');
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_save_member', 'admin_set_member_title']);
    expect(rpcsNamed('admin_set_member_title')[0][1]).toEqual({ p_profile_id: 'committee', p_title: 'Treasurer' });
  });

  it('leaves the title alone when it hasn’t changed, and never offers one to a coach', async () => {
    await openMember({ ...p('committee'), title: 'Treasurer' });
    expect(fieldFor('Title').props.value).toBe('Treasurer');
    await press('Save changes');
    expect(writeNames()).not.toContain('admin_set_member_title');
  });

  it('gives a coach no Title field', async () => {
    await openMember(p('coach'));
    expect(screen.queryByText('Title')).toBeNull();
  });

  it('shows a title refusal and stays on the page', async () => {
    await openMember(p('committee'), { rpcErrors: { admin_set_member_title: 'Keep the title under 40 characters' } });
    await typeInto('Title', 'Treasurer');
    await press('Save changes');
    expect(screen.getByText('Keep the title under 40 characters')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('makes a physio the Head Physio after saving the member', async () => {
    await openMember(p('physio'));
    expect(screen.getByText(/^Looks after the athletes in the/)).toBeTruthy();
    await pressInSection('Physio title', 'Head Physio');
    expect(screen.getByText('Looks after every athlete, whether or not they are in a squad or team.')).toBeTruthy();
    await press('Save changes');
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_save_member', 'admin_set_head_physio']);
    expect(rpcsNamed('admin_set_head_physio')[0][1]).toEqual({ p_profile_id: 'physio', p_on: true });
  });

  it('ends Head Physio when the member is no longer a physio', async () => {
    await openMember(morePersonas.headPhysio.profile);
    await pressInSection('Role', 'Coach');
    expect(screen.queryByText('Physio title')).toBeNull();
    await press('Save changes');
    expect(rpcsNamed('admin_set_head_physio')[0][1]).toEqual({ p_profile_id: 'head-physio', p_on: false });
  });

  it('sends no Head Physio change when nothing changed', async () => {
    await openMember(morePersonas.headPhysio.profile);
    await press('Save changes');
    expect(writeNames()).not.toContain('admin_set_head_physio');
  });
});

// ---------------------------------------------------------------------------
// Approving, not approving and removing access

const PENDING_CHILD: Profile = {
  ...p('pending'),
  id: 'pending-child',
  full_name: 'Pending Child',
  role: 'guest',
  requested_role: 'athlete',
  requested_team_id: SQUAD.id,
  date_of_birth: null,
  declared_date_of_birth: '2012-04-01',
  guardian_email: 'parent@example.test',
  wwcc_number: null,
  wwcc_expires_on: null,
};

describe('approving a request', () => {
  it('starts from what they asked for and approves a child with their checked date of birth and a verified guardian', async () => {
    await openMember(PENDING_CHILD, { people: [GUARDIAN, UNVERIFIED_GUARDIAN] });
    expect(isChosen(inSection('Role', 'Athlete'))).toBe(true);
    expect(isChosen(inSection('Squads', 'Open Squad'))).toBe(true);
    expect(
      screen.getByText('Check their date of birth against PlayHQ or ID and add it before you approve them.'),
    ).toBeTruthy();

    await press('I’ve checked it: use 01/04/2012');
    expect(fieldFor('Date of birth').props.value).toBe('01/04/2012');
    expect(screen.getByText('Under 18, so needs a parent or guardian.')).toBeTruthy();
    // The search starts from the email the child gave, so only that guardian matches.
    expect(fieldFor('Add a guardian').props.value).toBe('parent@example.test');
    expect(screen.queryByText('Unverified Parent (not verified)')).toBeNull();
    await press('Sample guardian');
    expect(screen.getByText('Sample guardian  ✕')).toBeTruthy();
    expect(screen.getByText('Reason for the change (optional)')).toBeTruthy();

    await press('Approve');
    expect(adminWrites()).toEqual([
      [
        'admin_set_member_details',
        { p_profile_id: 'pending-child', p_date_of_birth: '2012-04-01', p_wwcc_number: '', p_wwcc_expires_on: null },
      ],
      [
        'admin_save_member',
        {
          p_profile_id: 'pending-child',
          p_role: 'athlete',
          p_status: 'approved',
          p_teams: [{ team_id: SQUAD.id, team_role: 'athlete', coach_title: null, selection: null }],
          p_rejection_reason: null,
          p_under_17: true,
          p_guardian_ids: ['guardian'],
          p_extra_roles: [],
          p_guardian_reason: '',
        },
      ],
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('notes a different date from the one they gave', async () => {
    await openMember(PENDING_CHILD);
    await typeInto('Date of birth', '02/04/2012');
    expect(screen.getByText('Not the date they gave (01/04/2012).')).toBeTruthy();
    expect(screen.queryByText(/^I’ve checked it/)).toBeNull();
  });

  it('never links a guardian who hasn’t been verified', async () => {
    await openMember(PENDING_CHILD, { people: [UNVERIFIED_GUARDIAN] });
    await press('I’ve checked it: use 01/04/2012');
    await typeInto('Add a guardian', 'unverified');
    await press('Unverified Parent (not verified)');
    expect(
      screen.getByText(
        'Verify Unverified Parent first, with their code in person or against PlayHQ, from their own page.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Unverified Parent  ✕')).toBeNull();
    expect(screen.getByText('No guardians linked yet.')).toBeTruthy();
  });

  it('says when no guardians are approved yet', async () => {
    await openMember(PENDING_CHILD, { people: [] });
    await press('I’ve checked it: use 01/04/2012');
    expect(screen.getByText(/^No approved guardians yet\./)).toBeTruthy();
    expect(screen.queryByText('Add a guardian')).toBeNull();
  });

  it('shows the database’s refusal, such as a child with no guardian, and stays on the page', async () => {
    await openMember(PENDING_CHILD, {
      rpcErrors: { admin_save_member: 'Link at least one verified guardian before approving an athlete under 18' },
    });
    await press('I’ve checked it: use 01/04/2012');
    await press('Approve');
    expect(
      screen.getByText('Link at least one verified guardian before approving an athlete under 18'),
    ).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('shows who recorded a checked date of birth', async () => {
    await openMember(p('athlete'), {
      dobRecord: { recorded_by_name: 'Other admin', recorded_at: '2026-09-01T00:00:00Z' },
    });
    expect(screen.getByText(/^Recorded by Other admin on /)).toBeTruthy();
    await typeInto('Date of birth', '06/05/1990');
    expect(screen.queryByText(/^Recorded by Other admin on /)).toBeNull();
  });

  it.each<[string, PersonaName, string, string]>([
    ['turning a request down', 'pending', "Don't approve", 'Choose a reason before turning this request down.'],
    ['removing access', 'committee', 'Remove access', 'Choose a reason before removing access.'],
  ])('needs a reason before %s, and sends nothing without one', async (_l, who, button, message) => {
    await openMember(p(who));
    await press(button);
    expect(screen.getByText(message)).toBeTruthy();
    expect(writeNames()).toEqual([]);
    expect(back).not.toHaveBeenCalled();
  });

  it('turns a request down with the reason chosen', async () => {
    await openMember(p('pending'));
    await pressInSection('Reason if not approving', 'Not registered with the club');
    await press("Don't approve");
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_save_member']);
    expect(savedMember()).toMatchObject({
      p_profile_id: 'pending',
      p_status: 'rejected',
      p_rejection_reason: 'not_registered',
    });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('keeps a turned-down request’s reason and lets the admin change it', async () => {
    await openMember({ ...p('rejected') });
    expect(screen.queryByText("Don't approve")).toBeNull();
    expect(isChosen(inSection('Reason if not approving', 'Not registered with the club'))).toBe(true);
    await pressInSection('Reason if not approving', "PlayHQ email doesn't match");
    await press('Save reason');
    expect(savedMember()).toMatchObject({ p_status: 'rejected', p_rejection_reason: 'playhq_email_mismatch' });
  });

  it('removes an approved member’s access with a reason, and sets no title on the way out', async () => {
    await openMember(p('committee'));
    await typeInto('Title', 'Treasurer');
    await pressInSection('Reason if removing access', 'Other');
    await press('Remove access');
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_save_member']);
    expect(savedMember()).toMatchObject({
      p_profile_id: 'committee',
      p_role: 'committee',
      p_status: 'rejected',
      p_rejection_reason: 'other',
    });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('saves a temporary helper for now while they accept their exemption', async () => {
    const helper: Profile = { ...p('volunteer'), status: 'pending', requested_role: 'volunteer' };
    await openMember(helper, { acknowledgedAt: '2026-10-12T03:00:00Z' });
    expect(screen.getByText(`Accepted ${localDay('2026-10-12T03:00:00Z')}`)).toBeTruthy();
    await press('Save for now');
    expect(savedMember()).toMatchObject({ p_profile_id: 'volunteer', p_role: 'volunteer', p_status: 'pending' });
  });
});

// ---------------------------------------------------------------------------
// Temporary helpers' task and dates

describe('a temporary helper’s task and dates', () => {
  it('saves a changed task and dates before the member', async () => {
    await openMember(p('volunteer'));
    expect(screen.getByText('Not accepted yet')).toBeTruthy();
    await typeInto('What they’ll help with', 'Sausage sizzle');
    await typeInto('Last day', '01/11/2026');
    await press('Save changes');
    expect(writeNames()).toEqual([
      'admin_set_member_details',
      'admin_set_volunteer_details',
      'admin_save_member',
    ]);
    expect(rpcsNamed('admin_set_volunteer_details')[0][1]).toEqual({
      p_profile_id: 'volunteer',
      p_task: 'Sausage sizzle',
      p_from: '2026-10-01',
      p_until: '2026-11-01',
    });
  });

  it('sends nothing for the task and dates when they haven’t changed', async () => {
    await openMember(p('volunteer'));
    await press('Save changes');
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_save_member']);
  });

  it('refuses a day that isn’t a date', async () => {
    await openMember(p('volunteer'));
    await typeInto('Last day', '32/10/2026');
    await press('Save changes');
    expect(screen.getByText('Enter their first and last day as DD/MM/YYYY.')).toBeTruthy();
    expect(adminWrites()).toEqual([]);
  });

  it('shows the database’s refusal of the dates and saves nothing more', async () => {
    await openMember(p('volunteer'), {
      rpcErrors: { admin_set_volunteer_details: 'Their check doesn’t cover every day they’ll help' },
    });
    await typeInto('Last day', '30/11/2026');
    await press('Save changes');
    expect(screen.getByText('Their check doesn’t cover every day they’ll help')).toBeTruthy();
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_set_volunteer_details']);
  });
});

// ---------------------------------------------------------------------------
// Exemptions from the check

describe('exempting a committee member or admin from the check', () => {
  it('needs a reason before anything is sent', async () => {
    await openMember(p('committee'));
    await pressInSection('Working With Children Check', 'Exempt');
    expect(screen.queryByText('Card number')).toBeNull();
    await press('Save changes');
    expect(screen.getByText('Write why they don’t need a Working With Children Check.')).toBeTruthy();
    expect(adminWrites()).toEqual([]);
  });

  it('records the reason before saving the member', async () => {
    await openMember(p('committee'));
    await pressInSection('Working With Children Check', 'Exempt');
    await typeInto('Why they don’t need a check', '  Treasurer only, never at training  ');
    await press('Save changes');
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_set_wwcc_exemption', 'admin_save_member']);
    expect(rpcsNamed('admin_set_wwcc_exemption')[0][1]).toEqual({
      p_profile_id: 'committee',
      p_reason: 'Treasurer only, never at training',
    });
  });

  it('ends an exemption when the admin chooses Needs a check, and shows who gave it', async () => {
    const exempted: Profile = {
      ...p('committee'),
      wwcc_number: null,
      wwcc_expires_on: null,
      wwcc_exempt_reason: 'Treasurer only',
      wwcc_exempted_by: 'admin',
      wwcc_exempted_at: '2026-09-01T00:00:00Z',
    };
    await openMember(exempted, { people: [p('admin')] });
    expect(screen.getByText(/^Exempted by Sample admin on /)).toBeTruthy();
    await pressInSection('Working With Children Check', 'Needs a check');
    await press('Save changes');
    expect(rpcsNamed('admin_set_wwcc_exemption')[0][1]).toEqual({ p_profile_id: 'committee', p_reason: '' });
  });

  it('stops before saving the member when the exemption is refused', async () => {
    await openMember(p('committee'), { rpcErrors: { admin_set_wwcc_exemption: 'You can’t exempt yourself' } });
    await pressInSection('Working With Children Check', 'Exempt');
    await typeInto('Why they don’t need a check', 'Treasurer only');
    await press('Save changes');
    expect(screen.getByText('You can’t exempt yourself')).toBeTruthy();
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_set_wwcc_exemption']);
  });

  it('never offers an exemption to a committee member who also coaches', async () => {
    await openMember({ ...p('committee'), extra_roles: ['coach'] });
    expect(screen.queryByText('Exempt')).toBeNull();
    expect(screen.getByText('Has a check')).toBeTruthy();
  });
});

describe('statisticians and the check', () => {
  const statistician = (): Profile => ({ ...p('statistician'), role: 'statistician', extra_roles: [] });
  const chips = () =>
    ['Has a check', 'Parent volunteer', 'Short-term visitor', 'National event or tour', 'Needs a check', 'Exempt'].filter(
      (l) => screen.queryByText(l),
    );

  it('asks for a statistician’s check and offers the exemptions', async () => {
    await openMember(statistician());
    expect(screen.getByText('Working With Children Check')).toBeTruthy();
    expect(screen.getByText(/Coaches, managers, physios, statisticians, temporary helpers/)).toBeTruthy();
    expect(screen.getByText(/statistician with a reason, such as a statistician who only records opens games/)).toBeTruthy();
    expect(chips()).toEqual(['Has a check', 'Short-term visitor', 'National event or tour', 'Needs a check', 'Exempt']);
  });

  it('records the reason for a statistician who only records opens games', async () => {
    await openMember(statistician());
    await pressInSection('Working With Children Check', 'Exempt');
    expect(screen.queryByText('Card number')).toBeNull();
    await typeInto('Why they don’t need a check', 'Opens games only, from video');
    await press('Save changes');
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_set_wwcc_exemption', 'admin_save_member']);
    expect(rpcsNamed('admin_set_wwcc_exemption')[0][1]).toEqual({
      p_profile_id: 'statistician',
      p_reason: 'Opens games only, from video',
    });
  });

  it('offers a statistician who is a parent of a child here the parent volunteer exemption', async () => {
    const parent: Profile = { ...morePersonas.coachGuardian.profile, role: 'guardian', extra_roles: ['statistician'] };
    await openMember(parent, {
      guardianships: [{ guardian_id: parent.id, athlete_id: CHILD.id }],
      people: [CHILD],
    });
    expect(chips()).toContain('Parent volunteer');
    await press('Parent volunteer');
    await pressInSection('Their child at the club', 'Sample Child');
    expect(screen.getByText(/statistician role starts when they do/)).toBeTruthy();
    await press('Save changes');
    expect(rpcsNamed('admin_set_volunteer_exemption')[0][1]).toMatchObject({
      p_profile_id: parent.id,
      p_basis: 'parent_volunteer',
      p_child_id: CHILD.id,
    });
  });

  it('never offers the reason exemption to a statistician who also manages', async () => {
    await openMember({ ...statistician(), extra_roles: ['manager'] });
    expect(screen.queryByText('Exempt')).toBeNull();
    expect(screen.getByText('Has a check')).toBeTruthy();
  });
});

describe('volunteer exemptions for coaches, managers and physios', () => {
  const chips = () =>
    ['Has a check', 'Parent volunteer', 'Under-18 volunteer', 'Short-term visitor', 'National event or tour'].filter(
      (l) => screen.queryByText(l),
    );

  it('offers an adult coach who isn’t a parent only the visitor and event exemptions', async () => {
    await openMember(p('coach'));
    expect(chips()).toEqual(['Has a check', 'Short-term visitor', 'National event or tour']);
  });

  it('offers a coach who is a parent of a child here the parent volunteer exemption, for that child', async () => {
    const coachParent = morePersonas.coachGuardian.profile;
    await openMember(coachParent, {
      guardianships: [{ guardian_id: coachParent.id, athlete_id: CHILD.id }],
      people: [CHILD],
    });
    expect(chips()).toEqual(['Has a check', 'Parent volunteer', 'Short-term visitor', 'National event or tour']);
    await press('Parent volunteer');
    expect(screen.queryByText('Card number')).toBeNull();
    await press('Save changes');
    expect(screen.getByText('Choose the child they volunteer for.')).toBeTruthy();
    expect(adminWrites()).toEqual([]);

    await pressInSection('Their child at the club', 'Sample Child');
    await press('Save changes');
    expect(writeNames()).toEqual([
      'admin_set_member_details',
      'admin_set_volunteer_exemption',
      'admin_save_member',
    ]);
    expect(rpcsNamed('admin_set_volunteer_exemption')[0][1]).toEqual({
      p_profile_id: coachParent.id,
      p_basis: 'parent_volunteer',
      p_child_id: CHILD.id,
      p_starts_on: null,
      p_event_name: null,
      p_organiser: null,
    });
  });

  it('offers an under-18 coach the under-18 volunteer exemption', async () => {
    const youngCoach: Profile = { ...CHILD, id: 'young-coach', extra_roles: ['coach'] };
    await openMember(youngCoach);
    expect(chips()).toEqual(['Has a check', 'Under-18 volunteer', 'Short-term visitor', 'National event or tour']);
    await press('Under-18 volunteer');
    expect(screen.getByText(/It ends by itself\s+when they turn 18/)).toBeTruthy();
  });

  it('needs the day a visitor arrived in WA, then records it', async () => {
    await openMember(p('coach'));
    await press('Short-term visitor');
    await press('Save changes');
    expect(screen.getByText('Enter the day they arrived in WA as DD/MM/YYYY.')).toBeTruthy();
    expect(adminWrites()).toEqual([]);

    await typeInto('Day they arrived in WA', '10/10/2026');
    await press('Save changes');
    expect(rpcsNamed('admin_set_volunteer_exemption')[0][1]).toEqual({
      p_profile_id: 'coach',
      p_basis: 'short_term_visitor',
      p_child_id: null,
      p_starts_on: '2026-10-10',
      p_event_name: null,
      p_organiser: null,
    });
  });

  it('needs a national event’s first day, and sends its name and organiser', async () => {
    await openMember(p('manager'));
    await press('National event or tour');
    await press('Save changes');
    expect(screen.getByText('Enter the first day of the event or tour as DD/MM/YYYY.')).toBeTruthy();

    await typeInto('First day of the event or tour', '01/11/2026');
    await typeInto('Event or tour', ' National championships ');
    await typeInto('Organised by', ' Netball Australia ');
    await press('Save changes');
    expect(rpcsNamed('admin_set_volunteer_exemption')[0][1]).toEqual({
      p_profile_id: 'manager',
      p_basis: 'national_event',
      p_child_id: null,
      p_starts_on: '2026-11-01',
      p_event_name: 'National championships',
      p_organiser: 'Netball Australia',
    });
  });

  const OPEN_EXEMPTION: VolunteerExemption = {
    id: 'ex-1',
    profile_id: 'coach-guardian',
    basis: 'parent_volunteer',
    child_id: CHILD.id,
    child_name: 'Sample Child',
    set_by_name: 'Sample admin',
    set_at: '2026-09-01T00:00:00Z',
    declared_at: null,
    declaration_text: null,
    ended_at: null,
    ended_by_name: null,
    end_note: null,
    valid: true,
    ends_on: null,
    starts_on: null,
    event_name: null,
    organiser: null,
  };

  async function openWithExemption(extra: Partial<Profile> = {}) {
    const coachParent = { ...morePersonas.coachGuardian.profile, ...extra };
    await openMember(coachParent, {
      guardianships: [{ guardian_id: coachParent.id, athlete_id: CHILD.id }],
      people: [CHILD],
      exemptions: [
        OPEN_EXEMPTION,
        {
          ...OPEN_EXEMPTION,
          id: 'ex-0',
          basis: 'short_term_visitor',
          child_id: null,
          child_name: null,
          starts_on: '2026-01-01',
          ends_on: '2026-01-14',
          set_at: '2025-12-30T00:00:00Z',
          ended_at: '2026-01-15T00:00:00Z',
          ended_by_name: 'Other admin',
          end_note: 'Ended by itself',
        },
        // Someone else's: never shown on this page.
        { ...OPEN_EXEMPTION, id: 'ex-other', profile_id: 'someone-else', basis: 'under_18_volunteer' },
      ],
    });
  }

  it('shows the open exemption and earlier ones, and sends nothing when it hasn’t changed', async () => {
    await openWithExemption();
    expect(isChosen(screen.getByText('Parent volunteer'))).toBe(true);
    expect(
      screen.getByText(
        `Parent volunteer for Sample Child: waiting for them to accept the declaration. Recorded by Sample admin on ${localDay('2026-09-01T00:00:00Z')}.`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Earlier: Short-term visitor, 01/01/2026 to 14/01/2026, recorded ${localDay('2025-12-30T00:00:00Z')}, ended ${localDay('2026-01-15T00:00:00Z')} by Other admin (Ended by itself)`,
      ),
    ).toBeTruthy();
    await press('Save changes');
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_save_member']);
  });

  it('ends the exemption when the admin records a check instead', async () => {
    await openWithExemption();
    await press('Has a check');
    await press('Save changes');
    expect(writeNames()).toEqual([
      'admin_set_member_details',
      'admin_end_volunteer_exemption',
      'admin_save_member',
    ]);
    expect(rpcsNamed('admin_end_volunteer_exemption')[0][1]).toEqual({
      p_profile_id: 'coach-guardian',
      p_note: 'Changed to a Working With Children Check',
    });
  });

  it('ends the exemption when they no longer hold a role that needs one', async () => {
    await openWithExemption();
    await pressInSection('Role', 'Guardian');
    await press('Save changes');
    expect(rpcsNamed('admin_end_volunteer_exemption')[0][1]).toEqual({
      p_profile_id: 'coach-guardian',
      p_note: 'No longer in a role that needs one',
    });
  });

  it('stops before saving the member when the exemption is refused', async () => {
    await openMember(p('coach'), {
      rpcErrors: { admin_set_volunteer_exemption: 'They used a visitor exemption in the last 12 months' },
    });
    await press('Short-term visitor');
    await typeInto('Day they arrived in WA', '10/10/2026');
    await press('Save changes');
    expect(screen.getByText('They used a visitor exemption in the last 12 months')).toBeTruthy();
    expect(writeNames()).toEqual(['admin_set_member_details', 'admin_set_volunteer_exemption']);
    expect(back).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Validating a card

describe('validating a coach’s card', () => {
  it('needs how it was checked, then records the name, method and registration', async () => {
    await openMember(p('coach'), { people: [p('admin')] });
    expect(screen.getByText('Check not validated. Card not registered with the club.')).toBeTruthy();
    expect(fieldFor('Name on the card').props.value).toBe('Sample coach');
    await press('Record validation');
    expect(screen.getByText('Choose how you checked the card.')).toBeTruthy();
    expect(rpcsNamed('admin_validate_wwcc')).toEqual([]);

    await typeInto('Name on the card', 'Sam Coach');
    await press('Card sighted');
    fireEvent(screen.getByLabelText('Registered card with Sample Club'), 'valueChange', true);
    await press('Record validation');
    expect(rpcsNamed('admin_validate_wwcc')).toEqual([
      [
        'admin_validate_wwcc',
        { p_profile_id: 'coach', p_card_name: 'Sam Coach', p_method: 'card_sighted', p_unit_linked: true },
      ],
    ]);
    // The admin who just did it, not "a former admin".
    expect(screen.getByText(new RegExp(`^Card sighted on ${localDay(new Date().toISOString())} by Sample admin\. Name on card: Sam Coach`))).toBeTruthy();
    expect(screen.queryByText('Check not validated. Card not registered with the club.')).toBeNull();
  });

  it('shows the database’s refusal', async () => {
    await openMember(p('coach'), { rpcErrors: { admin_validate_wwcc: 'Nobody validates their own card' } });
    await press('Checked online');
    await press('Record validation');
    expect(screen.getByText('Nobody validates their own card')).toBeTruthy();
  });

  it('shows an earlier validation with who did it', async () => {
    await openMember(
      {
        ...p('coach'),
        wwcc_validated_at: '2026-06-01T00:00:00Z',
        wwcc_validated_by: 'other-admin',
        wwcc_validation_method: 'online',
        wwcc_card_name: 'Sam Coach',
        wwcc_unit_linked_at: '2026-06-02T00:00:00Z',
      },
      { people: [{ ...p('admin'), id: 'other-admin', full_name: 'Other Admin' }] },
    );
    expect(
      screen.getByText(
        `Checked online on ${localDay('2026-06-01T00:00:00Z')} by Other Admin. Name on card: Sam Coach. Registered with Sample Club on ${localDay('2026-06-02T00:00:00Z')}.`,
      ),
    ).toBeTruthy();
  });

  it('asks another admin to validate an admin’s own card', async () => {
    await openMember(p('admin'));
    expect(screen.getByText('Another admin needs to validate your card.')).toBeTruthy();
    expect(screen.queryByText('Record validation')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Verifying who someone is

describe('verifying who someone is', () => {
  it('checks their code and then shows them as verified', async () => {
    await openMember(p('pending'));
    expect(screen.getByText('Not yet')).toBeTruthy();
    await typeInto('Their code', '123456');
    await press('Check code');
    expect(rpcsNamed('admin_verify_member')).toEqual([
      ['admin_verify_member', { p_profile_id: 'pending', p_code: '123456' }],
    ]);
    expect(screen.getByText(/^Yes, .*, code checked in person$/)).toBeTruthy();
    expect(screen.queryByText('Verify who they are')).toBeNull();
  });

  it('shows a wrong code and leaves them unverified', async () => {
    await openMember(p('pending'), { rpcErrors: { admin_verify_member: 'That code doesn’t match' } });
    await typeInto('Their code', '000000');
    await press('Check code');
    expect(screen.getByText('That code doesn’t match')).toBeTruthy();
    expect(screen.getByText('Verify who they are')).toBeTruthy();
    expect(screen.getByText('Not yet')).toBeTruthy();
  });

  it('records a check against ID, needing a note of what was checked', async () => {
    await openMember({ ...GUARDIAN, verified_at: null });
    await press('ID sighted');
    await press('Record check');
    expect(screen.getByText('Write what you checked.')).toBeTruthy();
    expect(rpcsNamed('admin_record_verification')).toEqual([]);

    await typeInto('What you checked', '  Driver’s licence, name and photo match  ');
    await press('Record check');
    expect(rpcsNamed('admin_record_verification')).toEqual([
      [
        'admin_record_verification',
        { p_profile_id: 'guardian', p_method: 'id_sighted', p_note: '  Driver’s licence, name and photo match  ' },
      ],
    ]);
    expect(screen.getByText(/^Yes, .*, id sighted$/)).toBeTruthy();
    expect(screen.getByText('Driver’s licence, name and photo match')).toBeTruthy();
  });

  it('shows a refused check', async () => {
    await openMember({ ...GUARDIAN, verified_at: null }, {
      rpcErrors: { admin_record_verification: 'You can’t verify yourself' },
    });
    await press('Matched to PlayHQ');
    await typeInto('What you checked', 'Listed as parent in PlayHQ');
    await press('Record check');
    expect(screen.getByText('You can’t verify yourself')).toBeTruthy();
    expect(screen.getByText('Verify who they are')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A child's parents and guardians

describe('changing a child’s guardians', () => {
  const linked = { guardian_id: GUARDIAN.id, athlete_id: CHILD.id };

  it('sends the same guardians and no reason when they haven’t changed', async () => {
    await openMember(CHILD, { guardianships: [linked], people: [GUARDIAN, OTHER_GUARDIAN] });
    expect(screen.queryByText('Reason for the change (optional)')).toBeNull();
    await press('Save changes');
    expect(savedMember()).toMatchObject({
      p_under_17: true,
      p_guardian_ids: [GUARDIAN.id],
      p_guardian_reason: null,
    });
  });

  it('swaps one guardian for another, with the reason', async () => {
    await openMember(CHILD, { guardianships: [linked], people: [GUARDIAN, OTHER_GUARDIAN] });
    await press('Sample guardian  ✕');
    expect(screen.getByText('No guardians linked yet.')).toBeTruthy();
    await typeInto('Add a guardian', 'other');
    await press('Other Parent');
    await typeInto('Reason for the change (optional)', 'Parenting order seen 12/10/2026');
    expect(screen.getByText(/^Only admins see the reason\./)).toBeTruthy();
    await press('Save changes');
    expect(savedMember()).toMatchObject({
      p_guardian_ids: [OTHER_GUARDIAN.id],
      p_guardian_reason: 'Parenting order seen 12/10/2026',
    });
  });

  it('never offers the child themself, or a guardian already linked, in the search', async () => {
    const childWhoIsGuardian = { ...CHILD };
    await openMember(childWhoIsGuardian, {
      guardianships: [linked],
      people: [GUARDIAN, OTHER_GUARDIAN, { ...CHILD, extra_roles: ['guardian'] }],
    });
    await typeInto('Add a guardian', 'sample');
    expect(screen.queryByText('Sample guardian')).toBeNull();
    expect(screen.queryByText('Sample Child')).toBeNull();
  });

  it('lets an admin who is the child’s guardian save the child without changing their guardians', async () => {
    const adminParent = morePersonas.adminGuardian;
    await openMember(CHILD, {
      viewer: adminParent,
      guardianships: [{ guardian_id: adminParent.profile.id, athlete_id: CHILD.id }],
      people: [adminParent.profile],
    });
    await press('Save changes');
    expect(savedMember()).toMatchObject({
      p_guardian_ids: [adminParent.profile.id],
      p_guardian_reason: null,
    });
  });

  it('sends no guardians for an adult athlete', async () => {
    await openMember({ ...CHILD, date_of_birth: '2000-01-01' }, { guardianships: [linked], people: [GUARDIAN] });
    expect(screen.getByText('18 or over.')).toBeTruthy();
    expect(screen.queryByText('Parents and guardians')).toBeNull();
    await press('Save changes');
    expect(savedMember()).toMatchObject({ p_under_17: false, p_guardian_ids: [], p_guardian_reason: null });
  });
});

// ---------------------------------------------------------------------------
// Deleting

describe('deleting a member', () => {
  it('asks once more, explaining what goes and what stays, then deletes them', async () => {
    await openMember(p('coach'));
    await press('Delete member');
    expect(
      screen.getByText(
        'This permanently deletes Sample coach: their account, squad and team places, guardian links and message receipts. Messages they sent stay, and their injury records are kept for the club’s period for cleared injuries. It can’t be undone. To only stop them using the app, use Remove access instead.',
      ),
    ).toBeTruthy();
    await press('Delete permanently');
    expect(adminWrites()).toEqual([['admin_delete_member', { p_profile_id: 'coach' }]]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('says why when a concern names the member, and stays on their page', async () => {
    await openMember(p('coach'), {
      rpcErrors: { admin_delete_member: 'A concern names this member, so their account and records are kept while it does.' },
    });
    await press('Delete member');
    await press('Delete permanently');
    expect(screen.getByText('A concern names this member, so their account and records are kept while it does.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('doesn’t mention Remove access for a request that was never approved', async () => {
    await openMember(p('pending'));
    await press('Delete member');
    expect(screen.getByText(/It can’t be undone\.$/)).toBeTruthy();
  });

  it('deletes nothing when the admin cancels', async () => {
    await openMember(p('coach'));
    await press('Delete member');
    await press('Cancel');
    expect(screen.queryByText('Delete permanently')).toBeNull();
    expect(adminWrites()).toEqual([]);
  });

  it('shows the database’s refusal and stays on the page', async () => {
    await openMember(p('coach'), { rpcErrors: { admin_delete_member: 'Only admins can delete members' } });
    await press('Delete member');
    await press('Delete permanently');
    expect(screen.getByText('Only admins can delete members')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Standing down

const OPEN_STAND_DOWN: StandDown = {
  id: 'sd-1',
  profile_id: 'stood-down-coach',
  member_name: 'Sample stood-down-coach',
  reason: 'allegation',
  note: 'Raised by a parent',
  started_at: '2026-10-01T00:00:00Z',
  started_by_name: 'Sample admin',
  lifted_at: null,
  lifted_by_name: null,
  lift_note: null,
};

describe('standing a member down', () => {
  it('needs a reason, then stands them down with the note and goes back', async () => {
    await openMember(p('coach'));
    expect(screen.getByText(/^Stops Sample coach’s coach, manager, physio, committee, admin and statistician roles straight away/)).toBeTruthy();
    await press('Stand down now');
    expect(screen.getByText('Choose why.')).toBeTruthy();
    expect(rpcsNamed('admin_stand_down')).toEqual([]);

    await pressInSection('Stand down', 'Allegation being looked into');
    await typeInto('Note (optional)', 'Raised by a parent');
    await press('Stand down now');
    expect(rpcsNamed('admin_stand_down')).toEqual([
      ['admin_stand_down', { p_profile_id: 'coach', p_reason: 'allegation', p_note: 'Raised by a parent' }],
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('asks why when the reason is Other', async () => {
    await openMember(p('manager'));
    await pressInSection('Stand down', 'Other');
    await typeInto('Why', 'Not following the code of conduct');
    await press('Stand down now');
    expect(rpcsNamed('admin_stand_down')[0][1]).toEqual({
      p_profile_id: 'manager',
      p_reason: 'other',
      p_note: 'Not following the code of conduct',
    });
  });

  it('shows the database’s refusal and stays on the page', async () => {
    await openMember(p('coach'), { rpcErrors: { admin_stand_down: 'They are already stood down' } });
    await pressInSection('Stand down', 'Interim negative notice');
    await press('Stand down now');
    expect(screen.getByText('They are already stood down')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('lifts an open stand-down with a note', async () => {
    await openMember(p('stoodDownCoach'), { standDowns: [OPEN_STAND_DOWN] });
    expect(
      screen.getByText(
        new RegExp(`^Stood down since ${localDay('2026-10-01T00:00:00Z')}: Allegation being looked into \\(Raised by a parent\\)\\.`),
      ),
    ).toBeTruthy();
    await typeInto('Note (optional)', 'Allegation not substantiated');
    await press('Lift stand-down');
    expect(rpcsNamed('admin_lift_stand_down')).toEqual([
      ['admin_lift_stand_down', { p_profile_id: 'stood-down-coach', p_note: 'Allegation not substantiated' }],
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('shows a refused lift and stays on the page', async () => {
    await openMember(p('stoodDownCoach'), {
      standDowns: [OPEN_STAND_DOWN],
      rpcErrors: { admin_lift_stand_down: 'Only admins can lift a stand-down' },
    });
    await press('Lift stand-down');
    expect(screen.getByText('Only admins can lift a stand-down')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Screening Unit notices

const NOTICE: ScreeningNotice = {
  id: 'notice-1',
  profile_id: 'coach',
  member_name: 'Sample coach',
  kind: 'negative_notice',
  received_on: '2026-10-15',
  action: 'Removed from coaching the same day',
  governing_body_told_on: null,
  governing_body_told_by_name: null,
  recorded_at: '2026-10-15T01:00:00Z',
  recorded_by_name: 'Sample admin',
};

describe('Screening Unit notices', () => {
  it('records a barring notice, dated today unless changed, and goes back as it stood them down', async () => {
    await openMember(p('coach'));
    expect(screen.queryByText('Record notice')).toBeNull();
    await pressInSection('Screening Unit notices', 'Negative notice');
    expect(fieldFor('Date it arrived').props.value).toBe('18/10/2026');
    await typeInto('What the club did', 'Removed from coaching the same day');
    await press('Record notice');
    expect(rpcsNamed('admin_record_screening_notice')).toEqual([
      [
        'admin_record_screening_notice',
        {
          p_profile_id: 'coach',
          p_kind: 'negative_notice',
          p_received_on: '2026-10-18',
          p_action: 'Removed from coaching the same day',
        },
      ],
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('records an Other notice without leaving the page, as it stands nobody down', async () => {
    await openMember(p('coach'));
    await pressInSection('Screening Unit notices', 'Other notice');
    await typeInto('Date it arrived', '12/10/2026');
    await press('Record notice');
    expect(rpcsNamed('admin_record_screening_notice')[0][1]).toMatchObject({
      p_kind: 'other',
      p_received_on: '2026-10-12',
    });
    expect(back).not.toHaveBeenCalled();
    // The form closes once it's recorded.
    expect(screen.queryByText('Record notice')).toBeNull();
  });

  it('refuses a date that isn’t a date', async () => {
    await openMember(p('coach'));
    await pressInSection('Screening Unit notices', 'Interim negative notice');
    await typeInto('Date it arrived', 'yesterday');
    await press('Record notice');
    expect(screen.getByText('Enter the date it arrived as DD/MM/YYYY.')).toBeTruthy();
    expect(rpcsNamed('admin_record_screening_notice')).toEqual([]);
  });

  it('shows a refused notice and stays on the page', async () => {
    await openMember(p('coach'), {
      rpcErrors: { admin_record_screening_notice: 'You can’t record a notice about yourself' },
    });
    await pressInSection('Screening Unit notices', 'Card cancelled or suspended');
    await press('Record notice');
    expect(screen.getByText('You can’t record a notice about yourself')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('records a notice about a guardian, who has no stand-down section', async () => {
    await openMember(GUARDIAN);
    await pressInSection('Screening Unit notices', 'Interstate decision');
    await press('Record notice');
    expect(rpcsNamed('admin_record_screening_notice')[0][1]).toMatchObject({
      p_profile_id: 'guardian',
      p_kind: 'interstate_decision',
    });
  });

  it('asks for the day the governing body was told of a barring notice, then records it', async () => {
    await openMember(p('coach'), { notices: [NOTICE] });
    expect(screen.getByText('Negative notice, received 15/10/2026')).toBeTruthy();
    expect(screen.getByText('Removed from coaching the same day')).toBeTruthy();
    expect(
      screen.getByText(`Recorded ${localDay(NOTICE.recorded_at)} by Sample admin. Governing body not told yet.`),
    ).toBeTruthy();
    expect(screen.getByText('Tell the governing body in writing, then record the date.')).toBeTruthy();

    await typeInto('Date you told them', '');
    await press('Governing body told: negative notice');
    expect(screen.getByText('Enter the date you told them as DD/MM/YYYY.')).toBeTruthy();
    expect(rpcsNamed('admin_screening_notice_reported')).toEqual([]);

    await typeInto('Date you told them', '17/10/2026');
    await press('Governing body told: negative notice');
    expect(rpcsNamed('admin_screening_notice_reported')).toEqual([
      ['admin_screening_notice_reported', { p_notice_id: 'notice-1', p_told_on: '2026-10-17' }],
    ]);
  });

  it('shows when the governing body was told, with nothing left to do', async () => {
    await openMember(p('coach'), {
      notices: [
        { ...NOTICE, governing_body_told_on: '2026-10-16', governing_body_told_by_name: 'Other admin' },
        { ...NOTICE, id: 'notice-2', kind: 'other', received_on: '2026-09-01', action: 'Noted' },
      ],
    });
    expect(
      screen.getByText(
        `Recorded ${localDay(NOTICE.recorded_at)} by Sample admin. Governing body told 16/10/2026 (recorded by Other admin).`,
      ),
    ).toBeTruthy();
    // An Other notice never needs the governing body told.
    expect(screen.getByText('Other notice, received 01/09/2026')).toBeTruthy();
    expect(screen.queryByText(/^Governing body told:/)).toBeNull();
    expect(screen.queryByText('Tell the governing body in writing, then record the date.')).toBeNull();
  });

  it('shows a refused report to the governing body', async () => {
    await openMember(p('coach'), {
      notices: [NOTICE],
      rpcErrors: { admin_screening_notice_reported: 'That date is before the notice arrived' },
    });
    await press('Governing body told: negative notice');
    expect(screen.getByText('That date is before the notice arrived')).toBeTruthy();
  });
});
