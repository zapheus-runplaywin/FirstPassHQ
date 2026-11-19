import type { Team, TeamRole } from '@/lib/types';

/**
 * An athlete is in one current squad and one current team a season (Matt,
 * 20 November 2026; the database refuses anything else). After an athlete is
 * placed in `groupId`, this takes them out of the season's other groups of
 * the same kind, and out of the teams of any squad they leave. Coaches,
 * managers and physios may be in several, so their places are kept.
 */
export function leaveOtherGroups<P extends { team_role: TeamRole }>(
  placements: Record<string, P>,
  teams: Team[],
  groupId: string,
): Record<string, P> {
  const group = teams.find((t) => t.id === groupId);
  if (!group || placements[groupId]?.team_role !== 'athlete') return placements;
  const next = { ...placements };
  for (const other of teams) {
    if (
      other.id !== groupId &&
      other.id in next &&
      other.kind === group.kind &&
      other.season === group.season &&
      next[other.id].team_role === 'athlete'
    ) {
      delete next[other.id];
      // Leaving a squad also takes them out of its teams.
      for (const t of teams) {
        if (t.squad_id === other.id && t.id !== groupId) delete next[t.id];
      }
    }
  }
  return next;
}
