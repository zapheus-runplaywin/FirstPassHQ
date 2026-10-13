import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { SeasonChips, TrainingList } from '@/components/training-list';
import { Button, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { currentSeason, useTrainingRequirements } from '@/lib/training';
import { seasonLabel, useTeams } from '@/lib/use-teams';

/**
 * The integrity training members must complete each club year: add it, copy
 * last season's into a new season, and open each to see who has done it.
 */
export default function AdminTrainingScreen() {
  const teams = useTeams();
  const [choice, setChoice] = useState<number | null>(null);
  const newest = currentSeason(teams.map((t) => t.season));
  const season = choice ?? newest;
  const { requirements, counts, reload } = useTrainingRequirements(season);
  const [copying, setCopying] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requirements === null) return <Screen>{null}</Screen>;

  const seasons = [...new Set([newest, ...requirements.map((r) => r.season)])].sort(
    (a, b) => b - a,
  );
  const shown = requirements.filter((r) => r.season === season);
  const previous = requirements.filter((r) => r.season === season - 1 && !r.archived);
  const hasInduction = shown.some(
    (r) => !r.archived && r.name.toLowerCase() === INDUCTION.toLowerCase(),
  );
  const missing = previous.filter(
    (p) => !shown.some((r) => r.name.toLowerCase() === p.name.toLowerCase()),
  );

  async function copy() {
    setCopying(true);
    setError(null);
    setMessage(null);
    const { data, error: copyError } = await supabase.rpc('admin_copy_training_requirements', {
      p_from: season - 1,
      p_to: season,
    });
    setCopying(false);
    if (copyError) {
      setError(copyError.message);
      return;
    }
    const n = (data as number | null) ?? 0;
    setMessage(
      `Copied ${n} ${n === 1 ? 'course' : 'courses'} with due dates a year on. Check each one’s squads and teams.`,
    );
    await reload();
  }

  async function addInduction() {
    setAdding(true);
    setError(null);
    setMessage(null);
    const { error: addError } = await supabase.rpc('admin_add_safeguarding_induction', {
      p_season: season,
    });
    setAdding(false);
    if (addError) {
      setError(addError.message);
      return;
    }
    setMessage(
      `Added the ${INDUCTION} for coaches, managers, physios and the committee, due in 3 months. Open it to change who does it or when.`,
    );
    await reload();
  }

  return (
    <Screen>
      <Button
        title="Add training"
        onPress={() => router.push({ pathname: '/admin/training/edit', params: { season } })}
      />
      <SeasonChips seasons={seasons} season={season} onChange={setChoice} />

      {missing.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            {seasonLabel(season - 1)} had {missing.length}{' '}
            {missing.length === 1 ? 'course' : 'courses'} {seasonLabel(season)} doesn’t:{' '}
            {missing.map((r) => r.name).join(', ')}.
          </ThemedText>
          <Button
            title={`Copy ${seasonLabel(season - 1)} training`}
            variant="secondary"
            onPress={copy}
            busy={copying}
          />
        </View>
      ) : null}
      {hasInduction ? null : (
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Sport Integrity Australia’s free {INDUCTION} teaches adults how to keep children safe
            in sport.
          </ThemedText>
          <Button
            title="Add the safeguarding induction"
            variant="secondary"
            onPress={addInduction}
            busy={adding}
          />
        </View>
      )}
      {message ? <ThemedText type="small">{message}</ThemedText> : null}
      <ErrorText>{error}</ErrorText>

      {shown.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No training set for {seasonLabel(season)} yet. Add each course members must complete,
          such as Sports Integrity Australia’s safeguarding or anti-doping courses.
        </ThemedText>
      ) : (
        <TrainingList
          requirements={shown}
          counts={counts}
          teams={teams}
          onPress={(r) =>
            router.push({ pathname: '/training/requirement/[id]', params: { id: r.id } })
          }
        />
      )}
    </Screen>
  );
}

/** Sport Integrity Australia's course, added in one tap. */
const INDUCTION = 'Child Safeguarding in Sport Induction';

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
