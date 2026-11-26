import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GroupActions, RemovedGroups } from '@/components/group-actions';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useClub } from '@/lib/club';
import { formatDay } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { TEAM_TEMPLATES, type TeamTemplate } from '@/lib/team-templates';
import type { GroupKind, Team } from '@/lib/types';
import {
  newestGroups,
  seasonLabel,
  squadsOf,
  TEAM_COLUMNS,
  teamLabel,
  teamsIn,
  topGroups,
  useTeamList,
} from '@/lib/use-teams';

export default function SquadsScreen() {
  const theme = useTheme();
  const { teams, loaded, reload } = useTeamList();
  const { squads: usesSquads, reload: reloadClub } = useClub();
  // undefined while loading; null until an admin picks a starting setup.
  const [template, setTemplate] = useState<TeamTemplate | null | undefined>(undefined);
  const [choosing, setChoosing] = useState(false);
  const squads = squadsOf(teams);
  // Teams that don't belong to a squad: every team, for a club without squads.
  const ownTeams = topGroups(teams).filter((t) => t.kind === 'team');
  const [chosenKind, setKind] = useState<GroupKind>('team');
  // A team is named from a squad, so a club using squads starts with a squad.
  const kind = !usesSquads ? 'team' : squads.length === 0 ? 'squad' : chosenKind;
  const [name, setName] = useState('');
  const [squadId, setSquadId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Team[]>([]);

  // Squads and teams removed from a season that is still running.
  const seasons = [...new Set(teams.map((t) => t.season))].join(',');
  const loadRemoved = useCallback(() => {
    if (!seasons) return;
    supabase
      .from('teams')
      .select(TEAM_COLUMNS)
      .eq('archived', true)
      .in('season', seasons.split(',').map(Number))
      .order('sort_order')
      .then(({ data }) => setRemoved((data as Team[] | null) ?? []));
  }, [seasons]);

  useEffect(() => {
    loadRemoved();
  }, [loadRemoved]);

  useEffect(() => {
    supabase
      .rpc('club_team_template')
      .then(({ data, error: loadError }) =>
        setTemplate(!loadError && typeof data === 'string' ? (data as TeamTemplate) : null),
      );
  }, []);

  const changed = useCallback(() => {
    reload();
    loadRemoved();
  }, [reload, loadRemoved]);

  async function add() {
    if (!name.trim()) {
      setError('Please enter a name.');
      return;
    }
    const squad = usesSquads && kind === 'team' ? squads.find((s) => s.id === squadId) : undefined;
    if (usesSquads && kind === 'team' && !squad) {
      setError('Choose the squad the team is named from.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('teams').insert({
      name: name.trim(),
      kind,
      // A team belongs to the same season as its squad; anything else to the newest season.
      ...(squad
        ? { squad_id: squad.id, season: squad.season }
        : { season: newestGroups(teams)[0]?.season }),
      sort_order: squad ? teamsIn(teams, squad.id).length + 1 : topGroups(teams).length + 1,
    });
    setSaving(false);
    if (insertError) {
      setError(
        insertError.code === '23505'
          ? 'There is already a squad or team with that name this season.'
          : insertError.message,
      );
      return;
    }
    setName('');
    reload();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: usesSquads ? 'Squads and teams' : 'Teams' }} />
      {loaded && template !== undefined && teams.length === 0 && (template === null || choosing) ? (
        <ChooseTemplate
          onChosen={(chosen) => {
            setTemplate(chosen);
            setChoosing(false);
            reloadClub();
            changed();
          }}
          onCancel={template ? () => setChoosing(false) : undefined}
        />
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {usesSquads
              ? 'Your club uses squads. New members join a squad. At selections, name teams from each squad and pick final team athletes and training partners; everyone stays in their squad. Once a squad’s teams are named, mark its squad phase complete so coaches only look after their own team’s athletes.'
              : 'Your club doesn’t use squads, so new members join a team straight away. Open a team to choose its coaches, managers, final team athletes and training partners.'}
            {!usesSquads && squads.length > 0
              ? ' Squads from before squads were switched off keep working until their season ends; the next season starts with teams only.'
              : ''}
            {' Turn squads on or off in Club options.'}
          </ThemedText>
          {loaded && teams.length === 0 && template ? (
            <Pressable accessibilityRole="button" onPress={() => setChoosing(true)}>
              <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
                Use a starting setup instead
              </ThemedText>
            </Pressable>
          ) : null}
        </>
      )}

      {squads.map((squad) => (
        <View key={squad.id} style={styles.squad}>
          <PressableCard
            onPress={() => router.push({ pathname: '/team/[id]', params: { id: squad.id } })}>
            <ThemedText type="smallBold">{squad.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {seasonLabel(squad.season)} squad · see everyone in it
            </ThemedText>
          </PressableCard>
          <GroupActions key={squad.name} group={squad} onChange={changed} />
          {teamsIn(teams, squad.id).map((team) => (
            <View key={team.id} style={styles.team}>
              <PressableCard
                onPress={() => router.push({ pathname: '/team/[id]', params: { id: team.id } })}>
                <ThemedText type="smallBold">{team.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Team · see it, choose who is selected and its captains
                </ThemedText>
              </PressableCard>
              <GroupActions key={team.name} group={team} onChange={changed} />
            </View>
          ))}
          {usesSquads ? (
            <SelectionsPhase
              squad={squad}
              hasTeams={teamsIn(teams, squad.id).length > 0}
              onChange={reload}
            />
          ) : null}
        </View>
      ))}

      {ownTeams.map((team) => (
        <View key={team.id} style={styles.squad}>
          <PressableCard
            onPress={() => router.push({ pathname: '/team/[id]', params: { id: team.id } })}>
            <ThemedText type="smallBold">{team.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {seasonLabel(team.season)} team · see it, choose who is in it and its captains
            </ThemedText>
          </PressableCard>
          <GroupActions key={team.name} group={team} onChange={changed} />
          {usesSquads ? (
            <PutInSquad
              team={team}
              squads={squads.filter((s) => s.season === team.season)}
              teams={teams}
              onChange={reload}
            />
          ) : null}
        </View>
      ))}

      {!usesSquads && squads.length > 0 ? <EndSquadsNow onChange={changed} /> : null}

      {loaded && template !== null && teams.length === 0 && !choosing ? (
        <ThemedText type="small" themeColor="textSecondary">
          {usesSquads
            ? 'No squads or teams yet. Add your first squad below.'
            : 'No teams yet. Add your first team below.'}
        </ThemedText>
      ) : null}

      <RemovedGroups groups={removed} onChange={changed} />

      {loaded && teams.length === 0 && (template === null || choosing) ? null : (
        <View style={styles.form}>
          <ThemedText type="smallBold">
            {usesSquads ? 'Add a squad or team' : 'Add a team'}
          </ThemedText>
          {usesSquads && squads.length > 0 ? (
            <ChipGroup
              options={[
                { value: 'team' as const, label: 'Team' },
                { value: 'squad' as const, label: 'Squad' },
              ]}
              selected={[kind]}
              onToggle={setKind}
            />
          ) : null}
          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder={
              kind === 'team' ? 'For example, Mixed Open' : 'For example, Mixed Open Squad'
            }
          />
          {usesSquads && kind === 'team' ? (
            <ChipGroup
              label="Named from squad"
              options={squads.map((s) => ({
                value: s.id,
                label: teamLabel(s, teams),
              }))}
              selected={squadId ? [squadId] : []}
              onToggle={setSquadId}
            />
          ) : null}
          <ErrorText>{error}</ErrorText>
          <Button title={kind === 'team' ? 'Add team' : 'Add squad'} onPress={add} busy={saving} />
        </View>
      )}
    </Screen>
  );
}

/**
 * The first time an admin opens this screen, the club has no squads or teams:
 * they pick a starting setup, which adds its squads or teams for this season
 * and turns squads on or off to match.
 */
function ChooseTemplate({
  onChosen,
  onCancel,
}: {
  onChosen: (template: TeamTemplate) => void;
  onCancel?: () => void;
}) {
  const theme = useTheme();
  const [saving, setSaving] = useState<TeamTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(template: TeamTemplate) {
    setSaving(template);
    setError(null);
    const { error: saveError } = await supabase.rpc('admin_apply_team_template', {
      p_template: template,
    });
    setSaving(null);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onChosen(template);
  }

  return (
    <View style={styles.form}>
      <ThemedText type="smallBold">Choose a starting setup</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Pick the setup that matches your competition. It adds the squads or teams for this season,
        and you can rename, add or remove them afterwards.
      </ThemedText>
      {TEAM_TEMPLATES.map((t) => (
        <Card key={t.key} style={styles.phase}>
          <ThemedText type="smallBold">{t.title}</ThemedText>
          {t.groups.length > 0 ? <ThemedText type="small">{t.groups.join(', ')}</ThemedText> : null}
          <ThemedText type="small" themeColor="textSecondary">
            {t.detail}
          </ThemedText>
          <Button
            title={t.key === 'blank' ? 'Start blank' : `Use ${t.title}`}
            variant={t.key === 'blank' ? 'secondary' : 'primary'}
            onPress={() => choose(t.key)}
            busy={saving === t.key}
            disabled={saving !== null}
          />
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
      {onCancel ? (
        <Pressable accessibilityRole="button" onPress={onCancel}>
          <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
            Cancel
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * For a club that has switched squads off but doesn't want to wait for the
 * season to end: every team leaves its squad and the squads are removed from
 * the season. Athletes who are only in a squad drop off coaches' lists.
 */
function EndSquadsNow({ onChange }: { onChange: () => void }) {
  const theme = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function end() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('admin_end_squads_now');
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setConfirming(false);
    onChange();
  }

  if (!confirming) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setConfirming(true)}>
        <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
          End squads now instead
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <Card style={styles.phase}>
      <ThemedText type="smallBold">Are you sure you want to end squads now?</ThemedText>
      <ThemedText type="small">
        Every team leaves its squad and becomes a team on its own, and the squads are removed from
        this season. Athletes who are only in a squad, not in a team, drop off coaches’ lists,
        check-in boards and to-dos, and stop getting squad messages and calendars. Add them to a
        team from Members to bring them back. Nobody’s records are deleted.
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      <Button title="Yes, end squads now" variant="danger" onPress={end} busy={saving} />
      <Pressable accessibilityRole="button" onPress={() => setConfirming(false)}>
        <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
          Cancel
        </ThemedText>
      </Pressable>
    </Card>
  );
}

/**
 * For a club that turned squads on after it had teams: puts a team into a
 * squad of the same season. Its members join the squad too; nobody is removed.
 */
function PutInSquad({
  team,
  squads,
  teams,
  onChange,
}: {
  team: Team;
  squads: Team[];
  teams: Team[];
  onChange: () => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [squadId, setSquadId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (squads.length === 0) return null;

  async function save() {
    if (!squadId) {
      setError('Choose a squad.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('admin_put_team_in_squad', {
      p_team_id: team.id,
      p_squad_id: squadId,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setOpen(false);
    onChange();
  }

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
          Put in a squad
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <Card style={styles.phase}>
      <ChipGroup
        label={`Put ${team.name} in`}
        options={squads.map((s) => ({
          value: s.id,
          label: teamLabel(s, teams),
        }))}
        selected={squadId ? [squadId] : []}
        onToggle={setSquadId}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Everyone in {team.name} joins the squad too, and keeps their place in the team.
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      <Button title="Put in squad" onPress={save} busy={saving} />
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
        <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
          Cancel
        </ThemedText>
      </Pressable>
    </Card>
  );
}

/**
 * The squad phase for one squad. Once it's complete, the squad no longer
 * gives its coaches to-dos: they look after the athletes in their teams.
 */
function SelectionsPhase({
  squad,
  hasTeams,
  onChange,
}: {
  squad: Team;
  hasTeams: boolean;
  onChange: () => void;
}) {
  const theme = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completedAt = squad.selections_completed_at;

  async function save(complete: boolean) {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('set_selections_complete', {
      p_squad_id: squad.id,
      p_complete: complete,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setConfirming(false);
    onChange();
  }

  if (confirming) {
    return (
      <Card style={styles.team}>
        <ThemedText type="smallBold">Mark the squad phase complete for {squad.name}?</ThemedText>
        <ThemedText type="small">
          Coaches will only look after the final team athletes and training partners in their teams.
          Athletes left in the squad but not in a team won’t appear on coaches’ to-dos or check-in
          boards. Nobody is removed from the squad, and you can undo this.
        </ThemedText>
        <ErrorText>{error}</ErrorText>
        <Button title="Mark complete" onPress={() => save(true)} busy={saving} />
        <Pressable accessibilityRole="button" onPress={() => setConfirming(false)}>
          <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
            Cancel
          </ThemedText>
        </Pressable>
      </Card>
    );
  }

  return (
    <View style={[styles.team, styles.phase]}>
      <ThemedText type="small" themeColor="textSecondary">
        {completedAt
          ? `Squad phase complete since ${formatDay(new Date(completedAt))}. Coaches look after their team’s athletes.`
          : hasTeams
            ? 'Squad phase in progress. Coaches look after everyone in the squad.'
            : 'Name the teams from this squad to finish the squad phase.'}
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      {completedAt ? (
        <Pressable accessibilityRole="button" onPress={() => save(false)} disabled={saving}>
          <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
            Undo
          </ThemedText>
        </Pressable>
      ) : hasTeams ? (
        <Pressable accessibilityRole="button" onPress={() => setConfirming(true)}>
          <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
            Mark squad phase complete
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  squad: {
    gap: Spacing.two,
  },
  team: {
    marginLeft: Spacing.four,
    gap: Spacing.two,
  },
  phase: {
    gap: Spacing.one,
  },
  link: {
    paddingVertical: Spacing.one,
  },
  form: {
    gap: Spacing.three,
  },
});
