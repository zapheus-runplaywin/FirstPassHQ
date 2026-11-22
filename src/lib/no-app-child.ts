import { isMinor, parseDate } from '@/lib/age';
import { clubToday } from '@/lib/club-time';
import type { Team } from '@/lib/types';

/**
 * Athletes who never sign in: a child with no phone, or who won't use the
 * app, run by their parent or guardian. A parent asks for one; only an admin
 * adds one, linked to that verified parent (20261120000000_no_sign_in_athletes).
 */

/** A parent's request waiting for an admin, as my_no_app_child_requests returns it. */
export type MyNoAppChildRequest = {
  id: string;
  full_name: string;
  date_of_birth: string;
  team_name: string | null;
  requested_at: string;
};

/** A request as an admin sees it (admin_no_app_child_requests). */
export type NoAppChildRequest = {
  id: string;
  guardian_id: string;
  full_name: string;
  date_of_birth: string;
  team_id: string | null;
  team_name: string | null;
  requested_at: string;
};

/** The label shown beside a no-app child's name on lists and registers. */
export const noAppLabel = 'No app';

/** Beside a name, when the member has no sign-in. */
export function withNoAppLabel(name: string, noSignIn: boolean | null | undefined) {
  return noSignIn ? `${name} · ${noAppLabel}` : name;
}

/**
 * What's wrong with a child's details, before they're sent, or null. The
 * database checks again and has the final say.
 */
export function childDetailsProblem(name: string, dateOfBirth: string) {
  if (!name.trim()) return 'Enter the child’s name.';
  if (name.trim().length > 80) return 'Keep the child’s name to 80 characters.';
  const dob = parseDate(dateOfBirth);
  if (!dob) return 'Enter the child’s date of birth as DD/MM/YYYY.';
  if (dob > clubToday()) return 'That date of birth is in the future.';
  if (!isMinor(dob, false)) {
    return 'Only children under 18 can be added without their own sign-in. At 18 they join with their own account.';
  }
  return null;
}

/** The squads and teams of the newest season, squads first, each squad's teams after it. */
export function newestSeasonGroups(teams: Team[]) {
  if (teams.length === 0) return [];
  const newest = Math.max(...teams.map((t) => t.season));
  const season = teams.filter((t) => t.season === newest);
  const byOrder = (a: Team, b: Team) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  const tops = season.filter((t) => !t.squad_id).sort(byOrder);
  return tops.flatMap((top) => [top, ...season.filter((t) => t.squad_id === top.id).sort(byOrder)]);
}

