import type { InjuryStatus } from '@/lib/types';

/**
 * What an admin is told under a feature's switch when they turn it off and
 * haven't saved yet. Turning a feature off pauses it: nothing is deleted or
 * cancelled, and turning it back on picks up where it stopped (Matt,
 * 2026-11-19).
 */

/** Injuries that are still open, and how many of them are part-way to clearance. */
export function openInjuryCounts(injuries: { status: InjuryStatus }[]) {
  const open = injuries.filter((i) => i.status !== 'cleared');
  return {
    open: open.length,
    clearances: open.filter(
      (i) => i.status === 'clearance_requested' || i.status === 'coach_endorsed',
    ).length,
  };
}

/** The warning for turning Injuries off, or null while the counts are loading. */
export function injuriesOffWarning(counts: { open: number; clearances: number } | null) {
  if (!counts) return null;
  const paused =
    'Nothing is deleted. Members can’t see, report or sign off injuries while it’s off, and get no injury to-dos. Turning it back on brings every injury and clearance back where it stopped. Registers keep showing “Injured” for athletes with an open injury.';
  if (counts.open === 0) return `No injuries are open. ${paused}`;
  const injuries = `${counts.open} ${counts.open === 1 ? 'injury is' : 'injuries are'} open`;
  const clearances =
    counts.clearances === 0
      ? ''
      : `, and ${counts.clearances} ${counts.clearances === 1 ? 'is' : 'are'} waiting for clearance sign-off, which will wait too`;
  return `${injuries}${clearances}. ${paused}`;
}

/** The note for turning Daily check-ins off. */
export const checkInsOffNote =
  'Parents who haven’t answered the check-in consent question no longer see it. Consents already given are kept, so turning check-ins back on asks only the parents who never gave it.';

/** The note for turning Live streams off. */
export const liveStreamsOffNote =
  'Parents no longer see the question about their child’s stats on live streams. Consents already given are kept and still count if a game is streamed.';
