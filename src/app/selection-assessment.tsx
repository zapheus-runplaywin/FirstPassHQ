import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { ReleasedAssessmentView } from '@/components/released-assessment';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useMyReleasedAssessments } from '@/lib/assessments';
import { supabase } from '@/lib/supabase';

/**
 * An assessment the head coach released to an athlete, for the athlete and
 * the verified parents of one under 18. Read only: nobody can reply.
 */
export default function SelectionAssessmentScreen() {
  const { round, athlete } = useLocalSearchParams<{ round: string; athlete: string }>();
  const { selectionReleases, reloadSelectionReleases } = useMyReleasedAssessments();
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const assessment = selectionReleases.find((r) => r.round_id === round && r.athlete_id === athlete);

  // The first time the athlete or a parent opens it is kept, for the head coach and the audit.
  useEffect(() => {
    supabase.rpc('mark_assessment_release_seen', { p_round_id: round, p_athlete_id: athlete }).then(() => setLoaded(true));
  }, [round, athlete]);

  async function onRefresh() {
    setRefreshing(true);
    await reloadSelectionReleases();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {assessment ? (
        <ReleasedAssessmentView assessment={assessment} />
      ) : loaded ? (
        <ThemedText type="small" themeColor="textSecondary">
          This assessment isn’t shared now.
        </ThemedText>
      ) : null}
    </Screen>
  );
}
