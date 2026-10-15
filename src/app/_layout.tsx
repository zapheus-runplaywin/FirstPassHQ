import { Montserrat_400Regular } from '@expo-google-fonts/montserrat/400Regular';
import { Montserrat_700Bold } from '@expo-google-fonts/montserrat/700Bold';
import { Montserrat_800ExtraBold } from '@expo-google-fonts/montserrat/800ExtraBold';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { BrandIntro } from '@/components/brand-intro';
import { BrandFonts, contrastRatio } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ClubProvider, useClub } from '@/lib/club';
import { ClubChoiceProvider, useClubChoice } from '@/lib/club-choice';
import { startAppLog } from '@/lib/log';
import { useAdminPushNotifications } from '@/lib/push';

SplashScreen.preventAutoHideAsync();
startAppLog({ version: Constants.expoConfig?.version ?? null });

export default function RootLayout() {
  return (
    <ClubChoiceProvider>
      <ChosenClub />
    </ClubChoiceProvider>
  );
}

// Everything below is mounted again when the club changes, so no screen, sign-in
// or saved look from one club carries over to another.
function ChosenClub() {
  const { ready, club } = useClubChoice();
  if (!ready) return null;
  return (
    <AuthProvider key={club?.code ?? ''}>
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
      fonts: {
        regular: { fontFamily: BrandFonts.regular, fontWeight: '400' as const },
        medium: { fontFamily: BrandFonts.bold, fontWeight: '400' as const },
        bold: { fontFamily: BrandFonts.bold, fontWeight: '400' as const },
        heavy: { fontFamily: BrandFonts.extraBold, fontWeight: '400' as const },
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
  const { ready, features, affiliation } = useClub();
  const { club } = useClubChoice();
  // Montserrat; if it fails to load the app carries on in the system font.
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
  });
  const loading = authLoading || !ready || !(fontsLoaded || fontError);
  const [introDone, setIntroDone] = useState(false);
  const finishIntro = useCallback(() => setIntroDone(true), []);
  useAdminPushNotifications(isAdmin);

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  return (
    <>
      <Stack
        screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="join" options={{ title: 'Request to join' }} />
          <Stack.Screen name="team/[id]" options={{ title: 'Team' }} />
          <Stack.Screen name="team/captains/[id]" options={{ title: 'Captains' }} />
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
            <Stack.Screen name="injuries/document" options={{ title: 'Document' }} />
          </Stack.Protected>
          <Stack.Protected guard={features.attendance}>
            <Stack.Screen name="attendance/index" options={{ title: 'Attendance' }} />
            <Stack.Screen name="attendance/new" options={{ title: 'Take attendance' }} />
            <Stack.Screen name="attendance/[id]" options={{ title: 'Attendance' }} />
            <Stack.Screen name="attendance/athlete/[id]" options={{ title: 'Athlete attendance' }} />
            <Stack.Screen name="attendance/family/[id]" options={{ title: 'Attendance' }} />
            <Stack.Screen name="attendance/absence" options={{ title: 'Report an absence' }} />
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
          <Stack.Protected guard={features.goals}>
            <Stack.Screen name="goals/athlete/[id]" options={{ title: 'Game goals' }} />
            <Stack.Screen name="goals/game" options={{ title: 'Game goals' }} />
            <Stack.Screen name="goals/team" options={{ title: 'Team goals' }} />
          </Stack.Protected>
          <Stack.Protected guard={features.integrity}>
            <Stack.Screen name="training/index" options={{ title: 'Integrity training' }} />
            <Stack.Screen name="training/submit" options={{ title: 'Add a certificate' }} />
            <Stack.Screen name="training/review" options={{ title: 'Check certificates' }} />
            <Stack.Screen name="training/progress" options={{ title: 'Training progress' }} />
            <Stack.Screen name="training/requirement/[id]" options={{ title: 'Training' }} />
            <Stack.Screen name="training/document" options={{ title: 'Certificate' }} />
          </Stack.Protected>
          <Stack.Screen name="declaration" options={{ title: 'Exemption declaration' }} />
          <Stack.Screen name="concern/new" options={{ title: 'Raise a concern' }} />
          <Stack.Screen name="consent/[id]" options={{ title: 'Consent' }} />
          <Stack.Screen name="conduct/[id]" options={{ title: 'Code of conduct' }} />
          <Stack.Screen name="records/[id]" options={{ title: 'Who has viewed their records' }} />
          <Stack.Screen name="activity/[id]" options={{ title: 'What’s changed' }} />
          <Stack.Screen name="concerns/index" options={{ title: 'Concerns' }} />
          <Stack.Screen name="concerns/[id]" options={{ title: 'Concern' }} />
          <Stack.Screen name="concerns/report" options={{ title: 'Concerns register' }} />
          <Stack.Screen name="tasks/index" options={{ title: 'Your tasks' }} />
          <Stack.Screen name="tasks/new" options={{ title: 'Add a task' }} />
          <Stack.Screen name="tasks/[id]" options={{ title: 'Task' }} />
          <Stack.Screen name="my-details" options={{ title: 'Your details' }} />
          <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
          <Stack.Protected guard={isAdmin}>
            <Stack.Screen name="administration" options={{ title: 'Administration' }} />
            <Stack.Screen name="admin/index" options={{ title: 'Members' }} />
            <Stack.Screen name="admin/[id]" options={{ title: 'Member' }} />
            <Stack.Screen name="admin/club" options={{ title: 'Club settings' }} />
            <Stack.Screen name="admin/safeguarding" options={{ title: 'Safeguarding' }} />
            <Stack.Screen name="admin/conduct" options={{ title: 'Code of conduct' }} />
            <Stack.Screen name="admin/club-password" options={{ title: 'Club password' }} />
            <Stack.Screen name="admin/invite" options={{ title: 'Invite members' }} />
            <Stack.Screen name="admin/squads" options={{ title: 'Squads and teams' }} />
            <Stack.Screen name="admin/team/[id]" options={{ title: 'Name team' }} />
            <Stack.Screen name="admin/seasons" options={{ title: 'Seasons' }} />
            <Stack.Screen name="admin/place/[id]" options={{ title: 'Place members' }} />
            <Stack.Screen name="admin/captains" options={{ title: 'Club captains' }} />
            <Stack.Screen name="admin/reports/index" options={{ title: 'Reports' }} />
            <Stack.Screen
              name="admin/reports/wwcc"
              options={{ title: 'Working With Children Checks' }}
            />
            <Stack.Screen name="admin/reports/under-18s" options={{ title: 'Under 18s' }} />
            <Stack.Protected guard={features.calendar}>
              <Stack.Screen name="admin/calendars" options={{ title: 'Calendars' }} />
            </Stack.Protected>
            <Stack.Protected guard={features.injuries}>
              <Stack.Screen name="admin/injuries" options={{ title: 'Injury report' }} />
            </Stack.Protected>
            <Stack.Protected guard={features.attendance}>
              <Stack.Screen name="admin/reports/attendance" options={{ title: 'Attendance report' }} />
              <Stack.Screen name="admin/absence-reasons" options={{ title: 'Absence reasons' }} />
            </Stack.Protected>
            <Stack.Protected guard={features.awards}>
              <Stack.Screen name="admin/awards/index" options={{ title: 'Awards' }} />
              <Stack.Screen name="admin/awards/edit" options={{ title: 'Award' }} />
              <Stack.Screen name="admin/awards/[id]" options={{ title: 'Award' }} />
              <Stack.Screen name="admin/reports/awards" options={{ title: 'Award results' }} />
              <Stack.Screen name="admin/reports/award" options={{ title: 'Award results' }} />
            </Stack.Protected>
            <Stack.Protected guard={features.integrity}>
              <Stack.Screen name="admin/training/index" options={{ title: 'Integrity training' }} />
              <Stack.Screen name="admin/training/edit" options={{ title: 'Training' }} />
              <Stack.Screen
                name="admin/reports/integrity"
                options={{ title: 'Integrity training report' }}
              />
            </Stack.Protected>
            <Stack.Protected guard={affiliation}>
              <Stack.Screen name="admin/affiliation/index" options={{ title: 'Affiliation' }} />
              <Stack.Screen
                name="admin/affiliation/registrations"
                options={{ title: 'PlayHQ registrations' }}
              />
              <Stack.Screen name="admin/reports/affiliation" options={{ title: 'Affiliation' }} />
              <Stack.Screen
                name="admin/affiliation/return"
                options={{ title: 'Affiliation return' }}
              />
            </Stack.Protected>
            <Stack.Protected guard={features.calendar || features.awards || features.goals}>
              <Stack.Screen name="admin/fixtures" options={{ title: 'Fixtures' }} />
            </Stack.Protected>
          </Stack.Protected>
        </Stack.Protected>
        <Stack.Protected guard={!club}>
          <Stack.Screen name="choose-club" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!session && !!club}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="club/[code]" options={{ headerShown: false }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
      </Stack>
      {introDone ? null : <BrandIntro onDone={finishIntro} />}
    </>
  );
}
