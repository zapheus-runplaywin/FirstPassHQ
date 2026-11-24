/**
 * The club's safeguarding posts an admin names in Administration >
 * Safeguarding. They aren't roles: each is held by a member alongside their
 * own roles, and shown as a title under them.
 */
export type SafeguardingPost =
  | 'child_safety_officer'
  | 'complaints_manager'
  | 'wwc_registration_officer';

export const safeguardingPostLabels: Record<SafeguardingPost, string> = {
  child_safety_officer: 'Child Safety Officer',
  complaints_manager: 'Complaints Manager',
  wwc_registration_officer: 'WWC Registration Officer',
};

const ORDER: SafeguardingPost[] = [
  'child_safety_officer',
  'complaints_manager',
  'wwc_registration_officer',
];

/**
 * The posts held, from `my_safeguarding_posts()`: one row of three yes/no
 * columns, or nothing. The database only says yes while the member can act in
 * the post (an approved adult with a current check, not stood down).
 */
export function safeguardingPostsFrom(row: unknown): SafeguardingPost[] {
  if (!row || typeof row !== 'object') return [];
  const held = row as Partial<Record<SafeguardingPost, unknown>>;
  return ORDER.filter((post) => held[post] === true);
}

/**
 * Every post the member holds or acts in, in the fixed order. An admin acts
 * in a post (`my_acting_safeguarding_posts()`, read with
 * `safeguardingPostsFrom`) while nobody named in it can act, with its full
 * powers, until someone is named (Matt, 24 November 2026).
 */
export function heldOrActing(
  held: SafeguardingPost[],
  acting: SafeguardingPost[],
): SafeguardingPost[] {
  return ORDER.filter((post) => held.includes(post) || acting.includes(post));
}

/** "Child Safety Officer (acting)" for a post an admin acts in, else its name. */
export function safeguardingPostTitle(post: SafeguardingPost, acting: SafeguardingPost[] = []) {
  const label = safeguardingPostLabels[post];
  return acting.includes(post) ? `${label} (acting)` : label;
}

/**
 * "Child Safety Officer · WWC Registration Officer", or '' for none. A post in
 * `acting` reads "Child Safety Officer (acting)".
 */
export function safeguardingPostsLabel(
  posts: SafeguardingPost[],
  acting: SafeguardingPost[] = [],
): string {
  return ORDER.filter((post) => posts.includes(post))
    .map((post) => safeguardingPostTitle(post, acting))
    .join(' · ');
}
