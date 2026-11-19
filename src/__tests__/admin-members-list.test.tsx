/**
 * The admin's Members list (src/app/admin/index.tsx): who lands in each
 * section, the reason shown under each name, search, and opening a member.
 *
 * The rules (section 10 of the user guide, "Approving members"): Needs
 * checking lists the people behind the child-safety to-dos with why; Waiting
 * for approval lists requests oldest first, marking an athlete who says
 * they're under 18 and who entered whose link code; Parents asking to be
 * linked lists approved parents who entered another child's code; a child
 * under 18 with no approved, verified parent linked is locked; No team or role for 2 years lists who the database says
 * may have left; and members never asked to join or turned down are listed
 * apart. Only admins reach this screen (the route tests cover that).
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';

import MembersScreen from '@/app/admin/index';
import { formatMonth } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Profile, VolunteerExemption } from '@/lib/types';

import { typeInto } from './helpers/admin-screens';
import { rpcNames } from './helpers/calls';
import { openScreen, personas, resetClub } from './helpers/harness';

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

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
});

const base = personas.athlete.profile!;

function member(id: string, name: string, extra: Partial<Profile> = {}): Profile {
  return { ...base, id, full_name: name, email: `${id}@example.test`, ...extra };
}

/** A card that is current, validated and registered: nothing to check. */
const CHECKED_CARD: Partial<Profile> = {
  wwcc_number: '1234567A',
  wwcc_expires_on: '2029-06-30',
  wwcc_validated_at: '2026-06-01T00:00:00Z',
  wwcc_unit_linked_at: '2026-06-01T00:00:00Z',
};

const MEMBERS = {
  coach: member('m-coach', 'Casey Coach', { role: 'coach', ...CHECKED_CARD }),
  treasurer: member('m-treasurer', 'Terry Treasurer', {
    role: 'committee',
    title: 'Treasurer',
    wwcc_exempt_reason: 'Treasurer only',
  }),
  child: member('m-child', 'Charlie Child', { date_of_birth: '2012-02-02' }),
  linkedChild: member('m-linked', 'Lee Linked', { date_of_birth: '2012-02-02' }),
  turning18: member('m-turning', 'Taylor Turning', { date_of_birth: '2008-11-01' }),
  noBirthday: member('m-nodob', 'Nadia NoDate', { date_of_birth: null }),
  stoodDown: member('m-stood', 'Sid Stood', {
    role: 'coach',
    ...CHECKED_CARD,
    stood_down_at: '2026-10-01T00:00:00Z',
  }),
  exempted: member('m-exempt', 'Pat Parent', { role: 'manager', wwcc_number: null, wwcc_expires_on: null }),
  inactive: member('m-gone', 'Gina Gone', { preferred_name: 'Gigi' }),
  guardian: member('m-guardian', 'Gwen Guardian', { role: 'guardian', date_of_birth: '1980-01-01' }),
  unverifiedGuardian: member('m-unverified', 'Uma Unverified', {
    role: 'guardian',
    date_of_birth: '1980-01-01',
    verified_at: null,
  }),
  newChild: member('m-new-child', 'Nico New', {
    status: 'pending',
    role: 'guest',
    requested_role: 'athlete',
    declared_date_of_birth: '2013-05-05',
    join_requested_at: '2026-10-10T00:00:00Z',
    verified_at: null,
  }),
  newParent: member('m-new-parent', 'Pia Parent', {
    status: 'pending',
    role: 'guest',
    requested_role: 'guardian',
    join_requested_at: '2026-10-05T00:00:00Z',
    verified_at: '2026-10-06T00:00:00Z',
  }),
  signedIn: member('m-signed-in', 'Sam SignedIn', {
    status: 'pending',
    role: 'guest',
    requested_role: null,
    join_requested_at: null,
    email: 'sam@example.test',
  }),
  turnedDown: member('m-rejected', 'Rory Rejected', {
    status: 'rejected',
    role: 'guest',
    rejection_reason: 'playhq_email_mismatch',
  }),
};

const WAITING_EXEMPTION: VolunteerExemption = {
  id: 'ex-1',
  profile_id: 'm-exempt',
  basis: 'parent_volunteer',
  child_id: 'm-linked',
  child_name: 'Lee Linked',
  set_by_name: 'Sample admin',
  set_at: '2026-10-01T00:00:00Z',
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

async function openMembers(
  members: Profile[] = Object.values(MEMBERS),
  noAppRequests: { guardian_id: string; full_name: string }[] = [],
) {
  await openScreen(
    'admin',
    { 'admin/index': MembersScreen },
    '/admin',
    {
      guardianships: [
        { guardian_id: 'm-guardian', athlete_id: 'm-linked' },
        // An unverified parent doesn't unlock a child.
        { guardian_id: 'm-unverified', athlete_id: 'm-child' },
      ],
      guardian_link_requests: [
        { guardian_id: 'm-new-parent', athlete_id: 'm-new-child' },
        { guardian_id: 'm-guardian', athlete_id: 'm-child' },
      ],
    },
    {
      tableHandlers: {
        // The admin's own row for sign-in; everyone for the list.
        profiles: (q) => (q.eq('id') === undefined ? members : undefined),
        team_members: (q) =>
          q.eq('profile_id') === undefined
            ? [
                {
                  profile_id: 'm-coach',
                  team_role: 'coach',
                  coach_title: 'head_coach',
                  team: { name: 'Open A', kind: 'team', sort_order: 1 },
                },
              ]
            : undefined,
      },
      rpcs: {
        admin_volunteer_exemptions: [
          WAITING_EXEMPTION,
          // An ended exemption is history, not a reason to check them.
          { ...WAITING_EXEMPTION, id: 'ex-0', profile_id: 'm-coach', ended_at: '2026-01-01T00:00:00Z' },
        ],
        admin_inactive_members: [{ profile_id: 'm-gone', last_active: '2024-06-01T00:00:00Z' }],
        admin_no_app_child_requests: noAppRequests,
      },
    },
  );
}

/** The names listed under a section, in order, up to the next section heading. */
function namesUnder(heading: string) {
  const all = Object.values(MEMBERS).map((m) => m.full_name!);
  const headings = [
    'Needs checking',
    'Waiting for approval',
    'Parents asking to be linked',
    'Members',
    'No team or role for 2 years',
    'Signed in, no request yet',
    'Not approved',
  ];
  const texts = screen
    .container.queryAll((n) => typeof n.type === 'string' && typeof n.props.children === 'string')
    .map((n) => n.props.children as string);
  const start = texts.indexOf(heading);
  if (start < 0) return null;
  const rest = texts.slice(start + 1);
  const end = rest.findIndex((t) => headings.includes(t));
  return (end < 0 ? rest : rest.slice(0, end)).filter((t) => all.includes(t));
}

describe('the Members list', () => {
  it('lists the members behind the child-safety to-dos under Needs checking, with why', async () => {
    await openMembers();
    expect(namesUnder('Needs checking')).toEqual([
      'Charlie Child',
      'Taylor Turning',
      'Nadia NoDate',
      'Sid Stood',
      'Pat Parent',
    ]);
    // Charlie's only parent isn't verified, so Charlie is locked.
    expect(screen.getByText('Athlete · Locked: no verified parent or guardian linked')).toBeTruthy();
    expect(
      screen.getByText('Athlete · Locked: no verified parent or guardian linked · Turns 18 on 01/11/2026'),
    ).toBeTruthy();
    expect(screen.getByText('Athlete · No date of birth')).toBeTruthy();
    expect(screen.getByText('Coach · Stood down')).toBeTruthy();
    expect(
      screen.getByText('Manager · Parent volunteer for Lee Linked: waiting for them to accept the declaration'),
    ).toBeTruthy();
  });

  it('lists every approved member, marking those that need checking and giving others their titles', async () => {
    await openMembers();
    expect(namesUnder('Members')).toEqual([
      'Casey Coach',
      'Terry Treasurer',
      'Charlie Child',
      'Lee Linked',
      'Taylor Turning',
      'Nadia NoDate',
      'Sid Stood',
      'Pat Parent',
      'Gina Gone',
      'Gwen Guardian',
      'Uma Unverified',
    ]);
    expect(screen.getByText('Coach · Head Coach, Open A')).toBeTruthy();
    expect(screen.getByText('Committee · Treasurer')).toBeTruthy();
    // A child with a verified guardian linked needs nothing.
    expect(screen.getAllByText('Athlete').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Athlete · Needs checking')).toHaveLength(3);
    expect(screen.getByText('Coach · Needs checking')).toBeTruthy();
    expect(screen.getByText('Manager · Needs checking')).toBeTruthy();
  });

  it('lists requests oldest first, marking a child and someone already verified', async () => {
    await openMembers();
    expect(namesUnder('Waiting for approval')).toEqual(['Pia Parent', 'Nico New']);
    expect(
      screen.getByText('Asked to join as Guardian · Verified in person · Entered Nico New’s code'),
    ).toBeTruthy();
    expect(
      screen.getByText('Asked to join as Athlete · Says they’re under 18 · Pia Parent entered their code'),
    ).toBeTruthy();
  });

  it('says when nobody has entered a child’s code, or a parent hasn’t entered one', async () => {
    await openMembers([
      { ...MEMBERS.newChild, id: 'm-other-child' },
      { ...MEMBERS.newParent, id: 'm-other-parent' },
    ]);
    expect(
      screen.getByText('Asked to join as Athlete · Says they’re under 18 · No parent has entered their code yet'),
    ).toBeTruthy();
    expect(
      screen.getByText('Asked to join as Guardian · Verified in person · Hasn’t entered a child’s code yet'),
    ).toBeTruthy();
  });

  it('lists approved parents who entered another child’s code, to link from their page', async () => {
    await openMembers();
    expect(namesUnder('Parents asking to be linked')).toEqual(['Gwen Guardian']);
    expect(screen.getByText('Entered Charlie Child’s code · Link them on their page')).toBeTruthy();
  });

  it('marks a child who won’t use the app, and lists parents asking to add one', async () => {
    const noApp = member('m-no-app', 'Nell NoApp', { date_of_birth: '2016-05-04', email: null, no_sign_in: true });
    await openMembers(
      [...Object.values(MEMBERS), noApp],
      [
        { guardian_id: 'm-treasurer', full_name: 'Tim Small' },
        { guardian_id: 'm-new-parent', full_name: 'Sam Small' },
      ],
    );
    // With no parent linked she's also under Needs checking, so she's named twice.
    expect(screen.getAllByText('Nell NoApp · No app').length).toBeGreaterThan(0);
    expect(screen.queryByText('Nell NoApp')).toBeNull();
    // An approved member asking to add a child is listed to act on.
    expect(namesUnder('Parents asking to be linked')?.sort()).toEqual(['Gwen Guardian', 'Terry Treasurer']);
    expect(
      screen.getByText('Asked to add Tim Small, who won’t use the app · Link them on their page'),
    ).toBeTruthy();
    // A parent waiting for approval says what they asked for.
    expect(screen.getByText(/· Asked to add Sam Small, who won’t use the app$/)).toBeTruthy();
    expect(rpcNames()).toContain('admin_no_app_child_requests');
  });

  it('lists members with no team or role for 2 years, from the database, with when they were last active', async () => {
    await openMembers();
    expect(namesUnder('No team or role for 2 years')).toEqual(['Gina Gone']);
    expect(
      screen.getByText(
        `Athlete · Last active ${formatMonth(new Date('2024-06-01T00:00:00Z'))} · Delete them if they’ve left`,
      ),
    ).toBeTruthy();
  });

  it('lists who signed in without asking to join, and who was turned down with why', async () => {
    await openMembers();
    expect(namesUnder('Signed in, no request yet')).toEqual(['Sam SignedIn']);
    expect(screen.getByText('sam@example.test')).toBeTruthy();
    expect(namesUnder('Not approved')).toEqual(['Rory Rejected']);
    expect(screen.getByText("PlayHQ email doesn't match")).toBeTruthy();
  });

  it('never lists a request, a turned-down member or someone who never asked as a member', async () => {
    await openMembers();
    for (const name of ['Nico New', 'Pia Parent', 'Sam SignedIn', 'Rory Rejected']) {
      expect(namesUnder('Members')).not.toContain(name);
      expect(namesUnder('Needs checking')).not.toContain(name);
    }
  });

  it('searches by name, preferred name and email', async () => {
    await openMembers();
    await typeInto('Search', 'gigi');
    expect(namesUnder('Members')).toEqual(['Gina Gone']);
    expect(namesUnder('Needs checking')).toBeNull();
    expect(screen.getByText('No requests waiting.')).toBeTruthy();

    await typeInto('Search', 'M-NEW-PARENT@EXAMPLE');
    expect(namesUnder('Waiting for approval')).toEqual(['Pia Parent']);
    expect(screen.getByText('No approved members yet.')).toBeTruthy();
  });

  it('opens a member’s page', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openMembers();
    await fireEvent.press(screen.getByText('Casey Coach'));
    expect(push).toHaveBeenCalledWith({ pathname: '/admin/[id]', params: { id: 'm-coach' } });
    push.mockRestore();
  });

  it('says when nobody is waiting or approved, and shows no empty Needs checking', async () => {
    await openMembers([]);
    expect(screen.getByText('No requests waiting.')).toBeTruthy();
    expect(screen.getByText('No approved members yet.')).toBeTruthy();
    expect(screen.queryByText('Needs checking')).toBeNull();
    expect(screen.queryByText('No team or role for 2 years')).toBeNull();
    expect(screen.queryByText('Not approved')).toBeNull();
  });

  it('asks the database for exemptions and members with no team for 2 years', async () => {
    await openMembers();
    const names = (supabase.rpc as jest.Mock).mock.calls.map(([n]) => n);
    expect(names).toContain('admin_volunteer_exemptions');
    expect(names).toContain('admin_inactive_members');
    expect(supabase.from).toHaveBeenCalledWith('guardianships');
    expect(supabase.from).toHaveBeenCalledWith('guardian_link_requests');
  });
});
