import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Fold } from '@/components/member-tabs';
import { ReleasedAssessmentView } from '@/components/released-assessment';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ConfirmDelete, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  defaultReleaseParts,
  groupsWithSteps,
  releasePartsLine,
  releasePartsProblem,
  releasePreview,
  releaseReaders,
  roundTitle,
  type AthleteRelease,
  type ReleaseParts,
  type ReleaseStatus,
  type RoundSheet,
  type SummaryStatus,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

const day = (at: string) => formatDateString(at.slice(0, 10));

/**
 * The head coach releases an athlete's assessment, taken from their own
 * signed summary: the parts they tick, and nothing else a selector wrote.
 * With no athlete, it releases to everyone whose summary they have signed.
 */
export default function ReleaseScreen() {
  const { round, athlete } = useLocalSearchParams<{ round: string; athlete?: string }>();
  return athlete ? <ReleaseOne round={round} athlete={athlete} /> : <ReleaseEveryone round={round} />;
}

/** A tick row, like the admin's "Who it's for". */
function Tick({
  label,
  ticked,
  onPress,
  disabled = false,
  note,
}: {
  label: string;
  ticked: boolean;
  onPress: () => void;
  disabled?: boolean;
  note?: string | null;
}) {
  return (
    <View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked: ticked, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[styles.box, disabled && styles.dim]}>
        <ThemedText type="small">{ticked ? '☑' : '☐'}</ThemedText>
        <ThemedText type="small">{label}</ThemedText>
      </Pressable>
      {note ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          {note}
        </ThemedText>
      ) : null}
    </View>
  );
}

function ReleaseOne({ round, athlete }: { round: string; athlete: string }) {
  const [loaded, setLoaded] = useState<AthleteRelease | null>(null);
  const [parts, setParts] = useState<ReleaseParts | null>(null);
  const [choosingGroups, setChoosingGroups] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('athlete_release', { p_round_id: round, p_athlete_id: athlete });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const release = data as AthleteRelease;
    setError(null);
    setLoaded(release);
    setParts(release.summary ? defaultReleaseParts(release.criteria, release.summary) : null);
  }, [round, athlete]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!loaded) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const name = loaded.athlete_name ?? 'the athlete';
  const total = loaded.criteria.groups.length;
  const heading = (
    <>
      <ThemedText type="subtitle">{loaded.athlete_name ?? 'Athlete'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {roundTitle(loaded)}
      </ThemedText>
    </>
  );

  async function release() {
    if (!parts) return;
    const problem = releasePartsProblem(parts);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const { error: saveError } = await supabase.rpc('release_assessment', {
      p_round_id: round,
      p_athlete_id: athlete,
      p_parts: parts,
    });
    setBusy(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setPreview(false);
    await load();
  }

  async function takeBack() {
    setBusy(true);
    const { error: saveError } = await supabase.rpc('withdraw_assessment_release', { p_round_id: round, p_athlete_id: athlete });
    setBusy(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    await load();
  }

  // Released: what was released, when, and whether it was read.
  if (loaded.release?.released_at) {
    const r = loaded.release;
    const shown = loaded.summary ? releasePreview(loaded, loaded.summary, r.parts) : null;
    return (
      <Screen>
        {heading}
        <ThemedText type="smallBold">Released {day(r.released_at as string)}.</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {r.seen_at ? `${name} or a parent first read it on ${day(r.seen_at)}.` : 'Not read yet.'}
        </ThemedText>
        <ThemedText type="small">{releasePartsLine(r.parts, total)}</ThemedText>
        <ErrorText>{error}</ErrorText>
        {shown ? (
          <Fold title={`See it as ${name} does`}>
            <ReleasedAssessmentView assessment={{ ...shown, released_on: (r.released_at as string).slice(0, 10), from_name: r.released_by_name }} />
          </Fold>
        ) : null}
        {loaded.can_release ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Take it back to change what {name} sees. They stop seeing it straight away.
            </ThemedText>
            <ConfirmDelete
              title="Take it back"
              warning={`${name} will no longer see this assessment until you release it again. Taking it back is kept for the audit report.`}
              confirmTitle="Take it back"
              onConfirm={takeBack}
              busy={busy}
            />
          </>
        ) : loaded.closed ? (
          <ThemedText type="small" themeColor="textSecondary">
            This round is closed. An admin can open it again.
          </ThemedText>
        ) : null}
      </Screen>
    );
  }

  // Not the head coach, or the round is closed: nothing to release here.
  if (!loaded.can_release) {
    return (
      <Screen>
        {heading}
        <ThemedText type="small" themeColor="textSecondary">
          Not released.
        </ThemedText>
        {loaded.closed ? (
          <ThemedText type="small" themeColor="textSecondary">
            This round is closed. An admin can open it again.
          </ThemedText>
        ) : null}
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  if (!loaded.summary || !parts) {
    return (
      <Screen>
        {heading}
        <ThemedText type="small">
          Sign your summary of {name} first. What {name} sees is taken from it.
        </ThemedText>
        <Button
          title="Open my summary"
          onPress={() => router.push({ pathname: '/assessments/summary', params: { round, athlete } })}
        />
      </Screen>
    );
  }

  const summary = loaded.summary;
  const rated = groupsWithSteps(loaded.criteria, summary);
  const noStep = total - rated.length;
  const toggle = (key: keyof Omit<ReleaseParts, 'groups'>) => setParts({ ...parts, [key]: !parts[key] });
  const toggleGroup = (key: string) =>
    setParts({ ...parts, groups: parts.groups.includes(key) ? parts.groups.filter((g) => g !== key) : [...parts.groups, key] });
  const text: [keyof Omit<ReleaseParts, 'groups'>, string, string | null][] = [
    ['strengths', 'Strengths', summary.strengths],
    ['priorities', 'Development priorities', summary.priorities],
    ['comments', 'Comments', summary.comments],
    ['recommendation', 'Recommendation', summary.recommendation],
  ];

  return (
    <Screen>
      {heading}
      <ThemedText type="small">
        {name} sees what you tick, taken from your signed summary. Nothing else a selector wrote is shown.
      </ThemedText>
      <Tick
        label="Ratings"
        ticked={parts.groups.length > 0}
        disabled={rated.length === 0}
        onPress={() => setParts({ ...parts, groups: parts.groups.length > 0 ? [] : rated })}
        note={
          rated.length === 0
            ? 'Nothing rated'
            : parts.groups.length === total
              ? `All ${total} groups`
              : `${parts.groups.length} of ${total} groups`
        }
      />
      {rated.length > 0 ? (
        choosingGroups ? (
          <View style={styles.groups}>
            {loaded.criteria.groups
              .filter((g) => rated.includes(g.key))
              .map((g) => (
                <Tick key={g.key} label={g.name} ticked={parts.groups.includes(g.key)} onPress={() => toggleGroup(g.key)} />
              ))}
            {noStep > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {noStep === 1 ? '1 group has' : `${noStep} groups have`} no step in your summary
              </ThemedText>
            ) : null}
          </View>
        ) : (
          <Button title="Choose groups" variant="secondary" onPress={() => setChoosingGroups(true)} />
        )
      ) : null}
      {text.map(([key, label, value]) => {
        const empty = !value || !value.trim();
        return (
          <Tick
            key={key}
            label={label}
            ticked={!empty && parts[key]}
            disabled={empty}
            onPress={() => toggle(key)}
            note={empty ? 'Nothing written' : key === 'recommendation' && !parts[key] ? 'Off unless you tick it' : null}
          />
        );
      })}
      <ThemedText type="small" themeColor="textSecondary">
        {releaseReaders(loaded)}
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      {preview ? (
        <ReleasedAssessmentView assessment={releasePreview(loaded, summary, parts)} />
      ) : (
        <Button title={`See it as ${name} will`} variant="secondary" onPress={() => setPreview(true)} />
      )}
      <ConfirmDelete
        title={`Release to ${name}`}
        warning={loaded.is_minor ? `Release this to ${name} and their verified parents?` : `Release this to ${name}?`}
        confirmTitle="Release"
        onConfirm={release}
        busy={busy}
      />
      <ThemedText type="small" themeColor="textSecondary">
        You can take it back. Each release and take-back is kept for the audit report.
      </ThemedText>
    </Screen>
  );
}

function ReleaseEveryone({ round }: { round: string }) {
  const [sheet, setSheet] = useState<RoundSheet | null>(null);
  const [summaries, setSummaries] = useState<SummaryStatus[]>([]);
  const [releases, setReleases] = useState<ReleaseStatus[]>([]);
  const [parts, setParts] = useState<ReleaseParts>({ groups: [], strengths: true, priorities: true, comments: false, recommendation: false });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('selection_round_sheet', { p_round_id: round });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const { data: summaryRows } = await supabase.rpc('selection_round_summaries', { p_round_id: round });
    const { data: releaseRows } = await supabase.rpc('selection_round_releases', { p_round_id: round });
    const loadedSheet = data as RoundSheet;
    setSheet(loadedSheet);
    setSummaries((summaryRows as SummaryStatus[] | null) ?? []);
    setReleases((releaseRows as ReleaseStatus[] | null) ?? []);
    setParts((p) => (p.groups.length === 0 && loadedSheet ? { ...p, groups: loadedSheet.criteria.groups.map((g) => g.key) } : p));
  }, [round]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!sheet) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const released = new Set(releases.map((r) => r.athlete_id));
  const signed = new Set(summaries.filter((s) => s.mine === 'signed').map((s) => s.athlete_id));
  const nameOf = (id: string) => sheet.athletes.find((a) => a.id === id)?.name ?? 'Athlete';
  const will = sheet.athletes.filter((a) => signed.has(a.id) && !released.has(a.id));
  const already = sheet.athletes.filter((a) => released.has(a.id));
  const notSigned = sheet.athletes.filter((a) => !signed.has(a.id) && !released.has(a.id));
  const allGroups = sheet.criteria.groups.map((g) => g.key);
  const toggle = (key: keyof Omit<ReleaseParts, 'groups'>) => setParts({ ...parts, [key]: !parts[key] });

  async function releaseAll() {
    const problem = releasePartsProblem(parts);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const { data, error: saveError } = await supabase.rpc('release_assessments', { p_round_id: round, p_parts: parts });
    setBusy(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setError(null);
    setNotice(`Released to ${data ?? 0} ${data === 1 ? 'athlete' : 'athletes'}.`);
    await load();
  }

  const list = (title: string, people: { id: string }[]) => (
    <Fold title={title}>
      {people.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nobody.
        </ThemedText>
      ) : (
        people.map((a) => (
          <ThemedText key={a.id} type="small">
            {nameOf(a.id)}
          </ThemedText>
        ))
      )}
    </Fold>
  );

  return (
    <Screen>
      <ThemedText type="subtitle">{roundTitle(sheet)}</ThemedText>
      <ThemedText type="small">Release to everyone whose summary you have signed.</ThemedText>
      <Tick
        label="Ratings"
        ticked={parts.groups.length > 0}
        onPress={() => setParts({ ...parts, groups: parts.groups.length > 0 ? [] : allGroups })}
        note={parts.groups.length > 0 ? 'All groups with a step in each summary' : null}
      />
      <Tick label="Strengths" ticked={parts.strengths} onPress={() => toggle('strengths')} />
      <Tick label="Development priorities" ticked={parts.priorities} onPress={() => toggle('priorities')} />
      <Tick label="Comments" ticked={parts.comments} onPress={() => toggle('comments')} />
      <Tick
        label="Recommendation"
        ticked={parts.recommendation}
        onPress={() => toggle('recommendation')}
        note={parts.recommendation ? null : 'Off unless you tick it'}
      />
      <ThemedText type="small" themeColor="textSecondary">
        A part left empty in someone’s summary is left out of theirs. Nobody can reply in the app.
      </ThemedText>
      {list(`Will be released: ${will.length} ${will.length === 1 ? 'athlete' : 'athletes'}`, will)}
      {list(`Already released: ${already.length} (not changed)`, already)}
      {list(`Not signed yet: ${notSigned.length}`, notSigned)}
      <ErrorText>{error}</ErrorText>
      {notice ? <ThemedText type="smallBold">{notice}</ThemedText> : null}
      {will.length > 0 && !sheet.closed ? (
        <ConfirmDelete
          title={`Release to ${will.length} ${will.length === 1 ? 'athlete' : 'athletes'}`}
          warning={`Release these to ${will.length === 1 ? '1 athlete' : `${will.length} athletes`}? Parents of the under 18s read theirs at the same time.`}
          confirmTitle="Release"
          onConfirm={releaseAll}
          busy={busy}
        />
      ) : null}
      {sheet.closed ? (
        <ThemedText type="small" themeColor="textSecondary">
          This round is closed. An admin can open it again.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one },
  dim: { opacity: 0.6 },
  note: { paddingLeft: Spacing.four },
  groups: { paddingLeft: Spacing.four, gap: Spacing.one },
});
