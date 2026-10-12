import { formatDate, isMinor } from '@/lib/age';
import type { AppRole, Profile, StandDownReason } from '@/lib/types';
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
 * without a current check, committee when a recorded check has expired
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
): AppRole[] {
  if (member.status !== 'approved') return [];
  const check = wwccStatus(member).kind;
  const current = check === 'current' || check === 'expiring';
  const stoodDown = !!member.stood_down_at;
  return rolesOf(member).filter((r) => {
    if (!standDownRoles.includes(r)) return false;
    if (stoodDown) return true;
    if (wwccRoles.includes(r)) return !current;
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
export function safetyIssues(member: Profile, hasGuardian: boolean): string[] {
  if (member.status !== 'approved') return [];
  const issues: string[] = [];
  const in30Days = isoDay(30);
  if (member.stood_down_at) issues.push('Stood down');

  if (needsWwcc(member)) {
    const check = wwccStatus(member);
    if (check.problem) issues.push(check.label);
  }

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
