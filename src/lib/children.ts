/**
 * A parent or guardian's children: who they are, what each child's card in
 * Family says, and the things a parent opens for one child (src/app/child/[id].tsx).
 *
 * Nothing here decides what a parent may see. Each screen a link opens keeps
 * its own rule, in the app and in the database; this only gathers the links
 * for one child in one place.
 */
import { useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';

import type { IconName } from '@/components/icon';
import { attendanceCountLabel } from '@/lib/attendance';
import { asksCheckIns, type ChildConsent, consentTodoDetail, needsConsent } from '@/lib/consents';
import { consentSummary } from '@/lib/home-labels';
import { formatDateString, injuriesSummary } from '@/lib/injuries';
import type { MedicalReview } from '@/lib/medical';
import { supabase } from '@/lib/supabase';
import type { Injury } from '@/lib/types';

/** A child a parent or guardian looks after, with the consents in force for them. */
export type MyChild = {
  id: string;
  name: string;
  data: boolean;
  health: boolean;
  canConsent: boolean;
  checkInsOn: boolean;
  needsConsent: boolean;
  consentDetail: string;
};

export function toMyChild(a: ChildConsent): MyChild {
  return {
    id: a.athlete_id,
    name: a.full_name ?? 'Unnamed athlete',
    data: a.data,
    health: a.health,
    canConsent: a.can_consent,
    checkInsOn: asksCheckIns(a),
    needsConsent: needsConsent(a),
    consentDetail: consentTodoDetail(a),
  };
}

/**
 * The children under 18 the member is a parent or guardian of, and how many
 * changes each has had since they last looked. The database answers for the
 * caller only, so anyone else gets nobody.
 */
export function useMyChildren(enabled: boolean) {
  const [children, setChildren] = useState<MyChild[]>([]);
  const [activityNew, setActivityNew] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  const reloadChildren = useCallback(async () => {
    if (!enabled) return;
    const [{ data }, activity] = await Promise.all([
      supabase.rpc('my_child_consents'),
      supabase.rpc('child_activity_new'),
    ]);
    const counts: Record<string, number> = {};
    for (const row of (activity.data as { athlete_id: string; new_count: number }[] | null) ?? []) {
      counts[row.athlete_id] = row.new_count;
    }
    setActivityNew(counts);
    setChildren(((data as ChildConsent[] | null) ?? []).map(toMyChild));
    setLoaded(true);
  }, [enabled]);

  useFocusEffect(
    useCallback(() => {
      reloadChildren();
    }, [reloadChildren]),
  );

  return { children, activityNew, loaded, reloadChildren };
}

/** What the app already knows about a child that their parent may see. */
export type ChildFacts = {
  /** Changes around the child since their parent last looked. */
  newActivity: number;
  /** Current injuries the parent can see, for any of their children. */
  injuries: Pick<Injury, 'athlete_id' | 'waiting_for_me'>[];
  /** Medical details that need adding or their yearly check, for any of their children. */
  medicalReviews: Pick<MedicalReview, 'athlete_id' | 'status' | 'due_on'>[];
  /** This child's sessions in the last four weeks, on their own page. */
  attendance?: { present: boolean }[] | null;
};

export type ChildStatusLine = {
  key: 'consent' | 'injuries' | 'medical' | 'changes';
  text: string;
  /** Something for the parent to do or look at, shown in the club's colour. */
  attention: boolean;
};

function medicalLine(review: Pick<MedicalReview, 'status' | 'due_on'>) {
  return review.status === 'missing' || !review.due_on
    ? 'Medical details to add'
    : `Medical details to check by ${formatDateString(review.due_on)}`;
}

export function changesLabel(count: number) {
  return count === 1 ? '1 change since you last looked' : `${count} changes since you last looked`;
}

/**
 * The lines on a child's card in Family: consent first, then only what has
 * something to say (a current injury, medical details to add or check,
 * changes since the parent last looked).
 */
export function childStatus(child: MyChild, facts: ChildFacts): ChildStatusLine[] {
  const lines: ChildStatusLine[] = [
    { key: 'consent', text: consentSummary(child), attention: child.needsConsent },
  ];
  const injuries = facts.injuries.filter((i) => i.athlete_id === child.id);
  if (injuries.length > 0) {
    lines.push({ key: 'injuries', text: injuriesSummary(injuries), attention: true });
  }
  const review = facts.medicalReviews.find((r) => r.athlete_id === child.id);
  if (review) lines.push({ key: 'medical', text: medicalLine(review), attention: true });
  if (facts.newActivity > 0) {
    lines.push({ key: 'changes', text: changesLabel(facts.newActivity), attention: true });
  }
  return lines;
}

/** One thing a parent opens for a child. */
export type ChildLink = {
  key:
    | 'attendance'
    | 'goals'
    | 'checkIns'
    | 'injuries'
    | 'consent'
    | 'medical'
    | 'changes'
    | 'records';
  icon: IconName;
  title: string;
  detail: string;
  attention: boolean;
  badge: number;
  href: Href;
};

/**
 * Everything a parent or guardian opens for one child, always in the same
 * order: day to day first (attendance, game goals, check-ins, injuries), then what the
 * parent decides and keeps (consent, medical details), then who has been near
 * the child's records. A feature the club has switched off is left out, and
 * medical details and record views are for verified parents, as before.
 */
export function childLinks(
  child: MyChild,
  {
    features,
    injuries,
    verified,
    facts,
  }: {
    features: { goals: boolean; attendance: boolean; checkIns: boolean };
    /** Injuries is switched on and the parent may open the injuries list. */
    injuries: boolean;
    /** A club admin has verified the parent. */
    verified: boolean;
    facts: ChildFacts;
  },
): ChildLink[] {
  const { id, name } = child;
  const review = facts.medicalReviews.find((r) => r.athlete_id === id);
  const current = facts.injuries.filter((i) => i.athlete_id === id);
  const links: (ChildLink | false)[] = [
    features.attendance && {
      key: 'attendance',
      icon: 'clipboard',
      title: 'Attendance',
      detail: attendanceCountLabel(facts.attendance) ?? 'Their sessions and absences',
      attention: false,
      badge: 0,
      href: { pathname: '/attendance/family/[id]', params: { id, name } },
    },
    // Guardians aren't in a squad, so their athletes' game goals open from here.
    features.goals && {
      key: 'goals',
      icon: 'target',
      title: 'Game goals',
      detail: 'Goals and reflections',
      attention: false,
      badge: 0,
      href: { pathname: '/goals/athlete/[id]', params: { id, name, view: 'guardian' } },
    },
    features.checkIns && {
      key: 'checkIns',
      icon: 'activity',
      title: 'Check-ins',
      detail: 'Check-ins and notes, last four weeks',
      attention: false,
      badge: 0,
      href: { pathname: '/check-ins/athlete/[id]', params: { id, name } },
    },
    injuries && {
      key: 'injuries',
      icon: 'plus-circle',
      title: 'Injuries',
      detail: injuriesSummary(current),
      attention: current.length > 0,
      badge: current.filter((i) => i.waiting_for_me).length,
      href: '/injuries',
    },
    {
      key: 'consent',
      icon: 'check-square',
      title: 'Consent',
      detail: consentSummary(child),
      attention: child.needsConsent,
      badge: 0,
      href: { pathname: '/consent/[id]', params: { id } },
    },
    verified && {
      key: 'medical',
      icon: 'heart',
      title: 'Medical and emergency',
      detail: review ? medicalLine(review) : 'Emergency contacts and medical details',
      attention: !!review,
      badge: 0,
      href: { pathname: '/medical/[id]', params: { id } },
    },
    {
      key: 'changes',
      icon: 'clock',
      title: 'What’s changed',
      detail:
        facts.newActivity > 0
          ? changesLabel(facts.newActivity)
          : 'People around them, consents and shared documents',
      attention: false,
      badge: facts.newActivity,
      href: { pathname: '/activity/[id]', params: { id, name } },
    },
    verified && {
      key: 'records',
      icon: 'eye',
      title: 'Who has viewed their records',
      detail: 'Everyone at the club who opened them',
      attention: false,
      badge: 0,
      href: { pathname: '/records/[id]', params: { id, name } },
    },
  ];
  return links.filter((l): l is ChildLink => l !== false);
}
