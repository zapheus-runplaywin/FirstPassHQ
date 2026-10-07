import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateString, injuryStatusLabels } from '@/lib/injuries';
import type { Injury, InjuryStatus } from '@/lib/types';

type InjurySummary = Pick<
  Injury,
  | 'id'
  | 'athlete_name'
  | 'body_area'
  | 'injured_on'
  | 'restrictions'
  | 'expected_return'
  | 'status'
  | 'cleared_at'
> & { waiting_for_me?: boolean };

/** A summary of one injury: who, where, status, restrictions and expected return. */
export function InjuryCard({
  injury,
  showAthlete,
}: {
  injury: InjurySummary;
  showAthlete: boolean;
}) {
  return (
    <PressableCard
      onPress={() => router.push({ pathname: '/injuries/[id]', params: { id: injury.id } })}>
      <ThemedText type="smallBold" numberOfLines={2}>
        {showAthlete ? `${injury.athlete_name ?? 'Unnamed athlete'} · ` : ''}
        {injury.body_area}
      </ThemedText>
      <StatusPill status={injury.status} />
      {injury.restrictions ? (
        <ThemedText type="small" numberOfLines={2}>
          Restrictions: {injury.restrictions}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {injury.status === 'cleared' && injury.cleared_at
          ? `Cleared ${formatDateString(injury.cleared_at.slice(0, 10))}`
          : injury.expected_return
            ? `Expected back ${formatDateString(injury.expected_return)}`
            : `Injured ${formatDateString(injury.injured_on)}`}
      </ThemedText>
      {injury.waiting_for_me ? <WaitingForYou /> : null}
    </PressableCard>
  );
}

/** Red while injured, amber while waiting for sign-off, green once cleared. */
const statusColours: Record<InjuryStatus, string> = {
  injured: '#FF8A8A',
  clearance_requested: '#FFB547',
  coach_endorsed: '#FFB547',
  cleared: '#5BD68A',
};

export function StatusPill({ status }: { status: InjuryStatus }) {
  const colour = statusColours[status];
  return (
    <View style={[styles.pill, { borderColor: colour }]}>
      <ThemedText type="small" style={{ color: colour }}>
        {injuryStatusLabels[status]}
      </ThemedText>
    </View>
  );
}

function WaitingForYou() {
  const theme = useTheme();
  return (
    <ThemedText type="smallBold" style={{ color: theme.accent }}>
      Waiting for your sign-off
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderWidth: 1,
  },
});
