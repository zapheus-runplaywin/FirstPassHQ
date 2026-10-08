import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MonthDateField } from '@/components/month-date-field';
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
import { formatDateString, toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Award, AwardNominees, AwardTurnout, AwardVoterRole, Team } from '@/lib/types';
import { seasonLabel, teamLabel, useTeams } from '@/lib/use-teams';

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

type PastAward = { id: string; name: string; season: number };
type GroupName = { name: string; kind: Team['kind'] };

/**
 * Creates an award, or changes one when opened with an id. Opened with `from`,
 * it starts as a copy of that award with no closing date.
 */
export default function EditAwardScreen() {
  const { id, from } = useLocalSearchParams<{ id?: string; from?: string }>();
  const teams = useTeams();
  const seasons = [...new Set(teams.map((t) => t.season))].sort((a, b) => b - a);

  const [loaded, setLoaded] = useState(!id && !from);
  const [pastAwards, setPastAwards] = useState<PastAward[]>([]);
  const [copiedFrom, setCopiedFrom] = useState<PastAward | null>(null);
  // The copied award's squads and teams, matched by name in the chosen season.
  const [copyGroups, setCopyGroups] = useState<GroupName[] | null>(null);
  const [appliedCopy, setAppliedCopy] = useState('');
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
  // No longer offered in the form; kept as it was on older awards.
  const [annual, setAnnual] = useState(false);
  const [candidates, setCandidates] = useState('');
  // Nominees under an age, such as a Rising Star award. Empty for any age.
  const [maxAge, setMaxAge] = useState('');
  const [ageLimited, setAgeLimited] = useState(false);
  // The age is measured on a chosen day, or the day voting closes.
  const [ageOnDay, setAgeOnDay] = useState(false);
  const [ageOn, setAgeOn] = useState<string | null>(null);
  // PlayHQ games linked to each squad or team, for match awards.
  const [games, setGames] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('fixtures')
        .select('team_id')
        .not('team_id', 'is', null)
        .not('opponent', 'is', null);
      const counts: Record<string, number> = {};
      for (const f of (data as { team_id: string }[] | null) ?? []) {
        counts[f.team_id] = (counts[f.team_id] ?? 0) + 1;
      }
      setGames(counts);
    })();
  }, []);

  // Past awards to start a new one from.
  useEffect(() => {
    if (id) return;
    (async () => {
      const { data } = await supabase
        .from('awards')
        .select('id, name, season')
        .order('season', { ascending: false })
        .order('name');
      const rows = (data as PastAward[] | null) ?? [];
      // The newest award of each name.
      setPastAwards(rows.filter((a, i) => rows.findIndex((b) => b.name === a.name) === i));
    })();
  }, [id]);

  useEffect(() => {
    const source = id ?? from;
    if (!source) return;
    (async () => {
      const [{ data }, turnout] = await Promise.all([
        supabase.from('awards').select(AWARD_COLUMNS).eq('id', source).single(),
        // Only some settings can change once anyone has voted.
        id ? supabase.rpc('award_turnout', { p_award_id: id }) : Promise.resolve({ data: [] }),
      ]);
      const award = data as Award | null;
      if (award) {
        setName(award.name);
        setDescription(award.description);
        setClubWide(award.club_wide);
        setPerGroup(award.per_group);
        // Older awards can list partners, a role that no longer exists.
        setRoles(award.voter_roles.filter((r) => voterRoleOptions.some((o) => o.value === r)));
        setNominees(award.nominees);
        setPoints(award.points.join(','));
        setByMatch(award.by_match);
        setHours(String(award.match_vote_hours));
        setWeight(String(award.preseason_weight));
        setCandidates(award.award_candidates.map((c) => c.name).join('\n'));
        setAgeLimited(award.nominee_max_age !== null);
        setMaxAge(award.nominee_max_age ? String(award.nominee_max_age) : '');
        setAgeOnDay(award.nominee_age_on !== null);
        if (id) {
          setAgeOn(award.nominee_age_on);
          setSeason(award.season);
          setClosesOn(dayOf(award.closes_at));
          setGroupIds(award.award_groups.map((g) => g.team_id));
          if (award.preseason_closes_at) setPreseasonOn(dayOf(award.preseason_closes_at));
          setAnnual(award.annual);
        } else {
          // A copy gets new dates, and squads and teams with the same names.
          setCopiedFrom({ id: award.id, name: award.name, season: award.season });
          setClosesOn(null);
          setPreseasonOn(null);
          setAgeOn(null);
          setGroupIds([]);
          const teamIds = award.award_groups.map((g) => g.team_id);
          const { data: groups } =
            teamIds.length > 0
              ? await supabase.from('teams').select('name, kind').in('id', teamIds)
              : { data: [] };
          setCopyGroups((groups as GroupName[] | null) ?? []);
        }
      }
      setVoted(((turnout.data as AwardTurnout[] | null) ?? []).some((r) => r.ballots > 0));
      setLoaded(true);
    })();
  }, [id, from]);

  const season = seasonChoice ?? seasons[0] ?? new Date().getFullYear();
  const seasonGroups = teams.filter((t) => t.season === season);
  const locked = voted;
  const copyMatches = seasonGroups.filter((t) =>
    copyGroups?.some((g) => g.name === t.name && g.kind === t.kind),
  );
  const missingGroups = (copyGroups?.length ?? 0) - copyMatches.length;

  // Pick the copied award's squads and teams in whichever season is chosen.
  const copyKey = copyGroups ? `${copiedFrom?.id}:${copyMatches.map((t) => t.id).join(',')}` : '';
  if (copyKey !== appliedCopy) {
    setAppliedCopy(copyKey);
    if (copyGroups) setGroupIds(copyMatches.map((t) => t.id));
  }

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
    if (saveError) {
      setSaving(false);
      setError(saveError.message);
      return;
    }
    if (!locked) {
      const limited = ageLimited && nominees !== 'listed';
      const { error: ageError } = await supabase.rpc('admin_set_award_age_limit', {
        p_award_id: data as string,
        p_max_age: limited ? Number(maxAge) : null,
        p_age_on: limited && ageOnDay ? ageOn : null,
      });
      if (ageError) {
        setSaving(false);
        setError(ageError.message);
        return;
      }
    }
    setSaving(false);
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
    !needsPreseasonDate &&
    (!ageLimited ||
      nominees === 'listed' ||
      (/^\d+$/.test(maxAge) &&
        Number(maxAge) >= 1 &&
        Number(maxAge) <= 99 &&
        (!ageOnDay || !!ageOn)));

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? 'Edit award' : 'New award' }} />
      {!id && pastAwards.length > 0 ? (
        <ChipGroup
          label="Start from a past award"
          options={pastAwards.map((a) => ({ value: a.id, label: a.name }))}
          selected={copiedFrom ? [copiedFrom.id] : []}
          onToggle={(value) => router.setParams({ from: value })}
        />
      ) : null}
      {copiedFrom ? (
        <ThemedText type="small" themeColor="textSecondary">
          Copied from {copiedFrom.name} ({seasonLabel(copiedFrom.season)}). Choose when voting
          closes, and check the rest before saving.
          {missingGroups > 0
            ? ` ${missingGroups} ${missingGroups === 1 ? 'squad or team has' : 'squads or teams have'} no match by name in ${seasonLabel(season)}.`
            : ''}
        </ThemedText>
      ) : null}
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

      <MonthDateField label="Voting closes" value={closesOn} onChange={setClosesOn} />

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

      {nominees !== 'listed' && !locked ? (
        <>
          <ChipGroup
            label="Nominee age"
            options={[
              { value: 'any', label: 'Any age' },
              { value: 'under', label: 'Under an age' },
            ]}
            selected={[ageLimited ? 'under' : 'any']}
            onToggle={(value) => setAgeLimited(value === 'under')}
          />
          {ageLimited ? (
            <>
              <TextField
                label="Nominees must be under"
                value={maxAge}
                onChangeText={(text) => setMaxAge(text.replace(/\D/g, ''))}
                placeholder="21"
                keyboardType="number-pad"
                maxLength={2}
              />
              <ChipGroup
                label="Age on"
                options={[
                  { value: 'close', label: 'The day voting closes' },
                  { value: 'day', label: 'A day I choose' },
                ]}
                selected={[ageOnDay ? 'day' : 'close']}
                onToggle={(value) => setAgeOnDay(value === 'day')}
              />
              {ageOnDay ? (
                <MonthDateField label="Age measured on" value={ageOn} onChange={setAgeOn} />
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                Only people with a date of birth can be voted for. The award’s page shows how many
                don’t have one yet.
              </ThemedText>
            </>
          ) : null}
        </>
      ) : null}
      {locked && ageLimited && nominees !== 'listed' ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nominees must be under {maxAge} on{' '}
          {ageOnDay && ageOn ? formatDateString(ageOn) : 'the day voting closes'}.
        </ThemedText>
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
            Votes open when the match starts. Matches come from the PlayHQ fixtures linked to each
            squad or team under Fixtures.
          </ThemedText>
          {seasonGroups
            .filter((t) => groupIds.includes(t.id))
            .map((t) => (
              <ThemedText
                key={t.id}
                type="small"
                themeColor={games[t.id] ? 'textSecondary' : 'accent'}>
                {games[t.id]
                  ? `${teamLabel(t, teams)}: ${games[t.id]} ${games[t.id] === 1 ? 'game' : 'games'} from PlayHQ.`
                  : `${teamLabel(t, teams)}: no PlayHQ games are linked, so no match votes will open. Link it under Fixtures, or choose the ${t.kind === 'squad' ? 'team' : 'squad'} its games are linked to.`}
              </ThemedText>
            ))}
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
              <MonthDateField
                label="Preseason vote closes"
                value={preseasonOn}
                onChange={setPreseasonOn}
              />
            </>
          ) : null}
        </>
      ) : null}

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
