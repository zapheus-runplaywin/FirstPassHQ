/**
 * What an admin sees on a member's page (src/app/admin/[id].tsx), for each
 * kind of member they open. Only admins reach this screen (the route tests
 * cover that), so what changes here is the member being looked at.
 *
 * The rules (section 10 of the user guide): Stand down and Screening Unit
 * notices for coaches, managers, physios, the committee and admins (notices
 * for guardians too), Lift stand-down while one is open, Remove access and
 * Delete member for anyone but yourself, a child's parents and guardians and
 * who has viewed their records, and a parent who is also an admin leaving
 * their own child's guardians to another admin.
 */
import { screen } from 'expo-router/testing-library';

import MemberScreen from '@/app/admin/[id]';
import { supabase } from '@/lib/supabase';
import type { Profile, StandDown } from '@/lib/types';

import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
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

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
});

const GUARDIAN = personas.guardian.profile!;
const CHILD = morePersonas.under18Athlete.profile;

const OPEN_STAND_DOWN: StandDown = {
  id: 'sd-1',
  profile_id: 'stood-down-coach',
  member_name: 'Sample stood-down-coach',
  reason: 'interim_negative_notice',
  note: null,
  started_at: '2026-10-01T00:00:00Z',
  started_by_name: 'Sample admin',
  lifted_at: null,
  lifted_by_name: null,
  lift_note: null,
};

/**
 * Opens `target`'s page for the admin `viewer`. The database returns the
 * target by id, everyone approved for the guardian search, and any guardian
 * links and stand-downs given.
 */
async function openMember(
  target: Profile,
  {
    viewer = 'admin' as PersonaName | Persona,
    guardianships = [] as { guardian_id: string; athlete_id: string }[],
    standDowns = [] as StandDown[],
    people = [] as Profile[],
  } = {},
) {
  await openScreen(
    viewer,
    { 'admin/[id]': MemberScreen },
    `/admin/${target.id}`,
    { guardianships, stand_downs: standDowns, screening_notices: [], guardianship_history: [] },
    {
      tableHandlers: {
        profiles: (q) => {
          if (q.eq('id') === target.id) return [target];
          if (q.eq('status') === 'approved') return people;
          return undefined;
        },
      },
      rpcs: { admin_volunteer_exemptions: [], admin_date_of_birth_record: null },
    },
  );
}

/** Text only each control or section shows. */
const ITEMS = {
  standDown: 'Stand down now',
  liftStandDown: 'Lift stand-down',
  notices: 'Screening Unit notices',
  removeAccess: 'Remove access',
  deleteMember: 'Delete member',
  removalReason: 'Reason if removing access',
  saveChanges: 'Save changes',
  approve: 'Approve',
  dontApprove: "Don't approve",
  guardians: 'Parents and guardians',
  recordViews: 'Who has viewed their records',
  guardianOf: 'Guardian of',
  verify: 'Verify who they are',
} as const;
type Item = keyof typeof ITEMS;

function shown() {
  return (Object.keys(ITEMS) as Item[]).filter((i) => screen.queryAllByText(ITEMS[i]).length > 0);
}

const p = (name: PersonaName) => personas[name].profile!;

describe('a member’s page for an admin', () => {
  it.each<[string, Profile]>([
    ['coach', p('coach')],
    ['manager', p('manager')],
    ['physio', p('physio')],
    ['committee member', p('committee')],
    ['another admin', p('adminExpiredCheck')],
    ['temporary helper', p('volunteer')],
  ])('offers to stand down a %s, record notices, remove access or delete them', async (_l, target) => {
    await openMember(target);
    expect(shown()).toEqual(['standDown', 'notices', 'removeAccess', 'deleteMember', 'removalReason', 'saveChanges']);
  });

  it('offers to lift an open stand-down instead of standing them down again', async () => {
    await openMember(p('stoodDownCoach'), { standDowns: [OPEN_STAND_DOWN] });
    expect(shown()).toEqual(['liftStandDown', 'notices', 'removeAccess', 'deleteMember', 'removalReason', 'saveChanges']);
    expect(screen.getByText(/^Stood down since .*: Interim negative notice\./)).toBeTruthy();
  });

  it('shows past stand-downs with who started and lifted them', async () => {
    await openMember(p('coach'), {
      standDowns: [{ ...OPEN_STAND_DOWN, profile_id: 'coach', lifted_at: '2026-10-05T00:00:00Z', lifted_by_name: 'Other admin' }],
    });
    expect(screen.getByText('Stand down now')).toBeTruthy();
    expect(screen.getByText(/^Stood down .* by Sample admin, lifted .* by Other admin$/)).toBeTruthy();
  });

  it('records notices for a guardian, but has no stand-down for them', async () => {
    await openMember(GUARDIAN);
    expect(shown()).toEqual(['notices', 'removeAccess', 'deleteMember', 'removalReason', 'saveChanges', 'guardianOf']);
    expect(
      screen.getByText(/^No children yet\. They enter their child’s link code, or you link them from the\s+child’s page\.$/),
    ).toBeTruthy();
  });

  it('asks for an unverified guardian to be verified before they’re linked to a child', async () => {
    await openMember({ ...GUARDIAN, verified_at: null });
    expect(shown()).toContain('verify');
    expect(
      screen.getByText(/^Parents and guardians must be verified before you approve them or link them to a child\./),
    ).toBeTruthy();
  });

  it('has no stand-down or notices for an adult athlete', async () => {
    await openMember(p('athlete'));
    expect(shown()).toEqual(['removeAccess', 'deleteMember', 'removalReason', 'saveChanges']);
  });

  it('shows a child’s parents and guardians and who has viewed their records', async () => {
    await openMember(CHILD, {
      guardianships: [{ guardian_id: 'guardian', athlete_id: CHILD.id }],
      people: [GUARDIAN],
    });
    expect(shown()).toEqual(['removeAccess', 'deleteMember', 'removalReason', 'saveChanges', 'guardians', 'recordViews']);
    expect(screen.getByText('Sample guardian  ✕')).toBeTruthy();
    expect(screen.getByText('Add a guardian')).toBeTruthy();
    expect(
      screen.getByText('Under 18, so their app stays locked until a verified parent or guardian is linked.'),
    ).toBeTruthy();
  });

  it('leaves a child’s guardians to another admin when the admin is one of them', async () => {
    await openMember(CHILD, {
      viewer: morePersonas.adminGuardian,
      guardianships: [{ guardian_id: 'admin-guardian', athlete_id: CHILD.id }],
      people: [morePersonas.adminGuardian.profile],
    });
    expect(
      screen.getByText(/You’re one of their guardians, so another admin needs to change who their guardians are\./),
    ).toBeTruthy();
    expect(screen.queryByText('Add a guardian')).toBeNull();
    expect(screen.queryByText(/  ✕$/)).toBeNull();
  });

  it('records that the admin opened a child’s member record', async () => {
    await openMember(CHILD);
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'log_record_view',
      { p_subject_id: CHILD.id, p_kind: 'member_record', p_record_id: null },
    ]);
  });

  it.each<[string, Persona]>([
    ['admin', personas.admin],
    ['admin who is also a guardian', morePersonas.adminGuardian],
    ['admin whose check lapsed', personas.adminExpiredCheck],
  ])('never offers an %s ways to stand down, remove or delete themselves', async (_l, viewer) => {
    await openMember(viewer.profile!, { viewer });
    expect(shown()).not.toContain('standDown');
    expect(shown()).not.toContain('notices');
    expect(shown()).not.toContain('removeAccess');
    expect(shown()).not.toContain('deleteMember');
    expect(shown()).not.toContain('removalReason');
    expect(shown()).toContain('saveChanges');
  });

  it('asks another admin to exempt an admin from a check on their own page', async () => {
    const admin = personas.admin.profile!;
    await openMember(admin);
    expect(screen.getByText('Another admin needs to exempt you.')).toBeTruthy();
    expect(screen.queryByText('Exempt')).toBeNull();
  });

  it('lets an admin exempt another committee member or admin', async () => {
    await openMember(p('committee'));
    expect(screen.getByText('Exempt')).toBeTruthy();
    expect(screen.queryByText('Another admin needs to exempt you.')).toBeNull();
  });

  it('offers Approve and Don’t approve for someone waiting, never Remove access', async () => {
    await openMember(p('pending'));
    expect(shown()).toEqual(['deleteMember', 'approve', 'dontApprove', 'verify']);
    expect(screen.getByText('Reason if not approving')).toBeTruthy();
    expect(screen.getByText('Asked to join as')).toBeTruthy();
  });

  it('says so when the member isn’t found', async () => {
    await openScreen('admin', { 'admin/[id]': MemberScreen }, '/admin/nobody', {}, {
      tableHandlers: { profiles: (q) => (q.eq('id') === 'nobody' ? [] : undefined) },
    });
    expect(screen.getByText('Member not found.')).toBeTruthy();
    expect(shown()).toEqual([]);
  });
});
