import { formatDate } from '@/lib/age';
import { needsWwcc, wwccStatus } from '@/lib/safety';
import type { AppRole, MyWwccSubmission, Profile } from '@/lib/types';

/**
 * Members send in their own Working With Children Check: the card number,
 * expiry and name on the card. It counts for nothing until an admin checks it
 * and accepts it, which records and validates the card in one step
 * (`submit_my_wwcc` and `admin_accept_wwcc_submission` in the database).
 */

/**
 * Whether the member can send in their own card: approved, not stood down,
 * and holding a role that needs a check, counting roles paused for want of
 * one. Same rule as `public.submit_my_wwcc`.
 */
export function canSendOwnCheck(
  profile: Pick<
    Profile,
    'status' | 'role' | 'extra_roles' | 'wwcc_exempt_reason' | 'stood_down_at'
  > | null,
  pausedRoles: AppRole[] = [],
): boolean {
  if (!profile || profile.status !== 'approved' || profile.stood_down_at) return false;
  const held = [...new Set([profile.role, ...profile.extra_roles, ...pausedRoles])];
  const [role = 'guest', ...extra] = held;
  return needsWwcc({
    role,
    extra_roles: extra,
    wwcc_exempt_reason: profile.wwcc_exempt_reason,
  });
}

/** What the member reads about the card they sent in, in a sentence. */
export function submissionStatusText(submission: MyWwccSubmission): string {
  const card = `card ${submission.card_number}, expiring ${formatDate(submission.expires_on)}`;
  if (submission.status === 'returned') {
    const note = submission.return_note ? ` Their note: “${submission.return_note}”` : '';
    return `A club admin sent back your ${card}.${note} Check the details and send it again.`;
  }
  return `You sent in your ${card}. A club admin will check it with the Screening Unit. Your role starts again once they accept it.`;
}

/**
 * Whether the member's own recorded card runs out within the warning window,
 * so they can send in the renewed one before their role pauses.
 */
export function ownCheckExpiring(
  profile: Pick<Profile, 'wwcc_number' | 'wwcc_expires_on'> | null,
): boolean {
  return !!profile && wwccStatus(profile).kind === 'expiring';
}
