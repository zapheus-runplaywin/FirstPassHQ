/**
 * Everyone in a squad or team with their position, for its page and for the
 * Team tab. The database answers only for the group's own members and admins
 * (team_roster), and gives names and positions: no photos and no profiles.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { captainRoleLabels, teamPositionLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { CaptainRole, GroupCaptain, RosterEntry, Team } from '@/lib/types';

export function useTeamRoster(id: string | undefined, team: Pick<Team, 'kind' | 'season'> | undefined) {
  const [loaded, setLoaded] = useState<{ id: string; roster: RosterEntry[] } | null>(null);
  const [captains, setCaptains] = useState<Map<string, CaptainRole>>(new Map());
  const [clubCaptains, setClubCaptains] = useState<Set<string>>(new Set());
  const season = team?.season;
  const kind = team?.kind;

  const load = useCallback(async () => {
    if (!id) return;
    const [rosterResult, captainResult, clubResult] = await Promise.all([
      supabase.rpc('team_roster', { p_team_id: id }),
      supabase.from('team_captains').select('team_id, profile_id, captain_role').eq('team_id', id),
      season === undefined
        ? Promise.resolve({ data: [] })
        : supabase.from('club_captains').select('profile_id').eq('season', season),
    ]);
    setLoaded({ id, roster: (rosterResult.data as RosterEntry[] | null) ?? [] });
    // Only a team's captains count; a squad captaincy chosen before
    // 20 November 2026 isn't shown.
    const captainRows = kind === 'team' ? (captainResult.data as GroupCaptain[] | null) : [];
    setCaptains(new Map((captainRows ?? []).map((c) => [c.profile_id, c.captain_role])));
    setClubCaptains(
      new Set(
        ((clubResult.data as { profile_id: string }[] | null) ?? []).map((c) => c.profile_id),
      ),
    );
  }, [id, season, kind]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /** Such as "Final team athlete · Captain". */
  function positionLabel(member: RosterEntry) {
    const parts = [teamPositionLabel(member.team_role, member.coach_title, member.selection)];
    if (member.team_role === 'athlete') {
      const captainRole = captains.get(member.profile_id);
      if (captainRole) parts.push(captainRoleLabels[captainRole]);
      if (clubCaptains.has(member.profile_id)) parts.push('Club captain');
    }
    return parts.join(' · ');
  }

  return {
    /** Null until this group's people have loaded, so another group's never show under its name. */
    roster: loaded && loaded.id === id ? loaded.roster : null,
    positionLabel,
    reloadRoster: load,
  };
}
