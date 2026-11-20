import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { SourceKey } from '@/lib/load-sources';
import { sessionLoad } from '@/lib/session-logs';
import { supabase } from '@/lib/supabase';
import type { SessionLog } from '@/lib/types';

/**
 * Training load prompts (20261028000000_load_monitoring.sql). The database
 * works out the flags; this file words them for each person, and works out
 * the coach-only numbers drawn from an athlete's session logs.
 */
export type LoadFlag = 'ratio' | 'hours' | 'injury' | 'wellbeing';

export type RatioChoice = 'from_1_5' | 'above_1_3' | 'off';

/** The club's choices (Club features), each tied to its source. */
export const RATIO_CHOICES: { value: RatioChoice; label: string; detail: string }[] = [
  {
    value: 'from_1_5',
    label: '1.5 or more',
    detail: 'Gabbett 2016’s “danger zone”. Fewer, clearer prompts. The default.',
  },
  {
    value: 'above_1_3',
    label: 'Above 1.3',
    detail:
      'Above the top of Gabbett 2016’s 0.8 to 1.3 “sweet spot”, a range from adult professional athletes that the paper says may differ by sport. Earlier, more frequent and noisier prompts.',
  },
  { value: 'off', label: 'Off', detail: 'No prompts for a rise in load.' },
];

export type CoachLoadRow = {
  athlete_id: string;
  athlete_name: string;
  flags: LoadFlag[];
  ratio: number | null;
  minutes_7d: number;
  sessions_7d: number;
  /** A coach's "Talked with them" in the last 7 days, which closes the flags. */
  reviewed_on: string | null;
  reviewer_name: string | null;
};

export type AthleteLoad = {
  /** Null for parents: they see only a coach's review. */
  flags: LoadFlag[] | null;
  ratio: number | null;
  weeks_before: number | null;
  reviewed_on: string | null;
  reviewer_name: string | null;
  reviewed_flags: LoadFlag[] | null;
  /** Coaches only. */
  review_note: string | null;
  /** 18 or over: the fitness chart is for adults only. */
  adult: boolean;
};

export type LoadPattern = 'hours_2_weeks' | 'with_wellbeing' | 'not_followed_up';

export type LoadPatternRow = {
  athlete_id: string;
  athlete_name: string;
  pattern: LoadPattern;
  since: string;
};

/** Shown wherever load is: Matt, 28 October 2026. */
export const LOAD_CAVEAT =
  'Training load is a conversation starter, not a diagnosis. These figures come from what athletes report about their own sessions. They can’t predict injury or illness and must not be relied on for selection, medical or return-to-play decisions. A flag means it may be worth checking in with the athlete, as one part of the club’s wider care for athlete welfare, alongside coaches, parents, physios and the athlete’s own view. If you’re worried about an athlete’s health, talk to a qualified health professional.';

type FlagWords = {
  /** For coaches: what the flag is. */
  coach: string;
  /** For the athlete. */
  athlete: string;
  /** For parents, once a coach has talked with their child. */
  parent: string;
  sources: SourceKey[];
};

export const FLAG_WORDS: Record<LoadFlag, FlagWords> = {
  ratio: {
    coach: 'Load jumped: the last 7 days are well above the last 4 weeks',
    athlete: 'Your training this week is well up on the last few weeks',
    parent: 'their training was well up on the weeks before',
    sources: ['gabbett2016', 'impellizzeri2020'],
  },
  hours: {
    coach: 'More hours of sport in 7 days than their age in years',
    athlete: 'You did more hours of sport this week than your age in years',
    parent: 'they did more hours of sport in the week than their age in years',
    sources: ['jayanthi2015'],
  },
  injury: {
    coach: 'Logged a session while an injury with restrictions isn’t cleared',
    athlete: 'You logged a session while your injury still has restrictions',
    parent: 'they trained while an injury still had restrictions',
    sources: [],
  },
  wellbeing: {
    coach: 'Also 2 or more low check-ins in the last 7 days',
    athlete: 'You’ve also had some low check-ins this week',
    parent: 'they also had some low check-ins that week',
    sources: ['saw2016'],
  },
};

export type ChildPatterns = {
  id: string;
  name: string;
  patterns: { pattern: LoadPattern; since: string }[];
};

/** The Child Safety Officer's patterns grouped by child, in name order. */
export function groupLoadPatterns(rows: LoadPatternRow[]): ChildPatterns[] {
  const byChild = new Map<string, ChildPatterns>();
  for (const row of rows) {
    const child = byChild.get(row.athlete_id) ?? {
      id: row.athlete_id,
      name: row.athlete_name,
      patterns: [],
    };
    child.patterns.push({ pattern: row.pattern, since: row.since });
    byChild.set(row.athlete_id, child);
  }
  return [...byChild.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const PATTERN_WORDS: Record<LoadPattern, string> = {
  hours_2_weeks: 'More hours of sport than their age, 2 weeks running',
  with_wellbeing: 'A load flag alongside 2 or more low check-ins this week',
  not_followed_up: 'A load flag a week ago that no coach has marked as talked about',
};

/** The sources behind a set of flags, each once, in order. */
export function sourcesFor(flags: LoadFlag[]): SourceKey[] {
  return [...new Set(flags.flatMap((f) => FLAG_WORDS[f].sources))];
}

/** The parent's card: who talked with their child, when, and what about. */
export function parentLine(childName: string, coach: string, flags: LoadFlag[]) {
  const reasons = flags.map((f) => FLAG_WORDS[f].parent);
  const about =
    reasons.length === 0
      ? ''
      : ` The club noticed ${reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`}.`;
  return `${coach} checked in with ${childName} about their training load.${about} Coaches review training load as part of looking after every athlete.`;
}

/** A "2026-10-18" style day moved by whole days, whatever the time zone. */
function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Each day's total load from `from` to `to`, oldest first. */
export function dailyLoads(logs: SessionLog[], from: string, to: string) {
  const byDay = new Map<string, number>();
  for (const log of logs) {
    const day = log.day > to ? to : log.day;
    byDay.set(day, (byDay.get(day) ?? 0) + sessionLoad(log));
  }
  const days: { day: string; load: number }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push({ day, load: byDay.get(day) ?? 0 });
  }
  return days;
}

export type FitnessDay = { day: string; fitness: number; fatigue: number; form: number };

/**
 * TrainingPeaks' Performance Manager on session-RPE load: fitness and
 * fatigue are exponentially weighted averages of daily load with time
 * constants of 42 and 7 days, and form is fitness minus fatigue. Starts
 * from zero at `from`, so the first weeks read low.
 */
export function fitnessFatigue(logs: SessionLog[], from: string, to: string): FitnessDay[] {
  let fitness = 0;
  let fatigue = 0;
  return dailyLoads(logs, from, to).map(({ day, load }) => {
    fitness += (load - fitness) / 42;
    fatigue += (load - fatigue) / 7;
    return {
      day,
      fitness: Math.round(fitness),
      fatigue: Math.round(fatigue),
      form: Math.round(fitness - fatigue),
    };
  });
}

/**
 * Foster's monotony (the week's mean daily load over its standard deviation)
 * and strain (the week's load times monotony) for the 7 days ending `to`.
 * Null without a session, or when every day's load is the same.
 */
export function monotonyAndStrain(logs: SessionLog[], to: string) {
  const days = dailyLoads(logs, addDays(to, -6), to).map((d) => d.load);
  const total = days.reduce((n, l) => n + l, 0);
  if (total === 0) return null;
  const mean = total / days.length;
  const sd = Math.sqrt(days.reduce((n, l) => n + (l - mean) ** 2, 0) / days.length);
  if (sd === 0) return null;
  const monotony = Math.round((mean / sd) * 10) / 10;
  return { monotony, strain: Math.round(total * monotony) };
}

/** The average effort (session RPE) of the sessions from `from` to `to`, to one place. */
export function averageEffort(logs: SessionLog[], from: string, to: string) {
  const inRange = logs.filter((l) => l.day >= from && l.day <= to);
  if (inRange.length === 0) return null;
  return Math.round((inRange.reduce((n, l) => n + l.rpe, 0) / inRange.length) * 10) / 10;
}

/** For a coach's to-do list: athletes with flags nobody has talked with them about. */
export function useCoachLoadFlagCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      supabase
        .rpc('coach_load_flag_count')
        .then(({ data }) => setCount(typeof data === 'number' ? data : 0));
    }, [enabled]),
  );
  return enabled ? count : 0;
}

/** For the Child Safety Officer's to-do list: children with a load pattern. */
export function useLoadPatternAlerts(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      supabase
        .rpc('load_pattern_alerts')
        .then(({ data }) => setCount(typeof data === 'number' ? data : null));
    }, [enabled]),
  );
  return enabled ? (count ?? 0) : 0;
}
