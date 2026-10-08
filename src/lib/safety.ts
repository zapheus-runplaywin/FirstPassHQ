import { formatDate, isMinor } from '@/lib/age';
import type { AppRole, Profile } from '@/lib/types';

/** Roles that need a current Working With Children Check. */
export const wwccRoles: AppRole[] = ['coach', 'manager', 'physio'];

/** Today's date as YYYY-MM-DD, plus a number of days. */
function isoDay(addDays = 0) {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}

/**
 * Why an approved member shows up in the admin's child-safety to-dos, one line
 * per reason. Same rules as `public.admin_safety_todos` in the database.
 */
export function safetyIssues(member: Profile, hasGuardian: boolean): string[] {
  if (member.status !== 'approved') return [];
  const issues: string[] = [];
  const today = isoDay();
  const in30Days = isoDay(30);

  if (wwccRoles.includes(member.role)) {
    const number = member.wwcc_number?.trim();
    const expires = member.wwcc_expires_on;
    if (!number) {
      issues.push('No Working With Children Check recorded');
    } else if (!expires) {
      issues.push('Working With Children Check has no expiry date');
    } else if (expires < today) {
      issues.push(`Working With Children Check expired ${formatDate(expires)}`);
    } else if (expires < in30Days) {
      issues.push(`Working With Children Check expires ${formatDate(expires)}`);
    }
  }

  if (member.role === 'athlete' && isMinor(member.date_of_birth, member.under_17)) {
    if (!hasGuardian) issues.push('Under 18 with no guardian linked');
    if (member.date_of_birth) {
      const [year, month, day] = member.date_of_birth.split('-');
      const eighteenth = `${Number(year) + 18}-${month}-${day}`;
      if (eighteenth <= in30Days) issues.push(`Turns 18 on ${formatDate(eighteenth)}`);
    }
  }

  return issues;
}
