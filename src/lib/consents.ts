import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** The club's policy links. Anyone can read them, signed in or not. */
export type ClubPolicies = {
  privacy_policy_url: string | null;
  safeguarding_policy_url: string | null;
  code_of_conduct_url: string | null;
  policy_version: string;
};

/** A guardian's child under 18 and the consents in force for them. */
export type ChildConsent = {
  athlete_id: string;
  full_name: string | null;
  data: boolean;
  health: boolean;
  /** Whether live streams may name them with their own game stats. */
  publish: boolean;
  /** False until the guardian's identity has been verified. */
  can_consent: boolean;
  /**
   * Whether Daily check-ins is on for the child. Check-in consent is asked for
   * only while it is; a consent already given is kept while it's off.
   */
  check_ins_on?: boolean;
  /** Whether the parent still has a consent to give, worked out by the database. */
  needs_consent?: boolean;
  /** Whether Live streams is on for the child. The stream stats question shows only while it is. */
  streams_on?: boolean;
};

export type ConsentKind = 'data' | 'health' | 'publish';

export type ConsentRecord = {
  kind: ConsentKind;
  given_by_name: string | null;
  policy_version: string;
  given_at: string;
  withdrawn_at: string | null;
  withdrawn_by_name: string | null;
};

/** What each consent covers, in the words shown to parents. */
export const consentText: Record<ConsentKind, { title: string; detail: string }> = {
  data: {
    title: 'Daily check-ins',
    detail:
      'Your child’s answers about sleep, soreness, stress and mood, any note they write, and the training sessions they log (minutes and how hard each felt), are seen by their coaches. When they score low, the club’s Child Safety Officer sees the day and the lowest score, never their answers or note. Without this, neither sees their check-ins or sessions at all.',
  },
  health: {
    title: 'Injuries and health information',
    detail:
      'Their injuries, restrictions, physio updates and the letters or reports you attach are seen by their coaches, the physios who look after them and the committee members cleared to work with children, who sign off clearances. The medical and emergency details you keep for them (emergency contacts, allergies, conditions, medications and an action plan) are seen by their coaches, managers and physios, and you see each time one of them opens them. Without this, none of them see your child’s injuries or medical details, and an injury can’t be cleared to play, because a coach or physio has to endorse the clearance first. Either way, whoever takes attendance sees that your child is injured and when they’re expected back, and nothing more.',
  },
  publish: {
    title: 'Stats on live streams',
    detail:
      'When the club’s games are streamed with FirstPass Studio, your child can be named with their own game stats, such as goals, intercepts or Net Points, on screen and by the commentators. Without this, streams show only team totals, never your child’s own stats. Their name can still be in the team list, as it is on PlayHQ.',
  },
};

export const consentKindLabels: Record<ConsentKind, string> = {
  data: 'Daily check-ins',
  health: 'Injuries and health information',
  publish: 'Stats on live streams',
};

/** The club's policy links, or null until they've loaded. */
export function useClubPolicies() {
  const [policies, setPolicies] = useState<ClubPolicies | null>(null);
  useEffect(() => {
    supabase
      .rpc('club_policies')
      .maybeSingle()
      .then(({ data }) => setPolicies((data as ClubPolicies | null) ?? null));
  }, []);
  return policies;
}

/**
 * Whether check-in consent is asked for this child: only while Daily
 * check-ins is on for them. Before the database says, it is asked as before.
 */
export function asksCheckIns(child: Pick<ChildConsent, 'check_ins_on'>) {
  return child.check_ins_on !== false;
}

/**
 * The consents a parent is shown for a child: check-ins only while Daily
 * check-ins is on, stream stats only while Live streams is on, and injuries
 * always (medical details have no switch). A consent already given stays
 * shown while its feature is off, so it can still be withdrawn.
 */
export function consentKindsShown(
  child: Pick<ChildConsent, 'data' | 'publish' | 'check_ins_on' | 'streams_on'>,
): ConsentKind[] {
  return (['data', 'health', 'publish'] as const).filter(
    (kind) =>
      (kind === 'data' && (asksCheckIns(child) || child.data)) ||
      kind === 'health' ||
      (kind === 'publish' && (child.streams_on !== false || child.publish)),
  );
}

/**
 * Whether the parent still has a consent to give for this child. Health
 * consent is always asked (it covers medical and emergency details, which have
 * no switch); check-in consent only while Daily check-ins is on.
 */
export function needsConsent(
  child: Pick<ChildConsent, 'can_consent' | 'data' | 'health' | 'check_ins_on' | 'needs_consent'>,
) {
  if (typeof child.needs_consent === 'boolean') return child.needs_consent;
  return child.can_consent && (!child.health || (asksCheckIns(child) && !child.data));
}

/** Consents a guardian still needs to give, for the to-do list. */
export function consentsNeeded(children: ChildConsent[]) {
  return children.filter(needsConsent);
}

/** The "Give consent" to-do's second line: what the parent is still asked. */
export function consentTodoDetail(child: Pick<ChildConsent, 'data' | 'health' | 'check_ins_on'>) {
  const checkIns = asksCheckIns(child) && !child.data;
  if (checkIns && !child.health) return 'Choose who sees their check-ins and injury details';
  if (checkIns) return 'Choose who sees their check-ins';
  return 'Choose who sees their injury and medical details';
}
