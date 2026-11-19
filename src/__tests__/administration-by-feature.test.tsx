/**
 * The Administration screen's tiles (src/app/administration.tsx): which show
 * with each feature switch, and that every tile opens a screen the root
 * layout's guards let an admin into, so a tile never leads nowhere. Tiles are
 * sorted alphabetically by title (Matt, 19 November 2026).
 */
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import {
  personas,
  placeholderScreens,
  resetClub,
  setClubFeatures,
  signInAs,
  TODAY,
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

const overrides = placeholderScreens('administration');

async function openAdministration() {
  jest.useFakeTimers({ now: TODAY });
  signInAs(personas.admin);
  await renderRouter({ appDir: 'src/app', overrides }, { initialUrl: '/administration' });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  expect(screen).toHavePathname('/administration');
}

type Tile = {
  title: string;
  route: string;
  /** The switches it needs; any one of them is enough. */
  needs?: string[];
};

const TILES: Tile[] = [
  { title: 'Members', route: 'admin/index' },
  { title: 'Reports', route: 'admin/reports/index' },
  { title: 'Invite members', route: 'admin/invite' },
  { title: 'Safeguarding', route: 'admin/safeguarding' },
  { title: 'Code of conduct', route: 'admin/conduct' },
  { title: 'Club settings', route: 'admin/club' },
  { title: 'Squads and teams', route: 'admin/squads' },
  { title: 'Seasons', route: 'admin/seasons' },
  { title: 'Club captains', route: 'admin/captains', needs: ['messages'] },
  { title: 'Awards', route: 'admin/awards/index', needs: ['awards'] },
  { title: 'Integrity training', route: 'admin/training/index', needs: ['integrity'] },
  { title: 'Season KPI reviews', route: 'admin/kpi-reviews', needs: ['kpis'] },
  { title: 'Fixtures', route: 'admin/fixtures', needs: ['calendar', 'awards', 'goals'] },
  { title: 'Calendars', route: 'admin/calendars', needs: ['calendar'] },
  { title: 'Absence reasons', route: 'admin/absence-reasons', needs: ['attendance'] },
  { title: 'Injury report', route: 'admin/injuries', needs: ['injuries'] },
  { title: 'Club password', route: 'admin/club-password' },
];

const EVERY_FEATURE_ON = { kpis: true };
const SWITCHES = [
  'messages',
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
];
const EVERY_FEATURE_OFF = Object.fromEntries(SWITCHES.map((f) => [f, false]));

beforeEach(() => resetClub());

it('shows every tile with every feature on', async () => {
  setClubFeatures(EVERY_FEATURE_ON);
  await openAdministration();
  for (const { title } of TILES) expect(screen.getByText(title)).toBeTruthy();
});

it('shows only the tiles no switch controls with every feature off', async () => {
  setClubFeatures(EVERY_FEATURE_OFF);
  await openAdministration();
  for (const { title, needs } of TILES) {
    if (needs) expect(screen.queryByText(title)).toBeNull();
    else expect(screen.getByText(title)).toBeTruthy();
  }
});

it('hides Season KPI reviews until an admin turns them on', async () => {
  setClubFeatures({});
  await openAdministration();
  expect(screen.queryByText('Season KPI reviews')).toBeNull();
  expect(screen.getByText('Awards')).toBeTruthy();
});

it('has no Affiliation tile, even for a club that turned the old switch on', async () => {
  // Affiliation was removed on 7 November 2026: the app is for clubs only.
  setClubFeatures({ ...EVERY_FEATURE_ON, affiliation: true });
  await openAdministration();
  expect(screen.queryByText('Affiliation')).toBeNull();
  expect(screen.queryByText(/association/i)).toBeNull();
});

describe.each(TILES.filter((t) => t.needs))('$title', ({ title, needs }) => {
  it.each(needs!)('shows while only %s is on', async (feature) => {
    setClubFeatures({ ...EVERY_FEATURE_OFF, [feature]: true });
    await openAdministration();
    expect(screen.getByText(title)).toBeTruthy();
  });
});

it.each(TILES)('the $title tile opens $route', async ({ title, route }) => {
  setClubFeatures(EVERY_FEATURE_ON);
  await openAdministration();
  await fireEvent.press(screen.getByText(title));
  await act(async () => {});
  expect(screen.getByText(`screen:${route}`)).toBeTruthy();
  expect(screen).toHavePathname('/' + route.replace(/\/index$/, ''));
});

/** The tile titles in the order the screen shows them. */
function shownTitles(titles: string[]) {
  const escaped = titles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return screen
    .queryAllByText(new RegExp(`^(${escaped.join('|')})$`))
    .map((node) => String(node.props.children));
}

const byTitle = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

it('shows the tiles alphabetically with every feature on', async () => {
  setClubFeatures(EVERY_FEATURE_ON);
  await openAdministration();
  const shown = shownTitles(TILES.map((t) => t.title));
  expect(shown).toHaveLength(TILES.length);
  expect(shown).toEqual([...shown].sort(byTitle));
  expect(shown[0]).toBe('Absence reasons');
  expect(shown.at(-1)).toBe('Squads and teams');
});

it('shows the tiles alphabetically with every feature off', async () => {
  setClubFeatures(EVERY_FEATURE_OFF);
  await openAdministration();
  const shown = shownTitles(TILES.map((t) => t.title));
  expect(shown).toEqual(TILES.filter((t) => !t.needs).map((t) => t.title).sort(byTitle));
});

it('calls them Teams in a club without squads', async () => {
  setClubFeatures({ squads: false });
  await openAdministration();
  expect(screen.getByText('Teams')).toBeTruthy();
  expect(screen.queryByText('Squads and teams')).toBeNull();
  expect(shownTitles(['Seasons', 'Teams', 'Club password'])).toEqual(['Club password', 'Seasons', 'Teams']);
});
