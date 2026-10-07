import { useAuth } from '@/lib/auth';
import type { AttendanceMark } from '@/lib/types';

/**
 * Coaches and managers take attendance for their squads and teams. Any coach,
 * manager, committee member or admin can take it for a whole squad or the club.
 */
export function useCanTakeAttendance() {
  const { memberships, profile } = useAuth();
  if (profile?.status !== 'approved') return false;
  return (
    ['coach', 'manager', 'committee', 'admin'].includes(profile.role) ||
    memberships.some((m) => m.team_role === 'coach' || m.team_role === 'manager')
  );
}

/** Coaches, the committee and admins can see athletes' attendance records. */
export function useCanViewAttendance() {
  const { memberships, profile } = useAuth();
  if (profile?.status !== 'approved') return false;
  return (
    profile.role === 'committee' ||
    profile.role === 'admin' ||
    memberships.some((m) => m.team_role === 'coach')
  );
}

/** Such as "12 of 15 present". */
export function presentLabel(present: number, total: number) {
  return `${present} of ${total} present`;
}

/** Such as "80%", or an empty string when there's nothing to count. */
export function percent(present: number, total: number) {
  return total === 0 ? '' : `${Math.round((present / total) * 100)}%`;
}

/** The marks to save: only athletes who have been marked. */
export function marksToSave(register: AttendanceMark[]) {
  return register
    .filter((m) => m.present !== null)
    .map((m) => ({ profile_id: m.profile_id, present: m.present }));
}
