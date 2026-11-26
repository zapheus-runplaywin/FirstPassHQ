/**
 * A member's page for admins, in tabs (src/app/admin/[id].tsx, with
 * src/components/member-tabs.tsx and src/lib/member-tabs.ts): Overview,
 * Roles, Checks, Family and History, from "A member’s page" in section 10 of
 * docs/user-guide.md.
 *
 * Only admins reach the page (route-guards.test.tsx), so what changes here is
 * the member being looked at: which tabs they have, what each tab holds and
 * hides, what stays in view on every tab, which tab a to-do opens, and that
 * Save on any tab saves what is on all of them. What the page sends to the
 * database is in admin-member-actions.test.tsx.
 */
import { cleanup, fireEvent, screen, within } from 'expo-router/testing-library';
import { Dimensions } from 'react-native';

import MemberScreen from '@/app/admin/[id]';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type {
  GuardianshipChange,
  Profile,
  StandDown,
  Team,
  VolunteerExemption,
  WwccApplication,
} from '@/lib/types';

import { fieldFor, openFullRecord, rpcsNamed, spyOnBack, untilQuiet } from './helpers/admin-screens';
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
/** The phone's width, as the page reads it. */
function setWidth(width: number) {
  const size = { width, height: 800, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
}

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
  back = spyOnBack();
  setWidth(390);
});
afterEach(() => back.mockRestore());

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

/** A coach whose card is current, validated and registered: nothing to sort out. */
const SORTED_COACH: Profile = {
  ...p('coach'),
  wwcc_validated_at: '2026-06-01T00:00:00Z',
  wwcc_unit_linked_at: '2026-06-01T00:00:00Z',
};
const NO_CHECK_COACH: Profile = { ...p('coach'), id: 'coach-no-check', wwcc_number: null, wwcc_expires_on: null };
const GUARDIAN = p('guardian');
const CHILD: Profile = { ...morePersonas.under18Athlete.profile, full_name: 'Sample Child' };

const exemption = (overrides: Partial<VolunteerExemption> = {}): VolunteerExemption => ({
  id: 'e1',
  profile_id: NO_CHECK_COACH.id,
  basis: 'parent_volunteer',
  child_id: CHILD.id,
  child_name: 'Sample Child',
  set_by_name: 'Sample admin',
  set_at: '2026-09-01T00:00:00Z',
  declared_at: '2026-09-02T00:00:00Z',
  declaration_text: null,
  ended_at: null,
  ended_by_name: null,
  end_note: null,
  valid: true,
  ends_on: null,
  starts_on: null,
  event_name: null,
  organiser: null,
  ...overrides,
});

const application = (overrides: Partial<WwccApplication> = {}): WwccApplication => ({
  id: 'a1',
  profile_id: NO_CHECK_COACH.id,
  member_name: 'Sample coach',
  application_number: 'APL 123',
  lodged_on: '2026-10-10',
  kind: 'new',
  receipt_path: 'coach/uuid-1/receipt.pdf',
  receipt_name: 'receipt.pdf',
  recorded_at: '2026-10-11T02:00:00Z',
  recorded_by_name: 'Sample admin',
  declared_at: '2026-10-12T02:00:00Z',
  checked_at: null,
  checked_by_name: null,
  check_due_on: '2026-11-10',
  lapses_on: '2027-01-09',
  status: 'in_force',
  ended_at: null,
  ended_reason: null,
  ended_by_name: null,
  end_note: null,
  ...overrides,
});

const STAND_DOWN: StandDown = {
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

type Placement = { team_id: string; team_role: string; coach_title: string | null; selection: string | null };

async function openMember(
  target: Profile,
  {
    viewer = 'admin' as PersonaName | Persona,
    todo = null as string | null,
    placements = [] as Placement[],
    guardianships = [] as { guardian_id: string; athlete_id: string }[],
    requests = [] as { guardian_id: string; athlete_id: string }[],
    people = [] as Profile[],
    standDowns = [] as StandDown[],
    exemptions = [] as VolunteerExemption[],
    applications = [] as WwccApplication[],
    history = [] as GuardianshipChange[],
    full = true,
  } = {},
) {
  // A test that opens a second member closes the first page, as going back does.
  await cleanup();
  await openScreen(
    viewer,
    { 'admin/[id]': MemberScreen },
    `/admin/${target.id}${todo ? `?todo=${todo}` : ''}`,
    {
      teams: [SQUAD, SQUAD_TEAM],
      guardianships,
      guardian_link_requests: requests,
      stand_downs: standDowns,
      screening_notices: [],
      guardianship_history: history,
    },
    {
      tableHandlers: {
        profiles: (q) => {
          if (q.eq('id') === target.id) return [target];
          if (q.eq('status') === 'approved') return people;
          const ids = q.calls.find((c) => c.method === 'in')?.args[1] as string[] | undefined;
          if (ids) return people.filter((o) => ids.includes(o.id));
          return undefined;
        },
        team_members: (q) => (q.eq('profile_id') === target.id ? placements : []),
      },
      rpcs: {
        admin_volunteer_exemptions: exemptions,
        admin_wwcc_applications: applications,
        admin_date_of_birth_record: null,
      },
    },
  );
  if (full) await openFullRecord();
}

/** The tabs offered, in order. */
const tabs = () =>
  screen.getAllByRole('tab').map((t) => within(t).getByText(/./).props.children as string);

/** The tab showing now. */
const selectedTab = () =>
  within(screen.getByRole('tab', { selected: true })).getByText(/./).props.children as string;

async function openTab(name: string) {
  await fireEvent.press(screen.getByRole('tab', { name }));
  await untilQuiet();
}

async function press(text: string | RegExp) {
  await fireEvent.press(screen.getByText(text));
  await untilQuiet();
}

/** Something only each part of the page shows, and the tab it belongs on. */
const PARTS = {
  attention: 'needs-attention',
  details: 'Sign-in email',
  removal: 'Reason if removing access',
  removeAccess: 'Remove access',
  deleteMember: 'Delete member',
  role: 'Role',
  otherRoles: 'Other roles',
  squads: 'Squads',
  wwcc: 'Working With Children Check',
  notices: 'Screening Unit notices',
  standDown: 'Stand down now',
  dateOfBirth: 'Date of birth',
  guardians: 'Parents and guardians',
  guardianOf: 'Guardian of',
  recordViews: 'Who has viewed their records',
} as const;
type Part = keyof typeof PARTS;

/** The parts in view now. Parts of a tab that isn't showing don't count. */
function inView(): Part[] {
  return (Object.keys(PARTS) as Part[]).filter((part) =>
    part === 'attention'
      ? screen.queryAllByTestId(PARTS[part]).length > 0
      : screen.queryAllByText(PARTS[part]).length > 0,
  );
}

describe('which tabs a member has', () => {
  it.each<[string, Profile, object, string[]]>([
    ['a coach', p('coach'), {}, ['Overview', 'Roles', 'Checks']],
    ['a manager', p('manager'), {}, ['Overview', 'Roles', 'Checks']],
    ['a physio', p('physio'), {}, ['Overview', 'Roles', 'Checks']],
    ['a committee member', p('committee'), {}, ['Overview', 'Roles', 'Checks']],
    ['another admin', p('adminExpiredCheck'), {}, ['Overview', 'Roles', 'Checks']],
    ['a temporary helper', p('volunteer'), {}, ['Overview', 'Roles', 'Checks']],
    ['a guest', p('guest'), {}, ['Overview', 'Roles', 'Checks']],
    ['an adult athlete', p('athlete'), {}, ['Overview', 'Roles', 'Checks']],
    [
      'an athlete under 18',
      CHILD,
      { guardianships: [{ guardian_id: 'guardian', athlete_id: CHILD.id }], people: [GUARDIAN] },
      ['Overview', 'Roles', 'Checks', 'Family', 'History'],
    ],
    ['a parent or guardian', GUARDIAN, {}, ['Overview', 'Roles', 'Checks', 'Family', 'History']],
    ['someone who runs the stream', p('studio'), {}, ['Overview', 'Roles', 'Checks']],
  ])('%s', async (_label, target, options, expected) => {
    await openMember(target, options);
    expect(tabs()).toEqual(expected);
  });

  it('an admin on their own page has no tab that would be empty', async () => {
    // A verified parent who is an admin: no notices or stand-down for yourself.
    const self = morePersonas.adminGuardian;
    await openMember(self.profile, { viewer: self });
    expect(tabs()).toEqual(['Overview', 'Roles', 'Checks', 'Family', 'History']);
    await openMember(personas.admin.profile!, { viewer: 'admin' });
    expect(tabs()).toEqual(['Overview', 'Roles', 'Checks']);
  });

  it('someone waiting has tabs on their full record, not on the request’s summary', async () => {
    await openMember(p('pending'), { full: false });
    expect(screen.getByTestId('join-request')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.queryByTestId('member-header')).toBeNull();
    await openFullRecord();
    expect(tabs()).toEqual(['Overview', 'Roles', 'Checks']);
    expect(selectedTab()).toBe('Overview');
  });

  it('a tab appears when a role chosen on Roles gives it something to hold', async () => {
    await openMember(p('athlete'));
    expect(tabs()).not.toContain('Family');
    await openTab('Roles');
    await fireEvent.press(within(screen.getByTestId('member-pane-roles')).getAllByText('Guardian')[0]);
    await untilQuiet();
    expect(tabs()).toContain('Family');
    // Still on Roles: the page doesn't jump.
    expect(selectedTab()).toBe('Roles');
  });
});

describe('what each tab holds', () => {
  it('opens on Overview: what needs attention, then the basics, then leaving the club', async () => {
    await openMember(p('coach'));
    expect(selectedTab()).toBe('Overview');
    expect(inView()).toEqual(['attention', 'details', 'removal', 'removeAccess', 'deleteMember']);
    expect(screen.getByText('Save changes')).toBeTruthy();
  });

  it('Roles holds their roles, squads and teams, and nothing about checks', async () => {
    await openMember(p('coach'));
    await openTab('Roles');
    expect(inView()).toEqual(['role', 'otherRoles', 'squads']);
    expect(screen.getByText('Save changes')).toBeTruthy();
  });

  it('Checks holds the check, notices and stand-down', async () => {
    await openMember(p('coach'));
    await openTab('Checks');
    expect(inView()).toEqual(['wwcc', 'notices', 'standDown']);
    expect(screen.getByText('Card number')).toBeTruthy();
    expect(screen.getByText('Save changes')).toBeTruthy();
  });

  it('Checks holds an athlete’s date of birth, and who they are until they’re verified', async () => {
    await openMember(p('athlete'));
    await openTab('Checks');
    expect(inView()).toEqual(['dateOfBirth']);
    expect(screen.queryByText('Verify who they are')).toBeNull();

    await openMember(p('pending'));
    await openTab('Checks');
    expect(screen.getByText('Verify who they are')).toBeTruthy();
    expect(screen.getByText('Date of birth')).toBeTruthy();
  });

  it('Family holds a child’s parents and guardians; History who viewed their records and the links', async () => {
    await openMember(CHILD, {
      guardianships: [{ guardian_id: 'guardian', athlete_id: CHILD.id }],
      people: [GUARDIAN],
    });
    await openTab('Family');
    expect(inView()).toEqual(['guardians']);
    expect(screen.getByText('Sample guardian  ✕')).toBeTruthy();
    expect(screen.getByText('Add a guardian')).toBeTruthy();

    await openTab('History');
    expect(inView()).toEqual(['recordViews']);
    expect(screen.getByText('No parent or guardian has been linked or unlinked.')).toBeTruthy();
  });

  it('Family holds a parent’s children; History their link history', async () => {
    await openMember(GUARDIAN, {
      guardianships: [{ guardian_id: GUARDIAN.id, athlete_id: CHILD.id }],
      people: [CHILD],
      history: [
        {
          id: 'h1',
          guardian_id: GUARDIAN.id,
          guardian_name: 'Sample guardian',
          athlete_id: CHILD.id,
          athlete_name: 'Sample Child',
          change: 'linked',
          reason: null,
          changed_by: 'admin',
          changed_by_name: 'Sample admin',
          changed_at: '2026-09-01T02:00:00Z',
        },
      ],
    });
    await openTab('Family');
    expect(inView()).toEqual(['guardianOf']);
    expect(screen.getByText(/^Sample Child · born 03\/03\/2010/)).toBeTruthy();
    expect(screen.queryByText('Guardian link history')).toBeNull();

    await openTab('History');
    expect(screen.getByText('Guardian link history')).toBeTruthy();
    expect(screen.getByText(/^Linked to Sample Child as their guardian, .* by Sample admin\.$/)).toBeTruthy();
    expect(screen.queryByText('No parent or guardian has been linked or unlinked.')).toBeNull();
  });

  it('History holds exemptions that have ended, and gives a member the tab for them', async () => {
    await openMember(NO_CHECK_COACH, {
      exemptions: [exemption({ ended_at: '2026-10-01T00:00:00Z', ended_by_name: 'Sample admin', end_note: 'Has a card now' })],
    });
    expect(tabs()).toEqual(['Overview', 'Roles', 'Checks', 'History']);
    await openTab('Checks');
    expect(screen.queryByText(/^Earlier: /)).toBeNull();
    await openTab('History');
    expect(screen.getByText('Earlier exemptions')).toBeTruthy();
    expect(screen.getByText(/^Earlier: .* for Sample Child, recorded .* by Sample admin \(Has a card now\)$/)).toBeTruthy();
  });

  it('keeps Remove access, its reasons and Delete member on Overview only', async () => {
    await openMember(p('coach'));
    for (const tab of ['Roles', 'Checks']) {
      await openTab(tab);
      expect(inView()).not.toContain('removal');
      expect(inView()).not.toContain('removeAccess');
      expect(inView()).not.toContain('deleteMember');
    }
    await openTab('Overview');
    expect(inView()).toEqual(expect.arrayContaining(['removal', 'removeAccess', 'deleteMember']));
  });

  it('for someone waiting: Approve on every tab, Don’t approve and its reasons on Overview', async () => {
    await openMember(p('pending'));
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText("Don't approve")).toBeTruthy();
    expect(screen.getByText('Reason if not approving')).toBeTruthy();
    for (const tab of ['Roles', 'Checks']) {
      await openTab(tab);
      expect(screen.getByText('Approve')).toBeTruthy();
      expect(screen.queryByText("Don't approve")).toBeNull();
      expect(screen.queryByText('Reason if not approving')).toBeNull();
    }
  });

  it('never offers an admin Remove access or Delete member on their own page, on any tab', async () => {
    await openMember(personas.admin.profile!, { viewer: 'admin' });
    for (const tab of tabs()) {
      await openTab(tab);
      expect(inView()).not.toContain('removeAccess');
      expect(inView()).not.toContain('deleteMember');
      expect(inView()).not.toContain('standDown');
      expect(screen.getByText('Save changes')).toBeTruthy();
    }
  });

  it('a tab that isn’t showing is out of a screen reader’s reach, but still on the page', async () => {
    await openMember(p('coach'));
    expect(screen.queryByText('Card number')).toBeNull();
    // Still mounted, so what was typed there is kept.
    expect(screen.getByText('Card number', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('member-pane-checks', { includeHiddenElements: true })).toHaveStyle({
      display: 'none',
    });
    expect(screen.getByTestId('member-pane-overview')).not.toHaveStyle({ display: 'none' });
  });
});

describe('the tabs on a narrow phone', () => {
  it.each([
    [390, 13],
    [350, 13],
    [320, 12],
  ])('at %i wide all five tabs are offered, in words of size %i', async (width, fontSize) => {
    setWidth(width);
    await openMember(CHILD);
    expect(tabs()).toEqual(['Overview', 'Roles', 'Checks', 'Family', 'History']);
    for (const tab of screen.getAllByRole('tab')) {
      expect(within(tab).getByText(/./)).toHaveStyle({ fontSize });
    }
    // Each is still a tab that can be chosen.
    await openTab('History');
    expect(selectedTab()).toBe('History');
  });
});

describe('the background reading on Checks', () => {
  const RULES = /^Coaches, managers, physios, statisticians, temporary helpers/;
  const SOURCE = 'Working with Children (Screening) Act 2004';

  it('is folded to one line, so the card comes first, and opens on a tap', async () => {
    await openMember(p('coach'));
    await openTab('Checks');
    const fold = screen.getByRole('button', { name: 'Who needs a check, and the rules' });
    expect(fold).toHaveProp('accessibilityState', { expanded: false });
    expect(screen.queryByText(RULES)).toBeNull();
    expect(screen.queryByText(SOURCE)).toBeNull();
    // Still on the page, as a tab that isn't showing is.
    expect(screen.getByText(RULES, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Card number')).toBeTruthy();

    await fireEvent.press(fold);
    expect(screen.getByRole('button', { name: 'Who needs a check, and the rules' })).toHaveProp(
      'accessibilityState',
      { expanded: true },
    );
    expect(screen.getByText(RULES)).toBeTruthy();
    expect(screen.getByRole('link', { name: SOURCE })).toBeTruthy();

    // And folds away again.
    await fireEvent.press(screen.getByRole('button', { name: 'Who needs a check, and the rules' }));
    expect(screen.queryByText(RULES)).toBeNull();
  });

  it('keeps a guest’s short note in view and folds only the links', async () => {
    await openMember(p('guest'));
    await openTab('Checks');
    expect(screen.getByText(/^Guests don’t need a check\./)).toBeTruthy();
    expect(screen.queryByText(SOURCE)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'The rules at the source' }));
    expect(screen.getByRole('link', { name: SOURCE })).toBeTruthy();
    expect(screen.queryByText(RULES, { includeHiddenElements: true })).toBeNull();
  });

  it('opening it changes nothing that Save sends', async () => {
    await openMember(p('coach'));
    await openTab('Checks');
    await fireEvent.press(screen.getByRole('button', { name: 'Who needs a check, and the rules' }));
    await press('Save changes');
    expect(rpcsNamed('admin_save_member')[0][1]).toMatchObject({ p_profile_id: 'coach', p_role: 'coach', p_extra_roles: [] });
  });
});

describe('the line above the tabs', () => {
  it('says who they are on every tab: status, roles and where they are', async () => {
    await openMember(p('coach'), {
      placements: [
        { team_id: SQUAD.id, team_role: 'coach', coach_title: 'head_coach', selection: null },
        { team_id: SQUAD_TEAM.id, team_role: 'coach', coach_title: 'head_coach', selection: null },
      ],
    });
    // Their team, not also its squad.
    expect(screen.getByTestId('member-lead')).toHaveTextContent('Approved · Coach · Open A');
    await openTab('Checks');
    expect(screen.getByTestId('member-lead')).toHaveTextContent('Approved · Coach · Open A');
  });

  it('names their squad when they are in no team', async () => {
    await openMember(p('athlete'), {
      placements: [{ team_id: SQUAD.id, team_role: 'athlete', coach_title: null, selection: null }],
    });
    expect(screen.getByTestId('member-lead')).toHaveTextContent('Approved · Athlete · Open Squad');
  });

  it('says what someone waiting asked for', async () => {
    await openMember(p('pending'));
    expect(screen.getByTestId('member-lead')).toHaveTextContent('Pending · Asked to join as an athlete');
  });

  it('says why someone wasn’t approved', async () => {
    await openMember(p('rejected'));
    expect(screen.getByTestId('member-lead')).toHaveTextContent('Rejected · Not registered with the club');
  });

  it('says a stand-down on every tab, and opens Checks where it is lifted', async () => {
    await openMember(p('stoodDownCoach'), { standDowns: [STAND_DOWN] });
    const notice = `Stood down since ${localDay('2026-10-01T00:00:00Z')}. Paused: Coach.`;
    for (const tab of tabs()) {
      await openTab(tab);
      expect(within(screen.getByTestId('member-paused')).getByText(notice)).toBeTruthy();
    }
    await openTab('Overview');
    await fireEvent.press(
      screen.getByLabelText(`${notice} Opens the Checks tab`),
    );
    await untilQuiet();
    expect(selectedTab()).toBe('Checks');
    expect(screen.getByText('Lift stand-down')).toBeTruthy();
    // Said once above the tabs, not again under Needs attention.
    await openTab('Overview');
    expect(within(screen.getByTestId('needs-attention')).queryByText('Stood down')).toBeNull();
  });

  it('says a role paused for want of a check', async () => {
    await openMember(NO_CHECK_COACH);
    expect(
      within(screen.getByTestId('member-paused')).getByText(
        'Paused: Coach. They can’t use this role until their Working With Children Check is sorted out.',
      ),
    ).toBeTruthy();
  });

  it.each<[string, object]>([
    ['a current card', {}],
    ['an exemption that applies', { exemptions: [exemption()] }],
    ['an application in force', { applications: [application()] }],
  ])('says nothing is paused for a coach with %s', async (label, options) => {
    await openMember(label === 'a current card' ? p('coach') : NO_CHECK_COACH, options);
    expect(screen.queryByTestId('member-paused')).toBeNull();
  });

  it.each<[string, object]>([
    ['an exemption that no longer applies', { exemptions: [exemption({ valid: false })] }],
    ['an application that lapsed', { applications: [application({ status: 'lapsed' })] }],
  ])('says the role is paused with %s', async (_label, options) => {
    await openMember(NO_CHECK_COACH, options);
    expect(within(screen.getByTestId('member-paused')).getByText(/^Paused: Coach\./)).toBeTruthy();
  });

  it.each<[string, Profile]>([
    ['an athlete', p('athlete')],
    ['a parent', GUARDIAN],
    ['an admin whose check expired', p('adminExpiredCheck')],
    ['someone waiting to be a coach', { ...p('pending'), requested_role: 'coach', wwcc_number: null }],
  ])('says nothing is paused for %s', async (_label, target) => {
    await openMember(target);
    expect(screen.queryByTestId('member-paused')).toBeNull();
  });
});

describe('Needs attention on Overview', () => {
  const attention = () => within(screen.getByTestId('needs-attention'));

  it('says so when nothing does', async () => {
    await openMember(SORTED_COACH);
    expect(attention().getByText('Nothing needs attention')).toBeTruthy();
    expect(attention().queryByText('Needs attention')).toBeNull();
  });

  it('lists what the member list lists under their name, and each line opens its tab', async () => {
    await openMember(p('coach'));
    expect(attention().getByText('Needs attention')).toBeTruthy();
    expect(attention().getByText('Check not validated')).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText('Card not registered with the club. Opens the Checks tab'),
    );
    await untilQuiet();
    expect(selectedTab()).toBe('Checks');
    expect(screen.getByText('Card number')).toBeTruthy();
  });

  it('sends a locked child and a waiting link code to Family', async () => {
    const parent: Profile = { ...GUARDIAN, id: 'new-parent', full_name: 'New Parent', status: 'pending' };
    await openMember(CHILD, {
      requests: [{ guardian_id: parent.id, athlete_id: CHILD.id }],
      people: [parent],
    });
    expect(attention().getByText('Locked: no verified parent or guardian linked')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('A parent entered their link code. Opens the Family tab'));
    await untilQuiet();
    expect(selectedTab()).toBe('Family');
    expect(screen.getByText('New Parent entered their code')).toBeTruthy();
  });

  it('says where an application is up to once it is known, in place of the missing card', async () => {
    await openMember(NO_CHECK_COACH, { applications: [application({ status: 'lapsed' })] });
    expect(
      attention().getByText('Check applied for 10/10/2026: lapsed, nobody confirmed it’s still being assessed'),
    ).toBeTruthy();
    expect(attention().queryByText('No Working With Children Check recorded')).toBeNull();

    await openMember(NO_CHECK_COACH, { applications: [application()] });
    expect(attention().getByText('Nothing needs attention')).toBeTruthy();

    await openMember(NO_CHECK_COACH);
    expect(attention().getByText('No Working With Children Check recorded')).toBeTruthy();
  });

  it('for someone waiting, lists what to sort out before approving them', async () => {
    await openMember({ ...p('pending'), requested_role: 'coach', wwcc_number: null, wwcc_expires_on: null });
    expect(attention().getByText('Not verified yet')).toBeTruthy();
    expect(attention().getByText('No Working With Children Check recorded')).toBeTruthy();
    expect(attention().queryByText('No date of birth checked yet')).toBeNull();

    await openMember({ ...p('pending'), date_of_birth: null });
    expect(attention().getByText('No date of birth checked yet')).toBeTruthy();
  });

  it('shows names and states only: no card number, date of birth or guardian', async () => {
    await openMember(CHILD, {
      guardianships: [{ guardian_id: 'guardian', athlete_id: CHILD.id }],
      people: [{ ...GUARDIAN, verified_at: null }],
    });
    const texts = attention()
      .getAllByText(/./)
      .map((t) => String(t.props.children));
    expect(texts).toEqual(['Needs attention', 'Locked: no verified parent or guardian linked', 'Family']);
  });
});

describe('the tab a to-do opens', () => {
  it.each<[string, Profile, object, string]>([
    ['wwcc', p('coach'), {}, 'Checks'],
    ['wwcc-sent', p('coach'), {}, 'Checks'],
    ['wwcc-application', NO_CHECK_COACH, { applications: [application()] }, 'Checks'],
    ['exemption-ending', NO_CHECK_COACH, { exemptions: [exemption()] }, 'Checks'],
    ['notice', p('coach'), {}, 'Checks'],
    ['dob', { ...p('athlete'), date_of_birth: null }, {}, 'Checks'],
    ['locked', CHILD, {}, 'Family'],
    ['turning-18', CHILD, {}, 'Family'],
    ['unendorsable', p('physio'), {}, 'Roles'],
    ['inactive', p('athlete'), {}, 'Overview'],
  ])('%s opens %s, with what to do just above its part', async (todo, target, options, tab) => {
    await openMember(target, { ...options, todo });
    expect(selectedTab()).toBe(tab);
    // In view on that tab, and only once on the page.
    expect(screen.getByTestId('todo-banner')).toBeTruthy();
    // What the to-do needs is marked while it is still to do.
    expect(within(screen.getByTestId('todo-banner')).getByTestId('status-attention')).toBeTruthy();
    expect(screen.getAllByTestId('todo-banner', { includeHiddenElements: true })).toHaveLength(1);
    expect(screen.getAllByTestId('focus-anchor', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('a join request’s to-do opens the summary, and Overview in the full record', async () => {
    await openMember(p('pending'), { todo: 'join', full: false });
    expect(screen.getByTestId('join-request')).toBeTruthy();
    await openFullRecord();
    expect(selectedTab()).toBe('Overview');
    expect(
      within(screen.getByTestId('todo-banner')).getByText(
        'Check who they are on Checks, choose their role and squad or team on Roles, then Approve. Don’t approve is at the end of Overview.',
      ),
    ).toBeTruthy();
  });

  it('a to-do for a tab the member doesn’t have opens Overview', async () => {
    // An adult athlete has no Family tab; an old "locked" to-do still opens their page.
    await openMember(p('athlete'), { todo: 'locked' });
    expect(tabs()).not.toContain('Family');
    expect(selectedTab()).toBe('Overview');
  });

  it('with no to-do there is no banner and no anchor on any tab', async () => {
    await openMember(p('coach'));
    expect(screen.queryAllByTestId('todo-banner', { includeHiddenElements: true })).toEqual([]);
    expect(screen.queryAllByTestId('focus-anchor', { includeHiddenElements: true })).toEqual([]);
  });
});

describe('saving from any tab', () => {
  it('keeps what was typed on one tab while another shows, and Save sends all of it', async () => {
    await openMember(p('coach'), {
      placements: [{ team_id: SQUAD.id, team_role: 'coach', coach_title: 'head_coach', selection: null }],
    });
    await openTab('Checks');
    await fireEvent.changeText(fieldFor('Card number'), '7654321b');
    await fireEvent.changeText(fieldFor('Expires'), '01/02/2029');
    await openTab('Roles');
    await fireEvent.press(within(screen.getByTestId('member-pane-roles')).getAllByText('Guardian')[1]);
    await untilQuiet();
    await openTab('Checks');
    expect(fieldFor('Card number').props.value).toBe('7654321b');

    // Save from a third tab.
    await openTab('Overview');
    await press('Save changes');
    expect(rpcsNamed('admin_set_member_details')).toEqual([
      [
        'admin_set_member_details',
        { p_profile_id: 'coach', p_date_of_birth: '1990-05-05', p_wwcc_number: '7654321b', p_wwcc_expires_on: '2029-02-01' },
      ],
    ]);
    const saved = rpcsNamed('admin_save_member')[0][1]!;
    expect(saved.p_role).toBe('coach');
    expect(saved.p_extra_roles).toEqual(['guardian']);
    expect(saved.p_teams).toEqual([
      { team_id: SQUAD.id, team_role: 'coach', coach_title: 'head_coach', selection: null },
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it.each(['Overview', 'Roles', 'Checks'])('saves unchanged from %s without altering anything', async (tab) => {
    await openMember(p('coach'));
    await openTab(tab);
    await press('Save changes');
    const saved = rpcsNamed('admin_save_member');
    expect(saved).toHaveLength(1);
    expect(saved[0][1]).toMatchObject({ p_profile_id: 'coach', p_role: 'coach', p_status: 'approved', p_extra_roles: [] });
  });

  it('a refusal opens the tab holding what to fix, with why above Save', async () => {
    await openMember(p('coach'));
    await openTab('Checks');
    await fireEvent.changeText(fieldFor('Expires'), 'soon');
    await openTab('Roles');
    await press('Save changes');
    expect(selectedTab()).toBe('Checks');
    expect(screen.getByText('Enter the check expiry date as DD/MM/YYYY.')).toBeTruthy();
    expect(rpcsNamed('admin_save_member')).toEqual([]);
    expect(back).not.toHaveBeenCalled();
  });

  it('roles that can’t be held together send the admin back to Roles', async () => {
    await openMember(p('athlete'));
    await openTab('Roles');
    await fireEvent.press(within(screen.getByTestId('member-pane-roles')).getAllByText('Manager')[1]);
    await untilQuiet();
    await openTab('Overview');
    // Overview says it too, and its line opens Roles.
    expect(screen.getByLabelText('Athletes can’t also be managers.. Opens the Roles tab')).toBeTruthy();
    await press('Save changes');
    expect(selectedTab()).toBe('Roles');
    expect(rpcsNamed('admin_save_member')).toEqual([]);
  });

  it('removing access without a reason stays on Overview and says why', async () => {
    await openMember(p('coach'));
    await press('Remove access');
    expect(selectedTab()).toBe('Overview');
    expect(screen.getByText('Choose a reason before removing access.')).toBeTruthy();
    expect(rpcsNamed('admin_save_member')).toEqual([]);
  });

  it('the database’s refusal shows on whichever tab the admin saved from', async () => {
    await openMember(p('coach'));
    (supabase.rpc as jest.Mock).mockImplementationOnce(async () => ({ data: null, error: null }));
    await openTab('Roles');
    const rpc = supabase.rpc as jest.Mock;
    const answer = rpc.getMockImplementation()!;
    rpc.mockImplementation((name: string, args: unknown) =>
      name === 'admin_save_member'
        ? Promise.resolve({ data: null, error: { message: 'Only an admin can do that' } })
        : answer(name, args),
    );
    await press('Save changes');
    expect(selectedTab()).toBe('Roles');
    expect(screen.getByText('Only an admin can do that')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
    rpc.mockImplementation(answer);
  });
});
