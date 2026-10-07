import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CheckInHistory } from '@/components/check-in-history';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { CHECK_IN_COLUMNS, checkInQuestions, today } from '@/lib/check-ins';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { CheckIn, CheckInScores } from '@/lib/types';

/** How many days of history an athlete sees. */
const HISTORY_DAYS = 14;

type Answers = { [K in keyof CheckInScores]: number | null };

const unanswered: Answers = { sleep: null, soreness: null, stress: null, mood: null };

export default function CheckInScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [history, setHistory] = useState<CheckIn[] | null>(null);
  const [edited, setEdited] = useState<Answers | null>(null);
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
  const answers: Answers = edited ?? (saved ? { ...saved } : unanswered);
  const noteValue = note ?? saved?.note ?? '';

  function answer(key: keyof CheckInScores, value: number) {
    setEdited({ ...answers, [key]: value });
  }

  async function save() {
    if (checkInQuestions.some((q) => answers[q.key] === null)) {
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
        Thirty seconds a day. Your coaches see your answers so they can adjust training, and a low
        score lets them know to check in with you.
      </ThemedText>

      {checkInQuestions.map((q) => (
        <Scale
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

      <ErrorText>{error}</ErrorText>
      <Button title={saved ? 'Update check-in' : 'Save check-in'} onPress={save} busy={saving} />

      <View style={styles.section}>
        <ThemedText type="smallBold">Last two weeks</ThemedText>
        {history ? <CheckInHistory checkIns={history} /> : null}
      </View>
    </Screen>
  );
}

/** A question answered on a scale of 1 (bad) to 5 (good). */
function Scale({
  question,
  answers,
  value,
  onChange,
}: {
  question: string;
  answers: string[];
  value: number | null;
  onChange: (value: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.questionRow}>
        <ThemedText type="smallBold">{question}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {value ? answers[value - 1] : ''}
        </ThemedText>
      </View>
      <View style={styles.scale}>
        {answers.map((label, index) => {
          const score = index + 1;
          const selected = value === score;
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={`${score}: ${label}`}
              accessibilityState={{ selected }}
              onPress={() => onChange(score)}
              style={({ pressed }) => [
                styles.score,
                {
                  backgroundColor: selected
                    ? theme.accent
                    : pressed
                      ? theme.backgroundSelected
                      : theme.backgroundElement,
                },
              ]}>
              <ThemedText type="smallBold" style={selected ? { color: theme.onAccent } : undefined}>
                {score}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.ends}>
        <ThemedText type="small" themeColor="textSecondary">
          {answers[0]}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {answers[answers.length - 1]}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  questionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  scale: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  score: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
