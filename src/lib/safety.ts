import { formatDate, isMinor } from '@/lib/age';
import type {
  AppRole,
  MyVolunteerExemption,
  Profile,
  ScreeningNoticeKind,
  StandDownReason,
  VerificationMethod,
  VolunteerExemptionBasis,
  VolunteerScreening,
  WwccApplication,
  WwccApplicationEndReason,
  WwccValidationMethod,
} from '@/lib/types';
import { hasRole, rolesOf } from '@/lib/roles';

/** Roles that always need a current Working With Children Check. */
export const wwccRoles: AppRole[] = ['coach', 'manager', 'physio'];

/** Roles an admin can excuse from the check with a reason. */
export const exemptableRoles: AppRole[] = ['committee', 'admin', 'statistician'];

/**
 * Whether an admin can excuse someone with these roles from the check: only
 * committee members, admins and statisticians who hold no role that always
 * needs one.
 */
export function canBeExempt(roles: AppRole[]) {
  return (
    roles.some((r) => exemptableRoles.includes(r)) &&
    !roles.some((r) => wwccRoles.includes(r))
  );
}

/**
 * Whether a member needs a current check: coaches, managers, physios and
 * temporary helpers always, committee members, admins and statisticians
 * unless another admin exempted them. Same rule as `public.needs_wwcc` in the database.
 */
export function needsWwcc(
  member: Pick<Profile, 'role' | 'extra_roles' | 'wwcc_exempt_reason'>,
): boolean {
  if (hasRole(member, ...wwccRoles, 'volunteer')) return true;
  return hasRole(member, ...exemptableRoles) && !member.wwcc_exempt_reason?.trim();
}

export const verificationMethodLabels: Record<VerificationMethod, string> = {
  code: 'Code checked in person',
  playhq: 'Matched to PlayHQ',
  id_sighted: 'ID sighted',
};

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

export const wwccApplicationEndLabels: Record<WwccApplicationEndReason, string> = {
  card_recorded: 'their card was recorded',
  withdrawn: 'withdrawn',
  refused: 'refused',
  replaced: 'replaced by a later application',
  other: 'ended',
};

/** An application's state, as either the member's own or an admin's view has it. */
type ApplicationState = Pick<WwccApplication, 'lodged_on' | 'status' | 'lapses_on'> &
  Partial<Pick<WwccApplication, 'check_due_on'>>;

/**
 * Where a lodged check application is up to, in a sentence: waiting for the
 * declaration, counting (and whether an admin should confirm it), lapsed or
 * stopped. Same rules as `public.wwcc_application_status` in the database.
 */
export function applicationStatus(application: ApplicationState): {
  label: string;
  problem: boolean;
} {
  const what = `Check applied for ${formatDate(application.lodged_on)}`;
  switch (application.status) {
    case 'waiting_for_declaration':
      return { label: `${what}: waiting for them to accept the declaration`, problem: true };
    case 'lapsed':
      return { label: `${what}: lapsed, nobody confirmed it’s still being assessed`, problem: true };
    case 'stopped':
      return { label: `${what}: stopped by a Screening Unit notice`, problem: true };
    case 'ended':
      return { label: `${what}: ended`, problem: false };
    default:
      if (application.check_due_on && application.check_due_on <= isoDay()) {
        return {
          label: `${what}: confirm it’s still being assessed by ${formatDate(application.lapses_on)}`,
          problem: true,
        };
      }
      return { label: `${what}, counts until ${formatDate(application.lapses_on)}`, problem: false };
  }
}

/**
 * What still needs doing for a current card: validating it (never, or more
 * than a year ago) and registering it with the club, so the Screening Unit
 * tells the club if its status changes. Same
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
  if (!member.wwcc_unit_linked_at) issues.push('Card not registered with the club');
  return issues;
}

export const volunteerExemptionLabels: Record<VolunteerExemptionBasis, string> = {
  parent_volunteer: 'Parent volunteer',
  under_18_volunteer: 'Under-18 volunteer',
  short_term_visitor: 'Short-term visitor',
  national_event: 'National event or tour',
};

/** Exemptions for people not ordinarily resident in WA, with a first and last day. */
export function isDatedExemption(basis: VolunteerExemptionBasis) {
  return basis === 'short_term_visitor' || basis === 'national_event';
}

/** An exemption's state, as either the member's own or an admin's view has it. */
type ExemptionState = Pick<
  MyVolunteerExemption,
  'basis' | 'child_name' | 'declared_at' | 'valid' | 'ends_on' | 'starts_on' | 'event_name'
>;

/**
 * Where a volunteer exemption is up to, in a sentence: waiting for the
 * declaration, applying (and until when), or no longer applying.
 */
export function exemptionStatus(exemption: ExemptionState): { label: string; problem: boolean } {
  const what =
    exemption.basis === 'parent_volunteer'
      ? `Parent volunteer for ${exemption.child_name ?? 'their child'}`
      : exemption.basis === 'national_event'
        ? `National event exemption for ${exemption.event_name ?? 'an event'}`
        : exemption.basis === 'short_term_visitor'
          ? 'Short-term visitor exemption'
          : 'Under-18 volunteer';
  if (!exemption.declared_at) {
    return { label: `${what}: waiting for them to accept the declaration`, problem: true };
  }
  if (isDatedExemption(exemption.basis) && exemption.starts_on && exemption.ends_on) {
    const dates = `${formatDate(exemption.starts_on)} to ${formatDate(exemption.ends_on)}`;
    if (exemption.starts_on > isoDay()) return { label: `${what}: ${dates}`, problem: false };
    if (!exemption.valid) return { label: `${what}: ended ${formatDate(exemption.ends_on)}`, problem: true };
    // Two weeks or 30 days by design, so not flagged as ending.
    return { label: `${what} until ${formatDate(exemption.ends_on)}`, problem: false };
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

/**
 * Where the WA rules on checks and exemptions come from, for admins to read at
 * the source. Checked October 2026.
 */
export const wwcSources: { label: string; url: string }[] = [
  {
    label: 'Who needs a Working With Children Check',
    url: 'https://www.wa.gov.au/organisation/department-of-communities/working-children-check-who-needs-wwc-check',
  },
  {
    label: 'Applying, and working while an application is assessed',
    url: 'https://www.wa.gov.au/organisation/department-of-communities/working-children-check-application-and-renewal-process',
  },
  {
    label: 'Working with Children (Screening) Act 2004',
    url: 'https://www.legislation.wa.gov.au/legislation/statutes.nsf/law_a9277.html',
  },
  {
    label: 'Fact sheet: national events and tours (CRW02)',
    url: 'https://www.wa.gov.au/system/files/2024-06/wwcc_factsheet_crw02_-_exemptions_one-off_national_events_and_national_tours.pdf',
  },
  {
    label: 'Fact sheet: parent volunteers (CRW03)',
    url: 'https://www.wa.gov.au/system/files/2026-08/factsheet_crw03-exemptions-the_parent_volunteer_exemption.pdf',
  },
  {
    label: 'Fact sheet: who can’t use an exemption (CRW04)',
    url: 'https://www.wa.gov.au/system/files/2026-09/wwcc-factsheet-crw04-exemptions-narrowing-of-access.pdf',
  },
  {
    label: 'Fact sheet: sport and recreation (ORG03)',
    url: 'https://www.wa.gov.au/system/files/2024-10/factsheet_org03_wwcc_sport_and_recreation_sector.pdf',
  },
  {
    label: 'All Working With Children Check fact sheets',
    url: 'https://www.wa.gov.au/government/document-collections/working-children-check-resources',
  },
];

/** What a temporary helper said about their check when they asked to join. */
export const volunteerScreeningLabels: Record<VolunteerScreening, string> = {
  card: 'I have a WA Working With Children Check',
  visitor: 'I’m visiting WA from interstate or overseas',
  national_event: 'I’m in WA for a national event or tour',
  parent: 'I’m a parent of an athlete at the club',
  under_18: 'I’m under 18',
  none: 'I don’t have a check yet',
};

/** Whether a temporary helper's time hasn't started, or has finished. */
export function volunteerTimeOff(
  member: Pick<Profile, 'role' | 'extra_roles' | 'volunteer_from' | 'volunteer_until'>,
) {
  if (!hasRole(member, 'volunteer')) return false;
  const today = isoDay();
  return (
    (!!member.volunteer_until && member.volunteer_until < today) ||
    (!!member.volunteer_from && member.volunteer_from > today)
  );
}

/** How many days ahead admins hear that a check is about to expire. */
export const WWCC_WARNING_DAYS = 60;

/** Roles a stand-down pauses. */
export const standDownRoles: AppRole[] = [
  'coach',
  'manager',
  'physio',
  'committee',
  'admin',
  'volunteer',
  'statistician',
];

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
 * when a recorded check has expired, or none is recorded from the club's
 * committee checks date (unless exempt), statistician the same way from the
 * club's statistician checks date (a volunteer exemption also counts), and
 * all of those plus admin while stood down. Same rule as `public.has_role` in the database.
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
  /** The day from which committee members need a check, "2027-01-11" style. */
  committeeChecksFrom: string | null = null,
  /** They have a lodged check application in force today. */
  applied = false,
  /** The day from which statisticians need a check, "2027-01-21" style. */
  statisticianChecksFrom: string | null = null,
): AppRole[] {
  if (member.status !== 'approved') return [];
  const check = wwccStatus(member).kind;
  const current = check === 'current' || check === 'expiring';
  const stoodDown = !!member.stood_down_at;
  return rolesOf(member).filter((r) => {
    if (!standDownRoles.includes(r)) return false;
    if (stoodDown) return true;
    if (wwccRoles.includes(r)) return !current && !exempt && !applied;
    if (r === 'committee') {
      const checksRequired = !!member.wwcc_number?.trim() || committeeChecksDue(committeeChecksFrom);
      return !member.wwcc_exempt_reason?.trim() && checksRequired && !current && !applied;
    }
    if (r === 'statistician') {
      const checksRequired =
        !!member.wwcc_number?.trim() || committeeChecksDue(statisticianChecksFrom);
      return (
        !member.wwcc_exempt_reason?.trim() && checksRequired && !current && !exempt && !applied
      );
    }
    return false;
  });
}

/**
 * Whether a member can do child-related work now: approved, not stood down,
 * and with a current check, or a volunteer exemption or lodged application
 * that applies. Same rule
 * as `public.can_work_with_children` in the database.
 */
export function canWorkWithChildren(
  member: Pick<Profile, 'status' | 'stood_down_at' | 'wwcc_number' | 'wwcc_expires_on'> | null,
  /** They have a volunteer exemption or a lodged application that applies today. */
  exempt = false,
) {
  if (!member || member.status !== 'approved' || member.stood_down_at) return false;
  const check = wwccStatus(member).kind;
  return check === 'current' || check === 'expiring' || exempt;
}

/** Whether the club's committee checks date has come. */
export function committeeChecksDue(committeeChecksFrom: string | null) {
  return !!committeeChecksFrom && isoDay() >= committeeChecksFrom;
}

/**
 * A committee member who has kept their role without a check, before the
 * club's committee checks date: they need a check, or an exemption, by then.
 */
export function committeeCheckDue(
  member: Pick<Profile, 'role' | 'extra_roles' | 'status' | 'wwcc_number' | 'wwcc_exempt_reason'>,
  committeeChecksFrom: string | null,
) {
  return (
    member.status === 'approved' &&
    rolesOf(member).includes('committee') &&
    !member.wwcc_number?.trim() &&
    !member.wwcc_exempt_reason?.trim() &&
    !!committeeChecksFrom &&
    !committeeChecksDue(committeeChecksFrom)
  );
}

/**
 * A statistician who has kept their role without a check, before the club's
 * statistician checks date: they need a check, or an exemption, by then.
 */
export function statisticianCheckDue(
  member: Pick<Profile, 'role' | 'extra_roles' | 'status' | 'wwcc_number' | 'wwcc_exempt_reason'>,
  statisticianChecksFrom: string | null,
) {
  return (
    member.status === 'approved' &&
    rolesOf(member).includes('statistician') &&
    !member.wwcc_number?.trim() &&
    !member.wwcc_exempt_reason?.trim() &&
    !!statisticianChecksFrom &&
    !committeeChecksDue(statisticianChecksFrom)
  );
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
  /** Their open check application, if they have one. */
  application?: ApplicationState | null,
): string[] {
  if (member.status !== 'approved') return [];
  const issues: string[] = [];
  const in30Days = isoDay(30);
  if (member.stood_down_at) issues.push('Stood down');

  // A temporary helper needs nothing before their first day or after their last.
  if (needsWwcc(member) && !volunteerTimeOff(member)) {
    const check = wwccStatus(member);
    const current = check.kind === 'current' || check.kind === 'expiring';
    if (exemption && !current) {
      const status = exemptionStatus(exemption);
      if (status.problem) issues.push(status.label);
    } else if (application && !current) {
      const status = applicationStatus(application);
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
      // Built as a date, so someone born on 29 February turns 18 on 1 March in
      // other years, as in isMinor and the database.
      const [year, month, day] = member.date_of_birth.split('-').map(Number);
      const eighteenth = new Date(Date.UTC(year + 18, month - 1, day)).toISOString().slice(0, 10);
      if (eighteenth <= in30Days) issues.push(`Turns 18 on ${formatDate(eighteenth)}`);
    }
  }

  return issues;
}
