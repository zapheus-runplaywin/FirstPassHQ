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

  const reload = useCallback(
    () =>
      supabase
        .from('teams')
        .select(TEAM_COLUMNS)
        .eq('archived', false)
        .order('season', { ascending: false })
        .order('sort_order')
        .order('name')
        .then(({ data }) => setTeams((data as Team[] | null) ?? [])),
    [],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { teams, reload };
}

export function squadsOf(teams: Team[]) {
  return teams.filter((t) => t.kind === 'squad');
}

export function teamsIn(teams: Team[], squadId: string) {
  return teams.filter((t) => t.squad_id === squadId);
}
