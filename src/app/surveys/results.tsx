import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { answerText, type SurveyResults } from '@/lib/surveys';

export default function SurveyResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: fetchError } = await supabase.rpc('survey_results', { p_survey_id: id });
    if (fetchError) setError(fetchError.message);
    else setResults(data as SurveyResults);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (error) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }
  if (!results) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <ThemedText type="smallBold">
        {results.answered} of {results.sent_to} answered
      </ThemedText>

      {results.hidden ? (
        <Card>
          <ThemedText type="small">
            {!results.closed
              ? 'Results show once the survey closes, so nobody can work out who answered from how the results change.'
              : `Results show once at least ${results.min_responses} people have answered, so nobody can be picked out.`}
          </ThemedText>
        </Card>
      ) : (
        results.questions.map((q, i) => (
          <Card key={q.id} style={styles.question}>
            <ThemedText type="smallBold">
              {i + 1}. {q.prompt}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {q.answered} answered
              {q.kind === 'rating' && q.average !== null ? ` · Average ${q.average} out of ${q.rating_max}` : ''}
            </ThemedText>
            {q.counts ? (
              <Bars
                labels={
                  q.kind === 'rating'
                    ? Array.from({ length: q.rating_max ?? 0 }, (_, n) => String(n + 1))
                    : (q.options ?? [])
                }
                counts={q.counts}
                total={q.answered}
              />
            ) : null}
            {q.texts?.map((t, n) => (
              <View key={n} style={styles.text}>
                <ThemedText type="small">{t.text}</ThemedText>
                {t.name ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.name}
                  </ThemedText>
                ) : null}
              </View>
            ))}
          </Card>
        ))
      )}

      {!results.hidden && results.respondents.length > 0 ? (
        <>
          <ThemedText type="smallBold">Named answers</ThemedText>
          {results.respondents.map((r, n) => (
            <Card key={n}>
              <ThemedText type="smallBold">{r.name}</ThemedText>
              {results.questions.map((q) => {
                const a = r.answers.find((x) => x.question_id === q.id);
                return a ? (
                  <ThemedText key={q.id} type="small">
                    {q.prompt}: {answerText(q, a)}
                  </ThemedText>
                ) : null;
              })}
            </Card>
          ))}
        </>
      ) : null}

      {results.waiting.length > 0 ? (
        <>
          <ThemedText type="smallBold">Not answered yet</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {results.waiting.join(', ')}
          </ThemedText>
        </>
      ) : null}
    </Screen>
  );
}

function Bars({ labels, counts, total }: { labels: string[]; counts: number[]; total: number }) {
  const theme = useTheme();
  return (
    <View style={styles.bars}>
      {labels.map((label, i) => {
        const count = counts[i] ?? 0;
        const share = total > 0 ? count / total : 0;
        return (
          <View key={i} style={styles.bar}>
            <View style={styles.barLabel}>
              <ThemedText type="small" style={styles.grow}>
                {label}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {count} · {Math.round(share * 100)}%
              </ThemedText>
            </View>
            <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
              <View
                style={[styles.fill, { width: `${share * 100}%`, backgroundColor: theme.accent }]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  question: {
    gap: Spacing.two,
  },
  bars: {
    gap: Spacing.two,
  },
  bar: {
    gap: Spacing.half,
  },
  barLabel: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  text: {
    gap: Spacing.half,
    paddingTop: Spacing.one,
  },
});
