import { isMinor } from '@/lib/age';
import type { AppRole } from '@/lib/types';

type HasRoles = { role: AppRole; extra_roles?: AppRole[] | null };

/** Every role a member holds, their main role first. */
export function rolesOf(member: HasRoles): AppRole[] {
  return [...new Set([member.role, ...(member.extra_roles ?? [])])];
}

/** Whether a member holds any of these roles. */
export function hasRole(member: HasRoles | null | undefined, ...roles: AppRole[]) {
  return !!member && rolesOf(member).some((r) => roles.includes(r));
}

/**
 * Why a set of roles can't go together, or null when they can. Same rules as
 * `public.role_combination_problem` in the database.
 */
export function roleCombinationProblem(
  roles: AppRole[],
  dateOfBirth: string | null | undefined,
  under18: boolean,
): string | null {
  roles = [...new Set(roles)];
  const has = (r: AppRole) => roles.includes(r);
  if (has('guest') && roles.length > 1) return 'Guests can’t have another role.';
  if (has('volunteer') && roles.length > 1) return 'Temporary helpers can’t have another role.';
  if (has('admin') && has('athlete')) return 'Admins can’t also be athletes.';
  if (has('athlete') && has('manager')) return 'Athletes can’t also be managers.';
  if (has('athlete') && has('physio')) return 'Athletes can’t also be physios.';
  if (
    has('athlete') &&
    isMinor(dateOfBirth ?? null, under18) &&
    roles.some((r) => r !== 'athlete' && r !== 'coach')
  ) {
    return 'Athletes under 18 can only also be a coach.';
  }
  if (has('guardian') && isMinor(dateOfBirth ?? null, under18)) {
    return 'Parents and guardians must be 18 or over.';
  }
  return null;
}
