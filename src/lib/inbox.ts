/**
 * The member's own inbox: what shows as unread, what "Mark all read" changes,
 * and how archiving moves a message between Inbox and Archived. The database
 * keeps the same rules in message_recipients (`unread` in
 * supabase/migrations/20261120600000_message_read_controls.sql and
 * `archived_at` in 20261121100000_message_archive_and_access.sql).
 *
 * Nothing is ever deleted. Archiving moves only the member's own copy: the
 * sender, the other recipients and parents' copies are untouched.
 */
import type { InboxMessage, Message } from '@/lib/types';

/**
 * The note on a group post a coach hid, for the few who still see it. Others
 * in the group, and their parents, no longer get it at all.
 */
export function hiddenNote(message: Pick<Message, 'removed_at' | 'removed_by_name'>) {
  return message.removed_at
    ? `Hidden from the group by ${message.removed_by_name ?? 'a coach'}. Only its author, the group’s coaches and the author’s parents see it.`
    : null;
}

/**
 * The boxes across the top of Messages, each with its unread count. Sent
 * shows only for members who can send, and Groups only while the club has
 * chat groups on.
 */
export type MessageBox = 'inbox' | 'sent' | 'archived' | 'groups';

export function messageBoxes(
  canSend: boolean,
  groupsOn = false,
  groupsUnread = 0,
  inboxUnread = 0,
): { value: MessageBox; label: string; count?: number }[] {
  return [
    { value: 'inbox', label: 'Inbox', count: inboxUnread },
    ...(canSend ? [{ value: 'sent' as const, label: 'Sent' }] : []),
    { value: 'archived', label: 'Archived' },
    ...(groupsOn ? [{ value: 'groups' as const, label: 'Groups', count: groupsUnread }] : []),
  ];
}

/**
 * Whether a message shows as unread in the member's own inbox. "Mark all
 * read" and "Mark as unread" change this without touching `read_at`, which is
 * the sender's read receipt and only ever means the member opened it.
 */
export function isUnread(copy: Pick<InboxMessage, 'read_at' | 'unread'>) {
  return copy.unread ?? !copy.read_at;
}

export function isArchived(copy: Pick<InboxMessage, 'archived_at'>) {
  return !!copy.archived_at;
}

/** The inbox after "Mark all read": every message read, receipts untouched. */
export function markedAllRead(messages: InboxMessage[]) {
  return messages.map((m) => (isUnread(m) ? { ...m, unread: false } : m));
}

/**
 * The member's copy once archived: out of the inbox and no longer unread.
 * The sender's receipt (`read_at`) doesn't change, as with "Mark all read".
 */
export function archivedCopy(copy: InboxMessage, now = new Date()): InboxMessage {
  return {
    ...copy,
    archived_at: copy.archived_at ?? now.toISOString(),
    unread: false,
  };
}

/** The member's copy moved back to the inbox. It stays read. */
export function movedToInbox(copy: InboxMessage): InboxMessage {
  return { ...copy, archived_at: null };
}

/**
 * Moves one message from one list to the other, as the screen shows it
 * before the database answers. `from` loses the message; `to` gains it in
 * date order, newest first.
 */
export function moveBetween(
  from: InboxMessage[],
  to: InboxMessage[],
  messageId: string,
  change: (copy: InboxMessage) => InboxMessage,
): { from: InboxMessage[]; to: InboxMessage[] } {
  const copy = from.find((m) => m.message.id === messageId);
  if (!copy) return { from, to };
  const moved = change(copy);
  const next = [...to.filter((m) => m.message.id !== messageId), moved].sort((a, b) =>
    b.message.created_at.localeCompare(a.message.created_at),
  );
  return { from: from.filter((m) => m.message.id !== messageId), to: next };
}

/** How far a row must be swiped left, in points, before letting go archives it. */
export const SWIPE_TO_ARCHIVE = 96;

/** Whether a swipe that ended this far (negative is left) archives the message. */
export function swipeArchives(dx: number) {
  return dx <= -SWIPE_TO_ARCHIVE;
}
