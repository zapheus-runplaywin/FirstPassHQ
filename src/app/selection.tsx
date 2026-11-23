import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  dueLabel,
  roundDates,
  selectionInfoOwner,
  useMySelectionInfo,
  type SelectionInfo,
} from '@/lib/assessments';
import { clubToday } from '@/lib/club-time';
import { formatDateString } from '@/lib/injuries';

/**
 * What an athlete in a selection round, or the verified parent of one under
 * 18, is shown: what the selectors look for and the dates the club shares.
 * Nothing a selector has written is here, and nobody answers or comments.
 */
export default function SelectionScreen() {
  const { selectionInfo, reloadSelectionInfo } = useMySelectionInfo();
  const [refreshing, setRefreshing] = useState(false);
  const today = clubToday();

  async function onRefresh() {
    setRefreshing(true);
    await reloadSelectionInfo();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {selectionInfo.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          There is no selection round open for you now.
        </ThemedText>
      ) : (
        selectionInfo.map((info) => (
          <RoundInfo key={`${info.round_id}-${info.athlete_id}`} info={info} today={today} />
        ))
      )}
      <ThemedText type="small" themeColor="textSecondary">
        Selectors watch training, trials and games across the whole round and write down what
        they see against these criteria. There is no score or ranking. Ask your coach if you
        have a question about selection.
      </ThemedText>
    </Screen>
  );
}

function RoundInfo({ info, today }: { info: SelectionInfo; today: string }) {
  return (
    <View style={styles.round}>
      <ThemedText type="subtitle">
        {info.is_me ? info.round_name : `${selectionInfoOwner(info)}: ${info.round_name}`}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {info.team_name} · {roundDates(info)}
      </ThemedText>

      <Card style={styles.card}>
        <ThemedText type="smallBold">Dates</ThemedText>
        {info.dates.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            The club hasn’t shared any dates yet.
          </ThemedText>
        ) : (
          info.dates.map((date) => (
            <ThemedText key={`${date.title}-${date.due_on}`} type="small">
              {formatDateString(date.due_on)} · {date.title}
              {date.done ? ' · Done' : date.due_on >= today ? ` · ${dueLabel(date, today)}` : ''}
            </ThemedText>
          ))
        )}
      </Card>

      <ThemedText type="smallBold">What the selectors look for</ThemedText>
      {info.criteria.groups.map((group) => (
        <Card key={group.key} style={styles.card}>
          <ThemedText type="smallBold">{group.name}</ThemedText>
          <ThemedText type="small">{group.items.map((item) => item.name).join(', ')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Seen as: {group.scale.join(', ')}
          </ThemedText>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  round: { gap: Spacing.two },
  card: { gap: Spacing.one },
});
