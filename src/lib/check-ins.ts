import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { CheckIn, CheckInOverviewRow, CheckInScores, CheckInSummary } from '@/lib/types';

export const CHECK_IN_COLUMNS = 'id, athlete_id, day, sleep, soreness, stress, mood, note, updated_at';

/** A score this low or lower flags the athlete for their coaches. */
export const FLAG_AT = 2;

/** The four questions, each scored 1 (bad) to 5 (good). */
export const checkInQuestions: {
  key: keyof CheckInScores;
  label: string;
  question: string;
  answers: [string, string, string, string, string];
}[] = [
  {
    key: 'sleep',
    label: 'Sleep',
    question: 'How did you sleep?',
    answers: ['Very poorly', 'Poorly', 'OK', 'Well', 'Really well'],
  },
  {
    key: 'soreness',
    label: 'Soreness',
    question: 'How does your body feel?',
    answers: ['Very sore', 'Sore', 'A little sore', 'Fine', 'Fresh'],
  },
  {
    key: 'stress',
    label: 'Stress',
    question: 'How stressed are you?',
    answers: ['Very stressed', 'Stressed', 'Normal', 'Relaxed', 'Very relaxed'],
  },
  {
    key: 'mood',
    label: 'Mood',
    question: 'How’s your mood?',
    answers: ['Very low', 'Low', 'OK', 'Good', 'Great'],
  },
];

/** The questions scored low enough to flag, such as ["Sleep", "Soreness"]. */
export function flaggedAreas(scores: { [K in keyof CheckInScores]: number | null }) {
  return checkInQuestions
    .filter((q) => scores[q.key] !== null && (scores[q.key] as number) <= FLAG_AT)
    .map((q) => q.label);
}

/** Such as "Sleep 4 · Soreness 2 · Stress 3 · Mood 4". */
export function scoresLine(scores: CheckInScores) {
  return checkInQuestions.map((q) => `${q.label} ${scores[q.key]}`).join(' · ');
}

/** Today in the member's own time zone, such as "2026-10-07". */
export function today() {
  return toDateString(new Date());
}

/** Athletes do the daily check-in. */
export function useIsCheckInAthlete() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && profile.role === 'athlete';
}

/** Coaches see their own athletes' check-ins. */
export function useIsCheckInCoach() {
  const { profile, memberships } = useAuth();
  if (profile?.status !== 'approved') return false;
  return memberships.some((m) => m.team_role === 'coach');
}

/** The committee and admins see squad and team averages, never individuals. */
export function useCanSeeCheckInOverview() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && ['committee', 'admin'].includes(profile.role);
}

/** Coaches, the committee and admins have a check-ins screen. */
export function useCanSeeCheckIns() {
  const isCoach = useIsCheckInCoach();
  const canSeeOverview = useCanSeeCheckInOverview();
  return isCoach || canSeeOverview;
}

/** The athlete's own check-in for today, or null if they haven't done it. */
export function useMyCheckIn() {
  const { session } = useAuth();
  const isAthlete = useIsCheckInAthlete();
  const userId = session?.user.id;
  // undefined while loading, so the to-do list doesn't flash an item.
  const [checkIn, setCheckIn] = useState<CheckIn | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!isAthlete || !userId) return;
    const { data } = await supabase
      .from('check_ins')
      .select(CHECK_IN_COLUMNS)
      .eq('athlete_id', userId)
      .eq('day', today())
      .maybeSingle();
    setCheckIn((data as CheckIn | null) ?? null);
  }, [isAthlete, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { myCheckIn: isAthlete ? checkIn : undefined, reloadMyCheckIn: load };
}

/** Today's check-in counts for each squad or team the member coaches. */
export function useCheckInSummary() {
  const canSee = useIsCheckInCoach();
  const [summary, setSummary] = useState<CheckInSummary[]>([]);

  const load = useCallback(async () => {
    if (!canSee) return;
    const { data } = await supabase.rpc('check_in_summary', { p_day: today() });
    setSummary((data as CheckInSummary[] | null) ?? []);
  }, [canSee]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { checkInSummary: summary, reloadCheckInSummary: load };
}

/**
 * Totals across the member's groups. A team's athletes are also in its squad,
 * so only squads are counted when the member coaches one.
 */
export function checkInTotals(summary: CheckInSummary[]) {
  const squads = summary.filter((s) => s.team_kind === 'squad');
  const groups = squads.length > 0 ? squads : summary;
  return {
    athletes: groups.reduce((n, s) => n + s.athlete_count, 0),
    checkedIn: groups.reduce((n, s) => n + s.checked_in_count, 0),
    flagged: groups.reduce((n, s) => n + s.flagged_count, 0),
  };
}

/** A summary for the home card, such as "9 of 14 checked in today · 2 flagged". */
export function checkInSummaryLabel(summary: CheckInSummary[]) {
  if (summary.length === 0) return 'See how your athletes are feeling';
  const { athletes, checkedIn, flagged } = checkInTotals(summary);
  const parts = [`${checkedIn} of ${athletes} checked in today`];
  if (flagged > 0) parts.push(`${flagged} flagged`);
  return parts.join(' · ');
}

/** The committee's overview of every current squad or team for a day. */
export function useCheckInOverview(day: string) {
  const canSee = useCanSeeCheckInOverview();
  const [overview, setOverview] = useState<CheckInOverviewRow[] | null>(null);

  const load = useCallback(async () => {
    if (!canSee) return;
    const { data } = await supabase.rpc('check_in_overview', { p_day: day });
    setOverview((data as CheckInOverviewRow[] | null) ?? []);
  }, [canSee, day]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { checkInOverview: canSee ? overview : null, reloadCheckInOverview: load };
}

/** A summary for the committee's home card, such as "42 of 60 athletes checked in today". */
export function checkInOverviewLabel(overview: CheckInOverviewRow[] | null) {
  if (!overview || overview.length === 0) return 'See how squads and teams are feeling';
  // Squads still in selections plus the teams of squads that are done, so an
  // athlete is usually counted once (twice only if they are in two teams).
  const athletes = overview.reduce((n, g) => n + g.athlete_count, 0);
  const checkedIn = overview.reduce((n, g) => n + g.checked_in_count, 0);
  return `${checkedIn} of ${athletes} athletes checked in today`;
}
