import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { supabase } from '@/lib/supabase';
import type { CoachTitle, GroupKind, TeamRole } from '@/lib/types';

export type KpiFormat = 'kpi' | 'okr';
export type KpiMeasureKind = 'number' | 'yes_no';
export type KpiResult = 'met' | 'partly_met' | 'not_met';

/**
 * How the signed-in member relates to someone's KPIs in a squad or team. An
 * admin reading an athlete's is a viewer.
 */
export type KpiRelation = 'self' | 'setter' | 'guardian' | 'viewer';

/** Someone in this season's squads and teams whose KPIs the member can see. */
export type KpiPerson = {
  profile_id: string;
  full_name: string;
  team_id: string;
  team_name: string;
  team_kind: GroupKind;
  season: number;
  archived: boolean;
  team_role: TeamRole;
  coach_title: CoachTitle | null;
  relation: KpiRelation;
  kpi_count: number;
  result_count: number;
  /** Review dates the admin set for the season. */
  review_count: number;
  reviews_written: number;
  reviews_confirmed: number;
};

export type KpiMeasure = {
  id: string;
  /** A key result's wording. A KPI's measure uses the KPI's title. */
  title: string | null;
  kind: KpiMeasureKind;
  target: number | null;
  unit: string | null;
  lower_is_better: boolean;
  baseline: number | null;
  current_value: number | null;
  done: boolean;
  progress_by_name: string | null;
  progress_at: string | null;
};

export type Kpi = {
  id: string;
  format: KpiFormat;
  title: string;
  detail: string | null;
  result: KpiResult | null;
  result_note: string | null;
  result_by_name: string | null;
  result_at: string | null;
  set_by_name: string | null;
  created_at: string;
  measures: KpiMeasure[];
};

/** A review date in the season, with what's been written for the person. */
export type KpiReview = {
  point_id: string;
  name: string;
  due_on: string;
  note: string | null;
  noted_by_name: string | null;
  noted_at: string | null;
  /** When the person confirmed the review was done with them. */
  confirmed_at: string | null;
  self_review: string | null;
  self_reviewed_at: string | null;
};

/** One person's KPIs in one squad or team, with what the member can do. */
export type KpiSheet = {
  profile_id: string;
  full_name: string;
  team_id: string;
  team_name: string;
  team_kind: GroupKind;
  season: number;
  archived: boolean;
  team_role: TeamRole;
  coach_title: CoachTitle | null;
  relation: KpiRelation;
  /** Add, change and remove KPIs, record results and write reviews. */
  can_edit: boolean;
  /** Record progress. */
  can_update: boolean;
  kpis: Kpi[];
  reviews: KpiReview[];
};

/** A person can have up to this many KPIs and OKRs in a squad or team. */
export const MAX_KPIS = 10;
/** An OKR has up to this many key results. */
export const MAX_KEY_RESULTS = 5;

export const formatLabels: Record<KpiFormat, string> = { kpi: 'KPI', okr: 'OKR' };

export const resultLabels: Record<KpiResult, string> = {
  met: 'Met',
  partly_met: 'Partly met',
  not_met: 'Not met',
};

export const resultOptions = (Object.keys(resultLabels) as KpiResult[]).map((value) => ({
  value,
  label: resultLabels[value],
}));

/** A review date an admin set for a season. */
export type KpiReviewPoint = { id: string; season: number; name: string; due_on: string };

/** A review the member has to write, or one of their own to confirm. */
export type KpiReviewTodo = {
  kind: 'write' | 'confirm';
  point_id: string;
  point_name: string;
  due_on: string;
  team_id: string;
  team_name: string;
  profile_id: string;
  full_name: string;
};

/** Whether the club has season KPIs on and the member is approved. */
export function useKpisOn() {
  const { profile } = useAuth();
  const { features } = useClub();
  return features.kpis && profile?.status === 'approved';
}

/** Everyone whose KPIs the member can see this season, loaded on focus. */
export function useKpiPeople() {
  const on = useKpisOn();
  const [people, setPeople] = useState<KpiPerson[] | null>(null);
  const load = useCallback(async () => {
    if (!on) return;
    const { data } = await supabase.rpc('season_kpi_people');
    setPeople((data as KpiPerson[] | null) ?? []);
  }, [on]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { kpiPeople: on ? people : [], reloadKpiPeople: load };
}

/** Reviews the member owes, for the home to-do list. */
export function useKpiReviewTodos() {
  const on = useKpisOn();
  const [todos, setTodos] = useState<KpiReviewTodo[]>([]);
  const load = useCallback(async () => {
    if (!on) return;
    const { data } = await supabase.rpc('kpi_review_todos');
    setTodos((data as KpiReviewTodo[] | null) ?? []);
  }, [on]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { kpiReviewTodos: on ? todos : [], reloadKpiReviewTodos: load };
}

export async function fetchKpiSheet(profileId: string, teamId: string) {
  const { data, error } = await supabase.rpc('season_kpi_sheet', {
    p_profile_id: profileId,
    p_team_id: teamId,
  });
  if (error) throw error;
  return (data as KpiSheet | null) ?? null;
}

/** Such as "60", "60%" or "12 sessions". */
export function amount(value: number | null, unit: string | null) {
  if (value === null || value === undefined) return '';
  const n = Number(value).toLocaleString('en-AU', { maximumFractionDigits: 2 });
  if (!unit) return n;
  return unit === '%' ? `${n}%` : `${n} ${unit}`;
}

/** The target in words, such as "Target 75%" or "Target 2 or fewer". */
export function targetLabel(m: KpiMeasure) {
  if (m.kind === 'yes_no') return 'Done or not done';
  const target = amount(m.target, m.unit);
  return m.lower_is_better ? `Target ${target} or fewer` : `Target ${target}`;
}

/** Where a measure is up to, such as "68% so far" or "Done". */
export function progressLabel(m: KpiMeasure) {
  if (m.kind === 'yes_no') return m.done ? '✓ Done' : 'Not done yet';
  if (m.current_value === null) return 'No progress recorded yet';
  return `${amount(m.current_value, m.unit)} so far`;
}

/** Whether a measure has reached its target, as far as progress shows. */
export function onTarget(m: KpiMeasure) {
  if (m.kind === 'yes_no') return m.done;
  if (m.current_value === null || m.target === null) return false;
  return m.lower_is_better ? m.current_value <= m.target : m.current_value >= m.target;
}

/** How far towards the target, from 0 to 1, for a progress bar. */
export function progressShare(m: KpiMeasure) {
  if (m.kind === 'yes_no') return m.done ? 1 : 0;
  if (m.current_value === null || m.target === null) return 0;
  if (m.lower_is_better) {
    if (m.current_value <= m.target) return 1;
    // Counts down from where they started, when that's known.
    const start = m.baseline ?? m.target * 2;
    if (start <= m.target) return 0;
    return Math.max(0, Math.min(1, (start - m.current_value) / (start - m.target)));
  }
  const start = m.baseline ?? 0;
  if (m.target <= start) return m.current_value >= m.target ? 1 : 0;
  return Math.max(0, Math.min(1, (m.current_value - start) / (m.target - start)));
}

/** "2 of 3 reviews written", or null when the season has no review dates. */
export function reviewCountLabel(p: KpiPerson) {
  if (p.review_count === 0 || p.kpi_count === 0) return null;
  const written =
    p.reviews_written === p.review_count
      ? p.review_count === 1
        ? '✓ Review written'
        : `✓ All ${p.review_count} reviews written`
      : `${p.reviews_written} of ${p.review_count} reviews written`;
  return p.reviews_written > p.reviews_confirmed
    ? `${written} · ${p.reviews_written - p.reviews_confirmed} not yet confirmed`
    : written;
}

/** "3 KPIs · 1 result recorded", for a list row. */
export function kpiCountLabel(count: number, results: number) {
  if (count === 0) return 'No KPIs yet';
  const kpis = `${count} ${count === 1 ? 'KPI' : 'KPIs'}`;
  if (results === 0) return kpis;
  return results === count ? `${kpis} · ✓ All results in` : `${kpis} · ${results} of ${count} results in`;
}

/** Who sets this person's KPIs, in a sentence for their own sheet. */
export function whoSetsLabel(teamRole: TeamRole, coachTitle: CoachTitle | null) {
  if (teamRole === 'athlete') return 'Your coaches';
  if (teamRole === 'coach' && coachTitle === 'assistant_coach') {
    return 'Your head coach and the committee';
  }
  return 'The committee';
}

/** Who else can read this person's KPIs, for their own sheet. */
export function whoSeesLabel(teamRole: TeamRole, minor: boolean) {
  if (teamRole === 'athlete') {
    return minor
      ? 'Your coaches, your parents or guardians and the club’s admins can see them. Your teammates can’t.'
      : 'Your coaches and the club’s admins can see them. Your teammates can’t.';
  }
  return 'The committee and admins can see them, and your head coach if you’re an assistant coach. Athletes and parents can’t.';
}
