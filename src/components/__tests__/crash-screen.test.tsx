/**
 * "Something went wrong" (src/components/crash-screen.tsx), which the root
 * layout's ErrorBoundary shows in place of a blank screen. It reports the
 * error (when crash reports are on), never shows the error's own words, and
 * offers a restart and another try.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Updates from 'expo-updates';

import { CrashScreen } from '@/components/crash-screen';
import { reportCrash } from '@/lib/crash-reports';
import { logger } from '@/lib/log';

jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);
jest.mock('@/lib/crash-reports', () => ({ reportCrash: jest.fn() }));
jest.mock('@/lib/log', () => {
  const error = jest.fn();
  return { logger: () => ({ error }) };
});
jest.mock('expo-updates', () => ({ reloadAsync: jest.fn() }));

const reload = jest.mocked(Updates.reloadAsync);
const logged = logger('app').error as jest.Mock;

beforeEach(() => jest.clearAllMocks());

const error = new Error('Couldn’t load jane@example.com');

it('says what happened in plain words, without the error’s own text', async () => {
  await render(<CrashScreen error={error} retry={jest.fn(async () => {})} />);
  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(screen.getByText(/Nothing you saved has been lost/)).toBeTruthy();
  expect(screen.queryByText(/jane@example.com/)).toBeNull();
});

it('reports the error once and writes it to the app log', async () => {
  const { rerender } = await render(<CrashScreen error={error} retry={jest.fn(async () => {})} />);
  await rerender(<CrashScreen error={error} retry={jest.fn(async () => {})} />);
  expect(reportCrash).toHaveBeenCalledTimes(1);
  expect(reportCrash).toHaveBeenCalledWith(error);
  expect(logged).toHaveBeenCalledWith('Something went wrong screen', { error });
});

it('restarts the app', async () => {
  reload.mockResolvedValueOnce(undefined);
  const retry = jest.fn(async () => {});
  await render(<CrashScreen error={error} retry={retry} />);
  await fireEvent.press(screen.getByText('Restart the app'));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(retry).not.toHaveBeenCalled();
});

it('tries the screen again when the app can’t restart itself, as in development', async () => {
  reload.mockRejectedValueOnce(new Error('not available'));
  const retry = jest.fn(async () => {});
  await render(<CrashScreen error={error} retry={retry} />);
  await fireEvent.press(screen.getByText('Restart the app'));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Restart the app')).toBeTruthy();
});

it('tries the screen again', async () => {
  const retry = jest.fn(async () => {});
  await render(<CrashScreen error={error} retry={retry} />);
  await fireEvent.press(screen.getByText('Try again'));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
});
