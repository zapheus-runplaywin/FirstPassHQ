import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * One flagged check-in, as the Child Safety Officer sees it: the day and the
 * lowest of the four scores, never the answers or the note.
 */
export type WellbeingFlag = {
  athlete_id: string;
  athlete_name: string;
  day: string;
  lowest_score: number;
  /** Days this athlete was flagged in the last 7. */
  flags_in_7_days: number;
};

/** Flagged on this many days in 7 puts the athlete on the officer's to-do list. */
export const REPEAT_FLAGS = 3;

/** How many days of flags the officer's screen shows. */
export const WELLBEING_FLAG_DAYS = 14;

export type FlaggedAthlete = {
  id: string;
  name: string;
  /** Newest first. */
  days: { day: string; lowestScore: number }[];
  inLast7Days: number;
  /** Flagged on REPEAT_FLAGS or more days in the last 7. */
  repeated: boolean;
};

/**
 * The flags grouped by athlete: anyone flagged on 3 days in 7 first, then the
 * most recently flagged, then by name.
 */
export function groupWellbeingFlags(rows: WellbeingFlag[]): FlaggedAthlete[] {
  const byAthlete = new Map<string, FlaggedAthlete>();
  for (const row of rows) {
    let athlete = byAthlete.get(row.athlete_id);
    if (!athlete) {
      athlete = {
        id: row.athlete_id,
        name: row.athlete_name,
        days: [],
        inLast7Days: row.flags_in_7_days,
        repeated: row.flags_in_7_days >= REPEAT_FLAGS,
      };
      byAthlete.set(row.athlete_id, athlete);
    }
    athlete.days.push({ day: row.day, lowestScore: row.lowest_score });
  }
  const athletes = [...byAthlete.values()];
  for (const a of athletes) a.days.sort((x, y) => y.day.localeCompare(x.day));
  return athletes.sort(
    (a, b) =>
      Number(b.repeated) - Number(a.repeated) ||
      b.days[0].day.localeCompare(a.days[0].day) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Whether the member is the Child Safety Officer, and how many athletes were
 * flagged on 3 or more days in the last 7. Only asked when `enabled`.
 */
export function useWellbeingFlagAlerts(enabled: boolean) {
  const [alerts, setAlerts] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      supabase
        .rpc('wellbeing_flag_alerts')
        .then(({ data }) => setAlerts(typeof data === 'number' ? data : null));
    }, [enabled]),
  );
  return {
    isOfficer: enabled && alerts !== null,
    repeated: enabled ? (alerts ?? 0) : 0,
  };
}
