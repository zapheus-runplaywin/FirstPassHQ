/**
 * A member's page for admins, in tabs (src/app/admin/[id].tsx): which tabs a
 * member has, which one a to-do opens, the line that says who they are, and
 * what Overview lists as needing attention.
 *
 * Nothing here decides what an admin may see or change. Every tab is part of
 * the one page only admins can open, and saving goes through the same
 * functions whichever tab the admin is on.
 */
import { rolesLabel, statusLabels } from '@/lib/labels';
import type { MemberSection } from '@/lib/member-todos';
import { needsWwcc, wwccStatus } from '@/lib/safety';
import type { AppRole, Profile } from '@/lib/types';

export const memberTabs = ['overview', 'roles', 'checks', 'family', 'history'] as const;

export type MemberTab = (typeof memberTabs)[number];

export const memberTabLabels: Record<MemberTab, string> = {
  overview: 'Overview',
  roles: 'Roles',
  checks: 'Checks',
  family: 'Family',
  history: 'History',
};

/** The tab each part of the page is on, for a to-do that opens the page at that part. */
const SECTION_TABS: Record<MemberSection, MemberTab> = {
  approve: 'overview',
  delete: 'overview',
  physio: 'roles',
  'date-of-birth': 'checks',
  wwcc: 'checks',
  notices: 'checks',
  guardians: 'family',
};

/** The tab a page opens on: the one holding the part a to-do is about, or Overview. */
export function tabForSection(section: MemberSection | null): MemberTab {
  return section ? SECTION_TABS[section] : 'overview';
}

/**
 * The tabs a member's page has. Overview and Roles always; Checks, Family and
 * History only when they hold something for this member, so no tab is empty.
 */
export function shownTabs(has: { checks: boolean; family: boolean; history: boolean }): MemberTab[] {
  return memberTabs.filter(
    (tab) => tab === 'overview' || tab === 'roles' || has[tab],
  );
}

/** The tab to show: the one asked for when the member has it, or Overview. */
export function tabToShow(wanted: MemberTab, tabs: MemberTab[]): MemberTab {
  return tabs.includes(wanted) ? wanted : 'overview';
}

/**
 * Who they are in one line, above the tabs: "Approved · Coach, Guardian ·
 * Open A", "Pending · Asked to join as an athlete · Open", or "Rejected ·
 * Not a club member".
 */
export function memberLead({
  member,
  places,
  asked,
  reason,
}: {
  member: Pick<Profile, 'status' | 'role' | 'extra_roles' | 'title' | 'head_physio' | 'join_requested_at'>;
  /** The squads and teams they are in now, by name. */
  places: string[];
  /** What they asked for, such as "Asked to join as an athlete · Open". */
  asked: string;
  /** Why they weren't approved or lost access, in words. */
  reason: string | null;
}): string {
  if (member.status === 'approved') {
    const roles = [member.role, ...member.extra_roles.filter((r) => r !== member.role)];
    return [statusLabels.approved, rolesLabel(roles, member.title, member.head_physio), places.join(', ')]
      .filter(Boolean)
      .join(' · ');
  }
  if (member.status === 'rejected') {
    return [statusLabels.rejected, reason].filter(Boolean).join(' · ');
  }
  return [statusLabels.pending, member.join_requested_at ? asked : 'Hasn’t asked to join yet'].join(
    ' · ',
  );
}

/**
 * The line above the tabs for someone whose roles are paused: stood down, or
 * without the check their role needs. Null when nothing is paused. It shows
 * on every tab, so it is never out of sight.
 */
export function pausedNotice({
  approved,
  stoodDownOn,
  paused,
}: {
  approved: boolean;
  /** The day they were stood down, as the page writes days, or null. */
  stoodDownOn: string | null;
  /** The roles they hold but can't use now (`pausedRoles`). */
  paused: AppRole[];
}): string | null {
  if (!approved) return null;
  const which = paused.length > 0 ? `Paused: ${rolesLabel(paused)}.` : '';
  if (stoodDownOn) {
    return [`Stood down since ${stoodDownOn}.`, which].filter(Boolean).join(' ');
  }
  return paused.length > 0
    ? `${which} They can’t use ${paused.length === 1 ? 'this role' : 'these roles'} until their Working With Children Check is sorted out.`
    : null;
}

/** Something about a member an admin should look at, and the tab it is sorted out on. */
export type MemberAttention = { text: string; tab: MemberTab };

/**
 * The tab an issue from `safetyIssues` (src/lib/safety.ts) is sorted out on:
 * a locked child or one about to turn 18 on Family, everything else (checks,
 * exemptions, applications, a missing date of birth) on Checks.
 */
export function issueTab(issue: string): MemberTab {
  return /^(Locked|Turns 18)/.test(issue) ? 'family' : 'checks';
}

const STOOD_DOWN = 'Stood down';

export type MemberAttentionInput = {
  member: Pick<
    Profile,
    | 'status'
    | 'verified_at'
    | 'date_of_birth'
    | 'wwcc_number'
    | 'wwcc_expires_on'
    | 'wwcc_exempt_reason'
  >;
  /** The roles the page would save, main role first. */
  roles: AppRole[];
  /** `safetyIssues` for an approved member: the same lines the member list shows. */
  issues: string[];
  /** Why their roles can't be held together, if they can't. */
  comboProblem: string | null;
  /** They have a volunteer exemption that hasn't ended. */
  hasOpenExemption: boolean;
  /** Parents who entered this child's link code and wait for an answer. */
  parentCodes: number;
  /** Children whose link code this parent entered and wait for an answer. */
  childCodes: number;
};

/**
 * What Overview lists under "Needs attention", most pressing first. For an
 * approved member it is the list the member list shows under their name,
 * plus link codes waiting for an answer. For someone not approved yet it is
 * what an admin sorts out before approving them. Being stood down is said
 * above the tabs instead (`pausedNotice`).
 */
export function memberAttention({
  member,
  roles,
  issues,
  comboProblem,
  hasOpenExemption,
  parentCodes,
  childCodes,
}: MemberAttentionInput): MemberAttention[] {
  const items: MemberAttention[] = [];
  if (comboProblem) items.push({ text: comboProblem, tab: 'roles' });

  for (const issue of issues) {
    if (issue !== STOOD_DOWN) items.push({ text: issue, tab: issueTab(issue) });
  }

  const approved = member.status === 'approved';
  // A parent or guardian is verified before they're linked to a child, approved or not.
  if (!member.verified_at && (!approved || roles.includes('guardian'))) {
    items.push({ text: 'Not verified yet', tab: 'checks' });
  }

  if (!approved) {
    if ((roles.includes('athlete') || roles.includes('guest')) && !member.date_of_birth) {
      items.push({ text: 'No date of birth checked yet', tab: 'checks' });
    }
    const [role = 'guest', ...extra_roles] = roles;
    const check = wwccStatus(member);
    if (
      needsWwcc({ role, extra_roles, wwcc_exempt_reason: member.wwcc_exempt_reason }) &&
      !hasOpenExemption &&
      check.problem
    ) {
      items.push({ text: check.label, tab: 'checks' });
    }
  }

  if (parentCodes > 0) {
    items.push({
      text:
        parentCodes === 1
          ? 'A parent entered their link code'
          : `${parentCodes} parents entered their link code`,
      tab: 'family',
    });
  }
  if (childCodes > 0) {
    items.push({
      text:
        childCodes === 1
          ? 'They entered a child’s link code'
          : `They entered ${childCodes} children’s link codes`,
      tab: 'family',
    });
  }
  return items;
}
