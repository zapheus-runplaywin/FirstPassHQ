/**
 * What has changed around an under 18, for their parents and guardians, and
 * which of it is new since they last looked.
 *
 * The database counts a change as new when it happened after the parent last
 * opened the list (`child_activity_new`), and gives the list newest first
 * (`child_activity`), so the new changes are the first ones on it. The screen
 * asks for both before it marks the list seen.
 */

export type ChildActivity = { kind: string; summary: string; happened_at: string };

/**
 * When the oldest new change happened, or null when nothing is new. Every
 * change at or after it is new: two changes at the same moment are on the
 * same side of when the parent last looked.
 */
export function newFromTime(entries: ChildActivity[], newCount: number): string | null {
  const count = Math.min(Math.max(0, Math.floor(newCount)), entries.length);
  return count > 0 ? entries[count - 1].happened_at : null;
}

/**
 * Keeps the first answer while the parent stays on the screen: after the list
 * is marked seen, the database says nothing is new, but the parent is still
 * reading those changes, so they stay marked until they leave. A change that
 * arrives while they are there is newer still, so it is marked too.
 */
export function keepNewFrom(previous: string | null, latest: string | null) {
  return previous ?? latest;
}

/** The list split into what is new since the parent last looked and what came before. */
export function splitByNew(entries: ChildActivity[], newFrom: string | null) {
  if (!newFrom) return { fresh: [] as ChildActivity[], earlier: entries };
  const from = Date.parse(newFrom);
  const fresh: ChildActivity[] = [];
  const earlier: ChildActivity[] = [];
  for (const entry of entries) {
    (Date.parse(entry.happened_at) >= from ? fresh : earlier).push(entry);
  }
  return { fresh, earlier };
}

/** The heading over the new changes. */
export function newHeading(count: number) {
  return count === 1 ? '1 new since you last looked' : `${count} new since you last looked`;
}
