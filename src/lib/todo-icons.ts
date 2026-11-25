import type { Href } from 'expo-router';

import type { IconName } from '@/components/icon';

/**
 * The icon beside a to-do on Today, from the screen it opens: every to-do
 * for the same part of the app looks the same, and a new kind of to-do gets
 * an icon without anyone having to remember to give it one.
 */
const BY_SCREEN: [prefix: string, icon: IconName][] = [
  ['/check-ins', 'activity'],
  ['/check-in', 'smile'],
  ['/injuries', 'plus-circle'],
  ['/attendance', 'clipboard'],
  ['/session-plans', 'file-text'],
  ['/concerns', 'shield'],
  ['/concern', 'shield'],
  ['/consent', 'check-square'],
  ['/conduct', 'file-text'],
  ['/medical', 'heart'],
  ['/children', 'users'],
  ['/awards', 'award'],
  ['/training', 'book-open'],
  ['/surveys', 'list'],
  ['/goals', 'target'],
  ['/team', 'users'],
  ['/kpis', 'trending-up'],
  ['/assessments', 'eye'],
  ['/selection', 'flag'],
  ['/registers', 'folder'],
  ['/declare-conflicts', 'folder'],
  ['/declaration', 'credit-card'],
  ['/wwcc-application', 'credit-card'],
  ['/wwcc', 'credit-card'],
  ['/messages', 'message-square'],
  ['/admin/reports', 'bar-chart-2'],
  ['/admin/kpi-reviews', 'trending-up'],
  ['/admin/training', 'book-open'],
  ['/admin/safeguarding', 'shield'],
  ['/admin/club', 'settings'],
  ['/admin', 'user-check'],
  ['/my-details', 'user'],
  ['/tasks', 'check-circle'],
];

/** For a to-do that opens somewhere this list doesn't know yet. */
const FALLBACK: IconName = 'check-circle';

export function todoIcon(href: Href): IconName {
  const path = typeof href === 'string' ? href : href.pathname;
  // The longest screen that matches wins, so "/admin/reports" beats "/admin".
  const match = BY_SCREEN.filter(
    ([prefix]) =>
      path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
  ).sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] ?? FALLBACK;
}
