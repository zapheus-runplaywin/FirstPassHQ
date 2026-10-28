import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { today } from '@/lib/check-ins';
import { useFeature } from '@/lib/club';
import { formatShortDay } from '@/lib/format';
import { parseDateString } from '@/lib/injuries';
import {
  averageEffort,
  FLAG_WORDS,
  fitnessFatigue,
  LOAD_CAVEAT,
  monotonyAndStrain,
  parentLine,
  sourcesFor,
  type AthleteLoad,
  type LoadFlag,
} from '@/lib/load-monitoring';
import { LOAD_SOURCES, type SourceKey } from '@/lib/load-sources';
import { supabase } from '@/lib/supabase';
import type { SessionLog } from '@/lib/types';

const NOTE_LIMIT = 500;

/** A "2026-10-18" style day moved by whole days. */
function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The caveat every load screen carries. */
export function LoadCaveat() {
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {LOAD_CAVEAT}
      </ThemedText>
    </Card>
  );
}

/**
 * "Why this flag": the published sources behind it, each with what it found
 * and a link to the paper. Closed until tapped.
 */
export function WhyThisFlag({ sources, label = 'Why this flag' }: { sources: SourceKey[]; label?: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <View style={styles.why}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}>
        <ThemedText type="smallBold" style={{ color: theme.tint }}>
          {open ? `Hide ${label.toLowerCase()}` : label}
        </ThemedText>
      </Pressable>
      {open
        ? sources.map((key) => {
            const s = LOAD_SOURCES[key];
            return (
              <View key={key} style={styles.source}>
                <ThemedText type="small">{s.finding}</ThemedText>
                <Pressable accessibilityRole="link" onPress={() => Linking.openURL(s.url)}>
                  <ThemedText type="small" style={{ color: theme.tint }}>
                    {s.short}: {s.title}. {s.where}.
                  </ThemedText>
                </Pressable>
              </View>
            );
          })
        : null}
    </View>
  );
}

function useAthleteLoad(athleteId: string) {
  const [load, setLoad] = useState<AthleteLoad | null>(null);
  const fetchLoad = useCallback(async () => {
    const { data } = await supabase.rpc('athlete_load', { p_athlete: athleteId }).maybeSingle();
    setLoad((data as AthleteLoad | null) ?? null);
  }, [athleteId]);
  useFocusEffect(
    useCallback(() => {
      fetchLoad();
    }, [fetchLoad]),
  );
  return { load, reload: fetchLoad };
}

/** The flags as lines, with their sources underneath. */
function FlagLines({ flags, words }: { flags: LoadFlag[]; words: 'coach' | 'athlete' }) {
  return (
    <View style={styles.lines}>
      {flags.map((f) => (
        <ThemedText key={f} type="small">
          • {FLAG_WORDS[f][words]}
        </ThemedText>
      ))}
      {flags.includes('injury') ? (
        <ThemedText type="small" themeColor="textSecondary">
          The injury prompt comes from the club’s own injury record: check the restrictions on the
          injury.
        </ThemedText>
      ) : null}
      <WhyThisFlag sources={sourcesFor(flags)} />
    </View>
  );
}

/**
 * The athlete's own line under their sessions when they're flagged. Gentle on
 * purpose: their coach may check in, nothing more. Give it a new key after a
 * save to read the flags again.
 */
export function AthleteLoadNote({ athleteId }: { athleteId: string }) {
  return useFeature('trainingLoad') ? <AthleteLoadNoteShown athleteId={athleteId} /> : null;
}

function AthleteLoadNoteShown({ athleteId }: { athleteId: string }) {
  const { load } = useAthleteLoad(athleteId);
  const flags = load?.flags ?? [];
  if (flags.length === 0) return null;
  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold">A big week</ThemedText>
      <FlagLines flags={flags} words="athlete" />
      <ThemedText type="small" themeColor="textSecondary">
        Your coach may check in about how you’re going. It’s not a warning, just a chance to talk.
        Training load is a conversation starter, not a diagnosis.
      </ThemedText>
    </Card>
  );
}

/**
 * On an athlete's check-in page. Coaches get the flags, "Talked with them",
 * effort, monotony and strain, and for adults the fitness chart. Parents get
 * a calm card only once a coach has talked with their child.
 */
export function AthleteLoadPanel(props: { athleteId: string; name: string; logs: SessionLog[] }) {
  return useFeature('trainingLoad') ? <AthleteLoadPanelShown {...props} /> : null;
}

function AthleteLoadPanelShown({
  athleteId,
  name,
  logs,
}: {
  athleteId: string;
  name: string;
  logs: SessionLog[];
}) {
  const { load, reload } = useAthleteLoad(athleteId);
  if (!load) return null;
  // Parents get no live flags: only a coach's review.
  if (load.flags === null) {
    return load.reviewed_on && load.reviewer_name ? (
      <ParentLoadCard load={load} name={name} />
    ) : null;
  }
  return <CoachLoadPanel athleteId={athleteId} load={load} logs={logs} onSaved={reload} />;
}

function ParentLoadCard({ load, name }: { load: AthleteLoad; name: string }) {
  const flags = load.reviewed_flags ?? [];
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Training load</ThemedText>
      <Card style={styles.card}>
        <ThemedText type="small">
          {parentLine(name || 'your child', load.reviewer_name ?? 'Their coach', flags)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatShortDay(parseDateString(load.reviewed_on ?? today()))}
        </ThemedText>
        <WhyThisFlag sources={sourcesFor(flags)} label="Why the club looks at this" />
      </Card>
      <LoadCaveat />
    </View>
  );
}

function CoachLoadPanel({
  athleteId,
  load,
  logs,
  onSaved,
}: {
  athleteId: string;
  load: AthleteLoad;
  logs: SessionLog[];
  onSaved: () => void;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flags = load.flags ?? [];
  const day = today();
  const effort = averageEffort(logs, addDays(day, -6), addDays(day, 1));
  const variety = monotonyAndStrain(logs, day);

  async function talked() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('review_load_flag', {
      p_athlete: athleteId,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setNote('');
    onSaved();
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Training load</ThemedText>
      {load.reviewed_on ? (
        <Card style={styles.card}>
          <ThemedText type="small">
            {load.reviewer_name} talked with them on{' '}
            {formatShortDay(parseDateString(load.reviewed_on))}. Their flags are closed for 7 days.
          </ThemedText>
          {load.review_note ? (
            <ThemedText type="small" themeColor="textSecondary">
              Note (coaches only): {load.review_note}
            </ThemedText>
          ) : null}
          {(load.reviewed_flags ?? []).length > 0 ? (
            <FlagLines flags={load.reviewed_flags ?? []} words="coach" />
          ) : null}
        </Card>
      ) : flags.length > 0 ? (
        <Card style={styles.card}>
          <ThemedText type="smallBold">Worth a chat</ThemedText>
          <FlagLines flags={flags} words="coach" />
          <TextField
            label="Note for coaches (optional)"
            accessibilityLabel="Note for coaches (optional)"
            value={note}
            onChangeText={setNote}
            maxLength={NOTE_LIMIT}
            multiline
            placeholder="What you talked about"
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Talked with them" onPress={talked} busy={saving} />
          <ThemedText type="small" themeColor="textSecondary">
            Closes the flags for 7 days. Parents and guardians of an athlete under 18 then see that
            you checked in, never your note.
          </ThemedText>
        </Card>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          No load flags this week.
        </ThemedText>
      )}

      <Card style={styles.card}>
        <ThemedText type="small">
          {load.ratio === null
            ? 'Load ratio: not enough sessions yet.'
            : `Load ratio (last 7 days against the last 28): ${load.ratio.toFixed(2)}.`}{' '}
          {(load.weeks_before ?? 0) < 3
            ? 'Prompts for a rise in load start once they’ve logged in each of the 3 weeks before the last 7 days.'
            : ''}
        </ThemedText>
        <ThemedText type="small">
          Average effort, last 7 days: {effort === null ? 'no sessions' : `${effort} out of 10`}.
        </ThemedText>
        <ThemedText type="small">
          {variety
            ? `Monotony ${variety.monotony} and strain ${variety.strain}, last 7 days. Shown for interest: no cut-off is proven, so they never flag.`
            : 'Monotony and strain: not enough variety in the last 7 days to work out.'}
        </ThemedText>
        <WhyThisFlag sources={['foster1998', 'gabbett2016', 'impellizzeri2020']} label="About these numbers" />
      </Card>

      {load.adult ? <FitnessChart logs={logs} /> : null}
      <LoadCaveat />
    </View>
  );
}

export type { AthleteLoad };

const CHART_HEIGHT = 96;
const LINE = 2;

/**
 * Fitness and fatigue over the last 12 weeks, TrainingPeaks style, for
 * athletes 18 and over. Worked out from 18 weeks of sessions so the start
 * isn't stuck at zero.
 */
export function FitnessChart({ logs }: { logs: SessionLog[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const day = today();
  const all = fitnessFatigue(logs, addDays(day, -125), day);
  const days = all.slice(-84);
  if (logs.length === 0) return null;
  const latest = days[days.length - 1];
  const top = Math.max(1, ...days.map((d) => Math.max(d.fitness, d.fatigue)));
  const step = days.length > 1 ? width / (days.length - 1) : 0;
  const x = (i: number) => i * step;
  const y = (v: number) => CHART_HEIGHT - (v / top) * CHART_HEIGHT;

  function line(values: number[], colour: string) {
    return values.slice(0, -1).map((v, i) => {
      const x1 = x(i);
      const y1 = y(v);
      const x2 = x(i + 1);
      const y2 = y(values[i + 1]);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy) + LINE;
      return (
        <View
          key={`${colour}-${i}`}
          style={[
            styles.segment,
            {
              width: length,
              left: (x1 + x2) / 2 - length / 2,
              top: (y1 + y2) / 2 - LINE / 2,
              backgroundColor: colour,
              transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
            },
          ]}
        />
      );
    });
  }

  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold">Fitness, fatigue and form</ThemedText>
      <View
        accessible
        accessibilityLabel={`Fitness ${latest.fitness}, fatigue ${latest.fatigue}, form ${latest.form}`}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: CHART_HEIGHT }}>
        {width > 0 ? (
          <>
            {line(
              days.map((d) => d.fitness),
              theme.accent,
            )}
            {line(
              days.map((d) => d.fatigue),
              theme.textSecondary,
            )}
          </>
        ) : null}
      </View>
      <View style={styles.legend}>
        <ThemedText type="small" style={{ color: theme.accent }}>
          ━ Fitness {latest.fitness}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          ━ Fatigue {latest.fatigue}
        </ThemedText>
        <ThemedText type="small">Form {latest.form > 0 ? `+${latest.form}` : latest.form}</ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        The last 12 weeks. Fitness is a 42-day weighted average of daily load and fatigue a 7-day
        one. Form is fitness minus fatigue: below zero they’re carrying fatigue, above it they’re
        fresher. It needs about 6 weeks of steady logging to mean much, and knows nothing about
        sleep, stress or illness.
      </ThemedText>
      <WhyThisFlag sources={['coggan', 'foster2001']} label="About this chart" />
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  card: { gap: Spacing.two },
  lines: { gap: Spacing.one },
  why: { gap: Spacing.two },
  source: { gap: Spacing.half },
  legend: { flexDirection: 'row', gap: Spacing.three, flexWrap: 'wrap' },
  segment: { position: 'absolute', height: LINE, borderRadius: LINE / 2 },
});
