import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ConfirmDelete, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  MAX_GROUPS,
  MAX_ITEMS,
  MAX_NAME,
  MAX_RECOMMENDATION,
  MAX_RECOMMENDATIONS,
  MAX_SET_NAME,
  MAX_STEP,
  STARTER_RECOMMENDATIONS,
  addGroup,
  addItem,
  removeGroup,
  removeItem,
  renameGroup,
  renameItem,
  renameStep,
  saveSetTitle,
  setEventLine,
  setProblem,
  setRecommendation,
  starterCriteria,
  type Criteria,
  type CriteriaSet,
} from '@/lib/assessments';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';
import { squadsOf, teamLabel, teamsIn, useTeams } from '@/lib/use-teams';

const STEPS = ['Lowest step', 'Middle step', 'Highest step'];

type Tab = 'criteria' | 'for' | 'history';

/**
 * One criteria set: its criteria (groups of items, each group with its own
 * three-step scale, and recommendations), who it is for, and its history.
 * A round copies a set when it opens, so changes here reach new rounds only.
 * With no id it is a new set, started blank, from the example, or as a copy
 * of another set (`start`).
 */
export default function CriteriaSetScreen() {
  const { id, start } = useLocalSearchParams<{ id?: string; start?: string }>();
  const teams = useTeams();
  const [saved, setSaved] = useState<CriteriaSet | null>(null);
  const [name, setName] = useState('');
  // A new set from blank or the example starts at once; a saved set or a copy loads.
  const [criteria, setCriteria] = useState<Criteria | null>(() =>
    id || (start && start !== 'blank' && start !== 'example')
      ? null
      : start === 'example'
        ? starterCriteria()
        : addGroup({ groups: [] }),
  );
  const [forAll, setForAll] = useState(true);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('criteria');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fill(set: CriteriaSet) {
    setSaved(set);
    setName(set.name);
    setCriteria(set.criteria);
    setForAll(set.for_all);
    setTeamIds(set.for.map((f) => f.team_id).filter((t): t is string => !!t));
  }

  useEffect(() => {
    const from = id ?? (start && start !== 'blank' && start !== 'example' ? start : null);
    if (!from) return;
    supabase.rpc('admin_criteria_set', { p_set_id: from }).then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      const set = data as CriteriaSet | null;
      if (id) {
        if (set) fill(set);
        else setCriteria({ groups: [] });
        return;
      }
      setName(set ? `${set.name} copy`.slice(0, MAX_SET_NAME) : '');
      setCriteria(set?.criteria ?? addGroup({ groups: [] }));
      setForAll(set?.for_all ?? true);
      setTeamIds(set?.for.map((f) => f.team_id).filter((t): t is string => !!t) ?? []);
    });
  }, [id, start]);

  if (!criteria) return <Screen>{null}</Screen>;
  const archived = !!saved?.archived_at;
  const used = (saved?.rounds.length ?? 0) > 0;
  const changed = !!saved && JSON.stringify(criteria) !== JSON.stringify(saved.criteria);
  const recommendations = criteria.recommendations ?? [];
  const squads = squadsOf(teams);
  const loose = teams.filter((t) => t.kind !== 'squad' && !t.squad_id);

  async function save() {
    if (!criteria) return;
    const problem = setProblem(name, criteria, forAll, teamIds);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await supabase.rpc('admin_save_criteria_set', {
      p_set_id: saved?.id ?? null,
      p_name: name,
      p_criteria: criteria,
      p_for_all: forAll,
      p_team_ids: forAll ? [] : teamIds,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    if (saved) {
      const { data: fresh } = await supabase.rpc('admin_criteria_set', { p_set_id: saved.id });
      if (fresh) fill(fresh as CriteriaSet);
    } else {
      router.replace({ pathname: '/admin/assessments/criteria', params: { id: data as string } });
    }
  }

  async function act(fn: string, args: Record<string, unknown>, leave: boolean) {
    if (!saved) return;
    setBusy(true);
    setError(null);
    const { error: actError } = await supabase.rpc(fn, { p_set_id: saved.id, ...args });
    setBusy(false);
    if (actError) {
      setError(actError.message);
      return;
    }
    if (leave) {
      router.back();
      return;
    }
    const { data: fresh } = await supabase.rpc('admin_criteria_set', { p_set_id: saved.id });
    if (fresh) fill(fresh as CriteriaSet);
  }

  function toggleTeam(teamId: string) {
    setTeamIds((ids) => (ids.includes(teamId) ? ids.filter((t) => t !== teamId) : [...ids, teamId]));
  }

  function teamBox(team: Team, indent: boolean, coveredBySquad: boolean) {
    const ticked = coveredBySquad || teamIds.includes(team.id);
    const isSquad = team.kind === 'squad';
    return (
      <Pressable
        key={team.id}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked, disabled: coveredBySquad || archived }}
        disabled={coveredBySquad || archived}
        onPress={() => toggleTeam(team.id)}
        style={[styles.box, indent && styles.indent, coveredBySquad && styles.dim]}>
        <ThemedText type="small">{ticked ? '☑' : '☐'}</ThemedText>
        <ThemedText type="small">
          {teamLabel(team, teams)}
          {isSquad && ticked ? ' and its teams' : ''}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <Screen>
      <ChipGroup
        options={[
          { value: 'criteria' as const, label: `Criteria (${criteria.groups.length})` },
          { value: 'for' as const, label: 'Who it’s for' },
          ...(saved ? [{ value: 'history' as const, label: `History (${saved.events.length})` }] : []),
        ]}
        selected={[tab]}
        onToggle={setTab}
      />

      {tab === 'criteria' ? (
        <>
          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Such as Junior criteria"
            maxLength={MAX_SET_NAME}
            editable={!archived}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {used
              ? `${saved?.rounds.length} ${saved?.rounds.length === 1 ? 'round' : 'rounds'} opened with this set. They keep the wording they opened with. What you change here applies to rounds you open from now on.`
              : 'No round has used this set yet.'}
          </ThemedText>

          {criteria.groups.map((group, index) =>
            openGroup === group.key && !archived ? (
              <Card key={group.key} style={styles.card}>
                <Pressable accessibilityRole="button" onPress={() => setOpenGroup(null)}>
                  <ThemedText type="smallBold">
                    {group.name.trim() || `Group ${index + 1}`} · {group.items.length}{' '}
                    {group.items.length === 1 ? 'item' : 'items'}
                  </ThemedText>
                </Pressable>
                <TextField
                  label={`Group ${index + 1}`}
                  value={group.name}
                  onChangeText={(text) => setCriteria(renameGroup(criteria, group.key, text))}
                  placeholder="Such as Technical ability"
                  maxLength={MAX_NAME}
                />
                {STEPS.map((label, step) => (
                  <TextField
                    key={label}
                    label={`${label} (group ${index + 1})`}
                    value={group.scale[step] ?? ''}
                    onChangeText={(text) => setCriteria(renameStep(criteria, group.key, step, text))}
                    maxLength={MAX_STEP}
                  />
                ))}
                {group.items.map((item, itemIndex) => (
                  <TextField
                    key={item.key}
                    label={`Item ${itemIndex + 1} (group ${index + 1})`}
                    value={item.name}
                    onChangeText={(text) => setCriteria(renameItem(criteria, group.key, item.key, text))}
                    placeholder="Such as Decision making"
                    maxLength={MAX_NAME}
                  />
                ))}
                {group.items.length < MAX_ITEMS ? (
                  <Button
                    title={`Add an item to ${group.name.trim() || `group ${index + 1}`}`}
                    variant="secondary"
                    onPress={() => setCriteria(addItem(criteria, group.key))}
                  />
                ) : null}
                {group.items.length > 1 ? (
                  <Button
                    title={`Remove the last item from ${group.name.trim() || `group ${index + 1}`}`}
                    variant="secondary"
                    onPress={() =>
                      setCriteria(removeItem(criteria, group.key, group.items[group.items.length - 1].key))
                    }
                  />
                ) : null}
                <Button
                  title={`Remove ${group.name.trim() || `group ${index + 1}`}`}
                  variant="secondary"
                  onPress={() => setCriteria(removeGroup(criteria, group.key))}
                />
              </Card>
            ) : (
              <PressableCard key={group.key} onPress={() => setOpenGroup(group.key)}>
                <ThemedText type="small">
                  {group.name.trim() || `Group ${index + 1}`} · {group.items.length}{' '}
                  {group.items.length === 1 ? 'item' : 'items'}
                </ThemedText>
              </PressableCard>
            ),
          )}

          {!archived && criteria.groups.length < MAX_GROUPS ? (
            <Button
              title="Add a group"
              variant="secondary"
              onPress={() => {
                const next = addGroup(criteria);
                setCriteria(next);
                setOpenGroup(next.groups[next.groups.length - 1]?.key ?? null);
              }}
            />
          ) : null}

          {openGroup === RECOMMENDATIONS && !archived ? (
            <Card style={styles.card}>
              <Pressable accessibilityRole="button" onPress={() => setOpenGroup(null)}>
                <ThemedText type="smallBold">Recommendations · {recommendations.length}</ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">
                What a selector can recommend when they sign their summary of an athlete. Leave this
                empty and summaries have no recommendation.
              </ThemedText>
              {recommendations.map((rec, index) => (
                <TextField
                  key={index}
                  label={`Recommendation ${index + 1}`}
                  value={rec}
                  onChangeText={(text) => setCriteria(setRecommendation(criteria, index, text))}
                  maxLength={MAX_RECOMMENDATION}
                />
              ))}
              {recommendations.length === 0 ? (
                <Button
                  title="Use the usual four"
                  variant="secondary"
                  onPress={() => setCriteria({ ...criteria, recommendations: [...STARTER_RECOMMENDATIONS] })}
                />
              ) : null}
              {recommendations.length < MAX_RECOMMENDATIONS ? (
                <Button
                  title="Add a recommendation"
                  variant="secondary"
                  onPress={() => setCriteria(setRecommendation(criteria, recommendations.length, ''))}
                />
              ) : null}
              {recommendations.length > 0 ? (
                <Button
                  title="Remove the last recommendation"
                  variant="secondary"
                  onPress={() => setCriteria(setRecommendation(criteria, recommendations.length - 1, null))}
                />
              ) : null}
            </Card>
          ) : (
            <PressableCard onPress={() => setOpenGroup(RECOMMENDATIONS)}>
              <ThemedText type="small">Recommendations · {recommendations.length}</ThemedText>
            </PressableCard>
          )}
        </>
      ) : null}

      {tab === 'for' ? (
        <>
          <ChipGroup
            options={[
              { value: 'all' as const, label: 'Every squad and team' },
              { value: 'some' as const, label: 'Only the ones I choose' },
            ]}
            selected={[forAll ? 'all' : 'some']}
            onToggle={(v) => !archived && setForAll(v === 'all')}
          />
          {forAll ? null : (
            <View style={styles.list}>
              {squads.map((squad) => {
                const squadTicked = teamIds.includes(squad.id);
                return (
                  <View key={squad.id}>
                    {teamBox(squad, false, false)}
                    {teamsIn(teams, squad.id).map((team) => teamBox(team, true, squadTicked))}
                  </View>
                );
              })}
              {loose.map((team) => teamBox(team, false, false))}
              <ThemedText type="small" themeColor="textSecondary">
                Choosing a squad covers its teams, including teams you name later. Rounds already
                open aren’t changed.
              </ThemedText>
            </View>
          )}
        </>
      ) : null}

      {tab === 'history' && saved ? (
        <View style={styles.list}>
          {saved.events.map((event, index) => (
            <ThemedText key={`${event.at}-${index}`} type="small">
              {setEventLine(event)}
            </ThemedText>
          ))}
        </View>
      ) : null}

      <ErrorText>{error}</ErrorText>
      {tab === 'history' ? null : (
        <>
          {archived ? null : (
            <Button title={saveSetTitle(!!saved, changed, saved?.version ?? 1)} onPress={save} busy={saving} />
          )}
          {saved ? (
            <Button
              title="Copy to a new set"
              variant="secondary"
              onPress={() => router.push({ pathname: '/admin/assessments/criteria', params: { start: saved.id } })}
            />
          ) : null}
          {saved && !used && !archived ? (
            <ConfirmDelete
              title="Delete this set"
              warning={`Delete ${saved.name}? This can’t be undone.`}
              confirmTitle="Delete set"
              onConfirm={() => act('admin_delete_criteria_set', {}, true)}
              busy={busy}
            />
          ) : null}
          {saved && used && !archived ? (
            <>
              <Button
                title="Archive this set"
                variant="secondary"
                busy={busy}
                onPress={() => act('admin_archive_criteria_set', { p_archived: true }, false)}
              />
              <ThemedText type="small" themeColor="textSecondary">
                A round has used this set, so it is archived, not deleted. An archived set can’t be
                chosen for a new round, and you can bring it back.
              </ThemedText>
            </>
          ) : null}
          {saved && archived ? (
            <Button
              title="Bring this set back"
              variant="secondary"
              busy={busy}
              onPress={() => act('admin_archive_criteria_set', { p_archived: false }, false)}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const RECOMMENDATIONS = '__recommendations';

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  list: { gap: Spacing.two },
  box: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one },
  indent: { paddingLeft: Spacing.four },
  dim: { opacity: 0.6 },
});
