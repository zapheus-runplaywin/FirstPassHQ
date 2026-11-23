import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  dueLabel,
  feedbackHeading,
  roundDates,
  selectionInfoOwner,
  useMySelectionFeedback,
  useMySelectionInfo,
  type SelectionInfo,
  type SharedFeedback,
} from '@/lib/assessments';
import { clubToday } from '@/lib/club-time';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * What an athlete in a selection round, or the verified parent of one under
 * 18, is shown: feedback the head coach chose to share, first, then what
 * the selectors look for and the dates the club shares. Nothing else a
 * selector has written is here, and nobody answers or comments.
 */
export default function SelectionScreen() {
  const { selectionInfo, reloadSelectionInfo } = useMySelectionInfo();
  const { selectionFeedback, reloadSelectionFeedback } = useMySelectionFeedback();
  const [refreshing, setRefreshing] = useState(false);
  const today = clubToday();

  // The first time the athlete or a parent opens shared feedback is kept, so
  // the head coach can tell it was read.
  const shown = selectionFeedback.map((f) => `${f.round_id}/${f.athlete_id}`).join(',');
  useEffect(() => {
    for (const key of shown ? shown.split(',') : []) {
      const [round, athlete] = key.split('/');
      supabase.rpc('mark_selection_feedback_seen', { p_round_id: round, p_athlete_id: athlete }).then(() => {});
    }
  }, [shown]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([reloadSelectionInfo(), reloadSelectionFeedback()]);
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {selectionFeedback.map((feedback) => (
        <FeedbackCard key={`${feedback.round_id}-${feedback.athlete_id}`} feedback={feedback} />
      ))}
      {selectionInfo.length === 0 ? (
        selectionFeedback.length > 0 ? null : (
          <ThemedText type="small" themeColor="textSecondary">
            There is no selection round open for you now.
          </ThemedText>
        )
      ) : (
        selectionInfo.map((info) => (
          <RoundInfo key={`${info.round_id}-${info.athlete_id}`} info={info} today={today} />
        ))
      )}
      {selectionInfo.length > 0 || selectionFeedback.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Selectors watch training, trials and games across the whole round and write down what
          they see against these criteria. There is no score or ranking. Ask your coach if you
          have a question about selection.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

function FeedbackCard({ feedback }: { feedback: SharedFeedback }) {
  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold">{feedbackHeading(feedback)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {feedback.round_name} · from {feedback.from_name}, {formatDateString(feedback.shared_on)}
      </ThemedText>
      {feedback.went_well ? (
        <>
          <ThemedText type="smallBold">What went well</ThemedText>
          <ThemedText type="small">{feedback.went_well}</ThemedText>
        </>
      ) : null}
      {feedback.work_on ? (
        <>
          <ThemedText type="smallBold">What to work on</ThemedText>
          <ThemedText type="small">{feedback.work_on}</ThemedText>
        </>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        You can’t reply here. Talk to your coach if you have a question.
      </ThemedText>
    </Card>
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
