import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { CoachTitle, Team, TeamRole } from '@/lib/types';

const teamRoleLabels: Record<TeamRole, string> = {
  coach: 'Coach',
  manager: 'Manager',
  athlete: 'Athlete',
};

const coachTitleLabels: Record<CoachTitle, string> = {
  head_coach: 'Head Coach',
  assistant_coach: 'Assistant Coach',
};

export default function HomeScreen() {
  const theme = useTheme();
  const { session, profile, memberships, refresh, signOut } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    supabase
      .from('teams')
      .select('id, name, sort_order')
      .order('sort_order')
      .then(({ data }) => setTeams(data ?? []));
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const name = profile?.full_name || session?.user.email || 'there';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          <ThemedText type="subtitle">Hi {name}</ThemedText>

          {profile?.status !== 'approved' ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">Waiting for approval</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {profile?.status === 'rejected'
                  ? 'Your request to join was not approved. Contact the club if you think this is a mistake.'
                  : 'A club admin needs to approve your account and add you to your team. Pull down to check again.'}
              </ThemedText>
            </View>
          ) : null}

          <View style={styles.section}>
            <ThemedText type="smallBold">My teams</ThemedText>
            {memberships.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                You are not in a team yet.
              </ThemedText>
            ) : (
              memberships.map((m) => (
                <View
                  key={m.team.id}
                  style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{m.team.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {m.coach_title ? coachTitleLabels[m.coach_title] : teamRoleLabels[m.team_role]}
                  </ThemedText>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">Club teams</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {teams.map((t) => t.name).join(' · ')}
            </ThemedText>
          </View>

          <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOut}>
            <ThemedText type="small" style={{ color: theme.tint }}>
              Sign out
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    padding: Spacing.three,
    borderRadius: 12,
    gap: Spacing.one,
  },
  signOut: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
  },
});
