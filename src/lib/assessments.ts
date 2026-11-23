import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/club';
import { formatDateString } from '@/lib/injuries';
import type { Report } from '@/lib/pdf';
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

export type Criteria = { groups: CriteriaGroup[] };

export const MAX_GROUPS = 20;
export const MAX_ITEMS = 12;
export const MAX_NAME = 60;
export const MAX_STEP = 30;
export const MAX_EVIDENCE = 1000;

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
export function selectionAuditReport(audit: SelectionAudit): Report {
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
    ],
    footnote: [
      'This report shows how the selection work was done, not what was said: it holds no ratings, evidence or names of criteria, and nothing in it ranks athletes.',
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
  groups: criteria.groups.map((g) => (g.key === groupKey ? change(g) : g)),
});

/** Adds an empty group with one empty item and the usual scale. */
export function addGroup(criteria: Criteria): Criteria {
  const keys = criteriaKeys(criteria);
  const groupKey = newKey('group', keys);
  const itemKey = newKey('item', [...keys, groupKey]);
  return {
    groups: [
      ...criteria.groups,
      { key: groupKey, name: '', scale: [...DEFAULT_SCALE], items: [{ key: itemKey, name: '' }] },
    ],
  };
}

export function removeGroup(criteria: Criteria, groupKey: string): Criteria {
  return { groups: criteria.groups.filter((g) => g.key !== groupKey) };
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
