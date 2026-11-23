import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  MAX_FEEDBACK_TEXT,
  feedbackProblem,
  feedbackReaders,
  nextForFeedback,
  type AthleteFeedback,
  type FeedbackStatus,
  type RoundSheet,
  type SheetAthlete,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * Feedback for one athlete in a round. The head coach writes two boxes, saves
 * a draft only they see, and shares it when ready: the athlete and, under 18,
 * their verified parents then read it under Selection, and so does the panel.
 * Shared feedback is locked until the head coach takes it back. Nobody can
 * reply to it in the app.
 */
export default function FeedbackScreen() {
  const { round, athlete } = useLocalSearchParams<{ round: string; athlete: string }>();
  const [loaded, setLoaded] = useState<AthleteFeedback | null>(null);
  const [wentWell, setWentWell] = useState('');
  const [workOn, setWorkOn] = useState('');
  const [next, setNext] = useState<SheetAthlete | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('athlete_feedback', {
      p_round_id: round,
      p_athlete_id: athlete,
    });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const feedback = data as AthleteFeedback;
    setError(null);
    setLoaded(feedback);
    setWentWell(feedback.feedback?.went_well ?? '');
    setWorkOn(feedback.feedback?.work_on ?? '');
    if (!feedback.can_write) return;
    // The next athlete with nothing shared, to move on without going back.
    const { data: sheet } = await supabase.rpc('selection_round_sheet', { p_round_id: round });
    const { data: statuses } = await supabase.rpc('selection_round_feedback', { p_round_id: round });
    setNext(
      nextForFeedback((sheet as RoundSheet | null)?.athletes ?? [], (statuses as FeedbackStatus[] | null) ?? [], athlete),
    );
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

  if (!loaded) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const { feedback } = loaded;
  const name = loaded.athlete_name ?? 'Athlete';

  async function save(share: boolean) {
    const problem = feedbackProblem(wentWell, workOn, share);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: saveError } = await supabase.rpc('save_assessment_feedback', {
      p_round_id: round,
      p_athlete_id: athlete,
      p_went_well: wentWell.trim(),
      p_work_on: workOn.trim(),
      p_share: share,
    });
    if (saveError) {
      setBusy(false);
      setError(saveError.message);
      return;
    }
    await load();
    setBusy(false);
    setSaved(!share);
  }

  async function takeBack() {
    setBusy(true);
    setError(null);
    const { error: backError } = await supabase.rpc('withdraw_assessment_feedback', {
      p_round_id: round,
      p_athlete_id: athlete,
    });
    if (backError) setError(backError.message);
    else await load();
    setBusy(false);
  }

  const heading = (
    <>
      <ThemedText type="subtitle">{name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {loaded.round_name}
        {loaded.closed ? ' · closed' : ''}
      </ThemedText>
    </>
  );
  const onwards =
    next && loaded.can_write ? (
      <Button
        title={`Next: ${next.name ?? 'Athlete'}`}
        variant="secondary"
        onPress={() => router.replace({ pathname: '/assessments/feedback', params: { round, athlete: next.id } })}
      />
    ) : null;

  // Shared, or a draft nobody can change now: read only.
  if (feedback && (feedback.shared_at || !loaded.can_write)) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        {heading}
        <ThemedText type="smallBold">
          {feedback.shared_at
            ? `Shared by ${feedback.author_name} on ${formatDateString(feedback.shared_at.slice(0, 10))} · ${
                feedback.seen_at ? `first read ${formatDateString(feedback.seen_at.slice(0, 10))}` : 'not read yet'
              }`
            : 'A draft that was never shared'}
        </ThemedText>
        <ErrorText>{error}</ErrorText>
        {feedback.went_well ? (
          <Card style={styles.card}>
            <ThemedText type="smallBold">What went well</ThemedText>
            <ThemedText type="small">{feedback.went_well}</ThemedText>
          </Card>
        ) : null}
        {feedback.work_on ? (
          <Card style={styles.card}>
            <ThemedText type="smallBold">What to work on</ThemedText>
            <ThemedText type="small">{feedback.work_on}</ThemedText>
          </Card>
        ) : null}
        {onwards}
        {loaded.can_write ? (
          <ConfirmDelete
            title="Take back to change"
            warning={`${name} will no longer see this feedback until you share it again. Taking it back is kept in the audit report.`}
            confirmTitle="Take it back"
            onConfirm={takeBack}
            busy={busy}
          />
        ) : null}
      </Screen>
    );
  }

  if (!loaded.can_write) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        {heading}
        <ThemedText type="small" themeColor="textSecondary">
          {loaded.closed
            ? 'No feedback was shared with this athlete.'
            : 'The head coach hasn’t shared feedback with this athlete yet.'}
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {heading}
      <TextField
        label="What went well"
        value={wentWell}
        onChangeText={setWentWell}
        placeholder="Such as “Strong, early leads into space”"
        multiline
        maxLength={MAX_FEEDBACK_TEXT}
      />
      <TextField
        label="What to work on"
        value={workOn}
        onChangeText={setWorkOn}
        placeholder="Such as “Left-hand pass under pressure”"
        multiline
        maxLength={MAX_FEEDBACK_TEXT}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Only you see a draft. Nothing about health, injuries or wellbeing goes here.
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      {saved ? (
        <ThemedText type="small" themeColor="textSecondary">
          Draft saved.
        </ThemedText>
      ) : null}
      <Button title="Save draft" variant="secondary" onPress={() => save(false)} busy={busy} />
      <ConfirmDelete
        title={`Share with ${name}`}
        warning={feedbackReaders(loaded)}
        confirmTitle="Share now"
        onConfirm={() => save(true)}
        busy={busy}
      />
      {onwards}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
});
