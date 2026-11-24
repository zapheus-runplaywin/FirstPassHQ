/**
 * Finding who a concern is about (`matchPeople`), and the reported message in
 * the concerns register PDF (`concernsReport`), from "The concerns register"
 * in section 10 of docs/user-guide.md.
 */
import { concernsReport, escalationLine, matchPeople } from '@/lib/concerns';
import type { Concern } from '@/lib/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn(), useFeature: jest.fn() }));

const PEOPLE = [
  { id: '1', name: 'Avery Admin' },
  { id: '2', name: 'Sam Alder' },
  { id: '3', name: 'Jordan O’Brien' },
  { id: '4', name: 'Kai Senior' },
  { id: '5', name: 'Mia Lee-Ward' },
];
const ids = (typed: string, max = 5) => matchPeople(PEOPLE, typed, max).map((p) => p.id);

describe('matchPeople', () => {
  it('matches nobody until something is typed', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('matches the start of any part of a name from one letter, any case', () => {
    expect(ids('A')).toEqual(['1', '2']);
    expect(ids('a')).toEqual(['1', '2']);
    expect(ids('b')).toEqual(['3']);
    expect(ids('w')).toEqual(['5']);
  });

  it('doesn’t match a single letter inside a name', () => {
    // "Kai Senior" has an "i" but no part starting with one.
    expect(ids('i')).toEqual([]);
  });

  it('matches inside a name from two letters', () => {
    expect(ids('ni')).toEqual(['4']);
    expect(ids('sam ald')).toEqual(['2']);
  });

  it('offers at most the number asked for', () => {
    expect(ids('a', 1)).toEqual(['1']);
  });
});

describe('concernsReport', () => {
  const concern = (extra: Partial<Concern> = {}): Concern => ({
    id: 'c1',
    created_at: '2026-10-16T02:00:00Z',
    raised_by_name: null,
    anonymous: true,
    contact_ok: false,
    contact_details: null,
    about_member_id: null,
    about_member_name: null,
    about_text: null,
    happened_on: null,
    body: 'Strange message',
    involves_child: 'unsure',
    context: null,
    status: 'received',
    closed_at: null,
    last_action_at: null,
    ...extra,
  });
  const whatHappened = (c: Concern) => concernsReport([c], {}, null).sections[0].rows[0].cells[2];

  it('prints the reported message under what happened, with who sent it', () => {
    const cell = whatHappened(
      concern({
        reported_message_sender_name: 'Sample Coach',
        reported_message_sent_at: '2026-10-15T02:00:00Z',
        reported_message_body: 'Come early on your own',
      }),
    );
    expect(cell).toMatch(/^Strange message\n\nReported message from Sample Coach, .+: “Come early on your own”$/);
  });

  it('prints just what happened when no message was reported', () => {
    expect(whatHappened(concern())).toBe('Strange message');
  });
});

describe('escalationLine', () => {
  const step = {
    reached_at: '2026-11-20T01:00:00Z',
    target_name: 'Child Safety Officer',
    skipped: false,
    reason: null,
  };

  it('names who a concern was escalated to', () => {
    expect(escalationLine(step)).toBe('Escalated to Child Safety Officer');
  });

  it('says why a step passed someone over', () => {
    expect(escalationLine({ ...step, skipped: true, reason: 'Nobody could take it' })).toBe(
      'Passed over Child Safety Officer: Nobody could take it',
    );
    expect(escalationLine({ ...step, skipped: true })).toBe('Passed over Child Safety Officer');
  });
});
