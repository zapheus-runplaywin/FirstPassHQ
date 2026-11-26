/**
 * Finding and grouping messages (src/lib/message-list.ts): search, the Unread
 * and To answer filters, the day headings and the initials beside a sender.
 * All of it sifts the messages the member already has; none of it reads
 * anything new.
 */
import { formatPastDay } from '@/lib/format';
import {
  daySections,
  filterInbox,
  guardianCopyShort,
  inboxSearchTexts,
  initials,
  matchesSearch,
  needsAnswer,
  readShare,
  sameDay,
  searchWords,
  sentSearchTexts,
} from '@/lib/message-list';
import type { InboxMessage, Message, SentMessage } from '@/lib/types';

const MESSAGE: Message = {
  id: 'm1',
  sender_id: 'coach',
  sender_name: 'Zoë Carter',
  body: 'Training moves to Lords Oval tonight',
  audience: 'group',
  audience_role: null,
  audience_label: 'Mixed Open Squad',
  created_at: '2026-11-20T00:00:00Z',
};

function copy(extra: Partial<InboxMessage> = {}, message: Partial<Message> = {}): InboxMessage {
  return {
    read_at: null,
    unread: true,
    for_children: null,
    for_child_names: null,
    ...extra,
    message: { ...MESSAGE, ...message },
  };
}

/** A local time, so the test reads the same in any time zone. */
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString();

describe('search', () => {
  it('splits what is typed into words, in lower case and without accents', () => {
    expect(searchWords('  Zoë   OVAL ')).toEqual(['zoe', 'oval']);
    expect(searchWords('   ')).toEqual([]);
  });

  it('finds a message by its sender, who it went to, or its words', () => {
    const texts = inboxSearchTexts(copy());
    expect(matchesSearch(texts, 'zoe')).toBe(true);
    expect(matchesSearch(texts, 'open squad')).toBe(true);
    expect(matchesSearch(texts, 'lords')).toBe(true);
    expect(matchesSearch(texts, 'bunbury')).toBe(false);
  });

  it('wants every word typed, in any order', () => {
    const texts = inboxSearchTexts(copy());
    expect(matchesSearch(texts, 'oval zoe')).toBe(true);
    expect(matchesSearch(texts, 'oval bunbury')).toBe(false);
  });

  it('shows everything while nothing is typed', () => {
    expect(matchesSearch(['anything'], '')).toBe(true);
    expect(matchesSearch([], '  ')).toBe(true);
  });

  it('finds a parent’s copy by the child it was for', () => {
    const texts = inboxSearchTexts(copy({ for_children: ['c1'], for_child_names: ['Riley Nguyen'] }));
    expect(matchesSearch(texts, 'riley')).toBe(true);
  });

  it('finds a message from the club itself under "Club", and a role under its name', () => {
    expect(matchesSearch(inboxSearchTexts(copy({}, { sender_name: null })), 'club')).toBe(true);
    const toPhysios = copy({}, { audience: 'role', audience_role: 'physio', audience_label: null });
    expect(matchesSearch(inboxSearchTexts(toPhysios), 'physios')).toBe(true);
  });

  it('finds a sent message by who it went to or its words, never by who read it', () => {
    const sent: SentMessage = {
      id: 's1',
      body: 'Bring a water bottle',
      audience: 'club',
      audience_role: null,
      audience_label: null,
      created_at: '2026-11-20T00:00:00Z',
      recipient_count: 12,
      read_count: 9,
    };
    expect(matchesSearch(sentSearchTexts(sent), 'everyone')).toBe(true);
    expect(matchesSearch(sentSearchTexts(sent), 'bottle')).toBe(true);
    expect(matchesSearch(sentSearchTexts(sent), '12')).toBe(false);
  });
});

describe('the To answer filter', () => {
  const QUESTION = { answer_options: ['Yes', 'No'] };

  it('counts the member’s own question until they answer it', () => {
    expect(needsAnswer(copy({ answer: null }, QUESTION))).toBe(true);
    expect(needsAnswer(copy({}, QUESTION))).toBe(true);
    expect(needsAnswer(copy({ answer: 0 }, QUESTION))).toBe(false);
  });

  it('leaves out plain messages', () => {
    expect(needsAnswer(copy())).toBe(false);
  });

  it('leaves out a parent’s copy of their child’s question, which the list can’t tell is answered', () => {
    expect(
      needsAnswer(copy({ for_children: ['c1'], for_child_names: ['Riley'], answer: null }, QUESTION)),
    ).toBe(false);
  });
});

describe('filterInbox', () => {
  const unread = copy({ unread: true }, { id: 'unread', body: 'Unread news' });
  const read = copy({ unread: false, read_at: at(20) }, { id: 'read', body: 'Old news' });
  const question = copy(
    { unread: false, read_at: at(20), answer: null },
    { id: 'question', body: 'Extra session?', answer_options: ['Yes', 'No'] },
  );
  const all = [unread, read, question];
  const ids = (rows: InboxMessage[]) => rows.map((r) => r.message.id);

  it('shows everything by default', () => {
    expect(ids(filterInbox(all, 'all'))).toEqual(['unread', 'read', 'question']);
  });

  it('keeps only unread messages, or only questions still to answer', () => {
    expect(ids(filterInbox(all, 'unread'))).toEqual(['unread']);
    expect(ids(filterInbox(all, 'toAnswer'))).toEqual(['question']);
  });

  it('searches inside the filter', () => {
    expect(ids(filterInbox(all, 'all', 'news'))).toEqual(['unread', 'read']);
    expect(ids(filterInbox(all, 'unread', 'old'))).toEqual([]);
  });
});

describe('day headings', () => {
  // Thursday 26 November 2026, mid-afternoon.
  const now = new Date(2026, 10, 26, 15);
  const titles = (days: number[]) =>
    daySections(days.map((d) => at(d)), (iso) => iso, now).map((s) => [s.title, s.items.length]);

  it('puts a list under Today, Yesterday, Earlier this week and Earlier', () => {
    expect(titles([26, 26, 25, 24, 23, 22, 1])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      // The week starts on Monday (the 23rd).
      ['Earlier this week', 2],
      ['Earlier', 2],
    ]);
  });

  it('gives a list that falls under one heading no heading at all', () => {
    expect(titles([20, 19, 1])).toEqual([['', 3]]);
    expect(titles([26, 26])).toEqual([['', 2]]);
    expect(titles([])).toEqual([]);
  });

  it('counts a message from just after midnight as today', () => {
    const sections = daySections([new Date(2026, 10, 26, 0, 1).toISOString(), at(25, 23)], (i) => i, now);
    expect(sections.map((s) => s.title)).toEqual(['Today', 'Yesterday']);
  });

  it('keeps the order it was given', () => {
    const sections = daySections([at(26, 14), at(26, 9), at(25)], (i) => i, now);
    expect(sections[0].items).toEqual([at(26, 14), at(26, 9)]);
  });

  it('names a chat group’s days Today, Yesterday, or the date', () => {
    expect(formatPastDay(new Date(2026, 10, 26, 9), now)).toBe('Today');
    expect(formatPastDay(new Date(2026, 10, 25, 23), now)).toBe('Yesterday');
    expect(formatPastDay(new Date(2026, 10, 20, 9), now)).toMatch(/20/);
    expect(formatPastDay(new Date(2026, 10, 20, 9), now)).not.toMatch(/Today|Yesterday/);
  });

  it('knows two posts were sent on the same day', () => {
    expect(sameDay(at(26, 1), at(26, 23))).toBe(true);
    expect(sameDay(at(25, 23), at(26, 1))).toBe(false);
  });
});

describe('the initials beside a sender', () => {
  it.each<[string | null | undefined, string]>([
    ['Cam Roberts', 'CR'],
    ['Matt', 'M'],
    ['Club safeguarding', 'CS'],
    ['mary-jane o’neil', 'MO'],
    ['Ana María de la Cruz', 'AC'],
    ['  Dee   Walker ', 'DW'],
    ['Émile Zola', 'ÉZ'],
    ['17 & Under Squad', '1S'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    ['& !', ''],
  ])('%p gives %p', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('the short line on a parent’s copy', () => {
  it('names the children it was for', () => {
    expect(guardianCopyShort('coach', ['c1'], ['Riley Nguyen'])).toBe('Your copy, for Riley Nguyen');
    expect(guardianCopyShort('coach', ['c1', 'c2'], ['Jordan Nguyen', 'Riley Nguyen'])).toBe(
      'Your copy, for Jordan Nguyen and Riley Nguyen',
    );
    expect(guardianCopyShort('coach', ['c1', 'c2', 'c3'], ['Al', 'Bo', 'Cy'])).toBe(
      'Your copy, for Al, Bo and Cy',
    );
  });

  it('says when their child sent it', () => {
    expect(guardianCopyShort('c1', ['c1'], ['Riley Nguyen'])).toBe('Your copy: Riley Nguyen sent it');
  });

  it('says nothing on the member’s own message', () => {
    expect(guardianCopyShort('coach', null, null)).toBeNull();
    expect(guardianCopyShort('coach', [], [])).toBeNull();
  });
});

describe('how much of a sent message has been read', () => {
  it.each<[number, number, number]>([
    [0, 8, 0],
    [4, 8, 0.5],
    [8, 8, 1],
    [9, 8, 1],
    [0, 0, 0],
    [-1, 8, 0],
  ])('%d of %d is %d', (read, of, expected) => {
    expect(readShare(read, of)).toBe(expected);
  });
});
