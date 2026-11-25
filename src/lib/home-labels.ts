/**
 * The words on the cards and banners that used to make up the one Home
 * screen, and now sit on Today, in the hubs and in Me (src/lib/home-layout.ts).
 */
import type { useAuth } from '@/lib/auth';
import { formatDateString } from '@/lib/injuries';
import type { KpiPerson } from '@/lib/kpis';
import { rolesLabel, staffTitle } from '@/lib/labels';
import { hasRole, rolesOf } from '@/lib/roles';
import { isDatedExemption } from '@/lib/safety';
import { isOutstanding, type MyTraining } from '@/lib/training';
import type { AppRole, Profile, TeamMembership } from '@/lib/types';
import { canSendOwnCheck, isGuest, ownCheckExpiring } from '@/lib/wwcc-submissions';

type Auth = ReturnType<typeof useAuth>;

export function awardsLabel(open: number, toVote: number) {
  if (toVote === 0)
    return `✓ You’ve voted in all ${open === 1 ? 'open award' : `${open} open awards`}`;
  return `${toVote} ${toVote === 1 ? 'vote' : 'votes'} waiting for you`;
}

export function trainingLabel(rows: MyTraining[], toCheck: number) {
  const left = rows.filter(isOutstanding).length;
  const parts = [];
  if (rows.length > 0) {
    parts.push(left === 0 ? '✓ All your training is in' : `${left} still to complete`);
  }
  if (toCheck > 0) parts.push(`${toCheck} ${toCheck === 1 ? 'certificate' : 'certificates'} to check`);
  return parts.join(' · ') || 'Certificates and everyone’s progress';
}

/** Such as "3 of yours · 12 people you set them for". */
export function kpisLabel(people: KpiPerson[]) {
  const current = people.filter((p) => !p.archived);
  const mine = current
    .filter((p) => p.relation === 'self')
    .reduce((n, p) => n + p.kpi_count, 0);
  const children = new Set(current.filter((p) => p.relation === 'guardian').map((p) => p.profile_id));
  const setting = new Set(current.filter((p) => p.relation === 'setter').map((p) => p.profile_id));
  const parts = [];
  if (mine > 0) parts.push(`${mine} of yours`);
  if (children.size > 0) parts.push(children.size === 1 ? 'Your child’s' : 'Your children’s');
  if (setting.size > 0) {
    parts.push(`${setting.size} ${setting.size === 1 ? 'person' : 'people'} you set them for`);
  }
  return parts.join(' · ') || 'What each person is working to achieve this season';
}

/** Named teams first, then squads, in club order. */
export function sortMemberships(memberships: TeamMembership[]) {
  return [...memberships].sort(
    (a, b) =>
      (a.team.kind === 'team' ? 0 : 1) - (b.team.kind === 'team' ? 0 : 1) ||
      a.team.sort_order - b.team.sort_order ||
      a.team.name.localeCompare(b.team.name),
  );
}

/** The member's roles for the header, with any paused ones marked. */
export function rolesHeldLabel(
  profile: Profile,
  memberships: TeamMembership[],
  pausedRoles: AppRole[],
) {
  const usable = rolesLabel(
    rolesOf(profile),
    profile.title,
    profile.head_physio,
    staffTitle(memberships),
  );
  if (pausedRoles.length === 0) return usable;
  const pausedLabel = `${rolesLabel(pausedRoles)} (paused)`;
  // A member with every role paused shows as a guest; say what they hold instead.
  return hasRole(profile, 'guest') && rolesOf(profile).length === 1
    ? pausedLabel
    : `${usable}, ${pausedLabel}`;
}

/** Why the member's roles are paused, in a sentence or two. */
export function pausedReason(paused: NonNullable<Auth['paused']>, what: string): string {
  if (paused.stoodDown) {
    return `Your ${what} paused by a club admin. Talk to a club admin about it.`;
  }
  const application = paused.application;
  if (application?.status === 'waiting_for_declaration') {
    return `Your ${what} paused until you accept the declaration for your Working With Children Check application. Open it from your to-do list.`;
  }
  if (application?.status === 'lapsed') {
    return `Your Working With Children Check application has lapsed because nobody confirmed it’s still being assessed, so your ${what} paused. Ask a club admin to check it, or add your card below if it has arrived.`;
  }
  const exemption = paused.exemption;
  if (exemption && !exemption.declared_at) {
    return `Your ${what} paused until you accept the exemption declaration. Open it from your to-do list.`;
  }
  if (exemption) {
    const ended =
      exemption.basis === 'parent_volunteer'
        ? `Your exemption as ${exemption.child_name ?? 'your child'}’s parent no longer applies`
        : isDatedExemption(exemption.basis)
          ? `Your ${exemption.basis === 'national_event' ? 'national event' : 'short-term visitor'} exemption ended${
              exemption.ends_on ? ` on ${formatDateString(exemption.ends_on)}` : ''
            }`
          : 'Your exemption as an under-18 volunteer ended when you turned 18';
    return `${ended}, so your ${what} paused. Apply for a Working With Children Check, then add your card below. A club admin checks it, and your role starts again once they accept it.`;
  }
  return `Your Working With Children Check has expired or isn't recorded, so your ${what} paused. Apply for one or renew it, then add your card below. A club admin checks it, and your role starts again once they accept it. If you never work with children, ask an admin to exempt you with the reason.`;
}

/**
 * Why the member should send in their own card, for the to-do list: a role
 * paused for want of a check (not a stand-down, and not waiting on a
 * declaration they can accept), or their card expiring soon.
 */
export function ownCheckReason(
  profile: Profile | null,
  paused: Auth['paused'],
  exemption: Auth['exemption'],
  application: Auth['wwccApplication'],
): 'paused' | 'expiring' | null {
  if (!canSendOwnCheck(profile, paused?.roles)) return null;
  // A guest's card is optional, so it never becomes a to-do.
  if (isGuest(profile, paused?.roles)) return null;
  if (paused) return waitsOnDeclaration(exemption, application) ? null : 'paused';
  return ownCheckExpiring(profile) ? 'expiring' : null;
}

/** A declaration the member can accept from their to-do list starts their role instead. */
export function waitsOnDeclaration(
  exemption: Auth['exemption'],
  application: Auth['wwccApplication'],
) {
  return (
    (!!exemption && !exemption.declared_at) ||
    (!!application && !application.declared_at && application.status === 'waiting_for_declaration')
  );
}

/**
 * Such as "Check-ins: yes · Injuries: not given". Check-ins are left out while
 * Daily check-ins is off for the child and no consent was given for them.
 */
export function consentSummary(a: {
  data: boolean;
  health: boolean;
  canConsent: boolean;
  checkInsOn: boolean;
}) {
  if (!a.canConsent && !a.data && !a.health) return 'Waiting for an admin to verify you';
  const word = (on: boolean) => (on ? 'yes' : 'not given');
  const injuries = `Injuries: ${word(a.health)}`;
  return a.checkInsOn || a.data ? `Check-ins: ${word(a.data)} · ${injuries}` : injuries;
}
