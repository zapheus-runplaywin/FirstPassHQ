import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { CardGrid } from '@/components/columns';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { groupRounds, roundTitle, shortRange, type MyAudit } from '@/lib/assessments';
import { clubToday } from '@/lib/club-time';
import { supabase } from '@/lib/supabase';

/** The selection rounds a committee member audits: running now first. Read only. */
export default function AuditsScreen() {
  const [audits, setAudits] = useState<MyAudit[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_selection_audits');
    setAudits((data as MyAudit[] | null) ?? []);
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

  if (audits === null) return <Screen>{null}</Screen>;
  const grouped = groupRounds(audits, clubToday());
  const ordered = [...grouped.now, ...grouped.coming, ...grouped.finished];

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        You audit these rounds: you can read everything in them and change nothing.
      </ThemedText>
      {ordered.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You don’t audit a selection round. An admin chooses each round’s auditors.
        </ThemedText>
      ) : (
        <CardGrid gap={Spacing.four}>
          {ordered.map((audit) => (
            <PressableCard key={audit.id} onPress={() => router.push({ pathname: '/audits/round', params: { id: audit.id } })}>
              <ThemedText type="smallBold">
                {roundTitle(audit)}
                {audit.closed_at ? ' (closed)' : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[audit.team_name, shortRange(audit), audit.criteria_set_name].filter(Boolean).join(' · ')}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {audit.athletes} {audit.athletes === 1 ? 'athlete' : 'athletes'} · {audit.observations}{' '}
                {audit.observations === 1 ? 'observation' : 'observations'}
              </ThemedText>
            </PressableCard>
          ))}
        </CardGrid>
      )}
    </Screen>
  );
}
