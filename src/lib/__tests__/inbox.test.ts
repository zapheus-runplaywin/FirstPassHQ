/**
 * The messages inbox (src/lib/inbox.ts): what counts as unread, what Mark all
 * read changes, and how archiving moves a message between Inbox and Archived.
 * The sender's read receipt (`read_at`) is never changed by any of them, and
 * nothing is ever deleted.
 */
import {
  archivedCopy,
  isArchived,
  isUnread,
  markedAllRead,
  messageBoxes,
  moveBetween,
  movedToInbox,
  SWIPE_TO_ARCHIVE,
  swipeArchives,
} from '@/lib/inbox';
import type { InboxMessage, Message } from '@/lib/types';

const MESSAGE: Message = {
  id: 'm1',
  sender_id: 'coach',
  sender_name: 'Coach',
  body: 'Hello',
  audience: 'club',
  audience_role: null,
  audience_label: null,
  created_at: '2026-11-20T00:00:00Z',
};

function row(id: string, read_at: string | null, unread?: boolean): InboxMessage {
  return {
    read_at,
    unread,
    for_children: null,
    for_child_names: null,
    message: { ...MESSAGE, id },
  };
}

describe('isUnread', () => {
  it.each<[string, string | null, boolean | undefined, boolean]>([
    ['never opened', null, true, true],
    ['opened', '2026-11-20T01:00:00Z', false, false],
    ['opened, then marked unread', '2026-11-20T01:00:00Z', true, true],
    ['cleared with Mark all read, never opened', null, false, false],
    ['never opened, from before the unread column', null, undefined, true],
    ['opened, from before the unread column', '2026-11-20T01:00:00Z', undefined, false],
  ])('%s', (_l, readAt, unread, expected) => {
    expect(isUnread({ read_at: readAt, unread })).toBe(expected);
  });
});

describe('messageBoxes', () => {
  it('gives senders Inbox, Sent and Archived, in that order', () => {
    expect(messageBoxes(true).map((b) => b.label)).toEqual(['Inbox', 'Sent', 'Archived']);
  });

  it('gives everyone else Inbox and Archived, with no Sent', () => {
    expect(messageBoxes(false).map((b) => b.value)).toEqual(['inbox', 'archived']);
  });

  it('adds Groups last while the club has chat groups on', () => {
    expect(messageBoxes(true, true).map((b) => b.label)).toEqual(['Inbox', 'Sent', 'Archived', 'Groups']);
    expect(messageBoxes(false, false).map((b) => b.value)).not.toContain('groups');
  });

  it('carries the unread counts for Inbox and Groups, and none for Sent or Archived', () => {
    const boxes = messageBoxes(true, true, 3, 5);
    const count = (value: string) => boxes.find((b) => b.value === value)?.count;
    expect(count('inbox')).toBe(5);
    expect(count('groups')).toBe(3);
    expect(count('sent')).toBeUndefined();
    expect(count('archived')).toBeUndefined();
    // The names stay plain: the count is drawn as a badge beside them.
    expect(boxes.map((b) => b.label)).toEqual(['Inbox', 'Sent', 'Archived', 'Groups']);
  });
});

describe('archiving', () => {
  const now = new Date('2026-11-21T09:00:00Z');

  it('moves the copy to Archived and clears its dot', () => {
    const after = archivedCopy(row('a', null, true), now);
    expect(isArchived(after)).toBe(true);
    expect(after.archived_at).toBe('2026-11-21T09:00:00.000Z');
    expect(isUnread(after)).toBe(false);
  });

  it('never tells the sender it was read', () => {
    expect(archivedCopy(row('a', null, true), now).read_at).toBeNull();
    expect(archivedCopy(row('b', '2026-11-20T01:00:00Z', false), now).read_at).toBe(
      '2026-11-20T01:00:00Z',
    );
  });

  it('keeps the first archived time', () => {
    const once = archivedCopy(row('a', null, true), now);
    expect(archivedCopy(once, new Date('2026-11-22T00:00:00Z')).archived_at).toBe(once.archived_at);
  });

  it('moving back to the inbox keeps it read', () => {
    const back = movedToInbox(archivedCopy(row('a', null, true), now));
    expect(isArchived(back)).toBe(false);
    expect(isUnread(back)).toBe(false);
  });

  it('a copy from before archiving existed is in the inbox', () => {
    expect(isArchived(row('a', null))).toBe(false);
  });
});

describe('moveBetween', () => {
  const older = {
    ...row('old', null, true),
    message: { ...MESSAGE, id: 'old', created_at: '2026-11-18T00:00:00Z' },
  };
  const newer = {
    ...row('new', null, true),
    message: { ...MESSAGE, id: 'new', created_at: '2026-11-20T00:00:00Z' },
  };
  const middle = {
    ...row('mid', null, true),
    message: { ...MESSAGE, id: 'mid', created_at: '2026-11-19T00:00:00Z' },
  };

  it('takes the message out of one list and puts it in the other, newest first', () => {
    const { from, to } = moveBetween([middle], [newer, older], 'mid', (c) => archivedCopy(c));
    expect(from).toEqual([]);
    expect(to.map((m) => m.message.id)).toEqual(['new', 'mid', 'old']);
    expect(isArchived(to[1])).toBe(true);
  });

  it('leaves both lists alone when the message isn’t there', () => {
    const lists = { from: [older], to: [newer] };
    expect(moveBetween(lists.from, lists.to, 'missing', movedToInbox)).toEqual(lists);
  });

  it('never shows the same message twice', () => {
    const { to } = moveBetween([middle], [middle], 'mid', movedToInbox);
    expect(to).toHaveLength(1);
  });
});

describe('swipeArchives', () => {
  it.each<[number, boolean]>([
    [-SWIPE_TO_ARCHIVE - 1, true],
    [-SWIPE_TO_ARCHIVE, true],
    [-SWIPE_TO_ARCHIVE + 1, false],
    [-20, false],
    [0, false],
    [200, false],
  ])('a swipe of %i archives: %s', (dx, expected) => {
    expect(swipeArchives(dx)).toBe(expected);
  });
});

describe('markedAllRead', () => {
  it('leaves nothing unread', () => {
    const after = markedAllRead([row('a', null, true), row('c', '2026-11-20T01:00:00Z', true)]);
    expect(after.filter(isUnread)).toEqual([]);
  });

  it('never invents a read time for a message that wasn’t opened', () => {
    const [after] = markedAllRead([row('a', null, true)]);
    expect(after.read_at).toBeNull();
  });

  it('keeps the first read time of an opened message', () => {
    const [after] = markedAllRead([row('c', '2026-11-20T01:00:00Z', true)]);
    expect(after.read_at).toBe('2026-11-20T01:00:00Z');
  });

  it('leaves read messages as they were', () => {
    const read = row('b', '2026-11-20T01:00:00Z', false);
    expect(markedAllRead([read])[0]).toBe(read);
  });
});
