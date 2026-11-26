/**
 * How the Messages lists are found, grouped and drawn: search, the Unread and
 * To answer filters, the day headings, and the initials in the circle beside
 * each sender.
 *
 * All of it works on the messages the member already has on their own phone.
 * Nothing here reads anything new from the database, so nobody can find a
 * message they couldn't already open.
 */
import { addDays, startOfDay, startOfWeek } from '@/lib/format';
import { isUnread } from '@/lib/inbox';
import { pluralRoleLabels } from '@/lib/labels';
import type { AppRole, InboxMessage, MessageAudience, SentMessage } from '@/lib/types';

/** Who a message went to, such as "Everyone in the club" or "Open Squad". */
export function audienceLabel(
  audience: MessageAudience,
  role: AppRole | 'partner' | null,
  label: string | null,
) {
  if (audience === 'club') return 'Everyone in the club';
  if (audience === 'role') {
    if (!role) return 'A role';
    // Sent before the Partner role was removed.
    if (role === 'partner') return 'All partners';
    return `All ${pluralRoleLabels[role].toLowerCase()}`;
  }
  return label ?? 'A squad or team';
}

/** How many messages a list loads at a time; "Show older messages" loads this many more. */
export const MESSAGES_PAGE = 100;

/** Lower case, without accents, so "zoe" finds "Zoë". */
function plain(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** The words typed in the search box. */
export function searchWords(query: string) {
  return plain(query).split(/\s+/).filter(Boolean);
}

/** Whether every word typed is somewhere in these texts. Nothing typed matches everything. */
export function matchesSearch(texts: (string | null | undefined)[], query: string) {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const haystack = plain(texts.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
}

/** What the search box looks through on a message the member got. */
export function inboxSearchTexts(copy: InboxMessage) {
  const { message } = copy;
  return [
    message.sender_name ?? 'Club',
    audienceLabel(message.audience, message.audience_role, message.audience_label),
    message.body,
    ...(copy.for_child_names ?? []),
  ];
}

/** What the search box looks through on a message the member sent. */
export function sentSearchTexts(message: SentMessage) {
  return [
    audienceLabel(message.audience, message.audience_role, message.audience_label),
    message.body,
  ];
}

/**
 * Whether the message asks the member themselves a question they haven't
 * answered. A parent's copy of their child's question doesn't count: the list
 * can't tell whether the child or a parent has answered it.
 */
export function needsAnswer(copy: InboxMessage) {
  return (
    !!copy.message.answer_options &&
    !copy.for_children?.length &&
    (copy.answer ?? null) === null
  );
}

/** The inbox's quick filters. */
export type InboxFilter = 'all' | 'unread' | 'toAnswer';

export function filterInbox(messages: InboxMessage[], filter: InboxFilter, query = '') {
  return messages.filter(
    (copy) =>
      (filter === 'unread' ? isUnread(copy) : filter === 'toAnswer' ? needsAnswer(copy) : true) &&
      matchesSearch(inboxSearchTexts(copy), query),
  );
}

export type DaySection<T> = { title: string; items: T[] };

/**
 * A list (newest first) under day headings: Today, Yesterday, Earlier this
 * week, Earlier. A list that falls under one heading gets none, so a short
 * inbox isn't dressed up.
 */
export function daySections<T>(
  items: T[],
  sentAt: (item: T) => string,
  now = new Date(),
): DaySection<T>[] {
  const today = startOfDay(now);
  const yesterday = addDays(today, -1);
  const week = startOfWeek(today);
  const titleOf = (item: T) => {
    const at = new Date(sentAt(item));
    if (at >= today) return 'Today';
    if (at >= yesterday) return 'Yesterday';
    if (at >= week) return 'Earlier this week';
    return 'Earlier';
  };
  const sections: DaySection<T>[] = [];
  for (const item of items) {
    const title = titleOf(item);
    const last = sections[sections.length - 1];
    if (last?.title === title) last.items.push(item);
    else sections.push({ title, items: [item] });
  }
  return sections.length === 1 ? [{ title: '', items: sections[0].items }] : sections;
}

/**
 * The letters in the circle beside a sender: the first letters of their first
 * and last names. Letters only. Members have no pictures (AGENTS.md, "No
 * social media features for children").
 */
export function initials(name: string | null | undefined) {
  const words = (name ?? '')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '';
  const first = [...words[0]][0];
  const last = words.length > 1 ? [...words[words.length - 1]][0] : '';
  return (first + last).toUpperCase();
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The short line on a parent's copy in the list, naming the children it was
 * for. The open message says it in full (`guardianCopyLabel`).
 */
export function guardianCopyShort(
  senderId: string | null,
  children: string[] | null,
  names: string[] | null,
) {
  if (!children?.length || !names?.length) return null;
  if (children.length === 1 && children[0] === senderId) return `Your copy: ${names[0]} sent it`;
  return `Your copy, for ${joinNames(names)}`;
}

/** How much of a sent message has been read, from 0 to 1. */
export function readShare(readCount: number, recipientCount: number) {
  if (recipientCount <= 0) return 0;
  return Math.min(1, Math.max(0, readCount / recipientCount));
}

/** Whether two posts were sent on the same day, so a chat group shows the day once. */
export function sameDay(a: string, b: string) {
  return startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime();
}
