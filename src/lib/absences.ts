import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { useClub } from '@/lib/club';
import { formatDateString, toDateString, useCanSeeInjuries } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Injury } from '@/lib/types';

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

/** Such as "Injured, back Sat, Oct 24, 2026", for a register. */
export function injuredLabel(expectedReturn: string | null) {
  return expectedReturn ? `Injured, back ${formatDateString(expectedReturn)}` : 'Injured';
}

/** Whether an injury was current on a day ("2026-10-09"). */
function injuredOnDay(
  i: Pick<Injury, 'injured_on' | 'status' | 'cleared_at'>,
  day: string,
) {
  return (
    i.injured_on <= day &&
    (i.status !== 'cleared' || !i.cleared_at || toDateString(new Date(i.cleared_at)) > day)
  );
}

/**
 * Register notes by profile id for the day of a session: athletes reported
 * away, and athletes injured that day. Injured athletes still come to support
 * the team, so they are marked like anyone else. Injuries show only to those
 * who can already see them (not managers, and not coaches of an under 18
 * whose parents haven't given consent). `teamId` null is a club event; pass
 * `enabled` false until a group is chosen.
 */
export function useAwayNotes(teamId: string | null, heldAt: string | null, enabled = true) {
  const { features } = useClub();
  const canSeeInjuries = useCanSeeInjuries() && features.injuries;
  const [away, setAway] = useState<Record<string, string>>({});
  const day = heldAt ? toDateString(new Date(heldAt)) : null;
  useEffect(() => {
    if (!enabled || !day) return;
    let current = true;
    Promise.all([
      supabase.rpc('absences_on', { p_team_id: teamId, p_day: day }),
      canSeeInjuries
        ? supabase.rpc('visible_injuries', { p_include_cleared: true })
        : Promise.resolve({ data: [] }),
    ]).then(([absences, injuries]) => {
      if (!current) return;
      const notes: Record<string, string> = {};
      for (const i of (injuries.data as Injury[] | null) ?? []) {
        if (injuredOnDay(i, day) && !notes[i.athlete_id]) {
          notes[i.athlete_id] = injuredLabel(i.expected_return);
        }
      }
      for (const a of (absences.data as AbsenceOnDay[] | null) ?? []) {
        notes[a.profile_id] = notes[a.profile_id]
          ? `${notes[a.profile_id]} · ${awayLabel(a)}`
          : awayLabel(a);
      }
      setAway(notes);
    });
    return () => {
      current = false;
    };
  }, [teamId, day, enabled, canSeeInjuries]);
  return enabled ? away : {};
}
