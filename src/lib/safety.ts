import { formatDate, isMinor } from '@/lib/age';
import type {
  AppRole,
  MyVolunteerExemption,
  Profile,
  ScreeningNoticeKind,
  StandDownReason,
  VolunteerExemptionBasis,
  WwccValidationMethod,
} from '@/lib/types';
import { hasRole, rolesOf } from '@/lib/roles';

/** Roles that always need a current Working With Children Check. */
export const wwccRoles: AppRole[] = ['coach', 'manager', 'physio'];

/**
 * Whether an admin can excuse someone with these roles from the check: only
 * committee members who hold no role that always needs one.
 */
export function canBeExempt(roles: AppRole[]) {
  return roles.includes('committee') && !roles.some((r) => wwccRoles.includes(r));
}

/**
 * Whether a member needs a current check: coaches, managers and physios
 * always, committee members unless an admin exempted them. Same rule as
 * `public.needs_wwcc` in the database.
 */
export function needsWwcc(
  member: Pick<Profile, 'role' | 'extra_roles' | 'wwcc_exempt_reason'>,
): boolean {
  if (hasRole(member, ...wwccRoles)) return true;
  return hasRole(member, 'committee') && !member.wwcc_exempt_reason?.trim();
}

export const wwccValidationLabels: Record<WwccValidationMethod, string> = {
  online: 'Checked online',
  card_sighted: 'Card sighted',
  unit_letter: 'Screening Unit letter',
};

export const screeningNoticeLabels: Record<ScreeningNoticeKind, string> = {
  interim_negative_notice: 'Interim negative notice',
  negative_notice: 'Negative notice',
  interstate_decision: 'Interstate decision',
  card_cancelled: 'Card cancelled or suspended',
  other: 'Other notice',
};

/** Notices that bar someone from child-related work, which the governing body must be told of. */
export const barringNotices: ScreeningNoticeKind[] = [
  'interim_negative_notice',
  'negative_notice',
  'interstate_decision',
  'card_cancelled',
];

/**
 * What still needs doing for a current card: validating it (never, or more
 * than a year ago) and linking it to the club with the Screening Unit. Same
 * rules as `public.admin_safety_todos` in the database.
 */
export function wwccRecordIssues(
  member: Pick<Profile, 'wwcc_validated_at' | 'wwcc_unit_linked_at'>,
): string[] {
  const issues: string[] = [];
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  if (!member.wwcc_validated_at) issues.push('Check not validated');
  else if (new Date(member.wwcc_validated_at) < yearAgo) issues.push('Check validated over a year ago');
  if (!member.wwcc_unit_linked_at) issues.push('Card not linked with the Screening Unit');
  return issues;
}

export const volunteerExemptionLabels: Record<VolunteerExemptionBasis, string> = {
  parent_volunteer: 'Parent volunteer',
  under_18_volunteer: 'Under-18 volunteer',
};

/** An exemption's state, as either the member's own or an admin's view has it. */
type ExemptionState = Pick<
  MyVolunteerExemption,
  'basis' | 'child_name' | 'declared_at' | 'valid' | 'ends_on'
>;

/**
 * Where a volunteer exemption is up to, in a sentence: waiting for the
 * declaration, applying (and until when), or no longer applying.
 */
export function exemptionStatus(exemption: ExemptionState): { label: string; problem: boolean } {
  const what =
    exemption.basis === 'parent_volunteer'
      ? `Parent volunteer for ${exemption.child_name ?? 'their child'}`
      : 'Under-18 volunteer';
  if (!exemption.declared_at) {
    return { label: `${what}: waiting for them to accept the declaration`, problem: true };
  }
  if (!exemption.valid) {
    return {
      label: `${what}: no longer applies${exemption.basis === 'parent_volunteer' ? ' (child turned 18, left or was unlinked)' : ' (turned 18)'}`,
      problem: true,
    };
  }
  if (exemption.ends_on && exemption.ends_on < isoDay(WWCC_WARNING_DAYS)) {
    return { label: `${what}: ends ${formatDate(exemption.ends_on)}`, problem: true };
  }
  return {
    label: `${what}${exemption.ends_on ? ` until ${formatDate(exemption.ends_on)}` : ''}`,
    problem: false,
  };
}

/** How many days ahead admins hear that a check is about to expire. */
export const WWCC_WARNING_DAYS = 60;

/** Roles a stand-down pauses. */
export const standDownRoles: AppRole[] = ['coach', 'manager', 'physio', 'committee', 'admin'];

export const standDownReasonLabels: Record<StandDownReason, string> = {
  interim_negative_notice: 'Interim negative notice',
  negative_notice: 'Negative notice',
  interstate_decision: 'Interstate decision',
  allegation: 'Allegation being looked into',
  other: 'Other',
};

/**
 * Roles a member holds but can't use right now: coach, manager and physio
 * without a current check or a volunteer exemption that applies, committee
 * when a recorded check has expired
 * (unless exempt), and all of those plus admin while stood down. Same rule as
 * `public.has_role` in the database.
 */
export function pausedRoles(
  member: Pick<
    Profile,
    | 'role'
    | 'extra_roles'
    | 'status'
    | 'wwcc_number'
    | 'wwcc_expires_on'
    | 'wwcc_exempt_reason'
    | 'stood_down_at'
  >,
  /** They have a volunteer exemption that applies today. */
  exempt = false,
): AppRole[] {
  if (member.status !== 'approved') return [];
  const check = wwccStatus(member).kind;
  const current = check === 'current' || check === 'expiring';
  const stoodDown = !!member.stood_down_at;
  return rolesOf(member).filter((r) => {
    if (!standDownRoles.includes(r)) return false;
    if (stoodDown) return true;
    if (wwccRoles.includes(r)) return !current && !exempt;
    if (r === 'committee') {
      return !member.wwcc_exempt_reason?.trim() && !!member.wwcc_number?.trim() && !current;
    }
    return false;
  });
}

/** Today's date as YYYY-MM-DD, plus a number of days. */
function isoDay(addDays = 0) {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}

export type WwccStatus = {
  kind: 'current' | 'expiring' | 'expired' | 'missing';
  label: string;
  /** The same in a few words, for reports. */
  short: string;
  /** Missing, expired or expiring within WWCC_WARNING_DAYS. */
  problem: boolean;
};

/** Where a member's Working With Children Check is up to. */
export function wwccStatus(member: Pick<Profile, 'wwcc_number' | 'wwcc_expires_on'>): WwccStatus {
  const number = member.wwcc_number?.trim();
  const expires = member.wwcc_expires_on;
  if (!number) {
    return {
      kind: 'missing',
      label: 'No Working With Children Check recorded',
      short: 'Missing',
      problem: true,
    };
  }
  if (!expires) {
    return {
      kind: 'missing',
      label: 'Working With Children Check has no expiry date',
      short: 'No expiry date',
      problem: true,
    };
  }
  if (expires < isoDay()) {
    return {
      kind: 'expired',
      label: `Working With Children Check expired ${formatDate(expires)}`,
      short: 'Expired',
      problem: true,
    };
  }
  if (expires < isoDay(WWCC_WARNING_DAYS)) {
    return {
      kind: 'expiring',
      label: `Working With Children Check expires ${formatDate(expires)}`,
      short: `Expires within ${WWCC_WARNING_DAYS} days`,
      problem: true,
    };
  }
  return { kind: 'current', label: 'Current', short: 'Current', problem: false };
}

/**
 * Why an approved member shows up in the admin's child-safety to-dos, one line
 * per reason. Same rules as `public.admin_safety_todos` in the database.
 */
export function safetyIssues(
  member: Profile,
  hasGuardian: boolean,
  /** Their open volunteer exemption, if they have one. */
  exemption?: ExemptionState | null,
): string[] {
  if (member.status !== 'approved') return [];
  const issues: string[] = [];
  const in30Days = isoDay(30);
  if (member.stood_down_at) issues.push('Stood down');

  if (needsWwcc(member)) {
    const check = wwccStatus(member);
    const current = check.kind === 'current' || check.kind === 'expiring';
    if (exemption && !current) {
      const status = exemptionStatus(exemption);
      if (status.problem) issues.push(status.label);
    } else if (check.problem) {
      issues.push(check.label);
    }
    if (current) issues.push(...wwccRecordIssues(member));
  }

  if (hasRole(member, 'athlete') && !member.date_of_birth) issues.push('No date of birth');

  if (hasRole(member, 'athlete') && isMinor(member.date_of_birth, member.under_17)) {
    if (!hasGuardian) issues.push('Under 18 with no guardian linked');
    if (member.date_of_birth) {
      const [year, month, day] = member.date_of_birth.split('-');
      const eighteenth = `${Number(year) + 18}-${month}-${day}`;
      if (eighteenth <= in30Days) issues.push(`Turns 18 on ${formatDate(eighteenth)}`);
    }
  }

  return issues;
}
