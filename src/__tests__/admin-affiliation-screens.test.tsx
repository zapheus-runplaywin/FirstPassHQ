/**
 * Administration > Affiliation (src/app/admin/affiliation/index.tsx), its
 * PlayHQ registrations (registrations.tsx) and the yearly return
 * (return.tsx), as an admin uses them (section 10 of the user guide,
 * "Affiliation").
 *
 * The rules: primary contacts are two different approved adults who aren't
 * stood down; dates are DD/MM/YYYY; an association picks its tier and names
 * the officers its tier needs, each with their induction date; the checklist
 * follows what's on screen before saving. The return names no member under
 * 18 and records who sent it.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen, within } from 'expo-router/testing-library';

import AffiliationScreen from '@/app/admin/affiliation/index';
import RegistrationsScreen from '@/app/admin/affiliation/registrations';
import AffiliationReturnScreen from '@/app/admin/affiliation/return';
import type { Affiliation, Registration } from '@/lib/affiliation';
import { reportPdf } from '@/lib/pdf';
import { localDay, sharePdf } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

import { openScreen, personas, resetClub, setClubFeatures, settle, TEAM } from './helpers/harness';
import { fieldGroup, flip, input, isDisabled, isOn, isSelected, pickPerson, type } from './helpers/settings-forms';

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

// Each test settles a whole screen several times; leave room on a busy machine.
jest.setTimeout(30000);
jest.mock('@/lib/reports', () => ({ ...jest.requireActual('@/lib/reports'), sharePdf: jest.fn(async () => {}) }));
jest.mock('@/lib/pdf', () => ({ ...jest.requireActual('@/lib/pdf'), reportPdf: jest.fn(() => new Uint8Array([1])) }));

const rpc = () => supabase.rpc as jest.Mock;
const rpcNames = () => (rpc().mock.calls as [string][]).map(([n]) => n);
const callsTo = (name: string) =>
  (rpc().mock.calls as [string, Record<string, unknown>][])
    .filter(([n]) => n === name)
    .map(([, args]) => args);

beforeEach(() => {
  resetClub();
  setClubFeatures({ affiliation: true });
  rpc().mockClear();
  (sharePdf as jest.Mock).mockClear();
  (reportPdf as jest.Mock).mockClear();
});

function Placeholder() {
  return null;
}

const p = (name: keyof typeof personas) => personas[name].profile!;
const ADMIN = p('admin');
const COMMITTEE = p('committee');
const COACH = p('coach');
const MINOR = { ...p('minorAthlete'), full_name: 'Sample minor' };
const STOOD_DOWN = p('stoodDownCoach');
const PEOPLE: Profile[] = [ADMIN, COMMITTEE, COACH, MINOR, STOOD_DOWN];

function affiliation(extra: Partial<Affiliation> = {}): Affiliation {
  return {
    member_type: 'club',
    tier: null,
    incorporation_number: null,
    affiliated_with: 'Sample Netball Association',
    registered_on: '2026-03-01',
    primary_contact_1_id: 'admin',
    primary_contact_1_name: 'Sample admin',
    primary_contact_2_id: null,
    primary_contact_2_name: null,
    checks: { compliance: true },
    notes: 'Evidence in the shared drive',
    updated_at: '2026-10-01T02:00:00Z',
    updated_by_name: 'Sample admin',
    season: 2026,
    team_count: 3,
    registrations_total: 20,
    registered: 12,
    not_registered: 3,
    ...extra,
  };
}

const RETURN_INFO = {
  return_email: 'affiliations@association.example',
  last_sent_at: '2026-09-01T02:00:00Z',
  last_sent_to: 'affiliations@association.example',
  last_sent_by_name: 'Sample admin',
};

// ---------------------------------------------------------------------------
// The affiliation record

async function openAffiliation(
  a: Affiliation | null = affiliation(),
  { officers = [] as unknown[], info = RETURN_INFO as unknown, rpcErrors = {} as Record<string, string> } = {},
) {
  await openScreen(
    'admin',
    {
      'admin/affiliation/index': AffiliationScreen,
      'admin/affiliation/registrations': Placeholder,
      'admin/affiliation/return': Placeholder,
    },
    '/admin/affiliation',
    {},
    {
      tableHandlers: { profiles: (q) => (q.eq('status') === 'approved' ? PEOPLE : undefined) },
      rpcs: { admin_affiliation: a, admin_affiliation_officers: officers, admin_affiliation_return: info },
      rpcErrors,
    },
  );
}

async function save() {
  await fireEvent.press(screen.getByText('Save'));
  await settle();
}

const PICKER_1 = 'Primary contact 1';
const PICKER_2 = 'Primary contact 2';

async function offered(picker: string) {
  await type(picker, 'Sample');
  return within(fieldGroup(picker))
    .queryAllByText(/^Sample/)
    .map((t) => t.props.children as string)
    .filter((t) => !t.endsWith('✕'))
    .sort();
}

describe('the affiliation record', () => {
  it('starts from the saved record, with this season’s teams, registrations and last return', async () => {
    await openAffiliation();
    expect(isSelected('Affiliated club')).toBe(true);
    expect(input('Affiliated with').props.value).toBe('Sample Netball Association');
    expect(input('Last registered with them (DD/MM/YYYY)').props.value).toBe('01/03/2026');
    expect(input('Send affiliation returns to (email)').props.value).toBe('affiliations@association.example');
    expect(input('Notes').props.value).toBe('Evidence in the shared drive');
    expect(within(fieldGroup(PICKER_1)).getByText('Sample admin  ✕')).toBeTruthy();
    expect(screen.getByText('3 teams in 2026–27.')).toBeTruthy();
    expect(screen.getByText('PlayHQ registrations 2026–27')).toBeTruthy();
    expect(screen.getByText('12 of 20 registered · 3 not registered · 5 to check')).toBeTruthy();
    expect(screen.getByText(`Last sent ${localDay(RETURN_INFO.last_sent_at)} by Sample admin to affiliations@association.example`)).toBeTruthy();
    expect(screen.getByText(`Last saved ${localDay('2026-10-01T02:00:00Z')} by Sample admin.`)).toBeTruthy();
  });

  it('shows an affiliated club’s checklist, worked out from what’s on screen', async () => {
    await openAffiliation();
    // Missing: two contacts, competition and PlayHQ; incorporation is only recommended under 5 teams.
    expect(screen.getByText('3 required items still to do. Tick the ones the app can’t see.')).toBeTruthy();
    expect(screen.getByText('✗ Incorporated')).toBeTruthy();
    expect(screen.getByText(/^Recommended · Highly recommended\. Required once the club has 5 or more teams \(you have 3\)\./)).toBeTruthy();
    expect(screen.getByText('✓ Registered with your member association this year')).toBeTruthy();
    expect(screen.getByText('✗ Two primary contacts')).toBeTruthy();
    expect(isOn('Follows Netball Australia and Netball WA policies')).toBe(true);
    await pickPerson(PICKER_2, 'committee', 'Sample committee');
    await flip('Plays in the member association’s competition', true);
    await flip('Members register online through PlayHQ', true);
    expect(screen.getByText('✓ Two primary contacts')).toBeTruthy();
    expect(screen.getByText('Every required item is done.')).toBeTruthy();
  });

  it('offers as primary contacts only adults who aren’t stood down, and never the other contact', async () => {
    await openAffiliation();
    expect(await offered(PICKER_2)).toEqual(['Sample coach', 'Sample committee']);
  });

  it('saves the record, without the return email when it hasn’t changed', async () => {
    await openAffiliation();
    await type('Incorporation number', 'A1234567');
    await type('Last registered with them (DD/MM/YYYY)', '2/9/2026');
    await pickPerson(PICKER_2, 'coach', 'Sample coach');
    await flip('Members register online through PlayHQ', true);
    await type('Notes', 'Kept by the secretary');
    rpc().mockClear();
    await save();
    expect(callsTo('admin_set_affiliation')).toEqual([
      {
        p_member_type: 'club',
        p_tier: null,
        p_incorporation_number: 'A1234567',
        p_affiliated_with: 'Sample Netball Association',
        p_registered_on: '2026-09-02',
        p_primary_contact_1_id: 'admin',
        p_primary_contact_2_id: 'coach',
        p_checks: { compliance: true, playhq: true },
        p_notes: 'Kept by the secretary',
      },
    ]);
    expect(callsTo('admin_set_affiliation_return_email')).toEqual([]);
    expect(callsTo('admin_set_affiliation_officer')).toEqual([]);
    expect(callsTo('admin_affiliation')).toHaveLength(1);
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('saves a blank registration day as none, and a changed return email', async () => {
    await openAffiliation();
    await type('Last registered with them (DD/MM/YYYY)', '');
    await type('Send affiliation returns to (email)', 'new@association.example');
    await save();
    expect(callsTo('admin_set_affiliation')[0].p_registered_on).toBeNull();
    expect(callsTo('admin_set_affiliation_return_email')).toEqual([{ p_email: 'new@association.example' }]);
  });

  it.each(['31/02/2026', '2026-03-01', '1/3/26'])('refuses the club registration day “%s”', async (day) => {
    await openAffiliation();
    await type('Last registered with them (DD/MM/YYYY)', day);
    await save();
    expect(screen.getByText('Enter the day the club registered as DD/MM/YYYY.')).toBeTruthy();
    expect(callsTo('admin_set_affiliation')).toEqual([]);
  });

  it('asks an association for its tier before saving', async () => {
    await openAffiliation();
    await fireEvent.press(screen.getByText('Association'));
    expect(screen.getByText('Choose the tier to see the checklist.')).toBeTruthy();
    await save();
    expect(screen.getByText('Choose the association’s tier.')).toBeTruthy();
    expect(callsTo('admin_set_affiliation')).toEqual([]);
  });

  it('words an association’s date as the annual agreement', async () => {
    await openAffiliation();
    await fireEvent.press(screen.getByText('Association'));
    await type('Annual agreement signed (DD/MM/YYYY)', 'soon');
    await fireEvent.press(screen.getByText('Tier 3 (1 to 249)'));
    await save();
    expect(screen.getByText('Enter the day the agreement was signed as DD/MM/YYYY.')).toBeTruthy();
  });

  it('names a Tier 2 association’s officers and saves each with its induction day', async () => {
    await openAffiliation(affiliation({ member_type: 'association', tier: 2 }), {
      officers: [{ office: 'president', profile_id: 'committee', name: 'Sample committee', inducted_on: '2026-05-01' }],
    });
    expect(screen.getByText('Officers')).toBeTruthy();
    for (const office of ['President', 'Association Development Officer', 'Association Umpire Development Officer']) {
      expect(screen.getByText(office)).toBeTruthy();
    }
    expect(screen.queryByText('Another committee member')).toBeNull();
    expect(input('Induction completed (DD/MM/YYYY)').props.value).toBe('01/05/2026');
    await pickPerson('Association Development Officer', 'coach', 'Sample coach');
    await type('Induction completed (DD/MM/YYYY)', '15/06/2026', 1);
    await save();
    expect(callsTo('admin_set_affiliation')[0]).toMatchObject({ p_member_type: 'association', p_tier: 2 });
    expect(callsTo('admin_set_affiliation_officer')).toEqual([
      { p_office: 'president', p_profile_id: 'committee', p_inducted_on: '2026-05-01' },
      { p_office: 'ado', p_profile_id: 'coach', p_inducted_on: '2026-06-15' },
      { p_office: 'audo', p_profile_id: null, p_inducted_on: null },
    ]);
  });

  it('names only a representative for a Tier 4 member entity', async () => {
    await openAffiliation(affiliation({ member_type: 'association', tier: 4 }));
    expect(screen.getByText('Representative')).toBeTruthy();
    expect(screen.queryByText('President')).toBeNull();
    await save();
    expect(callsTo('admin_set_affiliation_officer')).toEqual([
      { p_office: 'representative', p_profile_id: null, p_inducted_on: null },
    ]);
  });

  it('refuses an induction day that isn’t a date, naming the office', async () => {
    await openAffiliation(affiliation({ member_type: 'association', tier: 3 }), {
      officers: [{ office: 'president', profile_id: 'committee', name: 'Sample committee', inducted_on: null }],
    });
    await type('Induction completed (DD/MM/YYYY)', '99/99/2026');
    await save();
    expect(screen.getByText('Enter the President’s induction date as DD/MM/YYYY.')).toBeTruthy();
    expect(callsTo('admin_set_affiliation')).toEqual([]);
  });

  it('shows a refused officer with the office, and doesn’t say it saved', async () => {
    await openAffiliation(affiliation({ member_type: 'association', tier: 4 }), {
      rpcErrors: { admin_set_affiliation_officer: 'Officers must be approved adults' },
    });
    await save();
    expect(screen.getByText('Representative: Officers must be approved adults')).toBeTruthy();
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('stops at a refused record before the email and officers', async () => {
    await openAffiliation(affiliation({ member_type: 'association', tier: 4 }), {
      rpcErrors: { admin_set_affiliation: 'Only admins can change affiliation records' },
    });
    await type('Send affiliation returns to (email)', 'new@association.example');
    await save();
    expect(screen.getByText('Only admins can change affiliation records')).toBeTruthy();
    expect(rpcNames()).not.toContain('admin_set_affiliation_return_email');
    expect(rpcNames()).not.toContain('admin_set_affiliation_officer');
  });

  it('stops at a refused return email before the officers', async () => {
    await openAffiliation(affiliation({ member_type: 'association', tier: 4 }), {
      rpcErrors: { admin_set_affiliation_return_email: 'Enter an email address' },
    });
    await type('Send affiliation returns to (email)', 'not an email');
    await save();
    expect(screen.getByText('Enter an email address')).toBeTruthy();
    expect(rpcNames()).not.toContain('admin_set_affiliation_officer');
  });

  it('shows why the record didn’t load', async () => {
    await openAffiliation(null, { rpcErrors: { admin_affiliation: 'Only admins see affiliation records' } });
    expect(screen.getByText('Only admins see affiliation records')).toBeTruthy();
    expect(screen.queryByText('Checklist')).toBeNull();
  });

  it('says when there are no squads or teams for registrations yet', async () => {
    await openAffiliation(affiliation({ season: null, team_count: 0 }), { info: null });
    expect(screen.getByText('No squads or teams yet.')).toBeTruthy();
    expect(screen.queryByText(/^PlayHQ registrations/)).toBeNull();
    expect(screen.getByText('A yearly summary for your association, as a PDF. None sent yet')).toBeTruthy();
  });

  it('opens PlayHQ registrations and the affiliation return', async () => {
    await openAffiliation();
    await fireEvent.press(screen.getByText('PlayHQ registrations 2026–27'));
    await settle();
    expect(screen).toHavePathname('/admin/affiliation/registrations');
    await act(() => router.back());
    await settle();
    await fireEvent.press(screen.getByText('Affiliation return'));
    await settle();
    expect(screen).toHavePathname('/admin/affiliation/return');
  });
});

// ---------------------------------------------------------------------------
// PlayHQ registrations

function registration(profile_id: string, name: string, registered: boolean | null, extra: Partial<Registration> = {}): Registration {
  return {
    profile_id,
    name,
    playhq_email: null,
    email: `${profile_id}@example.test`,
    team_roles: ['athlete'],
    groups: ['Open A'],
    registered,
    checked_at: registered === null ? null : '2026-10-05T02:00:00Z',
    checked_by_name: registered === null ? null : 'Sample admin',
    ...extra,
  };
}

const REGISTRATIONS = [
  registration('r1', 'Ava Unchecked', null, { playhq_email: 'ava.playhq@example.test', team_roles: ['athlete', 'coach'], groups: ['Open A', '17 & Under A'] }),
  registration('r2', 'Ben Unchecked', null, { email: null }),
  registration('r3', 'Cat Missing', false),
  registration('r4', 'Dan Done', true),
];

async function openRegistrations(a: Affiliation | null = affiliation(), rpcErrors: Record<string, string> = {}) {
  await openScreen('admin', { 'admin/affiliation/registrations': RegistrationsScreen }, '/admin/affiliation/registrations', {}, {
    rpcs: { admin_affiliation: a, admin_playhq_registrations: REGISTRATIONS },
    rpcErrors,
  });
}

/** The `choice` chip on one person's card. */
function inCard(name: string, choice: string) {
  let node = screen.getByText(name).parent;
  while (node && within(node).queryAllByText(choice).length === 0) node = node.parent;
  return within(node!).getByText(choice);
}

describe('PlayHQ registrations', () => {
  it('shows who is still to check, with counts for each filter', async () => {
    await openRegistrations();
    expect(callsTo('admin_playhq_registrations')).toEqual([{ p_season: 2026 }]);
    for (const label of ['To check (2)', 'Not registered (1)', 'Registered (1)', 'All (4)']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Ava Unchecked')).toBeTruthy();
    expect(screen.getByText('Athlete, Coach · Open A, 17 & Under A')).toBeTruthy();
    expect(screen.getByText('PlayHQ email: ava.playhq@example.test')).toBeTruthy();
    expect(screen.queryByText('Cat Missing')).toBeNull();
    expect(screen.queryByText('Dan Done')).toBeNull();
  });

  it('filters by Not registered, Registered and All, showing who checked', async () => {
    await openRegistrations();
    await fireEvent.press(screen.getByText('Not registered (1)'));
    expect(screen.getByText('Cat Missing')).toBeTruthy();
    expect(screen.queryByText('Ava Unchecked')).toBeNull();
    expect(screen.getByText(`Checked ${localDay('2026-10-05T02:00:00Z')} by Sample admin`)).toBeTruthy();
    await fireEvent.press(screen.getByText('Registered (1)'));
    expect(screen.getByText('Dan Done')).toBeTruthy();
    await fireEvent.press(screen.getByText('All (4)'));
    expect(screen.getAllByText(/Unchecked|Missing|Done/)).toHaveLength(4);
  });

  it('searches names and emails', async () => {
    await openRegistrations();
    await fireEvent.press(screen.getByText('All (4)'));
    await type('Search', 'ava.playhq');
    expect(screen.getByText('Ava Unchecked')).toBeTruthy();
    expect(screen.queryByText('Ben Unchecked')).toBeNull();
    await type('Search', 'nobody');
    expect(screen.getByText('Nobody here.')).toBeTruthy();
  });

  it('marks someone registered for the season and keeps them in view to undo', async () => {
    await openRegistrations();
    await fireEvent.press(inCard('Ava Unchecked', 'Registered'));
    await settle();
    expect(callsTo('admin_set_playhq_registration')).toEqual([
      { p_profile_id: 'r1', p_season: 2026, p_registered: true },
    ]);
    expect(screen.getByText('To check (1)')).toBeTruthy();
    expect(screen.getByText('Registered (2)')).toBeTruthy();
    // Still shown under To check until the filter changes.
    expect(screen.getByText('Ava Unchecked')).toBeTruthy();
    expect(screen.getByText(`Checked ${localDay(new Date().toISOString())}`)).toBeTruthy();
    await fireEvent.press(inCard('Ava Unchecked', 'Not registered'));
    await settle();
    expect(callsTo('admin_set_playhq_registration').at(-1)).toEqual({ p_profile_id: 'r1', p_season: 2026, p_registered: false });
    await fireEvent.press(screen.getByText('To check (1)'));
    expect(screen.queryByText('Ava Unchecked')).toBeNull();
  });

  it('sends nothing when the same answer is tapped again', async () => {
    await openRegistrations();
    await fireEvent.press(screen.getByText('Registered (1)'));
    await fireEvent.press(inCard('Dan Done', 'Registered'));
    await settle();
    expect(callsTo('admin_set_playhq_registration')).toEqual([]);
  });

  it('shows a refused mark and leaves the person unchecked', async () => {
    await openRegistrations(affiliation(), { admin_set_playhq_registration: 'Not in a squad or team this season' });
    await fireEvent.press(inCard('Ben Unchecked', 'Not registered'));
    await settle();
    expect(screen.getByText('Not in a squad or team this season')).toBeTruthy();
    expect(screen.getByText('To check (2)')).toBeTruthy();
  });

  it('says when everyone has been checked', async () => {
    await openScreen('admin', { 'admin/affiliation/registrations': RegistrationsScreen }, '/admin/affiliation/registrations', {}, {
      rpcs: { admin_affiliation: affiliation(), admin_playhq_registrations: [REGISTRATIONS[3]] },
    });
    expect(screen.getByText('Everyone has been checked.')).toBeTruthy();
  });

  it('asks for squads or teams first when there is no season', async () => {
    await openRegistrations(affiliation({ season: null }));
    expect(screen.getByText('Add squads or teams for the season first.')).toBeTruthy();
    expect(callsTo('admin_playhq_registrations')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The affiliation return

async function openReturn(info: unknown = RETURN_INFO, rpcErrors: Record<string, string> = {}) {
  await openScreen(
    'admin',
    { 'admin/affiliation/return': AffiliationReturnScreen, 'admin/affiliation/index': Placeholder },
    '/admin/affiliation/return',
    { teams: [TEAM], training_requirements: [], stand_downs: [], screening_notices: [], policy_acknowledgements: [] },
    {
      // The contacts' emails come from their profiles; the counts from report_members.
      tableHandlers: {
        profiles: (q) => (q.calls.some((c) => c.method === 'in' && c.args[0] === 'id') ? PEOPLE : undefined),
      },
      rpcs: {
        report_members: PEOPLE.map((p) => ({ ...p, email: null, guardian_email: null })),
        admin_affiliation: affiliation({ primary_contact_2_id: 'committee' }),
        admin_affiliation_officers: [],
        admin_affiliation_return: info,
        safeguarding_contacts: { child_safety_officer_name: 'Sample committee', complaints_manager_name: null, policy_url: 'https://club.example/safe' },
        club_policies: null,
        admin_volunteer_exemptions: [],
        admin_wwc_officer: { officer_id: 'admin', officer_name: 'Sample admin' },
      },
      rpcErrors,
    },
  );
}

describe('the affiliation return', () => {
  it('shows exactly what will be sent: the contacts with their emails and the counts, and no child', async () => {
    await openReturn();
    expect(screen.getByText(`Last sent ${localDay(RETURN_INFO.last_sent_at)} by Sample admin to affiliations@association.example.`)).toBeTruthy();
    expect(screen.getByText('Primary contacts')).toBeTruthy();
    expect(screen.getByText('Sample admin')).toBeTruthy();
    expect(screen.getByText('Email: admin@example.test')).toBeTruthy();
    expect(screen.getByText('Email: committee@example.test')).toBeTruthy();
    expect(screen.getByText('Working With Children Checks')).toBeTruthy();
    expect(screen.getByText('Integrity training 2026–27')).toBeTruthy();
    expect(screen.getByText('Required items done')).toBeTruthy();
    // Nobody under 18 is named anywhere in it.
    expect(screen.queryByText(/Sample minor/)).toBeNull();
    expect(screen.getByText('Opens the share sheet. Choose Mail and send it to affiliations@association.example.')).toBeTruthy();
  });

  it('leaves out the counts an association doesn’t ask for', async () => {
    await openReturn();
    await flip('Working With Children Check counts', false);
    await flip('Integrity training counts', false);
    expect(screen.getAllByText('Left out')).toHaveLength(2);
    expect(screen.queryByText('Working With Children Checks')).toBeNull();
    expect(screen.queryByText('Integrity training 2026–27')).toBeNull();
    await fireEvent.press(screen.getByText('Send return'));
    await settle();
    const sent = (reportPdf as jest.Mock).mock.calls[0][0] as { sections: { title: string }[] };
    expect(sent.sections.map((s) => s.title)).not.toContain('Working With Children Checks');
  });

  it('sends the return as a PDF and records that it went', async () => {
    await openReturn();
    await fireEvent.press(screen.getByText('Send return'));
    await settle();
    expect(sharePdf).toHaveBeenCalledWith('sample-affiliation-return-2026-10-18.pdf', expect.any(Uint8Array));
    expect(callsTo('admin_log_affiliation_return')).toEqual([{ p_season: 2026 }]);
    expect(screen.getByText('Make sure it went to affiliations@association.example.')).toBeTruthy();
  });

  it('can’t be sent until the club says where returns go', async () => {
    await openReturn({ ...RETURN_INFO, return_email: null, last_sent_at: null });
    expect(screen.getByText('Add where returns go')).toBeTruthy();
    expect(screen.getByText('Add the email address returns go to first.')).toBeTruthy();
    expect(isDisabled('Send return')).toBe(true);
    await fireEvent.press(screen.getByText('Add where returns go'));
    await settle();
    expect(screen).toHavePathname('/admin/affiliation');
  });

  it('shows a refused log of the return', async () => {
    await openReturn(RETURN_INFO, { admin_log_affiliation_return: 'Only admins can send returns' });
    await fireEvent.press(screen.getByText('Send return'));
    await settle();
    expect(screen.getByText('Only admins can send returns')).toBeTruthy();
    expect(screen.queryByText(/^Make sure it went/)).toBeNull();
  });

  it('shows why the return didn’t load', async () => {
    await openReturn(RETURN_INFO, { admin_affiliation: 'Only admins see affiliation records' });
    expect(screen.getByText('Only admins see affiliation records')).toBeTruthy();
    expect(screen.queryByText('Send return')).toBeNull();
  });
});
