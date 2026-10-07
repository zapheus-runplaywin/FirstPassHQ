import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InjuryCard } from '@/components/injury-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  formatDateString,
  injuryStatusLabels,
  shareCsv,
  toCsv,
  toDateString,
} from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { InjuryReportRow } from '@/lib/types';

const DEFAULT_MONTHS = 3;

export default function InjuryReportScreen() {
  const [monthsText, setMonthsText] = useState(String(DEFAULT_MONTHS));
  const [rows, setRows] = useState<InjuryReportRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const months = Math.min(Math.max(parseInt(monthsText, 10) || DEFAULT_MONTHS, 1), 120);
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceDate = toDateString(since);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('injury_report', {
      p_since: sinceDate,
    });
    setError(loadError?.message ?? null);
    setRows((data as InjuryReportRow[] | null) ?? []);
  }, [sinceDate]);

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

  async function exportCsv() {
    if (!rows) return;
    setExporting(true);
    setError(null);
    try {
      const csv = toCsv([
        [
          'Athlete',
          'Email',
          'Left club',
          'Injury',
          'Injured on',
          'Reported',
          'Status',
          'Restrictions',
          'Expected back',
          'Endorsed by',
          'Cleared by',
          'Cleared on',
          'Updates',
          'Documents',
        ],
        ...rows.map((r) => [
          r.athlete_name,
          r.athlete_email,
          r.athlete_left_at?.slice(0, 10) ?? null,
          r.body_area,
          r.injured_on,
          r.reported_at.slice(0, 10),
          injuryStatusLabels[r.status],
          r.restrictions,
          r.expected_return,
          r.coach_endorsed_by_name,
          r.cleared_by_name,
          r.cleared_at?.slice(0, 10) ?? null,
          r.update_count,
          r.document_count,
        ]),
      ]);
      await shareCsv(`thunder-injuries-${toDateString(new Date())}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The export didn’t work. Try again.');
    } finally {
      setExporting(false);
    }
  }

  const open = rows?.filter((r) => r.status !== 'cleared').length ?? 0;
  const cleared = (rows?.length ?? 0) - open;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <TextField
        label="Months to include"
        value={monthsText}
        onChangeText={(text) => setMonthsText(text.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        maxLength={3}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Injuries reported or cleared since {formatDateString(sinceDate)}, and every injury that
        hasn’t been cleared yet.
      </ThemedText>

      {rows ? (
        <View style={styles.summary}>
          <Stat value={rows.length} label="Injuries" />
          <Stat value={open} label="Not cleared" />
          <Stat value={cleared} label="Cleared" />
        </View>
      ) : null}

      <Button
        title="Export CSV"
        onPress={exportCsv}
        busy={exporting}
        disabled={!rows || rows.length === 0}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Opens the share sheet, so you can save it to OneDrive or attach it to an email.
      </ThemedText>
      <ErrorText>{error}</ErrorText>

      {rows?.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No injuries in this period.
        </ThemedText>
      ) : null}
      <View style={styles.list}>
        {rows?.map((row) => (
          <InjuryCard key={row.id} injury={row} showAthlete />
        ))}
      </View>
    </Screen>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="subtitle">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
  },
  list: {
    gap: Spacing.two,
  },
});
