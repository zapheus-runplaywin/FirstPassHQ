import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { clubToday } from '@/lib/club-time';
import { supabase } from '@/lib/supabase';
import type { CheckIn, CheckInOverviewRow, CheckInScores, CheckInSummary } from '@/lib/types';
import { hasRole } from '@/lib/roles';

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

/** The four answers while a check-in is being filled in: null until answered. */
export type CheckInAnswers = { [K in keyof CheckInScores]: number | null };

export const noAnswers: CheckInAnswers = { sleep: null, soreness: null, stress: null, mood: null };

/** How many of the four questions have an answer. */
export function answeredCount(answers: CheckInAnswers) {
  return checkInQuestions.filter((q) => answers[q.key] !== null).length;
}

/** All four are answered, so the check-in can be saved. */
export function allAnswered(answers: CheckInAnswers): answers is CheckInScores {
  return answeredCount(answers) === checkInQuestions.length;
}

/**
 * The answers carried from the check-in sheet to the full check-in, as route
 * params such as `{ sleep: '4' }`. Anything that isn't a whole score from 1 to
 * 5 is left out, so a hand-typed link can't put a bad value in the form.
 */
export function answersFromParams(params: Record<string, string | string[] | undefined>) {
  const answers: Partial<CheckInScores> = {};
  for (const q of checkInQuestions) {
    const value = params[q.key];
    if (typeof value === 'string' && /^[1-5]$/.test(value)) answers[q.key] = Number(value);
  }
  return answers;
}

/** The answers given so far, as route params for the full check-in. */
export function answersToParams(answers: CheckInAnswers) {
  const params: Record<string, string> = {};
  for (const q of checkInQuestions) {
    const value = answers[q.key];
    if (value !== null) params[q.key] = String(value);
  }
  return params;
}

/** Who sees an athlete's answers, said before they answer. */
export function checkInPrivacy(minor: boolean) {
  return `Your coaches see your answers so they can adjust training, and a low score lets them know to check in with you.${
    minor ? ' As you’re under 18, they see them once a parent or guardian agrees.' : ''
  }`;
}

/** Today in the member's own time zone, such as "2026-10-07". */
export function today() {
  return clubToday();
}

/** Athletes do the daily check-in. */
export function useIsCheckInAthlete() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && hasRole(profile, 'athlete');
}

/**
 * Coaches see their own athletes' check-ins, but not in a squad whose squad
 * phase is complete (the same rule as the database).
 */
export function useIsCheckInCoach() {
  const { profile, memberships } = useAuth();
  if (profile?.status !== 'approved') return false;
  return memberships.some((m) => m.team_role === 'coach' && !m.team.selections_completed_at);
}

/** The committee, physios and admins see squad and team averages, never individuals. */
export function useCanSeeCheckInOverview() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && hasRole(profile, 'committee', 'physio', 'admin');
}

/** Coaches, the committee, physios and admins have a check-ins screen. */
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
 * so a team isn't counted when its squad is; teams of other squads are.
 */
export function checkInTotals(summary: CheckInSummary[]) {
  const squadIds = new Set(summary.filter((s) => s.team_kind === 'squad').map((s) => s.team_id));
  const groups = summary.filter((s) => s.team_kind === 'squad' || !s.squad_id || !squadIds.has(s.squad_id));
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
