import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MonthDateField } from '@/components/month-date-field';
import { Screen } from '@/components/screen';
import { SeasonChips } from '@/components/training-list';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ConfirmDelete, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateString } from '@/lib/injuries';
import type { KpiReviewPoint } from '@/lib/kpis';
import { supabase } from '@/lib/supabase';
import { currentSeason } from '@/lib/training';
import { seasonLabel, useTeams } from '@/lib/use-teams';

/** Admins set each season's KPI review dates. */
export default function KpiReviewsScreen() {
  const teams = useTeams();
  const seasons = [...new Set(teams.map((t) => t.season))].sort((a, b) => b - a);
  const [choice, setChoice] = useState<number | null>(null);
  const season = choice ?? currentSeason(seasons);
  const [points, setPoints] = useState<KpiReviewPoint[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('kpi_review_points', { p_season: season });
    setPoints((data as KpiReviewPoint[] | null) ?? []);
  }, [season]);

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

  async function saved() {
    setEditing(null);
    await load();
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Set when season KPIs are reviewed, such as a mid-season and an end-of-season review. From a
        week before each date, whoever set a person’s KPIs gets a to-do to write their review. The
        person then confirms it was done.
      </ThemedText>
      <SeasonChips
        seasons={seasons}
        season={season}
        onChange={(next) => {
          setChoice(next);
          setEditing(null);
        }}
      />
      <ThemedText type="subtitle">{seasonLabel(season)}</ThemedText>

      {points?.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No review dates yet.
        </ThemedText>
      ) : null}

      {(points ?? []).map((point) =>
        editing === point.id ? (
          <PointForm
            key={point.id}
            point={point}
            season={season}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <PressableCard key={point.id} onPress={() => setEditing(point.id)}>
            <ThemedText type="smallBold">{point.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatDateString(point.due_on)}
            </ThemedText>
          </PressableCard>
        ),
      )}

      {editing === 'new' ? (
        <PointForm season={season} onSaved={saved} onCancel={() => setEditing(null)} />
      ) : (
        <Button title="Add a review date" onPress={() => setEditing('new')} />
      )}
    </Screen>
  );
}

function PointForm({
  point,
  season,
  onSaved,
  onCancel,
}: {
  point?: KpiReviewPoint;
  season: number;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(point?.name ?? '');
  const [dueOn, setDueOn] = useState<string | null>(point?.due_on ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: callError } = await call;
    setBusy(false);
    if (callError) setError(callError.message);
    else await onSaved();
  }

  return (
    <Card style={styles.form}>
      <TextField
        label="Review"
        value={name}
        onChangeText={setName}
        placeholder="For example, Mid-season review"
        maxLength={80}
      />
      <MonthDateField label="Date" value={dueOn} onChange={setDueOn} />
      <ErrorText>{error}</ErrorText>
      <Button
        title={point ? 'Save' : 'Add review date'}
        busy={busy}
        disabled={!name.trim() || !dueOn}
        onPress={() =>
          run(
            supabase.rpc('admin_save_kpi_review_point', {
              p_id: point?.id ?? null,
              p_season: season,
              p_name: name,
              p_due_on: dueOn,
            }),
          )
        }
      />
      {point ? (
        <ConfirmDelete
          title="Remove review date"
          warning="Remove this review date? You can only remove it while no reviews have been written for it."
          confirmTitle="Remove it"
          busy={busy}
          onConfirm={() => run(supabase.rpc('admin_delete_kpi_review_point', { p_id: point.id }))}
        />
      ) : null}
      <View>
        <Button title="Cancel" variant="secondary" onPress={onCancel} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing.three,
  },
});
