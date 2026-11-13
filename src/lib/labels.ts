import type {
  AppRole,
  CaptainRole,
  CoachTitle,
  MemberStatus,
  RejectionReason,
  Team,
  TeamRole,
  TeamSelection,
} from '@/lib/types';

export const roleLabels: Record<AppRole, string> = {
  admin: 'Admin',
  coach: 'Coach',
  manager: 'Manager',
  athlete: 'Athlete',
  committee: 'Committee',
  physio: 'Physio',
  guardian: 'Guardian',
  guest: 'Guest',
  volunteer: 'Temporary helper',
  statistician: 'Statistician',
  studio: 'Studio',
};

/** A role as a group of people, such as "Guardians". */
export const pluralRoleLabels: Record<AppRole, string> = {
  admin: 'Admins',
  coach: 'Coaches',
  manager: 'Managers',
  athlete: 'Athletes',
  committee: 'Committee',
  physio: 'Physios',
  guardian: 'Guardians',
  guest: 'Guests',
  volunteer: 'Temporary helpers',
  statistician: 'Statisticians',
  studio: 'Studio operators',
};

export const statusLabels: Record<MemberStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** Why a request wasn't approved, as admins choose it. */
export const rejectionReasonLabels: Record<RejectionReason, string> = {
  playhq_email_mismatch: "PlayHQ email doesn't match",
  not_registered: 'Not registered with the club',
  other: 'Other',
};

/** Why a request wasn't approved, as the member reads it. */
export const rejectionReasonMessages: Record<RejectionReason, string> = {
  playhq_email_mismatch:
    "Your PlayHQ email didn't match our registrations. Check it and request again, or show a club admin the code below.",
  not_registered:
    "We couldn't find you in our club registrations. If you think that's wrong, show a club admin the code below.",
  other: 'Contact the club, or show a club admin the code below to confirm who you are.',
};

export const teamRoleLabels: Record<TeamRole, string> = {
  coach: 'Coach',
  manager: 'Manager',
  physio: 'Physio',
  athlete: 'Athlete',
  guardian: 'Guardian',
};

export const coachTitleLabels: Record<CoachTitle, string> = {
  head_coach: 'Head Coach',
  assistant_coach: 'Assistant Coach',
};

export const captainRoleLabels: Record<CaptainRole, string> = {
  captain: 'Captain',
  vice_captain: 'Vice captain',
};

export const selectionLabels: Record<TeamSelection, string> = {
  touring: 'Final team athlete',
  training_partner: 'Training partner',
};

/** Roles a member can ask for when joining. Admin is granted, never requested. */
export const requestableRoles: AppRole[] = [
  'athlete',
  'guardian',
  'coach',
  'manager',
  'committee',
  'physio',
  'statistician',
  'studio',
  'guest',
  'volunteer',
];

/** Roles that belong to a team or squad. */
export const teamRoles: TeamRole[] = ['coach', 'manager', 'physio', 'athlete', 'guardian'];

export function isTeamRole(role: AppRole): role is TeamRole {
  return (teamRoles as AppRole[]).includes(role);
}

export function teamPositionLabel(
  teamRole: TeamRole,
  coachTitle: CoachTitle | null,
  selection: TeamSelection | null = null,
) {
  if (coachTitle) return coachTitleLabels[coachTitle];
  if (selection) return selectionLabels[selection];
  return teamRoleLabels[teamRole];
}

/** Only committee members and admins have a title, such as President. */
export function canHoldTitle(roles: AppRole[]) {
  return roles.includes('committee') || roles.includes('admin');
}

/** The squads and teams someone is in, enough to work out their coach or manager title. */
type StaffMembership = {
  team_role: TeamRole;
  coach_title: CoachTitle | null;
  team: Pick<Team, 'name' | 'kind' | 'sort_order'>;
};

/**
 * The title a coach or manager gets from the groups they look after, such as
 * "Head Coach, Open A" or "Manager, 17 & Under". Their teams count first; a
 * squad only counts when they don't coach or manage any team. Empty if neither.
 */
export function staffTitle(memberships: StaffMembership[]) {
  const titles: string[] = [];
  for (const role of ['coach', 'manager'] as const) {
    const groups = memberships.filter((m) => m.team_role === role);
    const teams = groups.filter((m) => m.team.kind === 'team');
    const used = (teams.length > 0 ? teams : groups).sort(
      (a, b) => a.team.sort_order - b.team.sort_order || a.team.name.localeCompare(b.team.name),
    );
    // Groups with the same position share one title: "Head Coach, Open A and Open".
    const byPosition = new Map<string, string[]>();
    for (const m of used) {
      const position = teamPositionLabel(m.team_role, m.coach_title);
      byPosition.set(position, [...(byPosition.get(position) ?? []), m.team.name]);
    }
    for (const [position, names] of byPosition) {
      titles.push(`${position}, ${joinNames(names)}`);
    }
  }
  return titles.join(' · ');
}

/** "Open A", "Open A and Open", or "Open A, Open and Open Mixed". */
function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A member's roles, with their title when they hold one:
 * "Committee · President", or "Coach, Guardian" for someone with two roles.
 * Coaches and managers add the title from their team or squad, worked out by
 * `staffTitle`: "Coach · Head Coach, Open A". A Head Physio shows as "Head Physio".
 */
export function rolesLabel(
  roles: AppRole[],
  title?: string | null,
  headPhysio = false,
  groupTitle = '',
) {
  const label = roles
    .map((r) => (r === 'physio' && headPhysio ? 'Head Physio' : roleLabels[r]))
    .join(', ');
  const titles = [
    canHoldTitle(roles) ? title : null,
    roles.includes('coach') || roles.includes('manager') ? groupTitle : null,
  ].filter(Boolean);
  return titles.length > 0 ? `${label} · ${titles.join(' · ')}` : label;
}
