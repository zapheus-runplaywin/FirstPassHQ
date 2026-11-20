/**
 * What each role sees on the home screen (src/app/index.tsx), from the role
 * table in section 1 of docs/user-guide.md and the code's own rules.
 *
 * The real home screen renders inside the real root layout, with every other
 * screen swapped for a placeholder, and the real AuthProvider working out
 * each member's usable roles from a fake backend that returns nothing but the
 * member themselves (and, where a test says so, a few rows). Cards that only
 * show when the database has something for the member (awards open to them,
 * surveys sent to them, shared session plans, KPIs) are checked by seeding
 * that data, never assumed from the role.
 */
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

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

const overrides = placeholderScreens('index');

/** The club has integrity training set, so the committee and admins have a card for it. */
const CLUB_TRAINING = { training_requirements: [{ id: 'req-1' }] };

async function openHome(who: PersonaName | Persona, tables: Record<string, unknown[]> = CLUB_TRAINING) {
  jest.useFakeTimers({ now: TODAY });
  signInAs(typeof who === 'string' ? personas[who] : who, tables);
  await renderRouter({ appDir: 'src/app', overrides }, { initialUrl: '/' });
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  expect(screen).toHavePathname('/');
}

/** Each card or section, by text only it shows. */
const ITEMS = {
  messages: 'No new messages',
  sendSurveys: 'Send a survey and see results',
  dailyCheckIn: 'Not done yet today',
  checkIns: 'See how squads and teams are feeling',
  injuries: 'No current injuries',
  logInjuries: 'Log an injury at training or a game',
  takeAttendance: 'Take attendance and see past sessions',
  myAttendance: 'My attendance',
  integrity: 'Certificates and everyone’s progress',
  concerns: 'The concerns register',
  reports: 'The club’s checks, medical details checks, training, attendance and award results',
  administration: 'Administration',
  comingUp: 'Coming up',
  guardianOf: 'Guardian of',
  consent: 'Consent',
  whatsChanged: 'What’s changed',
  recordViews: 'Who has viewed their records',
  childGoals: 'Game goals and reflections',
  childAttendance: 'Their sessions, and tell their coaches if they’ll be away',
  childCheckIns: 'Their daily check-ins and notes from the last four weeks',
  groups: 'My squads and teams',
  raiseConcern: 'Raise a concern',
  waiting: 'Waiting for approval',
} as const;

type Item = keyof typeof ITEMS;
const ALL_ITEMS = Object.keys(ITEMS) as Item[];

function expectOnly(sees: Item[]) {
  const shown = ALL_ITEMS.filter((item) => screen.queryAllByText(ITEMS[item]).length > 0);
  expect(shown.sort()).toEqual([...sees].sort());
}

beforeEach(() => resetClub());

// ---------------------------------------------------------------------------
// Every card and section, role by role, with every feature on.

const BY_ROLE: { who: PersonaName; sees: Item[] }[] = [
  {
    who: 'athlete',
    sees: ['messages', 'dailyCheckIn', 'injuries', 'myAttendance', 'comingUp', 'groups', 'raiseConcern'],
  },
  {
    who: 'guardian',
    sees: [
      'messages',
      'injuries',
      'comingUp',
      'guardianOf',
      'childGoals',
      'consent',
      'childAttendance',
      'childCheckIns',
      'whatsChanged',
      'recordViews',
      'groups',
      'raiseConcern',
    ],
  },
  {
    who: 'coach',
    sees: [
      'messages',
      'sendSurveys',
      'checkIns',
      'injuries',
      'takeAttendance',
      'comingUp',
      'groups',
      'raiseConcern',
    ],
  },
  {
    // Managers don't see injuries (section 11), only log them, and only take attendance.
    who: 'manager',
    sees: ['messages', 'sendSurveys', 'logInjuries', 'takeAttendance', 'comingUp', 'groups', 'raiseConcern'],
  },
  {
    // Averages only; no surveys to send, no attendance.
    who: 'physio',
    sees: ['messages', 'checkIns', 'injuries', 'comingUp', 'groups', 'raiseConcern'],
  },
  {
    // Not in a squad, so no squads section.
    who: 'committee',
    sees: [
      'messages',
      'sendSurveys',
      'checkIns',
      'injuries',
      'takeAttendance',
      'integrity',
      'reports',
      'comingUp',
      'raiseConcern',
    ],
  },
  {
    // The reports name children: a committee member exempted with a reason
    // has no Reports card (customer review C14).
    who: 'committeeExempt',
    sees: ['messages', 'sendSurveys', 'checkIns', 'injuries', 'takeAttendance', 'integrity', 'comingUp', 'raiseConcern'],
  },
  {
    who: 'committeeBeforeChecksDate',
    sees: ['messages', 'sendSurveys', 'checkIns', 'injuries', 'takeAttendance', 'integrity', 'comingUp', 'raiseConcern'],
  },
  {
    // The club chose who on the committee sees injuries and left them out
    // (customer review R7): no Injuries card.
    who: 'committeeNotChosen',
    sees: ['messages', 'sendSurveys', 'checkIns', 'takeAttendance', 'integrity', 'reports', 'comingUp', 'raiseConcern'],
  },
  {
    who: 'committeeVolunteerExempt',
    sees: ['messages', 'sendSurveys', 'checkIns', 'injuries', 'takeAttendance', 'integrity', 'reports', 'comingUp', 'raiseConcern'],
  },
  {
    who: 'admin',
    sees: [
      'messages',
      'sendSurveys',
      'checkIns',
      'injuries',
      'takeAttendance',
      'integrity',
      'concerns',
      'administration',
      'comingUp',
      'raiseConcern',
    ],
  },
  {
    // An expired check doesn't pause the admin role.
    who: 'adminExpiredCheck',
    sees: [
      'messages',
      'sendSurveys',
      'checkIns',
      'injuries',
      'takeAttendance',
      'integrity',
      'concerns',
      'administration',
      'comingUp',
      'raiseConcern',
    ],
  },
  // Guests can only look: the calendar and squads.
  { who: 'guest', sees: ['comingUp', 'groups', 'raiseConcern'] },
  // Paused roles leave a guest: nothing the role gave, and no Administration.
  { who: 'stoodDownAdmin', sees: ['comingUp', 'groups', 'raiseConcern'] },
  { who: 'stoodDownCoach', sees: ['comingUp', 'groups', 'raiseConcern'] },
  { who: 'coachExpiredCheck', sees: ['comingUp', 'groups', 'raiseConcern'] },
  // Temporary helpers see only their onboarding steps and Raise a concern.
  { who: 'volunteer', sees: ['raiseConcern'] },
  // Studio on its own isn't a club member: what the role is for, and Raise a concern.
  { who: 'studio', sees: ['raiseConcern'] },
  { who: 'stoodDownStudio', sees: ['raiseConcern'] },
  { who: 'pending', sees: ['waiting', 'raiseConcern'] },
  { who: 'pendingAdmin', sees: ['waiting', 'raiseConcern'] },
  { who: 'rejected', sees: ['raiseConcern'] },
];

describe.each(BY_ROLE)('$who', ({ who, sees }) => {
  it(`sees only: ${sees.join(', ')}`, async () => {
    await openHome(who);
    expectOnly(sees);
  });

  it('has the app’s version and build at the foot, under Powered by', async () => {
    await openHome(who);
    expect(screen.getByLabelText('Powered by FirstPass HQ')).toBeTruthy();
    expect(screen.getByTestId('app-version')).toBeTruthy();
    expect(screen.getByText(/^Version /)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The order of the home screen (Matt, 2026-11-12): To do, Messages, Coming up,
// check-ins, attendance, Injuries, Session plans, Concerns, Administration
// (Reports for the committee), then the cards outside that list in their
// earlier order, the guardian and squad sections, and Raise a concern last.

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

describe('home screen order', () => {
  it('an athlete: To do, calendar, messages, check-in, attendance, injuries, then squads', async () => {
    await openHome('athlete');
    expectInOrder([
      'To do',
      'Messages',
      'Coming up',
      'Daily check-in',
      'My attendance',
      'Injuries',
      'My squads and teams',
      'Raise a concern',
    ]);
  });

  it('a coach: session plans after injuries, surveys after the main list', async () => {
    await openHome({
      ...personas.coach,
      rpcs: { session_plan_summary: [{ can_add: true, shared: 0, new_shared: 0 }] },
    });
    expectInOrder([
      'To do',
      'Messages',
      'Coming up',
      'Check-ins',
      'Attendance',
      'Injuries',
      'Session plans',
      'Surveys',
      'My squads and teams',
      'Raise a concern',
    ]);
  });

  it('an admin: Concerns then Administration, then surveys and integrity training', async () => {
    await openHome('admin');
    expectInOrder([
      'To do',
      'Messages',
      'Coming up',
      'Check-ins',
      'Attendance',
      'Injuries',
      'Concerns',
      'Administration',
      'Surveys',
      'Integrity training',
      'Raise a concern',
    ]);
  });

  it('a committee member: Reports where Administration would be', async () => {
    await openHome('committee');
    expectInOrder([
      'To do',
      'Messages',
      'Coming up',
      'Check-ins',
      'Attendance',
      'Injuries',
      'Reports',
      'Surveys',
      'Integrity training',
      'Raise a concern',
    ]);
  });

  it('an athlete who checks in and sees others’ check-ins has both together', async () => {
    const athleteCoach: Persona = {
      ...personas.coach,
      profile: { ...personas.coach.profile!, extra_roles: ['athlete'] },
    };
    await openHome(athleteCoach);
    const texts = textsInOrder();
    expect(texts.indexOf('Check-ins')).toBe(texts.indexOf('Daily check-in') + 2);
  });

  it('a guardian: the main cards, then their children, then squads', async () => {
    await openHome('guardian');
    expectInOrder([
      'To do',
      'Messages',
      'Coming up',
      'Injuries',
      'Guardian of',
      'Consent',
      'Attendance',
      'Check-ins',
      'What’s changed',
      'My squads and teams',
      'Raise a concern',
    ]);
  });
});

describe('administration and concerns', () => {
  it('only an approved admin has the Administration card, and it opens Administration', async () => {
    await openHome('admin');
    await fireEvent.press(screen.getByText(ITEMS.administration));
    await act(async () => {});
    expect(screen.getByText('screen:administration')).toBeTruthy();
    expect(screen).toHavePathname('/administration');
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

  it('a safeguarding officer who isn’t an admin has Concerns, but not Administration', async () => {
    await openHome({ ...personas.coach, isSafeguardingOfficer: true });
    expect(screen.getByText(ITEMS.concerns)).toBeTruthy();
    expect(screen.queryByText(ITEMS.administration)).toBeNull();
  });

  it('an admin who also coaches sees both Administration and their squads', async () => {
    const adminCoach: Persona = {
      ...personas.coach,
      profile: { ...personas.coach.profile!, role: 'admin', extra_roles: ['coach'] },
    };
    await openHome(adminCoach);
    expect(screen.getByText(ITEMS.administration)).toBeTruthy();
    expect(screen.getByText(ITEMS.groups)).toBeTruthy();
    expect(screen.getByText(ITEMS.takeAttendance)).toBeTruthy();
    expect(screen.getByText('Admin, Coach · Head Coach, Open A')).toBeTruthy();
  });
});

describe('reports', () => {
  it('a committee member with a check opens Reports from home', async () => {
    await openHome('committee');
    await fireEvent.press(screen.getByText('Reports'));
    await act(async () => {});
    expect(screen.getByText('screen:admin/reports/index')).toBeTruthy();
    expect(screen).toHavePathname('/admin/reports');
  });

  it('an admin reaches Reports from Administration, so has no Reports card on home', async () => {
    await openHome('admin');
    expect(screen.queryByText(ITEMS.reports)).toBeNull();
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
    expect(screen.queryByText(TEAM.name)).toBeNull();
    expect(screen.getByText('You are not in a squad yet.')).toBeTruthy();
  });

  it('a coach with a current check sees their team', async () => {
    await openHome('coach');
    expect(screen.queryByText('Coach paused')).toBeNull();
    expect(screen.getByText(TEAM.name)).toBeTruthy();
  });
});

describe('temporary helpers', () => {
  it('see the onboarding steps, none of the club’s features or members', async () => {
    await openHome('volunteer');
    expect(screen.getByText('You’re approved to help')).toBeTruthy();
    expect(screen.queryByText(/^To do$/)).toBeNull();
    expect(screen.queryByText(ITEMS.groups)).toBeNull();
  });
});

describe('Studio operators', () => {
  it('see what the role is for, none of the club’s features or members', async () => {
    await openHome('studio');
    expect(screen.getByText('You can show this club’s live game stats')).toBeTruthy();
    expect(screen.getByText(/Sign in to this club from FirstPass Studio/)).toBeTruthy();
    expect(screen.queryByText(/^To do$/)).toBeNull();
    expect(screen.queryByText(ITEMS.groups)).toBeNull();
    expect(screen.queryByText(ITEMS.comingUp)).toBeNull();
  });

  it('see that the role is paused while stood down', async () => {
    await openHome('stoodDownStudio');
    expect(screen.getByText('Your Studio role is paused')).toBeTruthy();
    expect(screen.queryByText('You can show this club’s live game stats')).toBeNull();
  });

  it('a manager who also runs Studio keeps their own Home', async () => {
    await openHome('managerStudio');
    expect(screen.queryByText('You can show this club’s live game stats')).toBeNull();
    expect(screen.getByText(ITEMS.comingUp)).toBeTruthy();
  });
});

describe('members waiting for approval', () => {
  it('see their code, and nothing of the club', async () => {
    await openHome('pending');
    expect(screen.getByText('Your code')).toBeTruthy();
    expect(screen.getByText('Edit request')).toBeTruthy();
    expect(screen.queryByText(/^To do$/)).toBeNull();
  });

  it('a member turned down sees why and can ask again', async () => {
    await openHome('rejected');
    expect(screen.getByText('Request not approved')).toBeTruthy();
    expect(screen.getByText('Request again')).toBeTruthy();
  });
});

describe('parents and guardians', () => {
  it('have one Guardian of card that opens their children and adding another', async () => {
    await openHome('guardian');
    // The link code and child-without-the-app forms live behind the card, not on Home.
    expect(screen.queryByText('Child’s code')).toBeNull();
    expect(screen.queryByText('Enter code')).toBeNull();
    expect(screen.queryByText('Child who won’t use the app')).toBeNull();
    await fireEvent.press(screen.getByText(ITEMS.guardianOf));
    await act(async () => {});
    expect(screen).toHavePathname('/children');
  });

  it('get a consent card for each child, and the consent to-do', async () => {
    await openHome('guardian');
    // And can add another child with their code.
    expect(screen.getByText('Add another child')).toBeTruthy();
    expect(screen.getByText(ITEMS.consent)).toBeTruthy();
    expect(screen.getByText('Check-ins: not given · Injuries: not given')).toBeTruthy();
    expect(screen.getByText('Give consent for Sample Child')).toBeTruthy();
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
    expect(screen.getByText('Injuries: yes')).toBeTruthy();
    expect(screen.queryByText(/^Check-ins:/)).toBeNull();
    expect(screen.queryByText('Give consent for Sample Child')).toBeNull();
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
    expect(screen.getByText('Check-ins: not given · Injuries: yes')).toBeTruthy();
  });

  it('with no child linked yet, are asked for their child’s link code, and see nothing of a child', async () => {
    await openHome({ ...personas.guardian, rpcs: { my_child_consents: [] } });
    expect(screen.getByText(/^Nobody yet\. Enter your child’s link code/)).toBeTruthy();
    expect(screen.getByText('Add your child')).toBeTruthy();
    for (const item of ['consent', 'whatsChanged', 'recordViews', 'childAttendance'] as Item[]) {
      expect(screen.queryByText(ITEMS[item])).toBeNull();
    }
  });

  it('only a verified guardian sees who has viewed their child’s records', async () => {
    await openHome({
      ...personas.guardian,
      profile: { ...personas.guardian.profile!, verified_at: null },
    });
    expect(screen.getByText(ITEMS.consent)).toBeTruthy();
    expect(screen.queryByText(ITEMS.recordViews)).toBeNull();
  });

  it('a guardian who isn’t approved sees none of their child’s cards', async () => {
    await openHome({
      ...personas.guardian,
      profile: { ...personas.guardian.profile!, status: 'pending' },
    });
    for (const item of ['guardianOf', 'consent', 'whatsChanged', 'recordViews'] as Item[]) {
      expect(screen.queryByText(ITEMS[item])).toBeNull();
    }
  });

  it('a coach who is also a guardian sees what each role would show', async () => {
    await openHome({
      ...personas.coach,
      profile: { ...personas.coach.profile!, extra_roles: ['guardian'] },
      rpcs: { my_child_consents: CHILD_CONSENTS },
    });
    expect(screen.getByText(ITEMS.takeAttendance)).toBeTruthy();
    expect(screen.getByText(ITEMS.consent)).toBeTruthy();
    expect(screen.getByText(ITEMS.guardianOf)).toBeTruthy();
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

  it('can send polls to their team while captains’ polls are on', async () => {
    await openHome(captain);
    expect(screen.getByText(ITEMS.sendSurveys)).toBeTruthy();
  });

  it('can’t once captains’ polls are off', async () => {
    setClubFeatures({ captainPolls: false });
    await openHome(captain);
    expect(screen.queryByText(ITEMS.sendSurveys)).toBeNull();
  });

  it('an athlete who isn’t a captain can’t send surveys', async () => {
    await openHome('athlete');
    expect(screen.queryByText(ITEMS.sendSurveys)).toBeNull();
  });
});

describe('cards that need something from the club', () => {
  it('members see Surveys only when there is one for them', async () => {
    await openHome({
      ...personas.athlete,
      rpcs: {
        my_surveys: [
          {
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
          },
        ],
      },
    });
    expect(screen.getByText('1 to answer')).toBeTruthy();
  });

  it('the committee and admins have no integrity card while the club has no training set', async () => {
    await openHome('admin', {});
    expect(screen.queryByText(ITEMS.integrity)).toBeNull();
  });

  it('coaches see Session plans only when the database lets them add one', async () => {
    await openHome({
      ...personas.coach,
      rpcs: { session_plan_summary: [{ can_add: true, shared: 0, new_shared: 0 }] },
    });
    expect(screen.getByText('Add a plan before or after a session')).toBeTruthy();
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
// Feature switches: a feature that's off disappears for every role.

describe('feature switches', () => {
  const cases: { feature: string; who: PersonaName; item: Item }[] = [
    { feature: 'messages', who: 'admin', item: 'messages' },
    { feature: 'messages', who: 'athlete', item: 'messages' },
    { feature: 'surveys', who: 'admin', item: 'sendSurveys' },
    { feature: 'surveys', who: 'coach', item: 'sendSurveys' },
    { feature: 'checkIns', who: 'admin', item: 'checkIns' },
    { feature: 'checkIns', who: 'coach', item: 'checkIns' },
    { feature: 'checkIns', who: 'athlete', item: 'dailyCheckIn' },
    { feature: 'checkIns', who: 'guardian', item: 'childCheckIns' },
    { feature: 'injuries', who: 'admin', item: 'injuries' },
    { feature: 'injuries', who: 'athlete', item: 'injuries' },
    { feature: 'injuries', who: 'manager', item: 'logInjuries' },
    { feature: 'attendance', who: 'admin', item: 'takeAttendance' },
    { feature: 'attendance', who: 'coach', item: 'takeAttendance' },
    { feature: 'attendance', who: 'athlete', item: 'myAttendance' },
    { feature: 'attendance', who: 'guardian', item: 'childAttendance' },
    { feature: 'calendar', who: 'admin', item: 'comingUp' },
    { feature: 'calendar', who: 'guest', item: 'comingUp' },
    { feature: 'integrity', who: 'admin', item: 'integrity' },
    { feature: 'integrity', who: 'committee', item: 'integrity' },
    { feature: 'goals', who: 'guardian', item: 'childGoals' },
  ];

  it.each(cases)('$feature off: $who has no "$item"', async ({ feature, who, item }) => {
    setClubFeatures({ [feature]: false });
    await openHome(who);
    expect(screen.queryByText(ITEMS[item])).toBeNull();
  });

  it.each(cases)('$feature on: $who has "$item"', async ({ feature, who, item }) => {
    setClubFeatures({ [feature]: true });
    await openHome(who);
    expect(screen.getAllByText(ITEMS[item]).length).toBeGreaterThan(0);
  });

  it('turning goals off keeps the guardian’s card for their child', async () => {
    setClubFeatures({ goals: false });
    await openHome('guardian');
    expect(screen.getByText(ITEMS.guardianOf)).toBeTruthy();
    expect(screen.getByText(ITEMS.consent)).toBeTruthy();
  });

  it('session plans off hides the card even when the database would let a coach add one', async () => {
    setClubFeatures({ sessionPlans: false });
    await openHome({
      ...personas.coach,
      rpcs: { session_plan_summary: [{ can_add: true, shared: 2, new_shared: 1 }] },
    });
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
    await openHome(voter);
    expect(screen.getByText('1 vote waiting for you')).toBeTruthy();
    setClubFeatures({ awards: false });
    await openHome(voter);
    expect(screen.queryByText('1 vote waiting for you')).toBeNull();
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
    await openHome(withKpis);
    expect(screen.queryByText('Season KPIs')).toBeNull();
    setClubFeatures({ kpis: true });
    await openHome(withKpis);
    expect(screen.getByText('Season KPIs')).toBeTruthy();
    expect(screen.getByText('2 of yours')).toBeTruthy();
  });

  it('the registers stay hidden until an admin turns them on', async () => {
    setClubFeatures({});
    await openHome('committee');
    expect(screen.queryByText('The club’s policies and conflicts of interest')).toBeNull();
    setClubFeatures({ registers: true });
    await openHome('admin');
    expect(screen.getByText('The club’s policies and conflicts of interest')).toBeTruthy();
  });

  it('a committee member opens the registers from home', async () => {
    setClubFeatures({ registers: true });
    await openHome('committee');
    await fireEvent.press(screen.getByText('The club’s policies and conflicts of interest'));
    await act(async () => {});
    expect(screen.getByText('screen:registers/index')).toBeTruthy();
    expect(screen).toHavePathname('/registers');
  });

  it('coaches, athletes and parents have no registers card', async () => {
    setClubFeatures({ registers: true });
    for (const who of ['coach', 'athlete', 'guardian'] as const) {
      await openHome(who);
      expect(screen.queryByText('The club’s policies and conflicts of interest')).toBeNull();
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

  it.each(['coach', 'committee', 'athlete', 'guardian'] as const)(
    'a %s who doesn’t handle concerns has no lights',
    async (who) => {
      await openHome({ ...personas[who], rpcs: { ...personas[who].rpcs, ...COUNTS } });
      expect(screen.queryByTestId('concern-lights')).toBeNull();
    },
  );

  it('a new concern is an Urgent to-do at the top of the list', async () => {
    await openHome({ ...personas.admin, rpcs: { ...personas.admin.rpcs, new_concerns_count: 1 } });
    expect(screen.getByText('Look at 1 new concern')).toBeTruthy();
    expect(screen.getAllByText('Urgent').length).toBeGreaterThan(0);
  });
});
