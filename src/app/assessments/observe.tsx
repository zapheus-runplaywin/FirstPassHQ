import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ConfirmDelete, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  CONTEXTS,
  MAX_EVIDENCE,
  observationProblem,
  setRating,
  type AthleteAssessment,
  type ObservationContext,
  type ObservationRating,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/** The step chosen for an item, as a chip value: "1" to "3", or "0" for seen but not rated. */
const NOT_RATED = '0';

/**
 * Adds an observation about an athlete, changes one of the member's own
 * while it is still open (opened with its id), or adds a correction to one
 * that is locked (opened with the id it corrects).
 */
export default function ObserveScreen() {
  // `context`, `on` and `about` start a new observation about a game, or one moment in it,
  // from the athlete's Games tab.
  const { round, athlete, id, corrects, context: startContext, on: startOn, about } = useLocalSearchParams<{
    round: string;
    athlete: string;
    id?: string;
    corrects?: string;
    context?: string;
    on?: string;
    about?: string;
  }>();
  const [assessment, setAssessment] = useState<AthleteAssessment | null>(null);
  const [context, setContext] = useState<ObservationContext | null>('training');
  const [observedOn, setObservedOn] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [ratings, setRatings] = useState<ObservationRating[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .rpc('athlete_assessment', { p_round_id: round, p_athlete_id: athlete })
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setError(loadError.message);
          return;
        }
        const loaded = data as AthleteAssessment;
        setAssessment(loaded);
        const existing = id ? loaded.observations.find((o) => o.id === id) : undefined;
        if (existing) {
          setContext(existing.context);
          setObservedOn(existing.observed_on);
          setNote(existing.note ?? '');
          setRatings(existing.ratings);
          const rated = new Set(existing.ratings.map((r) => r.item_key));
          setOpen(
            loaded.criteria.groups.filter((g) => g.items.some((i) => rated.has(i.key))).map((g) => g.key),
          );
        } else {
          if (CONTEXTS.some((c) => c.value === startContext)) setContext(startContext as ObservationContext);
          // A day in the round, never one still to come: the form's own check covers the rest.
          setObservedOn(startOn && /^\d{4}-\d{2}-\d{2}$/.test(startOn) && startOn <= loaded.today ? startOn : loaded.today);
          // Where and when in the game, for the selector to finish with what they saw.
          if (typeof about === 'string' && about) setNote(about.slice(0, MAX_EVIDENCE));
        }
      });
  }, [round, athlete, id, startContext, startOn, about]);

  if (!assessment) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const corrected = corrects ? assessment.observations.find((o) => o.id === corrects) : undefined;

  async function save() {
    if (!assessment) return;
    const problem = observationProblem({ context, observedOn, note, ratings }, assessment.today, assessment.starts_on);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_assessment_observation', {
      p_id: id ?? null,
      p_round_id: round,
      p_athlete_id: athlete,
      p_context: context,
      p_observed_on: observedOn,
      p_note: note,
      p_ratings: ratings,
      p_corrects_id: corrects ?? null,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  async function remove() {
    setBusy(true);
    const { error: deleteError } = await supabase.rpc('delete_assessment_observation', { p_id: id });
    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <ThemedText type="subtitle">{assessment.athlete_name ?? 'Athlete'}</ThemedText>
      {corrected ? (
        <ThemedText type="small" themeColor="textSecondary">
          A correction to your observation of {formatDateString(corrected.observed_on)}. The
          original stays on the record with this beside it.
        </ThemedText>
      ) : null}
      <TextField
        label="What you saw"
        value={note}
        onChangeText={setNote}
        placeholder="Such as “Won three intercepts in the second quarter”"
        multiline
        maxLength={MAX_EVIDENCE}
      />
      <ChipGroup
        label="Where you saw it"
        options={CONTEXTS}
        selected={context ? [context] : []}
        onToggle={setContext}
      />
      <DateField
        label="When"
        value={observedOn}
        onChange={setObservedOn}
        quickPicks={[
          { label: 'Today', days: 0 },
          { label: 'Yesterday', days: -1 },
        ]}
        max={assessment.ends_on && assessment.ends_on < assessment.today ? assessment.ends_on : assessment.today}
      />

      <ThemedText type="smallBold">Which criteria it shows</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Open a group and tap a step. One is enough.
      </ThemedText>
      {assessment.criteria.groups.map((group) => {
        const chosen = ratings.filter((r) => group.items.some((i) => i.key === r.item_key)).length;
        const isOpen = open.includes(group.key);
        return (
          <View key={group.key} style={styles.group}>
            <PressableCard
              onPress={() =>
                setOpen((keys) => (isOpen ? keys.filter((k) => k !== group.key) : [...keys, group.key]))
              }>
              <ThemedText type="smallBold">
                {group.name}
                {chosen > 0 ? ` (${chosen})` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {isOpen ? 'Tap to close' : group.items.map((i) => i.name).join(', ')}
              </ThemedText>
            </PressableCard>
            {isOpen
              ? group.items.map((item) => {
                  const current = ratings.find((r) => r.item_key === item.key);
                  const value = current ? String(current.rating ?? NOT_RATED) : null;
                  return (
                    <ChipGroup
                      key={item.key}
                      label={item.name}
                      options={[
                        ...group.scale.map((step, index) => ({ value: String(index + 1), label: step })),
                        { value: NOT_RATED, label: 'Seen, not rated' },
                      ]}
                      selected={value ? [value] : []}
                      onToggle={(step) =>
                        setRatings((all) =>
                          setRating(
                            all,
                            item.key,
                            step === value ? undefined : step === NOT_RATED ? null : Number(step),
                          ),
                        )
                      }
                    />
                  );
                })
              : null}
          </View>
        );
      })}

      <ThemedText type="small" themeColor="textSecondary">
        Write as if the athlete may read it one day. A worry about a child’s safety is raised as a
        concern from Today, not here.
      </ThemedText>

      <ErrorText>{error}</ErrorText>
      <Button title={id ? 'Save' : corrects ? 'Add correction' : 'Add observation'} onPress={save} busy={saving} />
      {id ? (
        <ConfirmDelete
          title="Remove"
          warning="This removes your observation. You can remove or change one until the end of the day after you wrote it."
          confirmTitle="Remove observation"
          onConfirm={remove}
          busy={busy}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
