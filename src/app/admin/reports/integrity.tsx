import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { SeasonChips } from '@/components/training-list';
import { ErrorText } from '@/components/ui';
import { toDateString } from '@/lib/injuries';
import { integrityReport, type CourseProgress } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import {
  currentSeason,
  REQUIREMENT_COLUMNS,
  type TrainingMember,
  type TrainingRequirement,
} from '@/lib/training';
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
    const { data, error: loadError } = await supabase
      .from('training_requirements')
      .select(REQUIREMENT_COLUMNS)
      .eq('archived', false)
      .order('due_on')
      .order('name');
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const requirements = (data as TrainingRequirement[] | null) ?? [];
    setSeasons([...new Set(requirements.map((r) => r.season))]);
    const shown = requirements.filter((r) => r.season === season);
    const members = await Promise.all(
      shown.map((r) => supabase.rpc('training_requirement_members', { p_requirement_id: r.id })),
    );
    const failed = members.find((m) => m.error);
    setError(failed?.error?.message ?? null);
    setCourses(
      shown.map((r, i) => ({
        name: r.name,
        due_on: r.due_on,
        members: (members[i].data as TrainingMember[] | null) ?? [],
      })),
    );
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
