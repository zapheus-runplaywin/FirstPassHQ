/**
 * Read controls in the messages inbox (src/lib/inbox.ts): what counts as
 * unread, what Hide read shows, and what Mark all read changes. The sender's
 * read receipt (`read_at`) is never changed by either control.
 */
import { isUnread, markedAllRead, shownInbox } from '@/lib/inbox';
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
  return { read_at, unread, for_children: null, for_child_names: null, message: { ...MESSAGE, id } };
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

describe('shownInbox', () => {
  const inbox = [row('a', null, true), row('b', '2026-11-20T01:00:00Z', false), row('c', '2026-11-20T01:00:00Z', true)];

  it('shows everything with Hide read off', () => {
    expect(shownInbox(inbox, false)).toBe(inbox);
  });

  it('shows only unread messages, in order, with Hide read on', () => {
    expect(shownInbox(inbox, true).map((r) => r.message.id)).toEqual(['a', 'c']);
  });

  it('shows nothing when everything is read', () => {
    expect(shownInbox([row('b', '2026-11-20T01:00:00Z', false)], true)).toEqual([]);
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
