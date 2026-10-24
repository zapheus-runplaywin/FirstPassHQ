import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { formatDateString } from '@/lib/injuries';
import { roleLabels } from '@/lib/labels';
import type { ConflictRow } from '@/lib/registers';
import { supabase } from '@/lib/supabase';
import { seasonLabel } from '@/lib/use-teams';

/**
 * The conflict-of-interest register for a season: what committee members and
 * coaches declared, and (this season) who still has to. Admins can change an
 * entry or record one given on paper.
 */
export default function ConflictsScreen() {
  const { isAdmin } = useAuth();
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [rows, setRows] = useState<ConflictRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The season shown, kept across reloads when the screen comes back into view.
  const chosenSeason = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('conflict_register_seasons');
    const list = (data as number[] | null) ?? [];
    setSeasons(list);
    const chosen = chosenSeason.current ?? list[0] ?? null;
    setSeason(chosen);
    if (chosen === null) {
      setRows([]);
      return;
    }
    const { data: register } = await supabase.rpc('conflict_register', { p_season: chosen });
    setRows((register as ConflictRow[] | null) ?? []);
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

  if (rows === null) return <Screen>{null}</Screen>;

  const isCurrent = season === seasons[0];
  const withConflict = rows.filter((r) => r.declared && r.has_conflict);
  const none = rows.filter((r) => r.declared && !r.has_conflict);
  const toDeclare = rows.filter((r) => !r.declared);

  function open(row: ConflictRow) {
    router.push({
      pathname: '/registers/conflict',
      params: { profile: row.profile_id, season: String(season), name: row.name ?? '' },
    });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Committee members and coaches declare any conflict of interest each season, such as a
        family member in a team they select or coach. They get a to-do until they do.
        {isAdmin ? ' Tap someone to change their entry or record one given on paper.' : ''}
      </ThemedText>
      {seasons.length > 1 ? (
        <ChipGroup
          label="Season"
          options={seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
          selected={season === null ? [] : [String(season)]}
          onToggle={(s) => {
            chosenSeason.current = Number(s);
            setRows(null);
            load();
          }}
        />
      ) : null}

      <Section title="Declared a conflict" rows={withConflict} empty="Nobody declared a conflict." isAdmin={isAdmin} onOpen={open} />
      <Section title="Declared none" rows={none} empty="Nobody yet." isAdmin={isAdmin} onOpen={open} />
      {isCurrent ? (
        <Section
          title="Still to declare"
          rows={toDeclare}
          empty="Everyone has declared this season."
          isAdmin={isAdmin}
          onOpen={open}
        />
      ) : null}
    </Screen>
  );
}

function Section({
  title,
  rows,
  empty,
  isAdmin,
  onOpen,
}: {
  title: string;
  rows: ConflictRow[];
  empty: string;
  isAdmin: boolean;
  onOpen: (row: ConflictRow) => void;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">
        {title}
        {rows.length > 0 ? ` (${rows.length})` : ''}
      </ThemedText>
      {rows.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {empty}
        </ThemedText>
      ) : (
        rows.map((r) => <Row key={r.profile_id} row={r} isAdmin={isAdmin} onOpen={onOpen} />)
      )}
    </View>
  );
}

function Row({
  row,
  isAdmin,
  onOpen,
}: {
  row: ConflictRow;
  isAdmin: boolean;
  onOpen: (row: ConflictRow) => void;
}) {
  const body = (
    <>
      <ThemedText type="smallBold">{row.name ?? 'Former member'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {row.roles.map((r) => roleLabels[r]).join(', ')}
      </ThemedText>
      {row.details ? <ThemedText type="small">{row.details}</ThemedText> : null}
      {row.declared_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          Declared {formatDateString(row.declared_at.slice(0, 10))}
          {row.changed_by_name ? ` · changed by ${row.changed_by_name}` : ''}
        </ThemedText>
      ) : null}
    </>
  );
  return isAdmin ? (
    <PressableCard onPress={() => onOpen(row)}>{body}</PressableCard>
  ) : (
    <Card style={styles.card}>{body}</Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  card: { gap: Spacing.one },
});
