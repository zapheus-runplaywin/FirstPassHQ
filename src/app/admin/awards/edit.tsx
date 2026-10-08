import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  AWARD_COLUMNS,
  ballotOptions,
  dayOf,
  endOfDay,
  nomineeOptions,
  voterRoleOptions,
} from '@/lib/awards';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Award, AwardNominees, AwardTurnout, AwardVoterRole } from '@/lib/types';
import { seasonLabel, teamLabel, useTeams } from '@/lib/use-teams';

const closeQuickPicks = [
  { label: 'In a week', days: 7 },
  { label: 'In a month', days: 30 },
  { label: 'In 3 months', days: 91 },
];

const preseasonQuickPicks = [
  { label: 'In 2 weeks', days: 14 },
  { label: 'In a month', days: 30 },
];

const weightOptions = ['0', '10', '20', '25', '30', '40', '50'].map((w) => ({
  value: w,
  label: w === '0' ? 'No preseason vote' : `${w}%`,
}));

const hourOptions = [
  { value: '24', label: '24 hours' },
  { value: '48', label: '2 days' },
  { value: '72', label: '3 days' },
  { value: '168', label: 'A week' },
];

/** Creates an award, or changes one when opened with an id. */
export default function EditAwardScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const teams = useTeams();
  const seasons = [...new Set(teams.map((t) => t.season))].sort((a, b) => b - a);

  const [loaded, setLoaded] = useState(!id);
  const [voted, setVoted] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [seasonChoice, setSeason] = useState<number | null>(null);
  const [closesOn, setClosesOn] = useState<string | null>(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return toDateString(date);
  });
  const [clubWide, setClubWide] = useState(true);
  const [perGroup, setPerGroup] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<AwardVoterRole[]>(['member']);
  const [nominees, setNominees] = useState<AwardNominees>('members');
  const [points, setPoints] = useState('1');
  const [byMatch, setByMatch] = useState(false);
  const [hours, setHours] = useState('48');
  const [weight, setWeight] = useState('0');
  const [preseasonOn, setPreseasonOn] = useState<string | null>(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return toDateString(date);
  });
  const [annual, setAnnual] = useState(true);
  const [candidates, setCandidates] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data }, turnout] = await Promise.all([
        supabase.from('awards').select(AWARD_COLUMNS).eq('id', id).single(),
        // Only some settings can change once anyone has voted.
        supabase.rpc('award_turnout', { p_award_id: id }),
      ]);
      const award = data as Award | null;
      if (award) {
        setName(award.name);
        setDescription(award.description);
        setSeason(award.season);
        setClosesOn(dayOf(award.closes_at));
        setClubWide(award.club_wide);
        setPerGroup(award.per_group);
        setGroupIds(award.award_groups.map((g) => g.team_id));
        // Older awards can list partners, a role that no longer exists.
        setRoles(award.voter_roles.filter((r) => voterRoleOptions.some((o) => o.value === r)));
        setNominees(award.nominees);
        setPoints(award.points.join(','));
        setByMatch(award.by_match);
        setHours(String(award.match_vote_hours));
        setWeight(String(award.preseason_weight));
        if (award.preseason_closes_at) setPreseasonOn(dayOf(award.preseason_closes_at));
        setAnnual(award.annual);
        setCandidates(award.award_candidates.map((c) => c.name).join('\n'));
      }
      setVoted(((turnout.data as AwardTurnout[] | null) ?? []).some((r) => r.ballots > 0));
      setLoaded(true);
    })();
  }, [id]);

  const season = seasonChoice ?? seasons[0] ?? new Date().getFullYear();
  const seasonGroups = teams.filter((t) => t.season === season);
  const locked = voted;

  function toggleRole(role: AwardVoterRole) {
    if (role === 'member') {
      setRoles(['member']);
      return;
    }
    setRoles((current) => {
      const without = current.filter((r) => r !== 'member');
      return without.includes(role) ? without.filter((r) => r !== role) : [...without, role];
    });
  }

  async function save() {
    if (!closesOn) return;
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await supabase.rpc('admin_save_award', {
      p_id: id ?? null,
      p_season: season,
      p_name: name,
      p_description: description,
      p_closes_at: endOfDay(closesOn),
      p_club_wide: clubWide,
      p_per_group: !clubWide && perGroup,
      p_voter_roles: roles,
      p_nominees: nominees,
      p_points: points.split(',').map(Number),
      p_by_match: !clubWide && perGroup && byMatch,
      p_match_vote_hours: Number(hours),
      p_preseason_weight: !clubWide && perGroup && byMatch ? Number(weight) : 0,
      p_preseason_closes_at:
        byMatch && weight !== '0' && preseasonOn ? endOfDay(preseasonOn) : null,
      p_annual: annual,
      p_group_ids: clubWide ? [] : groupIds,
      p_candidates:
        nominees === 'listed'
          ? candidates
              .split('\n')
              .map((c) => c.trim())
              .filter(Boolean)
          : [],
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.replace({ pathname: '/admin/awards/[id]', params: { id: data as string } });
  }

  async function remove() {
    if (!id) return;
    setDeleting(true);
    const { error: deleteError } = await supabase.rpc('admin_delete_award', { p_id: id });
    setDeleting(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    router.dismissTo('/admin/awards');
  }

  if (!loaded) return <Screen>{null}</Screen>;

  const needsPreseasonDate = byMatch && weight !== '0' && !preseasonOn;
  const canSave =
    name.trim().length > 0 &&
    !!closesOn &&
    roles.length > 0 &&
    (clubWide || groupIds.length > 0) &&
    (nominees !== 'listed' || candidates.trim().length > 0) &&
    !needsPreseasonDate;

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? 'Edit award' : 'New award' }} />
      {locked ? (
        <ThemedText type="small" themeColor="textSecondary">
          People have voted, so only the name, description, closing dates, match voting window and
          listed names can change.
        </ThemedText>
      ) : null}

      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Volunteer of the year"
        maxLength={100}
      />
      <TextField
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="What voters should think about"
        multiline
        maxLength={1000}
      />

      {!locked && seasons.length > 1 ? (
        <ChipGroup
          label="Season"
          options={seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
          selected={[String(season)]}
          onToggle={(value) => {
            setSeason(Number(value));
            setGroupIds([]);
          }}
        />
      ) : null}

      <DateField
        label="Voting closes"
        value={closesOn}
        onChange={setClosesOn}
        quickPicks={closeQuickPicks}
      />

      {!locked ? (
        <>
          <ChipGroup
            label="Who votes"
            options={[
              { value: 'club', label: 'The whole club' },
              { value: 'groups', label: 'Chosen squads and teams' },
            ]}
            selected={[clubWide ? 'club' : 'groups']}
            onToggle={(value) => setClubWide(value === 'club')}
          />

          {!clubWide ? (
            <>
              <ChipGroup
                label="Squads and teams"
                options={seasonGroups.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
                selected={groupIds}
                onToggle={(value) =>
                  setGroupIds((current) =>
                    current.includes(value)
                      ? current.filter((g) => g !== value)
                      : [...current, value],
                  )
                }
              />
              <ChipGroup
                label="Winners"
                options={[
                  { value: 'one', label: 'One winner' },
                  { value: 'each', label: 'A winner for each' },
                ]}
                selected={[perGroup ? 'each' : 'one']}
                onToggle={(value) => setPerGroup(value === 'each')}
              />
            </>
          ) : null}

          <ChipGroup
            label="Roles that vote"
            options={voterRoleOptions}
            selected={roles}
            onToggle={toggleRole}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Athletes, coaches, managers and guardians vote in the squads and teams they’re in.
            Committee and admins vote wherever they are.
          </ThemedText>

          <ChipGroup
            label="Who can be voted for"
            options={nomineeOptions}
            selected={[nominees]}
            onToggle={setNominees}
          />
        </>
      ) : null}

      {nominees === 'listed' ? (
        <TextField
          label="Names, one per line"
          value={candidates}
          onChangeText={setCandidates}
          placeholder={'Jo Smith\nSam Lee'}
          multiline
        />
      ) : null}

      {!locked ? (
        <ChipGroup
          label="Ballot"
          options={ballotOptions}
          selected={[points]}
          onToggle={setPoints}
        />
      ) : null}

      {!clubWide && perGroup && !locked ? (
        <ChipGroup
          label="When people vote"
          options={[
            { value: 'once', label: 'Once, before it closes' },
            { value: 'match', label: 'After every match' },
          ]}
          selected={[byMatch ? 'match' : 'once']}
          onToggle={(value) => setByMatch(value === 'match')}
        />
      ) : null}

      {byMatch ? (
        <>
          <ChipGroup
            label="Match votes stay open for"
            options={hourOptions}
            selected={[hours]}
            onToggle={setHours}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Votes open when the match starts. Matches come from the PlayHQ fixtures.
          </ThemedText>
          {!locked ? (
            <ChipGroup
              label="Preseason share of the result"
              options={weightOptions}
              selected={[weight]}
              onToggle={setWeight}
            />
          ) : null}
          {weight !== '0' ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Voters get one preseason ballot. The result is {weight}% the share of preseason
                points and {100 - Number(weight)}% the share of match points.
              </ThemedText>
              <DateField
                label="Preseason vote closes"
                value={preseasonOn}
                onChange={setPreseasonOn}
                quickPicks={preseasonQuickPicks}
              />
            </>
          ) : null}
        </>
      ) : null}

      <ChipGroup
        label="Repeats"
        options={[
          { value: 'annual', label: 'Every year' },
          { value: 'once', label: 'This year only' },
        ]}
        selected={[annual ? 'annual' : 'once']}
        onToggle={(value) => setAnnual(value === 'annual')}
      />

      <ErrorText>{error}</ErrorText>
      <View style={styles.actions}>
        <Button title="Save award" onPress={save} busy={saving} disabled={!canSave} />
        {id && !voted ? (
          <ConfirmDelete
            title="Remove award"
            warning="Nobody has voted yet, so nothing else is lost."
            confirmTitle="Remove award"
            onConfirm={remove}
            busy={deleting}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.three,
  },
});
