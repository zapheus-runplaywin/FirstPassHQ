import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { SeasonChips, TrainingList } from '@/components/training-list';
import { currentSeason, useCanCheckTraining, useTrainingRequirements } from '@/lib/training';
import { seasonLabel, useTeams } from '@/lib/use-teams';

/** Each season's training and how many members have completed it. Committee and admins. */
export default function TrainingProgressScreen() {
  const canCheck = useCanCheckTraining();
  const teams = useTeams();
  const [choice, setChoice] = useState<number | null>(null);
  const season = choice ?? currentSeason(teams.map((t) => t.season));
  const { requirements, counts, reload } = useTrainingRequirements(season);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  if (!canCheck) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          Only the committee and admins see everyone’s training.
        </ThemedText>
      </Screen>
    );
  }
  if (requirements === null) return <Screen>{null}</Screen>;

  const seasons = [...new Set([season, ...requirements.map((r) => r.season)])].sort(
    (a, b) => b - a,
  );
  const shown = requirements.filter((r) => r.season === season);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SeasonChips seasons={seasons} season={season} onChange={setChoice} />
      {shown.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No training set for {seasonLabel(season)} yet.
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
