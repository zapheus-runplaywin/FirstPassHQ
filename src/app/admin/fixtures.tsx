import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime, formatShortDay } from '@/lib/format';
import {
  fetchPlayhqCompetition,
  gamesFor,
  parsePlayhqLink,
  type PlayhqCompetition,
  type PlayhqLink,
} from '@/lib/playhq';
import { supabase } from '@/lib/supabase';
import type { Fixture, PlayhqSeason } from '@/lib/types';
import { seasonLabel, teamLabel, useTeams } from '@/lib/use-teams';

/** Our teams usually have the club's name in them. */
const CLUB_NAME = /thunder/i;

/**
 * Admins add a PlayHQ competition by its link, say which of its teams are the
 * club's, and import their games. Refreshing picks up PlayHQ's changes.
 */
export default function FixturesScreen() {
  const theme = useTheme();
  const teams = useTeams();
  const seasons = [...new Set(teams.map((t) => t.season))].sort((a, b) => b - a);
  const [saved, setSaved] = useState<PlayhqSeason[] | null>(null);
  const [upcoming, setUpcoming] = useState<Fixture[]>([]);
  const [linkText, setLinkText] = useState('');
  const [link, setLink] = useState<PlayhqLink | null>(null);
  const [competition, setCompetition] = useState<PlayhqCompetition | null>(null);
  const [links, setLinks] = useState<Record<string, string | null>>({});
  const [season, setSeason] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, f] = await Promise.all([
      supabase
        .from('playhq_seasons')
        .select(
          'playhq_season_id, name, url, season, imported_at, playhq_teams (playhq_team_id, playhq_name, team_id)',
        )
        .order('created_at', { ascending: false }),
      supabase
        .from('fixtures')
        .select(
          'id, team_id, team_name, opponent, round_name, grade_name, starts_at, time_tbc, venue, court, is_home, status',
        )
        .gte('starts_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString())
        .order('starts_at')
        .limit(10),
    ]);
    setSaved((s.data as PlayhqSeason[] | null) ?? []);
    setUpcoming((f.data as Fixture[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function lookUp(text = linkText) {
    setError(null);
    setNotice(null);
    const parsed = parsePlayhqLink(text);
    if (!parsed) {
      setError(
        'Paste the link to the competition on playhq.com, such as playhq.com/netball-australia/org/…/ec69e46d.',
      );
      return;
    }
    setBusy('lookup');
    try {
      const found = await fetchPlayhqCompetition(parsed);
      const existing = saved?.find((s) => s.playhq_season_id === found.id);
      setLink(parsed);
      setCompetition(found);
      setSeason(existing?.season ?? null);
      setLinks(
        Object.fromEntries(
          (existing?.playhq_teams ?? []).map((t) => [t.playhq_team_id, t.team_id]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t reach PlayHQ');
    }
    setBusy(null);
  }

  /** Saves the team links, then every linked team's games. */
  async function importGames(found: PlayhqCompetition, url: string, forSeason: number) {
    const { error: saveError } = await supabase.rpc('admin_save_playhq_season', {
      p_season_id: found.id,
      p_name: found.name,
      p_url: url,
      p_season: forSeason,
      p_teams: found.teams
        .filter((t) => t.id in links)
        .map((t) => ({ playhq_team_id: t.id, playhq_name: t.name, team_id: links[t.id] ?? '' })),
    });
    if (saveError) throw new Error(saveError.message);
    let count = 0;
    for (const [teamId, ours] of Object.entries(links)) {
      if (!ours) continue;
      const { data, error: importError } = await supabase.rpc('save_playhq_fixtures', {
        p_playhq_team_id: teamId,
        p_games: gamesFor(found, teamId),
      });
      if (importError) throw new Error(importError.message);
      count += (data as number | null) ?? 0;
    }
    return count;
  }

  async function save() {
    if (!competition || !link) return;
    setBusy('save');
    setError(null);
    try {
      const count = await importGames(competition, link.url, season ?? seasons[0]);
      setNotice(`Saved ${count} ${count === 1 ? 'game' : 'games'} from ${competition.name}.`);
      setCompetition(null);
      setLinkText('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the fixtures');
    }
    setBusy(null);
  }

  async function refresh(s: PlayhqSeason) {
    const parsed = parsePlayhqLink(s.url);
    if (!parsed) return;
    setBusy(s.playhq_season_id);
    setError(null);
    setNotice(null);
    try {
      const found = await fetchPlayhqCompetition(parsed);
      let count = 0;
      for (const t of s.playhq_teams) {
        if (!t.team_id) continue;
        const { data, error: importError } = await supabase.rpc('save_playhq_fixtures', {
          p_playhq_team_id: t.playhq_team_id,
          p_games: gamesFor(found, t.playhq_team_id),
        });
        if (importError) throw new Error(importError.message);
        count += (data as number | null) ?? 0;
      }
      setNotice(`Updated ${count} ${count === 1 ? 'game' : 'games'} from ${s.name}.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t reach PlayHQ');
    }
    setBusy(null);
  }

  const shownTeams = competition
    ? competition.teams.filter((t) =>
        search.trim()
          ? t.name.toLowerCase().includes(search.trim().toLowerCase())
          : CLUB_NAME.test(t.name) || links[t.id],
      )
    : [];
  const linkedCount = Object.values(links).filter(Boolean).length;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Fixtures come from PlayHQ. They show in each team’s calendar, and match awards open for
        voting when a game starts.
      </ThemedText>

      {saved?.map((s) => (
        <Card key={s.playhq_season_id}>
          <ThemedText type="smallBold">{s.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {seasonLabel(s.season)} ·{' '}
            {s.playhq_teams
              .filter((t) => t.team_id)
              .map((t) => {
                const team = teams.find((g) => g.id === t.team_id);
                return `${t.playhq_name} → ${team ? teamLabel(team, teams) : 'archived'}`;
              })
              .join(', ') || 'No teams linked'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {s.imported_at ? `Updated ${formatDateTime(new Date(s.imported_at))}` : 'Not imported'}
          </ThemedText>
          <View style={styles.cardButtons}>
            <Button
              title="Refresh from PlayHQ"
              variant="secondary"
              onPress={() => refresh(s)}
              busy={busy === s.playhq_season_id}
            />
            <Button
              title="Change teams"
              variant="secondary"
              onPress={() => {
                setLinkText(s.url);
                lookUp(s.url);
              }}
            />
          </View>
        </Card>
      ))}

      {competition ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">{competition.name}</ThemedText>
          {seasons.length > 1 ? (
            <ChipGroup
              label="Club season"
              options={seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
              selected={[String(season ?? seasons[0])]}
              onToggle={(value) => setSeason(Number(value))}
            />
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Tap each of our teams and choose the squad or team it is. {competition.games.length}{' '}
            games in {competition.teams.length} teams.
          </ThemedText>
          <TextField
            label="Find a team"
            value={search}
            onChangeText={setSearch}
            placeholder="Type part of a team name"
            autoCorrect={false}
          />
          {shownTeams.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {search.trim()
                ? 'No teams match.'
                : 'No team names have “Thunder” in them. Find our teams by name.'}
            </ThemedText>
          ) : null}
          {shownTeams.map((t) => {
            const ours = links[t.id];
            const team = teams.find((g) => g.id === ours);
            return (
              <Card key={t.id}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setOpen(open === t.id ? null : t.id)}>
                  <ThemedText type="smallBold">{t.name}</ThemedText>
                  <ThemedText
                    type="small"
                    style={team ? { color: theme.accent } : undefined}
                    themeColor={team ? undefined : 'textSecondary'}>
                    {t.grade ? `${t.grade} · ` : ''}
                    {team ? teamLabel(team, teams) : 'Not one of ours'}
                  </ThemedText>
                </Pressable>
                {open === t.id ? (
                  <ChipGroup
                    options={[
                      { value: '', label: 'Not one of ours' },
                      ...teams
                        .filter((g) => g.season === (season ?? seasons[0]))
                        .map((g) => ({ value: g.id, label: teamLabel(g, teams) })),
                    ]}
                    selected={[ours ?? '']}
                    onToggle={(value) => {
                      setLinks((current) => ({ ...current, [t.id]: value || null }));
                      setOpen(null);
                    }}
                  />
                ) : null}
              </Card>
            );
          })}
          <Button
            title={`Import games for ${linkedCount} ${linkedCount === 1 ? 'team' : 'teams'}`}
            onPress={save}
            busy={busy === 'save'}
            disabled={linkedCount === 0}
          />
          <Button title="Cancel" variant="secondary" onPress={() => setCompetition(null)} />
        </View>
      ) : (
        <View style={styles.section}>
          <TextField
            label="Add a PlayHQ competition"
            value={linkText}
            onChangeText={setLinkText}
            placeholder="https://www.playhq.com/netball-australia/org/…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Button
            title="Look up"
            onPress={() => lookUp()}
            busy={busy === 'lookup'}
            disabled={!linkText.trim()}
          />
        </View>
      )}

      {notice ? <ThemedText type="small">{notice}</ThemedText> : null}
      <ErrorText>{error}</ErrorText>

      {upcoming.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Coming up</ThemedText>
          {upcoming.map((f) => (
            <Card key={f.id}>
              <ThemedText type="smallBold">
                {f.team_name} {f.opponent ? `v ${f.opponent}` : '· Bye'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[
                  f.round_name,
                  f.time_tbc
                    ? `${formatShortDay(new Date(f.starts_at))}, time to be confirmed`
                    : formatDateTime(new Date(f.starts_at)),
                  [f.venue, f.court].filter(Boolean).join(' '),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  cardButtons: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
});
