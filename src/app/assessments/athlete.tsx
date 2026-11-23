import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  attendanceLine,
  buildPicture,
  contextLabels,
  ratingLines,
  tallyLabel,
  type AthleteAssessment,
  type Observation,
  type RoundAttendance,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * One athlete's assessment in a round, for the panel: what has been seen
 * against each of the criteria so far, then every observation, newest first.
 * There is no total or score. Opening an under 18's is recorded by the
 * database in their record views.
 */
export default function AthleteAssessmentScreen() {
  const { round, athlete } = useLocalSearchParams<{ round: string; athlete: string }>();
  const [assessment, setAssessment] = useState<AthleteAssessment | null>(null);
  const [attendance, setAttendance] = useState<RoundAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('athlete_assessment', {
      p_round_id: round,
      p_athlete_id: athlete,
    });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    // Two counts from attendance, and nothing else: never an absence or its reason.
    const { data: counts } = await supabase
      .rpc('athlete_round_attendance', { p_round_id: round, p_athlete_id: athlete })
      .maybeSingle();
    setError(null);
    setAttendance((counts as RoundAttendance | null) ?? null);
    setAssessment(data as AthleteAssessment);
  }, [round, athlete]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!assessment) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const picture = buildPicture(assessment.criteria, assessment.observations);
  const attended = attendanceLine(attendance);

  function observe(params: { id?: string; corrects?: string } = {}) {
    router.push({ pathname: '/assessments/observe', params: { round, athlete, ...params } });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="subtitle">{assessment.athlete_name ?? 'Athlete'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {assessment.round_name}
        {assessment.closed ? ' · closed' : ''} ·{' '}
        {picture.observations === 0
          ? 'nothing written yet'
          : `${picture.observations} ${picture.observations === 1 ? 'observation' : 'observations'} from ${
              picture.selectors
            } ${picture.selectors === 1 ? 'selector' : 'selectors'}`}
      </ThemedText>
      {attended ? (
        <ThemedText type="small" themeColor="textSecondary">
          {attended}
        </ThemedText>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {assessment.closed ? null : <Button title="Add an observation" onPress={() => observe()} />}
      <Button
        title="My summary"
        variant="secondary"
        onPress={() => router.push({ pathname: '/assessments/summary', params: { round, athlete } })}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Your own view at the end of the round: a step for each of the criteria, a recommendation
        and a few words, which you sign. You see the other selectors’ summaries once you have
        signed yours.
      </ThemedText>

      {picture.observations > 0 ? (
        <>
          <ThemedText type="subtitle">The picture so far</ThemedText>
          {picture.groups
            .filter((group) => group.count > 0)
            .map((group) => {
              const unseen = group.items.filter((item) => item.count === 0);
              return (
                <Card key={group.key} style={styles.card}>
                  <ThemedText type="smallBold">{group.name}</ThemedText>
                  {group.items
                    .filter((item) => item.count > 0)
                    .map((item) => (
                      <View key={item.key}>
                        <ThemedText type="small">{item.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {tallyLabel(group.scale, item.tally)} · seen {item.count}{' '}
                          {item.count === 1 ? 'time' : 'times'} by {item.selectors}{' '}
                          {item.selectors === 1 ? 'selector' : 'selectors'}
                        </ThemedText>
                      </View>
                    ))}
                  {unseen.length > 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      Nothing yet on: {unseen.map((item) => item.name).join(', ')}
                    </ThemedText>
                  ) : null}
                </Card>
              );
            })}
          {picture.missing.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing yet on: {picture.missing.join(', ')}
            </ThemedText>
          ) : null}

          <ThemedText type="subtitle">Observations</ThemedText>
          {assessment.observations.map((o) => (
            <ObservationCard
              key={o.id}
              observation={o}
              assessment={assessment}
              onChange={() => observe({ id: o.id })}
              onCorrect={() => observe({ corrects: o.id })}
            />
          ))}
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          A line after training or a game is enough. Over the round they add up to a picture of
          the athlete against each of the criteria.
        </ThemedText>
      )}
    </Screen>
  );
}

function ObservationCard({
  observation: o,
  assessment,
  onChange,
  onCorrect,
}: {
  observation: Observation;
  assessment: AthleteAssessment;
  onChange: () => void;
  onCorrect: () => void;
}) {
  const corrected = o.corrects_id
    ? assessment.observations.find((other) => other.id === o.corrects_id)
    : null;
  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold">
        {formatDateString(o.observed_on)} · {contextLabels[o.context]} · {o.mine ? 'You' : o.author_name}
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
      {o.can_change ? <Button title="Change" variant="secondary" onPress={onChange} /> : null}
      {o.mine && !o.can_change && !assessment.closed ? (
        <Button title="Add a correction" variant="secondary" onPress={onCorrect} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
});
