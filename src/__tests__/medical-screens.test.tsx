/**
 * Medical and emergency details (src/app/medical/[id].tsx and
 * medical/team/[id].tsx), and the links to them from Your details, Home and a
 * squad or team's page.
 *
 * The database decides who can open an athlete's details (`medical_profile`
 * refuses everyone else), who can change them (`can_edit`), and logs every
 * view by a coach, manager or physio. The tests seed what it would return
 * for each member and check the screens show that, only offer changes to
 * those who can make them, and only show who has looked to those who keep
 * the details.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import HomeScreen from '@/app/index';
import MedicalScreen from '@/app/medical/[id]';
import TeamMedicalScreen from '@/app/medical/team/[id]';
import MyDetailsScreen from '@/app/my-details';
import TeamScreen from '@/app/team/[id]';
import { formatDateTime } from '@/lib/format';
import type { MedicalProfile, MedicalView, TeamMedicalRow } from '@/lib/medical';
import { supabase } from '@/lib/supabase';

import {
  openScreen,
  personas,
  resetClub,
  settle,
  TEAM,
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

const rpcCalls = () => (supabase.rpc as jest.Mock).mock.calls as [string, unknown][];
const callsTo = (name: string) => rpcCalls().filter(([n]) => n === name).map(([, args]) => args);

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
});

function medical(extra: Partial<MedicalProfile> = {}): MedicalProfile {
  return {
    athlete_id: 'athlete',
    athlete_name: 'Sample Athlete',
    role: 'self',
    can_edit: true,
    saved: true,
    emergency_contacts: [{ name: 'Sam Sample', relationship: 'Aunt', phone: '0400 000 001' }],
    conditions: 'Asthma',
    allergies: 'Peanuts (anaphylaxis)',
    medications: 'Ventolin, EpiPen',
    action_plan: 'EpiPen in the outer pocket, then call 000',
    updated_at: '2026-10-20T02:00:00Z',
    updated_by_name: 'Sample Athlete',
    ...extra,
  };
}

const VIEWS: MedicalView[] = [
  { viewer_name: 'Sample Coach', viewer_role: 'Coach', viewed_at: '2026-10-21T08:00:00Z' },
  { viewer_name: 'Sample Physio', viewer_role: 'Physio', viewed_at: '2026-10-19T08:00:00Z' },
];

async function openMedical(who: Who, profile: MedicalProfile | null, options: Parameters<typeof openScreen>[4] = {}) {
  await openScreen(who, { 'medical/[id]': MedicalScreen }, `/medical/${profile?.athlete_id ?? 'athlete'}`, {}, {
    ...options,
    rpcs: { medical_profile: profile, medical_profile_views: VIEWS, ...options.rpcs },
  });
}

describe('an athlete 18 or over, their own details', () => {
  it('shows their contacts, each section and who last changed them', async () => {
    await openMedical('athlete', medical());
    expect(callsTo('medical_profile')).toEqual([{ p_athlete_id: 'athlete' }]);
    expect(screen.getByText('Sam Sample · Aunt')).toBeTruthy();
    expect(screen.getByText('0400 000 001')).toBeTruthy();
    expect(screen.getByText('Peanuts (anaphylaxis)')).toBeTruthy();
    expect(screen.getByText('Asthma')).toBeTruthy();
    expect(screen.getByText('Ventolin, EpiPen')).toBeTruthy();
    expect(screen.getByText('EpiPen in the outer pocket, then call 000')).toBeTruthy();
    expect(
      screen.getByText(`Last changed by Sample Athlete, ${formatDateTime(new Date('2026-10-20T02:00:00Z'))}.`),
    ).toBeTruthy();
  });

  it('shows who has opened them, by name and role', async () => {
    await openMedical('athlete', medical());
    expect(callsTo('medical_profile_views')).toEqual([{ p_athlete_id: 'athlete' }]);
    expect(screen.getByText(`Sample Coach (Coach) · ${formatDateTime(new Date('2026-10-21T08:00:00Z'))}`)).toBeTruthy();
    expect(screen.getByText(`Sample Physio (Physio) · ${formatDateTime(new Date('2026-10-19T08:00:00Z'))}`)).toBeTruthy();
  });

  it('says when nobody has opened them', async () => {
    await openMedical('athlete', medical(), { rpcs: { medical_profile_views: [] } });
    expect(screen.getByText('Nobody yet.')).toBeTruthy();
  });

  it('says what isn’t recorded, and prompts them to add it', async () => {
    await openMedical(
      'athlete',
      medical({ emergency_contacts: [], conditions: '', allergies: '', medications: '', action_plan: '', saved: false, updated_at: null }),
    );
    expect(screen.getByText('No emergency contacts yet.')).toBeTruthy();
    expect(screen.getAllByText('None recorded')).toHaveLength(4);
    expect(screen.getByText('Add anything a coach or physio would need to know in an emergency.')).toBeTruthy();
    expect(screen.queryByText(/^Last changed by/)).toBeNull();
  });

  it('calls a contact when they tap the number', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await openMedical('athlete', medical());
    fireEvent.press(screen.getByLabelText('Call Sam Sample'));
    expect(open).toHaveBeenCalledWith('tel:0400000001');
    open.mockRestore();
  });

  it('changes and saves every section, leaving out blank contacts', async () => {
    await openMedical('athlete', medical());
    fireEvent.press(screen.getByText('Change details'));
    fireEvent.changeText(screen.getByDisplayValue('Sam Sample'), 'Sam Sample-Smith');
    fireEvent.press(screen.getByText('Add a contact'));
    fireEvent.changeText(screen.getByDisplayValue('Asthma'), 'Asthma (mild)');
    fireEvent.changeText(screen.getByDisplayValue('Peanuts (anaphylaxis)'), 'Peanuts, bee stings');
    fireEvent.changeText(screen.getByDisplayValue('Ventolin, EpiPen'), 'Ventolin');
    fireEvent.changeText(screen.getByDisplayValue('EpiPen in the outer pocket, then call 000'), 'Call 000');
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(callsTo('save_medical_profile')).toEqual([
      {
        p_athlete_id: 'athlete',
        p_emergency_contacts: [{ name: 'Sam Sample-Smith', relationship: 'Aunt', phone: '0400 000 001' }],
        p_conditions: 'Asthma (mild)',
        p_allergies: 'Peanuts, bee stings',
        p_medications: 'Ventolin',
        p_action_plan: 'Call 000',
      },
    ]);
    // Back to reading them, loaded again.
    expect(screen.getByText('Change details')).toBeTruthy();
    expect(callsTo('medical_profile')).toHaveLength(2);
  });

  it('adds up to three contacts, and removes one', async () => {
    await openMedical('athlete', medical());
    fireEvent.press(screen.getByText('Change details'));
    fireEvent.press(screen.getByText('Add a contact'));
    fireEvent.press(screen.getByText('Add a contact'));
    expect(screen.queryByText('Add a contact')).toBeNull();
    expect(screen.getAllByText('Remove contact')).toHaveLength(3);
    fireEvent.press(screen.getAllByText('Remove contact')[0]);
    expect(screen.queryByDisplayValue('Sam Sample')).toBeNull();
    expect(screen.getByText('Add a contact')).toBeTruthy();
  });

  it('starts with one empty contact when there are none', async () => {
    await openMedical('athlete', medical({ emergency_contacts: [] }));
    fireEvent.press(screen.getByText('Change details'));
    expect(screen.getAllByText('Remove contact')).toHaveLength(1);
  });

  it('refuses a contact with no phone number before saving', async () => {
    await openMedical('athlete', medical());
    fireEvent.press(screen.getByText('Change details'));
    fireEvent.changeText(screen.getByDisplayValue('0400 000 001'), '');
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Each emergency contact needs a name and a phone number')).toBeTruthy();
    expect(callsTo('save_medical_profile')).toEqual([]);
  });

  it('shows the database’s refusal and stays editing', async () => {
    await openMedical('athlete', medical(), { rpcErrors: { save_medical_profile: 'That’s too long' } });
    fireEvent.press(screen.getByText('Change details'));
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('That’s too long')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('cancels without saving', async () => {
    await openMedical('athlete', medical());
    fireEvent.press(screen.getByText('Change details'));
    fireEvent.changeText(screen.getByDisplayValue('Asthma'), 'Changed');
    fireEvent.press(screen.getByText('Cancel'));
    expect(callsTo('save_medical_profile')).toEqual([]);
    expect(screen.getByText('Asthma')).toBeTruthy();
  });
});

describe('an athlete under 18, their own details', () => {
  it('reads them, can’t change them, and doesn’t see who has looked', async () => {
    await openMedical('minorAthlete', medical({ athlete_id: 'minor-athlete', can_edit: false }));
    expect(screen.getByText('Peanuts (anaphylaxis)')).toBeTruthy();
    expect(screen.queryByText('Change details')).toBeNull();
    expect(screen.getByText('Your parents or guardians keep these up to date until you turn 18.')).toBeTruthy();
    expect(screen.queryByText('Who has opened them')).toBeNull();
    expect(callsTo('medical_profile_views')).toEqual([]);
  });
});

describe('a parent or guardian', () => {
  it('keeps their child’s details and sees who has looked', async () => {
    await openMedical('guardian', medical({ athlete_id: 'child-1', athlete_name: 'Sample Child', role: 'guardian' }));
    expect(screen.getByText('Change details')).toBeTruthy();
    expect(screen.getByText('Who has opened them')).toBeTruthy();
    fireEvent.press(screen.getByText('Change details'));
    expect(screen.getByText(/Sample Child’s coaches, managers and physios see these once you’ve given health consent/)).toBeTruthy();
  });
});

describe.each<[string, Who, 'coach' | 'manager' | 'physio']>([
  ['a coach', 'coach', 'coach'],
  ['a manager', 'manager', 'manager'],
  ['a physio', 'physio', 'physio'],
])('%s', (_label, who, role) => {
  it('reads an athlete’s details, is told views are recorded, and can’t change them', async () => {
    await openMedical(who, medical({ role, can_edit: false }));
    expect(screen.getByText('Peanuts (anaphylaxis)')).toBeTruthy();
    expect(screen.getByText(/These are for Sample Athlete’s safety at training and games. Each time you open them it’s/)).toBeTruthy();
    expect(screen.queryByText('Change details')).toBeNull();
    expect(screen.queryByText('Who has opened them')).toBeNull();
    expect(callsTo('medical_profile_views')).toEqual([]);
  });
});

it.each<[string, Who]>([
  ['an admin', 'admin'],
  ['the committee', 'committee'],
  ['a coach without health consent', 'coach'],
])('shows %s the database’s refusal and no details', async (_l, who) => {
  await openMedical(who, null, {
    rpcErrors: { medical_profile: 'You can’t see this athlete’s medical details' },
  });
  expect(screen.getByText('You can’t see this athlete’s medical details.')).toBeTruthy();
  expect(screen.queryByText('Emergency contacts')).toBeNull();
});

// ---------------------------------------------------------------------------
// A squad or team's list

const ROWS: TeamMedicalRow[] = [
  { athlete_id: 'a1', athlete_name: 'Sample Adult', can_open: true, has_contacts: true, needs_consent: false },
  { athlete_id: 'a2', athlete_name: 'Sample New', can_open: true, has_contacts: false, needs_consent: false },
  { athlete_id: 'a3', athlete_name: 'Sample Child', can_open: false, has_contacts: false, needs_consent: true },
];

describe('a squad or team’s list', () => {
  async function openList(who: Who, rows: TeamMedicalRow[] = ROWS) {
    await openScreen(
      who,
      { 'medical/team/[id]': TeamMedicalScreen, 'medical/[id]': MedicalScreen },
      `/medical/team/${TEAM.id}?name=Open%20A`,
      {},
      { rpcs: { team_medical_profiles: rows, medical_profile: medical({ athlete_id: 'a1', athlete_name: 'Sample Adult', role: 'coach', can_edit: false }) } },
    );
  }

  it('lists the athletes with whether each has contacts, or needs consent', async () => {
    await openList('coach');
    expect(callsTo('team_medical_profiles')).toEqual([{ p_team_id: TEAM.id }]);
    expect(screen.getByText('Emergency contacts added')).toBeTruthy();
    expect(screen.getByText('No emergency contacts yet')).toBeTruthy();
    expect(screen.getByText('Waiting for a parent’s health consent')).toBeTruthy();
    // Listing shows no details, so it doesn't open anyone's.
    expect(callsTo('medical_profile')).toEqual([]);
  });

  it('opens an athlete’s details', async () => {
    await openList('coach');
    fireEvent.press(screen.getByText('Sample Adult'));
    await settle();
    expect(callsTo('medical_profile')).toEqual([{ p_athlete_id: 'a1' }]);
    expect(screen.getByText('Peanuts (anaphylaxis)')).toBeTruthy();
  });

  it('doesn’t open a child without health consent', async () => {
    await openList('coach');
    fireEvent.press(screen.getByText('Sample Child'));
    await settle();
    expect(callsTo('medical_profile')).toEqual([]);
  });

  it('says when there are no athletes', async () => {
    await openList('manager', []);
    expect(screen.getByText('No athletes here yet.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The links to them

describe('Your details', () => {
  async function openDetails(who: Who) {
    await openScreen(who, { 'my-details': MyDetailsScreen, 'medical/[id]': MedicalScreen }, '/my-details', {}, {
      rpcs: { medical_profile: medical() },
    });
  }

  it.each<[string, Who]>([
    ['an athlete', 'athlete'],
    ['an athlete under 18', 'minorAthlete'],
    ['an athlete who coaches', 'athleteCoach'],
  ])('links %s to their medical and emergency details', async (_l, who) => {
    await openDetails(who);
    expect(screen.getByText('Medical and emergency details')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['a coach', 'coach'],
    ['a guardian', 'guardian'],
    ['an admin', 'admin'],
    ['a member waiting for approval', 'pending'],
  ])('doesn’t link %s', async (_l, who) => {
    await openDetails(who);
    expect(screen.queryByText('Medical and emergency details')).toBeNull();
  });

  it('opens the athlete’s own', async () => {
    await openDetails('athlete');
    fireEvent.press(screen.getByText('Medical and emergency details'));
    await settle();
    expect(callsTo('medical_profile')).toEqual([{ p_athlete_id: personas.athlete.profile!.id }]);
  });
});

describe('a squad or team’s page', () => {
  const roster = [
    { team_id: TEAM.id, profile_id: 'athlete', team_role: 'athlete', full_name: 'Sample Athlete', coach_title: null, selection: null },
  ];

  it.each<[string, Who]>([
    ['its coach', 'coach'],
    ['its manager', 'manager'],
    ['its physio', 'physio'],
  ])('offers %s its medical and emergency details', async (_l, who) => {
    await openScreen(who, { 'team/[id]': TeamScreen, 'medical/team/[id]': TeamMedicalScreen }, `/team/${TEAM.id}`, { team_members: roster, teams: [TEAM] }, {
      rpcs: { team_medical_profiles: ROWS, team_roster: roster },
    });
    fireEvent.press(screen.getByText('Medical and emergency details'));
    await settle();
    expect(callsTo('team_medical_profiles')).toEqual([{ p_team_id: TEAM.id }]);
  });

  it.each<[string, Who]>([
    ['an athlete in it', 'athlete'],
    ['an admin', 'admin'],
  ])('doesn’t offer it to %s', async (_l, who) => {
    await openScreen(who, { 'team/[id]': TeamScreen }, `/team/${TEAM.id}`, { team_members: roster, teams: [TEAM] }, {
      rpcs: { team_roster: roster },
    });
    expect(screen.queryByText('Medical and emergency details')).toBeNull();
  });
});

describe('Home for a parent or guardian', () => {
  it('lists each child’s medical and emergency details once verified', async () => {
    await openScreen('guardian', { index: HomeScreen, 'medical/[id]': MedicalScreen }, '/', { guardianships: [] }, {
      rpcs: { medical_profile: medical({ athlete_id: 'child-1', role: 'guardian' }) },
    });
    expect(screen.getByText('Medical and emergency')).toBeTruthy();
    fireEvent.press(screen.getByText('Emergency contacts, allergies, conditions, medications and an action plan'));
    await settle();
    expect(callsTo('medical_profile')).toEqual([{ p_athlete_id: 'child-1' }]);
  });

  it('doesn’t until an admin has verified them', async () => {
    await openScreen({ ...personas.guardian, profile: { ...personas.guardian.profile!, verified_at: null } }, { index: HomeScreen }, '/');
    expect(screen.queryByText('Medical and emergency')).toBeNull();
  });
});
