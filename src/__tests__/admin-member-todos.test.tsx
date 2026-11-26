/**
 * Home screen to-dos about members open the people they are about, and
 * straight at the action when there is only one (src/app/admin/index.tsx with
 * `?todo=`, and src/app/admin/[id].tsx with `?todo=`). Matt, 18 November
 * 2026: a to-do about a member needing approval opens that approval, not the
 * member list.
 *
 * Each kind of to-do is checked both ways: the people it lists, and the
 * nearest people it leaves out. A to-do already dealt with says so instead of
 * showing an empty list or a form.
 */
import { fireEvent, screen, within } from 'expo-router/testing-library';
import { router } from 'expo-router';

import MemberScreen from '@/app/admin/[id]';
import MembersScreen from '@/app/admin/index';
import { JOIN_SUMMARY_ACTION } from '@/lib/join-request';
import { memberPageHref, memberTodoCopy, type MemberTodoKind } from '@/lib/member-todos';
import type { Profile, VolunteerExemption, WwccApplication } from '@/lib/types';

import { openFullRecord, untilQuiet } from './helpers/admin-screens';
import { onATablet, openScreen, personas, resetClub, type QueryInfo } from './helpers/harness';

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

let replace: jest.SpyInstance;
let push: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
});
afterEach(() => {
  replace.mockRestore();
  push.mockRestore();
});

const base = personas.athlete.profile!;

/** A card that is current, validated and registered: nothing to check. */
const CHECKED_CARD: Partial<Profile> = {
  wwcc_number: '1234567A',
  wwcc_expires_on: '2029-06-30',
  wwcc_validated_at: '2026-06-01T00:00:00Z',
  wwcc_unit_linked_at: '2026-06-01T00:00:00Z',
};
const NO_CARD: Partial<Profile> = { wwcc_number: null, wwcc_expires_on: null };

function member(id: string, name: string, extra: Partial<Profile> = {}): Profile {
  return { ...base, id, full_name: name, email: `${id}@example.test`, ...extra };
}

// Today is 18 October 2026 (the harness's TODAY).
const M = {
  newParent: member('m-new-parent', 'Pia Parent', {
    status: 'pending',
    role: 'guest',
    requested_role: 'guardian',
    join_requested_at: '2026-10-05T00:00:00Z',
  }),
  newChild: member('m-new-child', 'Nico New', {
    status: 'pending',
    role: 'guest',
    requested_role: 'athlete',
    join_requested_at: '2026-10-10T00:00:00Z',
  }),
  signedIn: member('m-signed-in', 'Sam SignedIn', { status: 'pending', role: 'guest', join_requested_at: null }),
  adult: member('m-adult', 'Ada Adult'),
  child: member('m-child', 'Charlie Child', { date_of_birth: '2012-02-02' }),
  linkedChild: member('m-linked', 'Lee Linked', { date_of_birth: '2012-02-02' }),
  turning18: member('m-turning', 'Taylor Turning', { date_of_birth: '2008-11-01' }),
  noBirthday: member('m-nodob', 'Nadia NoDate', { date_of_birth: null }),
  goodCoach: member('m-coach', 'Casey Coach', { role: 'coach', ...CHECKED_CARD }),
  noCard: member('m-nocard', 'Corey NoCard', { role: 'coach', ...NO_CARD }),
  notice: member('m-notice', 'Nora Notice', { role: 'coach', ...CHECKED_CARD }),
  applied: member('m-applied', 'Alex Applied', { role: 'coach', ...NO_CARD }),
  exempt: member('m-exempt', 'Pat Parent', { role: 'manager', ...NO_CARD }),
  gone: member('m-gone', 'Gina Gone'),
  physio: member('m-physio', 'Phil Physio', { role: 'physio', ...CHECKED_CARD }),
  headPhysio: member('m-head-physio', 'Hana Head', { role: 'physio', head_physio: true, ...CHECKED_CARD }),
  guardian: member('m-guardian', 'Gwen Guardian', { role: 'guardian', date_of_birth: '1980-01-01' }),
};

const EXEMPTION: VolunteerExemption = {
  id: 'ex-1',
  profile_id: 'm-exempt',
  basis: 'parent_volunteer',
  child_id: 'm-linked',
  child_name: 'Lee Linked',
  set_by_name: 'Sample admin',
  set_at: '2026-10-01T00:00:00Z',
  declared_at: '2026-10-02T00:00:00Z',
  declaration_text: null,
  ended_at: null,
  ended_by_name: null,
  end_note: null,
  valid: true,
  // Lee turns 18 within 60 days in this story.
  ends_on: '2026-11-30',
  starts_on: null,
  event_name: null,
  organiser: null,
};

const APPLICATION: Partial<WwccApplication> = {
  id: 'app-1',
  profile_id: 'm-applied',
  member_name: 'Alex Applied',
  lodged_on: '2026-09-01',
  status: 'in_force',
  check_due_on: '2026-10-18',
  lapses_on: '2026-11-01',
  ended_at: null,
};

/**
 * `withPages` also answers what a member's own page asks for, for the tablet
 * tests, where the page opens beside this list.
 */
async function openTodo(
  kind: MemberTodoKind | 'nonsense',
  members: Profile[] = Object.values(M),
  withPages = false,
) {
  await openScreen(
    'admin',
    // The member's page the to-do opens when there is only one person.
    { 'admin/index': MembersScreen, 'admin/[id]': () => null },
    `/admin?todo=${kind}`,
    {
      guardianships: [{ guardian_id: 'm-guardian', athlete_id: 'm-linked' }],
      guardian_link_requests: [],
      // The screen asks only for barring notices not yet reported.
      screening_notices: [{ profile_id: 'm-notice' }],
      ...(withPages ? { stand_downs: [], guardianship_history: [] } : {}),
    },
    {
      tableHandlers: {
        profiles: (q) => {
          const id = q.eq('id');
          if (id === undefined) return withPages && q.eq('status') === 'approved' ? [] : members;
          const member = withPages ? members.find((m) => m.id === id) : undefined;
          return member ? [member] : undefined;
        },
        team_members: (q) => (q.eq('profile_id') === undefined ? [] : undefined),
        // The list asks who has a notice to report; a member's page, for that member's notices.
        ...(withPages
          ? {
              screening_notices: (q: QueryInfo) =>
                q.eq('profile_id') === undefined ? [{ profile_id: 'm-notice' }] : [],
            }
          : {}),
      },
      rpcs: {
        ...(withPages ? { admin_date_of_birth_record: null } : {}),
        admin_volunteer_exemptions: [EXEMPTION],
        admin_inactive_members: [{ profile_id: 'm-gone', last_active: '2024-06-01T00:00:00Z' }],
        admin_wwcc_applications: [APPLICATION],
        // Cards two coaches sent in themselves, waiting for an admin.
        admin_wwcc_submissions: [
          { id: 's1', profile_id: 'm-nocard', card_number: 'WWC1111', expires_on: '2029-01-31' },
          { id: 's2', profile_id: 'm-applied', card_number: 'WWC2222', expires_on: '2028-05-01' },
        ],
        admin_unendorsable_clearances: [{ injury_id: 'i1', athlete_id: 'a1', athlete_name: 'Kai Senior' }],
      },
    },
  );
}

const everyone = Object.values(M).map((m) => m.full_name!);
/** The members listed on screen, in order. */
function listed() {
  return screen.container
    .queryAll((n) => typeof n.type === 'string' && typeof n.props.children === 'string')
    .map((n) => n.props.children as string)
    .filter((t) => everyone.includes(t));
}

describe('a member to-do with several people', () => {
  it.each<[MemberTodoKind, string[]]>([
    ['join', ['Pia Parent', 'Nico New']],
    ['locked', ['Charlie Child', 'Taylor Turning']],
    ['unendorsable', ['Phil Physio', 'Hana Head']],
    ['wwcc-sent', ['Corey NoCard', 'Alex Applied']],
  ])('lists only the people the %s to-do is about, with what to do', async (kind, names) => {
    await openTodo(kind);
    expect(listed()).toEqual(names);
    expect(replace).not.toHaveBeenCalled();
    expect(screen).toHavePathname('/admin');
    expect(screen.getByText(/Show all members/)).toBeTruthy();
    // None of the full list's other sections.
    expect(screen.queryByText('Needs checking')).toBeNull();
    expect(screen.queryByText('Search')).toBeNull();
  });

  it('opens the person tapped at the action', async () => {
    await openTodo('join');
    await fireEvent.press(screen.getByText('Nico New'));
    expect(push).toHaveBeenCalledWith(memberPageHref('m-new-child', 'join'));
  });

  it('says what each join request asked for', async () => {
    await openTodo('join');
    expect(screen.getByText('Asked to join as Athlete · Verified in person')).toBeTruthy();
    expect(screen.getByText(memberTodoCopy.join.action)).toBeTruthy();
  });

  it('names the athletes whose clearance nobody can endorse', async () => {
    await openTodo('unendorsable');
    expect(
      screen.getByText(`Nobody can endorse the clearance for Kai Senior. ${memberTodoCopy.unendorsable.action}`),
    ).toBeTruthy();
  });

  it('names the card each member sent in', async () => {
    await openTodo('wwcc-sent');
    expect(screen.getByText('Coach · Sent in card WWC1111, expires 31/01/2029')).toBeTruthy();
    expect(screen.getByText(memberTodoCopy['wwcc-sent'].action)).toBeTruthy();
  });

  it('marks members in Needs checking who sent in a card', async () => {
    await openTodo('nonsense');
    expect(
      screen.getByText('Coach · No Working With Children Check recorded · Sent in a card to check'),
    ).toBeTruthy();
  });

  it('says why each child is listed', async () => {
    await openTodo('locked');
    expect(screen.getByText('Athlete · Locked: no verified parent or guardian linked')).toBeTruthy();
  });
});

describe('a member to-do with one person', () => {
  it.each<[MemberTodoKind, string]>([
    ['dob', 'm-nodob'],
    ['wwcc', 'm-nocard'],
    ['wwcc-application', 'm-applied'],
    ['notice', 'm-notice'],
    ['exemption-ending', 'm-exempt'],
    ['turning-18', 'm-turning'],
    ['inactive', 'm-gone'],
  ])('opens the only person for the %s to-do straight at the action', async (kind, id) => {
    await openTodo(kind);
    expect(screen).toHavePathname(`/admin/${id}`);
    expect(screen).toHaveSearchParams({ id, todo: kind });
  });

  it('opens a single join request straight at its approval', async () => {
    await openTodo('join', [M.newChild, M.signedIn, M.adult]);
    expect(screen).toHavePathname('/admin/m-new-child');
    expect(screen).toHaveSearchParams({ id: 'm-new-child', todo: 'join' });
  });
});

describe('a member to-do already dealt with', () => {
  it.each<[MemberTodoKind, Profile[]]>([
    ['join', [M.signedIn, M.adult]],
    ['locked', [M.linkedChild, M.guardian, M.adult]],
    ['dob', [M.adult, M.guardian]],
    ['wwcc', [M.goodCoach, M.applied, M.exempt]],
    ['unendorsable', [M.goodCoach]],
    ['wwcc-sent', [M.goodCoach, M.adult]],
  ])('says the %s to-do is all done, and offers every member', async (kind, members) => {
    await openTodo(kind, members);
    expect(listed()).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
    expect(screen).toHavePathname('/admin');
    expect(screen.getByText('All done')).toBeTruthy();
    expect(screen.getByText(memberTodoCopy[kind].empty)).toBeTruthy();
    await fireEvent.press(screen.getByText('Show all members'));
    expect(replace).toHaveBeenCalledWith('/admin');
  });

  it('shows the whole member list for a to-do it doesn’t know', async () => {
    await openTodo('nonsense');
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.queryByText('All done')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(screen).toHavePathname('/admin');
  });
});

/** Opens a member's page from a to-do. */
async function openPage(target: Profile | null, kind: MemberTodoKind, id = target?.id ?? 'nobody') {
  await openScreen(
    'admin',
    { 'admin/[id]': MemberScreen },
    `/admin/${id}?todo=${kind}`,
    { guardianships: [], stand_downs: [], screening_notices: [], guardianship_history: [] },
    {
      tableHandlers: {
        profiles: (q) => {
          if (q.eq('id') === id) return target ? [target] : [];
          if (q.eq('status') === 'approved') return [];
          return undefined;
        },
      },
      rpcs: { admin_volunteer_exemptions: [], admin_date_of_birth_record: null },
    },
  );
}

describe('a member’s page opened from a to-do', () => {
  it('says what the join request needs, above the request’s summary and above the full record', async () => {
    await openPage(M.newChild, 'join');
    expect(screen.getByText('To do')).toBeTruthy();
    expect(screen.getByText(JOIN_SUMMARY_ACTION)).toBeTruthy();
    expect(screen.getByTestId('join-request')).toBeTruthy();
    // The decision is the whole page, so it opens at the top.
    expect(screen.queryByTestId('focus-anchor')).toBeNull();

    await openFullRecord();
    expect(screen.getByText(memberTodoCopy.join.action)).toBeTruthy();
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.queryByTestId('focus-anchor')).toBeNull();
  });

  it('opens a waiting member at another to-do’s part of the full record, not the summary', async () => {
    await openPage({ ...M.newChild, date_of_birth: null }, 'dob');
    expect(screen.queryByTestId('join-request')).toBeNull();
    expect(screen.getByText(memberTodoCopy.dob.action)).toBeTruthy();
    expect(screen.getAllByTestId('focus-anchor')).toHaveLength(1);
  });

  it.each<[MemberTodoKind, Profile]>([
    ['dob', M.noBirthday],
    ['wwcc', M.noCard],
    ['locked', M.child],
    ['inactive', M.gone],
    ['notice', M.notice],
    ['unendorsable', M.physio],
  ])('shows the %s to-do’s action first', async (kind, target) => {
    await openPage(target, kind);
    expect(screen.getByText(memberTodoCopy[kind].action)).toBeTruthy();
    expect(screen.getAllByTestId('focus-anchor')).toHaveLength(1);
  });

  it.each<[MemberTodoKind, Profile, string]>([
    ['join', M.adult, 'Already approved. Nothing left to do here.'],
    ['join', { ...M.newChild, status: 'rejected' }, 'Already not approved. Nothing left to do here.'],
    ['dob', M.adult, 'Their date of birth is already added.'],
  ])('says when the %s to-do was already done', async (kind, target, done) => {
    await openPage(target, kind);
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText(done)).toBeTruthy();
    expect(screen.queryByText('To do')).toBeNull();
  });

  it('says a member deleted since has nothing left to do', async () => {
    await openPage(null, 'join', 'm-deleted');
    expect(
      screen.getByText('This member isn’t in the club any more, so there’s nothing left to do here.'),
    ).toBeTruthy();
  });

  it('shows no to-do on a page opened from the member list', async () => {
    await openScreen('admin', { 'admin/[id]': MemberScreen }, `/admin/${M.newChild.id}`, {}, {
      tableHandlers: { profiles: (q) => (q.eq('id') === M.newChild.id ? [M.newChild] : undefined) },
      rpcs: { admin_volunteer_exemptions: [], admin_date_of_birth_record: null },
    });
    expect(screen.queryByText('To do')).toBeNull();
    expect(screen.queryByTestId('focus-anchor')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// On a tablet: the person opens beside the list of people the to-do is about

describe('a member to-do on a tablet', () => {
  onATablet();

  const HINT = 'Choose a member to open their page here.';

  it('opens the person tapped beside the list, and keeps the list', async () => {
    await openTodo('join', Object.values(M), true);
    // Several people: nobody is open until one is tapped.
    expect(listed().length).toBeGreaterThan(1);
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Nico New'));
    await untilQuiet();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText(HINT)).toBeNull();
    // Their page, opened for this to-do as its own screen would be.
    expect(within(screen.getByTestId('detail-pane')).getByText('To do')).toBeTruthy();
    expect(within(screen.getByTestId('detail-pane')).getByTestId('join-request')).toBeTruthy();
    expect(within(screen.getByTestId('list-pane')).getByText('Nico New')).toBeTruthy();
    expect(within(screen.getByTestId('list-pane')).getByText(/Show all members/)).toBeTruthy();
    expect(screen).toHavePathname('/admin');
  });

  it.each<[MemberTodoKind, string]>([
    ['dob', 'Nadia NoDate'],
    ['inactive', 'Gina Gone'],
  ])('opens the only person for the %s to-do beside the list, without leaving it', async (kind, name) => {
    await openTodo(kind, Object.values(M), true);
    await untilQuiet();
    expect(replace).not.toHaveBeenCalled();
    expect(screen).toHavePathname('/admin');
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.getByTestId('detail-pane')).toBeTruthy();
    expect(within(screen.getByTestId('list-pane')).getByText(name)).toBeTruthy();
    // Closed, the list stays: the person isn't opened a second time.
    await fireEvent.press(screen.getByLabelText(/^Close /));
    await untilQuiet();
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(within(screen.getByTestId('list-pane')).getByText(name)).toBeTruthy();
  });
});
