/**
 * Push notifications (src/lib/push.ts): admins' phones register for new join
 * request notifications; tapping one opens that member's page, and tapping a
 * shared session plan's opens the plan. Signing out removes this phone's
 * token, so it stops getting the club's notifications.
 */
import { renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { unregisterForPush, useAdminPushNotifications } from '@/lib/push';
import { supabase } from '@/lib/supabase';

jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);
jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'project-1' } } } },
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
  AndroidImportance: { HIGH: 4 },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const N = Notifications as unknown as Record<string, jest.Mock>;
const rpc = supabase.rpc as jest.Mock;
const device = jest.requireMock('expo-device') as { isDevice: boolean };

/** Lets the registration's awaits finish. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  rpc.mockImplementation(async () => ({ data: null, error: null }));
  device.isDevice = true;
  N.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  N.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
});

it('shows notifications that arrive while the app is open', async () => {
  const handler = (jest.requireMock('expo-notifications') as { setNotificationHandler: jest.Mock })
    .setNotificationHandler;
  // Set once when the module loads, before clearAllMocks ran.
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/lib/push');
  });
  const { handleNotification } = handler.mock.calls[0][0];
  await expect(handleNotification()).resolves.toEqual({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
});

describe('registering', () => {
  it('an admin’s phone registers its token with the club', async () => {
    await renderHook(() => useAdminPushNotifications(true));
    await flush();
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(rpc).toHaveBeenCalledWith('register_push_token', {
      p_token: 'ExponentPushToken[abc]',
      p_platform: Platform.OS,
    });
  });

  it('nobody else’s phone registers', async () => {
    await renderHook(() => useAdminPushNotifications(false));
    await flush();
    expect(N.getPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('asks for permission first, and registers nothing when refused', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    N.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await renderHook(() => useAdminPushNotifications(true));
    await flush();
    expect(N.requestPermissionsAsync).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('registers once permission is given when asked', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    await renderHook(() => useAdminPushNotifications(true));
    await flush();
    expect(rpc).toHaveBeenCalledWith('register_push_token', expect.objectContaining({ p_token: 'ExponentPushToken[abc]' }));
  });

  it('a simulator never registers', async () => {
    device.isDevice = false;
    await renderHook(() => useAdminPushNotifications(true));
    await flush();
    expect(N.getPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a failed registration only warns', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    N.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no network'));
    await renderHook(() => useAdminPushNotifications(true));
    await flush();
    expect(warn).toHaveBeenCalledWith('Push registration failed', expect.any(Error));
    warn.mockRestore();
  });
});

describe('tapping a notification', () => {
  const response = (data: Record<string, unknown>) => ({ notification: { request: { content: { data } } } });

  it('a join request opens that member’s page', async () => {
    await renderHook(() => useAdminPushNotifications(true));
    const listener = N.addNotificationResponseReceivedListener.mock.calls[0][0];
    listener(response({ memberId: 'm-1' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/admin/[id]', params: { id: 'm-1' } });
  });

  it('a shared session plan opens the plan', async () => {
    await renderHook(() => useAdminPushNotifications(false));
    const listener = N.addNotificationResponseReceivedListener.mock.calls[0][0];
    listener(response({ planId: 'plan-1' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/session-plans/[id]', params: { id: 'plan-1' } });
  });

  it('anything else opens nothing', async () => {
    await renderHook(() => useAdminPushNotifications(false));
    const listener = N.addNotificationResponseReceivedListener.mock.calls[0][0];
    listener(response({ memberId: 42 }));
    listener(response({}));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a tap that opened the app from closed is followed', async () => {
    N.getLastNotificationResponse.mockReturnValueOnce(response({ memberId: 'm-2' }));
    await renderHook(() => useAdminPushNotifications(false));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/admin/[id]', params: { id: 'm-2' } });
  });

  it('stops listening when the screen goes', async () => {
    const remove = jest.fn();
    N.addNotificationResponseReceivedListener.mockReturnValueOnce({ remove });
    const { unmount } = await renderHook(() => useAdminPushNotifications(true));
    unmount();
    expect(remove).toHaveBeenCalled();
  });
});

describe('signing out', () => {
  it('removes this phone’s token', async () => {
    await unregisterForPush();
    expect(rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: 'ExponentPushToken[abc]' });
  });

  it('does nothing on a simulator', async () => {
    device.isDevice = false;
    await unregisterForPush();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does nothing when the token can’t be read', async () => {
    N.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('offline'));
    await unregisterForPush();
    expect(rpc).not.toHaveBeenCalled();
  });
});
