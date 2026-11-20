/**
 * The member's own inbox: what shows as unread, and what "Hide read" and
 * "Mark all read" do to the list on screen. The database keeps the same rule
 * in the `unread` column of message_recipients
 * (supabase/migrations/20261120600000_message_read_controls.sql).
 */
import type { InboxMessage } from '@/lib/types';

/**
 * Whether a message shows as unread in the member's own inbox. "Mark all
 * read" and "Mark as unread" change this without touching `read_at`, which is
 * the sender's read receipt and only ever means the member opened it.
 */
export function isUnread(copy: Pick<InboxMessage, 'read_at' | 'unread'>) {
  return copy.unread ?? !copy.read_at;
}

/** The inbox as shown: only the unread messages when "Hide read" is on. */
export function shownInbox(messages: InboxMessage[], hideRead: boolean) {
  return hideRead ? messages.filter(isUnread) : messages;
}

/** The inbox after "Mark all read": every message read, receipts untouched. */
export function markedAllRead(messages: InboxMessage[]) {
  return messages.map((m) => (isUnread(m) ? { ...m, unread: false } : m));
}
