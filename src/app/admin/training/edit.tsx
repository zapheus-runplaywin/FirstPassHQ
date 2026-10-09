import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { MonthDateField } from '@/components/month-date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import {
  currentSeason,
  REQUIREMENT_COLUMNS,
  trainingRoleOptions,
  type TrainingRequirement,
} from '@/lib/training';
import type { AppRole } from '@/lib/types';
import { seasonLabel, teamLabel, useTeams } from '@/lib/use-teams';

/**
 * Adds a piece of integrity training, or changes one when opened with an id:
 * the course, when it is due, and which roles in which squads and teams must
 * complete it.
 */
export default function EditTrainingScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string; season?: string }>();
  const id = params.id;
  const teams = useTeams();
  const [loaded, setLoaded] = useState(!id);
  const [season, setSeason] = useState<number | null>(params.season ? Number(params.season) : null);
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [courseUrl, setCourseUrl] = useState('');
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [roles, setRoles] = useState<AppRole[]>(['athlete', 'coach']);
  const [allTeams, setAllTeams] = useState(true);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('training_requirements')
      .select(REQUIREMENT_COLUMNS)
      .eq('id', id)
      .single()
      .then(({ data }) => {
        const r = data as TrainingRequirement | null;
        if (r) {
          setSeason(r.season);
          setName(r.name);
          setDetails(r.details ?? '');
          setCourseUrl(r.course_url ?? '');
          setDueOn(r.due_on);
          setRoles(r.roles);
          setAllTeams(r.all_teams);
          setTeamIds(r.training_requirement_teams.map((g) => g.team_id));
          setArchived(r.archived);
        }
        setLoaded(true);
      });
  }, [id]);

  const chosenSeason = season ?? currentSeason(teams.map((t) => t.season));
  // Squads first, then each squad's teams; past seasons' groups can't be chosen.
  const seasonGroups = teams
    .filter((t) => t.season === chosenSeason)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'squad' ? -1 : 1));

  function toggle<T>(list: T[], value: T) {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  const missing = [
    !name.trim() && 'a name',
    !dueOn && 'a due date',
    roles.length === 0 && 'who must complete it',
    !allTeams && teamIds.length === 0 && 'squads or teams',
  ].filter(Boolean) as string[];

  async function save() {
    if (missing.length > 0) {
      setError(`Add ${missing.join(', ')}.`);
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await supabase.rpc('admin_save_training_requirement', {
      p_id: id ?? null,
      p_season: chosenSeason,
      p_name: name,
      p_details: details,
      p_course_url: courseUrl,
      p_due_on: dueOn,
      p_roles: roles,
      p_team_ids: allTeams ? [] : teamIds,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.replace({ pathname: '/training/requirement/[id]', params: { id: data as string } });
  }

  async function setArchive(value: boolean) {
    if (!id) return;
    setBusy(true);
    const { error: archiveError } = await supabase.rpc('admin_set_training_archived', {
      p_id: id,
      p_archived: value,
    });
    setBusy(false);
    if (archiveError) {
      setError(archiveError.message);
      return;
    }
    setArchived(value);
  }

  async function remove() {
    if (!id) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc('admin_delete_training_requirement', {
      p_id: id,
    });
    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    router.dismissTo('/admin/training');
  }

  if (!loaded) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        {seasonLabel(chosenSeason)} season{archived ? ' · archived' : ''}
      </ThemedText>
      <TextField
        label="Course"
        value={name}
        onChangeText={setName}
        placeholder="Such as Safeguarding in Sport"
        maxLength={120}
      />
      <TextField
        label="Details (optional)"
        value={details}
        onChangeText={setDetails}
        placeholder="What it covers and how long it takes"
        multiline
        maxLength={2000}
      />
      <TextField
        label="Course link (optional)"
        value={courseUrl}
        onChangeText={setCourseUrl}
        placeholder="https://"
        autoCapitalize="none"
        keyboardType="url"
        maxLength={500}
      />
      <MonthDateField label="Due by" value={dueOn} onChange={setDueOn} />

      <ChipGroup
        label="Who must complete it"
        options={trainingRoleOptions}
        selected={roles}
        onToggle={(role) => setRoles((current) => toggle(current, role))}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Parents and guardians can upload certificates for athletes under 18.
      </ThemedText>

      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <ThemedText type="smallBold">All squads and teams</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Turn off to choose, such as junior teams only
          </ThemedText>
        </View>
        <Switch
          value={allTeams}
          onValueChange={setAllTeams}
          trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          thumbColor={theme.text}
          {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
          accessibilityLabel="All squads and teams"
        />
      </View>
      {!allTeams ? (
        seasonGroups.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {seasonLabel(chosenSeason)} has no squads or teams yet.
          </ThemedText>
        ) : (
          <>
            <ChipGroup
              label="Squads and teams"
              options={seasonGroups.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
              selected={teamIds}
              onToggle={(teamId) => setTeamIds((current) => toggle(current, teamId))}
            />
            <ThemedText type="small" themeColor="textSecondary">
              A squad includes the teams named from it. Only members in these groups with a role
              above must complete it.
            </ThemedText>
          </>
        )
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Everyone with a role above must complete it, including committee members and admins who
          aren’t in a squad or team.
        </ThemedText>
      )}

      <ErrorText>{error}</ErrorText>
      <Button title={id ? 'Save' : 'Add training'} onPress={save} busy={saving} />

      {id ? (
        <>
          <Button
            title={archived ? 'Bring it back' : 'Archive'}
            variant="secondary"
            onPress={() => setArchive(!archived)}
            busy={busy}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Archived training leaves members’ to-do lists. Its certificates are kept.
          </ThemedText>
          <ConfirmDelete
            title="Remove"
            warning="This removes the training for everyone. Training with certificates can only be archived."
            confirmTitle="Remove training"
            onConfirm={remove}
            busy={busy}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  flex: {
    flex: 1,
    gap: Spacing.half,
  },
});
