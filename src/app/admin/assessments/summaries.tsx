import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, ConfirmDelete, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { type AdminSummaries } from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * Who has signed their summaries in a round, for an admin: counts for each
 * selector; tapping one lists what they signed, by athlete and date, each of
 * which the admin can reopen. Nothing a summary says is here.
 */
export default function AdminSummariesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [summaries, setSummaries] = useState<AdminSummaries | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('admin_selection_summaries', { p_round_id: id });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError(null);
    setSummaries(data as AdminSummaries);
  }, [id]);

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

  async function reopen(summaryId: string) {
    setBusy(true);
    const { error: reopenError } = await supabase.rpc('reopen_assessment_summary', { p_summary_id: summaryId });
    if (reopenError) setError(reopenError.message);
    else await load();
    setBusy(false);
  }

  if (!summaries) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Each selector writes and signs their own summary of each athlete they can assess. You see
        who has signed and when, never what a summary says. The round’s last day is{' '}
        {formatDateString(summaries.ends_on)}.
      </ThemedText>
      <ErrorText>{error}</ErrorText>

      <ThemedText type="small" themeColor="textSecondary">
        {summaries.signed.length === 0
          ? 'Nobody has signed a summary yet.'
          : summaries.closed
            ? 'Tap a selector to see what they signed. The round is closed, so a summary can’t be reopened. Open the round again first.'
            : 'Tap a selector to see what they signed. Reopen one if they signed by mistake: they can change it and must sign again. Each reopening is kept in the audit report.'}
      </ThemedText>
      {summaries.selectors.map((s) => {
        const toStart = Math.max(0, s.athletes - s.signed - s.drafts);
        const signed = summaries.signed.filter((one) => one.selector_name === s.name);
        const isOpen = open.includes(s.name);
        return (
          <View key={s.name} style={styles.card}>
            <PressableCard
              onPress={() => setOpen((names) => (isOpen ? names.filter((n) => n !== s.name) : [...names, s.name]))}>
              <ThemedText type="smallBold">
                {s.name}
                {s.on_panel ? '' : ' (not on the panel now)'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Signed {s.signed} of {s.athletes}
                {s.signed_late > 0 ? `, ${s.signed_late} after the last day` : ''}
                {s.drafts > 0 ? ` · ${s.drafts} in draft` : ''}
                {s.on_panel && toStart > 0 ? ` · ${toStart} not started` : ''}
                {s.reopened > 0 ? ` · reopened ${s.reopened === 1 ? 'once' : `${s.reopened} times`}` : ''}
              </ThemedText>
            </PressableCard>
            {isOpen && signed.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {s.name} has signed nothing yet.
              </ThemedText>
            ) : null}
            {isOpen
              ? signed.map((one) => (
                  <Card key={one.id} style={styles.card}>
                    <ThemedText type="small">
                      About {one.athlete_name ?? 'an athlete'} · signed {formatDateString(one.signed_at.slice(0, 10))}
                      {one.late ? ', after the last day' : ''}
                    </ThemedText>
                    {summaries.closed ? null : (
                      <ConfirmDelete
                        title="Reopen"
                        warning={`${s.name} can change this summary and must sign it again.`}
                        confirmTitle={`Reopen ${s.name}’s summary about ${one.athlete_name ?? 'this athlete'}`}
                        onConfirm={() => reopen(one.id)}
                        busy={busy}
                      />
                    )}
                  </Card>
                ))
              : null}
          </View>
        );
      })}

      {summaries.reopenings.length > 0 ? (
        <>
          <ThemedText type="subtitle">Reopened</ThemedText>
          {summaries.reopenings.map((r, index) => (
            <ThemedText key={`${r.at}-${index}`} type="small" themeColor="textSecondary">
              {r.selector_name} about {r.athlete_name ?? 'an athlete'}: reopened by {r.by_name} on{' '}
              {formatDateString(r.at.slice(0, 10))}
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
