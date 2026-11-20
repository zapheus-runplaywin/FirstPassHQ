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

/** "Child Safety Officer · WWC Registration Officer", or '' for none. */
export function safeguardingPostsLabel(posts: SafeguardingPost[]): string {
  return ORDER.filter((post) => posts.includes(post))
    .map((post) => safeguardingPostLabels[post])
    .join(' · ');
}
