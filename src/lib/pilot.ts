import type { FeatureKey } from '@/lib/club';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';

/**
 * Team pilot (Club settings): a feature that's on can show for everyone or
 * only for the squads and teams in the pilot. The database works out what
 * each member sees (club_profile), so the rest of the app needs nothing from
 * here: only the Club settings screen reads and saves the pilot.
 */
export type Audience = 'everyone' | 'pilot';

export const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'pilot', label: 'Pilot teams only' },
];

export type PilotSettings = { features: FeatureKey[]; teamIds: string[] };

export const NO_PILOT: PilotSettings = { features: [], teamIds: [] };

/** The pilot as saved. Admins only; anyone else gets no pilot. */
export async function loadPilot(): Promise<PilotSettings> {
  const { data, error } = await supabase.rpc('admin_pilot_settings');
  if (error || !data) return NO_PILOT;
  const row = (
    data as {
      pilot_features: string[] | null;
      pilot_team_ids: string[] | null;
    }[]
  )[0];
  return {
    features: (row?.pilot_features ?? []) as FeatureKey[],
    teamIds: row?.pilot_team_ids ?? [],
  };
}

/**
 * The pilot-only features to save: only those switched on, since a feature
 * that's off is off for everyone, pilot or not.
 */
export function pilotFeaturesToSave(
  features: Record<FeatureKey, boolean>,
  pilotOnly: FeatureKey[],
): FeatureKey[] {
  return pilotOnly.filter((key) => features[key]);
}

export async function savePilot(features: FeatureKey[], teamIds: string[]) {
  const { error } = await supabase.rpc('admin_set_pilot', {
    p_features: features,
    p_team_ids: teamIds,
  });
  return error ? error.message : null;
}

/** Squads and teams an admin can put in the pilot, squads before their teams. */
export function pilotGroupOptions(teams: Team[]) {
  const ordered: Team[] = [];
  for (const group of teams.filter((t) => !t.squad_id)) {
    ordered.push(group, ...teams.filter((t) => t.squad_id === group.id));
  }
  // A team whose squad isn't listed (an older season's squad) still shows.
  for (const t of teams) if (!ordered.includes(t)) ordered.push(t);
  return ordered.map((t) => ({
    value: t.id,
    label: t.squad_id ? `${t.name} (team)` : t.kind === 'squad' ? `${t.name} (squad)` : t.name,
  }));
}

/** What the admin is told about the pilot as it stands on the form. */
export function pilotSummary(pilotFeatures: FeatureKey[], teamIds: string[]) {
  if (pilotFeatures.length === 0) return null;
  if (teamIds.length === 0) {
    return 'No squads or teams are in the pilot yet, so features for pilot teams only show just for admins and committee.';
  }
  return 'Features for pilot teams only show for members of these squads and teams, parents of their athletes, admins and committee. Everyone else doesn’t see them at all.';
}
