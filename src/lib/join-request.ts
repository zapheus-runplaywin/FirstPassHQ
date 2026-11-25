/**
 * A join request as one decision: what to check before approving, in the
 * order an admin checks it, and whether Approve can be pressed from the
 * request's summary or something has to be recorded in the full record first.
 *
 * Nothing here approves anyone or relaxes a rule. The database decides
 * (`public.admin_save_member`); this only says beforehand what it will ask
 * for, so the admin sees each check before Approve instead of as a refusal
 * after it. Where this and the database differ, the database's refusal shows
 * on the page as it always has.
 */
import { formatDate, isMinor, isUnder13 } from '@/lib/age';
import { roleLabels } from '@/lib/labels';
import { ageOn, localDay } from '@/lib/reports';
import { exemptableRoles, wwccRoles, wwccStatus } from '@/lib/safety';
import type { AppRole, Profile, VerificationMethod } from '@/lib/types';

/** A check that passed, one that stops Approve until it is sorted out, or something to know. */
export type JoinCheckTone = 'done' | 'attention' | 'note';

export type JoinCheckKey =
  | 'name'
  | 'roles'
  | 'under-13'
  | 'identity'
  | 'date-of-birth'
  | 'parent'
  | 'child'
  | 'guest-age'
  | 'wwcc';

export type JoinCheck = {
  key: JoinCheckKey;
  tone: JoinCheckTone;
  text: string;
  /** Approve waits for this one. */
  blocks: boolean;
};

type RequestMember = Pick<
  Profile,
  | 'status'
  | 'join_requested_at'
  | 'requested_role'
  | 'full_name'
  | 'preferred_name'
  | 'email'
  | 'verified_at'
  | 'verification_method'
  | 'date_of_birth'
  | 'declared_date_of_birth'
  | 'guardian_email'
  | 'wwcc_number'
  | 'wwcc_expires_on'
  | 'wwcc_exempt_reason'
>;

/** What the join request to-do asks for, on the request's summary. */
export const JOIN_SUMMARY_ACTION =
  'Read the checks, then Approve or Don’t approve. To change their role, squad or team first, open the full record.';

/** What they go by: their preferred name, or the first word of their name. */
export function firstNameOf(member: Pick<Profile, 'full_name' | 'preferred_name'>) {
  return member.preferred_name?.trim() || member.full_name?.trim().split(/\s+/)[0] || '';
}

/** "a", or "an" before a vowel sound, for a role inside a sentence. */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** What they asked for, as one line: "Asked to join as an athlete · Mixed Open Squad". */
export function askedLine(
  member: Pick<Profile, 'requested_role'>,
  requestedGroup: string | null | undefined,
) {
  if (!member.requested_role) return 'Asked to join';
  const role = roleLabels[member.requested_role].toLowerCase();
  return [`Asked to join as ${article(role)} ${role}`, requestedGroup].filter(Boolean).join(' · ');
}

/**
 * Whether a member's page opens on the request's summary: someone waiting
 * for approval who has asked to join, opened for that decision. A temporary
 * helper is set up over several steps (their task, dates and declaration), so
 * their request opens on the full record, as does a request an admin has
 * already saved places for, and a page opened by a to-do about something else.
 */
export function opensOnJoinSummary(
  member: Pick<Profile, 'status' | 'join_requested_at' | 'requested_role'>,
  {
    isSelf,
    hasPlaces,
    forAnotherSection,
  }: { isSelf: boolean; hasPlaces: boolean; forAnotherSection: boolean },
) {
  return (
    member.status === 'pending' &&
    !!member.join_requested_at &&
    member.requested_role !== 'volunteer' &&
    !isSelf &&
    !hasPlaces &&
    !forAnotherSection
  );
}

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** How someone was verified, to end "Verified on 12/11/2026". */
const HOW_VERIFIED: Record<VerificationMethod, string> = {
  code: ', with their code',
  playhq: ', matched to PlayHQ',
  id_sighted: ', with ID sighted',
};

const dated = (iso: string) => `${formatDate(iso)} (${ageOn(iso)})`;

export type JoinChecksInput = {
  member: RequestMember;
  /** The roles Approve would give them, main role first. */
  roles: AppRole[];
  /**
   * The date of birth Approve would record: null for none, undefined when the
   * field doesn't hold a date.
   */
  dob: string | null | undefined;
  /** A child's parents and guardians as the page would link them. */
  parents?: { name: string; unlocks: boolean }[];
  /** The parents who entered this child's link code. */
  codeEnteredBy?: string[];
  /** For a parent: the children whose code they entered, or who are linked to them. */
  children?: { name: string; approved: boolean }[];
  /** Why these roles can't be held together, if they can't. */
  comboProblem?: string | null;
  /** They have a volunteer exemption that hasn't ended. */
  hasOpenExemption?: boolean;
};

/**
 * The checks on a join request, in the order they are read. A check that
 * `blocks` is one the database would refuse the approval for.
 */
export function joinChecks({
  member,
  roles,
  dob,
  parents = [],
  codeEnteredBy = [],
  children = [],
  comboProblem = null,
  hasOpenExemption = false,
}: JoinChecksInput): JoinCheck[] {
  const checks: JoinCheck[] = [];
  const add = (key: JoinCheckKey, tone: JoinCheckTone, text: string) =>
    checks.push({ key, tone, text, blocks: tone === 'attention' });
  const isAthlete = roles.includes('athlete');
  const isGuardian = roles.includes('guardian');
  const isGuest = roles.includes('guest');
  const who = firstNameOf(member) || 'They';

  if (!member.full_name?.trim()) {
    add('name', 'attention', 'They have no name yet. Ask them to add their name before you approve them.');
  }
  if (comboProblem) add('roles', 'attention', comboProblem);

  // Nobody under 13 joins, whatever they asked for and whichever date says so.
  const tooYoung = [dob, member.date_of_birth, member.declared_date_of_birth].some((d) =>
    isUnder13(d),
  );
  if (tooYoung) {
    add(
      'under-13',
      'attention',
      'Under 13. FirstPass HQ is for members aged 13 and over, so don’t approve this request.',
    );
  }

  // Who they are.
  if (member.verified_at) {
    const how = member.verification_method ? HOW_VERIFIED[member.verification_method] : '';
    add('identity', 'done', `Verified on ${localDay(member.verified_at)}${how}.`);
  } else if (isGuardian) {
    add(
      'identity',
      'attention',
      'Not verified yet. A parent or guardian is verified before they’re approved: check their 6-digit code below, or record what you checked in the full record.',
    );
  } else {
    add(
      'identity',
      'note',
      'Not verified yet. Check them against PlayHQ, or ask for their 6-digit code and check it below.',
    );
  }

  // An athlete's or guest's date of birth, checked by an admin.
  if (isAthlete || isGuest) {
    const role = isAthlete ? 'an athlete' : 'a guest';
    if (dob === undefined) {
      add('date-of-birth', 'attention', 'The date of birth isn’t a date. Fix it in the full record.');
    } else if (!dob) {
      add(
        'date-of-birth',
        'attention',
        `No date of birth. Add it in the full record, checked against PlayHQ or ID, before you approve ${role}.`,
      );
    } else if (dob === member.date_of_birth) {
      add('date-of-birth', 'done', `Date of birth ${dated(dob)}, already checked.`);
    } else if (dob === member.declared_date_of_birth) {
      add(
        'date-of-birth',
        'note',
        `Date of birth they gave: ${dated(dob)}. Check it against PlayHQ or ID. Approving records it as checked.`,
      );
    } else {
      add(
        'date-of-birth',
        'note',
        `Date of birth ${dated(dob)}, as you entered it${
          member.declared_date_of_birth
            ? `, not the date they gave (${formatDate(member.declared_date_of_birth)})`
            : ''
        }. Approving records it as checked.`,
      );
    }
  }

  // A child stays locked until a verified parent or guardian is linked.
  if (isAthlete && dob && isMinor(dob, false) && !tooYoung) {
    const unlocking = parents.filter((p) => p.unlocks).map((p) => p.name);
    if (unlocking.length > 0) {
      add('parent', 'done', `Under 18, with a verified parent or guardian linked: ${list(unlocking)}.`);
    } else {
      const locked = `Under 18: ${who === 'They' ? 'their' : `${who}’s`} app stays locked until a verified parent or guardian is linked.`;
      const email = member.guardian_email ? ` Guardian email they gave: ${member.guardian_email}.` : '';
      add(
        'parent',
        'note',
        codeEnteredBy.length > 0
          ? `${locked} ${list(codeEnteredBy)} entered their code: approve or link them next.`
          : `${locked} No parent has entered their code yet.${email}`,
      );
    }
  }

  // Guests get none of the protections for children, so they are adults.
  if (isGuest && dob && isMinor(dob, false) && !tooYoung) {
    add(
      'guest-age',
      'attention',
      'Under 18. Guests must be 18 or over: in the full record, approve them as an athlete with a parent or guardian linked instead.',
    );
  }

  // A parent or guardian is approved after one of their children.
  if (isGuardian) {
    const approved = children.filter((c) => c.approved).map((c) => c.name);
    const waiting = children.filter((c) => !c.approved).map((c) => c.name);
    if (approved.length > 0) {
      add('child', 'done', `Parent or guardian of ${list(approved)}. Approving links them.`);
    } else if (waiting.length > 0) {
      add(
        'child',
        'attention',
        `Approve their child first: ${list(waiting)} ${waiting.length === 1 ? 'is' : 'are'} still waiting.`,
      );
    } else {
      add(
        'child',
        'attention',
        'They haven’t entered a child’s link code yet. Their child sees the code in the app. To add a child who won’t use the app, open the full record.',
      );
    }
  }

  // Working With Children Check, for the roles that need one.
  const always = roles.some((r) => wwccRoles.includes(r));
  const unlessExempt = roles.some((r) => exemptableRoles.includes(r));
  if (always || unlessExempt) {
    const card = wwccStatus(member);
    if (card.kind === 'current' || card.kind === 'expiring') {
      add(
        'wwcc',
        'done',
        `Working With Children Check on record, expires ${formatDate(member.wwcc_expires_on)}.`,
      );
    } else if (!always && member.wwcc_exempt_reason?.trim()) {
      add('wwcc', 'done', `Exempt from a Working With Children Check: ${member.wwcc_exempt_reason.trim()}`);
    } else if (hasOpenExemption && (always || roles.includes('statistician'))) {
      add('wwcc', 'done', 'A volunteer exemption is recorded in place of a Working With Children Check.');
    } else {
      add(
        'wwcc',
        'attention',
        always
          ? 'No current Working With Children Check. Record their card, an application they’ve lodged or a volunteer exemption in the full record first.'
          : 'No current Working With Children Check. Record their card or an application they’ve lodged, or exempt them with a reason, in the full record first.',
      );
    }
  }

  return checks;
}

/** Whether the request can be approved from its summary: nothing is in the way. */
export const canApproveHere = (checks: JoinCheck[]) => !checks.some((check) => check.blocks);
