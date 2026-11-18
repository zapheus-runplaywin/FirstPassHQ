import { LINK_CODE_ALPHABET } from '@/lib/guardian-links';

/**
 * A new club's setup code (`public.issue_first_admin_code`): FirstPass gives
 * it to the person setting the club up, and entering it on "Request to join"
 * makes them the club's first admin (`public.claim_first_admin`). It works
 * once, and only while the club has no admin.
 */

/** What was typed, as the database compares it: capitals, no dashes or spaces. */
export function normaliseSetupCode(typed: string) {
  return typed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** Whether what was typed could be a setup code at all, before asking the database. */
export function looksLikeSetupCode(typed: string) {
  const code = normaliseSetupCode(typed);
  return code.length === 12 && [...code].every((c) => LINK_CODE_ALPHABET.includes(c));
}
