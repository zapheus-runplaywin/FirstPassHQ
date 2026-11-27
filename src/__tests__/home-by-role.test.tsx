/**
 * What each role sees in the tabs (src/app/(tabs)): which tabs they have, and
 * what is on Today, in their hub (Team, Family or Club) and in Me, from the
 * role table in section 1 of docs/user-guide.md and the code's own rules.
 *
 * The real tabs render inside the real root layout, with every other screen
 * (Calendar and Messages included) swapped for a placeholder, and the real AuthProvider working out
 * each member's usable roles from a fake backend that returns nothing but the
 * member themselves (and, where a test says so, a few rows). Cards that only
 * show when the database has something for the member (awards open to them,
 * surveys sent to them, shared session plans, KPIs) are checked by seeding
 * that data, never assumed from the role.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import { argsOf, rpcNames } from './helpers/forms';
import {
  CHILD_CONSENTS,
  personas,
  placeholderScreens,
  resetClub,
  setClubFeatures,
  signInAs,
  TEAM,
  TODAY,
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

// The first test of the file renders the whole app cold; on a busy CI runner that
// passed 5 seconds (PR #320). The other screen test files allow 20.
jest.setTimeout(20000);

const overrides = placeholderScreens(
  '(tabs)/index',
  '(tabs)/team',
  '(tabs)/family',
  '(tabs)/club',
  '(tabs)/me',
  // A parent's child: opened from the child's card in Family.
  'child/[id]',
);

/** The club has integrity training set, so the committee and admins have a card for it. */
const CLUB_TRAINING = { training_requirements: [{ id: 'req-1' }] };

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Opens the app for a member on one tab: Today unless `url` names another. */
async function openTab(
  who: PersonaName | Persona,
  url = '/',
  tables: Record<string, unknown[]> = CLUB_TRAINING,
) {
  jest.useFakeTimers({ now: TODAY });
  signInAs(typeof who === 'string' ? personas[who] : who, tables);
  await renderRouter({ appDir: 'src/app', overrides }, { initialUrl: url });
  await settle();
  expect(screen).toHavePathname(url);
  if (url === '/club') await openAreas();
}

/**
 * Opens every area of the Club tab that is closed, so what is inside each can
 * be checked. The areas themselves are checked in club-hub.test.tsx.
 */
async function openAreas() {
  for (const area of screen.queryAllByRole('button', { expanded: false })) {
    await fireEvent.press(area);
  }
  await settle();
}

/** Opens the app on Today. */
const openHome = (who: PersonaName | Persona, tables?: Record<string, unknown[]>) =>
  openTab(who, '/', tables);

/** Switches tab, as tapping it in the bar does. */
async function goTo(url: string) {
  await act(async () => {
    router.navigate(url);
  });
  await settle();
  expect(screen).toHavePathname(url);
  if (url === '/club') await openAreas();
}

/** The tabs in the bar, left to right. None for someone who keeps one screen. */
function tabBar(): string[] {
  return screen
    .queryAllByLabelText(/, tab, \d of \d$/)
    .map((tab) => String(tab.props.accessibilityLabel).replace(/, tab, \d of \d$/, ''));
}

/** Each card or section, by text only it shows. */
const ITEMS = {
  nextUp: 'Next up',
  sendSurveys: 'Send a survey and see results',
  dailyCheckIn: 'Not done yet today',
  checkIns: 'See how squads and teams are feeling',
  injuries: 'No current injuries',
  logInjuries: 'Log an injury at training or a game',
  takeAttendance: 'Take attendance and see past sessions',
  myAttendance: 'My attendance',
  integrity: 'Certificates and everyone’s progress',
  concerns: 'The concerns register',
  // On Today the register leads as the safeguarding panel, with its work in it (redesign item 10).
  safeguardingPanel: 'Concerns register',
  reports: 'Checks, medical details, training, attendance and awards',
  // The admin's own menu, in the Club tab's areas: something only it has.
  adminMenu: 'New members need it to ask to join',
  guardianOf: 'Guardian of',
  // With a child linked: one card for each child, and adding another.
  child: 'Sample Child',
  addChild: 'Add another child',
  consent: 'Consent',
  whatsChanged: 'What’s changed',
  recordViews: 'Who has viewed their records',
  childGoals: 'Goals and reflections',
  childAttendance: 'Their sessions and absences',
  childCheckIns: 'Check-ins and notes, last four weeks',
  groups: 'My squads and teams',
  yourDetails: 'Your details',
  yourTasks: 'Your own list of things to remember',
  contacts: 'If a child is in danger now, call 000.',
  signOut: 'Sign out',
  switchClub: 'Switch club',
  deleteAccount: 'Delete account',
  myAccount: 'My account',
  waiting: 'Waiting for approval',
} as const;

type Item = keyof typeof ITEMS;
const ALL_ITEMS = Object.keys(ITEMS) as Item[];

/** What is on the tab being looked at (a tab that isn't showing is hidden from the queries). */
function expectOnly(sees: Item[]) {
  const shown = ALL_ITEMS.filter((item) => screen.queryAllByText(ITEMS[item]).length > 0);
  expect(shown.sort()).toEqual([...sees].sort());
}

/**
 * Me always has the member's details, tasks, the safety contacts and their
 * account. Delete account lives inside My account, not on the tab, so it isn't
 * tapped by mistake for Switch club or Sign out.
 */
const ME: Item[] = ['yourDetails', 'yourTasks', 'contacts', 'myAccount', 'signOut', 'switchClub'];
/** The one screen keeps its account links at the foot. */
const ONE_SCREEN_LINKS: Item[] = ['yourDetails', 'signOut', 'switchClub', 'deleteAccount'];

beforeEach(async () => {
  resetClub();
  // The hub a member last opened is remembered on the device.
  await AsyncStorage.clear();
});

// ---------------------------------------------------------------------------
// Every card and section, role by role, with every feature on: which tabs the
// member has, and what is on Today, in their hub and in Me. Everything the one
// Home screen used to show a role is in one of them (the lists below are that
// screen's cards, moved; Messages and the calendar became tabs).

type Hub = 'team' | 'family' | 'club';

const BY_ROLE: {
  who: PersonaName;
  tabs: string[];
  /** Today, besides Next up and the list of what needs them. */
  today?: Item[];
  hubs?: Partial<Record<Hub, Item[]>>;
  /** Me, besides what everyone has there. */
  me?: Item[];
}[] = [
  {
    who: 'athlete',
    tabs: ['Today', 'Calendar', 'Messages', 'Team', 'Me'],
    hubs: { team: ['groups'] },
    me: ['dailyCheckIn', 'myAttendance', 'injuries'],
  },
  {
    who: 'guardian',
    tabs: ['Today', 'Calendar', 'Messages', 'Family', 'Me'],
    hubs: {
      // What each child has (consent, attendance, game goals and the rest)
      // is on the child's own page, opened from their card.
      family: ['child', 'injuries', 'groups', 'addChild'],
    },
  },
  {
    who: 'coach',
    tabs: ['Today', 'Calendar', 'Messages', 'Team', 'Me'],
    hubs: { team: ['groups', 'checkIns', 'takeAttendance', 'injuries', 'sendSurveys'] },
  },
  {
    // Managers don't see injuries (section 11), only log them, and only take attendance.
    who: 'manager',
    tabs: ['Today', 'Calendar', 'Messages', 'Team', 'Me'],
    hubs: { team: ['groups', 'takeAttendance', 'logInjuries', 'sendSurveys'] },
  },
  {
    // Averages only; no surveys to send, no attendance.
    who: 'physio',
    tabs: ['Today', 'Calendar', 'Messages', 'Team', 'Me'],
    hubs: { team: ['groups', 'checkIns', 'injuries'] },
  },
  {
    // Not in a squad, so no Team hub and no squads section.
    who: 'committee',
    tabs: ['Today', 'Calendar', 'Messages', 'Club', 'Me'],
    hubs: {
      club: ['checkIns', 'takeAttendance', 'injuries', 'reports', 'sendSurveys', 'integrity'],
    },
  },
  {
    // The reports name children: a committee member exempted with a reason
    // has no Reports card (customer review C14).
    who: 'committeeExempt',
    tabs: ['Today', 'Calendar', 'Messages', 'Club', 'Me'],
    hubs: { club: ['checkIns', 'takeAttendance', 'injuries', 'sendSurveys', 'integrity'] },
  },
  {
    who: 'committeeBeforeChecksDate',
    tabs: ['Today', 'Calendar', 'Messages', 'Club', 'Me'],
    hubs: { club: ['checkIns', 'takeAttendance', 'injuries', 'sendSurveys', 'integrity'] },
  },
  {
    // The club chose who on the committee sees injuries and left them out
    // (customer review R7): no Injuries card.
    who: 'committeeNotChosen',
    tabs: ['Today', 'Calendar', 'Messages', 'Club', 'Me'],
    hubs: { club: ['checkIns', 'takeAttendance', 'reports', 'sendSurveys', 'integrity'] },
  },
  {
    who: 'committeeVolunteerExempt',
    tabs: ['Today', 'Calendar', 'Messages', 'Club', 'Me'],
    hubs: {
      club: ['checkIns', 'takeAttendance', 'injuries', 'reports', 'sendSurveys', 'integrity'],
    },
  },
  {
    who: 'admin',
    tabs: ['Today', 'Calendar', 'Messages', 'Club', 'Me'],
    // Safeguarding work leads Today, and is in the Club hub too.
    today: ['safeguardingPanel'],
    hubs: {
      club: [
        'concerns',
        'checkIns',
        'takeAttendance',
        'injuries',
        'adminMenu',
        'sendSurveys',
        'integrity',
      ],
    },
  },
  {
    // An expired check doesn't pause the admin role.
    who: 'adminExpiredCheck',
    tabs: ['Today', 'Calendar', 'Messages', 'Club', 'Me'],
    today: ['safeguardingPanel'],
    hubs: {
      club: [
        'concerns',
        'checkIns',
        'takeAttendance',
        'injuries',
        'adminMenu',
        'sendSurveys',
        'integrity',
      ],
    },
  },
  // Guests can only look: the calendar, and their squads in Me. No messages, no hub.
  { who: 'guest', tabs: ['Today', 'Calendar', 'Me'], me: ['groups'] },
  // Paused roles leave a guest: nothing the role gave, and no Club or Team hub.
  { who: 'stoodDownAdmin', tabs: ['Today', 'Calendar', 'Me'], me: ['groups'] },
  { who: 'stoodDownCoach', tabs: ['Today', 'Calendar', 'Me'], me: ['groups'] },
  { who: 'coachExpiredCheck', tabs: ['Today', 'Calendar', 'Me'], me: ['groups'] },
];

describe.each(BY_ROLE)('$who', ({ who, tabs, today = [], hubs = {}, me = [] }) => {
  it(`has the tabs ${tabs.join(', ')}`, async () => {
    await openHome(who);
    expect(tabBar()).toEqual(tabs);
  });

  it(`sees on Today only: ${['what’s next and what needs them', ...today].join(', ')}`, async () => {
    await openHome(who);
    expectOnly(['nextUp', ...today]);
    expect(screen.getByTestId('needs-you')).toBeTruthy();
    // Raise a concern is at the top of every tab.
    expect(screen.getByText('Raise a concern')).toBeTruthy();
  });

  for (const [hub, sees] of Object.entries(hubs)) {
    it(`sees in ${hub} only: ${sees.join(', ')}`, async () => {
      await openTab(who, `/${hub}`);
      expectOnly(sees);
      expect(screen.getByText('Raise a concern')).toBeTruthy();
    });
  }

  it(`has no hub but ${Object.keys(hubs).join(', ') || 'none'}: the others send them back to Today`, async () => {
    for (const hub of (['team', 'family', 'club'] as Hub[]).filter((h) => !(h in hubs))) {
      jest.useFakeTimers({ now: TODAY });
      signInAs(personas[who], CLUB_TRAINING);
      await renderRouter({ appDir: 'src/app', overrides }, { initialUrl: `/${hub}` });
      await settle();
      expect(screen).toHavePathname('/');
    }
  }, 20000);

  it(`sees in Me only: ${['their details, tasks, safety contacts and account', ...me].join(', ')}`, async () => {
    await openTab(who, '/me');
    expectOnly([...ME, ...me]);
    // At the top of the tab, and first under Safety.
    expect(screen.getAllByText('Raise a concern')).toHaveLength(2);
  });

  // Matt, 26 November 2026: no FirstPass logo inside the app; the app icon and
  // the opening screen carry the brand. The version stays where a tester can
  // find it, at the foot of Me.
  it('has no FirstPass logo on any tab, and the app’s version and build at the foot of Me only', async () => {
    await openHome(who);
    expect(screen.queryByLabelText('Powered by FirstPass HQ')).toBeNull();
    expect(screen.queryByText('Powered by')).toBeNull();
    expect(screen.queryByTestId('app-version')).toBeNull();
    for (const hub of Object.keys(hubs)) {
      await openTab(who, `/${hub}`);
      expect(screen.queryByText('Powered by')).toBeNull();
      expect(screen.queryByTestId('app-version')).toBeNull();
    }
    await openTab(who, '/me');
    expect(screen.queryByLabelText('Powered by FirstPass HQ')).toBeNull();
    expect(screen.queryByText('Powered by')).toBeNull();
    expect(screen.getByTestId('app-version')).toBeTruthy();
    expect(screen.getByText(/^Version /)).toBeTruthy();
  }, 20000);
});

// People with one job to do keep one screen and no tab bar.
const ONE_SCREEN: { who: PersonaName; sees: Item[] }[] = [
  // Temporary helpers see only their onboarding steps and Raise a concern.
  { who: 'volunteer', sees: [] },
  // Studio on its own isn't a club member: what the role is for, and Raise a concern.
  { who: 'studio', sees: [] },
  { who: 'stoodDownStudio', sees: [] },
  { who: 'pending', sees: ['waiting'] },
  { who: 'pendingAdmin', sees: ['waiting'] },
  { who: 'rejected', sees: [] },
];

describe.each(ONE_SCREEN)('$who', ({ who, sees }) => {
  it(`keeps one screen with no tab bar, and sees only: ${['Raise a concern', ...sees].join(', ')}`, async () => {
    await openHome(who);
    expect(tabBar()).toEqual([]);
    expectOnly([...sees, ...ONE_SCREEN_LINKS]);
    expect(screen.getByText('Raise a concern')).toBeTruthy();
  });

  it('has the app’s version and build at the foot, and no FirstPass logo', async () => {
    await openHome(who);
    expect(screen.queryByLabelText('Powered by FirstPass HQ')).toBeNull();
    expect(screen.queryByText('Powered by')).toBeNull();
    expect(screen.getByTestId('app-version')).toBeTruthy();
    expect(screen.getByText(/^Version /)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The order of each tab. Today: what is next, then what needs you. A hub: its
// lead (squads, or the children), then the cards in the order Home had them
// (Matt, 2026-11-12): check-ins, attendance, Injuries, Session plans,
// Concerns, Administration (Reports for the committee), then the rest. Club
// groups what it holds into areas (item 7 of the redesign).

/** Every piece of text on the screen, top to bottom. */
function textsInOrder(): string[] {
  const texts: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string') {
      texts.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (typeof node === 'object' && 'children' in node) {
      walk((node as { children: unknown }).children);
    }
  };
  walk(screen.toJSON());
  return texts;
}

/** Each heading is on the screen, and they come in this order. */
function expectInOrder(headings: string[]) {
  const texts = textsInOrder();
  const found = headings.map((h) => [h, texts.indexOf(h)] as const);
  expect(found.filter(([, i]) => i < 0).map(([h]) => h)).toEqual([]);
  const sorted = [...found].sort((a, b) => a[1] - b[1]).map(([h]) => h);
  expect(sorted).toEqual(headings);
}

describe('the order of each tab', () => {
  it('Today: Raise a concern at the top, then what is next, then what needs you', async () => {
    await openHome('athlete');
    expectInOrder(['Raise a concern', 'Next up', 'Needs you']);
  });

  it('an admin’s Today leads with Safeguarding, ahead of what is next', async () => {
    await openHome('admin');
    expectInOrder(['Raise a concern', 'Safeguarding', 'Next up', 'Needs you']);
  });

  // Cards lead with where things stand (HQ redesign, item 6).
  it('an athlete’s My attendance says how many sessions they were at, asking only about themselves', async () => {
    await openTab(
      { ...personas.athlete, rpcs: { ...personas.athlete.rpcs, athlete_attendance: [{ present: true }, { present: false }] } },
      '/me',
    );
    expect(screen.getByText('At 1 of 2 sessions in 4 weeks')).toBeTruthy();
    expect(argsOf('athlete_attendance').map((args) => args?.p_profile_id)).toEqual(['athlete']);
  });

  it('with no sessions yet, My attendance says what it opens', async () => {
    await openTab('athlete', '/me');
    expect(screen.getByText('Your sessions and absences')).toBeTruthy();
  });

  it.each<PersonaName>(['coach', 'manager', 'guardian', 'committee', 'admin', 'physio', 'guest'])(
    '%s, with no My attendance card, isn’t asked the database for attendance',
    async (who) => {
      await openTab(who, '/me');
      expect(screen.queryByText('My attendance')).toBeNull();
      expect(rpcNames()).not.toContain('athlete_attendance');
    },
  );

  it('an athlete’s Me: details, check-in, attendance, injuries, tasks, safety, then account', async () => {
    await openTab('athlete', '/me');
    expectInOrder([
      'Your details',
      'Daily check-in',
      'My attendance',
      'Injuries',
      'Your tasks',
      'Safety',
      'Account',
      'My account',
      'Switch club',
      'Sign out',
    ]);
  });

  it('a coach’s Team: check-ins, attendance, injuries, then session plans, surveys, and their squads last', async () => {
    await openTab(
      {
        ...personas.coach,
        rpcs: { session_plan_summary: [{ can_add: true, shared: 0, new_shared: 0 }] },
      },
      '/team',
    );
    expectInOrder([
      'Check-ins',
      'Attendance',
      'Injuries',
      'Session plans',
      'Surveys',
      'My squads and teams',
    ]);
  });

  it('an admin’s Club: People, Safety and conduct, Season, Reports, then Club setup', async () => {
    await openTab('admin', '/club');
    expectInOrder([
      'People',
      'Members',
      'Check-ins',
      'Attendance',
      'Injuries',
      'Surveys',
      'Safety and conduct',
      'Concerns',
      'Code of conduct',
      'Integrity training',
      'Season',
      'Seasons',
      // The registers are off, so Reports is the only thing in its area and shows as itself.
      'Reports',
      'Club setup',
      'Club features',
      'Club password',
    ]);
  });

  it('a committee member’s Club: People, then integrity training and Reports as they are', async () => {
    await openTab('committee', '/club');
    expectInOrder(['People', 'Check-ins', 'Attendance', 'Injuries', 'Surveys', 'Integrity training', 'Reports']);
    // An area with one thing in it is that thing, and the committee has no admin's menu.
    expect(screen.queryByText('Safety and conduct')).toBeNull();
    expect(screen.queryByText('Reports and registers')).toBeNull();
    expect(screen.queryByText('Club setup')).toBeNull();
  });

  it('an athlete who also coaches checks in from Me, and sees others’ check-ins in Team', async () => {
    const athleteCoach: Persona = {
      ...personas.coach,
      profile: { ...personas.coach.profile!, extra_roles: ['athlete'] },
    };
    await openTab(athleteCoach, '/me');
    expect(screen.getByText(ITEMS.dailyCheckIn)).toBeTruthy();
    expect(screen.queryByText(ITEMS.checkIns)).toBeNull();
    await goTo('/team');
    expect(screen.getByText(ITEMS.checkIns)).toBeTruthy();
    expect(screen.queryByText(ITEMS.dailyCheckIn)).toBeNull();
  });

  it('a guardian’s Family: their children first, then the rest, squads, and adding a child last', async () => {
    await openTab('guardian', '/family');
    expectInOrder(['Sample Child', 'Injuries', 'My squads and teams', 'Add another child']);
  });

  it('a child’s page: day to day first, then consent and medical, then who has been near their records', async () => {
    await openTab('guardian', '/child/child-1');
    expectInOrder([
      'Attendance',
      'Game goals',
      'Check-ins',
      'Injuries',
      'Consent',
      'Medical and emergency',
      'What’s changed',
      'Who has viewed their records',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Someone with two jobs has two hubs: one button in the bar, a switch at the
// top of the hub, and the bar remembers the one they last opened.

describe('more than one hub', () => {
  const adminCoach: Persona = {
    ...personas.coach,
    profile: { ...personas.coach.profile!, role: 'admin', extra_roles: ['coach'] },
  };
  const coachParent: Persona = {
    ...personas.coach,
    profile: { ...personas.coach.profile!, extra_roles: ['guardian'] },
    rpcs: { my_child_consents: CHILD_CONSENTS },
  };

  /** The switch at the top of a hub: each hub in it, and the one selected. */
  function hubSwitch() {
    return ['Team', 'Family', 'Club'].flatMap((hub) =>
      screen.queryAllByRole('tab', { name: hub }).map((tab) => ({
        hub,
        selected: !!tab.props.accessibilityState?.selected,
      })),
    );
  }

  it('the bar shows the hub for their main role first', async () => {
    await openHome(adminCoach);
    expect(tabBar()).toEqual(['Today', 'Calendar', 'Messages', 'Club', 'Me']);
    await openHome(coachParent);
    expect(tabBar()).toEqual(['Today', 'Calendar', 'Messages', 'Team', 'Me']);
  });

  it('the switch at the top of a hub opens the other, and the bar follows', async () => {
    await openTab(coachParent, '/team');
    expect(hubSwitch()).toEqual([
      { hub: 'Team', selected: true },
      { hub: 'Family', selected: false },
    ]);
    await fireEvent.press(screen.getByRole('tab', { name: 'Family' }));
    await settle();
    expect(screen).toHavePathname('/family');
    expect(tabBar()).toEqual(['Today', 'Calendar', 'Messages', 'Family', 'Me']);
    expect(screen.getByText(ITEMS.child)).toBeTruthy();
  });

  it('remembers the hub last opened, the next time the app opens', async () => {
    await openTab(coachParent, '/family');
    await openHome(coachParent);
    expect(tabBar()).toEqual(['Today', 'Calendar', 'Messages', 'Family', 'Me']);
  });

  it('remembers it for that member only', async () => {
    await openTab(coachParent, '/family');
    // Another coach-parent on the same phone starts on their own main hub.
    const session = coachParent.session!;
    await openHome({
      ...coachParent,
      session: { ...session, user: { ...session.user, id: 'another-coach-parent' } },
      profile: { ...coachParent.profile!, id: 'another-coach-parent' },
    });
    expect(tabBar()).toEqual(['Today', 'Calendar', 'Messages', 'Team', 'Me']);
  });

  it('someone with one hub has no switch', async () => {
    await openTab('coach', '/team');
    expect(hubSwitch()).toEqual([]);
  });

  it('a hub that isn’t theirs sends them back to Today', async () => {
    jest.useFakeTimers({ now: TODAY });
    signInAs(personas.coach, CLUB_TRAINING);
    await renderRouter({ appDir: 'src/app', overrides }, { initialUrl: '/club' });
    await settle();
    expect(screen).toHavePathname('/');
    expect(screen.queryByText(ITEMS.adminMenu)).toBeNull();
  });

  it('an admin who also coaches has the admin’s menu in Club and their squads in Team', async () => {
    await openHome(adminCoach);
    expect(screen.getByText('Admin, Coach · Head Coach, Open A')).toBeTruthy();
    await goTo('/club');
    expect(screen.getByText(ITEMS.adminMenu)).toBeTruthy();
    expect(screen.getByText(ITEMS.takeAttendance)).toBeTruthy();
    await goTo('/team');
    expect(screen.getByText(ITEMS.groups)).toBeTruthy();
    expect(screen.getByText(ITEMS.takeAttendance)).toBeTruthy();
    expect(screen.queryByText(ITEMS.adminMenu)).toBeNull();
  });

  it('a coach who is also a guardian has what each role would show', async () => {
    await openTab(coachParent, '/team');
    expect(screen.getByText(ITEMS.takeAttendance)).toBeTruthy();
    expect(screen.queryByText(ITEMS.child)).toBeNull();
    expect(screen.queryByText(ITEMS.addChild)).toBeNull();
    await goTo('/family');
    expect(screen.getByText(ITEMS.child)).toBeTruthy();
    expect(screen.getByText(ITEMS.addChild)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The counts on the tab bar: unread messages, and what has changed for a
// parent's children.

describe('counts on the tabs', () => {
  /** The count on a tab's button, or null with none. */
  function badge(tab: string) {
    const button = screen.getByLabelText(new RegExp(`^${tab}, .*tab, \\d of \\d$`));
    const counts = within(button).queryAllByText(/^\d+$/);
    return counts.length > 0 ? String(counts[0].props.children) : null;
  }

  const UNREAD = [{ message_id: 'm1' }, { message_id: 'm2' }];

  it('Messages counts the messages the member hasn’t opened', async () => {
    await openHome('athlete', { ...CLUB_TRAINING, message_recipients: UNREAD });
    expect(badge('Messages')).toBe('2');
  });

  it('Messages has no count with nothing unread', async () => {
    await openHome('athlete');
    expect(badge('Messages')).toBeNull();
  });

  it('Family counts what has changed for a parent’s children since they last looked', async () => {
    await openHome({
      ...personas.guardian,
      rpcs: {
        ...personas.guardian.rpcs,
        child_activity_new: [
          { athlete_id: 'child-1', new_count: 2 },
          { athlete_id: 'child-2', new_count: 1 },
        ],
      },
    });
    expect(badge('Family')).toBe('3');
    await goTo('/family');
    // And the same count sits on that child's "What's changed".
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('Family has no count with nothing new', async () => {
    await openHome('guardian');
    expect(badge('Family')).toBeNull();
  });

  // Club counts the work waiting in its areas: club-hub.test.tsx.
  it('Team never carries a count', async () => {
    await openHome('coach', { ...CLUB_TRAINING, message_recipients: UNREAD });
    expect(badge('Team')).toBeNull();
  });
});

describe('an empty hub', () => {
  it('says so, instead of showing nothing', async () => {
    // A committee member with every feature the Club hub holds switched off.
    setClubFeatures({
      checkIns: false,
      attendance: false,
      injuries: false,
      surveys: false,
      integrity: false,
    });
    await openTab('committeeExempt', '/club');
    expect(screen.getByText('Nothing for the club yet.')).toBeTruthy();
  });
});

describe('administration and concerns', () => {
  it('only an approved admin has the admin’s menu in Club, and Everything, A to Z opens it as one list', async () => {
    await openTab('admin', '/club');
    expect(screen.getByText(ITEMS.adminMenu)).toBeTruthy();
    await fireEvent.press(screen.getByText('Everything, A to Z'));
    await act(async () => {});
    expect(screen.getByText('screen:administration')).toBeTruthy();
    expect(screen).toHavePathname('/administration');
  });

  it('nobody but an admin is offered Everything, A to Z', async () => {
    await openTab('committee', '/club');
    expect(screen.queryByText('Everything, A to Z')).toBeNull();
    expect(screen.queryByText(ITEMS.adminMenu)).toBeNull();
  });

  it('shows the safeguarding posts a member holds under their roles', async () => {
    await openHome({
      ...personas.coach,
      isSafeguardingOfficer: true,
      rpcs: {
        my_safeguarding_posts: {
          child_safety_officer: true,
          complaints_manager: false,
          wwc_registration_officer: true,
        },
      },
    });
    expect(screen.getByText('Coach · Head Coach, Open A')).toBeTruthy();
    expect(screen.getByTestId('home-titles')).toHaveTextContent(
      'Child Safety Officer · WWC Registration Officer',
    );
  });

  it('shows a Complaints Manager’s title too', async () => {
    await openHome({
      ...personas.manager,
      isSafeguardingOfficer: true,
      rpcs: { my_safeguarding_posts: { complaints_manager: true } },
    });
    expect(screen.getByTestId('home-titles')).toHaveTextContent('Complaints Manager');
  });

  it('a safeguarding officer who isn’t an admin has Safeguarding on Today, but no Club hub', async () => {
    await openHome({ ...personas.coach, isSafeguardingOfficer: true });
    expect(screen.getByTestId('safeguarding-panel')).toBeTruthy();
    expect(screen.getByTestId('concern-lights')).toBeTruthy();
    expect(tabBar()).toEqual(['Today', 'Calendar', 'Messages', 'Team', 'Me']);
    await goTo('/team');
    expect(screen.queryByText(ITEMS.adminMenu)).toBeNull();
  });

  it('the Safeguarding panel opens the register', async () => {
    await openHome('admin');
    await fireEvent.press(screen.getByText(ITEMS.safeguardingPanel));
    await act(async () => {});
    expect(screen).toHavePathname('/concerns');
  });

  it('a coach a concern was escalated to by name has Safeguarding, chased by reference only', async () => {
    await openHome({
      ...personas.coach,
      rpcs: {
        has_escalated_concerns: true,
        my_concern_clocks: [
          { concern_id: 'c1', reference: 'C-0007', stage: 'urgent', clock_from: '2026-10-01T00:00:00Z', escalated: true },
        ],
      },
    });
    const panel = within(screen.getByTestId('safeguarding-panel'));
    expect(panel.getByText('C-0007 is urgent: nothing recorded for too long')).toBeTruthy();
    expect(panel.getByText('Escalated to you')).toBeTruthy();
  });

  it('a coach with nothing escalated has no Concerns, and isn’t chased', async () => {
    await openHome({
      ...personas.coach,
      rpcs: {
        my_concern_clocks: [
          { concern_id: 'c1', reference: 'C-0007', stage: 'urgent', clock_from: '2026-10-01T00:00:00Z', escalated: true },
        ],
      },
    });
    expect(screen.queryByTestId('safeguarding-panel')).toBeNull();
    expect(screen.queryByText(/C-0007/)).toBeNull();
  });

  it('chases the lead about a concern with nothing recorded for too long', async () => {
    await openHome({
      ...personas.coach,
      isSafeguardingOfficer: true,
      rpcs: {
        my_concern_clocks: [
          { concern_id: 'c1', reference: 'C-0009', stage: 'important', clock_from: '2026-10-01T00:00:00Z', escalated: false },
        ],
      },
    });
    expect(screen.getByText('C-0009 has had nothing recorded for a while')).toBeTruthy();
    expect(screen.getByText('You lead this concern')).toBeTruthy();
  });
});

describe('reports', () => {
  it('a committee member with a check opens Reports from Club', async () => {
    await openTab('committee', '/club');
    await fireEvent.press(screen.getByText('Reports'));
    await act(async () => {});
    expect(screen.getByText('screen:admin/reports/index')).toBeTruthy();
    expect(screen).toHavePathname('/admin/reports');
  });

  it('an admin opens Reports from Reports and registers in Club, and has no second Reports card', async () => {
    await openTab('admin', '/club');
    expect(screen.queryByText(ITEMS.reports)).toBeNull();
    expect(screen.getAllByText('Reports')).toHaveLength(1);
    await fireEvent.press(screen.getByText('Governance and compliance reports to save as PDFs'));
    await act(async () => {});
    expect(screen).toHavePathname('/admin/reports');
  });
});

describe('paused roles', () => {
  it('a stood-down admin is told their role is paused, without the reason', async () => {
    await openHome('stoodDownAdmin');
    expect(screen.getByText('Admin paused')).toBeTruthy();
    expect(
      screen.getByText('Your admin role is paused by a club admin. Talk to a club admin about it.'),
    ).toBeTruthy();
    expect(screen.getByText('Admin (paused)')).toBeTruthy();
  });

  it('a coach with an expired check is told to renew it, and loses their squad', async () => {
    await openHome('coachExpiredCheck');
    expect(screen.getByText('Coach paused')).toBeTruthy();
    expect(screen.getByText(/Your Working With Children Check has expired/)).toBeTruthy();
    await goTo('/me');
    expect(screen.queryByText(TEAM.name)).toBeNull();
    expect(screen.getByText('You are not in a squad yet.')).toBeTruthy();
  });

  it('a coach with a current check sees their team', async () => {
    await openHome('coach');
    expect(screen.queryByText('Coach paused')).toBeNull();
    await goTo('/team');
    expect(screen.getByText(TEAM.name)).toBeTruthy();
  });
});

describe('temporary helpers', () => {
  it('see the onboarding steps, none of the club’s features or members', async () => {
    await openHome('volunteer');
    expect(screen.getByText('You’re approved to help')).toBeTruthy();
    expect(screen.queryByText('Needs you')).toBeNull();
    expect(screen.queryByText(ITEMS.nextUp)).toBeNull();
    expect(screen.queryByText(ITEMS.groups)).toBeNull();
  });
});

describe('Studio operators', () => {
  it('see what the role is for, none of the club’s features or members', async () => {
    await openHome('studio');
    expect(screen.getByText('You can show this club’s live game stats')).toBeTruthy();
    expect(screen.getByText(/Sign in to this club from FirstPass Studio/)).toBeTruthy();
    expect(screen.queryByText('Needs you')).toBeNull();
    expect(screen.queryByText(ITEMS.groups)).toBeNull();
    expect(screen.queryByText(ITEMS.nextUp)).toBeNull();
  });

  it('see that the role is paused while stood down', async () => {
    await openHome('stoodDownStudio');
    expect(screen.getByText('Your Studio role is paused')).toBeTruthy();
    expect(screen.queryByText('You can show this club’s live game stats')).toBeNull();
  });

  it('a manager who also runs Studio keeps their own tabs', async () => {
    await openHome('managerStudio');
    expect(screen.queryByText('You can show this club’s live game stats')).toBeNull();
    expect(screen.getByText(ITEMS.nextUp)).toBeTruthy();
    expect(tabBar()).toEqual(['Today', 'Calendar', 'Messages', 'Team', 'Me']);
  });
});

describe('members waiting for approval', () => {
  it('see their code, and nothing of the club', async () => {
    await openHome('pending');
    expect(screen.getByText('Your code')).toBeTruthy();
    expect(screen.getByText('Edit request')).toBeTruthy();
    expect(screen.queryByText('Needs you')).toBeNull();
    expect(screen.queryByText(ITEMS.nextUp)).toBeNull();
  });

  it('a member turned down sees why and can ask again', async () => {
    await openHome('rejected');
    expect(screen.getByText('Request not approved')).toBeTruthy();
    expect(screen.getByText('Request again')).toBeTruthy();
  });

  it.each(['/team', '/family', '/club', '/me'])('are sent back from %s to their one screen', async (url) => {
    jest.useFakeTimers({ now: TODAY });
    signInAs(personas.pending, CLUB_TRAINING);
    await renderRouter({ appDir: 'src/app', overrides }, { initialUrl: url });
    await settle();
    expect(screen).toHavePathname('/');
    expect(screen.getByText('Your code')).toBeTruthy();
  });
});

describe('parents and guardians', () => {
  it('have one card that opens their children and adding another', async () => {
    await openTab('guardian', '/family');
    // The link code and child-without-the-app forms live behind the card, not in the hub.
    expect(screen.queryByText('Child’s code')).toBeNull();
    expect(screen.queryByText('Enter code')).toBeNull();
    expect(screen.queryByText('Child who won’t use the app')).toBeNull();
    await fireEvent.press(screen.getByText(ITEMS.addChild));
    await act(async () => {});
    expect(screen).toHavePathname('/children');
  });

  it('have one card for each child, which opens the child’s page', async () => {
    await openTab('guardian', '/family');
    // What each child has is on their page, not repeated in the hub.
    for (const item of ['consent', 'whatsChanged', 'recordViews', 'childAttendance'] as Item[]) {
      expect(screen.queryByText(ITEMS[item])).toBeNull();
    }
    await fireEvent.press(screen.getByText(ITEMS.child));
    await settle();
    expect(screen).toHavePathname('/child/child-1');
    for (const item of ['consent', 'whatsChanged', 'recordViews', 'childAttendance'] as Item[]) {
      expect(screen.getByText(ITEMS[item])).toBeTruthy();
    }
  });

  it('see where consent stands on each child’s card in Family, and the consent to-do on Today', async () => {
    await openHome('guardian');
    expect(screen.getByText('Give consent for Sample Child')).toBeTruthy();
    await goTo('/family');
    // And can add another child with their code.
    expect(screen.getByText('Add another child')).toBeTruthy();
    expect(screen.getByText(ITEMS.child)).toBeTruthy();
    expect(screen.getByText('Check-ins: not given · Injuries: not given')).toBeTruthy();
  });

  it('aren’t asked for check-in consent while Daily check-ins is off for their child', async () => {
    await openHome({
      ...personas.guardian,
      rpcs: {
        my_child_consents: [
          {
            ...CHILD_CONSENTS[0],
            health: true,
            check_ins_on: false,
            needs_consent: false,
          },
        ],
      },
    });
    expect(screen.queryByText('Give consent for Sample Child')).toBeNull();
    await goTo('/family');
    expect(screen.getByText('Injuries: yes')).toBeTruthy();
    expect(screen.queryByText(/^Check-ins:/)).toBeNull();
  });

  it('are asked only for health consent while check-ins are off, and told so', async () => {
    await openHome({
      ...personas.guardian,
      rpcs: {
        my_child_consents: [{ ...CHILD_CONSENTS[0], check_ins_on: false, needs_consent: true }],
      },
    });
    expect(screen.getByText('Give consent for Sample Child')).toBeTruthy();
    expect(screen.getByText('Choose who sees their injury and medical details')).toBeTruthy();
  });

  it('are asked again once check-ins are back on, if they never gave check-in consent', async () => {
    await openHome({
      ...personas.guardian,
      rpcs: {
        my_child_consents: [
          {
            ...CHILD_CONSENTS[0],
            health: true,
            check_ins_on: true,
            needs_consent: true,
          },
        ],
      },
    });
    expect(screen.getByText('Give consent for Sample Child')).toBeTruthy();
    expect(screen.getByText('Choose who sees their check-ins')).toBeTruthy();
    await goTo('/family');
    expect(screen.getByText('Check-ins: not given · Injuries: yes')).toBeTruthy();
  });

  it('with no child linked yet, are asked for their child’s link code, and see nothing of a child', async () => {
    await openTab({ ...personas.guardian, rpcs: { my_child_consents: [] } }, '/family');
    expect(screen.getByText(/^Nobody yet\. Enter your child’s link code/)).toBeTruthy();
    expect(screen.getByText('Add your child')).toBeTruthy();
    for (const item of ['consent', 'whatsChanged', 'recordViews', 'childAttendance'] as Item[]) {
      expect(screen.queryByText(ITEMS[item])).toBeNull();
    }
  });

  it('only a verified guardian sees who has viewed their child’s records', async () => {
    await openTab(
      {
        ...personas.guardian,
        profile: { ...personas.guardian.profile!, verified_at: null },
      },
      '/child/child-1',
    );
    expect(screen.getByText(ITEMS.consent)).toBeTruthy();
    expect(screen.queryByText(ITEMS.recordViews)).toBeNull();
    expect(screen.queryByText('Medical and emergency')).toBeNull();
  });

  it('a guardian who isn’t approved keeps one screen, with none of their child’s cards', async () => {
    await openHome({
      ...personas.guardian,
      profile: { ...personas.guardian.profile!, status: 'pending' },
    });
    expect(tabBar()).toEqual([]);
    for (const item of ['guardianOf', 'child', 'addChild', 'consent', 'whatsChanged', 'recordViews'] as Item[]) {
      expect(screen.queryByText(ITEMS[item])).toBeNull();
    }
  });
});

describe('captains', () => {
  const captain: Persona = {
    ...personas.athlete,
    captaincies: [{ team_id: TEAM.id, profile_id: 'athlete', captain_role: 'captain' }],
  };

  it('shows their captaincy as a title under their role', async () => {
    await openHome(captain);
    expect(screen.getByText('Athlete')).toBeTruthy();
    expect(screen.getByTestId('home-titles')).toHaveTextContent('Captain, Open A');
  });

  it('shows Club Captain first for a club captain', async () => {
    await openHome({ ...captain, isClubCaptain: true });
    expect(screen.getByTestId('home-titles')).toHaveTextContent('Club Captain · Captain, Open A');
  });

  it('shows no titles line for an athlete who captains nothing', async () => {
    await openHome('athlete');
    expect(screen.queryByTestId('home-titles')).toBeNull();
  });

  it('can send polls to their team from Team while captains’ polls are on', async () => {
    await openTab(captain, '/team');
    expect(screen.getByText(ITEMS.sendSurveys)).toBeTruthy();
  });

  it('can’t once captains’ polls are off', async () => {
    setClubFeatures({ captainPolls: false });
    await openTab(captain, '/team');
    expect(screen.queryByText(ITEMS.sendSurveys)).toBeNull();
    await goTo('/me');
    expect(screen.queryByText(ITEMS.sendSurveys)).toBeNull();
  });

  it('an athlete who isn’t a captain can’t send surveys', async () => {
    await openTab('athlete', '/team');
    expect(screen.queryByText(ITEMS.sendSurveys)).toBeNull();
    await goTo('/me');
    expect(screen.queryByText(ITEMS.sendSurveys)).toBeNull();
  });
});

describe('cards that need something from the club', () => {
  const SURVEY = {
    id: 's1',
    title: 'Training nights',
    identity: 'named',
    opens_at: '2026-10-10T00:00:00Z',
    closes_at: '2026-10-25T00:00:00Z',
    created_by_name: 'Sample coach',
    for_child_names: null,
    from_child: false,
    responded: false,
    is_open: true,
    everyone_answers: false,
  };

  it('members see Surveys in Me only when there is one for them', async () => {
    await openTab({ ...personas.athlete, rpcs: { my_surveys: [SURVEY] } }, '/me');
    expect(screen.getByText('1 to answer')).toBeTruthy();
    await openTab('athlete', '/me');
    expect(screen.queryByText('Surveys')).toBeNull();
  });

  it('a coach with a survey to answer has Surveys in Me as well as in Team', async () => {
    await openTab({ ...personas.coach, rpcs: { my_surveys: [SURVEY] } }, '/me');
    expect(screen.getByText('Surveys')).toBeTruthy();
    await goTo('/team');
    expect(screen.getByText('Surveys')).toBeTruthy();
  });

  it('the committee and admins have no integrity card while the club has no training set', async () => {
    await openTab('admin', '/club', {});
    expect(screen.queryByText(ITEMS.integrity)).toBeNull();
  });

  it('coaches see Session plans in Team only when the database lets them add one', async () => {
    await openTab(
      {
        ...personas.coach,
        rpcs: { session_plan_summary: [{ can_add: true, shared: 0, new_shared: 0 }] },
      },
      '/team',
    );
    expect(screen.getByText('Add a plan before or after a session')).toBeTruthy();
    await openTab('coach', '/team');
    expect(screen.queryByText('Session plans')).toBeNull();
  });

  it('a guardian has a to-do for an injury a coach logged for their child, until they open it', async () => {
    const LOGGED = {
      injury_id: 'inj-9',
      athlete_id: 'child-1',
      athlete_name: 'Sample Child',
      body_area: 'Knee',
      logged_by_name: 'Sample coach',
      logged_by_role: 'coach',
      logged_at: '2026-10-18T01:00:00Z',
    };
    await openHome({ ...personas.guardian, rpcs: { ...personas.guardian.rpcs, my_logged_injuries: [LOGGED] } });
    expect(screen.getByText('Look at the injury Sample coach logged for Sample Child')).toBeTruthy();
  });

  it('injuries off leaves no logged-injury to-do', async () => {
    setClubFeatures({ injuries: false });
    await openHome({
      ...personas.guardian,
      rpcs: {
        ...personas.guardian.rpcs,
        my_logged_injuries: [
          { injury_id: 'inj-9', athlete_id: 'child-1', athlete_name: 'Sample Child', body_area: 'Knee', logged_by_name: 'Sample coach', logged_by_role: 'coach', logged_at: '2026-10-18T01:00:00Z' },
        ],
      },
    });
    expect(screen.queryByText(/^Look at the injury/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Feature switches: a feature that's off disappears for every role, from
// whichever tab it lives in.

describe('feature switches', () => {
  const cases: { feature: string; who: PersonaName; item: Item; tab: string }[] = [
    { feature: 'surveys', who: 'admin', item: 'sendSurveys', tab: '/club' },
    { feature: 'surveys', who: 'coach', item: 'sendSurveys', tab: '/team' },
    { feature: 'checkIns', who: 'admin', item: 'checkIns', tab: '/club' },
    { feature: 'checkIns', who: 'coach', item: 'checkIns', tab: '/team' },
    { feature: 'checkIns', who: 'athlete', item: 'dailyCheckIn', tab: '/me' },
    { feature: 'checkIns', who: 'guardian', item: 'childCheckIns', tab: '/child/child-1' },
    { feature: 'injuries', who: 'admin', item: 'injuries', tab: '/club' },
    { feature: 'injuries', who: 'athlete', item: 'injuries', tab: '/me' },
    { feature: 'injuries', who: 'manager', item: 'logInjuries', tab: '/team' },
    { feature: 'attendance', who: 'admin', item: 'takeAttendance', tab: '/club' },
    { feature: 'attendance', who: 'coach', item: 'takeAttendance', tab: '/team' },
    { feature: 'attendance', who: 'athlete', item: 'myAttendance', tab: '/me' },
    { feature: 'attendance', who: 'guardian', item: 'childAttendance', tab: '/child/child-1' },
    { feature: 'calendar', who: 'admin', item: 'nextUp', tab: '/' },
    { feature: 'calendar', who: 'guest', item: 'nextUp', tab: '/' },
    { feature: 'integrity', who: 'admin', item: 'integrity', tab: '/club' },
    { feature: 'integrity', who: 'committee', item: 'integrity', tab: '/club' },
    { feature: 'goals', who: 'guardian', item: 'childGoals', tab: '/child/child-1' },
  ];

  it.each(cases)('$feature off: $who has no "$item" in $tab', async ({ feature, who, item, tab }) => {
    setClubFeatures({ [feature]: false });
    await openTab(who, tab);
    expect(screen.queryByText(ITEMS[item])).toBeNull();
  });

  it.each(cases)('$feature on: $who has "$item" in $tab', async ({ feature, who, item, tab }) => {
    setClubFeatures({ [feature]: true });
    await openTab(who, tab);
    expect(screen.getAllByText(ITEMS[item]).length).toBeGreaterThan(0);
  });

  const tabCases: { feature: string; who: PersonaName; tab: string }[] = [
    { feature: 'messages', who: 'admin', tab: 'Messages' },
    { feature: 'messages', who: 'athlete', tab: 'Messages' },
    { feature: 'calendar', who: 'admin', tab: 'Calendar' },
    { feature: 'calendar', who: 'guest', tab: 'Calendar' },
  ];

  it.each(tabCases)('$feature off: $who has no $tab tab', async ({ feature, who, tab }) => {
    setClubFeatures({ [feature]: false });
    await openHome(who);
    expect(tabBar()).not.toContain(tab);
  });

  it.each(tabCases)('$feature on: $who has the $tab tab', async ({ feature, who, tab }) => {
    setClubFeatures({ [feature]: true });
    await openHome(who);
    expect(tabBar()).toContain(tab);
  });

  it('a guest never has the Messages tab', async () => {
    setClubFeatures({ messages: true });
    await openHome('guest');
    expect(tabBar()).not.toContain('Messages');
  });

  it('turning goals off keeps the guardian’s card for their child', async () => {
    setClubFeatures({ goals: false });
    await openTab('guardian', '/family');
    expect(screen.getByText(ITEMS.child)).toBeTruthy();
    await goTo('/child/child-1');
    expect(screen.getByText(ITEMS.consent)).toBeTruthy();
    expect(screen.queryByText(ITEMS.childGoals)).toBeNull();
  });

  it('session plans off hides the card even when the database would let a coach add one', async () => {
    setClubFeatures({ sessionPlans: false });
    await openTab(
      {
        ...personas.coach,
        rpcs: { session_plan_summary: [{ can_add: true, shared: 2, new_shared: 1 }] },
      },
      '/team',
    );
    expect(screen.queryByText(/Session plans/)).toBeNull();
  });

  it('awards off hides the Awards card and vote even with a vote open', async () => {
    const voter: Persona = {
      ...personas.athlete,
      rpcs: {
        award_slots: [
          {
            award_id: 'award-1',
            award_name: 'Best and fairest',
            description: '',
            points: [3, 2, 1],
            nominees: [],
            team_id: null,
            team_name: null,
            fixture_id: null,
            fixture_label: null,
            preseason: false,
            closes_at: '2026-10-25T00:00:00Z',
            voted: false,
          },
        ],
      },
    };
    await openTab(voter, '/me');
    expect(screen.getByText('1 vote waiting for you')).toBeTruthy();
    setClubFeatures({ awards: false });
    await openTab(voter, '/me');
    expect(screen.queryByText('1 vote waiting for you')).toBeNull();
    await goTo('/');
    expect(screen.queryByText(/Best and fairest/)).toBeNull();
  });

  it('Season KPIs stay hidden until an admin turns them on', async () => {
    const withKpis: Persona = {
      ...personas.athlete,
      rpcs: {
        season_kpi_people: [
          { profile_id: 'athlete', relation: 'self', kpi_count: 2, archived: false },
        ],
      },
    };
    setClubFeatures({});
    await openTab(withKpis, '/me');
    expect(screen.queryByText('Season KPIs')).toBeNull();
    setClubFeatures({ kpis: true });
    await openTab(withKpis, '/me');
    expect(screen.getByText('Season KPIs')).toBeTruthy();
    expect(screen.getByText('2 of yours')).toBeTruthy();
  });

  it('the registers stay hidden until an admin turns them on', async () => {
    setClubFeatures({});
    await openTab('committee', '/club');
    expect(screen.queryByText('Policies and conflicts of interest')).toBeNull();
    setClubFeatures({ registers: true });
    await openTab('admin', '/club');
    expect(screen.getByText('Policies and conflicts of interest')).toBeTruthy();
  });

  it('a committee member opens the registers from Club', async () => {
    setClubFeatures({ registers: true });
    await openTab('committee', '/club');
    await fireEvent.press(screen.getByText('Policies and conflicts of interest'));
    await act(async () => {});
    expect(screen.getByText('screen:registers/index')).toBeTruthy();
    expect(screen).toHavePathname('/registers');
  });

  it('coaches, athletes and parents have no registers card in any tab', async () => {
    setClubFeatures({ registers: true });
    for (const [who, hub] of [
      ['coach', '/team'],
      ['athlete', '/team'],
      ['guardian', '/family'],
    ] as const) {
      await openHome(who);
      expect(screen.queryByText('Policies and conflicts of interest')).toBeNull();
      for (const url of [hub, '/me']) {
        await goTo(url);
        expect(screen.queryByText('Policies and conflicts of interest')).toBeNull();
      }
    }
  }, 20000);

  it('a coach is asked to declare conflicts of interest, and a policy owner to review their policy, only while the registers are on', async () => {
    const asked: Persona = {
      ...personas.coach,
      rpcs: {
        my_conflict_declaration: [
          { required: true, season: 2026, has_conflict: null, details: null, declared_at: null },
        ],
        my_policy_reviews: [{ id: 'p1', title: 'Privacy Policy', review_on: '2026-11-01' }],
      },
    };
    setClubFeatures({});
    await openHome(asked);
    expect(screen.queryByText('Declare any conflicts of interest')).toBeNull();
    expect(screen.queryByText('Review the Privacy Policy')).toBeNull();
    setClubFeatures({ registers: true });
    await openHome(asked);
    expect(screen.getByText('Declare any conflicts of interest')).toBeTruthy();
    expect(screen.getByText('Review the Privacy Policy')).toBeTruthy();
  });
});

describe('concern traffic lights', () => {
  const COUNTS = { concern_counts: [{ new_count: 2, in_progress_count: 3, closed_recent_count: 0 }] };

  it('an admin sees red, orange and green counts on the Concerns card, with words', async () => {
    await openHome({ ...personas.admin, rpcs: { ...personas.admin.rpcs, ...COUNTS } });
    const lights = screen.getByTestId('concern-lights');
    expect(lights.props.accessibilityLabel).toBe('2 new, 3 in progress, 0 closed in the last 4 weeks');
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Closed, 4 weeks')).toBeTruthy();
  });

  it('and on the same card in Club', async () => {
    await openTab({ ...personas.admin, rpcs: { ...personas.admin.rpcs, ...COUNTS } }, '/club');
    expect(screen.getByTestId('concern-lights').props.accessibilityLabel).toBe(
      '2 new, 3 in progress, 0 closed in the last 4 weeks',
    );
  });

  it('a safeguarding officer who isn’t an admin sees them too', async () => {
    await openHome({
      ...personas.coach,
      isSafeguardingOfficer: true,
      rpcs: { ...personas.coach.rpcs, ...COUNTS },
    });
    expect(screen.getByTestId('concern-lights').props.accessibilityLabel).toBe(
      '2 new, 3 in progress, 0 closed in the last 4 weeks',
    );
  });

  it('shows zeros, not an error, before any concern is raised', async () => {
    await openHome('admin');
    expect(screen.getByTestId('concern-lights').props.accessibilityLabel).toBe(
      '0 new, 0 in progress, 0 closed in the last 4 weeks',
    );
    expect(screen.queryByText('Urgent')).toBeNull();
  });

  it.each([
    ['coach', '/team'],
    ['committee', '/club'],
    ['athlete', '/team'],
    ['guardian', '/family'],
  ] as const)('a %s who doesn’t handle concerns has no lights, on Today or in %s', async (who, hub) => {
    await openHome({ ...personas[who], rpcs: { ...personas[who].rpcs, ...COUNTS } });
    expect(screen.queryByTestId('concern-lights')).toBeNull();
    await goTo(hub);
    expect(screen.queryByTestId('concern-lights')).toBeNull();
  });

  it('a new concern is an Urgent to-do at the top of the list', async () => {
    await openHome({ ...personas.admin, rpcs: { ...personas.admin.rpcs, new_concerns_count: 1 } });
    expect(screen.getByText('Look at 1 new concern')).toBeTruthy();
    expect(screen.getAllByText('Urgent').length).toBeGreaterThan(0);
  });
});
