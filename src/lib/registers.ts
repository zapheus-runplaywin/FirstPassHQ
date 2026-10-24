import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/club';
import { hasRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';

/** A policy on the club's policy register (customer review R9). */
export type RegisterPolicy = {
  id: string;
  title: string;
  owner_id: string | null;
  owner_name: string | null;
  version: string | null;
  link: string | null;
  /** The next review, "2027-03-01" style. */
  review_on: string;
  notes: string | null;
  last_reviewed_at: string | null;
  last_reviewed_by_name: string | null;
  updated_at: string;
};

/** A policy whose review falls to the signed-in member within 30 days. */
export type PolicyReview = { id: string; title: string; review_on: string };

/** One person on a season's conflict-of-interest register. */
export type ConflictRow = {
  profile_id: string;
  name: string | null;
  roles: AppRole[];
  declared: boolean;
  has_conflict: boolean | null;
  details: string | null;
  declared_at: string | null;
  /** The admin who last changed it, if one did. */
  changed_by_name: string | null;
};

/** The signed-in member's declaration for this season. */
export type MyConflictDeclaration = {
  required: boolean;
  season: number;
  has_conflict: boolean | null;
  details: string | null;
  declared_at: string | null;
};

/** Owners are told this many days before a policy's review. */
export const REVIEW_NOTICE_DAYS = 30;

/** Roles that can own a policy (the database's can_own_policy, with an adult check). */
const OWNER_ROLES: AppRole[] = ['admin', 'committee', 'coach', 'manager', 'physio', 'statistician'];

/** Whether a member could own a policy: an approved, adult club official. */
export function canOwnPolicy(p: { status: string; role: AppRole; extra_roles: AppRole[]; stood_down_at: string | null }) {
  return p.status === 'approved' && !p.stood_down_at && hasRole(p, ...OWNER_ROLES);
}

/** The committee and admins read both registers. */
export function useCanReadRegisters() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && hasRole(profile, 'committee', 'admin');
}

/** Committee members and coaches declare conflicts of interest each season. */
export function useDeclaresConflicts() {
  const { profile, memberships } = useAuth();
  if (profile?.status !== 'approved') return false;
  return hasRole(profile, 'committee', 'coach') || memberships.some((m) => m.team_role === 'coach');
}

/** Whether a policy's review is overdue, due within 30 days, or later. */
export function reviewState(reviewOn: string, today: string): 'overdue' | 'due' | 'later' {
  if (reviewOn < today) return 'overdue';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + REVIEW_NOTICE_DAYS);
  return reviewOn <= soon.toISOString().slice(0, 10) ? 'due' : 'later';
}

/** A year after a "2026-10-23" style date, the suggested next review. */
export function aYearOn(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

/** Whether a link is a web address the database accepts, or empty. */
export function linkProblem(link: string) {
  const v = link.trim();
  if (!v) return null;
  return /^https?:\/\/\S+$/i.test(v) ? null : 'The link must start with https://';
}

/** Policies the member owns that are due for review, for their to-do list. */
export function useMyPolicyReviews() {
  const on = useFeature('registers');
  const { profile } = useAuth();
  const eligible = on && !!profile && canOwnPolicy(profile);
  const [reviews, setReviews] = useState<PolicyReview[]>([]);
  const load = useCallback(async () => {
    if (!eligible) return;
    const { data } = await supabase.rpc('my_policy_reviews');
    setReviews((data as PolicyReview[] | null) ?? []);
  }, [eligible]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { policyReviews: eligible ? reviews : [], reloadPolicyReviews: load };
}

/** The member's declaration this season, if they're asked to make one. */
export function useMyConflictDeclaration() {
  const on = useFeature('registers');
  const declares = useDeclaresConflicts();
  const eligible = on && declares;
  const [declaration, setDeclaration] = useState<MyConflictDeclaration | null>(null);
  const load = useCallback(async () => {
    if (!eligible) return;
    const { data } = await supabase.rpc('my_conflict_declaration').maybeSingle();
    setDeclaration((data as MyConflictDeclaration | null) ?? null);
  }, [eligible]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { conflictDeclaration: eligible ? declaration : null, reloadConflictDeclaration: load };
}
