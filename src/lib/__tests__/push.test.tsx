/**
 * Push notifications (src/lib/push.ts): every approved member's phone
 * registers for to-do notifications with its club, unless they've turned
 * them off. Tapping one opens its screen, switching club first when it came
 * from another club. The Your details switch saves the choice. Signing out
 * removes this phone's token, so it stops getting the club's notifications.
 */
import { act, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { unregisterForPush, usePushNotifications, useTodoNotifications } from '@/lib/push';
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
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club-choice', () => ({ useClubChoice: jest.fn() }));

const N = Notifications as unknown as Record<string, jest.Mock>;
const rpc = supabase.rpc as jest.Mock;
const device = jest.requireMock('expo-device') as { isDevice: boolean };
const useAuth = jest.requireMock('@/lib/auth').useAuth as jest.Mock;
const useClubChoice = jest.requireMock('@/lib/club-choice').useClubChoice as jest.Mock;
const choose = jest.fn();

/** The member's saved switch, as `my_push_settings` returns it. */
let todosOn: boolean | null = true;

/** Lets the registration's awaits finish. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let tapId = 0;
/** A tap on a notification carrying `data`, each with its own id. */
const response = (data: Record<string, unknown>) => ({
  notification: { request: { identifier: `tap-${++tapId}`, content: { data } } },
});

beforeEach(() => {
  jest.clearAllMocks();
  todosOn = true;
  rpc.mockImplementation(() => {
    const result = Promise.resolve({ data: null, error: null });
    return Object.assign(result, {
      maybeSingle: async () => ({ data: todosOn === null ? null : { todos: todosOn }, error: null }),
    });
  });
  device.isDevice = true;
  N.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  N.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  useAuth.mockReturnValue({ session: { user: { id: 'u-1' } }, profile: { status: 'approved' } });
  useClubChoice.mockReturnValue({ club: { code: 'THUNDER' }, choose });
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
  it('an approved member’s phone registers its token with the club', async () => {
    await renderHook(() => usePushNotifications(true));
    await flush();
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(rpc).toHaveBeenCalledWith('register_push_device', {
      p_token: 'ExponentPushToken[abc]',
      p_platform: Platform.OS,
      p_club: 'THUNDER',
    });
  });

  it('nobody signed out or waiting for approval registers', async () => {
    useAuth.mockReturnValue({ session: { user: { id: 'u-1' } }, profile: { status: 'pending' } });
    await renderHook(() => usePushNotifications(true));
    await flush();
    expect(N.getPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a member who turned to-do notifications off doesn’t register', async () => {
    todosOn = false;
    await renderHook(() => usePushNotifications(true));
    await flush();
    expect(rpc).toHaveBeenCalledWith('my_push_settings');
    expect(N.getPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('register_push_device', expect.anything());
  });

  it('asks for permission first, and registers nothing when refused', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    N.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await renderHook(() => usePushNotifications(true));
    await flush();
    expect(N.requestPermissionsAsync).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('register_push_device', expect.anything());
  });

  it('registers once permission is given when asked', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    await renderHook(() => usePushNotifications(true));
    await flush();
    expect(rpc).toHaveBeenCalledWith(
      'register_push_device',
      expect.objectContaining({ p_token: 'ExponentPushToken[abc]' }),
    );
  });

  it('a simulator never registers', async () => {
    jest.isolateModules(() => {
      device.isDevice = false;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const push = require('@/lib/push') as typeof import('@/lib/push');
      expect(push.canGetPush).toBe(false);
    });
  });

  it('a failed registration only warns', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    N.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no network'));
    await renderHook(() => usePushNotifications(true));
    await flush();
    expect(warn).toHaveBeenCalledWith('Push registration failed', expect.any(Error));
    warn.mockRestore();
  });
});

describe('tapping a notification', () => {
  const listen = async () => {
    await renderHook(() => usePushNotifications(true));
    return N.addNotificationResponseReceivedListener.mock.calls[0][0];
  };

  it('a to-do opens its screen', async () => {
    (await listen())(response({ kind: 'todo', href: '/check-in', club: 'THUNDER' }));
    expect(router.push).toHaveBeenCalledWith('/check-in');
  });

  it('a join request opens that member’s page', async () => {
    (await listen())(response({ memberId: 'm-1' }));
    expect(router.push).toHaveBeenCalledWith('/admin/m-1');
  });

  it('a shared session plan opens the plan', async () => {
    (await listen())(response({ planId: 'plan-1' }));
    expect(router.push).toHaveBeenCalledWith('/session-plans/plan-1');
  });

  it('anything else opens nothing', async () => {
    const open = await listen();
    open(response({ memberId: 42 }));
    open(response({ href: 'https://example.com' }));
    open(response({}));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('the same tap is only followed once', async () => {
    const open = await listen();
    const tap = response({ href: '/awards' });
    open(tap);
    open(tap);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('one from another club switches club, then opens the screen there', async () => {
    const { rerender } = await renderHook(() => usePushNotifications(true));
    const open = N.addNotificationResponseReceivedListener.mock.calls[0][0];
    open(response({ href: '/training', club: 'WARRIORS' }));
    expect(choose).toHaveBeenCalledWith('WARRIORS');
    expect(router.push).not.toHaveBeenCalled();

    useClubChoice.mockReturnValue({ club: { code: 'WARRIORS' }, choose });
    await rerender({});
    expect(router.push).toHaveBeenCalledWith('/training');
  });

  it('waits until the app has loaded', async () => {
    await renderHook(() => usePushNotifications(false));
    expect(N.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
  });

  it('a tap that opened the app from closed is followed', async () => {
    N.getLastNotificationResponse.mockReturnValueOnce(response({ memberId: 'm-2' }));
    await renderHook(() => usePushNotifications(true));
    expect(router.push).toHaveBeenCalledWith('/admin/m-2');
  });

  it('stops listening when the screen goes', async () => {
    const remove = jest.fn();
    N.addNotificationResponseReceivedListener.mockReturnValueOnce({ remove });
    const { unmount } = await renderHook(() => usePushNotifications(true));
    await unmount();
    expect(remove).toHaveBeenCalled();
  });
});

describe('the Your details switch', () => {
  it('starts with the saved choice, on when nothing is saved', async () => {
    todosOn = null;
    const { result } = await renderHook(() => useTodoNotifications());
    await act(flush);
    expect(result.current.on).toBe(true);
    expect(result.current.permission).toBe('granted');
  });

  it('turning it off saves without registering', async () => {
    const { result } = await renderHook(() => useTodoNotifications());
    await act(flush);
    await act(() => result.current.save(false));
    expect(rpc).toHaveBeenCalledWith('set_todo_notifications', { p_on: false });
    expect(result.current.on).toBe(false);
    expect(rpc).not.toHaveBeenCalledWith('register_push_device', expect.anything());
  });

  it('turning it on registers this phone again', async () => {
    todosOn = false;
    const { result } = await renderHook(() => useTodoNotifications());
    await act(flush);
    await act(() => result.current.save(true));
    expect(rpc).toHaveBeenCalledWith('set_todo_notifications', { p_on: true });
    expect(rpc).toHaveBeenCalledWith('register_push_device', expect.objectContaining({ p_club: 'THUNDER' }));
    expect(result.current.on).toBe(true);
  });

  it('a failed save keeps the switch as it was', async () => {
    const { result } = await renderHook(() => useTodoNotifications());
    await act(flush);
    rpc.mockImplementationOnce(async () => ({ data: null, error: new Error('offline') }));
    await expect(result.current.save(false)).rejects.toThrow('offline');
    expect(result.current.on).toBe(true);
  });
});

describe('signing out', () => {
  it('removes this phone’s token', async () => {
    await unregisterForPush();
    expect(rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: 'ExponentPushToken[abc]' });
  });

  it('does nothing when the token can’t be read', async () => {
    N.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('offline'));
    await unregisterForPush();
    expect(rpc).not.toHaveBeenCalled();
  });
});
