/**
 * An athlete's own attendance over the last four weeks, for the card that
 * opens it (My attendance in Me, Attendance on a child's page). It asks the
 * same question the attendance screen asks (athlete_attendance), so the
 * database answers only for the athlete themselves and their parents.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { CARD_ATTENDANCE_WEEKS } from '@/lib/attendance';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

export function useAttendanceCount(athleteId: string | undefined, enabled: boolean) {
  const [sessions, setSessions] = useState<{ present: boolean }[] | null>(null);
  const load = useCallback(async () => {
    if (!enabled || !athleteId) return;
    const since = new Date();
    since.setDate(since.getDate() - CARD_ATTENDANCE_WEEKS * 7);
    const { data } = await supabase.rpc('athlete_attendance', {
      p_profile_id: athleteId,
      p_since: toDateString(since),
    });
    setSessions((data as { present: boolean }[] | null) ?? null);
  }, [athleteId, enabled]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { attendance: enabled ? sessions : null, reloadAttendance: load };
}
