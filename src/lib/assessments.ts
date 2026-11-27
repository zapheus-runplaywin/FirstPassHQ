import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/club';
import { clubToday } from '@/lib/club-time';
import { formatDateString } from '@/lib/injuries';
import type { Report, ReportSection } from '@/lib/pdf';
import { hasRole } from '@/lib/roles';
import { canWorkWithChildren } from '@/lib/safety';
import { supabase } from '@/lib/supabase';

/**
 * Selection assessments (Matt, 23 November 2026): the club's own criteria, a
 * selection round for a squad or team, and the observations its panel adds
 * bit by bit. Panel members read and write assessments; admins set it up and
 * build an audit report of how the work was done, and never read one.
 *
 * Nothing here adds up to a score or puts athletes in order: the picture
 * shows what has been seen against each criterion, and what hasn't.
 */

/** One thing an athlete is assessed on, such as "Passing and delivery". */
export type CriteriaItem = { key: string; name: string };

/** A group of items sharing one three-step scale, such as "Technical ability". */
export type CriteriaGroup = {
  key: string;
  name: string;
  /** The three steps, lowest first. */
  scale: string[];
  items: CriteriaItem[];
};

export type Criteria = {
  groups: CriteriaGroup[];
  /** What a selector can recommend in a summary, such as "Select". None, or two to eight. */
  recommendations?: string[];
};

export const MAX_GROUPS = 20;
export const MAX_ITEMS = 12;
export const MAX_NAME = 60;
export const MAX_STEP = 30;
export const MAX_EVIDENCE = 1000;
export const MAX_RECOMMENDATIONS = 8;
export const MAX_RECOMMENDATION = 40;
export const MAX_SUMMARY_TEXT = 1000;

/** A usual set of recommendations a club can start from and change. */
export const STARTER_RECOMMENDATIONS = [
  'Select',
  'Select as a training partner',
  'Not selected this time',
  'More evidence needed',
];

export const DEFAULT_SCALE = ['Below standard', 'Meets standard', 'Exceeds standard'];

/** Where an observation was made. */
export type ObservationContext = 'training' | 'game' | 'trial' | 'other';

export const CONTEXTS: { value: ObservationContext; label: string }[] = [
  { value: 'training', label: 'Training' },
  { value: 'game', label: 'Game' },
  { value: 'trial', label: 'Trial' },
  { value: 'other', label: 'Other' },
];

export const contextLabels: Record<ObservationContext, string> = {
  training: 'Training',
  game: 'Game',
  trial: 'Trial',
  other: 'Other',
};

/** A criterion an observation is about, with its step (1 to 3) when rated. */
export type ObservationRating = { item_key: string; rating: number | null };

/** One thing a panel member saw. */
export type Observation = {
  id: string;
  author_name: string;
  mine: boolean;
  /** The author's own, and still within the day after it was written. */
  can_change: boolean;
  context: ObservationContext;
  /** "2026-11-23" style. */
  observed_on: string;
  note: string | null;
  corrects_id: string | null;
  created_at: string;
  ratings: ObservationRating[];
};

/** One athlete's assessment in a round, as the panel reads it. */
export type AthleteAssessment = {
  round_id: string;
  round_name: string;
  closed: boolean;
  starts_on: string;
  /** The round's last day; observations are dated on or before it. */
  ends_on?: string;
  criteria: Criteria;
  /** The club's day. */
  today: string;
  athlete_id: string;
  athlete_name: string | null;
  observations: Observation[];
};

/** An athlete on a round's list: how much is written, never what. */
export type SheetAthlete = {
  id: string;
  name: string | null;
  is_minor: boolean;
  observations: number;
  my_observations: number;
  assessors: number;
  groups_covered: number;
  last_observed_on: string | null;
};

/** A round as its panel sees it. */
export type RoundSheet = {
  id: string;
  name: string;
  team_name: string;
  starts_on: string;
  ends_on: string;
  closed: boolean;
  criteria: Criteria;
  today: string;
  /** Athletes left off this member's list because they are their own child. */
  hidden: number;
  athletes: SheetAthlete[];
  phase?: number | null;
  round_number?: number | null;
  criteria_set_name?: string | null;
};

/** A round on a panel member's list. */
export type MyRound = {
  id: string;
  name: string;
  team_name: string;
  starts_on: string;
  ends_on: string;
  closed_at: string | null;
  athletes: number;
  my_observations: number;
  phase?: number | null;
  round_number?: number | null;
  criteria_set_name?: string | null;
};

/** Someone on a round's panel, now or before, as an admin sees them. */
export type PanelMember = {
  profile_id?: string | null;
  name: string;
  added_at: string;
  added_by_name: string | null;
  removed_at: string | null;
  removed_by_name: string | null;
  declared_conflict: boolean;
  /** Still an approved coach, admin or guest with a current check. */
  can_assess: boolean;
  /** Athletes in the round they are a parent or guardian of. */
  own_children: number;
  /** A guest with no other role in the club and no squad or team: a selector from outside it. */
  independent?: boolean;
};

/** A round as an admin sees it: its panel and counts, never an assessment. */
export type AdminRound = {
  id: string;
  team_id: string | null;
  team_name: string;
  season: number;
  name: string;
  starts_on: string;
  ends_on: string;
  closed_at: string | null;
  created_at: string;
  athletes: number;
  observations: number;
  panel: PanelMember[];
  /** The criteria set the round opened with (null on a round opened before sets). */
  criteria_set_id?: string | null;
  criteria_set_name?: string | null;
  criteria_set_version?: number | null;
  /** Open, with no observation or summary yet, so its set can still be swapped. */
  can_change_criteria?: boolean;
  phase?: number | null;
  round_number?: number | null;
  /** Auditors on the round now. */
  auditors?: number;
};

/** Someone an admin could add to a panel. */
export type PanelChoice = { profile_id: string; name: string | null; roles: string[]; cleared: boolean };

/** What one selector wrote in a round, as counts and dates. */
export type AuditSelector = {
  name: string;
  on_panel: boolean;
  observations: number;
  athletes_covered: number;
  groups_covered: number;
  first_on: string | null;
  last_on: string | null;
  weeks_active: number;
  training: number;
  game: number;
  trial: number;
  other: number;
  without_evidence: number;
  written_late: number;
  corrections: number;
};

export type AuditAthlete = {
  name: string | null;
  is_minor: boolean;
  observations: number;
  selectors: number;
  groups_covered: number;
  last_observed_on: string | null;
};

/** The audit of a round: how the work was done, never what was said. */
export type SelectionAudit = {
  round: {
    id: string;
    name: string;
    team_name: string;
    season: number;
    starts_on: string;
    ends_on: string;
    opened_at: string;
    opened_by_name: string | null;
    closed_at: string | null;
    closed_by_name: string | null;
    criteria_groups: number;
    criteria_items: number;
    athletes: number;
    observations: number;
    today: string;
  };
  panel: PanelMember[];
  selectors: AuditSelector[];
  athletes: AuditAthlete[];
  /** The round's auditors, now and before (part 3). */
  auditors?: RoundAuditor[];
};

/** Which criteria a round used and what changed about it (admin_selection_round_record). */
export type RoundRecord = {
  criteria: {
    set_name: string | null;
    version: number | null;
    saved_at: string | null;
    saved_by_name: string | null;
    for_label: string | null;
    groups: number;
    items: number;
    recommendations: number;
    set_state: 'same' | 'changed' | 'archived' | 'deleted' | 'legacy';
    set_version: number | null;
  };
  events: RoundEvent[];
};

export type RoundEvent = {
  kind: 'opened' | 'renamed' | 'dates' | 'phase' | 'criteria' | 'closed' | 'reopened';
  detail: string | null;
  by_name: string | null;
  at: string;
};

export type RegisterRound = {
  id: string;
  team_id: string | null;
  team_name: string;
  name: string;
  phase: number | null;
  round_number: number | null;
  starts_on: string;
  ends_on: string;
  last_day: string;
  closed_at: string | null;
  opened_at: string;
  opened_by_name: string | null;
  criteria_set_id: string | null;
  criteria_set_name: string | null;
  criteria_set_version: number | null;
  set_fits: boolean | null;
  panel: { name: string; independent: boolean }[];
  declared_conflicts: number;
  auditors: string[];
  athletes: number;
  observations: number;
  athletes_observed: number;
  summaries_signed: number;
  summaries_expected: number;
  feedback_shared: number;
  released: number | null;
  clashes: { round_name: string; starts_on: string; last_day: string }[];
};

/** A season's selection rounds and criteria sets, staff names, counts and dates only. */
export type SelectionRegister = {
  season: number;
  today: string;
  seasons: number[];
  groups: { id: string; name: string; kind: 'squad' | 'team'; squad_id: string | null; athletes: number }[];
  rounds: RegisterRound[];
  sets: {
    id: string;
    name: string;
    for_label: string;
    version: number;
    archived_at: string | null;
    rounds_season: number;
    rounds_ever: number;
  }[];
  set_events: {
    set_name: string;
    kind: 'created' | 'saved' | 'renamed' | 'for' | 'archived' | 'restored' | 'deleted';
    version: number | null;
    detail: string | null;
    by_name: string | null;
    at: string;
  }[];
  round_events: (RoundEvent & { round_id: string })[];
};

/** A date in a round's process, as an admin sees it, standing or taken off. */
export type Milestone = {
  id: string;
  title: string;
  /** "2026-12-01" style. */
  due_on: string;
  /** Whether athletes and their parents see it. */
  shared: boolean;
  done_at: string | null;
  done_by_name: string | null;
  removed_at: string | null;
  removed_by_name: string | null;
  created_by_name: string | null;
  created_at: string;
  /** Days past its date when it was done, or so far if it isn't; 0 on time. */
  days_late: number;
};

/** A date in a round's process, as its panel sees it. */
export type RoundDate = { id: string; title: string; due_on: string; done: boolean };

/** A selection to-do: a date that is close or overdue, or athletes with nothing written. */
export type SelectionTodo = {
  kind: 'date' | 'thin' | 'summaries';
  round_id: string;
  round_name: string;
  milestone_id: string | null;
  title: string | null;
  due_on: string;
  /** For 'thin': athletes the member can assess with nothing written yet. For 'summaries': ones whose summary they haven't signed. */
  athletes: number | null;
  /** An admin who isn't on the panel: they open the round's set-up, not its assessments. */
  for_admin: boolean;
};

/** A date athletes and their parents are shown. */
export type SharedDate = { title: string; due_on: string; done: boolean };

/** A round as an athlete in it, or their parent, sees it: criteria and dates only. */
export type SelectionInfo = {
  round_id: string;
  round_name: string;
  team_name: string;
  athlete_id: string;
  athlete_name: string | null;
  is_me: boolean;
  starts_on: string;
  ends_on: string;
  criteria: Criteria;
  dates: SharedDate[];
  phase?: number | null;
  round_number?: number | null;
  criteria_set_name?: string | null;
};

/** How many of the group's sessions an athlete was marked at during a round. */
export type RoundAttendance = { sessions: number; attended: number };

export const MAX_MILESTONES = 12;
export const MAX_MILESTONE_TITLE = 60;

/** Dates most selection processes have, offered as a start. */
export const MILESTONE_SUGGESTIONS = [
  'Criteria shared with athletes',
  'Trials',
  'Observations complete',
  'Panel meeting',
  'Teams named',
  'Feedback offered',
];

// ---------------------------------------------------------------------------
// Criteria

/** A short key from a name: "Passing & delivery" gives "passing-delivery". */
export function slug(name: string) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34);
  return s || 'item';
}

/** A key for a new group or item that nothing else in the criteria uses. */
export function newKey(name: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const base = slug(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const key = `${base}-${n}`;
    if (!used.has(key)) return key;
  }
}

/** Every key in the criteria, groups and items. */
export function criteriaKeys(criteria: Criteria) {
  return criteria.groups.flatMap((g) => [g.key, ...g.items.map((i) => i.key)]);
}

/** Builds criteria from names, giving each group and item its own key. */
export function makeCriteria(groups: { name: string; scale?: string[]; items: string[] }[]): Criteria {
  const taken: string[] = [];
  const key = (name: string) => {
    const k = newKey(name, taken);
    taken.push(k);
    return k;
  };
  return {
    groups: groups.map((g) => ({
      key: key(g.name),
      name: g.name,
      scale: [...(g.scale ?? DEFAULT_SCALE)],
      items: g.items.map((name) => ({ key: key(name), name })),
    })),
  };
}

const DEVELOPING = ['Developing', 'Meets standard', 'Exceeds standard'];

/**
 * A starting point a club can edit: the shape of a netball selection
 * assessment sheet. An example only; every name and scale can be changed.
 */
export function starterCriteria(): Criteria {
  return { ...starterGroups(), recommendations: [...STARTER_RECOMMENDATIONS] };
}

function starterGroups(): Criteria {
  return makeCriteria([
    {
      name: 'Technical ability',
      items: ['Passing and delivery', 'Catching and ball security', 'Position-specific skills', 'Ball handling'],
    },
    {
      name: 'Tactical understanding',
      items: ['Court awareness', 'Decision making', 'Structure execution', 'Adaptability'],
    },
    { name: 'Match performance', items: ['Influence on the game', 'Consistency', 'Performance under pressure'] },
    { name: 'Athletic capacity', items: ['Speed', 'Agility', 'Endurance', 'Strength and physical readiness'] },
    {
      name: 'Positional suitability',
      scale: ['Developing', 'Suitable', 'Highly suitable'],
      items: ['Primary position', 'Secondary position', 'Tactical fit', 'Versatility'],
    },
    { name: 'Coachability', scale: DEVELOPING, items: ['Accepts feedback', 'Applies feedback', 'Learning mindset'] },
    {
      name: 'Commitment',
      scale: DEVELOPING,
      items: ['Attendance', 'Punctuality', 'Preparation', 'Communication'],
    },
    {
      name: 'Resilience',
      scale: DEVELOPING,
      items: ['Responds to setbacks', 'Accountability', 'Emotional maturity'],
    },
    {
      name: 'Team focus',
      scale: DEVELOPING,
      items: ['Supports teammates', 'Positive communication', 'Respect for coaches and officials', 'Team-first behaviour'],
    },
  ]);
}

/** What stops these criteria being saved, or null. The database checks the same. */
export function criteriaProblem(criteria: Criteria): string | null {
  if (criteria.groups.length === 0) return 'Add at least one group of criteria.';
  if (criteria.groups.length > MAX_GROUPS) return `Keep the criteria to ${MAX_GROUPS} groups.`;
  for (const group of criteria.groups) {
    const name = group.name.trim();
    if (!name) return 'Name each group.';
    if (name.length > MAX_NAME) return `Keep “${name.slice(0, 20)}…” to ${MAX_NAME} characters.`;
    if (group.scale.length !== 3 || group.scale.some((s) => !s.trim())) {
      return `Name all three steps on the scale for “${name}”.`;
    }
    if (group.scale.some((s) => s.trim().length > MAX_STEP)) {
      return `Keep each step on the scale for “${name}” to ${MAX_STEP} characters.`;
    }
    if (group.items.length === 0) return `Add at least one item to “${name}”.`;
    if (group.items.length > MAX_ITEMS) return `Keep “${name}” to ${MAX_ITEMS} items.`;
    for (const item of group.items) {
      if (!item.name.trim()) return `Name each item in “${name}”.`;
      if (item.name.trim().length > MAX_NAME) return `Keep each item in “${name}” to ${MAX_NAME} characters.`;
    }
  }
  const keys = criteriaKeys(criteria);
  if (new Set(keys).size !== keys.length) return 'Two criteria share a key. Remove one and add it again.';
  return recommendationsProblem(criteria.recommendations ?? []);
}

/** What stops this list of recommendations being saved, or null: none, or two to eight different ones. */
export function recommendationsProblem(recommendations: string[]): string | null {
  if (recommendations.length === 0) return null;
  const names = recommendations.map((r) => r.trim());
  if (names.some((r) => !r)) return 'Name each recommendation, or remove the empty one.';
  if (names.length < 2) return 'Give selectors at least two recommendations to choose from, or none.';
  if (names.length > MAX_RECOMMENDATIONS) return `Keep the recommendations to ${MAX_RECOMMENDATIONS}.`;
  if (names.some((r) => r.length > MAX_RECOMMENDATION)) {
    return `Keep each recommendation to ${MAX_RECOMMENDATION} characters.`;
  }
  if (new Set(names.map((r) => r.toLowerCase())).size !== names.length) return 'Two recommendations are the same.';
  return null;
}

/** How many items the criteria hold, as "9 groups, 33 items". */
export function criteriaSummary(criteria: Criteria) {
  const groups = criteria.groups.length;
  const items = criteria.groups.reduce((n, g) => n + g.items.length, 0);
  if (groups === 0) return 'Not set up yet';
  return `${groups} ${groups === 1 ? 'group' : 'groups'}, ${items} ${items === 1 ? 'item' : 'items'}`;
}

// ---------------------------------------------------------------------------
// Criteria sets

/** One set in the admins' list (`admin_criteria_sets`). */
export type CriteriaSetSummary = {
  id: string;
  name: string;
  version: number;
  for_all: boolean;
  for_label: string;
  groups: number;
  items: number;
  rounds: number;
  archived_at: string | null;
  archived_by_name: string | null;
  updated_at: string;
  updated_by_name: string | null;
};

/** A line of a set's history. */
export type CriteriaSetEvent = {
  kind: 'created' | 'saved' | 'renamed' | 'for' | 'archived' | 'restored' | 'deleted';
  version: number | null;
  detail: string | null;
  by_name: string | null;
  at: string;
};

/** One set in full (`admin_criteria_set`). */
export type CriteriaSet = {
  id: string;
  name: string;
  version: number;
  criteria: Criteria;
  for_all: boolean;
  for: { team_id: string | null; team_name: string }[];
  for_label: string;
  rounds: {
    id: string;
    name: string;
    team_name: string;
    starts_on: string;
    ends_on: string;
    criteria_set_version: number | null;
  }[];
  archived_at: string | null;
  events: CriteriaSetEvent[];
};

/** A set an admin can choose for a round (`admin_selection_round_set_choices`). */
export type SetChoice = {
  set_id: string;
  name: string;
  version: number;
  groups: number;
  items: number;
  for_label: string;
  is_default: boolean;
};

export const MAX_SET_NAME = 60;

/** "9 groups, 33 items · version 2". */
export function setLine(set: { groups: number; items: number; version: number }) {
  return `${plural(set.groups, 'group', 'groups')}, ${plural(set.items, 'item', 'items')} · version ${set.version}`;
}

/** "Used by 2 rounds", or "Not used yet". */
export function setUseLine(rounds: number) {
  return rounds > 0 ? `Used by ${plural(rounds, 'round', 'rounds')}` : 'Not used yet';
}

/** The set a round opened with: "Junior criteria, version 3", or the name alone on an older round. */
export function roundCriteriaLine(round: Pick<AdminRound, 'criteria_set_name' | 'criteria_set_version'>) {
  if (!round.criteria_set_name) return '';
  return round.criteria_set_version
    ? `${round.criteria_set_name}, version ${round.criteria_set_version}`
    : round.criteria_set_name;
}

/** A line of a set's History tab. */
export function setEventLine(event: CriteriaSetEvent) {
  const when = formatDateString(event.at.slice(0, 10));
  const who = event.by_name ? ` · ${event.by_name}` : '';
  const what = (() => {
    switch (event.kind) {
      case 'created':
        return 'Created';
      case 'saved':
        return `Version ${event.version ?? ''} saved`;
      case 'renamed':
        return event.detail ? `Renamed ${event.detail.replace(/^From /, 'from ')}` : 'Renamed';
      case 'for':
        return `Now for ${event.detail ?? ''}`;
      case 'archived':
        return 'Archived';
      case 'restored':
        return 'Brought back';
      case 'deleted':
        return 'Deleted';
    }
  })();
  return `${what} · ${when}${who}`;
}

/** The Save button's title: a new set, a criteria change (a new version), or only the name or who it's for. */
export function saveSetTitle(saved: boolean, criteriaChanged: boolean, version: number) {
  if (saved && criteriaChanged) return `Save as version ${version + 1}`;
  return 'Save';
}

/** The set to choose for an admin: the default, else the only one, else none. */
export function pickSet(choices: SetChoice[]): SetChoice | null {
  return choices.find((c) => c.is_default) ?? (choices.length === 1 ? choices[0] : null);
}

/** The first thing wrong with a set before it is saved, or null. */
export function setProblem(name: string, criteria: Criteria, forAll: boolean, teamIds: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_SET_NAME) return `Name the set, in up to ${MAX_SET_NAME} characters.`;
  if (!forAll && teamIds.length === 0) return 'Choose the squads or teams this set is for.';
  return criteriaProblem(criteria);
}

// ---------------------------------------------------------------------------
// The picture of an athlete

export type PictureItem = {
  key: string;
  name: string;
  /** Observations about this item, rated or not. */
  count: number;
  /** How many different people wrote them. */
  selectors: number;
  /** How many times each step was given, lowest step first. */
  tally: [number, number, number];
  /** Ratings in date order, oldest first, as steps 1 to 3. */
  trail: number[];
};

export type PictureGroup = {
  key: string;
  name: string;
  scale: string[];
  /** Observations about anything in the group. */
  count: number;
  items: PictureItem[];
};

export type Picture = {
  groups: PictureGroup[];
  /** Groups nobody has written anything about. */
  missing: string[];
  observations: number;
  selectors: number;
};

/**
 * What has been seen of an athlete against each criterion: counts, how many
 * selectors, and each item's ratings in date order. There is deliberately no
 * total, average or score.
 */
export function buildPicture(criteria: Criteria, observations: Observation[]): Picture {
  const oldestFirst = [...observations].sort(
    (a, b) => a.observed_on.localeCompare(b.observed_on) || a.created_at.localeCompare(b.created_at),
  );
  const groups = criteria.groups.map((group) => {
    const items = group.items.map((item) => {
      const about = oldestFirst.filter((o) => o.ratings.some((r) => r.item_key === item.key));
      const tally: [number, number, number] = [0, 0, 0];
      const trail: number[] = [];
      for (const o of about) {
        const rating = o.ratings.find((r) => r.item_key === item.key)?.rating;
        if (rating === 1 || rating === 2 || rating === 3) {
          tally[rating - 1] += 1;
          trail.push(rating);
        }
      }
      return {
        key: item.key,
        name: item.name,
        count: about.length,
        selectors: new Set(about.map((o) => o.author_name)).size,
        tally,
        trail,
      };
    });
    const keys = new Set(group.items.map((i) => i.key));
    const count = observations.filter((o) => o.ratings.some((r) => keys.has(r.item_key))).length;
    return { key: group.key, name: group.name, scale: group.scale, count, items };
  });
  return {
    groups,
    missing: groups.filter((g) => g.count === 0).map((g) => g.name),
    observations: observations.length,
    selectors: new Set(observations.map((o) => o.author_name)).size,
  };
}

/** An item's ratings in words, such as "Meets standard ×2, Exceeds standard ×1". */
export function tallyLabel(scale: string[], tally: [number, number, number]) {
  const parts = tally
    .map((n, i) => (n > 0 ? `${scale[i] ?? `Step ${i + 1}`} ×${n}` : null))
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : 'Not rated';
}

/** The names of the criteria an observation is about, with each rating. */
export function ratingLines(criteria: Criteria, ratings: ObservationRating[]) {
  const lines: string[] = [];
  for (const group of criteria.groups) {
    for (const item of group.items) {
      const rating = ratings.find((r) => r.item_key === item.key);
      if (!rating) continue;
      const step = rating.rating ? group.scale[rating.rating - 1] : null;
      lines.push(step ? `${item.name}: ${step}` : item.name);
    }
  }
  return lines;
}

/** Whole days from one "2026-11-23" style date to another. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** Athletes nobody has written about for this many days are pointed out. */
export const STALE_DAYS = 14;

/**
 * What a round's list says under an athlete: how much is written, and a
 * nudge when there is nothing yet or nothing lately.
 */
export function athleteLine(athlete: SheetAthlete, groups: number, today: string, closed = false) {
  if (athlete.observations === 0) return { text: 'Nothing written yet', nudge: !closed };
  const count = `${athlete.observations} ${athlete.observations === 1 ? 'observation' : 'observations'}`;
  const by = `${athlete.assessors} ${athlete.assessors === 1 ? 'selector' : 'selectors'}`;
  const covered = `${athlete.groups_covered} of ${groups} groups`;
  const text = `${count} from ${by} · ${covered}`;
  const days = athlete.last_observed_on ? daysBetween(athlete.last_observed_on, today) : 0;
  if (!closed && days >= STALE_DAYS) {
    return { text: `${text} · nothing for ${days} days`, nudge: true };
  }
  return { text, nudge: false };
}

/** A round's dates, such as "16 Nov 2026 to 20 Dec 2026". */
export function roundDates(round: { starts_on: string; ends_on: string }) {
  return `${formatDateString(round.starts_on)} to ${formatDateString(round.ends_on)}`;
}

// ---------------------------------------------------------------------------
// Writing an observation

export type ObservationDraft = {
  context: ObservationContext | null;
  observedOn: string | null;
  note: string;
  ratings: ObservationRating[];
};

/** What stops an observation being saved, or null. The database checks the same. */
export function observationProblem(draft: ObservationDraft, today: string, startsOn: string): string | null {
  if (!draft.context) return 'Choose where you saw it.';
  if (!draft.observedOn) return 'Choose the day you saw it.';
  if (draft.observedOn > today) return 'The day can’t be in the future.';
  if (draft.observedOn < startsOn) return `The round started on ${formatDateString(startsOn)}.`;
  if (draft.ratings.length === 0) return 'Choose at least one of the criteria.';
  if (!draft.note.trim() && !draft.ratings.some((r) => r.rating !== null)) {
    return 'Write what you saw, or rate at least one of the criteria.';
  }
  if (draft.note.trim().length > MAX_EVIDENCE) return 'Keep the evidence to 1,000 characters.';
  return null;
}

/**
 * Taps on an item's scale: the first tap tags the item with that step, the
 * same step again leaves it tagged without a rating, and "Not about this"
 * (step undefined) takes it off.
 */
export function setRating(ratings: ObservationRating[], itemKey: string, step: number | null | undefined) {
  const rest = ratings.filter((r) => r.item_key !== itemKey);
  if (step === undefined) return rest;
  return [...rest, { item_key: itemKey, rating: step }];
}

// ---------------------------------------------------------------------------
// The audit report

const day = (value: string | null) => (value ? formatDateString(value.slice(0, 10)) : '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The Selection audit report for a round, on screen and as a PDF. It shows
 * who did what and when, with counts, and never a rating, a line of evidence
 * or the name of a criterion.
 */
export function selectionAuditReport(
  audit: SelectionAudit,
  dates: Milestone[] = [],
  summaries: AdminSummaries | null = null,
  feedback: AdminFeedback | null = null,
  record: RoundRecord | null = null,
  releases: AdminReleases | null = null,
): Report {
  const { round } = audit;
  const groups = round.criteria_groups;
  const onPanel = audit.panel.filter((m) => !m.removed_at);
  const quiet = audit.selectors.filter((s) => s.on_panel && s.observations === 0);
  const thin = audit.athletes.filter((a) => a.observations === 0);

  return {
    title: 'Selection audit report',
    subtitle: `${round.name} · ${round.team_name} · ${roundDates(round)}`,
    landscape: true,
    stats: [
      { label: 'Athletes', value: round.athletes },
      { label: 'On the panel', value: onPanel.length },
      { label: 'Observations', value: round.observations },
      { label: 'Athletes with nothing written', value: thin.length },
      ...(record ? [{ label: 'Auditors', value: (audit.auditors ?? []).filter((a) => !a.removed_at).length }] : []),
    ],
    sections: [
      {
        title: 'The round',
        columns: [{ label: 'Step', width: 2 }, { label: 'When' }, { label: 'By', width: 2 }],
        rows: [
          { cells: ['Round opened, with its own copy of the criteria', day(round.opened_at), round.opened_by_name ?? ''] },
          {
            cells: [
              'Criteria the round uses',
              '',
              `${plural(groups, 'group', 'groups')}, ${plural(round.criteria_items, 'item', 'items')}`,
            ],
          },
          { cells: ['Selection phase starts', day(round.starts_on), ''] },
          { cells: ['Selection phase ends', day(round.ends_on), ''] },
          round.closed_at
            ? { cells: ['Round closed', day(round.closed_at), round.closed_by_name ?? ''] }
            : { cells: ['Round closed', 'Still open', ''], flag: round.ends_on < round.today },
        ],
      },
      ...(record ? [criteriaRecordSection(record), roundChangesSection(record)] : []),
      {
        title: 'Dates',
        note: 'The dates set for this round, with when each was marked done and by whom. “Late” is days past the date: when it was marked done, or so far.',
        columns: [
          { label: 'Date', width: 3 },
          { label: 'Due', width: 1.5 },
          { label: 'Done', width: 3 },
          { label: 'Late' },
          { label: 'Athletes and parents see it', width: 2 },
        ],
        rows: dates.map((m) => ({
          cells: [
            m.removed_at
              ? `${m.title} (taken off ${day(m.removed_at)}${m.removed_by_name ? ` by ${m.removed_by_name}` : ''})`
              : m.title,
            day(m.due_on),
            m.done_at ? `${day(m.done_at)}${m.done_by_name ? ` by ${m.done_by_name}` : ''}` : m.removed_at ? '' : 'Not yet',
            m.days_late > 0 && !(m.removed_at && !m.done_at) ? plural(m.days_late, 'day', 'days') : '',
            m.shared ? 'Yes' : 'No',
          ],
          flag: !m.removed_at && m.days_late > 0,
        })),
        empty: 'No dates were set for this round.',
      },
      {
        title: 'The panel',
        note: 'Everyone who has been on the panel, with who added and removed them. Only panel members read assessments.',
        columns: [
          { label: 'Selector', width: 2 },
          { label: 'Added', width: 2 },
          { label: 'Removed', width: 2 },
          { label: 'Notes', width: 3 },
        ],
        rows: audit.panel.map((m) => {
          const notes = panelNotes(m);
          return {
            cells: [
              m.name,
              `${day(m.added_at)}${m.added_by_name ? ` by ${m.added_by_name}` : ''}`,
              m.removed_at ? `${day(m.removed_at)}${m.removed_by_name ? ` by ${m.removed_by_name}` : ''}` : '',
              notes.join('\n'),
            ],
            flag: !m.removed_at && (m.declared_conflict || !m.can_assess),
          };
        }),
        empty: 'Nobody is on the panel.',
      },
      ...(record ? [auditorsSection(audit)] : []),
      {
        title: 'What each selector wrote',
        note: `Athletes are out of the ${round.athletes} in the round; groups are out of the ${groups} groups of criteria. “Late” is written more than 7 days after it was seen.`,
        columns: [
          { label: 'Selector', width: 2.4 },
          { label: 'Obs.' },
          { label: 'Athletes' },
          { label: 'Groups' },
          { label: 'First', width: 1.5 },
          { label: 'Last', width: 1.5 },
          { label: 'Weeks' },
          { label: 'Training / game / trial / other', width: 2.2 },
          { label: 'No evidence' },
          { label: 'Late' },
          { label: 'Corrections' },
        ],
        rows: audit.selectors.map((s) => ({
          cells: [
            s.on_panel ? s.name : `${s.name} (not on the panel now)`,
            String(s.observations),
            String(s.athletes_covered),
            String(s.groups_covered),
            day(s.first_on),
            day(s.last_on),
            String(s.weeks_active),
            `${s.training} / ${s.game} / ${s.trial} / ${s.other}`,
            String(s.without_evidence),
            String(s.written_late),
            String(s.corrections),
          ],
          flag: s.on_panel && s.observations === 0,
        })),
        empty: 'Nobody has written anything yet.',
      },
      {
        title: 'Evidence about each athlete',
        note: 'How much has been written about each athlete, so thin records stand out. Counts only.',
        columns: [
          { label: 'Athlete', width: 2.4 },
          { label: 'Observations' },
          { label: 'Selectors' },
          { label: 'Groups covered' },
          { label: 'Last seen', width: 1.5 },
        ],
        rows: audit.athletes.map((a) => ({
          cells: [
            `${a.name ?? 'Athlete'}${a.is_minor ? ' (under 18)' : ''}`,
            String(a.observations),
            String(a.selectors),
            `${a.groups_covered} of ${groups}`,
            day(a.last_observed_on),
          ],
          flag: a.observations === 0,
        })),
        empty: 'There are no athletes in the round.',
      },
      ...(summaries ? summariesAuditSections(summaries) : []),
      ...(feedback ? [feedbackAuditSection(feedback)] : []),
      ...(releases ? [releasesAuditSection(releases)] : []),
    ],
    footnote: [
      'This report shows how the selection work was done, not what was said: it holds no ratings, evidence, recommendations or names of criteria, and nothing in it ranks athletes.',
      quiet.length > 0
        ? `${plural(quiet.length, 'panel member has', 'panel members have')} written nothing yet.`
        : null,
      'Building this report is recorded in the record views of each athlete under 18 in the round.',
    ]
      .filter((n): n is string => n !== null)
      .join(' '),
  };
}

/** A round's change, in words. */
export function roundEventLabel(kind: RoundEvent['kind']) {
  return {
    opened: 'Opened',
    renamed: 'Renamed',
    dates: 'Dates changed',
    phase: 'Phase or round changed',
    criteria: 'Criteria changed',
    closed: 'Closed',
    reopened: 'Opened again',
  }[kind];
}

/** A criteria set's change, in words. */
export function setEventLabel(event: SelectionRegister['set_events'][number]) {
  switch (event.kind) {
    case 'created':
      return 'Created';
    case 'saved':
      return `Version ${event.version ?? ''} saved`.replace('  ', ' ');
    case 'renamed':
    case 'for':
      return event.detail ?? (event.kind === 'renamed' ? 'Renamed' : 'Who it’s for changed');
    case 'archived':
      return 'Archived';
    case 'restored':
      return 'Brought back';
    case 'deleted':
      return 'Deleted';
  }
}

/** Where a round's criteria set stands now, in a sentence. */
export function setStateLine(record: RoundRecord) {
  const c = record.criteria;
  switch (c.set_state) {
    case 'changed':
      return `The set is now at version ${c.set_version}. This round keeps version ${c.version}.`;
    case 'archived':
      return 'The set has been archived. This round keeps its copy.';
    case 'deleted':
      return 'The set has been deleted. This round keeps its copy.';
    default:
      return 'The set hasn’t changed.';
  }
}

/** The audit report's Criteria section: which set and version the round used. */
export function criteriaRecordSection(record: RoundRecord): ReportSection {
  const c = record.criteria;
  const name =
    c.set_state === 'legacy' || c.version === null
      ? `${c.set_name ?? 'Club criteria'} (opened before criteria sets were added)`
      : `${c.set_name}, version ${c.version}`;
  return {
    title: 'Criteria',
    note: 'A round takes its own copy of the criteria when it opens, so a later change to the set never changes what these athletes were assessed against.',
    columns: [{ label: 'About', width: 2 }, { label: '', width: 4 }],
    rows: [
      { cells: ['Criteria set', name] },
      ...(c.saved_at ? [{ cells: ['That version was saved', `${day(c.saved_at)}${c.saved_by_name ? ` by ${c.saved_by_name}` : ''}`] }] : []),
      ...(c.for_label ? [{ cells: ['The set is for', c.for_label] }] : []),
      {
        cells: [
          'In this round',
          `${plural(c.groups, 'group', 'groups')}, ${plural(c.items, 'item', 'items')}, ${plural(c.recommendations, 'recommendation', 'recommendations')}`,
        ],
      },
      ...(c.set_state === 'legacy' ? [] : [{ cells: ['Since the round opened', setStateLine(record)] }]),
    ],
  };
}

/** The audit report's Changes to the round section, oldest first. */
export function roundChangesSection(record: RoundRecord): ReportSection {
  return {
    title: 'Changes to the round',
    columns: [{ label: 'When', width: 1.5 }, { label: 'What', width: 2 }, { label: 'Detail', width: 4 }, { label: 'By', width: 2 }],
    rows: record.events.map((e) => ({ cells: [day(e.at), roundEventLabel(e.kind), e.detail ?? '', e.by_name ?? ''] })),
    empty: 'This round was opened before changes were kept.',
  };
}

/** The audit report's Auditors section. */
export function auditorsSection(audit: SelectionAudit): ReportSection {
  const auditors = audit.auditors ?? [];
  return {
    title: 'Auditors',
    note: auditors.length === 0 ? 'No committee member was assigned to audit this round.' : undefined,
    columns: [
      { label: 'Auditor', width: 2 },
      { label: 'Added', width: 1.5 },
      { label: 'By', width: 1.5 },
      { label: 'Taken off', width: 1.5 },
      { label: 'By', width: 1.5 },
      { label: 'Note', width: 3 },
    ],
    rows: auditors.map((a) => ({
      cells: [
        a.name,
        day(a.added_at),
        a.added_by_name ?? '',
        day(a.removed_at),
        a.removed_by_name ?? '',
        [
          a.own_children > 0 ? `Can’t check ${plural(a.own_children, 'athlete', 'athletes')}: their own child` : null,
          a.is_admin ? 'Also an admin' : null,
          !a.removed_at && !a.can_audit ? 'No current check' : null,
        ]
          .filter((n): n is string => n !== null)
          .join('; '),
      ],
      flag: !a.removed_at && !a.can_audit,
    })),
    empty: 'Nobody audited this round.',
  };
}

const registerTitle = (r: RegisterRound) => `${roundTitle(r)} (${r.team_name})`;

/** Where a round stands in the register. */
export function registerStatus(r: RegisterRound, today: string) {
  if (r.closed_at) return `Closed ${day(r.closed_at)}`;
  if (r.starts_on > today) return 'Coming up';
  if (r.ends_on < today) return 'Ended, not closed';
  return 'Running';
}

/** The register's Things to check: one sentence each, in a set order. */
export function registerChecks(register: SelectionRegister): string[] {
  const { rounds, groups, today } = register;
  const withRound = new Set(rounds.map((r) => r.team_id).filter(Boolean));
  const running = rounds.filter((r) => !r.closed_at && r.starts_on <= today && r.ends_on >= today);
  const finished = rounds.filter((r) => r.closed_at || r.ends_on < today);
  const checks: string[] = [];
  for (const g of groups) {
    if (withRound.has(g.id) || (g.squad_id && withRound.has(g.squad_id))) continue;
    checks.push(`${g.name} has no round this season.`);
  }
  for (const r of running) if (r.auditors.length === 0) checks.push(`${registerTitle(r)} is running with no auditor.`);
  for (const r of running) if (r.panel.length === 1) checks.push(`${registerTitle(r)} is running with one selector on its panel.`);
  for (const r of rounds) {
    if (!r.closed_at && r.ends_on < today) checks.push(`${registerTitle(r)} ended on ${shortDate(r.ends_on)} and isn’t closed.`);
  }
  for (const r of finished) {
    const none = r.athletes - r.athletes_observed;
    if (none > 0) checks.push(`${registerTitle(r)} finished with ${none} of ${r.athletes} athletes with nothing written.`);
  }
  for (const r of finished) {
    const unsigned = r.summaries_expected - r.summaries_signed;
    if (unsigned > 0) checks.push(`${registerTitle(r)} finished with ${unsigned} of ${r.summaries_expected} summaries not signed.`);
  }
  const seen = new Set<string>();
  for (const r of rounds) {
    for (const c of r.clashes) {
      const other = rounds.find((x) => x.team_id === r.team_id && x.id !== r.id && x.starts_on === c.starts_on) ?? null;
      const key = [r.id, other?.id ?? c.round_name].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const from = r.starts_on > c.starts_on ? r.starts_on : c.starts_on;
      const to = r.last_day < c.last_day ? r.last_day : c.last_day;
      checks.push(
        `${roundTitle(r)} and ${other ? roundTitle(other) : c.round_name} overlap for ${r.team_name} from ${shortDate(from)} to ${shortDate(to)}.`,
      );
    }
  }
  for (const r of rounds) {
    if (r.set_fits === false) {
      checks.push(`${registerTitle(r)} was assessed against ${r.criteria_set_name}, which is not for ${r.team_name} now.`);
    }
  }
  return checks;
}

/** The Selection register for a season: on screen and as a PDF. */
export function selectionRegisterReport(register: SelectionRegister, seasonName: string): Report {
  const { rounds, today } = register;
  const titleOf = new Map(rounds.map((r) => [r.id, roundTitle(r)]));
  const checks = registerChecks(register);
  const withRound = new Set(rounds.map((r) => r.team_id).filter(Boolean));
  const noRound = register.groups.filter((g) => !withRound.has(g.id) && !(g.squad_id && withRound.has(g.squad_id)));
  const setsUsed = new Set(rounds.map((r) => r.criteria_set_id ?? r.criteria_set_name));
  const criteria = (r: RegisterRound) =>
    r.criteria_set_version === null ? (r.criteria_set_name ?? '') : `${r.criteria_set_name}, version ${r.criteria_set_version}`;
  return {
    title: 'Selection register',
    subtitle: `Season ${seasonName} · as at ${day(today)}`,
    landscape: true,
    stats: [
      { label: 'Rounds', value: rounds.length },
      { label: 'Running now', value: rounds.filter((r) => registerStatus(r, today) === 'Running').length },
      { label: 'Squads and teams with no round', value: noRound.length },
      { label: 'Criteria sets used', value: setsUsed.size },
    ],
    sections: [
      {
        title: 'Things to check',
        columns: [{ label: 'Check' }],
        rows: checks.map((c) => ({ cells: [c], flag: true })),
        empty: 'Nothing needs checking.',
      },
      {
        title: 'Rounds',
        columns: [
          { label: 'Squad or team', width: 2 },
          { label: 'Round', width: 2.5 },
          { label: 'Dates', width: 2 },
          { label: 'Status', width: 1.5 },
          { label: 'Criteria', width: 2 },
          { label: 'Opened by', width: 1.5 },
        ],
        rows: rounds.map((r) => ({
          cells: [r.team_name, roundTitle(r), shortRange(r), registerStatus(r, today), criteria(r), r.opened_by_name ?? ''],
          flag: registerStatus(r, today) === 'Ended, not closed',
        })),
        empty: 'No rounds this season.',
      },
      {
        title: 'The work in each round',
        columns: [
          { label: 'Round', width: 2.5 },
          { label: 'Panel' },
          { label: 'Independent' },
          { label: 'Conflicts declared' },
          { label: 'Auditors' },
          { label: 'Athletes' },
          { label: 'Observations' },
          { label: 'Athletes with nothing written' },
          { label: 'Summaries signed' },
          { label: 'Feedback shared' },
          { label: 'Released' },
        ],
        rows: rounds.map((r) => ({
          cells: [
            registerTitle(r),
            String(r.panel.length),
            String(r.panel.filter((p) => p.independent).length),
            String(r.declared_conflicts),
            String(r.auditors.length),
            String(r.athletes),
            String(r.observations),
            String(r.athletes - r.athletes_observed),
            `${r.summaries_signed} of ${r.summaries_expected}`,
            String(r.feedback_shared),
            r.released === null ? '–' : `${r.released} of ${r.athletes}`,
          ],
        })),
        empty: 'No rounds this season.',
      },
      {
        title: 'Panels and auditors',
        columns: [{ label: 'Round', width: 2.5 }, { label: 'Selectors', width: 4 }, { label: 'Auditors', width: 2.5 }],
        rows: rounds.map((r) => ({
          cells: [
            registerTitle(r),
            r.panel.map((p) => `${p.name}${p.independent ? ' (independent)' : ''}`).join(', '),
            r.auditors.join(', '),
          ],
        })),
        empty: 'No rounds this season.',
      },
      {
        title: 'Criteria sets',
        columns: [
          { label: 'Set', width: 2 },
          { label: 'For', width: 3 },
          { label: 'Version' },
          { label: 'Rounds this season' },
          { label: 'Rounds ever' },
          { label: 'State', width: 1.5 },
        ],
        rows: register.sets.map((s) => ({
          cells: [
            s.name,
            s.for_label,
            String(s.version),
            String(s.rounds_season),
            String(s.rounds_ever),
            s.archived_at ? `Archived ${day(s.archived_at)}` : 'In use',
          ],
        })),
        empty: 'No criteria sets.',
      },
      {
        title: 'Changes to criteria sets',
        columns: [{ label: 'When', width: 1.5 }, { label: 'Set', width: 2 }, { label: 'What', width: 3 }, { label: 'By', width: 1.5 }],
        rows: register.set_events.map((e) => ({ cells: [day(e.at), e.set_name, setEventLabel(e), e.by_name ?? ''] })),
        empty: 'No changes.',
      },
      {
        title: 'Changes to rounds',
        columns: [
          { label: 'When', width: 1.5 },
          { label: 'Round', width: 2.5 },
          { label: 'What', width: 2 },
          { label: 'Detail', width: 3 },
          { label: 'By', width: 1.5 },
        ],
        rows: register.round_events.map((e) => ({
          cells: [day(e.at), titleOf.get(e.round_id) ?? '', roundEventLabel(e.kind), e.detail ?? '', e.by_name ?? ''],
        })),
        empty: 'No changes to rounds this season.',
      },
    ],
    footnote:
      'Counts, dates and the names of selectors and auditors only. No athlete is named and nothing a selector wrote is shown. Rounds older than the club keeps assessments are removed with their records, so save this register at the end of each season.',
  };
}

// ---------------------------------------------------------------------------
// Who uses it

/** Whether selection assessments are on for this member. */
export function useAssessmentsOn() {
  return useFeature('selectionAssessments');
}

/**
 * Whether the member could be on a panel: an approved coach or admin, or a
 * guest who holds a current check (how a club adds an independent selector).
 * A member whose roles are all paused shows as a guest and has no check that
 * counts, so they are left out. The database decides who is on which panel.
 */
export function useCanBeSelector() {
  const { profile, memberships, exemption, wwccApplication } = useAuth();
  if (profile?.status !== 'approved') return false;
  if (hasRole(profile, 'coach', 'admin') || memberships.some((m) => m.team_role === 'coach')) return true;
  return hasRole(profile, 'guest') && canWorkWithChildren(profile, !!exemption?.valid || !!wwccApplication?.valid);
}

/** The rounds whose panel the member is on, for Home. */
export function useMySelectionRounds() {
  const on = useAssessmentsOn();
  const eligible = useCanBeSelector() && on;
  const [rounds, setRounds] = useState<MyRound[]>([]);
  const load = useCallback(async () => {
    if (!eligible) return;
    const { data } = await supabase.rpc('my_selection_rounds');
    setRounds((data as MyRound[] | null) ?? []);
  }, [eligible]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { selectionRounds: eligible ? rounds : [], reloadSelectionRounds: load };
}

/** What Home says under Selection assessments: only rounds running today count as open. */
export function roundsLabel(rounds: MyRound[], today: string = clubToday()) {
  const { now, coming } = groupRounds(rounds, today);
  if (now.length === 1) return `${roundTitle(now[0])} · ${plural(now[0].athletes, 'athlete', 'athletes')}`;
  if (now.length > 1) return `${now.length} selection rounds open`;
  if (coming.length > 0) return `Starts ${shortDate(coming[0].starts_on)}: ${roundTitle(coming[0])}`;
  return 'Past selection rounds';
}

// ---------------------------------------------------------------------------
// Editing criteria (each returns new criteria; nothing is changed in place)

const mapGroup = (criteria: Criteria, groupKey: string, change: (group: CriteriaGroup) => CriteriaGroup) => ({
  ...criteria,
  groups: criteria.groups.map((g) => (g.key === groupKey ? change(g) : g)),
});

/** Adds an empty group with one empty item and the usual scale. */
export function addGroup(criteria: Criteria): Criteria {
  const keys = criteriaKeys(criteria);
  const groupKey = newKey('group', keys);
  const itemKey = newKey('item', [...keys, groupKey]);
  return {
    ...criteria,
    groups: [
      ...criteria.groups,
      { key: groupKey, name: '', scale: [...DEFAULT_SCALE], items: [{ key: itemKey, name: '' }] },
    ],
  };
}

export function removeGroup(criteria: Criteria, groupKey: string): Criteria {
  return { ...criteria, groups: criteria.groups.filter((g) => g.key !== groupKey) };
}

export function renameGroup(criteria: Criteria, groupKey: string, name: string): Criteria {
  return mapGroup(criteria, groupKey, (g) => ({ ...g, name }));
}

/** Names one of a group's three steps (index 0 is the lowest). */
export function renameStep(criteria: Criteria, groupKey: string, index: number, label: string): Criteria {
  return mapGroup(criteria, groupKey, (g) => ({
    ...g,
    scale: g.scale.map((s, i) => (i === index ? label : s)),
  }));
}

export function addItem(criteria: Criteria, groupKey: string): Criteria {
  const key = newKey('item', criteriaKeys(criteria));
  return mapGroup(criteria, groupKey, (g) => ({ ...g, items: [...g.items, { key, name: '' }] }));
}

export function removeItem(criteria: Criteria, groupKey: string, itemKey: string): Criteria {
  return mapGroup(criteria, groupKey, (g) => ({ ...g, items: g.items.filter((i) => i.key !== itemKey) }));
}

export function renameItem(criteria: Criteria, groupKey: string, itemKey: string, name: string): Criteria {
  return mapGroup(criteria, groupKey, (g) => ({
    ...g,
    items: g.items.map((i) => (i.key === itemKey ? { ...i, name } : i)),
  }));
}

/** Names one recommendation, adds one (index past the end) or, with null, removes it. */
export function setRecommendation(criteria: Criteria, index: number, name: string | null): Criteria {
  const list = [...(criteria.recommendations ?? [])];
  if (name === null) list.splice(index, 1);
  else list[index] = name;
  return { ...criteria, recommendations: list };
}

/** What an admin's list says under a round. */
export function adminRoundLine(round: AdminRound) {
  const panel = round.panel.filter((m) => !m.removed_at).length;
  return [
    `${plural(panel, 'selector', 'selectors')} on the panel`,
    plural(round.athletes, 'athlete', 'athletes'),
    plural(round.observations, 'observation', 'observations'),
  ].join(' · ');
}

/** What an admin is told beside a panel member, or nothing. */
export const INDEPENDENT_NOTE = 'Independent: a guest with no other role in the club';

/** Whether someone an admin could add would be an independent selector: a guest and nothing else. */
export function isIndependentChoice(person: PanelChoice) {
  return person.roles.length === 1 && person.roles[0] === 'guest';
}

export function panelNotes(member: PanelMember) {
  return [
    member.independent ? INDEPENDENT_NOTE : null,
    member.declared_conflict ? 'Declared a conflict of interest this season' : null,
    member.own_children > 0
      ? `Can’t assess ${plural(member.own_children, 'athlete', 'athletes')} in this round: their own child`
      : null,
    !member.removed_at && !member.can_assess
      ? 'No access now: stood down, left or without a current check'
      : null,
  ].filter((n): n is string => n !== null);
}

// ---------------------------------------------------------------------------
// Dates, reminders and what athletes and parents see

/** What stops a date being saved, or null. The database checks the same. */
export function milestoneProblem(title: string, dueOn: string | null): string | null {
  if (!title.trim()) return 'Name the date, such as Teams named.';
  if (title.trim().length > MAX_MILESTONE_TITLE) return `Keep the name to ${MAX_MILESTONE_TITLE} characters.`;
  if (!dueOn) return 'Choose the day.';
  return null;
}

/** When a date falls, in words: "Done", "Today", "In 3 days", "5 days overdue". */
export function dueLabel(date: { due_on: string; done: boolean }, today: string) {
  if (date.done) return 'Done';
  const days = daysBetween(today, date.due_on);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `In ${days} days`;
  return `${plural(-days, 'day', 'days')} overdue`;
}

/** Whether a date is past and not done. */
export function isOverdue(date: { due_on: string; done: boolean }, today: string) {
  return !date.done && date.due_on < today;
}

/** What an admin reads under a date: when it's due, who marked it done, who sees it. */
export function milestoneLine(m: Milestone, today: string) {
  const when = m.done_at
    ? `Done ${day(m.done_at)}${m.done_by_name ? ` by ${m.done_by_name}` : ''}${
        m.days_late > 0 ? `, ${plural(m.days_late, 'day', 'days')} late` : ''
      }`
    : dueLabel({ due_on: m.due_on, done: false }, today);
  return `${formatDateString(m.due_on)} · ${when} · ${
    m.shared ? 'athletes and parents see it' : 'panel and admins only'
  }`;
}

/** The line about attendance on an athlete's assessment, or null with no sessions. */
export function attendanceLine(attendance: RoundAttendance | null) {
  if (!attendance || attendance.sessions === 0) return null;
  return `Marked at ${attendance.attended} of ${plural(attendance.sessions, 'session', 'sessions')} in this round`;
}

/** The selection to-dos for the member: panel members and admins, when it's on. */
export function useMySelectionTodos() {
  const on = useAssessmentsOn();
  const eligible = useCanBeSelector() && on;
  const [todos, setTodos] = useState<SelectionTodo[]>([]);
  const load = useCallback(async () => {
    if (!eligible) return;
    const { data } = await supabase.rpc('my_selection_todos');
    setTodos((data as SelectionTodo[] | null) ?? []);
  }, [eligible]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { selectionTodos: eligible ? todos : [], reloadSelectionTodos: load };
}

/** Whether the member plays, or looks after someone who does: who may see a round's criteria and dates. */
export function useCanSeeSelectionInfo() {
  const { profile, memberships } = useAuth();
  const on = useAssessmentsOn();
  if (!on || profile?.status !== 'approved') return false;
  return hasRole(profile, 'athlete', 'guardian') || memberships.some((m) => m.team_role === 'athlete');
}

/** The open rounds the member, or their children, are in: criteria and shared dates. */
export function useMySelectionInfo() {
  const eligible = useCanSeeSelectionInfo();
  const [info, setInfo] = useState<SelectionInfo[]>([]);
  const load = useCallback(async () => {
    if (!eligible) return;
    const { data } = await supabase.rpc('my_selection_info');
    setInfo((data as SelectionInfo[] | null) ?? []);
  }, [eligible]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { selectionInfo: eligible ? info : [], reloadSelectionInfo: load };
}

/** Whose round it is, for the heading: "Your selection" or "Jordan’s selection". */
export function selectionInfoOwner(info: SelectionInfo) {
  if (info.is_me) return 'You';
  return info.athlete_name ?? 'Your child';
}

/** What Home says under Selections for an athlete or parent. */
export function selectionInfoLabel(
  info: SelectionInfo[],
  today: string,
  feedback: { round_id: string }[] = [],
  releases: Pick<ReleasedAssessment, 'is_new' | 'is_me' | 'athlete_name'>[] = [],
) {
  // A release not read yet leads (part 5).
  const fresh = releases.find((r) => r.is_new);
  if (fresh) return `${releasedHeading(fresh)} from the coach`;
  // Feedback leads, unless it is from an earlier round and a new one is open.
  if (feedback.some((f) => info.length === 0 || info.some((i) => i.round_id === f.round_id))) {
    return 'Feedback from the coach';
  }
  if (info.length === 0) return '';
  const running = info.filter((i) => roundWhen(i, today) === 'now');
  if (running.length === 0) {
    const soonest = [...info].sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
    if (soonest.starts_on > today) return `Starts ${shortDate(soonest.starts_on)}: ${roundTitle(soonest)}`;
  }
  const next = info
    .flatMap((i) => i.dates)
    .filter((d) => !d.done && d.due_on >= today)
    .sort((a, b) => a.due_on.localeCompare(b.due_on))[0];
  const rounds = [...new Set((running.length ? running : info).map((i) => roundTitle(i)))];
  const name = rounds.length === 1 ? rounds[0] : `${rounds.length} selection rounds`;
  return next ? `${name} · next: ${next.title}, ${formatDateString(next.due_on)}` : `${name} · criteria and dates`;
}

// ---------------------------------------------------------------------------
// Summaries: each selector's own view of an athlete, signed at the end

/** One step chosen in a summary: 1 is the lowest of the group's three. */
export type SummaryRating = { item_key: string; rating: number };

/** What a summary says. */
export type SummaryBody = {
  ratings: SummaryRating[];
  recommendation: string | null;
  strengths: string | null;
  priorities: string | null;
  comments: string | null;
  signed_at: string | null;
};

/** Another selector's signed summary, shown once the reader has signed their own. */
export type OtherSummary = SummaryBody & { id: string; author_name: string };

/** A selector's summary of one athlete, as the summary screen loads it. */
export type AssessmentSummary = {
  round_id: string;
  round_name: string;
  team_name: string;
  closed: boolean;
  starts_on: string;
  ends_on: string;
  criteria: Criteria;
  today: string;
  athlete_id: string;
  athlete_name: string | null;
  my_name: string | null;
  mine: (SummaryBody & { id: string; updated_at: string }) | null;
  /** The reader's own latest step for each item, to start a new summary from. */
  prefill: SummaryRating[];
  my_observations: { total: number; training: number; game: number; trial: number; other: number };
  last_reopened: { by_name: string; at: string } | null;
  /** The head coach of the round's squad or team, while the round is open. */
  can_reopen: boolean;
  /** How many other selectors have signed one for this athlete. */
  others_signed: number;
  /** Empty until the reader's own is signed. */
  others: OtherSummary[];
};

/** Where a selector's summary of an athlete stands, for a round's list. */
export type SummaryStatus = { athlete_id: string; mine: 'none' | 'draft' | 'signed'; signed: number };

/** Who has signed what, for an admin: names, counts and dates only. */
export type AdminSummaries = {
  ends_on: string;
  closed: boolean;
  selectors: {
    name: string;
    on_panel: boolean;
    athletes: number;
    signed: number;
    signed_late: number;
    drafts: number;
    reopened: number;
  }[];
  signed: { id: string; selector_name: string; athlete_name: string | null; signed_at: string; late: boolean }[];
  reopenings: { selector_name: string; athlete_name: string | null; by_name: string; at: string }[];
};

/** A summary being written. */
export type SummaryDraft = {
  ratings: SummaryRating[];
  recommendation: string | null;
  strengths: string;
  priorities: string;
  comments: string;
};

/**
 * What the summary form starts with: the selector's saved summary, or for a
 * new one their own latest step for each item, which they then check.
 */
export function summaryStart(summary: AssessmentSummary): SummaryDraft {
  const keys = new Set(summary.criteria.groups.flatMap((g) => g.items.map((i) => i.key)));
  const recommendations = summary.criteria.recommendations ?? [];
  const mine = summary.mine;
  return {
    ratings: (mine ? mine.ratings : summary.prefill).filter((r) => keys.has(r.item_key)),
    recommendation: mine?.recommendation && recommendations.includes(mine.recommendation) ? mine.recommendation : null,
    strengths: mine?.strengths ?? '',
    priorities: mine?.priorities ?? '',
    comments: mine?.comments ?? '',
  };
}

/** Sets an item's step in a summary, or with undefined takes it off. */
export function setSummaryRating(ratings: SummaryRating[], itemKey: string, step: number | undefined) {
  const rest = ratings.filter((r) => r.item_key !== itemKey);
  return step === undefined ? rest : [...rest, { item_key: itemKey, rating: step }];
}

/** What stops a summary being saved, or signed, or null. The database checks the same. */
export function summaryProblem(draft: SummaryDraft, criteria: Criteria, sign: boolean): string | null {
  const texts = [draft.strengths, draft.priorities, draft.comments];
  if (texts.some((t) => t.trim().length > MAX_SUMMARY_TEXT)) {
    return `Keep each box to ${MAX_SUMMARY_TEXT} characters.`;
  }
  if (!sign) return null;
  if (draft.ratings.length === 0) return 'Choose a step for at least one of the criteria before you sign.';
  if ((criteria.recommendations ?? []).length > 0 && !draft.recommendation) {
    return 'Choose a recommendation before you sign.';
  }
  return null;
}

/** How many of the round's items a summary has a step for, as "12 of 33 criteria". */
export function summaryCoverage(criteria: Criteria, ratings: SummaryRating[]) {
  const keys = criteria.groups.flatMap((g) => g.items.map((i) => i.key));
  const rated = keys.filter((key) => ratings.some((r) => r.item_key === key)).length;
  return `${rated} of ${keys.length} criteria`;
}

/** A selector's observations of an athlete, as "5 observations: 3 training, 2 game". */
export function myObservationsLine(counts: AssessmentSummary['my_observations']) {
  if (counts.total === 0) return 'You have written no observations about this athlete.';
  const parts = CONTEXTS.filter((c) => counts[c.value] > 0).map((c) => `${counts[c.value]} ${c.label.toLowerCase()}`);
  return `Your ${plural(counts.total, 'observation', 'observations')}: ${parts.join(', ')}`;
}

/** What a round's list says about an athlete's summaries, or null before anyone starts one. */
export function summaryStatusLine(status: SummaryStatus | undefined) {
  if (!status || (status.mine === 'none' && status.signed === 0)) return null;
  const mine =
    status.mine === 'signed' ? 'Your summary is signed' : status.mine === 'draft' ? 'Your summary is a draft' : 'No summary from you yet';
  return `${mine} · ${status.signed} signed in all`;
}

/**
 * The completed assessment sheet for one athlete: every signed summary side
 * by side, on screen and as a PDF. Only a selector who has signed their own
 * can build it. It has no total or score, and puts nobody in order.
 */
export function summarySheetReport(summary: AssessmentSummary): Report {
  const mine = summary.mine && summary.mine.signed_at ? summary.mine : null;
  const signed: { name: string; body: SummaryBody }[] = [
    ...(mine ? [{ name: summary.my_name ?? 'You', body: mine as SummaryBody }] : []),
    ...summary.others.map((o) => ({ name: o.author_name, body: o as SummaryBody })),
  ];
  const step = (group: CriteriaGroup, body: SummaryBody, itemKey: string) => {
    const rating = body.ratings.find((r) => r.item_key === itemKey);
    return rating ? (group.scale[rating.rating - 1] ?? '') : '';
  };
  const words = (title: string, pick: (body: SummaryBody) => string | null): ReportSection => ({
    title,
    columns: [{ label: 'Selector' }, { label: title, width: 4 }],
    rows: signed.filter((s) => pick(s.body)).map((s) => ({ cells: [s.name, pick(s.body) ?? ''] })),
    empty: 'Nothing written.',
  });
  const recommendations = summary.criteria.recommendations ?? [];

  return {
    title: 'Selection assessment',
    subtitle: `${summary.athlete_name ?? 'Athlete'} · ${summary.round_name} · ${summary.team_name} · ${roundDates(summary)}`,
    landscape: signed.length > 2,
    stats: [{ label: signed.length === 1 ? 'Signed summary' : 'Signed summaries', value: signed.length }],
    sections: [
      ...summary.criteria.groups.map((group) => ({
        title: group.name,
        note: `Steps, lowest first: ${group.scale.join(', ')}.`,
        columns: [{ label: 'Criteria', width: 2 }, ...signed.map((s) => ({ label: s.name, width: 1.5 }))],
        rows: group.items.map((item) => ({ cells: [item.name, ...signed.map((s) => step(group, s.body, item.key))] })),
      })),
      ...(recommendations.length > 0
        ? [
            {
              title: 'Recommendation',
              columns: [{ label: 'Selector' }, { label: 'Recommends', width: 4 }],
              rows: signed.map((s) => ({ cells: [s.name, s.body.recommendation ?? ''] })),
            },
          ]
        : []),
      words('Strengths', (b) => b.strengths),
      words('Development priorities', (b) => b.priorities),
      words('Comments', (b) => b.comments),
      {
        title: 'Signed',
        columns: [{ label: 'Selector' }, { label: 'Signed on', width: 4 }],
        rows: signed.map((s) => ({ cells: [s.name, day(s.body.signed_at)] })),
      },
    ],
    footnote:
      'Each selector wrote and signed their own summary before seeing anyone else’s. There is no total or score, and nothing here puts athletes in order. Confidential to the selection panel: keep this copy as the club’s privacy policy says.',
  };
}

/** The Summaries part of the Selection audit report: who signed, when, and every reopening. */
export function summariesAuditSections(summaries: AdminSummaries): ReportSection[] {
  return [
    {
      title: 'Summaries',
      note: 'Each selector’s own summary of each athlete they can assess, signed at the end of the round. “Late” is signed after the round’s last day. Counts only.',
      columns: [
        { label: 'Selector', width: 2.4 },
        { label: 'Athletes' },
        { label: 'Signed' },
        { label: 'Signed late' },
        { label: 'Drafts' },
        { label: 'Still to start' },
        { label: 'Reopened' },
      ],
      rows: summaries.selectors.map((s) => {
        const toStart = Math.max(0, s.athletes - s.signed - s.drafts);
        return {
          cells: [
            s.on_panel ? s.name : `${s.name} (not on the panel now)`,
            String(s.athletes),
            String(s.signed),
            String(s.signed_late),
            String(s.drafts),
            s.on_panel ? String(toStart) : '',
            String(s.reopened),
          ],
          flag: s.on_panel && summaries.closed && s.signed < s.athletes,
        };
      }),
      empty: 'Nobody is on the panel.',
    },
    {
      title: 'Summaries reopened',
      note: 'A signed summary can be reopened by the head coach or an admin so its selector can change it and sign again.',
      columns: [
        { label: 'Selector', width: 2 },
        { label: 'Athlete', width: 2 },
        { label: 'Reopened by', width: 2 },
        { label: 'When' },
      ],
      rows: summaries.reopenings.map((r) => ({
        cells: [r.selector_name, r.athlete_name ?? 'Athlete', r.by_name, day(r.at)],
      })),
      empty: 'No summary has been reopened.',
    },
  ];
}

/** One signed summary's words, for the screen. */
export type ComparedSelector = {
  name: string;
  recommendation: string | null;
  strengths: string | null;
  priorities: string | null;
  comments: string | null;
  signedOn: string;
};

/** A group of criteria in the comparison: the items someone gave a step, and the rest by name. */
export type ComparedGroup = {
  key: string;
  name: string;
  rated: { key: string; name: string; steps: string }[];
  unrated: string[];
};

/**
 * The signed summaries of an athlete laid out for a phone: each selector's
 * recommendation and words first, then for each group only the criteria
 * someone gave a step, as "Sam Rivera: Exceeds standard · Jess Okafor: Meets
 * standard". The same facts as the PDF, with no total or score.
 */
export function summaryComparison(summary: AssessmentSummary): { selectors: ComparedSelector[]; groups: ComparedGroup[] } {
  const mine = summary.mine && summary.mine.signed_at ? summary.mine : null;
  const signed: { name: string; body: SummaryBody }[] = [
    ...(mine ? [{ name: summary.my_name ?? 'You', body: mine as SummaryBody }] : []),
    ...summary.others.map((o) => ({ name: o.author_name, body: o as SummaryBody })),
  ];
  return {
    selectors: signed.map(({ name, body }) => ({
      name,
      recommendation: body.recommendation,
      strengths: body.strengths,
      priorities: body.priorities,
      comments: body.comments,
      signedOn: day(body.signed_at),
    })),
    groups: summary.criteria.groups.map((group) => {
      const items = group.items.map((item) => ({
        key: item.key,
        name: item.name,
        steps: signed
          .map(({ name, body }) => {
            const rating = body.ratings.find((r) => r.item_key === item.key);
            const step = rating ? group.scale[rating.rating - 1] : undefined;
            return step ? `${name}: ${step}` : null;
          })
          .filter((line): line is string => line !== null)
          .join(' · '),
      }));
      return {
        key: group.key,
        name: group.name,
        rated: items.filter((item) => item.steps),
        unrated: items.filter((item) => !item.steps).map((item) => item.name),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Getting around quickly (Matt, 23 November 2026: coaches won't use it
// unless it is easy to navigate)

/** Where Home's card goes: straight to the round when the member has only one. */
export function selectionHomeHref(rounds: MyRound[]) {
  return rounds.length === 1
    ? ({ pathname: '/assessments/round', params: { id: rounds[0].id } } as const)
    : ('/assessments' as const);
}

/** The next date still to do in a round, overdue ones first, or null. */
export function nextRoundDate(dates: RoundDate[]): RoundDate | null {
  return [...dates].filter((date) => !date.done).sort((a, b) => a.due_on.localeCompare(b.due_on))[0] ?? null;
}

/** Which athletes a round's list shows. */
export type AthleteFilter = 'all' | 'nothing' | 'unsigned';

/** The filters over a round's list with how many athletes each holds; only ones worth offering. */
export function athleteFilters(
  athletes: SheetAthlete[],
  statuses: SummaryStatus[],
  summariesDue: boolean,
): { value: AthleteFilter; label: string }[] {
  const nothing = athletes.filter((a) => a.observations === 0).length;
  const unsigned = athletes.filter((a) => summaryOf(statuses, a.id) !== 'signed').length;
  const started = statuses.some((s) => s.mine !== 'none');
  const filters: { value: AthleteFilter; label: string }[] = [{ value: 'all', label: `All (${athletes.length})` }];
  if (nothing > 0) filters.push({ value: 'nothing', label: `Nothing written (${nothing})` });
  if ((summariesDue || started) && unsigned > 0) filters.push({ value: 'unsigned', label: `Summary to sign (${unsigned})` });
  return filters.length > 1 ? filters : [];
}

const summaryOf = (statuses: SummaryStatus[], athleteId: string) =>
  statuses.find((s) => s.athlete_id === athleteId)?.mine ?? 'none';

/** A round's athletes under a filter and a search for part of a name. */
export function filterAthletes(
  athletes: SheetAthlete[],
  statuses: SummaryStatus[],
  filter: AthleteFilter,
  search = '',
) {
  const words = search.trim().toLowerCase();
  return athletes.filter(
    (a) =>
      (filter === 'all' ||
        (filter === 'nothing' ? a.observations === 0 : summaryOf(statuses, a.id) !== 'signed')) &&
      (!words || (a.name ?? 'athlete').toLowerCase().includes(words)),
  );
}

/** A round's list is searchable once it is longer than this. */
export const SEARCH_FROM = 8;

/** Whether a round is in the week before its last day, or past it: summaries are due. */
export function summariesDue(round: { ends_on: string; closed: boolean }, today: string) {
  return !round.closed && daysBetween(today, round.ends_on) <= 7;
}

/**
 * The next athlete in a round's list, after this one and wrapping round,
 * whose summary the member hasn't signed; null when there is no other.
 */
export function nextToSign(athletes: SheetAthlete[], statuses: SummaryStatus[], currentId: string) {
  const at = athletes.findIndex((a) => a.id === currentId);
  const order = [...athletes.slice(at + 1), ...athletes.slice(0, Math.max(at, 0))];
  return order.find((a) => a.id !== currentId && summaryOf(statuses, a.id) !== 'signed') ?? null;
}

// ---------------------------------------------------------------------------
// Feedback: what the head coach chooses to share with an athlete

export const MAX_FEEDBACK_TEXT = 1000;

/** An athlete's feedback in a round, as a panel member who can assess them sees it. */
export type AthleteFeedback = {
  round_id: string;
  round_name: string;
  closed: boolean;
  athlete_id: string;
  athlete_name: string | null;
  is_minor: boolean;
  /** The head coach, while the round is open. */
  can_write: boolean;
  /** Null when nothing is written, or for anyone but the head coach while it is a draft. */
  feedback: {
    went_well: string;
    work_on: string;
    author_name: string;
    shared_at: string | null;
    seen_at: string | null;
    updated_at: string;
  } | null;
};

/** Where an athlete's feedback stands, for a round's list. */
export type FeedbackStatus = { athlete_id: string; state: 'draft' | 'shared'; seen: boolean };

/** Feedback shared with the member, or with their child. */
export type SharedFeedback = {
  round_id: string;
  round_name: string;
  team_name: string;
  athlete_id: string;
  athlete_name: string | null;
  is_me: boolean;
  went_well: string;
  work_on: string;
  shared_on: string;
  from_name: string;
};

/** What an admin is shown about a round's feedback: who, when and whether it was read, never the words. */
export type AdminFeedback = {
  athletes: number;
  shared: {
    athlete_name: string | null;
    shared_at: string | null;
    shared_by_name: string | null;
    seen_at: string | null;
    withdrawn: number;
  }[];
};

/** Why feedback can't be saved or shared yet, or null. */
export function feedbackProblem(wentWell: string, workOn: string, share: boolean): string | null {
  if (wentWell.length > MAX_FEEDBACK_TEXT || workOn.length > MAX_FEEDBACK_TEXT) {
    return `Keep each box to ${MAX_FEEDBACK_TEXT} characters`;
  }
  if (share && !wentWell.trim() && !workOn.trim()) return 'Write some feedback before you share it';
  return null;
}

/** What a round's list, and the athlete's assessment, say about their feedback; null with none. */
export function feedbackStatusLine(status: Pick<FeedbackStatus, 'state' | 'seen'> | undefined) {
  if (!status) return null;
  if (status.state === 'draft') return 'Feedback is a draft';
  return status.seen ? 'Feedback shared and read' : 'Feedback shared, not read yet';
}

/** Who reads feedback once it is shared, for the head coach before they share. */
export function feedbackReaders(feedback: Pick<AthleteFeedback, 'athlete_name' | 'is_minor'>) {
  const name = feedback.athlete_name ?? 'The athlete';
  return feedback.is_minor
    ? `${name} and their verified parents and guardians will read this under Selection. Nobody can reply in the app. You can take it back to change it.`
    : `${name} will read this under Selection. Nobody can reply in the app. You can take it back to change it.`;
}

/**
 * The next athlete in a round's list, after this one and wrapping round,
 * with no feedback shared; null when there is no other.
 */
export function nextForFeedback(athletes: SheetAthlete[], statuses: FeedbackStatus[], currentId: string) {
  const at = athletes.findIndex((a) => a.id === currentId);
  const order = [...athletes.slice(at + 1), ...athletes.slice(0, Math.max(at, 0))];
  const shared = (id: string) => statuses.some((s) => s.athlete_id === id && s.state === 'shared');
  return order.find((a) => a.id !== currentId && !shared(a.id)) ?? null;
}

/** The Feedback part of the Selection audit report: who was given feedback and when. */
export function feedbackAuditSection(feedback: AdminFeedback): ReportSection {
  const now = feedback.shared.filter((f) => f.shared_at).length;
  return {
    title: 'Feedback shared',
    note: `Feedback the head coach shared with an athlete and, under 18, their verified parents. ${now} of ${plural(
      feedback.athletes,
      'athlete has',
      'athletes have',
    )} feedback shared now. What it says is not shown.`,
    columns: [
      { label: 'Athlete', width: 2.4 },
      { label: 'Shared', width: 1.5 },
      { label: 'By', width: 2 },
      { label: 'First read', width: 1.5 },
      { label: 'Taken back' },
    ],
    rows: feedback.shared.map((f) => ({
      cells: [
        f.athlete_name ?? 'Athlete',
        f.shared_at ? day(f.shared_at) : 'Taken back',
        f.shared_by_name ?? '',
        f.shared_at ? (f.seen_at ? day(f.seen_at) : 'Not yet') : '',
        f.withdrawn === 0 ? '' : plural(f.withdrawn, 'time', 'times'),
      ],
    })),
    empty: 'No feedback has been shared.',
  };
}

/** Feedback shared with the member or their children, in open and closed rounds. */
export function useMySelectionFeedback() {
  const eligible = useCanSeeSelectionInfo();
  const [feedback, setFeedback] = useState<SharedFeedback[]>([]);
  const load = useCallback(async () => {
    if (!eligible) return;
    const { data } = await supabase.rpc('my_selection_feedback');
    setFeedback((data as SharedFeedback[] | null) ?? []);
  }, [eligible]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { selectionFeedback: eligible ? feedback : [], reloadSelectionFeedback: load };
}

/** Whose feedback it is, for its heading: "Feedback for you" or "Feedback for Jordan". */
export function feedbackHeading(feedback: SharedFeedback) {
  return feedback.is_me ? 'Feedback for you' : `Feedback for ${feedback.athlete_name ?? 'your child'}`;
}

// ---------------------------------------------------------------------------
// Releasing an assessment (part 5): the head coach shows an athlete chosen
// parts of their own signed summary. What the athlete reads is filtered in the
// database (my_released_assessments); releasePreview follows the same rules.

/** The parts of a signed summary the head coach shows. */
export type ReleaseParts = {
  groups: string[];
  strengths: boolean;
  priorities: boolean;
  comments: boolean;
  recommendation: boolean;
};

/** The head coach's own signed summary, for the ticks and the preview. */
export type ReleaseSummary = {
  ratings: SummaryRating[];
  recommendation: string | null;
  strengths: string;
  priorities: string;
  comments: string;
};

/** An athlete's release, for a panel member who can assess them (athlete_release). */
export type AthleteRelease = {
  round_id: string;
  round_name: string;
  phase: number | null;
  round_number: number | null;
  team_name: string;
  criteria_set_name: string | null;
  closed: boolean;
  criteria: Criteria;
  athlete_id: string;
  athlete_name: string | null;
  is_minor: boolean;
  can_release: boolean;
  my_summary_signed: boolean;
  my_name: string | null;
  /** Only for the head coach, once their summary is signed. */
  summary: ReleaseSummary | null;
  release: { parts: ReleaseParts; released_at: string | null; released_by_name: string; seen_at: string | null } | null;
};

/** One assessment released to the member or their child (my_released_assessments). */
export type ReleasedAssessment = {
  round_id: string;
  round_name: string;
  phase: number | null;
  round_number: number | null;
  team_name: string;
  criteria_set_name: string | null;
  athlete_id: string;
  athlete_name: string | null;
  is_me: boolean;
  from_name: string;
  released_on: string;
  is_new: boolean;
  strengths: string | null;
  priorities: string | null;
  comments: string | null;
  recommendation: string | null;
  groups: { name: string; scale: string[]; items: { name: string; step: string }[] }[];
};

/** What admins and auditors are shown about releases: who, when and which parts, never the words. */
export type AdminReleases = {
  athletes: number;
  released: {
    athlete_name: string | null;
    released_at: string | null;
    released_by_name: string | null;
    seen_at: string | null;
    withdrawn: number;
    groups: number;
    groups_total: number;
    strengths: boolean;
    priorities: boolean;
    comments: boolean;
    recommendation: boolean;
  }[];
};

/** For a round's list: whose assessment is released. */
export type ReleaseStatus = { athlete_id: string; seen: boolean };

const filled = (text: string | null | undefined) => !!text && text.trim() !== '';

/** The criteria groups the summary gave at least one step in. */
export function groupsWithSteps(criteria: Criteria, summary: Pick<ReleaseSummary, 'ratings'>) {
  const rated = new Set(summary.ratings.filter((r) => r.rating !== null && r.rating !== undefined).map((r) => r.item_key));
  return criteria.groups.filter((g) => g.items.some((i) => rated.has(i.key))).map((g) => g.key);
}

/** The ticks a head coach starts with. */
export function defaultReleaseParts(criteria: Criteria, summary: ReleaseSummary): ReleaseParts {
  return {
    groups: groupsWithSteps(criteria, summary),
    strengths: filled(summary.strengths),
    priorities: filled(summary.priorities),
    comments: false,
    recommendation: false,
  };
}

/** Why the ticks can't be released, or null. */
export function releasePartsProblem(parts: ReleaseParts) {
  const any = parts.groups.length > 0 || parts.strengths || parts.priorities || parts.comments || parts.recommendation;
  return any ? null : 'Tick at least one part to release';
}

/** The parts in a line: "Ratings for 6 of 9 groups, strengths, development priorities". */
export function releasePartsLine(parts: ReleaseParts, groupsTotal: number) {
  const bits = [
    parts.groups.length === 0
      ? null
      : parts.groups.length === groupsTotal
        ? `Ratings for all ${plural(groupsTotal, 'group', 'groups')}`
        : `Ratings for ${parts.groups.length} of ${groupsTotal} groups`,
    parts.strengths ? 'strengths' : null,
    parts.priorities ? 'development priorities' : null,
    parts.comments ? 'comments' : null,
    parts.recommendation ? 'recommendation' : null,
  ].filter((b): b is string => b !== null);
  const line = bits.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Who reads a released assessment, for the head coach before they release. */
export function releaseReaders(release: Pick<AthleteRelease, 'athlete_name' | 'is_minor'>) {
  const name = release.athlete_name ?? 'The athlete';
  return release.is_minor
    ? `${name} is under 18. Their verified parents and guardians read this assessment at the same time, under Selection. Nobody can reply in the app.`
    : `${name} reads this assessment under Selection. Nobody can reply in the app.`;
}

/** What a round's list, and the athlete's screen, say about a release; null when none. */
export function releaseStatusLine(status: Pick<ReleaseStatus, 'seen'> | undefined) {
  if (!status) return null;
  return status.seen ? 'Assessment released and read' : 'Assessment released, not read yet';
}

/**
 * What the athlete will read, built from the head coach's own summary and the
 * ticks with the same rules as my_released_assessments: only ticked parts
 * that aren't empty, only ticked groups, only criteria with a step, steps in
 * the scale's words.
 */
export function releasePreview(release: AthleteRelease, summary: ReleaseSummary, parts: ReleaseParts): ReleasedAssessment {
  const text = (on: boolean, value: string | null) => (on && filled(value) ? (value as string).trim() : null);
  const steps = new Map(summary.ratings.map((r) => [r.item_key, r.rating]));
  return {
    round_id: release.round_id,
    round_name: release.round_name,
    phase: release.phase,
    round_number: release.round_number,
    team_name: release.team_name,
    criteria_set_name: release.criteria_set_name,
    athlete_id: release.athlete_id,
    athlete_name: release.athlete_name,
    is_me: false,
    from_name: release.my_name ?? '',
    released_on: clubToday(),
    is_new: true,
    strengths: text(parts.strengths, summary.strengths),
    priorities: text(parts.priorities, summary.priorities),
    comments: text(parts.comments, summary.comments),
    recommendation: text(parts.recommendation, summary.recommendation),
    groups: release.criteria.groups
      .filter((g) => parts.groups.includes(g.key))
      .map((g) => ({
        name: g.name,
        scale: g.scale,
        items: g.items
          .filter((i) => steps.get(i.key) != null)
          .map((i) => ({ name: i.name, step: g.scale[(steps.get(i.key) as number) - 1] })),
      }))
      .filter((g) => g.items.length > 0),
  };
}

/** "Your assessment" or "Jordan’s assessment". */
export function releasedHeading(r: Pick<ReleasedAssessment, 'is_me' | 'athlete_name'>) {
  return r.is_me ? 'Your assessment' : `${r.athlete_name ?? 'Your child'}’s assessment`;
}

/** Assessments released to the member or their children, in open and closed rounds. */
export function useMyReleasedAssessments() {
  const eligible = useCanSeeSelectionInfo();
  const [releases, setReleases] = useState<ReleasedAssessment[]>([]);
  const load = useCallback(async () => {
    if (!eligible) return;
    const { data } = await supabase.rpc('my_released_assessments');
    setReleases((data as ReleasedAssessment[] | null) ?? []);
  }, [eligible]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { selectionReleases: eligible ? releases : [], reloadSelectionReleases: load };
}

/** The Assessments released part of the Selection audit report. */
export function releasesAuditSection(releases: AdminReleases): ReportSection {
  const now = releases.released.filter((r) => r.released_at).length;
  return {
    title: 'Assessments released',
    note: `What the head coach chose to show an athlete from their signed summary, and under 18, their verified parents. ${now} of ${plural(
      releases.athletes,
      'athlete has',
      'athletes have',
    )} one released now. What it says is not shown.`,
    columns: [
      { label: 'Athlete', width: 2.4 },
      { label: 'Released', width: 1.5 },
      { label: 'By', width: 2 },
      { label: 'Parts', width: 3 },
      { label: 'First read', width: 1.5 },
      { label: 'Taken back' },
    ],
    rows: releases.released.map((r) => ({
      cells: [
        r.athlete_name ?? 'Athlete',
        r.released_at ? day(r.released_at) : 'Taken back',
        r.released_by_name ?? '',
        releasePartsLine(
          { groups: Array.from({ length: r.groups }, (_, n) => String(n)), strengths: r.strengths, priorities: r.priorities, comments: r.comments, recommendation: r.recommendation },
          r.groups_total,
        ),
        r.released_at ? (r.seen_at ? day(r.seen_at) : 'Not yet') : '',
        r.withdrawn === 0 ? '' : plural(r.withdrawn, 'time', 'times'),
      ],
    })),
    empty: 'No assessment has been released.',
  };
}

// ---------------------------------------------------------------------------
// Evidence from games

/** A game the athlete played during the round, for the panel: which and when, never a figure. */
export type RoundGame = {
  fixture_id: string;
  team_name: string;
  opponent: string;
  round_name: string | null;
  starts_at: string;
  played_on: string;
  /** Whether the game has a finished recording in FirstPass Vantage to draw figures from. */
  recorded: boolean;
};

/** Such as "v Stars · Sat, Oct 17, 2026". */
export function roundGameTitle(game: RoundGame) {
  return `v ${game.opponent} · ${formatDateString(game.played_on)}`;
}

/** What the folded card says under a game's title. */
export function roundGameLine(game: RoundGame) {
  const what = [game.team_name, game.round_name].filter(Boolean).join(' · ');
  return `${what} · ${game.recorded ? 'tap for the game stats' : 'not recorded'}`;
}

// ---------------------------------------------------------------------------
// Phase and round number, rounds ahead of time, no overlapping rounds

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function utcDate(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "2 Nov", or "Tue 22 Dec" with the weekday. */
export function shortDate(day: string, weekday = false) {
  const date = utcDate(day);
  const text = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  return weekday ? `${WEEKDAYS[date.getUTCDay()]} ${text}` : text;
}

/** "2 Nov to 21 Dec". */
export function shortRange(round: { starts_on: string; ends_on: string }) {
  return `${shortDate(round.starts_on)} to ${shortDate(round.ends_on)}`;
}

/** The day `days` after a club day. */
export function addDays(day: string, days: number) {
  const date = utcDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "Phase 1, Round 2", or null for a round opened before phases. */
export function phaseLabel(round: { phase?: number | null; round_number?: number | null }) {
  return round.phase && round.round_number ? `Phase ${round.phase}, Round ${round.round_number}` : null;
}

type Titled = { name?: string; round_name?: string; phase?: number | null; round_number?: number | null };

/** "Phase 1, Round 2 · Trials"; the label alone when the name is the label or empty; the name alone with no phase. */
export function roundTitle(round: Titled) {
  const name = (round.name ?? round.round_name ?? '').trim();
  const label = phaseLabel(round);
  if (!label) return name;
  return !name || name === label ? label : `${label} · ${name}`;
}

export type RoundWhen = 'now' | 'coming' | 'finished';

type Dated = { starts_on: string; ends_on: string; closed_at?: string | null; closed?: boolean };

/** Running now, coming up, or finished (closed, or past its end date). */
export function roundWhen(round: Dated, today: string): RoundWhen {
  if (round.closed_at || round.closed) return 'finished';
  if (round.ends_on < today) return 'finished';
  if (round.starts_on > today) return 'coming';
  return 'now';
}

/** Rounds under Running now, Coming up (soonest first) and Finished (latest first). */
export function groupRounds<T extends Dated>(rounds: T[], today: string) {
  const now = rounds.filter((r) => roundWhen(r, today) === 'now').sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const coming = rounds.filter((r) => roundWhen(r, today) === 'coming').sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const finished = rounds
    .filter((r) => roundWhen(r, today) === 'finished')
    .sort((a, b) => b.ends_on.localeCompare(a.ends_on));
  return { now, coming, finished };
}

/** "Ended 21 Dec · not closed yet" for a round past its end and still open, else null. */
export function notClosedLine(round: Dated, today: string) {
  return !round.closed_at && !round.closed && round.ends_on < today ? `Ended ${shortDate(round.ends_on)} · not closed yet` : null;
}

/** The phase and round number to preselect for a squad or team: its highest phase this season (or 1) and the next round in it. */
export function nextPhaseRound(rounds: Pick<AdminRound, 'team_id' | 'season' | 'phase' | 'round_number'>[], teamId: string, season: number) {
  const mine = rounds.filter((r) => r.team_id === teamId && r.season === season && r.phase && r.round_number);
  if (mine.length === 0) return { phase: 1, round: 1 };
  const phase = Math.max(...mine.map((r) => r.phase as number));
  const round = Math.max(...mine.filter((r) => r.phase === phase).map((r) => r.round_number as number));
  return round >= 20 ? { phase: Math.min(phase + 1, 9), round: 1 } : { phase, round: round + 1 };
}

/** A round the chosen dates would overlap, as admin_selection_round_clashes gives it. */
export type RoundClash = {
  round_name: string;
  team_name: string;
  starts_on: string;
  last_day: string;
  criteria_set_name: string | null;
  free_from: string;
};

/** One sentence per clash, for the warning. */
export function clashLines(clashes: RoundClash[]) {
  return clashes.map(
    (c) =>
      `“${c.round_name}” runs ${shortDate(c.starts_on)} to ${shortDate(c.last_day)} for ${c.team_name}` +
      (c.criteria_set_name ? `, on ${c.criteria_set_name}.` : '.'),
  );
}

/** The new pair for "Start on … instead": the same length, starting on the free day. */
export function shiftDates(startsOn: string, endsOn: string, freeFrom: string) {
  const length = Math.max(0, daysBetween(startsOn, endsOn));
  return { startsOn: freeFrom, endsOn: addDays(freeFrom, length) };
}

/** Current squads and teams with no round this season. */
export function groupsWithNoRound(
  teams: { id: string; name: string; archived?: boolean; season?: number | null }[],
  rounds: Pick<AdminRound, 'team_id' | 'season'>[],
  season: number,
) {
  const used = new Set(rounds.filter((r) => r.season === season).map((r) => r.team_id));
  return teams.filter((t) => !t.archived && (t.season == null || t.season === season) && !used.has(t.id));
}

// ---------------------------------------------------------------------------
// Auditors: committee members an admin makes auditors of a round. They read
// everything in it (never their own child's assessment) and change nothing.

/** A round's auditor, now or before, as an admin sees them. */
export type RoundAuditor = {
  profile_id?: string | null;
  name: string;
  added_at: string;
  added_by_name: string | null;
  removed_at: string | null;
  removed_by_name: string | null;
  /** Still an approved committee member with a current check. */
  can_audit: boolean;
  own_children: number;
  is_admin: boolean;
  /** Other rounds not closed that they audit now. */
  other_rounds: number;
};

/** Someone an admin could make an auditor. */
export type AuditorChoice = {
  profile_id: string;
  name: string | null;
  cleared: boolean;
  on_panel: boolean;
  audited_last: boolean;
};

/** A round on an auditor's list. */
export type MyAudit = {
  id: string;
  name: string;
  phase: number | null;
  round_number: number | null;
  team_name: string;
  starts_on: string;
  ends_on: string;
  closed_at: string | null;
  criteria_set_name: string | null;
  athletes: number;
  observations: number;
};

/** History of someone on a round, as an auditor reads it. */
export type RoundPerson = {
  name: string;
  added_at: string;
  added_by_name: string | null;
  removed_at: string | null;
  removed_by_name: string | null;
  independent?: boolean;
};

/** An athlete on an auditor's round. */
export type AuditorAthlete = {
  id: string;
  name: string | null;
  is_minor: boolean;
  observations: number;
  selectors: number;
  summaries_signed: number;
  selectors_on_panel: number;
  feedback: 'shared' | 'draft' | 'none';
};

/** A round as its auditor reads it. */
export type AuditRound = {
  id: string;
  name: string;
  phase: number | null;
  round_number: number | null;
  team_name: string;
  starts_on: string;
  ends_on: string;
  closed: boolean;
  criteria: Criteria;
  criteria_set_name: string | null;
  criteria_set_version: number | null;
  today: string;
  hidden: number;
  panel: RoundPerson[];
  auditors: RoundPerson[];
  athletes: AuditorAthlete[];
};

/** A signed summary, as an auditor reads it. */
export type AuditSummary = {
  id: string;
  author_name: string;
  ratings: SummaryRating[];
  recommendation: string | null;
  strengths: string;
  priorities: string;
  comments: string;
  signed_at: string;
};

/** One athlete's whole assessment, for the round's auditor. */
export type AuditorAssessment = {
  round_id: string;
  round_name: string;
  phase: number | null;
  round_number: number | null;
  team_name: string;
  starts_on: string;
  ends_on: string;
  closed: boolean;
  criteria: Criteria;
  today: string;
  athlete_id: string;
  athlete_name: string | null;
  is_minor: boolean;
  observations: Observation[];
  summaries: AuditSummary[];
  unsigned: number;
  summary_events: { author_name: string; kind: 'signed' | 'reopened'; late: boolean; by_name: string; at: string }[];
  feedback:
    | null
    | { draft: true }
    | { went_well: string; work_on: string; author_name: string; shared_at: string; seen_at: string | null };
  feedback_events: { kind: 'shared' | 'withdrawn'; by_name: string; at: string }[];
  /** What the head coach released, also when taken back (part 5). */
  release?: { parts: ReleaseParts; released_at: string | null; released_by_name: string; seen_at: string | null } | null;
  release_events?: { kind: 'released' | 'withdrawn'; parts: ReleaseParts | null; detail: string | null; by_name: string; at: string }[];
};

/** Whether the member could audit: an approved committee member. The database decides which rounds. */
export function useCanAudit() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && hasRole(profile, 'committee');
}

/** The rounds the member audits, for Today and Club. */
export function useMySelectionAudits() {
  const on = useAssessmentsOn();
  const eligible = useCanAudit() && on;
  const [audits, setAudits] = useState<MyAudit[]>([]);
  const load = useCallback(async () => {
    if (!eligible) return;
    const { data } = await supabase.rpc('my_selection_audits');
    setAudits((data as MyAudit[] | null) ?? []);
  }, [eligible]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { selectionAudits: eligible ? audits : [], reloadSelectionAudits: load };
}

/** The lines beside an auditor on the admin's Auditors tab. */
export function auditorNotes(auditor: RoundAuditor) {
  return [
    auditor.own_children > 0
      ? `Can’t check ${plural(auditor.own_children, 'athlete', 'athletes')} in this round: their own child`
      : null,
    auditor.is_admin ? 'Also an admin' : null,
    !auditor.removed_at && !auditor.can_audit ? 'Can’t audit now: needs a current Working With Children Check' : null,
    auditor.other_rounds > 0 ? `Audits ${plural(auditor.other_rounds, 'other round', 'other rounds')}` : null,
  ].filter((n): n is string => n !== null);
}

/** What the Selection audits card says. */
export function auditsLabel(audits: MyAudit[]) {
  if (audits.length === 1) return roundTitle(audits[0]);
  return `${audits.length} rounds to audit`;
}

/** Where the Selection audits card goes: the one round, or the list. */
export function auditsHomeHref(audits: MyAudit[]) {
  return audits.length === 1
    ? ({ pathname: '/audits/round', params: { id: audits[0].id } } as const)
    : ('/audits' as const);
}

/** An athlete's line on the auditor's round. */
export function auditAthleteLine(athlete: AuditorAthlete) {
  return `${plural(athlete.observations, 'observation', 'observations')} by ${plural(athlete.selectors, 'selector', 'selectors')} · ${athlete.summaries_signed} of ${athlete.selectors_on_panel} summaries signed`;
}

/** One line of a round's panel or auditors history. */
export function personHistoryLine(person: RoundPerson) {
  const added = `added ${formatDateString(person.added_at.slice(0, 10))}${person.added_by_name ? ` by ${person.added_by_name}` : ''}`;
  if (!person.removed_at) return `${person.name}${person.independent ? ' (independent)' : ''}: ${added}`;
  return `${person.name}${person.independent ? ' (independent)' : ''}: ${added}, removed ${formatDateString(person.removed_at.slice(0, 10))}${person.removed_by_name ? ` by ${person.removed_by_name}` : ''}`;
}
