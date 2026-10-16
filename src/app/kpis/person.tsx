import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { formatSentAt } from '@/lib/format';
import { formatDateString } from '@/lib/injuries';
import {
  MAX_KPIS,
  amount,
  fetchKpiSheet,
  formatLabels,
  onTarget,
  progressLabel,
  progressShare,
  resultLabels,
  resultOptions,
  targetLabel,
  whoSeesLabel,
  whoSetsLabel,
  type Kpi,
  type KpiMeasure,
  type KpiResult,
  type KpiReview,
  type KpiSheet,
} from '@/lib/kpis';
import { teamPositionLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { seasonLabel } from '@/lib/use-teams';

type Call = PromiseLike<{ error: { message: string } | null }>;

/** One person's season KPIs in one squad or team, with progress and reviews. */
export default function KpiPersonScreen() {
  const { profile: profileId, team: teamId } = useLocalSearchParams<{
    profile: string;
    team: string;
  }>();
  const { profile } = useAuth();
  const [sheet, setSheet] = useState<KpiSheet | null>();
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSheet(await fetchKpiSheet(profileId, teamId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'These KPIs didn’t load. Try again.');
    }
  }, [profileId, teamId]);

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

  if (sheet === undefined) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }
  if (sheet === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          These KPIs aren’t available to you.
        </ThemedText>
      </Screen>
    );
  }

  const own = sheet.relation === 'self';
  const minor = !!profile && isMinor(profile.date_of_birth, profile.under_17);
  const intro = sheet.archived
    ? 'This season is archived, so these KPIs can be read but not changed.'
    : own
      ? `${whoSetsLabel(sheet.team_role, sheet.coach_title)} set these. Record your progress as the season goes, and add your own view at each review.`
      : sheet.relation === 'guardian'
        ? 'Set by their coaches. You can read them and how the season is going.'
        : sheet.relation === 'viewer'
          ? 'Set by their coaches. As an admin you can read them; only their coaches change them.'
          : 'Add KPIs or OKRs, record results at the end of the season and write the reviews. They can record progress too.';

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: own ? 'Your season KPIs' : sheet.full_name }} />
      <View style={styles.heading}>
        <ThemedText type="subtitle">{own ? 'Your season KPIs' : sheet.full_name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {sheet.team_name} · {seasonLabel(sheet.season)} ·{' '}
          {teamPositionLabel(sheet.team_role, sheet.coach_title)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {intro}
        </ThemedText>
      </View>
      <ErrorText>{error}</ErrorText>

      {sheet.kpis.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No KPIs have been set yet.
        </ThemedText>
      ) : null}

      {sheet.kpis.map((kpi) => (
        <KpiCard key={kpi.id} kpi={kpi} sheet={sheet} onChanged={load} />
      ))}

      {sheet.can_edit && sheet.kpis.length < MAX_KPIS ? (
        <Button
          title="Add a KPI or OKR"
          onPress={() =>
            router.push({
              pathname: '/kpis/edit',
              params: { profile: sheet.profile_id, team: sheet.team_id, name: sheet.full_name },
            })
          }
        />
      ) : null}

      {sheet.reviews.length === 0 && sheet.can_edit ? (
        <ThemedText type="small" themeColor="textSecondary">
          No review dates have been set for this season yet. An admin adds them under
          Administration, Season KPI reviews.
        </ThemedText>
      ) : null}

      {sheet.reviews.map((review) => (
        <Review key={review.point_id} review={review} sheet={sheet} onChanged={load} />
      ))}

      {own ? (
        <ThemedText type="small" themeColor="textSecondary">
          {whoSeesLabel(sheet.team_role, minor)}
        </ThemedText>
      ) : null}
    </Screen>
  );
}

function useRun(onChanged: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(call: Call) {
    setBusy(true);
    setError(null);
    const { error: callError } = await call;
    setBusy(false);
    if (callError) {
      setError(callError.message);
      return false;
    }
    await onChanged();
    return true;
  }
  return { busy, error, run };
}

function KpiCard({
  kpi,
  sheet,
  onChanged,
}: {
  kpi: Kpi;
  sheet: KpiSheet;
  onChanged: () => Promise<void>;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">{formatLabels[kpi.format]}</ThemedText>
        </View>
        <ThemedText type="smallBold" style={styles.flex}>
          {kpi.title}
        </ThemedText>
      </View>
      {kpi.detail ? <ThemedText type="small">{kpi.detail}</ThemedText> : null}
      {kpi.set_by_name ? (
        <ThemedText type="small" themeColor="textSecondary">
          Set by {kpi.set_by_name}
        </ThemedText>
      ) : null}

      {kpi.measures.map((m) => (
        <Measure
          key={m.id}
          measure={m}
          keyResult={kpi.format === 'okr'}
          canUpdate={sheet.can_update}
          onChanged={onChanged}
        />
      ))}

      {kpi.result && !sheet.can_edit ? (
        <View style={styles.result}>
          <ThemedText type="smallBold">Result: {resultLabels[kpi.result]}</ThemedText>
          {kpi.result_note ? <ThemedText type="small">{kpi.result_note}</ThemedText> : null}
          {kpi.result_by_name ? (
            <ThemedText type="small" themeColor="textSecondary">
              Recorded by {kpi.result_by_name}
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {sheet.can_edit ? (
        <>
          <ResultForm kpi={kpi} onChanged={onChanged} />
          <Button
            title={`Edit ${formatLabels[kpi.format]}`}
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/kpis/edit',
                params: {
                  profile: sheet.profile_id,
                  team: sheet.team_id,
                  name: sheet.full_name,
                  kpi: kpi.id,
                },
              })
            }
          />
        </>
      ) : null}
    </Card>
  );
}

function Measure({
  measure,
  keyResult,
  canUpdate,
  onChanged,
}: {
  measure: KpiMeasure;
  keyResult: boolean;
  canUpdate: boolean;
  onChanged: () => Promise<void>;
}) {
  const theme = useTheme();
  const [value, setValue] = useState(
    measure.current_value === null ? '' : String(measure.current_value),
  );
  const { busy, error, run } = useRun(onChanged);
  const share = progressShare(measure);
  const parsed = value.trim() === '' ? null : Number(value.replace(',', '.'));
  const changed = parsed !== measure.current_value;

  return (
    <View style={styles.measure}>
      {keyResult && measure.title ? <ThemedText type="small">{measure.title}</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">
        {targetLabel(measure)}
        {measure.baseline !== null ? ` · started at ${amount(measure.baseline, measure.unit)}` : ''}
      </ThemedText>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.round(share * 100)}%`, backgroundColor: theme.accent },
          ]}
        />
      </View>
      <ThemedText type="small">
        {progressLabel(measure)}
        {onTarget(measure) && measure.kind === 'number' ? ' · ✓ On target' : ''}
      </ThemedText>
      {measure.progress_by_name && measure.progress_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          Updated by {measure.progress_by_name}, {formatSentAt(new Date(measure.progress_at))}
        </ThemedText>
      ) : null}
      {canUpdate && measure.kind === 'number' ? (
        <View style={styles.inline}>
          <View style={styles.flex}>
            <TextField
              label={`Where it’s up to${measure.unit ? ` (${measure.unit})` : ''}`}
              value={value}
              onChangeText={setValue}
              keyboardType="decimal-pad"
              maxLength={12}
            />
          </View>
          <Button
            title="Save"
            variant="secondary"
            busy={busy}
            disabled={!changed || (parsed !== null && Number.isNaN(parsed))}
            onPress={() =>
              run(
                supabase.rpc('record_kpi_progress', {
                  p_measure_id: measure.id,
                  p_value: parsed,
                  p_done: false,
                }),
              )
            }
          />
        </View>
      ) : null}
      {canUpdate && measure.kind === 'yes_no' ? (
        <Button
          title={measure.done ? 'Mark as not done' : 'Mark as done'}
          variant="secondary"
          busy={busy}
          onPress={() =>
            run(
              supabase.rpc('record_kpi_progress', {
                p_measure_id: measure.id,
                p_value: null,
                p_done: !measure.done,
              }),
            )
          }
        />
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** For setters: how the KPI ended up, at the end of the season. */
function ResultForm({ kpi, onChanged }: { kpi: Kpi; onChanged: () => Promise<void> }) {
  const [result, setResult] = useState<KpiResult | null>(kpi.result);
  const [note, setNote] = useState(kpi.result_note ?? '');
  const { busy, error, run } = useRun(onChanged);
  const changed = result !== kpi.result || note.trim() !== (kpi.result_note ?? '');

  return (
    <View style={styles.result}>
      <ChipGroup
        label="Result"
        options={resultOptions}
        selected={result ? [result] : []}
        onToggle={(value) => setResult(value === result ? null : value)}
      />
      {result ? (
        <TextField
          label="Note on the result (optional)"
          value={note}
          onChangeText={setNote}
          maxLength={1000}
          multiline
        />
      ) : null}
      {kpi.result_by_name ? (
        <ThemedText type="small" themeColor="textSecondary">
          Recorded by {kpi.result_by_name}
        </ThemedText>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {changed ? (
        <Button
          title={result ? 'Save result' : 'Clear result'}
          busy={busy}
          onPress={() =>
            run(
              supabase.rpc('set_kpi_result', {
                p_kpi_id: kpi.id,
                p_result: result,
                p_note: note,
              }),
            )
          }
        />
      ) : null}
    </View>
  );
}

function Review({
  review,
  sheet,
  onChanged,
}: {
  review: KpiReview;
  sheet: KpiSheet;
  onChanged: () => Promise<void>;
}) {
  const own = sheet.relation === 'self';
  const { busy, error, run } = useRun(onChanged);
  // Nothing to show a reader who can't write either part.
  if (!sheet.can_edit && !(own && !sheet.archived) && !review.note && !review.self_review) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <ThemedText type="subtitle">{review.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Due {formatDateString(review.due_on)}
        </ThemedText>
      </View>
      {sheet.can_edit ? (
        <NoteForm
          label={`Your review of ${sheet.full_name}`}
          placeholder="How the season is going, and what comes next"
          saved={review.note}
          onSave={(text) =>
            supabase.rpc('save_kpi_review', {
              p_profile_id: sheet.profile_id,
              p_team_id: sheet.team_id,
              p_point_id: review.point_id,
              p_note: text,
            })
          }
          onChanged={onChanged}
        />
      ) : review.note ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {review.noted_by_name ?? 'Review'}
            {review.noted_at ? `, ${formatSentAt(new Date(review.noted_at))}` : ''}
          </ThemedText>
          <ThemedText type="small">{review.note}</ThemedText>
        </Card>
      ) : own ? (
        <ThemedText type="small" themeColor="textSecondary">
          Not written yet.
        </ThemedText>
      ) : null}

      {review.note && review.confirmed_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          ✓ {own ? 'You' : sheet.full_name} confirmed it was done,{' '}
          {formatSentAt(new Date(review.confirmed_at))}
        </ThemedText>
      ) : review.note && own && !sheet.archived ? (
        <>
          <ErrorText>{error}</ErrorText>
          <Button
            title="Confirm this review was done"
            busy={busy}
            onPress={() =>
              run(
                supabase.rpc('confirm_kpi_review', {
                  p_team_id: sheet.team_id,
                  p_point_id: review.point_id,
                }),
              )
            }
          />
        </>
      ) : review.note ? (
        <ThemedText type="small" themeColor="textSecondary">
          Waiting for {sheet.full_name} to confirm it was done.
        </ThemedText>
      ) : null}

      {own && !sheet.archived ? (
        <NoteForm
          label="Your own view (optional)"
          placeholder="How do you think the season is going?"
          saved={review.self_review}
          onSave={(text) =>
            supabase.rpc('save_kpi_self_review', {
              p_team_id: sheet.team_id,
              p_point_id: review.point_id,
              p_text: text,
            })
          }
          onChanged={onChanged}
        />
      ) : review.self_review ? (
        <SelfReview review={review} sheet={sheet} onChanged={onChanged} />
      ) : null}
    </View>
  );
}

function SelfReview({
  review,
  sheet,
  onChanged,
}: {
  review: KpiReview;
  sheet: KpiSheet;
  onChanged: () => Promise<void>;
}) {
  const { busy, error, run } = useRun(onChanged);
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {sheet.relation === 'guardian' ? 'Their own view' : `${sheet.full_name}’s own view`}
        {review.self_reviewed_at ? `, ${formatSentAt(new Date(review.self_reviewed_at))}` : ''}
      </ThemedText>
      <ThemedText type="small">{review.self_review}</ThemedText>
      {sheet.can_edit ? (
        <>
          <ErrorText>{error}</ErrorText>
          <ConfirmDelete
            title="Remove"
            warning={`Remove what ${sheet.full_name} wrote? Do this only if it shouldn’t be here.`}
            confirmTitle="Remove it"
            busy={busy}
            onConfirm={() =>
              run(
                supabase.rpc('remove_kpi_self_review', {
                  p_profile_id: sheet.profile_id,
                  p_team_id: sheet.team_id,
                  p_point_id: review.point_id,
                }),
              )
            }
          />
        </>
      ) : null}
    </Card>
  );
}

function NoteForm({
  label,
  placeholder,
  saved,
  onSave,
  onChanged,
}: {
  label: string;
  placeholder?: string;
  saved: string | null;
  onSave: (text: string) => Call;
  onChanged: () => Promise<void>;
}) {
  const [text, setText] = useState(saved ?? '');
  const { busy, error, run } = useRun(onChanged);
  const changed = text.trim() !== (saved ?? '');
  return (
    <View style={styles.section}>
      <TextField
        label={label}
        placeholder={placeholder}
        value={text}
        onChangeText={setText}
        maxLength={2000}
        multiline
      />
      <ErrorText>{error}</ErrorText>
      {changed ? (
        <Button
          title={text.trim() ? 'Save' : 'Clear'}
          variant="secondary"
          busy={busy}
          onPress={() => run(onSave(text))}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 6,
  },
  measure: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  result: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
});
