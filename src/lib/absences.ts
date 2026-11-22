import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { clubDay } from '@/lib/club-time';
import { formatDateString } from '@/lib/injuries';
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

/** An athlete injured on the day of a session. */
type InjuredOnDay = { profile_id: string; expected_return: string | null };

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

/**
 * Register notes by profile id for the day of a session: athletes reported
 * away, and athletes injured that day. Injured athletes still come to support
 * the team, so they are marked like anyone else; everyone taking attendance
 * sees that they're injured and when they're expected back, never the injury
 * itself. That stays true while an admin has Injuries turned off: the
 * injuries are still open, and whoever takes attendance needs to know a child
 * has restrictions (Matt, 2026-11-19). `teamId` null is a club event; pass
 * `enabled` false until a group is chosen.
 */
export function useAwayNotes(teamId: string | null, heldAt: string | null, enabled = true) {
  const [away, setAway] = useState<Record<string, string>>({});
  const day = heldAt ? clubDay(heldAt) : null;
  useEffect(() => {
    if (!enabled || !day) return;
    let current = true;
    Promise.all([
      supabase.rpc('absences_on', { p_team_id: teamId, p_day: day }),
      supabase.rpc('injured_on', { p_team_id: teamId, p_day: day }),
    ]).then(([absences, injured]) => {
      if (!current) return;
      const notes: Record<string, string> = {};
      for (const i of (injured.data as InjuredOnDay[] | null) ?? []) {
        notes[i.profile_id] = injuredLabel(i.expected_return);
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
  }, [teamId, day, enabled]);
  return enabled ? away : {};
}

/** An absence reported or withdrawn since the coach or manager last reviewed. */
export type AbsenceToReview = UpcomingAbsence & {
  withdrawn: boolean;
  changed_at: string;
};

/**
 * Absences reported or withdrawn for the athletes in the squads and teams the
 * member coaches or manages, since they last tapped Mark as reviewed. Pass
 * `enabled` false for members who don't lead a group.
 */
export function useAbsencesToReview(enabled: boolean) {
  const [toReview, setToReview] = useState<AbsenceToReview[]>([]);
  const load = useCallback(async () => {
    if (!enabled) return;
    const { data } = await supabase.rpc('absences_to_review');
    setToReview((data as AbsenceToReview[] | null) ?? []);
  }, [enabled]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  const markReviewed = useCallback(async () => {
    const { error } = await supabase.rpc('mark_absences_reviewed');
    if (!error) setToReview([]);
    return error;
  }, []);
  return {
    absencesToReview: enabled ? toReview : [],
    reloadAbsencesToReview: load,
    markAbsencesReviewed: markReviewed,
  };
}

/** Coaches and managers of a squad or team review its new and changed absences. */
export function useLeadsAGroup() {
  const { memberships, profile } = useAuth();
  const { features } = useClub();
  return (
    features.attendance &&
    profile?.status === 'approved' &&
    memberships.some((m) => m.team_role === 'coach' || m.team_role === 'manager')
  );
}
