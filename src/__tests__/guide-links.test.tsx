/**
 * The user guide links (src/lib/guides.ts): the Help section of the Me tab
 * offers the guide for each role a member holds, and the two kinds of member
 * with one screen and a role (a temporary helper, a child waiting for their
 * parent) get a User guide link at its foot. Everyone else on one screen
 * (waiting to join, refused, Studio only) has no role's guide to read.
 *
 * The real tabs render inside the real root layout, as in home-by-role.test.tsx.
 * The sample club has no edition of its own, so the links go to the FirstPass
 * HQ edition; which club reads which edition is checked in guides.test.ts.
 */
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { personas, placeholderScreens, signInAs, TODAY, type PersonaName } from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () =>
  jest.requireActual('./helpers/harness').clubChoiceModuleMock(),
);
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({
    on: true,
    permission: 'granted',
    save: jest.fn(),
  })),
  openNotificationSettings: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@/lib/log', () => ({
  ...jest.requireActual('@/lib/log'),
  startAppLog: jest.fn(),
}));
jest.mock('@/components/brand-intro', () => ({ BrandIntro: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
}));

// Today and Me are real; every other screen is a placeholder.
const overrides = placeholderScreens('(tabs)/index', '(tabs)/me');

const BASE = 'https://zapheus-runplaywin.github.io/FirstPassHQ/guides/generic';

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(who: PersonaName, url: string) {
  jest.useFakeTimers({ now: TODAY });
  signInAs(personas[who]);
  await renderRouter({ appDir: 'src/app', overrides }, { initialUrl: url });
  await settle();
  expect(screen).toHavePathname(url);
}

let openURL: jest.SpyInstance;
beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => {
  openURL.mockRestore();
  jest.useRealTimers();
});

/** The guide cards on the screen, by their titles, top to bottom. */
const guideCards = () =>
  screen.queryAllByText(/^Guide for /).map((node) => String(node.props.children));

const IN_ME: { who: PersonaName; guides: [title: string, file: string][] }[] = [
  { who: 'athlete', guides: [['Guide for athletes', 'athletes']] },
  { who: 'minorAthlete', guides: [['Guide for athletes', 'athletes']] },
  {
    who: 'guardian',
    guides: [['Guide for parents and guardians', 'guardians']],
  },
  { who: 'coach', guides: [['Guide for coaches', 'coaches']] },
  { who: 'manager', guides: [['Guide for managers', 'managers']] },
  { who: 'physio', guides: [['Guide for physios', 'physios']] },
  { who: 'committee', guides: [['Guide for committee members', 'committee']] },
  { who: 'admin', guides: [['Guide for admins', 'admins']] },
  { who: 'guest', guides: [['Guide for guests', 'guests']] },
  // Two roles, two guides, main role first.
  {
    who: 'coachGuardian',
    guides: [
      ['Guide for coaches', 'coaches'],
      ['Guide for parents and guardians', 'guardians'],
    ],
  },
  // Studio adds nothing in HQ and has no guide of its own.
  { who: 'managerStudio', guides: [['Guide for managers', 'managers']] },
  // Paused roles still count: these two show as guests but hold a role.
  { who: 'stoodDownCoach', guides: [['Guide for coaches', 'coaches']] },
  { who: 'coachExpiredCheck', guides: [['Guide for coaches', 'coaches']] },
];

describe.each(IN_ME)('$who, in Me', ({ who, guides }) => {
  it(`is offered under Help: ${guides.map(([title]) => title).join(', ')}`, async () => {
    await open(who, '/me');
    expect(screen.getByText('Help')).toBeTruthy();
    expect(guideCards()).toEqual(guides.map(([title]) => title));
  });

  it('opens each guide’s PDF in the browser', async () => {
    await open(who, '/me');
    for (const [title, file] of guides) {
      openURL.mockClear();
      await fireEvent.press(screen.getByText(title));
      expect(openURL).toHaveBeenCalledTimes(1);
      expect(openURL).toHaveBeenCalledWith(`${BASE}/user-guide-${file}.pdf`);
    }
  });
});

it('leaves the Me tab standing when the phone can’t open the link', async () => {
  openURL.mockRejectedValue(new Error('no browser'));
  await open('athlete', '/me');
  await fireEvent.press(screen.getByText('Guide for athletes'));
  await settle();
  expect(screen.getByText('Guide for athletes')).toBeTruthy();
});

const ONE_SCREEN_WITH_GUIDE: {
  who: PersonaName;
  label: string;
  file: string;
}[] = [
  {
    who: 'volunteer',
    label: 'Guide for temporary helpers, a PDF that opens in your browser',
    file: 'temporary-helpers',
  },
  {
    who: 'lockedChild',
    label: 'Guide for athletes, a PDF that opens in your browser',
    file: 'athletes',
  },
];

describe.each(ONE_SCREEN_WITH_GUIDE)('$who, on their one screen', ({ label, file, who }) => {
  it('has a User guide link at the foot that opens their role’s guide', async () => {
    await open(who, '/');
    expect(screen.getByText('User guide')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(label));
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(`${BASE}/user-guide-${file}.pdf`);
  });
});

const ONE_SCREEN_NO_GUIDE: PersonaName[] = [
  'pending',
  'pendingAdmin',
  'rejected',
  'studio',
  'stoodDownStudio',
];

describe.each(ONE_SCREEN_NO_GUIDE)('%s, on their one screen', (who) => {
  it('has no User guide link: they hold no role with a guide yet', async () => {
    await open(who, '/');
    expect(screen.queryByText('User guide')).toBeNull();
    expect(screen.queryByText(/^Guide for /)).toBeNull();
  });
});
