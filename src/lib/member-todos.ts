import type { Href } from 'expo-router';

import { isMinor } from '@/lib/age';
import { isLockedChild } from '@/lib/guardian-links';
import { hasRole } from '@/lib/roles';
import {
  isDatedExemption,
  needsWwcc,
  volunteerTimeOff,
  WWCC_WARNING_DAYS,
  wwccRecordIssues,
  wwccStatus,
} from '@/lib/safety';
import type { Profile, VolunteerExemption, WwccApplication } from '@/lib/types';

/**
 * The home screen to-dos about members. Each one opens the people it is about,
 * and straight at the action when there is only one of them, instead of the
 * whole member list.
 */
export const memberTodoKinds = [
  'join',
  'locked',
  'dob',
  'wwcc',
  'wwcc-sent',
  'wwcc-application',
  'notice',
  'exemption-ending',
  'turning-18',
  'inactive',
  'unendorsable',
] as const;

export type MemberTodoKind = (typeof memberTodoKinds)[number];

/** The part of a member's page a to-do's action is in. */
export type MemberSection =
  | 'approve'
  | 'guardians'
  | 'date-of-birth'
  | 'wwcc'
  | 'notices'
  | 'physio'
  | 'delete';

export function isMemberTodoKind(value: unknown): value is MemberTodoKind {
  return typeof value === 'string' && (memberTodoKinds as readonly string[]).includes(value);
}

/** What each to-do asks for: the list's heading, what to do on the member's page, and where. */
export const memberTodoCopy: Record<
  MemberTodoKind,
  { heading: string; action: string; empty: string; section: MemberSection }
> = {
  join: {
    heading: 'Waiting for approval',
    action:
      'Check who they are, choose their role and squad or team, then Approve or Don’t approve at the bottom.',
    empty: 'Nobody is waiting for approval. Someone may have already dealt with them.',
    section: 'approve',
  },
  locked: {
    heading: 'Under 18 and locked out',
    action:
      'Their app is locked until a verified parent or guardian is linked. Link one under Parents and guardians, then Save changes.',
    empty: 'No athlete under 18 is locked out now.',
    section: 'guardians',
  },
  dob: {
    heading: 'No date of birth',
    action:
      'Add their date of birth, checked against PlayHQ or ID, then Save changes. It decides whether the under 18 rules apply.',
    empty: 'Every athlete has a date of birth now.',
    section: 'date-of-birth',
  },
  wwcc: {
    heading: 'Checks to sort out',
    action:
      'Record, renew, validate or register their Working With Children Check under Working With Children Check.',
    empty: 'No Working With Children Check needs sorting out now.',
    section: 'wwcc',
  },
  'wwcc-sent': {
    heading: 'Cards members sent in',
    action:
      'Check the card they sent in with the Screening Unit, then accept it or send it back under Working With Children Check.',
    empty: 'No card is waiting to be checked now. Another admin may have already checked it.',
    section: 'wwcc',
  },
  'wwcc-application': {
    heading: 'Applications to confirm',
    action:
      'Check their application online, then confirm it’s still being assessed under Working With Children Check.',
    empty: 'No check application needs confirming now.',
    section: 'wwcc',
  },
  notice: {
    heading: 'Notices to report',
    action:
      'Tell the governing body in writing, then record the date under Screening Unit notices.',
    empty: 'Every barring notice has been reported to the governing body.',
    section: 'notices',
  },
  'exemption-ending': {
    heading: 'Exemptions ending soon',
    action:
      'Their volunteer exemption ends soon. Record their Working With Children Check before it does, or their role pauses.',
    empty: 'No volunteer exemption ends soon.',
    section: 'wwcc',
  },
  'turning-18': {
    heading: 'Turning 18 soon',
    action:
      'They turn 18 soon. Their parent and guardian links end when you next save them after their birthday.',
    empty: 'No athlete turns 18 in the next 30 days.',
    section: 'guardians',
  },
  inactive: {
    heading: 'No team or role for 2 years',
    action:
      'If they’ve left the club, delete them at the bottom. Their safeguarding records stay.',
    empty: 'Every member has had a team or role in the last 2 years.',
    section: 'delete',
  },
  unendorsable: {
    heading: 'Physios',
    action:
      'Make them Head Physio, or place them in the athlete’s squad or team, then Save changes.',
    empty: 'There are no physios in the club yet. Give a member the Physio role first.',
    section: 'physio',
  },
};

/** The to-do's list of people, from the home screen. */
export function memberTodoHref(kind: MemberTodoKind): Href {
  return { pathname: '/admin', params: { todo: kind } };
}

/** A member's page, opened at the to-do's action. */
export function memberPageHref(memberId: string, kind: MemberTodoKind): Href {
  return { pathname: '/admin/[id]', params: { id: memberId, todo: kind } };
}

/** What else decides whether a member is behind a to-do. */
export type MemberTodoContext = {
  /** An approved, verified parent or guardian is linked (`unlocksChild`). */
  hasVerifiedGuardian: boolean;
  /** Their open volunteer exemption, if they have one. */
  exemption?: Pick<
    VolunteerExemption,
    'basis' | 'valid' | 'declared_at' | 'ends_on' | 'ended_at'
  > | null;
  /** Their open check application, if they have one. */
  application?: Pick<WwccApplication, 'status' | 'check_due_on' | 'ended_at'> | null;
  /** They sent in a card of their own that is waiting for an admin. */
  submitted?: boolean;
  /** A barring notice about them the governing body hasn't been told of. */
  noticeToReport?: boolean;
  /** No squad, team or club role for 2 years (`admin_inactive_members`). */
  inactive?: boolean;
  /** Today as YYYY-MM-DD, local time. */
  today: string;
};

/**
 * Whether a member is one of the people a to-do is about. Same rules as the
 * counts in `public.admin_safety_todos`, so the list a to-do opens has the
 * people it counted. A change to those counts changes this in the same pull
 * request.
 */
export function memberMatchesTodo(
  kind: MemberTodoKind,
  member: Profile,
  context: MemberTodoContext,
): boolean {
  const { today } = context;
  if (kind === 'join') return member.status === 'pending' && !!member.join_requested_at;
  // A notice is reported whatever has happened to their membership since.
  if (kind === 'notice') return !!context.noticeToReport;
  // A card they sent in waits for an admin whatever else is going on.
  if (kind === 'wwcc-sent') return !!context.submitted;
  if (member.status !== 'approved') return false;

  const athlete = hasRole(member, 'athlete');
  switch (kind) {
    case 'locked':
      return isLockedChild(member, context.hasVerifiedGuardian);
    case 'dob':
      return athlete && !member.date_of_birth;
    case 'turning-18':
      return (
        athlete &&
        !!member.date_of_birth &&
        isMinor(member.date_of_birth, member.under_17) &&
        eighteenthBirthday(member.date_of_birth) <= addDays(today, 30)
      );
    case 'inactive':
      return !!context.inactive;
    case 'unendorsable':
      return hasRole(member, 'physio');
    case 'wwcc-application': {
      const application = context.application;
      if (!application || application.ended_at) return false;
      return (
        application.status === 'lapsed' ||
        (application.status === 'in_force' && application.check_due_on <= today)
      );
    }
  }

  // The rest are about checks, for people who need one while they help.
  if (!needsWwcc(member) || volunteerTimeOff(member)) return false;
  const check = wwccStatus(member).kind;
  const current = check === 'current' || check === 'expiring';
  // An exemption covers them once they've accepted its declaration and it still applies.
  const exemption =
    context.exemption && !context.exemption.ended_at ? context.exemption : null;
  const exempt = !!exemption?.valid && !!exemption.declared_at;
  const isHelper = member.role === 'volunteer';

  if (kind === 'exemption-ending') {
    return (
      !current &&
      exempt &&
      !!exemption?.ends_on &&
      exemption.ends_on < addDays(today, WWCC_WARNING_DAYS) &&
      !isDatedExemption(exemption.basis) &&
      !(isHelper && !!member.volunteer_until && exemption.ends_on > member.volunteer_until)
    );
  }

  // kind === 'wwcc': missing, expired, expiring, not validated or not registered.
  if (!current) {
    const applies =
      exempt ||
      (!!context.application &&
        !context.application.ended_at &&
        context.application.status === 'in_force');
    return !applies;
  }
  const expiring =
    check === 'expiring' &&
    !(isHelper && !!member.volunteer_until && (member.wwcc_expires_on ?? '') >= member.volunteer_until);
  return expiring || wwccRecordIssues(member).length > 0;
}

/**
 * Whether the to-do that opened a member's page is already done for them, in a
 * sentence, so whoever opens an old to-do sees that instead of a form to fill in.
 */
export function memberTodoDone(
  kind: MemberTodoKind,
  member: Profile,
  context: Pick<MemberTodoContext, 'hasVerifiedGuardian'>,
): string | null {
  switch (kind) {
    case 'join':
      if (member.status === 'approved') return 'Already approved. Nothing left to do here.';
      if (member.status === 'rejected') return 'Already not approved. Nothing left to do here.';
      if (!member.join_requested_at) return 'They haven’t asked to join yet.';
      return null;
    case 'dob':
      return member.date_of_birth ? 'Their date of birth is already added.' : null;
    case 'locked':
      return member.status === 'approved' && !isLockedChild(member, context.hasVerifiedGuardian)
        ? 'Already unlocked: a verified parent or guardian is linked.'
        : null;
    default:
      return null;
  }
}

/** The day someone turns 18, YYYY-MM-DD. 29 February turns 18 on 1 March, as in `isMinor`. */
function eighteenthBirthday(dateOfBirth: string) {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  return new Date(Date.UTC(year + 18, month - 1, day)).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD day plus a number of days. */
function addDays(day: string, days: number) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}
