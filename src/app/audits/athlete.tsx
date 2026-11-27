import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardGrid } from '@/components/columns';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  buildPicture,
  contextLabels,
  ratingLines,
  tallyLabel,
  type AuditorAssessment,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

const day = (at: string) => formatDateString(at.slice(0, 10));

/**
 * One athlete's whole assessment, for the round's auditor: the picture, every
 * observation, every signed summary with its history, and shared feedback.
 * Read only: there is nothing here to press that changes anything. Opening
 * an under 18's is recorded by the database in their record views.
 */
export default function AuditAthleteScreen() {
  const { round, athlete } = useLocalSearchParams<{ round: string; athlete: string }>();
  const [assessment, setAssessment] = useState<AuditorAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'picture' | 'observations' | 'summaries' | 'feedback'>('picture');

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('auditor_athlete_assessment', {
      p_round_id: round,
      p_athlete_id: athlete,
    });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError(null);
    setAssessment(data as AuditorAssessment);
  }, [round, athlete]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!assessment) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const picture = buildPicture(assessment.criteria, assessment.observations);
  const feedback = assessment.feedback;

  return (
    <Screen>
      <ThemedText type="subtitle">{assessment.athlete_name ?? 'Athlete'}</ThemedText>
      <ChipGroup
        options={[
          { value: 'picture' as const, label: 'Picture' },
          { value: 'observations' as const, label: `Observations (${assessment.observations.length})` },
          { value: 'summaries' as const, label: `Summaries (${assessment.summaries.length})` },
          { value: 'feedback' as const, label: 'Feedback' },
        ]}
        selected={[tab]}
        onToggle={setTab}
      />

      {tab === 'picture' ? (
        picture.observations === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing written yet.
          </ThemedText>
        ) : (
          <>
            {picture.groups
              .filter((group) => group.count > 0)
              .map((group) => (
                <Card key={group.key} style={styles.card}>
                  <ThemedText type="smallBold">{group.name}</ThemedText>
                  {group.items
                    .filter((item) => item.count > 0)
                    .map((item) => (
                      <View key={item.key}>
                        <ThemedText type="small">{item.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {tallyLabel(group.scale, item.tally)} · seen {item.count} {item.count === 1 ? 'time' : 'times'} by{' '}
                          {item.selectors} {item.selectors === 1 ? 'selector' : 'selectors'}
                        </ThemedText>
                      </View>
                    ))}
                </Card>
              ))}
            {picture.missing.length > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing yet on: {picture.missing.join(', ')}
              </ThemedText>
            ) : null}
          </>
        )
      ) : null}

      {tab === 'observations'
        ? assessment.observations.map((o) => {
            const corrected = o.corrects_id ? assessment.observations.find((other) => other.id === o.corrects_id) : null;
            return (
              <Card key={o.id} style={styles.card}>
                <ThemedText type="smallBold">
                  {formatDateString(o.observed_on)} · {contextLabels[o.context]} · {o.author_name}
                </ThemedText>
                {o.corrects_id ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Corrects {corrected ? `the observation of ${formatDateString(corrected.observed_on)}` : 'an earlier observation'}
                  </ThemedText>
                ) : null}
                {ratingLines(assessment.criteria, o.ratings).map((line) => (
                  <ThemedText key={line} type="small" themeColor="textSecondary">
                    {line}
                  </ThemedText>
                ))}
                {o.note ? <ThemedText type="small">{o.note}</ThemedText> : null}
              </Card>
            );
          })
        : null}

      {tab === 'summaries' ? (
        <>
          {assessment.summaries.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No selector has signed a summary yet.
            </ThemedText>
          ) : (
            <CardGrid gap={Spacing.four}>
              {assessment.summaries.map((s) => (
                <Card key={s.id} style={styles.card}>
                  <ThemedText type="smallBold">{s.author_name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Signed {day(s.signed_at)}
                  </ThemedText>
                  {s.recommendation ? <ThemedText type="small">Recommendation: {s.recommendation}</ThemedText> : null}
                  {ratingLines(assessment.criteria, s.ratings).map((line) => (
                    <ThemedText key={line} type="small" themeColor="textSecondary">
                      {line}
                    </ThemedText>
                  ))}
                  {s.strengths ? <ThemedText type="small">Strengths: {s.strengths}</ThemedText> : null}
                  {s.priorities ? <ThemedText type="small">Priorities: {s.priorities}</ThemedText> : null}
                  {s.comments ? <ThemedText type="small">Comments: {s.comments}</ThemedText> : null}
                </Card>
              ))}
            </CardGrid>
          )}
          {assessment.unsigned > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {assessment.unsigned === 1 ? '1 selector hasn’t' : `${assessment.unsigned} selectors haven’t`} signed.
            </ThemedText>
          ) : null}
          {assessment.summary_events.length > 0 ? (
            <>
              <ThemedText type="smallBold">Signing history</ThemedText>
              {assessment.summary_events.map((e, n) => (
                <ThemedText key={n} type="small" themeColor="textSecondary">
                  {day(e.at)} · {e.author_name}’s summary {e.kind === 'signed' ? 'signed' : 'reopened'}
                  {e.late ? ' late' : ''}
                  {e.kind === 'reopened' ? ` by ${e.by_name}` : ''}
                </ThemedText>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'feedback' ? (
        <>
          {feedback === null ? (
            <ThemedText type="small" themeColor="textSecondary">
              No feedback for this athlete.
            </ThemedText>
          ) : 'draft' in feedback ? (
            <ThemedText type="small" themeColor="textSecondary">
              The head coach has a draft that isn’t shared.
            </ThemedText>
          ) : (
            <Card style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">
                From {feedback.author_name}, shared {day(feedback.shared_at)}
                {feedback.seen_at ? `, first read ${day(feedback.seen_at)}` : ', not read yet'}
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
            </Card>
          )}
          {assessment.feedback_events.map((e, n) => (
            <ThemedText key={n} type="small" themeColor="textSecondary">
              {day(e.at)} · {e.kind === 'shared' ? 'Shared' : 'Taken back'} by {e.by_name}
            </ThemedText>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
});
