import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';

import { BrandIntro } from '@/components/brand-intro';
import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useAdminPushNotifications } from '@/lib/push';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider value={navTheme}>
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </ThemeProvider>
  );
}

// Headers and back buttons in the club colours.
const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.tint,
    background: Colors.background,
    card: Colors.background,
    text: Colors.text,
  },
};

function RootStack() {
  const { loading, session, isAdmin } = useAuth();
  const [introDone, setIntroDone] = useState(false);
  const finishIntro = useCallback(() => setIntroDone(true), []);
  useAdminPushNotifications(isAdmin);

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  return (
    <>
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="join" options={{ title: 'Request to join' }} />
          <Stack.Screen name="team/[id]" options={{ title: 'Team' }} />
          <Stack.Screen name="calendar" options={{ title: 'Calendar' }} />
          <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
          <Stack.Screen name="messages/index" options={{ title: 'Messages' }} />
          <Stack.Screen name="messages/new" options={{ title: 'New message' }} />
          <Stack.Screen name="messages/[id]" options={{ title: 'Message' }} />
          <Stack.Screen name="injuries/index" options={{ title: 'Injuries' }} />
          <Stack.Screen name="injuries/new" options={{ title: 'Report an injury' }} />
          <Stack.Screen name="injuries/[id]" options={{ title: 'Injury' }} />
          <Stack.Screen name="attendance/index" options={{ title: 'Attendance' }} />
          <Stack.Screen name="attendance/new" options={{ title: 'Take attendance' }} />
          <Stack.Screen name="attendance/[id]" options={{ title: 'Attendance' }} />
          <Stack.Screen name="attendance/athlete/[id]" options={{ title: 'Athlete attendance' }} />
          <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
          <Stack.Protected guard={isAdmin}>
            <Stack.Screen name="administration" options={{ title: 'Administration' }} />
            <Stack.Screen name="admin/index" options={{ title: 'Members' }} />
            <Stack.Screen name="admin/[id]" options={{ title: 'Member' }} />
            <Stack.Screen name="admin/calendars" options={{ title: 'Calendars' }} />
            <Stack.Screen name="admin/club-password" options={{ title: 'Club password' }} />
            <Stack.Screen name="admin/injuries" options={{ title: 'Injury report' }} />
            <Stack.Screen name="admin/squads" options={{ title: 'Squads and teams' }} />
            <Stack.Screen name="admin/team/[id]" options={{ title: 'Name team' }} />
          </Stack.Protected>
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
      </Stack>
      {introDone ? null : <BrandIntro onDone={finishIntro} />}
    </>
  );
}
