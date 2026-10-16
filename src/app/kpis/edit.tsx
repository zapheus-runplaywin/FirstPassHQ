import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  MAX_KEY_RESULTS,
  fetchKpiSheet,
  formatLabels,
  type KpiFormat,
  type KpiMeasureKind,
} from '@/lib/kpis';
import { supabase } from '@/lib/supabase';

type MeasureDraft = {
  id?: string;
  title: string;
  kind: KpiMeasureKind;
  target: string;
  unit: string;
  lowerIsBetter: boolean;
  baseline: string;
};

const blankMeasure = (): MeasureDraft => ({
  title: '',
  kind: 'number',
  target: '',
  unit: '',
  lowerIsBetter: false,
  baseline: '',
});

const formatOptions = [
  { value: 'kpi' as const, label: 'KPI: one measure' },
  { value: 'okr' as const, label: 'OKR: objective and key results' },
];

const kindOptions = [
  { value: 'number' as const, label: 'A number' },
  { value: 'yes_no' as const, label: 'Done or not done' },
];

function toNumber(text: string) {
  const t = text.trim().replace(',', '.');
  return t === '' ? null : Number(t);
}

/** Adds a season KPI or OKR for someone, or changes one. */
export default function EditKpiScreen() {
  const { profile, team, name, kpi } = useLocalSearchParams<{
    profile: string;
    team: string;
    name?: string;
    kpi?: string;
  }>();
  const [loaded, setLoaded] = useState(!kpi);
  const [format, setFormat] = useState<KpiFormat>('kpi');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [measures, setMeasures] = useState<MeasureDraft[]>([blankMeasure()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kpi) return;
    fetchKpiSheet(profile, team)
      .then((sheet) => {
        const existing = sheet?.kpis.find((k) => k.id === kpi);
        if (existing) {
          setFormat(existing.format);
          setTitle(existing.title);
          setDetail(existing.detail ?? '');
          setMeasures(
            existing.measures.map((m) => ({
              id: m.id,
              title: m.title ?? '',
              kind: m.kind,
              target: m.target === null ? '' : String(m.target),
              unit: m.unit ?? '',
              lowerIsBetter: m.lower_is_better,
              baseline: m.baseline === null ? '' : String(m.baseline),
            })),
          );
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'This KPI didn’t load.'))
      .finally(() => setLoaded(true));
  }, [kpi, profile, team]);

  function chooseFormat(next: KpiFormat) {
    setFormat(next);
    // A KPI has one measure; keep the first when switching back from an OKR.
    if (next === 'kpi') setMeasures((list) => list.slice(0, 1));
  }

  function changeMeasure(index: number, change: Partial<MeasureDraft>) {
    setMeasures((list) => list.map((m, i) => (i === index ? { ...m, ...change } : m)));
  }

  const badNumber = measures.some(
    (m) =>
      m.kind === 'number' &&
      [m.target, m.baseline].some((t) => {
        const n = toNumber(t);
        return n !== null && Number.isNaN(n);
      }),
  );
  const complete =
    title.trim() !== '' &&
    measures.every(
      (m) => (format === 'kpi' || m.title.trim() !== '') && (m.kind !== 'number' || toNumber(m.target) !== null),
    );

  async function save() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_season_kpi', {
      p_kpi_id: kpi ?? null,
      p_profile_id: profile,
      p_team_id: team,
      p_format: format,
      p_title: title,
      p_detail: detail,
      p_measures: measures.map((m) => ({
        id: m.id ?? null,
        title: m.title,
        kind: m.kind,
        target: toNumber(m.target),
        unit: m.unit,
        lower_is_better: m.lowerIsBetter,
        baseline: toNumber(m.baseline),
      })),
    });
    setSaving(false);
    if (saveError) setError(saveError.message);
    else router.back();
  }

  async function remove() {
    setSaving(true);
    const { error: deleteError } = await supabase.rpc('delete_season_kpi', { p_kpi_id: kpi });
    setSaving(false);
    if (deleteError) setError(deleteError.message);
    else router.back();
  }

  if (!loaded) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Stack.Screen options={{ title: kpi ? `Edit ${formatLabels[format]}` : 'Add a KPI or OKR' }} />
      {name ? (
        <ThemedText type="small" themeColor="textSecondary">
          For {name}
        </ThemedText>
      ) : null}

      <ChipGroup
        label="Type"
        options={formatOptions}
        selected={[format]}
        onToggle={chooseFormat}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {format === 'kpi'
          ? 'One thing to measure by the end of the season, such as “Squad attendance of 85%”.'
          : 'An objective, such as “Become a reliable goal shooter”, with up to 5 key results that show it’s been achieved.'}
      </ThemedText>

      <TextField
        label={format === 'kpi' ? 'KPI' : 'Objective'}
        value={title}
        onChangeText={setTitle}
        placeholder={format === 'kpi' ? 'For example, squad attendance' : 'For example, lead the defensive end'}
        maxLength={200}
      />
      <TextField
        label="Details (optional)"
        value={detail}
        onChangeText={setDetail}
        placeholder="How it’s measured, or why it matters"
        maxLength={1000}
        multiline
      />

      {measures.map((m, index) => (
        <Card key={m.id ?? `new-${index}`} style={styles.card}>
          <ThemedText type="smallBold">
            {format === 'kpi' ? 'Measure' : `Key result ${index + 1}`}
          </ThemedText>
          {format === 'okr' ? (
            <TextField
              label="Key result"
              value={m.title}
              onChangeText={(text) => changeMeasure(index, { title: text })}
              placeholder="For example, shooting percentage"
              maxLength={200}
            />
          ) : null}
          <ChipGroup
            label="Measured as"
            options={kindOptions}
            selected={[m.kind]}
            onToggle={(kind) => changeMeasure(index, { kind })}
          />
          {m.kind === 'number' ? (
            <>
              <View style={styles.inline}>
                <View style={styles.flex}>
                  <TextField
                    label="Target"
                    value={m.target}
                    onChangeText={(text) => changeMeasure(index, { target: text })}
                    keyboardType="decimal-pad"
                    maxLength={12}
                  />
                </View>
                <View style={styles.flex}>
                  <TextField
                    label="Unit (optional)"
                    value={m.unit}
                    onChangeText={(text) => changeMeasure(index, { unit: text })}
                    placeholder="%, sessions, games"
                    maxLength={40}
                  />
                </View>
              </View>
              <TextField
                label="Starting point (optional)"
                value={m.baseline}
                onChangeText={(text) => changeMeasure(index, { baseline: text })}
                keyboardType="decimal-pad"
                maxLength={12}
              />
              <ChipGroup
                options={[{ value: 'lower', label: 'Lower is better' }]}
                selected={m.lowerIsBetter ? ['lower'] : []}
                onToggle={() => changeMeasure(index, { lowerIsBetter: !m.lowerIsBetter })}
              />
            </>
          ) : null}
          {format === 'okr' && measures.length > 1 ? (
            <Button
              title="Remove key result"
              variant="secondary"
              onPress={() => setMeasures((list) => list.filter((_, i) => i !== index))}
            />
          ) : null}
        </Card>
      ))}

      {format === 'okr' && measures.length < MAX_KEY_RESULTS ? (
        <Button
          title="Add a key result"
          variant="secondary"
          onPress={() => setMeasures((list) => [...list, blankMeasure()])}
        />
      ) : null}

      {kpi ? (
        <ThemedText type="small" themeColor="textSecondary">
          Progress already recorded stays with each measure you keep.
        </ThemedText>
      ) : null}

      <ErrorText>{badNumber ? 'Targets and starting points must be numbers.' : error}</ErrorText>
      <Button
        title={kpi ? 'Save' : `Add ${formatLabels[format]}`}
        onPress={save}
        busy={saving}
        disabled={!complete || badNumber}
      />
      {kpi ? (
        <ConfirmDelete
          title={`Remove ${formatLabels[format]}`}
          warning="Remove it, with its progress and result? This can’t be undone."
          confirmTitle="Remove it"
          busy={saving}
          onConfirm={remove}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
  inline: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
});
