/**
 * How long a concern, a request to read messages or an injury clearance can
 * wait before it's marked Important, then Urgent, and who an Urgent concern
 * goes to next (the escalation chains). Admins set them under Administration >
 * Safeguarding > Concern times. The database checks the same rules
 * (supabase/migrations/20261124800000_concern_clocks_and_escalation.sql).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** The club's times, as `club_concern_times` returns them. */
export type ConcernTimes = {
  concern_first_action_hours: number;
  concern_refer_hours: number;
  concern_important_days: number;
  concern_urgent_days: number;
  concern_escalate_days: number;
  request_important_hours: number;
  request_urgent_hours: number;
  clearance_important_days: number;
  clearance_urgent_days: number;
};

/** The club's times for the signed-in member, refreshed when the screen is shown. */
export function useConcernTimes(enabled = true) {
  const [times, setTimes] = useState<ConcernTimes>(DEFAULT_CONCERN_TIMES);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      supabase
        .rpc('club_concern_times')
        .maybeSingle()
        .then(({ data }) => setTimes(timesFrom(data)));
    }, [enabled]),
  );
  return times;
}

/** The times a new club starts with. */
export const DEFAULT_CONCERN_TIMES: ConcernTimes = {
  concern_first_action_hours: 24,
  concern_refer_hours: 48,
  concern_important_days: 7,
  concern_urgent_days: 14,
  concern_escalate_days: 7,
  request_important_hours: 24,
  request_urgent_hours: 48,
  clearance_important_days: 3,
  clearance_urgent_days: 7,
};

/** Each time's label and unit, in the order the screen shows them. */
export const TIME_FIELDS: { key: keyof ConcernTimes; label: string; unit: 'hours' | 'days' }[] = [
  { key: 'concern_first_action_hours', label: 'A new concern: first step within', unit: 'hours' },
  { key: 'concern_refer_hours', label: 'A child’s concern: refer or record why not within', unit: 'hours' },
  { key: 'concern_important_days', label: 'An open concern with no step: Important after', unit: 'days' },
  { key: 'concern_urgent_days', label: 'Urgent after', unit: 'days' },
  { key: 'concern_escalate_days', label: 'Admins reached this long after the last step', unit: 'days' },
  { key: 'request_important_hours', label: 'A request to read messages: Important after', unit: 'hours' },
  { key: 'request_urgent_hours', label: 'Urgent after', unit: 'hours' },
  { key: 'clearance_important_days', label: 'A clearance to sign off: Important after', unit: 'days' },
  { key: 'clearance_urgent_days', label: 'Urgent after', unit: 'days' },
];

/** The times the database sent, with the defaults for anything missing. */
export function timesFrom(row: unknown): ConcernTimes {
  const r = (row ?? {}) as Partial<Record<keyof ConcernTimes, unknown>>;
  const out = { ...DEFAULT_CONCERN_TIMES };
  for (const { key } of TIME_FIELDS) {
    const v = r[key];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[key] = v;
  }
  return out;
}

/**
 * What's wrong with the times as typed, in the database's words, or null.
 * Hours run 1 to 720 (30 days), days 1 to 30, and Urgent comes after Important.
 */
export function timesProblem(times: Record<keyof ConcernTimes, string>): string | null {
  const n = (k: keyof ConcernTimes) => (/^\d+$/.test(times[k].trim()) ? Number(times[k]) : NaN);
  for (const { key, unit } of TIME_FIELDS) {
    const v = n(key);
    if (unit === 'hours' && !(v >= 1 && v <= 720)) return 'Hours must be between 1 and 720 (30 days)';
    if (unit === 'days' && !(v >= 1 && v <= 30)) return 'Days must be between 1 and 30';
  }
  if (
    n('concern_urgent_days') <= n('concern_important_days') ||
    n('request_urgent_hours') <= n('request_important_hours') ||
    n('clearance_urgent_days') <= n('clearance_important_days')
  ) {
    return 'Urgent must come after Important';
  }
  return null;
}

/** The times as text for the form. */
export function timesText(times: ConcernTimes): Record<keyof ConcernTimes, string> {
  const out = {} as Record<keyof ConcernTimes, string>;
  for (const { key } of TIME_FIELDS) out[key] = String(times[key]);
  return out;
}

/** The two posts a concern can be led by: who leads it starts its chain. */
export type LeadPost = 'complaints_manager' | 'child_safety_officer';

/** A post a step can name. */
export type StepPost = 'child_safety_officer' | 'complaints_manager' | 'admins';

export const POST_LABELS: Record<StepPost, string> = {
  child_safety_officer: 'Child Safety Officer',
  complaints_manager: 'Complaints Manager',
  admins: 'Admins',
};

/** One step in a chain: a post or one named person, and the days to wait before it. */
export type ChainStep =
  | { post: StepPost; person?: undefined; name: string; wait_days: number; can_act?: boolean }
  | { post?: undefined; person: string; name: string; wait_days: number; can_act?: boolean };

/** A row of `admin_escalation_chains`. */
export type ChainRow = {
  lead_post: LeadPost;
  step_no: number;
  target_post: StepPost | null;
  target_person: string | null;
  target_name: string;
  wait_days: number;
  can_act: boolean;
};

/** The most steps in one chain (Admins are added after them anyway). */
export const MAX_STEPS = 4;

/** Each lead post's chain, in order, from the database's rows. */
export function chainsFrom(rows: ChainRow[]): Record<LeadPost, ChainStep[]> {
  const chains: Record<LeadPost, ChainStep[]> = { complaints_manager: [], child_safety_officer: [] };
  for (const r of [...rows].sort((a, b) => a.step_no - b.step_no)) {
    if (!(r.lead_post in chains)) continue;
    chains[r.lead_post].push(
      r.target_post
        ? { post: r.target_post, name: r.target_name, wait_days: r.wait_days, can_act: r.can_act }
        : { person: r.target_person ?? '', name: r.target_name, wait_days: r.wait_days, can_act: r.can_act },
    );
  }
  return chains;
}

/** A step's post or person, to compare steps. */
function node(step: ChainStep) {
  return step.post ?? step.person;
}

/** The other lead post. */
export function otherLead(lead: LeadPost): LeadPost {
  return lead === 'complaints_manager' ? 'child_safety_officer' : 'complaints_manager';
}

/**
 * Whether the other post's chain already names this chain's post: then this
 * chain can't name the other post back. One post may back up the other, but
 * not both ways (Matt, 24 November 2026).
 */
function backedUpByOther(lead: LeadPost, otherSteps: ChainStep[]) {
  return otherSteps.some((s) => s.post === lead);
}

/**
 * The posts the next step could name: never the chain's own lead post, nothing
 * already in the chain, not the other post when it already has this one as
 * its backup, and nothing at all once Admins are in it.
 */
export function postsForNextStep(lead: LeadPost, steps: ChainStep[], otherSteps: ChainStep[] = []): StepPost[] {
  if (steps.some((s) => s.post === 'admins') || steps.length >= MAX_STEPS) return [];
  return (['child_safety_officer', 'complaints_manager', 'admins'] as StepPost[]).filter(
    (p) =>
      p !== lead &&
      !steps.some((s) => s.post === p) &&
      !(p === otherLead(lead) && backedUpByOther(lead, otherSteps)),
  );
}

/** Whether the next step can name a person (not once Admins are in, or the chain is full). */
export function canAddPerson(steps: ChainStep[]) {
  return !steps.some((s) => s.post === 'admins') && steps.length < MAX_STEPS;
}

/**
 * What's wrong with a chain, in the database's words, or null: at most 4
 * steps, waits of 1 to 30 days, nothing twice, never back to its own lead
 * post, not the other post when it already has this one as its backup, and
 * nothing after Admins.
 */
export function chainProblem(lead: LeadPost, steps: ChainStep[], otherSteps: ChainStep[] = []): string | null {
  if (steps.length > MAX_STEPS) return 'A chain has at most 4 steps';
  const seen = new Set<string>([lead]);
  for (const [i, step] of steps.entries()) {
    if (!Number.isInteger(step.wait_days) || step.wait_days < 1 || step.wait_days > 30) {
      return 'Wait between 1 and 30 days before each step';
    }
    if (seen.has(node(step))) return 'A chain can’t come back to a post or person already in it';
    if (step.post === otherLead(lead) && backedUpByOther(lead, otherSteps)) {
      return `${POST_LABELS[lead]} already backs up the ${POST_LABELS[otherLead(lead)]}, so it can’t be the other way round too`;
    }
    seen.add(node(step));
    if (step.post === 'admins' && i < steps.length - 1) {
      return 'Admins are the last stop, so nothing can come after them';
    }
  }
  return null;
}

/** The chain as `admin_set_escalation_chain` takes it. */
export function chainPayload(steps: ChainStep[]) {
  return steps.map((s) =>
    s.post ? { post: s.post, wait_days: s.wait_days } : { person: s.person, wait_days: s.wait_days },
  );
}

/**
 * The chain in words, Admins added as the last stop when it doesn't end
 * there: "Child Safety Officer after 7 days, then Admins after 7 days".
 */
export function chainSummary(steps: ChainStep[], escalateDays: number): string {
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const parts = steps.map((s) => `${s.name} after ${days(s.wait_days)}`);
  if (!steps.some((s) => s.post === 'admins')) parts.push(`Admins after ${days(escalateDays)}`);
  return parts.join(', then ');
}

/**
 * An injury clearance waiting for sign-off, against the club's times: amber
 * Important, then red Urgent, counted in whole days from when it was sent.
 */
export function clearanceLateness(
  sentAt: string | null | undefined,
  times: Pick<ConcernTimes, 'clearance_important_days' | 'clearance_urgent_days'>,
  now: Date = new Date(),
): 'important' | 'urgent' | null {
  if (!sentAt) return null;
  const waited = (now.getTime() - new Date(sentAt).getTime()) / 86_400_000;
  if (!(waited >= 0)) return null;
  if (waited >= times.clearance_urgent_days) return 'urgent';
  if (waited >= times.clearance_important_days) return 'important';
  return null;
}
