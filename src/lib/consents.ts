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
  /** False until the guardian's identity has been verified. */
  can_consent: boolean;
};

export type ConsentKind = 'data' | 'health';

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
};

export const consentKindLabels: Record<ConsentKind, string> = {
  data: 'Daily check-ins',
  health: 'Injuries and health information',
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

/** Consents a guardian still needs to give, for the to-do list. */
export function consentsNeeded(children: ChildConsent[]) {
  return children.filter((c) => c.can_consent && (!c.data || !c.health));
}
