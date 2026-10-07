import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </ThemeProvider>
  );
}

function RootStack() {
  const { loading, session, isAdmin } = useAuth();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="join" options={{ title: 'Request to join' }} />
        <Stack.Screen name="team/[id]" options={{ title: 'Team' }} />
        <Stack.Screen name="calendar" options={{ title: 'Calendar' }} />
        <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
        <Stack.Protected guard={isAdmin}>
          <Stack.Screen name="admin/index" options={{ title: 'Members' }} />
          <Stack.Screen name="admin/[id]" options={{ title: 'Member' }} />
          <Stack.Screen name="admin/calendars" options={{ title: 'Calendars' }} />
        </Stack.Protected>
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
    </Stack>
  );
}
