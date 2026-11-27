import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardGrid } from '@/components/columns';
import { MonthDateField } from '@/components/month-date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  MAX_MILESTONES,
  clashLines,
  isIndependentChoice,
  nextPhaseRound,
  phaseLabel,
  shiftDates,
  shortDate,
  isOverdue,
  milestoneLine,
  panelNotes,
  pickSet,
  roundCriteriaLine,
  setLine,
  type AdminRound,
  type Milestone,
  type PanelChoice,
  type RoundClash,
  type SetChoice,
} from '@/lib/assessments';
import { clubToday } from '@/lib/club-time';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import { teamLabel, useTeams } from '@/lib/use-teams';

/**
 * Opens a selection round for a squad or team, or (with an id) shows it in
 * four short tabs: its dates, its panel, its reports, and its details (name,
 * dates, closing).
 * The panel is the only way to read a round's assessments, so every change
 * to it is kept and shown here.
 */
export default function AdminRoundScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const teams = useTeams();
  const theme = useTheme();
  const [round, setRound] = useState<AdminRound | null>(null);
  const [dates, setDates] = useState<Milestone[]>([]);
  const [choices, setChoices] = useState<PanelChoice[] | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState<string | null>(null);
  const [endsOn, setEndsOn] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'dates' | 'panel' | 'reports' | 'details'>('dates');
  const [loadedSets, setLoadedSets] = useState<{ group: string; list: SetChoice[] } | null>(null);
  const [setId, setSetId] = useState<string | null>(null);
  const [choosingSet, setChoosingSet] = useState(false);
  const [allRounds, setAllRounds] = useState<AdminRound[]>([]);
  const [phase, setPhase] = useState<number | null>(null);
  const [roundNumber, setRoundNumber] = useState<number | null>(null);
  const [morePhases, setMorePhases] = useState(false);
  const [moreRounds, setMoreRounds] = useState(false);
  const [clashState, setClashState] = useState<{ key: string; list: RoundClash[] } | null>(null);

  // Opening: every round, so the next free phase and round number can be preselected.
  useEffect(() => {
    if (id) return;
    supabase.rpc('admin_selection_rounds').then(({ data }) => setAllRounds((data as AdminRound[] | null) ?? []));
  }, [id]);
  /** Choosing a squad or team preselects its next free phase and round number. */
  function chooseTeam(next: string) {
    setTeamId(next);
    const team = teams.find((t) => t.id === next);
    const free = nextPhaseRound(allRounds, next, team?.season ?? new Date().getFullYear());
    setPhase(free.phase);
    setRoundNumber(free.round);
    setMorePhases(free.phase > 6);
    setMoreRounds(free.round > 6);
  }

  // The same athletes can't be in two rounds at once: check as the dates are picked.
  const clashGroup = round?.team_id ?? teamId;
  const clashKey =
    clashGroup && startsOn && endsOn && endsOn >= startsOn ? `${clashGroup}/${startsOn}/${endsOn}` : null;
  const clashes = clashKey && clashState?.key === clashKey ? clashState.list : [];
  useEffect(() => {
    if (!clashKey) return;
    let live = true;
    supabase
      .rpc('admin_selection_round_clashes', {
        p_team_id: clashGroup,
        p_starts_on: startsOn,
        p_ends_on: endsOn,
        p_round_id: id ?? null,
      })
      .then(({ data }) => {
        if (live) setClashState({ key: clashKey, list: (data as RoundClash[] | null) ?? [] });
      });
    return () => {
      live = false;
    };
  }, [clashKey, clashGroup, startsOn, endsOn, id]);

  // The sets that fit the chosen squad or team (opening), or the round's group (changing).
  const groupId = round?.team_id ?? teamId;
  useEffect(() => {
    if (!groupId) return;
    let live = true;
    supabase.rpc('admin_selection_round_set_choices', { p_team_id: groupId }).then(({ data, error: setsError }) => {
      if (!live) return;
      if (setsError) setError(setsError.message);
      const list = (data as SetChoice[] | null) ?? [];
      setLoadedSets({ group: groupId, list });
      setSetId(pickSet(list)?.set_id ?? null);
      setChoosingSet(false);
    });
    return () => {
      live = false;
    };
  }, [groupId]);

  /** Each part of a round is its own tab, so a message about one doesn't follow to the next. */
  function openTab(next: typeof tab) {
    setTab(next);
    setError(null);
    setNotice(null);
  }

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error: loadError } = await supabase.rpc('admin_selection_rounds');
    if (loadError) {
      setError(loadError.message);
      setLoaded(true);
      return;
    }
    const found = ((data as AdminRound[] | null) ?? []).find((r) => r.id === id) ?? null;
    const { data: dateRows } = found
      ? await supabase.rpc('admin_selection_milestones', { p_round_id: id })
      : { data: null };
    setDates((dateRows as Milestone[] | null) ?? []);
    setRound(found);
    setLoaded(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Fill the form once, from the round as saved.
  if (round && !filled) {
    setFilled(true);
    setName(round.name === phaseLabel(round) ? '' : round.name);
    setPhase(round.phase ?? null);
    setRoundNumber(round.round_number ?? null);
    setMorePhases((round.phase ?? 0) > 6);
    setMoreRounds((round.round_number ?? 0) > 6);
    setStartsOn(round.starts_on);
    setEndsOn(round.ends_on);
  }

  async function save() {
    const missing = [
      !id && !teamId && 'a squad or team',
      !id && teamId && !setId && 'the criteria for this round',
      !name.trim() && !(phase && roundNumber) && 'a name',
      !startsOn && 'a start date',
      !endsOn && 'an end date',
    ].filter(Boolean);
    if (missing.length > 0) {
      setError(`Choose ${missing.join(', ')}.`);
      return;
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      setError('The round ends before it starts.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    const { error: saveError } = id
      ? await supabase.rpc('admin_save_selection_round', {
          p_round_id: id,
          p_name: name,
          p_starts_on: startsOn,
          p_ends_on: endsOn,
          p_phase: phase,
          p_round_number: roundNumber,
        })
      : await supabase.rpc('admin_open_selection_round', {
          p_team_id: teamId,
          p_name: name,
          p_starts_on: startsOn,
          p_ends_on: endsOn,
          p_set_id: setId,
          p_phase: phase,
          p_round_number: roundNumber,
        });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    if (id) {
      setNotice('Saved.');
      await load();
    } else {
      router.back();
    }
  }

  /** Runs one change to the round or its panel, then shows it as saved. */
  async function change(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: changeError } = await supabase.rpc(fn, { p_round_id: id, ...args });
    setBusy(false);
    if (changeError) {
      setError(changeError.message);
      return;
    }
    setChoices(null);
    setChoosingSet(false);
    await load();
  }

  async function showChoices() {
    const { data, error: loadError } = await supabase.rpc('admin_selection_panel_choices', { p_round_id: id });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setChoices((data as PanelChoice[] | null) ?? []);
  }

  if (!loaded) return <Screen>{null}</Screen>;
  if (id && !round) {
    return (
      <Screen>
        <ErrorText>{error ?? 'This round can’t be found.'}</ErrorText>
      </Screen>
    );
  }

  const onPanel = round?.panel.filter((m) => !m.removed_at) ?? [];
  const left = round?.panel.filter((m) => m.removed_at) ?? [];
  const today = clubToday();
  const standing = dates.filter((m) => !m.removed_at);
  const takenOff = dates.filter((m) => m.removed_at);

  const numberChips = (count: number, more: boolean, max: number) => [
    ...Array.from({ length: more ? max : 6 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
    ...(more ? [] : [{ value: 'more', label: 'More' }]),
  ];
  const label = phase && roundNumber ? `Phase ${phase}, Round ${roundNumber}` : null;
  const free = clashes[0]?.free_from ?? null;
  const form = (
    <>
      <ChipGroup
        label="Phase"
        options={numberChips(9, morePhases, 9)}
        selected={phase ? [String(phase)] : []}
        onToggle={(v: string) => (v === 'more' ? setMorePhases(true) : setPhase(Number(v)))}
      />
      <ChipGroup
        label="Round"
        options={numberChips(20, moreRounds, 20)}
        selected={roundNumber ? [String(roundNumber)] : []}
        onToggle={(v: string) => (v === 'more' ? setMoreRounds(true) : setRoundNumber(Number(v)))}
      />
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Such as Trials"
        maxLength={80}
      />
      {label ? (
        <ThemedText type="small" themeColor="textSecondary">
          Shown as {label}
          {name.trim() ? ` · ${name.trim()}` : ''}
        </ThemedText>
      ) : null}
      <MonthDateField label="Starts" value={startsOn} onChange={setStartsOn} />
      <MonthDateField label="Ends" value={endsOn} onChange={setEndsOn} />
      {clashes.length > 0 ? (
        <Card style={[styles.clash, { borderColor: theme.attention }]} accessibilityRole="alert">
          <ThemedText type="smallBold">These dates overlap another round</ThemedText>
          {clashLines(clashes).map((line) => (
            <ThemedText key={line} type="small">
              {line}
            </ThemedText>
          ))}
          <ThemedText type="small">The same athletes can’t be in two rounds at once.</ThemedText>
          {free && startsOn && endsOn ? (
            <Button
              title={`Start on ${shortDate(free, true)} instead`}
              variant="secondary"
              onPress={() => {
                const moved = shiftDates(startsOn, endsOn, free);
                setStartsOn(moved.startsOn);
                setEndsOn(moved.endsOn);
              }}
            />
          ) : null}
        </Card>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {notice ? <ThemedText type="small">{notice}</ThemedText> : null}
      <Button
        title={id ? 'Save' : 'Open round'}
        onPress={save}
        busy={saving}
        disabled={clashes.length > 0}
      />
    </>
  );

  const sets = groupId && loadedSets?.group === groupId ? loadedSets.list : null;
  const chosen = sets?.find((c) => c.set_id === setId) ?? null;
  const groupName = teams.find((t) => t.id === teamId)?.name ?? round?.team_name ?? '';
  const criteriaCard = !teamId ? null : (
    <Card style={styles.card}>
      <ThemedText type="smallBold">Criteria</ThemedText>
      {sets === null ? null : sets.length === 0 ? (
        <>
          <ThemedText type="small">
            No criteria set is for {groupName}. Change who a set is for, or add one.
          </ThemedText>
          <Button
            title="Criteria sets"
            variant="secondary"
            onPress={() => router.push({ pathname: '/admin/assessments', params: { tab: 'sets' } })}
          />
        </>
      ) : chosen && !choosingSet ? (
        <>
          <ThemedText type="small">✓ {chosen.name}</ThemedText>
          {pickSet(sets)?.set_id === chosen.set_id ? (
            <ThemedText type="small" themeColor="textSecondary">
              {sets.length === 1
                ? 'Chosen for you: it is the only set for this group.'
                : `Chosen for you: it is the set for ${chosen.for_label}.`}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {setLine(chosen)}
          </ThemedText>
          {sets.length > 1 ? (
            <Button title="Choose another" variant="secondary" onPress={() => setChoosingSet(true)} />
          ) : null}
        </>
      ) : (
        <>
          <ThemedText type="small">Choose the criteria for this round</ThemedText>
          {sets.map((c) => (
            <Button
              key={c.set_id}
              title={c.name}
              variant="secondary"
              onPress={() => {
                setSetId(c.set_id);
                setChoosingSet(false);
              }}
            />
          ))}
        </>
      )}
    </Card>
  );

  if (!round) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          A round covers one squad or team’s selection phase. It takes a copy of the criteria set
          you choose, as it is now, and its panel starts as the group’s coaches who hold a current
          Working With Children Check. You can add other selectors once it is open.
        </ThemedText>
        <ChipGroup
          label="Squad or team"
          options={teams.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
          selected={teamId ? [teamId] : []}
          onToggle={chooseTeam}
        />
        {criteriaCard}
        {form}
      </Screen>
    );
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        {round.team_name} · {round.athletes} {round.athletes === 1 ? 'athlete' : 'athletes'} ·{' '}
        {round.observations} {round.observations === 1 ? 'observation' : 'observations'}
        {round.closed_at ? ` · closed ${formatDateString(round.closed_at.slice(0, 10))}` : ''}
      </ThemedText>
      <ChipGroup
        options={[
          { value: 'dates' as const, label: `Dates (${standing.length})` },
          { value: 'panel' as const, label: `Panel (${onPanel.length})` },
          { value: 'reports' as const, label: 'Reports' },
          { value: 'details' as const, label: 'Details' },
        ]}
        selected={[tab]}
        onToggle={openTab}
      />
      {tab === 'details' ? null : <ErrorText>{error}</ErrorText>}

      {tab === 'dates' ? (
        <>
          {standing.length === 0 ? (
            <ThemedText type="small">
              No dates yet. Add the steps in this round and when each is due.
            </ThemedText>
          ) : (
            <CardGrid gap={Spacing.four}>
              {standing.map((m) => {
                const late = isOverdue({ due_on: m.due_on, done: !!m.done_at }, today);
                return (
                  <PressableCard
                    key={m.id}
                    onPress={() =>
                      router.push({ pathname: '/admin/assessments/milestone', params: { round: round.id, id: m.id } })
                    }>
                    <ThemedText type="smallBold">{m.title}</ThemedText>
                    <ThemedText type={late ? 'smallBold' : 'small'} themeColor={late ? 'text' : 'textSecondary'}>
                      {milestoneLine(m, today)}
                    </ThemedText>
                  </PressableCard>
                );
              })}
            </CardGrid>
          )}
          {round.closed_at || standing.length >= MAX_MILESTONES ? null : (
            <Button
              title="Add a date"
              variant="secondary"
              onPress={() => router.push({ pathname: '/admin/assessments/milestone', params: { round: round.id } })}
            />
          )}
          <ThemedText type="small" themeColor="textSecondary">
            The panel and admins get a to-do from a week before each date, until an admin marks
            it done.
            {takenOff.length > 0
              ? ` Taken off: ${takenOff.map((m) => m.title).join(', ')}. They stay in the audit report.`
              : ''}
          </ThemedText>
        </>
      ) : null}

      {tab === 'panel' ? (
        <>
          {onPanel.length === 0 ? (
            <ThemedText type="small">Nobody is on the panel.</ThemedText>
          ) : (
            <CardGrid gap={Spacing.four}>
              {onPanel.map((member) => (
                <Card key={`${member.profile_id}-${member.added_at}`} style={styles.card}>
                  <ThemedText type="smallBold">{member.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Added {formatDateString(member.added_at.slice(0, 10))}
                    {member.added_by_name ? ` by ${member.added_by_name}` : ''}
                  </ThemedText>
                  {panelNotes(member).map((note) => (
                    <ThemedText key={note} type="small">
                      {note}
                    </ThemedText>
                  ))}
                  {member.profile_id ? (
                    <Button
                      title={`Take ${member.name} off the panel`}
                      variant="secondary"
                      busy={busy}
                      onPress={() =>
                        change('admin_remove_selection_panel_member', { p_profile_id: member.profile_id })
                      }
                    />
                  ) : null}
                </Card>
              ))}
            </CardGrid>
          )}

          {choices === null ? (
            <Button title="Add a selector" variant="secondary" onPress={showChoices} />
          ) : (
            <View style={styles.card}>
              <ThemedText type="smallBold">Add a selector</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Coaches, admins and guests can be selectors. Each needs a current Working With
                Children Check. For an independent selector, approve the person as a Guest and
                record their check on their member page: they then show here as (guest).
              </ThemedText>
              {choices.length === 0 ? (
                <ThemedText type="small">There is nobody else to add.</ThemedText>
              ) : (
                choices.map((person) =>
                  person.cleared ? (
                    <Button
                      key={person.profile_id}
                      title={`Add ${person.name ?? 'Member'}${isIndependentChoice(person) ? ' (guest)' : ''}`}
                      variant="secondary"
                      busy={busy}
                      onPress={() =>
                        change('admin_add_selection_panel_member', { p_profile_id: person.profile_id })
                      }
                    />
                  ) : (
                    <ThemedText key={person.profile_id} type="small" themeColor="textSecondary">
                      {person.name ?? 'Member'}: needs a current Working With Children Check first
                    </ThemedText>
                  ),
                )
              )}
            </View>
          )}

          {left.length > 0 ? (
            <>
              <ThemedText type="smallBold">No longer on the panel</ThemedText>
              {left.map((member) => (
                <ThemedText key={`${member.profile_id}-${member.added_at}`} type="small" themeColor="textSecondary">
                  {member.name}
                  {member.independent ? ' (independent)' : ''}: added{' '}
                  {formatDateString(member.added_at.slice(0, 10))}, removed{' '}
                  {formatDateString((member.removed_at ?? '').slice(0, 10))}
                  {member.removed_by_name ? ` by ${member.removed_by_name}` : ''}
                </ThemedText>
              ))}
            </>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Only the panel reads and writes this round’s assessments. Nobody on it can assess
            their own child. Every change here is kept and shows in the audit report.
          </ThemedText>
        </>
      ) : null}

      {tab === 'reports' ? (
        <>
          <Button
            title="Selection audit report"
            onPress={() => router.push({ pathname: '/admin/assessments/audit', params: { id: round.id } })}
          />
          <Button
            title="Summaries signed"
            variant="secondary"
            onPress={() => router.push({ pathname: '/admin/assessments/summaries', params: { id: round.id } })}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Who has signed their summary of each athlete, and when. You can reopen one signed by
            mistake. What a summary says stays with the panel.
          </ThemedText>
        </>
      ) : null}

      {tab === 'details' ? (
        <>
          {form}
          <ThemedText type="small">Criteria: {roundCriteriaLine(round) || 'none'}</ThemedText>
          {round.can_change_criteria ? (
            choosingSet ? (
              <View style={styles.card}>
                {(sets ?? [])
                  .filter((c) => c.set_id !== round.criteria_set_id)
                  .map((c) => (
                    <Button
                      key={c.set_id}
                      title={`${c.name}, version ${c.version}`}
                      variant="secondary"
                      busy={busy}
                      onPress={() => change('admin_set_selection_round_criteria', { p_set_id: c.set_id })}
                    />
                  ))}
                <Button title="Cancel" variant="secondary" onPress={() => setChoosingSet(false)} />
              </View>
            ) : (
              <>
                <Button title="Change the criteria" variant="secondary" onPress={() => setChoosingSet(true)} />
                <ThemedText type="small" themeColor="textSecondary">
                  You can change this until the first observation or summary is written.
                </ThemedText>
              </>
            )
          ) : round.closed_at ? null : (
            <ThemedText type="small" themeColor="textSecondary">
              Assessing has started, so this round keeps its criteria.
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {round.closed_at
              ? 'This round is closed: the panel can still read it, and nothing can be added.'
              : 'Close the round once the teams are named. The panel can still read it, and nothing more can be added.'}
          </ThemedText>
          <Button
            title={round.closed_at ? 'Open the round again' : 'Close the round'}
            variant="secondary"
            busy={busy}
            onPress={() => change('admin_close_selection_round', { p_closed: !round.closed_at })}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
  clash: { gap: Spacing.one, borderWidth: 1 },
});
