/**
 * How the real root layout (src/app/_layout.tsx) wires up crash reports
 * (src/lib/crash-reports.ts): it starts them once with the build's Sentry
 * address (off in development, so off here), tags each screen by its pattern
 * and never its ids, tells the scrubber the signed-in member's own name and
 * emails, and shows "Something went wrong" in place of a blank screen.
 */
import { render, screen } from '@testing-library/react-native';

import { ErrorBoundary } from '@/app/_layout';
import {
  rememberPersonalValues,
  setCrashReportScreen,
  startCrashReports,
} from '@/lib/crash-reports';

import { openRoute, personas, resetClub, setClubChosen } from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
}));
jest.mock('@/lib/log', () => ({ ...jest.requireActual('@/lib/log'), startAppLog: jest.fn() }));
jest.mock('@/lib/crash-reports', () => ({
  startCrashReports: jest.fn(() => false),
  setCrashReportScreen: jest.fn(),
  rememberPersonalValues: jest.fn(),
  reportCrash: jest.fn(),
}));
jest.mock('@/components/brand-intro', () => ({ BrandIntro: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

// Read once, when the layout file loads.
const started = jest.mocked(startCrashReports).mock.calls.slice();

beforeEach(() => {
  resetClub();
  setClubChosen(true);
  jest.mocked(setCrashReportScreen).mockClear();
  jest.mocked(rememberPersonalValues).mockClear();
});

afterEach(() => jest.useRealTimers());

it('starts crash reports once, from the build’s Sentry address, off in development', () => {
  expect(started).toHaveLength(1);
  expect(started[0][0]).toMatchObject({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    isDev: true,
  });
  expect(Object.keys(started[0][0].version).sort()).toEqual(['build', 'commit', 'updateId']);
  expect(started[0][0]).toHaveProperty('executionEnvironment');
  expect(started[0][0]).toHaveProperty('channel');
});

it('tags the open screen by its pattern, with no id in it', async () => {
  await openRoute('athlete', '/injuries/3f2b8c1e-1234-4abc-9def-0123456789ab');
  const screens = jest.mocked(setCrashReportScreen).mock.calls.map(([segments]) => `/${segments.join('/')}`);
  expect(screens).toContain('/injuries/[id]');
  expect(JSON.stringify(screens)).not.toContain('3f2b8c1e');
});

it('tells the scrubber the signed-in member’s own name and emails', async () => {
  await openRoute('athlete', '/');
  const values = jest.mocked(rememberPersonalValues).mock.calls.flatMap(([v]) => v ?? []);
  const athlete = personas.athlete.profile!;
  expect(values).toEqual(expect.arrayContaining([athlete.full_name, athlete.email]));
});

it('shows “Something went wrong” for an error, without its words', async () => {
  await render(<ErrorBoundary error={new Error('jane@example.com broke it')} retry={async () => {}} />);
  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(screen.getByText('Restart the app')).toBeTruthy();
  expect(screen.queryByText(/jane@example.com/)).toBeNull();
});
