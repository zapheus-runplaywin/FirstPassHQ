import type { AppRole, CoachTitle, MemberStatus, TeamRole, TeamSelection } from '@/lib/types';

export const roleLabels: Record<AppRole, string> = {
  admin: 'Admin',
  coach: 'Coach',
  manager: 'Manager',
  athlete: 'Athlete',
  committee: 'Committee',
  partner: 'Partner',
  guardian: 'Guardian',
  guest: 'Guest',
};

export const statusLabels: Record<MemberStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const teamRoleLabels: Record<TeamRole, string> = {
  coach: 'Coach',
  manager: 'Manager',
  athlete: 'Athlete',
};

export const coachTitleLabels: Record<CoachTitle, string> = {
  head_coach: 'Head Coach',
  assistant_coach: 'Assistant Coach',
};

export const selectionLabels: Record<TeamSelection, string> = {
  touring: 'Touring athlete',
  training_partner: 'Training partner',
};

/** Roles a member can ask for when joining. Admin is granted, never requested. */
export const requestableRoles: AppRole[] = [
  'athlete',
  'guardian',
  'coach',
  'manager',
  'committee',
  'partner',
  'guest',
];

/** Roles that belong to a team or squad. */
export const teamRoles: TeamRole[] = ['coach', 'manager', 'athlete'];

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
