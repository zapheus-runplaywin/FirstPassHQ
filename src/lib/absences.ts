import { useEffect, useState } from 'react';

import { formatDateString, toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/** What kind of absence it is. Absences reported before categories have none. */
export type AbsenceCategory =
  | 'holiday'
  | 'sick'
  | 'injured'
  | 'school_work'
  | 'day_off'
  | 'personal'
  | 'other';

export const absenceCategories: { value: AbsenceCategory; label: string }[] = [
  { value: 'holiday', label: 'Holiday' },
  { value: 'sick', label: 'Sick' },
  { value: 'injured', label: 'Injured' },
  { value: 'school_work', label: 'School or work' },
  { value: 'day_off', label: 'Day off' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
];

/** Such as "Holiday", or null for an absence reported without a category. */
export function categoryLabel(category: AbsenceCategory | null) {
  return absenceCategories.find((c) => c.value === category)?.label ?? null;
}

/** The category and details together, such as "Holiday · Bali", or null if neither. */
export function absenceWhy(a: { category: AbsenceCategory | null; reason: string | null }) {
  return [categoryLabel(a.category), a.reason].filter(Boolean).join(' · ') || null;
}

/** An absence an athlete or their parent or guardian reported. */
export type Absence = {
  id: string;
  from_day: string;
  to_day: string;
  category: AbsenceCategory | null;
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
  category: AbsenceCategory | null;
  reason: string | null;
  reported_by_name: string | null;
};

/** An athlete away on the day of a session. */
export type AbsenceOnDay = {
  profile_id: string;
  category: AbsenceCategory | null;
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

/** Such as "Away: Holiday · School camp", for a register. */
export function awayLabel(a: { category: AbsenceCategory | null; reason: string | null }) {
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
