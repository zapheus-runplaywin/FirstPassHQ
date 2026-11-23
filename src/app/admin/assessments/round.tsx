import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardGrid } from '@/components/columns';
import { MonthDateField } from '@/components/month-date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  MAX_MILESTONES,
  isIndependentChoice,
  isOverdue,
  milestoneLine,
  panelNotes,
  type AdminRound,
  type Milestone,
  type PanelChoice,
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
    setName(round.name);
    setStartsOn(round.starts_on);
    setEndsOn(round.ends_on);
  }

  async function save() {
    const missing = [
      !id && !teamId && 'a squad or team',
      !name.trim() && 'a name',
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
        })
      : await supabase.rpc('admin_open_selection_round', {
          p_team_id: teamId,
          p_name: name,
          p_starts_on: startsOn,
          p_ends_on: endsOn,
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

  const form = (
    <>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Such as 2027 selection phase"
        maxLength={80}
      />
      <MonthDateField label="Starts" value={startsOn} onChange={setStartsOn} />
      <MonthDateField label="Ends" value={endsOn} onChange={setEndsOn} />
      <ErrorText>{error}</ErrorText>
      {notice ? <ThemedText type="small">{notice}</ThemedText> : null}
      <Button title={id ? 'Save' : 'Open round'} onPress={save} busy={saving} />
    </>
  );

  if (!round) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          A round covers one squad or team’s selection phase. It takes a copy of the criteria
          as they are now, and its panel starts as the group’s coaches who hold a current
          Working With Children Check. You can add other selectors once it is open.
        </ThemedText>
        <ChipGroup
          label="Squad or team"
          options={teams.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
          selected={teamId ? [teamId] : []}
          onToggle={setTeamId}
        />
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
});
