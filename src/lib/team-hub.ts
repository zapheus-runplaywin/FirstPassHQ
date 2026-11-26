/**
 * The Team tab for coaches, managers and physios: which readiness tile comes
 * first for each of them, what each tile's number is, and what a squad or
 * team's list of people says beside each name.
 *
 * Nothing here decides who may see anything. The numbers come from questions
 * the database already answers for the member (their athletes' check-ins,
 * attendance and injuries), and a status only shows beside a name when the
 * database gave this member that athlete's injury.
 */
import type { HomeCard } from '@/lib/home-layout';
import type {
  AthleteAttendanceSummary,
  Injury,
  RosterEntry,
  TeamMembership,
  TeamRole,
} from '@/lib/types';

/** The tiles that say how ready a coach's athletes are. */
export const READINESS_CARDS: HomeCard[] = ['checkIns', 'attendance', 'injuries'];

/** What someone mostly does for their squads and teams. */
export type StaffKind = 'coach' | 'physio' | 'manager';

const STAFF_KINDS: StaffKind[] = ['coach', 'physio', 'manager'];

/**
 * A coach first, then a physio, then a manager: someone who coaches one team
 * and manages another sees the coach's Team tab.
 */
export function staffKind(
  roles: string[],
  memberships: Pick<TeamMembership, 'team_role'>[],
): StaffKind | null {
  const held = new Set<string>([...roles, ...memberships.map((m) => m.team_role)]);
  return STAFF_KINDS.find((kind) => held.has(kind)) ?? null;
}

/**
 * The order of the readiness tiles. A coach has check-ins, then attendance,
 * then injuries (Matt, 12 November 2026); a physio starts with injuries and a
 * manager with attendance.
 */
const ORDER: Record<StaffKind, HomeCard[]> = {
  coach: ['checkIns', 'attendance', 'injuries'],
  physio: ['injuries', 'checkIns', 'attendance'],
  manager: ['attendance', 'injuries', 'checkIns'],
};

/** The readiness tiles this member has, in their order. */
export function readinessTiles(cards: HomeCard[], kind: StaffKind | null): HomeCard[] {
  return ORDER[kind ?? 'coach'].filter((card) => cards.includes(card));
}

/** Attendance across the athletes the member can see, such as "88%". Null with no sessions. */
export function attendanceRate(
  athletes: Pick<AthleteAttendanceSummary, 'session_count' | 'present_count'>[] | null,
): string | null {
  if (!athletes) return null;
  const sessions = athletes.reduce((n, a) => n + a.session_count, 0);
  const present = athletes.reduce((n, a) => n + a.present_count, 0);
  return sessions === 0 ? null : `${Math.round((present / sessions) * 100)}%`;
}

/** Such as "2 new absences", for the attendance tile. */
export function absencesLabel(count: number) {
  return `${count} new or changed ${count === 1 ? 'absence' : 'absences'}`;
}

/** What a list of people says beside an athlete with an open injury. */
export type RosterStatus = {
  label: string;
  /** The injury it opens. */
  injuryId: string;
};

type OpenInjury = Pick<Injury, 'id' | 'athlete_id' | 'status' | 'waiting_for_me'>;

/** Most pressing first: one waiting on the member, then injured, then clearance asked for. */
function injuryRank(injury: OpenInjury) {
  if (injury.waiting_for_me) return 0;
  return injury.status === 'injured' ? 1 : 2;
}

function injuryLabel(injury: OpenInjury) {
  if (injury.waiting_for_me) return 'Clearance to review';
  return injury.status === 'injured' ? 'Injured' : 'Clearance asked for';
}

/**
 * The members of a squad or team's staff who see injury status beside its
 * athletes' names: its coaches and physios, the people the database shows the
 * team's injuries to. Managers log injuries but don't see them, and athletes
 * see only names and positions.
 */
export function seesRosterStatus(role: TeamRole | undefined) {
  return role === 'coach' || role === 'physio';
}

/**
 * Each athlete's status, from the open injuries the database gave this
 * member. An injury that is cleared says nothing.
 */
export function rosterStatuses(injuries: OpenInjury[]): Map<string, RosterStatus> {
  const statuses = new Map<string, RosterStatus>();
  const open = injuries
    .filter((i) => i.status !== 'cleared')
    .sort((a, b) => injuryRank(a) - injuryRank(b));
  for (const injury of open) {
    if (!statuses.has(injury.athlete_id)) {
      statuses.set(injury.athlete_id, { label: injuryLabel(injury), injuryId: injury.id });
    }
  }
  return statuses;
}

/** A squad or team's people: its athletes, then its coaches, managers and physios. */
export function splitRoster(roster: RosterEntry[]) {
  return {
    athletes: roster.filter((m) => m.team_role === 'athlete'),
    staff: roster.filter((m) => m.team_role !== 'athlete'),
  };
}

/** Such as "12 athletes · 3 staff". */
export function rosterCountLabel(roster: RosterEntry[]) {
  const { athletes, staff } = splitRoster(roster);
  const parts: string[] = [];
  if (athletes.length > 0) {
    parts.push(`${athletes.length} ${athletes.length === 1 ? 'athlete' : 'athletes'}`);
  }
  if (staff.length > 0) parts.push(`${staff.length} staff`);
  return parts.join(' · ');
}

/** Such as "2 with a current injury", or null when nobody shown has one. */
export function injuredCountLabel(roster: RosterEntry[], statuses: Map<string, RosterStatus>) {
  const count = splitRoster(roster).athletes.filter((m) => statuses.has(m.profile_id)).length;
  return count === 0 ? null : `${count} with a current injury`;
}
