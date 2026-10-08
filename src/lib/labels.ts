import type {
  AppRole,
  CoachTitle,
  MemberStatus,
  RejectionReason,
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
  athlete: 'Athlete',
  guardian: 'Guardian',
};

export const coachTitleLabels: Record<CoachTitle, string> = {
  head_coach: 'Head Coach',
  assistant_coach: 'Assistant Coach',
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
  'guest',
];

/** Roles that belong to a team or squad. */
export const teamRoles: TeamRole[] = ['coach', 'manager', 'athlete', 'guardian'];

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
