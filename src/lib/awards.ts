import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { parseDateString, toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Award, AwardNominees, AwardSlot, AwardVoterRole } from '@/lib/types';

export const AWARD_COLUMNS =
  'id, season, name, description, closes_at, club_wide, per_group, voter_roles, nominees, points, by_match, match_vote_hours, preseason_weight, preseason_closes_at, annual, copied_from, award_groups (team_id), award_candidates (id, name)';

export const voterRoleOptions: { value: AwardVoterRole; label: string }[] = [
  { value: 'athlete', label: 'Athletes' },
  { value: 'coach', label: 'Coaches' },
  { value: 'manager', label: 'Managers' },
  { value: 'guardian', label: 'Guardians' },
  { value: 'committee', label: 'Committee' },
  { value: 'admin', label: 'Admins' },
  { value: 'member', label: 'Every member' },
];

export const nomineeOptions: { value: AwardNominees; label: string }[] = [
  { value: 'athletes', label: 'Athletes' },
  { value: 'coaches', label: 'Coaches' },
  { value: 'members', label: 'Any member' },
  { value: 'listed', label: 'Names I list' },
];

export const ballotOptions = [
  { value: '1', label: 'One vote' },
  { value: '3,2,1', label: '3-2-1 votes' },
  { value: '5,4,3,2,1', label: '5-4-3-2-1 votes' },
];

/** "3-2-1 votes", or "1 vote". */
export function ballotLabel(points: number[]) {
  return points.length === 1 ? 'One vote' : `${points.join('-')} votes`;
}

/** Who votes and for whom, in a line. */
export function awardSummary(award: Award, groupNames: string[]) {
  const voters = award.voter_roles.includes('member')
    ? 'Every member'
    : award.voter_roles
        .map((r) => voterRoleOptions.find((o) => o.value === r)?.label ?? r)
        .join(', ');
  const where = award.club_wide
    ? 'across the club'
    : `in ${groupNames.join(', ') || 'no groups yet'}`;
  const nominees = {
    athletes: 'athletes',
    coaches: 'coaches',
    members: 'any member',
    listed: 'listed names',
  }[award.nominees];
  const parts = [`${voters} ${where} vote for ${nominees}`, ballotLabel(award.points)];
  if (award.per_group) parts.push('a winner for each');
  if (award.by_match) parts.push('after every match');
  if (award.preseason_weight > 0) parts.push(`preseason ${award.preseason_weight}%`);
  return parts.join(' · ');
}

/** What a vote is for: "Coach MVP · Open A · Round 3 v Rockets". */
export function slotTitle(slot: Pick<AwardSlot, 'team_name' | 'fixture_label' | 'preseason'>) {
  return [slot.team_name, slot.preseason ? 'Preseason' : slot.fixture_label]
    .filter(Boolean)
    .join(' · ');
}

export function closesLabel(closesAt: string) {
  const date = new Date(closesAt);
  return `${date.getTime() < Date.now() ? 'Closed' : 'Closes'} ${formatDateTime(date)}`;
}

/** The end of a "2026-10-07" day, local time, as an ISO string. */
export function endOfDay(day: string) {
  const date = parseDateString(day);
  date.setHours(23, 59, 0, 0);
  return date.toISOString();
}

/** The local day of an ISO time, as "2026-10-07". */
export function dayOf(iso: string) {
  return toDateString(new Date(iso));
}

/** The votes open to the signed-in member right now. */
export function useAwardSlots() {
  const { profile } = useAuth();
  const approved = profile?.status === 'approved';
  const [awardSlots, setAwardSlots] = useState<AwardSlot[]>([]);

  const reloadAwardSlots = useCallback(async () => {
    if (!approved) return;
    const { data } = await supabase.rpc('award_slots');
    setAwardSlots((data as AwardSlot[] | null) ?? []);
  }, [approved]);

  useFocusEffect(
    useCallback(() => {
      reloadAwardSlots();
    }, [reloadAwardSlots]),
  );

  return { awardSlots, reloadAwardSlots };
}
