import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { ballotLabel, closesLabel, slotTitle, useAwardSlots } from '@/lib/awards';
import type { AwardSlot } from '@/lib/types';

/** The award votes open to the member, waiting ones first. */
export default function AwardsScreen() {
  const theme = useTheme();
  const { isAdmin } = useAuth();
  const { awardSlots, reloadAwardSlots } = useAwardSlots();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await reloadAwardSlots();
    setRefreshing(false);
  }

  const waiting = awardSlots.filter((s) => !s.voted);
  const voted = awardSlots.filter((s) => s.voted);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Votes are secret. Only club admins see the results, and nobody sees who you voted for. You
        can change your vote until it closes.
      </ThemedText>

      {awardSlots.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          There are no votes open for you right now. Match votes open when the game starts.
        </ThemedText>
      ) : null}

      {waiting.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Waiting for your vote
          </ThemedText>
          {waiting.map((slot) => (
            <SlotRow key={slotKey(slot)} slot={slot} />
          ))}
        </View>
      ) : null}

      {voted.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Voted</ThemedText>
          {voted.map((slot) => (
            <SlotRow key={slotKey(slot)} slot={slot} />
          ))}
        </View>
      ) : null}

      {isAdmin ? (
        <Button
          title="Manage awards"
          variant="secondary"
          onPress={() => router.push('/admin/awards')}
        />
      ) : null}
    </Screen>
  );
}

function slotKey(slot: AwardSlot) {
  return [slot.award_id, slot.team_id, slot.fixture_id, slot.preseason].join(':');
}

function SlotRow({ slot }: { slot: AwardSlot }) {
  const detail = slotTitle(slot);
  return (
    <PressableCard
      onPress={() =>
        router.push({
          pathname: '/awards/vote',
          params: {
            award: slot.award_id,
            team: slot.team_id ?? '',
            fixture: slot.fixture_id ?? '',
            preseason: slot.preseason ? '1' : '',
          },
        })
      }>
      <View style={styles.rowHeader}>
        <ThemedText type="smallBold" style={styles.flex}>
          {slot.award_name}
        </ThemedText>
        {slot.voted ? <ThemedText type="smallBold">✓</ThemedText> : null}
      </View>
      {detail ? <ThemedText type="small">{detail}</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">
        {ballotLabel(slot.points)} · {closesLabel(slot.closes_at)}
      </ThemedText>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
});
