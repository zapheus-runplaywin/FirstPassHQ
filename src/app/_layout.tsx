import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { BrandIntro } from '@/components/brand-intro';
import { contrastRatio } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ClubProvider, useClub } from '@/lib/club';
import { useAdminPushNotifications } from '@/lib/push';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <Club>
        <ClubTheme>
          <RootStack />
        </ClubTheme>
      </Club>
    </AuthProvider>
  );
}

function Club({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return <ClubProvider signedIn={!!session}>{children}</ClubProvider>;
}

// Headers and back buttons in the club colours.
function ClubTheme({ children }: { children: ReactNode }) {
  const colors = useTheme();
  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      dark: contrastRatio(colors.text, '#000000') >= contrastRatio(colors.text, '#FFFFFF'),
      colors: {
        ...DarkTheme.colors,
        primary: colors.tint,
        background: colors.background,
        card: colors.background,
        text: colors.text,
      },
    }),
    [colors],
  );
  // Dark status bar icons when the club picked dark text on a light background.
  const darkText = contrastRatio(colors.text, '#000000') < contrastRatio(colors.text, '#FFFFFF');
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={darkText ? 'dark' : 'light'} />
      {children}
    </ThemeProvider>
  );
}

function RootStack() {
  const { loading: authLoading, session, isAdmin } = useAuth();
  const { ready, features } = useClub();
  const loading = authLoading || !ready;
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
          <Stack.Protected guard={features.calendar}>
            <Stack.Screen name="calendar" options={{ title: 'Calendar' }} />
            <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
          </Stack.Protected>
          <Stack.Protected guard={features.messages}>
            <Stack.Screen name="messages/index" options={{ title: 'Messages' }} />
            <Stack.Screen name="messages/new" options={{ title: 'New message' }} />
            <Stack.Screen name="messages/[id]" options={{ title: 'Message' }} />
          </Stack.Protected>
          <Stack.Protected guard={features.injuries}>
            <Stack.Screen name="injuries/index" options={{ title: 'Injuries' }} />
            <Stack.Screen name="injuries/new" options={{ title: 'Report an injury' }} />
            <Stack.Screen name="injuries/[id]" options={{ title: 'Injury' }} />
          </Stack.Protected>
          <Stack.Protected guard={features.attendance}>
            <Stack.Screen name="attendance/index" options={{ title: 'Attendance' }} />
            <Stack.Screen name="attendance/new" options={{ title: 'Take attendance' }} />
            <Stack.Screen name="attendance/[id]" options={{ title: 'Attendance' }} />
            <Stack.Screen name="attendance/athlete/[id]" options={{ title: 'Athlete attendance' }} />
          </Stack.Protected>
          <Stack.Protected guard={features.checkIns}>
            <Stack.Screen name="check-in" options={{ title: 'Daily check-in' }} />
            <Stack.Screen name="check-ins/index" options={{ title: 'Check-ins' }} />
            <Stack.Screen name="check-ins/athlete/[id]" options={{ title: 'Check-ins' }} />
          </Stack.Protected>
          <Stack.Protected guard={features.awards}>
            <Stack.Screen name="awards/index" options={{ title: 'Awards' }} />
            <Stack.Screen name="awards/vote" options={{ title: 'Vote' }} />
          </Stack.Protected>
          <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
          <Stack.Protected guard={isAdmin}>
            <Stack.Screen name="administration" options={{ title: 'Administration' }} />
            <Stack.Screen name="admin/index" options={{ title: 'Members' }} />
            <Stack.Screen name="admin/[id]" options={{ title: 'Member' }} />
            <Stack.Screen name="admin/club" options={{ title: 'Club settings' }} />
            <Stack.Screen name="admin/club-password" options={{ title: 'Club password' }} />
            <Stack.Screen name="admin/squads" options={{ title: 'Squads and teams' }} />
            <Stack.Screen name="admin/team/[id]" options={{ title: 'Name team' }} />
            <Stack.Screen name="admin/seasons" options={{ title: 'Seasons' }} />
            <Stack.Screen name="admin/place/[id]" options={{ title: 'Place members' }} />
            <Stack.Protected guard={features.calendar}>
              <Stack.Screen name="admin/calendars" options={{ title: 'Calendars' }} />
            </Stack.Protected>
            <Stack.Protected guard={features.injuries}>
              <Stack.Screen name="admin/injuries" options={{ title: 'Injury report' }} />
            </Stack.Protected>
            <Stack.Protected guard={features.awards}>
              <Stack.Screen name="admin/awards/index" options={{ title: 'Awards' }} />
              <Stack.Screen name="admin/awards/edit" options={{ title: 'Award' }} />
              <Stack.Screen name="admin/awards/[id]" options={{ title: 'Award' }} />
            </Stack.Protected>
            <Stack.Protected guard={features.calendar || features.awards}>
              <Stack.Screen name="admin/fixtures" options={{ title: 'Fixtures' }} />
            </Stack.Protected>
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
