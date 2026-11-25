import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CheckInHistory } from '@/components/check-in-history';
import { CheckInScale } from '@/components/check-in-scale';
import { RaiseConcernLink } from '@/components/safeguarding';
import { SessionLogSection } from '@/components/session-log-form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import {
  CHECK_IN_COLUMNS,
  allAnswered,
  answersFromParams,
  checkInPrivacy,
  checkInQuestions,
  noAnswers,
  today,
  type CheckInAnswers,
} from '@/lib/check-ins';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { CheckIn, CheckInScores } from '@/lib/types';

/** How many days of history an athlete sees. */
const HISTORY_DAYS = 14;

export default function CheckInScreen() {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const [history, setHistory] = useState<CheckIn[] | null>(null);
  // The answers already tapped on Today's check-in sheet, when "Add a note" brought them here.
  const started = answersFromParams(useLocalSearchParams());
  const [edited, setEdited] = useState<CheckInAnswers | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const since = new Date();
    since.setDate(since.getDate() - HISTORY_DAYS);
    const { data } = await supabase
      .from('check_ins')
      .select(CHECK_IN_COLUMNS)
      .eq('athlete_id', userId)
      .gte('day', toDateString(since))
      .order('day', { ascending: false });
    setHistory((data as CheckIn[] | null) ?? []);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Today's saved check-in fills the form, so it can be changed.
  const saved = history?.find((c) => c.day === today()) ?? null;
  const answers: CheckInAnswers = edited ?? { ...(saved ? { ...saved } : noAnswers), ...started };
  const noteValue = note ?? saved?.note ?? '';

  function answer(key: keyof CheckInScores, value: number) {
    setEdited({ ...answers, [key]: value });
  }

  async function save() {
    if (!allAnswered(answers)) {
      setError('Answer all four questions.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_check_in', {
      p_day: today(),
      p_sleep: answers.sleep,
      p_soreness: answers.soreness,
      p_stress: answers.stress,
      p_mood: answers.mood,
      p_note: noteValue,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        {`Thirty seconds a day. ${checkInPrivacy(!!profile && isMinor(profile.date_of_birth, profile.under_17))}`}
      </ThemedText>

      {checkInQuestions.map((q) => (
        <CheckInScale
          key={q.key}
          question={q.question}
          answers={q.answers}
          value={answers[q.key]}
          onChange={(value) => answer(q.key, value)}
        />
      ))}

      <TextField
        label="Anything your coach should know? (optional)"
        value={noteValue}
        onChangeText={setNote}
        placeholder="For example, tight calves after Sunday’s game"
        maxLength={500}
        multiline
      />
      <ThemedText type="small" themeColor="textSecondary">
        {profile && isMinor(profile.date_of_birth, profile.under_17)
          ? 'Your parents or guardians can read this note, and your coaches once a parent or guardian agrees.'
          : 'Your coaches can read this note.'}
      </ThemedText>

      <ErrorText>{error}</ErrorText>
      <Button title={saved ? 'Update check-in' : 'Save check-in'} onPress={save} busy={saving} />

      <View style={styles.section}>
        <ThemedText type="smallBold">Last two weeks</ThemedText>
        {history ? <CheckInHistory checkIns={history} /> : null}
      </View>
      {userId ? (
        <SessionLogSection
          athleteId={userId}
          minor={!!profile && isMinor(profile.date_of_birth, profile.under_17)}
        />
      ) : null}
      <RaiseConcernLink context="Daily check-in" label="Something worrying you? Tell the club safely" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
