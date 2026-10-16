import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

/** Android groups notifications into channels people can mute separately. */
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

/**
 * Registers this phone for push notifications about new join requests while an
 * admin is signed in, and opens the member's page when one is tapped.
 */
export function useAdminPushNotifications(isAdmin: boolean) {
  useEffect(() => {
    if (!isAdmin) return;
    registerForPush().catch((error) => console.warn('Push registration failed', error));
  }, [isAdmin]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // A tap that opened the app from closed.
    const last = Notifications.getLastNotificationResponse();
    if (last) openFromNotification(last);
    const subscription =
      Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => subscription.remove();
  }, []);
}

/** Removes this phone's token when signing out, so it stops getting the club's notifications. */
export async function unregisterForPush() {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  const token = await currentToken().catch(() => null);
  if (token) await supabase.rpc('unregister_push_token', { p_token: token });
}

async function registerForPush() {
  // Simulators and the web can't receive push notifications.
  if (Platform.OS === 'web' || !Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(JOIN_REQUESTS_CHANNEL, {
      name: 'Join requests',
      description: 'New requests to join the club, for admins',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: Colors.accent,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return;

  const token = await currentToken();
  if (!token) return;
  await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
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

function openFromNotification(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data;
  if (typeof data?.memberId === 'string') {
    router.push({ pathname: '/admin/[id]', params: { id: data.memberId } });
  } else if (typeof data?.planId === 'string') {
    // A session plan shared with the member for the first time.
    router.push({ pathname: '/session-plans/[id]', params: { id: data.planId } });
  }
}
