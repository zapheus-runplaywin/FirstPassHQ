import { isMinor } from '@/lib/age';
import { hasRole } from '@/lib/roles';
import type { AppRole, MemberStatus } from '@/lib/types';

/**
 * A child's link code (`public.my_link_code`): what a child under 18 waiting
 * for a parent or guardian shares with them. `waiting` is false for everyone
 * else, with no code.
 */
export type LinkCode = {
  waiting: boolean;
  code: string | null;
  expires_at: string | null;
  /** Parents and guardians who entered a code, waiting for an admin. */
  parents_waiting: string[];
};

/** A parent or guardian's request to be linked to a child, by code. */
export type LinkRequest = { guardian_id: string; athlete_id: string; created_at: string };

/** The letters a code is made from: no 0, O, 1, I or L, which look alike. */
export const LINK_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** "7KQ4MD" → "7KQ-4MD", the way the child reads it out. */
export function formatLinkCode(code: string) {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/** What a parent typed, as the database compares it: capitals, no dashes or spaces. */
export function normaliseLinkCode(typed: string) {
  return typed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** Whether what was typed could be a code at all, before asking the database. */
export function looksLikeLinkCode(typed: string) {
  const code = normaliseLinkCode(typed);
  return code.length === 6 && [...code].every((c) => LINK_CODE_ALPHABET.includes(c));
}

/** The message a child shares with their parent or guardian, naming the app to install. */
export function linkCodeMessage(
  code: string,
  clubName: string,
  childName: string | null,
  appName: string,
) {
  return (
    `${childName ? `${childName} is` : 'I’m'} joining ${clubName} on ${appName}. ` +
    `Install the ${appName} app, sign in, ask to join as a parent or guardian and enter this code: ${formatLinkCode(code)}. ` +
    'It works once, for 7 days.'
  );
}

type Member = {
  status: MemberStatus;
  role: AppRole;
  extra_roles: AppRole[];
  date_of_birth: string | null;
  under_17: boolean;
};

type Guardian = { status: MemberStatus; role: AppRole; extra_roles: AppRole[]; verified_at: string | null };

/** A parent or guardian whose link unlocks a child: approved and verified. */
export function unlocksChild(guardian: Guardian | null | undefined) {
  return (
    !!guardian &&
    guardian.status === 'approved' &&
    !!guardian.verified_at &&
    hasRole(guardian, 'guardian')
  );
}

/**
 * The athletes with at least one approved, verified parent or guardian linked,
 * from the guardian links and the members an admin can see.
 */
export function athletesWithVerifiedGuardian(
  links: { guardian_id: string; athlete_id: string }[],
  guardianById: (id: string) => Guardian | null | undefined,
) {
  return new Set(links.filter((l) => unlocksChild(guardianById(l.guardian_id))).map((l) => l.athlete_id));
}

/**
 * Locked: an approved athlete under 18 with no approved, verified parent or
 * guardian linked. Until one is, they can only see their link code, sign out
 * and delete their account. Same rule as `public.is_locked_child`.
 */
export function isLockedChild(member: Member, hasVerifiedGuardian: boolean) {
  return (
    member.status === 'approved' &&
    hasRole(member, 'athlete') &&
    isMinor(member.date_of_birth, member.under_17) &&
    !hasVerifiedGuardian
  );
}

/**
 * Who a parent or guardian is linked to, for the Guardian of card on Home and
 * the Your children screen it opens.
 */
export function guardianOfText(names: readonly string[]) {
  return names.length > 0
    ? names.join(', ')
    : 'Nobody yet. Enter your child’s link code, and a club admin links you once they have checked who you are.';
}
