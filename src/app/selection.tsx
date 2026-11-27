import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Fold } from '@/components/member-tabs';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  dueLabel,
  feedbackHeading,
  releasedHeading,
  groupRounds,
  roundTitle,
  shortDate,
  shortRange,
  selectionInfoOwner,
  useMySelectionFeedback,
  useMyReleasedAssessments,
  useMySelectionInfo,
  type ReleasedAssessment,
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
  const { selectionReleases, reloadSelectionReleases } = useMyReleasedAssessments();
  const [refreshing, setRefreshing] = useState(false);
  const today = clubToday();
  // One short block per athlete: the member first, then each child.
  const athletes = [...new Map(selectionInfo.map((i) => [i.athlete_id, [] as SelectionInfo[]])).entries()];
  for (const info of selectionInfo) athletes.find(([id]) => id === info.athlete_id)?.[1].push(info);

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
    await Promise.all([reloadSelectionInfo(), reloadSelectionFeedback(), reloadSelectionReleases()]);
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {selectionReleases.map((release) => (
        <ReleaseRow key={`release-${release.round_id}-${release.athlete_id}`} release={release} />
      ))}
      {selectionFeedback.map((feedback) => (
        <FeedbackCard key={`${feedback.round_id}-${feedback.athlete_id}`} feedback={feedback} />
      ))}
      {selectionInfo.length === 0 ? (
        selectionFeedback.length > 0 || selectionReleases.length > 0 ? null : (
          <ThemedText type="small" themeColor="textSecondary">
            There is no selection round open for you now.
          </ThemedText>
        )
      ) : (
        athletes.map(([athleteId, rounds]) => (
          <AthleteRounds
            key={athleteId}
            rounds={rounds}
            today={today}
            heading={rounds[0].is_me ? null : selectionInfoOwner(rounds[0])}
          />
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

/** A released assessment: New in bold until first opened. Opens it to read. */
function ReleaseRow({ release }: { release: ReleasedAssessment }) {
  return (
    <PressableCard
      onPress={() =>
        router.push({ pathname: '/selection-assessment', params: { round: release.round_id, athlete: release.athlete_id } })
      }>
      <ThemedText type="smallBold">
        {releasedHeading(release)}
        {release.is_new ? ' · New' : ''}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        From {release.from_name}, {shortDate(release.released_on)}
      </ThemedText>
    </PressableCard>
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

/** One athlete's rounds: the one running now, those coming up, and any past its end date. */
function AthleteRounds({ rounds, today, heading }: { rounds: SelectionInfo[]; today: string; heading: string | null }) {
  const { now, coming, finished } = groupRounds(rounds, today);
  return (
    <View style={styles.round}>
      {heading ? <ThemedText type="subtitle">{heading}</ThemedText> : null}
      {now.length > 0 ? <ThemedText type="smallBold">Now</ThemedText> : null}
      {now.map((info) => (
        <Card key={info.round_id} style={styles.card}>
          <ThemedText type="smallBold">{roundTitle(info)} · Now</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {info.team_name} · {shortRange(info)}
          </ThemedText>
          {info.criteria_set_name ? (
            <ThemedText type="small">Assessed against: {info.criteria_set_name}</ThemedText>
          ) : null}
          <RoundFolds info={info} today={today} />
        </Card>
      ))}
      {coming.length > 0 ? <ThemedText type="smallBold">Coming up</ThemedText> : null}
      {coming.map((info) => (
        <Fold
          key={info.round_id}
          title={`${roundTitle(info)} · ${shortRange(info)}${info.criteria_set_name ? ` · ${info.criteria_set_name}` : ''}`}>
          <RoundFolds info={info} today={today} />
        </Fold>
      ))}
      {finished.length > 0 ? <ThemedText type="smallBold">Finished</ThemedText> : null}
      {finished.map((info) => (
        <ThemedText key={info.round_id} type="small" themeColor="textSecondary">
          {roundTitle(info)} · Ended {shortDate(info.ends_on)}
        </ThemedText>
      ))}
    </View>
  );
}

/** A round's shared dates and its criteria, each folded to one line. */
function RoundFolds({ info, today }: { info: SelectionInfo; today: string }) {
  const next = info.dates.filter((d) => !d.done && d.due_on >= today).sort((a, b) => a.due_on.localeCompare(b.due_on))[0];
  return (
    <>
      <Fold title={`Dates (${info.dates.length})${next ? ` · Next: ${next.title}, ${dueLabel(next, today)}` : ''}`}>
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
      </Fold>
      <Fold
        title={`What the selectors look for · ${info.criteria.groups.length} ${info.criteria.groups.length === 1 ? 'group' : 'groups'}`}>
        {info.criteria.groups.map((group) => (
          <View key={group.key} style={styles.card}>
            <ThemedText type="smallBold">{group.name}</ThemedText>
            <ThemedText type="small">{group.items.map((item) => item.name).join(', ')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Seen as: {group.scale.join(', ')}
            </ThemedText>
          </View>
        ))}
      </Fold>
    </>
  );
}

const styles = StyleSheet.create({
  round: { gap: Spacing.two },
  card: { gap: Spacing.one },
});
