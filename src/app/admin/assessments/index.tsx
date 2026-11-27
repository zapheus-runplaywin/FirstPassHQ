import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardGrid } from '@/components/columns';
import { Fold } from '@/components/member-tabs';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  adminRoundLine,
  groupRounds,
  groupsWithNoRound,
  notClosedLine,
  roundCriteriaLine,
  roundTitle,
  roundWhen,
  shortRange,
  setLine,
  setUseLine,
  type AdminRound,
  type CriteriaSetSummary,
} from '@/lib/assessments';
import { clubToday } from '@/lib/club-time';
import { supabase } from '@/lib/supabase';
import { useTeams } from '@/lib/use-teams';

/**
 * Club > Season > Selection rounds and criteria: the club's selection rounds
 * and its criteria sets, in two tabs. Admins set these up and read the audit
 * report; they never see an assessment.
 */
export default function AdminAssessmentsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [sets, setSets] = useState<CriteriaSetSummary[] | null>(null);
  const [rounds, setRounds] = useState<AdminRound[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'rounds' | 'sets'>(params.tab === 'sets' ? 'sets' : 'rounds');
  const [choosing, setChoosing] = useState(false);
  const teams = useTeams();

  const load = useCallback(async () => {
    const [{ data: list, error: setsError }, { data: roundList, error: roundsError }] = await Promise.all([
      supabase.rpc('admin_criteria_sets'),
      supabase.rpc('admin_selection_rounds'),
    ]);
    setError(setsError?.message ?? roundsError?.message ?? null);
    setSets((list as CriteriaSetSummary[] | null) ?? []);
    setRounds((roundList as AdminRound[] | null) ?? []);
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

  if (!sets) return <Screen>{null}</Screen>;

  const live = sets.filter((s) => !s.archived_at);
  const archived = sets.filter((s) => s.archived_at);
  const ready = live.some((s) => s.groups > 0);

  function newSet(start: 'blank' | 'example' | string) {
    setChoosing(false);
    router.push({ pathname: '/admin/assessments/criteria', params: { start } });
  }

  const today = clubToday();
  const grouped = groupRounds(rounds, today);
  const season = teams.length ? Math.max(...teams.map((t) => t.season)) : null;
  const noRound = season ? groupsWithNoRound(teams, rounds, season) : [];
  const roundCard = (round: AdminRound) => {
    const late = notClosedLine(round, today);
    return (
      <PressableCard
        key={round.id}
        onPress={() => router.push({ pathname: '/admin/assessments/round', params: { id: round.id } })}>
        <ThemedText type="smallBold">
          {roundTitle(round)}
          {round.closed_at ? ' (closed)' : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {round.team_name} · {shortRange(round)}
        </ThemedText>
        {late ? <ThemedText type="smallBold">{late}</ThemedText> : null}
        {roundWhen(round, today) === 'now' && round.auditors === 0 ? (
          <ThemedText type="smallBold">No auditor yet</ThemedText>
        ) : null}
        {roundCriteriaLine(round) ? (
          <ThemedText type="small" themeColor="textSecondary">
            {roundCriteriaLine(round)}
          </ThemedText>
        ) : null}
        {round.starts_on <= today ? (
          <ThemedText type="small" themeColor="textSecondary">
            {adminRoundLine(round)}
          </ThemedText>
        ) : null}
      </PressableCard>
    );
  };

  const setCard = (set: CriteriaSetSummary) => (
    <PressableCard
      key={set.id}
      onPress={() => router.push({ pathname: '/admin/assessments/criteria', params: { id: set.id } })}>
      <ThemedText type="smallBold">{set.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {set.for_all ? 'For every squad and team' : `For ${set.for_label}`}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {setLine(set)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {setUseLine(set.rounds)}
      </ThemedText>
    </PressableCard>
  );

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Selectors add short observations about each athlete over a selection round, against the
        criteria set you choose for it. Only a round’s panel reads them; you set up the sets, rounds
        and panels, and read an audit report of how the work was done.
      </ThemedText>
      <ChipGroup
        options={[
          { value: 'rounds' as const, label: `Rounds (${rounds.length})` },
          { value: 'sets' as const, label: `Criteria sets (${live.length})` },
        ]}
        selected={[tab]}
        onToggle={setTab}
      />
      <ErrorText>{error}</ErrorText>

      {tab === 'rounds' ? (
        <>
          {rounds.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {ready
                ? 'No rounds yet. Open one for a squad or team when its selection phase starts.'
                : 'Add a criteria set first. A round takes its own copy when it opens.'}
            </ThemedText>
          ) : (
            <>
              {grouped.now.length > 0 ? (
                <>
                  <ThemedText type="smallBold">Running now</ThemedText>
                  <CardGrid gap={Spacing.four}>{grouped.now.map(roundCard)}</CardGrid>
                </>
              ) : null}
              {grouped.coming.length > 0 ? (
                <>
                  <ThemedText type="smallBold">Coming up</ThemedText>
                  <CardGrid gap={Spacing.four}>{grouped.coming.map(roundCard)}</CardGrid>
                </>
              ) : null}
              {grouped.finished.length > 0 ? (
                <Fold title={`Finished (${grouped.finished.length})`}>
                  <CardGrid gap={Spacing.four}>{grouped.finished.map(roundCard)}</CardGrid>
                </Fold>
              ) : null}
            </>
          )}
          {rounds.length > 0 && noRound.length > 0 ? (
            <Fold title={`No round this season: ${noRound.map((t) => t.name).join(', ')}`}>
              <ThemedText type="small" themeColor="textSecondary">
                Open a round for each of these when its selection phase is set.
              </ThemedText>
            </Fold>
          ) : null}
          {rounds.length > 0 ? (
            <Button
              title="Season register"
              variant="secondary"
              onPress={() => router.push('/admin/assessments/register')}
            />
          ) : null}
          {ready ? (
            <Button title="Open a selection round" onPress={() => router.push('/admin/assessments/round')} />
          ) : rounds.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Add a criteria set first. A round takes its own copy when it opens.
            </ThemedText>
          ) : null}
        </>
      ) : (
        <>
          {live.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No criteria sets yet. Add one, then open a round with it.
            </ThemedText>
          ) : (
            <CardGrid gap={Spacing.four}>{live.map(setCard)}</CardGrid>
          )}
          {archived.length > 0 ? (
            <Fold title={`Archived (${archived.length})`}>
              <CardGrid gap={Spacing.four}>{archived.map(setCard)}</CardGrid>
            </Fold>
          ) : null}
          {choosing ? (
            <View style={styles.chooser}>
              <ThemedText type="smallBold">New criteria set</ThemedText>
              <Button title="Start blank" variant="secondary" onPress={() => newSet('blank')} />
              <Button title="Start from the netball example" variant="secondary" onPress={() => newSet('example')} />
              {live.map((s) => (
                <Button key={s.id} title={`Copy “${s.name}”`} variant="secondary" onPress={() => newSet(s.id)} />
              ))}
              <Button title="Cancel" variant="secondary" onPress={() => setChoosing(false)} />
            </View>
          ) : (
            <Button title="New criteria set" onPress={() => setChoosing(true)} />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chooser: { gap: Spacing.two },
});
