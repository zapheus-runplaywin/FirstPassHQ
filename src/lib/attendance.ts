import { useAuth } from '@/lib/auth';
import type { AttendanceMark } from '@/lib/types';
import { hasRole } from '@/lib/roles';

/**
 * Coaches and managers take attendance for their squads and teams. Any coach,
 * manager, committee member or admin can take it for a whole squad or the club.
 */
export function useCanTakeAttendance() {
  const { memberships, profile } = useAuth();
  if (profile?.status !== 'approved') return false;
  return (
    hasRole(profile, 'coach', 'manager', 'committee', 'admin') ||
    memberships.some((m) => m.team_role === 'coach' || m.team_role === 'manager')
  );
}

/** Coaches, the committee and admins can see athletes' attendance records. */
export function useCanViewAttendance() {
  const { memberships, profile } = useAuth();
  if (profile?.status !== 'approved') return false;
  return (
    hasRole(profile, 'committee', 'admin') ||
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

/**
 * A new register with reported absences filled in: an athlete nobody has
 * marked yet, who was reported away for the day, starts as Absent. A mark the
 * person taking attendance made always stands, so an athlete who turned up
 * after all is one tap on Present.
 */
export function withReportedAbsences(register: AttendanceMark[], reportedAway: string[]) {
  const away = new Set(reportedAway);
  return register.map((m) =>
    m.present === null && away.has(m.profile_id) ? { ...m, present: false } : m,
  );
}

/** Who in the register was marked Absent from a reported absence, not by hand. */
export function filledFromAbsences(register: AttendanceMark[], reportedAway: string[]) {
  const away = new Set(reportedAway);
  return register.filter((m) => m.present === null && away.has(m.profile_id)).map((m) => m.profile_id);
}

/** How far back a card's attendance count looks. */
export const CARD_ATTENDANCE_WEEKS = 4;

/**
 * Where an athlete's attendance stands, for the card that opens it:
 * "At 11 of 12 sessions in 4 weeks". Null with no sessions to count, so the
 * card says what it opens instead.
 */
export function attendanceCountLabel(sessions: { present: boolean }[] | null | undefined) {
  if (!sessions || sessions.length === 0) return null;
  const present = sessions.filter((s) => s.present).length;
  const total = sessions.length;
  return `At ${present} of ${total} ${total === 1 ? 'session' : 'sessions'} in ${CARD_ATTENDANCE_WEEKS} weeks`;
}
