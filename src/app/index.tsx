import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EventCard } from '@/components/event-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { roleLabels, teamPositionLabel } from '@/lib/labels';
import { formatDay } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useEvents } from '@/lib/use-events';

const UPCOMING_COUNT = 5;

export default function HomeScreen() {
  const theme = useTheme();
  const { session, profile, memberships, isAdmin, refresh, signOut } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const { events, reload: reloadEvents } = useEvents();

  const loadPendingCount = useCallback(async () => {
    if (!isAdmin) return;
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .not('join_requested_at', 'is', null);
    setPendingCount(count ?? 0);
  }, [isAdmin]);

  useFocusEffect(
    useCallback(() => {
      loadPendingCount();
    }, [loadPendingCount]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refresh(), loadPendingCount(), reloadEvents()]);
    setRefreshing(false);
  }

  const name = profile?.full_name || session?.user.email || 'there';
  const approved = profile?.status === 'approved';

  return (
    <Screen withTopInset refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Hi {name}</ThemedText>
        {approved && profile ? (
          <ThemedText themeColor="textSecondary">{roleLabels[profile.role]}</ThemedText>
        ) : null}
      </View>

      {!approved ? <JoinStatus /> : null}

      {isAdmin ? (
        <PressableCard onPress={() => router.push('/admin')}>
          <ThemedText type="smallBold">Members</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {pendingCount === 0
              ? 'No requests waiting'
              : `${pendingCount} ${pendingCount === 1 ? 'request' : 'requests'} waiting for approval`}
          </ThemedText>
        </PressableCard>
      ) : null}

      {isAdmin ? (
        <PressableCard onPress={() => router.push('/admin/calendars')}>
          <ThemedText type="smallBold">Calendars</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Add the club calendar and team calendars
          </ThemedText>
        </PressableCard>
      ) : null}

      {approved ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Coming up</ThemedText>
            <Pressable accessibilityRole="button" onPress={() => router.push('/calendar')}>
              <ThemedText type="small" style={{ color: theme.tint }}>
                Full calendar
              </ThemedText>
            </Pressable>
          </View>
          {events === null ? null : events.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing on the calendar yet.
            </ThemedText>
          ) : (
            events.slice(0, UPCOMING_COUNT).map((event) => (
              <View key={event.id} style={styles.upcoming}>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDay(event.start)}
                </ThemedText>
                <EventCard event={event} />
              </View>
            ))
          )}
        </View>
      ) : null}

      {approved ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">My teams</ThemedText>
          {memberships.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              You are not in a team yet.
            </ThemedText>
          ) : (
            memberships.map((m) => (
              <PressableCard
                key={m.team.id}
                onPress={() => router.push({ pathname: '/team/[id]', params: { id: m.team.id } })}>
                <ThemedText type="smallBold">{m.team.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {teamPositionLabel(m.team_role, m.coach_title)}
                </ThemedText>
              </PressableCard>
            ))
          )}
        </View>
      ) : null}

      <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOut}>
        <ThemedText type="small" style={{ color: theme.tint }}>
          Sign out
        </ThemedText>
      </Pressable>
    </Screen>
  );
}

function JoinStatus() {
  const { profile } = useAuth();

  if (profile?.status === 'rejected') {
    return (
      <Card>
        <ThemedText type="smallBold">Request not approved</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Your request to join was not approved. Check your details and try again, or contact the
          club.
        </ThemedText>
        <View style={styles.cardAction}>
          <Button title="Request again" onPress={() => router.push('/join')} />
        </View>
      </Card>
    );
  }

  if (!profile?.join_requested_at) {
    return (
      <Card>
        <ThemedText type="smallBold">Request to join the club</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Tell us who you are so an admin can add you to your team.
        </ThemedText>
        <View style={styles.cardAction}>
          <Button title="Request to join" onPress={() => router.push('/join')} />
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <ThemedText type="smallBold">Waiting for approval</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        A club admin will approve your request and add you to your team. Pull down to check again.
      </ThemedText>
      <View style={styles.cardAction}>
        <Button title="Edit request" variant="secondary" onPress={() => router.push('/join')} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  upcoming: {
    gap: Spacing.one,
  },
  cardAction: {
    marginTop: Spacing.two,
  },
  signOut: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
  },
});
