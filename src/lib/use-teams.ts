import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';

export const TEAM_COLUMNS = 'id, name, sort_order, kind, season, squad_id, selections_completed_at';

/** This season's squads and teams (archived seasons are left out). */
export function useTeams() {
  return useTeamList().teams;
}

/** Same as useTeams, with a way to load them again after a change. */
export function useTeamList() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(
    () =>
      supabase
        .from('teams')
        .select(TEAM_COLUMNS)
        .eq('archived', false)
        .order('season', { ascending: false })
        .order('sort_order')
        .order('name')
        .then(({ data }) => {
          setTeams((data as Team[] | null) ?? []);
          setLoaded(true);
        }),
    [],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { teams, loaded, reload };
}

export function squadsOf(teams: Team[]) {
  return teams.filter((t) => t.kind === 'squad');
}

/**
 * Squads, and teams that don't belong to one (clubs without squads select
 * straight into teams). These are what members join and what each new season
 * copies.
 */
export function topGroups(teams: Team[]) {
  return teams.filter((t) => !t.squad_id);
}

export function teamsIn(teams: Team[], squadId: string) {
  return teams.filter((t) => t.squad_id === squadId);
}

/** The club year runs May to May, so season 2026 is shown as 2026–27. */
export function seasonLabel(season: number) {
  return `${season}–${String((season + 1) % 100).padStart(2, '0')}`;
}

/**
 * A squad or team's name, with its season when another current group has the
 * same name (while last season runs alongside the new one).
 */
export function teamLabel(team: Team, teams: Team[]) {
  const repeated = teams.some((t) => t.id !== team.id && t.name === team.name);
  return repeated ? `${team.name} (${seasonLabel(team.season)})` : team.name;
}

/** The newest season's squads (or teams, without squads), which new members join. */
export function newestGroups(teams: Team[]) {
  const groups = topGroups(teams);
  const newest = Math.max(...groups.map((s) => s.season));
  return groups.filter((s) => s.season === newest);
}
