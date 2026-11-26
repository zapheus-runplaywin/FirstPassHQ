/**
 * Attendance over the last four weeks across the athletes whose records the
 * member can see, for the Attendance tile in the Team tab. It asks the same
 * question the Attendance screen's Athletes tab asks
 * (athlete_attendance_summary), so the database answers only for a coach's
 * own squads and teams (and for the committee and admins, the club).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { CARD_ATTENDANCE_WEEKS } from '@/lib/attendance';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import { attendanceRate } from '@/lib/team-hub';
import type { AthleteAttendanceSummary } from '@/lib/types';

/** Such as "88%", or null with no sessions in the four weeks (or while loading). */
export function useAttendanceRate(enabled: boolean) {
  const [athletes, setAthletes] = useState<AthleteAttendanceSummary[] | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    const since = new Date();
    since.setDate(since.getDate() - CARD_ATTENDANCE_WEEKS * 7);
    const { data } = await supabase.rpc('athlete_attendance_summary', {
      p_since: toDateString(since),
    });
    setAthletes((data as AthleteAttendanceSummary[] | null) ?? null);
  }, [enabled]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return enabled ? attendanceRate(athletes) : null;
}
