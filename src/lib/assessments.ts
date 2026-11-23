import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/club';
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

/** What Home says under Selection assessments. */
export function roundsLabel(rounds: MyRound[]) {
  const open = rounds.filter((r) => !r.closed_at);
  if (open.length === 0) return 'Past selection rounds';
  if (open.length === 1) return `${open[0].name} · ${plural(open[0].athletes, 'athlete', 'athletes')}`;
  return `${open.length} selection rounds open`;
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
export function panelNotes(member: PanelMember) {
  return [
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
export function selectionInfoLabel(info: SelectionInfo[], today: string, feedback: { round_id: string }[] = []) {
  // Feedback leads, unless it is from an earlier round and a new one is open.
  if (feedback.some((f) => info.length === 0 || info.some((i) => i.round_id === f.round_id))) {
    return 'Feedback from the coach';
  }
  if (info.length === 0) return '';
  const next = info
    .flatMap((i) => i.dates)
    .filter((d) => !d.done && d.due_on >= today)
    .sort((a, b) => a.due_on.localeCompare(b.due_on))[0];
  const rounds = [...new Set(info.map((i) => i.round_name))];
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
