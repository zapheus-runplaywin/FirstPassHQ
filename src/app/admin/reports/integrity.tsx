import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { SeasonChips } from '@/components/training-list';
import { ErrorText } from '@/components/ui';
import { toDateString } from '@/lib/injuries';
import { loadCourses } from '@/lib/report-data';
import { integrityReport, type CourseProgress } from '@/lib/reports';
import { currentSeason } from '@/lib/training';
import { seasonLabel, useTeams } from '@/lib/use-teams';

export default function IntegrityReportScreen() {
  const teams = useTeams();
  const [choice, setChoice] = useState<number | null>(null);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [courses, setCourses] = useState<CourseProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const newest = currentSeason(teams.map((t) => t.season));
  const season = choice ?? newest;

  const load = useCallback(async () => {
    try {
      const loaded = await loadCourses(season);
      setSeasons(loaded.seasons);
      setCourses(loaded.courses);
      setError(loaded.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The report didn’t load. Try again.');
    }
  }, [season]);

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

  const allSeasons = [...new Set([newest, ...seasons])].sort((a, b) => b - a);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SeasonChips seasons={allSeasons} season={season} onChange={setChoice} />
      <ErrorText>{error}</ErrorText>
      {courses ? (
        <ReportView
          report={integrityReport(seasonLabel(season), courses, toDateString(new Date()))}
        />
      ) : null}
    </Screen>
  );
}
