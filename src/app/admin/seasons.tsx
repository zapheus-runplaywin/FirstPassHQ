import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { useSquads } from '@/lib/club';
import { seasonLabel, topGroups, useTeamList } from '@/lib/use-teams';

type Season = { season: number; archived: boolean; squad_count: number; team_count: number };

/**
 * The club year runs May to May. Each May an admin starts the next season and
 * places returning members in its squads; a few weeks after Easter they
 * archive the season before.
 */
export default function SeasonsScreen() {
  const { teams, reload: reloadTeams } = useTeamList();
  const usesSquads = useSquads();
  const word = usesSquads ? 'squad' : 'team';
  const [seasons, setSeasons] = useState<Season[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('season_list');
    setSeasons((data as Season[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      reloadTeams();
    }, [load, reloadTeams]),
  );

  const current = seasons?.filter((s) => !s.archived) ?? [];
  const newest = current[0]?.season;
  const next = newest === undefined ? null : newest + 1;

  async function run(action: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: actionError } = await action;
    setBusy(false);
    if (actionError) {
      setError(actionError.message);
      return;
    }
    setConfirming(null);
    load();
    reloadTeams();
  }

  if (seasons === null) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        The club year runs May to May. In May, start the next season and place returning members in
        its {word}s. Last season keeps running alongside it. About 4–6 weeks after Easter, archive
        last season. Nothing is deleted when a season is archived.
      </ThemedText>

      {/* One season at a time: archive last season before starting another. */}
      {next !== null && current.length === 1 ? (
        confirming === 'start' ? (
          <Card style={styles.confirm}>
            <ThemedText type="smallBold">Start the {seasonLabel(next)} season?</ThemedText>
            <ThemedText type="small">
              This creates empty {seasonLabel(next)} {word}s with the same names and {word}{' '}
              calendars as {seasonLabel(newest!)}. Nobody is moved: place returning members in each{' '}
              {word} next.
            </ThemedText>
            <ErrorText>{error}</ErrorText>
            <Button
              title={`Start ${seasonLabel(next)}`}
              busy={busy}
              onPress={() => run(supabase.rpc('admin_start_season', { p_season: next }))}
            />
            <Link label="Cancel" onPress={() => setConfirming(null)} />
          </Card>
        ) : (
          <Button
            title={`Start the ${seasonLabel(next)} season`}
            onPress={() => setConfirming('start')}
          />
        )
      ) : null}

      {seasons.map((s) => {
        const groups = topGroups(teams).filter((t) => t.season === s.season);
        const archiveKey = `archive-${s.season}`;
        return (
          <View key={s.season} style={styles.season}>
            <ThemedText type="smallBold">
              {seasonLabel(s.season)}
              {s.archived ? ' · archived' : s.season === newest ? ' · current' : ' · still running'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {usesSquads || s.squad_count > 0
                ? `${s.squad_count} ${s.squad_count === 1 ? 'squad' : 'squads'} · `
                : ''}
              {s.team_count} {s.team_count === 1 ? 'team' : 'teams'}
            </ThemedText>

            {s.season === newest && seasons.some((o) => o.season === s.season - 1)
              ? groups.map((group) => (
                  <PressableCard
                    key={group.id}
                    onPress={() =>
                      router.push({ pathname: '/admin/place/[id]', params: { id: group.id } })
                    }>
                    <ThemedText type="smallBold">{group.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Place returning members
                    </ThemedText>
                  </PressableCard>
                ))
              : null}

            {s.archived ? (
              <Link
                label={`Bring back ${seasonLabel(s.season)}`}
                onPress={() =>
                  run(
                    supabase.rpc('admin_set_season_archived', {
                      p_season: s.season,
                      p_archived: false,
                    }),
                  )
                }
              />
            ) : s.season !== newest ? (
              confirming === archiveKey ? (
                <Card style={styles.confirm}>
                  <ThemedText type="smallBold">Archive {seasonLabel(s.season)}?</ThemedText>
                  <ThemedText type="small">
                    Its squads and teams leave everyone’s home screen, calendars, messages and
                    coaches’ to-dos. Attendance, injuries and check-ins are kept, and you can bring
                    the season back.
                  </ThemedText>
                  <ErrorText>{error}</ErrorText>
                  <Button
                    title={`Archive ${seasonLabel(s.season)}`}
                    busy={busy}
                    onPress={() =>
                      run(
                        supabase.rpc('admin_set_season_archived', {
                          p_season: s.season,
                          p_archived: true,
                        }),
                      )
                    }
                  />
                  <Link label="Cancel" onPress={() => setConfirming(null)} />
                </Card>
              ) : (
                <Link
                  label={`Archive ${seasonLabel(s.season)}`}
                  onPress={() => setConfirming(archiveKey)}
                />
              )
            ) : null}
          </View>
        );
      })}

      {confirming === null ? <ErrorText>{error}</ErrorText> : null}
      <ThemedText type="small" themeColor="textSecondary">
        New members still send a join request, and join the newest season’s {word}s.
      </ThemedText>
    </Screen>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <ThemedText type="smallBold" style={{ color: theme.tint }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  season: {
    gap: Spacing.two,
  },
  confirm: {
    gap: Spacing.two,
  },
  link: {
    paddingVertical: Spacing.one,
  },
});
