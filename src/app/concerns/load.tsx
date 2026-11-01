import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { LoadCaveat, WhyThisFlag } from '@/components/load-monitoring';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateString } from '@/lib/injuries';
import {
  groupLoadPatterns,
  PATTERN_WORDS,
  sourcesFor,
  type ChildPatterns,
  type LoadPatternRow,
} from '@/lib/load-monitoring';
import { supabase } from '@/lib/supabase';

/**
 * Training load patterns for the Child Safety Officer: under 18s only, and
 * only patterns worth a welfare look (Matt, 28 October 2026). Never the
 * sessions, the numbers or coaches' notes.
 */
export default function LoadPatternsScreen() {
  const [children, setChildren] = useState<ChildPatterns[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('load_patterns');
    if (loadError) {
      setError(loadError.message);
      setChildren(null);
      return;
    }
    setError(null);
    setChildren(groupLoadPatterns((data as LoadPatternRow[] | null) ?? []));
  }, []);

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

  if (error) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <ThemedText type="small" themeColor="textSecondary">
          {error}.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Athletes under 18 whose logged training shows a pattern worth a welfare look: more hours of
        sport than their age 2 weeks running, a load flag alongside low check-ins, or a load flag
        a week ago that no coach has marked as talked about. You see the pattern and when it
        started, never their sessions or coaches’ notes. A child shows once a parent has given
        consent for check-ins, and each time you open this page it goes in their record access
        log. Each child here is on your to-do list.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Most patterns are simply a busy few weeks. If you’re worried, talk to their coach or
        parent, or record a concern.
      </ThemedText>
      <Button title="Raise a concern" variant="secondary" onPress={() => router.push('/concern/new')} />
      {children === null ? null : children.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No training load patterns to look at.
        </ThemedText>
      ) : (
        children.map((c) => (
          <Card key={c.id} style={styles.card}>
            <ThemedText type="smallBold">{c.name}</ThemedText>
            {c.patterns.map((p) => (
              <ThemedText key={p.pattern} type="small">
                {PATTERN_WORDS[p.pattern]} · since {formatDateString(p.since)}
              </ThemedText>
            ))}
          </Card>
        ))
      )}
      <WhyThisFlag sources={sourcesFor(['ratio', 'hours', 'wellbeing'])} label="Where these come from" />
      <LoadCaveat />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
});
