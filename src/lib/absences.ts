import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { formatDateString, toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/** A reason for an absence, from the club's list in Administration. */
export type AbsenceReason = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
};

/** The club's absence reasons in order: all of them, or only those switched on. */
export function useAbsenceReasons(onlyActive: boolean) {
  const [reasons, setReasons] = useState<AbsenceReason[] | null>(null);
  const load = useCallback(async () => {
    let query = supabase
      .from('absence_categories')
      .select('id, name, active, sort_order')
      .order('sort_order')
      .order('created_at');
    if (onlyActive) query = query.eq('active', true);
    const { data } = await query;
    setReasons((data as AbsenceReason[] | null) ?? []);
  }, [onlyActive]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { reasons, reload: load };
}

/** The reason and details together, such as "Planned holidays · Bali", or null if neither. */
export function absenceWhy(a: { category: string | null; reason: string | null }) {
  return [a.category, a.reason].filter(Boolean).join(' · ') || null;
}

/** An absence an athlete or their parent or guardian reported. */
export type Absence = {
  id: string;
  from_day: string;
  to_day: string;
  category: string | null;
  reason: string | null;
  reported_by_name: string | null;
  reported_as: 'athlete' | 'guardian';
  created_at: string;
  withdrawn_at: string | null;
};

/** A reported absence, as coaches and managers see it. */
export type UpcomingAbsence = {
  id: string;
  athlete_id: string;
  athlete_name: string;
  from_day: string;
  to_day: string;
  category: string | null;
  reason: string | null;
  reported_by_name: string | null;
};

/** An athlete away on the day of a session. */
export type AbsenceOnDay = {
  profile_id: string;
  category: string | null;
  reason: string | null;
  from_day: string;
  to_day: string;
  reported_by_name: string | null;
};

/** Such as "Fri 9 Oct", or "Fri 9 Oct to Sun 11 Oct". */
export function absenceDays(a: { from_day: string; to_day: string }) {
  return a.from_day === a.to_day
    ? formatDateString(a.from_day)
    : `${formatDateString(a.from_day)} to ${formatDateString(a.to_day)}`;
}

/** Such as "Away: Planned event · School camp", for a register. */
export function awayLabel(a: { category: string | null; reason: string | null }) {
  const why = absenceWhy(a);
  return why ? `Away: ${why}` : 'Reported away';
}

/** The absence covering a day ("2026-10-09"), if any. */
export function absenceOn<T extends { from_day: string; to_day: string }>(
  absences: T[],
  day: string,
) {
  return absences.find((a) => a.from_day <= day && day <= a.to_day);
}

/**
 * Athletes reported away on the day of a session, as register notes by
 * profile id. `teamId` null is a club event; pass `enabled` false until a
 * group is chosen.
 */
export function useAwayNotes(teamId: string | null, heldAt: string | null, enabled = true) {
  const [away, setAway] = useState<Record<string, string>>({});
  const day = heldAt ? toDateString(new Date(heldAt)) : null;
  useEffect(() => {
    if (!enabled || !day) return;
    let current = true;
    supabase.rpc('absences_on', { p_team_id: teamId, p_day: day }).then(({ data }) => {
      if (!current) return;
      const notes: Record<string, string> = {};
      for (const a of (data as AbsenceOnDay[] | null) ?? []) notes[a.profile_id] = awayLabel(a);
      setAway(notes);
    });
    return () => {
      current = false;
    };
  }, [teamId, day, enabled]);
  return enabled ? away : {};
}
