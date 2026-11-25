/**
 * The Club tab for the committee and admins (src/components/home/club-hub.tsx):
 * five areas that open where they are, a count where work is waiting, and an
 * admin's search over settings and members. "The Club tab" in sections 3 and 10
 * of docs/user-guide.md.
 *
 * The real tabs render inside the real root layout with every other screen
 * swapped for a placeholder, as in home-by-role.test.tsx, which checks what
 * each role is given. These check how the Club tab lays that out, that every
 * link an admin has is in an area and opens a screen the guards let them into,
 * and that the search only ever offers what the member could already open.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import {
  personas,
  placeholderScreens,
  resetClub,
  setClubFeatures,
  signInAs,
  TODAY,
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
jest.mock('@/lib/log', () => ({ ...jest.requireActual('@/lib/log'), startAppLog: jest.fn() }));
jest.mock('@/components/brand-intro', () => ({ BrandIntro: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

const overrides = placeholderScreens('(tabs)/index', '(tabs)/club', '(tabs)/me');

/** The club has integrity training set, so the committee and admins have a card for it. */
const CLUB_TRAINING = { training_requirements: [{ id: 'req-1' }] };

const SEARCH = 'Find a member or a setting';

/** The club's members, as an admin's search is given them. */
const MEMBERS = [
  { id: 'm-jordan', full_name: 'Jordan Coach', email: 'jordan@example.com', role: 'coach', extra_roles: [], status: 'approved', join_requested_at: null },
  { id: 'm-alex', full_name: 'Alex Jordan', preferred_name: 'AJ', email: 'alex@example.com', role: 'athlete', extra_roles: ['coach'], status: 'approved', join_requested_at: null },
  { id: 'm-robin', full_name: 'Robin New', email: 'robin@example.com', role: 'athlete', extra_roles: [], status: 'pending', join_requested_at: '2026-10-17T01:00:00Z' },
  { id: 'm-casey', full_name: null, email: 'casey@example.com', role: 'athlete', extra_roles: [], status: 'pending', join_requested_at: null },
  { id: 'm-drew', full_name: 'Drew Declined', email: 'drew@example.com', role: 'athlete', extra_roles: [], status: 'rejected', join_requested_at: '2026-10-01T01:00:00Z' },
];

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Opens the app on the Club tab. `pending` is how many requests to join are
 * waiting; `members` is the list an admin's search loads.
 */
async function openClub(
  who: PersonaName | Persona,
  {
    pending = 0,
    members = MEMBERS,
    ...options
  }: BackendOptions & { pending?: number; members?: unknown[] } = {},
) {
  jest.useFakeTimers({ now: TODAY });
  memberListLoads = 0;
  signInAs(typeof who === 'string' ? personas[who] : who, CLUB_TRAINING, {
    ...options,
    tableHandlers: {
      profiles: (q) => {
        // The count of requests waiting (src/lib/use-pending-requests.ts).
        if (q.eq('status') === 'pending') return Array.from({ length: pending }, (_, i) => ({ id: `p${i}` }));
        // The search's list is the only query in name order.
        if (q.calls.some((c) => c.method === 'order')) {
          memberListLoads += 1;
          return members;
        }
        return undefined;
      },
      ...options.tableHandlers,
    },
  });
  await renderRouter({ appDir: 'src/app', overrides }, { initialUrl: '/club' });
  await settle();
  expect(screen).toHavePathname('/club');
}

/** How many times the list of members in name order (the search's) was asked for. */
let memberListLoads = 0;

const AREA_NAMES: Record<string, string> = {
  People: 'people',
  'Safety and conduct': 'safety',
  Season: 'season',
  'Reports and registers': 'reports',
  'Club setup': 'setup',
};

/** An area, and the row that opens it, by its name. */
const areaBox = (title: string) => screen.getByTestId(`club-area-${AREA_NAMES[title]}`);
const areaRow = (title: string) => within(areaBox(title)).getAllByRole('button')[0];
const isOpen = (title: string) => {
  const { props } = areaRow(title);
  return (props['aria-expanded'] ?? props.accessibilityState?.expanded) === true;
};

async function press(node: Parameters<typeof fireEvent.press>[0]) {
  await fireEvent.press(node);
  await settle();
}

async function type(text: string) {
  await fireEvent.changeText(screen.getByLabelText(SEARCH), text);
  await settle();
}

/** The count on a tab's button, or null with none. */
function badge(tab: string) {
  const button = screen.getByLabelText(new RegExp(`^${tab}, .*tab, \\d of \\d$`));
  const counts = within(button).queryAllByText(/^\d+$/);
  return counts.length > 0 ? String(counts[0].props.children) : null;
}

const AREAS = ['People', 'Safety and conduct', 'Season', 'Reports and registers', 'Club setup'];
const EVERYTHING_ON = { kpis: true, registers: true, selectionAssessments: true, chatGroups: true };

beforeEach(async () => {
  resetClub();
  await AsyncStorage.clear();
});

// ---------------------------------------------------------------------------
describe('an admin’s Club tab', () => {
  it('is five areas, each closed and saying what is inside', async () => {
    setClubFeatures(EVERYTHING_ON);
    await openClub('admin');
    for (const area of AREAS) expect(isOpen(area)).toBe(false);
    expect(screen.getByText('Members, check-ins, attendance and 5 more')).toBeTruthy();
    expect(
      screen.getByText('Concerns, safeguarding contacts, code of conduct and 2 more'),
    ).toBeTruthy();
    expect(screen.getByText('Reports, registers')).toBeTruthy();
    // Nothing inside an area shows until it is opened.
    for (const inside of ['Members', 'Concerns', 'Seasons', 'Registers', 'Club password']) {
      expect(screen.queryByText(inside)).toBeNull();
    }
    // The old single card is gone: its menu is in the areas.
    expect(screen.queryByText('Administration')).toBeNull();
  });

  it('an area opens where it is, and closes again', async () => {
    await openClub('admin');
    await press(areaRow('Club setup'));
    expect(isOpen('Club setup')).toBe(true);
    for (const inside of ['Club features', 'Club options', 'Club brand', 'Record keeping', 'Club password']) {
      expect(screen.getByText(inside)).toBeTruthy();
    }
    // Open, it no longer needs to say what is inside.
    expect(screen.queryByText(/^Features, options, brand and/)).toBeNull();
    // The others stay as they were.
    expect(isOpen('People')).toBe(false);
    expect(screen.queryByText('Members')).toBeNull();

    await press(areaRow('Club setup'));
    expect(isOpen('Club setup')).toBe(false);
    expect(screen.queryByText('Club password')).toBeNull();
    expect(screen.getByText(/^Features, options, brand and/)).toBeTruthy();
  });

  it('with nothing waiting, no area has a count and neither does the tab', async () => {
    await openClub('admin');
    expect(badge('Club')).toBeNull();
    expect(screen.queryByText(/waiting for approval/)).toBeNull();
  });

  it('an area with work waiting counts it and shows it under its row, without being opened', async () => {
    await openClub(
      { ...personas.admin, rpcs: { ...personas.admin.rpcs, new_concerns_count: 3 } },
      { pending: 2 },
    );
    expect(isOpen('People')).toBe(false);
    expect(within(areaRow('People')).getByText('2')).toBeTruthy();
    // Members is the one thing waiting in People, so it alone shows.
    expect(within(areaBox('People')).getByText('Members')).toBeTruthy();
    expect(within(areaBox('People')).getByText('2 requests waiting for approval')).toBeTruthy();
    expect(within(areaBox('People')).queryByText('Squads and teams')).toBeNull();
    expect(within(areaBox('Safety and conduct')).getByText('3 new concerns to look at')).toBeTruthy();
    expect(within(areaBox('Safety and conduct')).queryByText('Code of conduct')).toBeNull();
    // Areas with nothing waiting show nothing under their rows.
    expect(screen.queryByText('Club password')).toBeNull();
    // The tab's button counts all of it.
    expect(badge('Club')).toBe('5');
  });

  it('what is waiting opens from there, and the rest of its area with one more tap', async () => {
    await openClub('admin', { pending: 1 });
    await press(areaRow('People'));
    expect(isOpen('People')).toBe(true);
    for (const title of ['Members', 'Attendance', 'Squads and teams', 'Invite members']) {
      expect(within(areaBox('People')).getByText(title)).toBeTruthy();
    }
    // Members is there once, not twice.
    expect(screen.getAllByText('1 request waiting for approval')).toHaveLength(1);
    await press(screen.getByText('1 request waiting for approval'));
    expect(screen).toHavePathname('/admin');
  });

  it('opens Everything, A to Z from its foot', async () => {
    await openClub('admin');
    await press(screen.getByText('Everything, A to Z'));
    expect(screen).toHavePathname('/administration');
  });
});

// ---------------------------------------------------------------------------
// Every link an admin has, in its area, with the switch that shows it, and the
// screen it opens. A link that led to a screen the guards refuse would land on
// Today instead.
type AdminLink = { title: string; area: string; route: string; needs?: string[] };

const LINKS: AdminLink[] = [
  { title: 'Members', area: 'People', route: 'admin/index' },
  { title: 'Squads and teams', area: 'People', route: 'admin/squads' },
  { title: 'Invite members', area: 'People', route: 'admin/invite' },
  { title: 'Club captains', area: 'People', route: 'admin/captains', needs: ['messages'] },
  { title: 'Safeguarding', area: 'Safety and conduct', route: 'admin/safeguarding' },
  { title: 'Code of conduct', area: 'Safety and conduct', route: 'admin/conduct' },
  { title: 'Integrity training courses', area: 'Safety and conduct', route: 'admin/training/index', needs: ['integrity'] },
  { title: 'Seasons', area: 'Season', route: 'admin/seasons' },
  { title: 'Fixtures', area: 'Season', route: 'admin/fixtures', needs: ['calendar', 'awards', 'goals'] },
  { title: 'Games', area: 'Season', route: 'admin/games' },
  { title: 'Selection rounds and criteria', area: 'Season', route: 'admin/assessments/index', needs: ['selectionAssessments'] },
  { title: 'Awards', area: 'Season', route: 'admin/awards/index', needs: ['awards'] },
  { title: 'Season KPI reviews', area: 'Season', route: 'admin/kpi-reviews', needs: ['kpis'] },
  { title: 'Reports', area: 'Reports and registers', route: 'admin/reports/index' },
  { title: 'Club features', area: 'Club setup', route: 'admin/club/features' },
  { title: 'Club options', area: 'Club setup', route: 'admin/club/options' },
  { title: 'Club brand', area: 'Club setup', route: 'admin/club/brand' },
  { title: 'Calendars', area: 'Club setup', route: 'admin/calendars', needs: ['calendar'] },
  { title: 'Chat groups', area: 'Club setup', route: 'admin/chat-groups/index', needs: ['chatGroups'] },
  { title: 'Absence reasons', area: 'Club setup', route: 'admin/absence-reasons', needs: ['attendance'] },
  { title: 'Record keeping', area: 'Club setup', route: 'admin/club/records' },
  { title: 'Club password', area: 'Club setup', route: 'admin/club-password' },
];

const SWITCHES = [
  'messages',
  'chatGroups',
  'calendar',
  'checkIns',
  'injuries',
  'attendance',
  'sessionPlans',
  'surveys',
  'captainPolls',
  'awards',
  'goals',
  'integrity',
  'kpis',
  'registers',
  'selectionAssessments',
];
const EVERYTHING_OFF = Object.fromEntries(SWITCHES.map((f) => [f, false]));

describe('every link an admin has', () => {
  it.each(LINKS)('$title is in $area and opens $route', async ({ title, area, route }) => {
    setClubFeatures(EVERYTHING_ON);
    await openClub('admin');
    expect(screen.queryByText(title)).toBeNull();
    await press(areaRow(area));
    await press(within(areaBox(area)).getByText(title));
    expect(screen.getByText(`screen:${route}`)).toBeTruthy();
    expect(screen).toHavePathname('/' + route.replace(/\/index$/, ''));
  });

  it('with every feature off, only the links no switch controls are left', async () => {
    setClubFeatures(EVERYTHING_OFF);
    await openClub('admin');
    for (const row of screen.queryAllByRole('button', { expanded: false })) await press(row);
    for (const { title, needs } of LINKS) {
      if (needs) expect(screen.queryByText(title)).toBeNull();
      else expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
  });

  describe.each(LINKS.filter((l) => l.needs))('$title', ({ title, area, needs }) => {
    it.each(needs!)('shows while only %s is on', async (feature) => {
      // Chat groups sit inside Messages.
      const on = feature === 'chatGroups' ? { messages: true, chatGroups: true } : { [feature]: true };
      setClubFeatures({ ...EVERYTHING_OFF, ...on });
      await openClub('admin');
      // With little switched on, an area may hold one thing and show it as itself.
      if (screen.queryByTestId(`club-area-${AREA_NAMES[area]}`) && !isOpen(area)) {
        await press(areaRow(area));
      }
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
describe('a committee member’s Club tab', () => {
  it('has areas for what they are given, and none of the admin’s', async () => {
    await openClub('committee');
    expect(isOpen('People')).toBe(false);
    expect(screen.getByText('Check-ins, attendance, injuries and 1 more')).toBeTruthy();
    // One thing in an area is shown as itself.
    expect(screen.getByText('Integrity training')).toBeTruthy();
    expect(screen.getByText('Reports')).toBeTruthy();
    for (const area of ['Safety and conduct', 'Season', 'Reports and registers', 'Club setup']) {
      expect(screen.queryByText(area)).toBeNull();
    }
    await press(areaRow('People'));
    for (const title of ['Attendance', 'Check-ins', 'Injuries', 'Surveys']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    for (const { title } of LINKS.filter((l) => l.title !== 'Reports')) {
      expect(screen.queryByText(title)).toBeNull();
    }
  });

  it('with the registers on, Reports and registers is an area', async () => {
    setClubFeatures({ registers: true });
    await openClub('committee');
    await press(areaRow('Reports and registers'));
    await press(screen.getByText('Registers'));
    expect(screen).toHavePathname('/registers');
  });

  it('with five things or fewer, has them as they are and no areas', async () => {
    // The club left this member out of injuries: five things.
    await openClub('committeeNotChosen');
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
    expect(screen.queryByText('People')).toBeNull();
    for (const title of ['Attendance', 'Check-ins', 'Surveys', 'Integrity training', 'Reports']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('has no search, no A to Z, and never asks for the list of members', async () => {
    await openClub('committee');
    expect(screen.queryByLabelText(SEARCH)).toBeNull();
    expect(screen.queryByText('Everything, A to Z')).toBeNull();
    expect(memberListLoads).toBe(0);
  });

  it('a request to join isn’t theirs, so Club has no count for one', async () => {
    await openClub('committee', { pending: 3 });
    expect(badge('Club')).toBeNull();
    expect(screen.queryByText(/waiting for approval/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('an admin’s search', () => {
  const openForSearch = (options: Parameters<typeof openClub>[1] = {}) => openClub('admin', options);

  it('finds a setting by what it does, in place of the areas', async () => {
    await openForSearch();
    await type('time zone');
    expect(screen.getByText('In Club')).toBeTruthy();
    expect(screen.getByText('Club options')).toBeTruthy();
    for (const area of AREAS) expect(screen.queryByText(area)).toBeNull();
    await press(screen.getByText('Club options'));
    expect(screen).toHavePathname('/admin/club/options');
  });

  it('finds a card as well as a link, with its live line', async () => {
    await openForSearch();
    await type('attendance');
    expect(screen.getByText('Take attendance and see past sessions')).toBeTruthy();
    expect(screen.getByText('Reports')).toBeTruthy();
  });

  it('finds a member by name and opens their page', async () => {
    await openForSearch();
    await type('jordan');
    expect(screen.getByText('Members')).toBeTruthy();
    expect(screen.getByText('Jordan Coach')).toBeTruthy();
    expect(screen.getByText('Coach')).toBeTruthy();
    expect(screen.getByText('Alex Jordan')).toBeTruthy();
    expect(screen.getByText('Athlete, Coach')).toBeTruthy();
    await press(screen.getByText('Alex Jordan'));
    expect(screen).toHavePathname('/admin/m-alex');
  });

  it('finds a member by email, and says where someone not yet approved stands', async () => {
    await openForSearch();
    await type('robin@example.com');
    expect(screen.getByText('Robin New')).toBeTruthy();
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    await type('casey');
    // No name given yet: their email stands in.
    expect(screen.getByText('casey@example.com')).toBeTruthy();
    expect(screen.getByText('Signed in, no request yet')).toBeTruthy();
    await type('drew');
    expect(screen.getByText('Not approved')).toBeTruthy();
  });

  it('asks for the members once, and only once two letters are typed', async () => {
    await openForSearch();
    expect(memberListLoads).toBe(0);
    await type('j');
    expect(memberListLoads).toBe(0);
    await type('jo');
    expect(memberListLoads).toBe(1);
    await type('jor');
    await type('alex');
    expect(memberListLoads).toBe(1);
  });

  it('lists six members and says how many more there are', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i}`,
      full_name: `Sam Number${i}`,
      email: `sam${i}@example.com`,
      role: 'athlete',
      extra_roles: [],
      status: 'approved',
      join_requested_at: null,
    }));
    await openForSearch({ members: many });
    await type('sam');
    expect(screen.getAllByText(/^Sam Number\d$/)).toHaveLength(6);
    expect(
      screen.getByText('And 3 more. Type more of the name, or open Members to see everyone.'),
    ).toBeTruthy();
  });

  it('says so when nothing is found', async () => {
    await openForSearch();
    await type('zzzz');
    expect(screen.getByText(/^Nothing found for “zzzz”/)).toBeTruthy();
    expect(screen.queryByText('In Club')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
  });

  it('clearing the search brings the areas back as they were', async () => {
    await openForSearch();
    await press(areaRow('Season'));
    await type('password');
    expect(screen.queryByText('Season')).toBeNull();
    await press(screen.getByLabelText('Clear the search'));
    expect(screen.getByLabelText(SEARCH).props.value).toBe('');
    expect(isOpen('Season')).toBe(true);
    expect(isOpen('People')).toBe(false);
    expect(screen.queryByLabelText('Clear the search')).toBeNull();
  });

  it('never offers a link the club has switched off', async () => {
    setClubFeatures({ awards: false, calendar: false, goals: false });
    await openForSearch();
    await type('fixtures');
    expect(screen.queryByText('Fixtures')).toBeNull();
    await type('awards');
    expect(screen.queryByText('Create award votes, see results and copy annual awards')).toBeNull();
  });
});
