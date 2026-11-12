import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useClubChoice } from '@/lib/club-choice';
import { supabase } from '@/lib/supabase';

/** Android groups notifications into channels people can mute separately. */
const TODOS_CHANNEL = 'todos';
const JOIN_REQUESTS_CHANNEL = 'join-requests';

// Show notifications that arrive while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Phones get push notifications; the web and simulators don't. */
export const canGetPush = Platform.OS !== 'web' && Device.isDevice;

// A tap on a notification from another club switches club first, which mounts
// the app again; the screen to open waits here until the new club is ready.
let waitingHref: { club: string; href: string } | null = null;
// Taps already handled, so the same tap isn't acted on again after a remount.
const handled = new Set<string>();

/**
 * Registers this phone for to-do notifications while an approved member who
 * hasn't turned them off is signed in, and opens the right club and screen
 * when one is tapped. Screens open once the app has loaded (`ready`).
 */
export function usePushNotifications(ready: boolean) {
  const { session, profile } = useAuth();
  const { club, choose } = useClubChoice();
  const approved = !!session && profile?.status === 'approved';
  const clubCode = club?.code ?? null;

  useEffect(() => {
    if (!approved || !canGetPush) return;
    (async () => {
      const { data } = await supabase.rpc('my_push_settings').maybeSingle<{ todos: boolean }>();
      if (data?.todos === false) return;
      await registerForPush(clubCode);
    })().catch((error) => console.warn('Push registration failed', error));
  }, [approved, clubCode]);

  // Open a screen held over from a tap that switched club.
  useEffect(() => {
    if (!ready || !approved || !waitingHref || waitingHref.club !== clubCode) return;
    const { href } = waitingHref;
    waitingHref = null;
    router.push(href as Href);
  }, [ready, approved, clubCode]);

  useEffect(() => {
    if (Platform.OS === 'web' || !ready) return;
    const open = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.has(id)) return;
      handled.add(id);
      const data = response.notification.request.content.data ?? {};
      const href = notificationHref(data);
      const fromClub = typeof data.club === 'string' ? data.club : null;
      if (fromClub && fromClub !== clubCode) {
        waitingHref = href ? { club: fromClub, href } : null;
        choose(fromClub);
        return;
      }
      if (href) router.push(href as Href);
    };
    // A tap that opened the app from closed.
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [ready, clubCode, choose]);
}

/** The screen a notification opens: a path inside the app, a join request or a session plan. */
function notificationHref(data: Record<string, unknown>) {
  if (typeof data.href === 'string' && data.href.startsWith('/')) return data.href;
  if (typeof data.memberId === 'string') return `/admin/${data.memberId}`;
  // A session plan shared with the member for the first time.
  if (typeof data.planId === 'string') return `/session-plans/${data.planId}`;
  return null;
}

/** Whether the phone lets the app show notifications. */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/**
 * The member's to-do notification switch, saved with their club, and whether
 * the phone allows notifications at all.
 */
export function useTodoNotifications() {
  const { club } = useClubChoice();
  const [on, setOn] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<PushPermission>(
    canGetPush ? 'undetermined' : 'unavailable',
  );

  useEffect(() => {
    supabase
      .rpc('my_push_settings')
      .maybeSingle<{ todos: boolean }>()
      .then(({ data }) => setOn(data?.todos ?? true));
    if (canGetPush) {
      Notifications.getPermissionsAsync().then(({ status }) => setPermission(status));
    }
  }, []);

  const save = useCallback(
    async (next: boolean) => {
      const { error } = await supabase.rpc('set_todo_notifications', { p_on: next });
      if (error) throw error;
      setOn(next);
      if (next && canGetPush) {
        setPermission(await registerForPush(club?.code ?? null));
      }
    },
    [club],
  );

  return { on, permission, save };
}

/** Opens this app's page in the phone's settings, where notifications are allowed. */
export function openNotificationSettings() {
  Linking.openSettings().catch(() => {});
}

/** Removes this phone's token when signing out, so it stops getting the club's notifications. */
export async function unregisterForPush() {
  if (!canGetPush) return;
  const token = await currentToken().catch(() => null);
  if (token) await supabase.rpc('unregister_push_token', { p_token: token });
}

async function registerForPush(clubCode: string | null): Promise<PushPermission> {
  if (!canGetPush) return 'unavailable';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(TODOS_CHANNEL, {
      name: 'To-dos',
      description: 'New things on your to-do list',
      // SDK 58 builds this enum in a way eslint-plugin-import can't read; it's exported.
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: Colors.accent,
    });
    await Notifications.setNotificationChannelAsync(JOIN_REQUESTS_CHANNEL, {
      name: 'Join requests',
      description: 'New requests to join the club, for admins',
      // SDK 58 builds this enum in a way eslint-plugin-import can't read; it's exported.
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: Colors.accent,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return status;

  const token = await currentToken();
  if (!token) return status;
  await supabase.rpc('register_push_device', {
    p_token: token,
    p_platform: Platform.OS,
    p_club: clubCode,
  });
  return status;
}

async function currentToken() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    console.warn('Push notifications need an EAS project id. Run `npx eas-cli@latest init`.');
    return null;
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}
