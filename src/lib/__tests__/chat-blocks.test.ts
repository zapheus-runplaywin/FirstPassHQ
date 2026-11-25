import {
  blockLine,
  blocksTodoTitle,
  blockStatus,
  blockWarning,
  canOfferBlock,
} from '@/lib/chat-blocks';
import { buildTodos } from '@/lib/todos';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn(), useFeature: jest.fn() }));
jest.mock('@/lib/messages', () => ({ useCaptainedGroupIds: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

describe('canOfferBlock', () => {
  const base = { isChatPost: true, inMyGroup: true, senderId: 'them', myId: 'me' };

  it('offers Block on someone else’s post in the member’s own group', () => {
    expect(canOfferBlock(base)).toBe(true);
  });
  it('not on the member’s own post', () => {
    expect(canOfferBlock({ ...base, senderId: 'me' })).toBe(false);
  });
  it('not on a parent’s copy, which isn’t in their own group', () => {
    expect(canOfferBlock({ ...base, inMyGroup: false })).toBe(false);
  });
  it('not on a club message', () => {
    expect(canOfferBlock({ ...base, isChatPost: false })).toBe(false);
  });
  it('not when the author has left or nobody is signed in', () => {
    expect(canOfferBlock({ ...base, senderId: null })).toBe(false);
    expect(canOfferBlock({ ...base, myId: undefined })).toBe(false);
  });
});

describe('the words', () => {
  it('warns who is told and what still comes through', () => {
    const text = blockWarning('Sample Author');
    expect(text).toMatch(/won’t see Sample Author’s posts/);
    expect(text).toMatch(/They aren’t told/);
    expect(text).toMatch(/Club messages from them still reach you/);
    expect(text).toMatch(/admins and Child Safety Officer are told/);
    expect(text).toMatch(/unblock them in Blocked people/);
  });

  it('marks members under 18 in the register', () => {
    expect(
      blockLine({ blocker_name: 'A', blocked_name: 'B', blocker_under_18: true, blocked_under_18: false }),
    ).toBe('A (under 18) blocked B');
    expect(
      blockLine({ blocker_name: 'A', blocked_name: 'B', blocker_under_18: false, blocked_under_18: true }),
    ).toBe('A blocked B (under 18)');
  });

  it('says where a block stands', () => {
    expect(blockStatus({ unblocked_at: null, followed_up_at: null, followed_up_by_name: null })).toBe(
      'Still blocked · Waiting for a follow-up',
    );
    expect(blockStatus({ unblocked_at: 'x', followed_up_at: 'y', followed_up_by_name: 'Sam' })).toBe(
      'Unblocked · Followed up by Sam',
    );
    expect(blockStatus({ unblocked_at: null, followed_up_at: 'y', followed_up_by_name: null })).toBe(
      'Still blocked · Followed up by someone',
    );
  });

  it('counts blocks in the to-do title', () => {
    expect(blocksTodoTitle(1)).toBe('Follow up a block in chat groups');
    expect(blocksTodoTitle(3)).toBe('Follow up 3 blocks in chat groups');
  });
});

describe('the to-do', () => {
  const base = { userId: 'me', injuries: [], pendingCount: 0, needsCheckIn: false, flaggedAthletes: 0 };

  it('asks admins and the safeguarding officers to follow blocks up, naming nobody', () => {
    const todo = buildTodos({ ...base, chatBlocksWaiting: 2 }).find((t) => t.key === 'chat-blocks');
    expect(todo).toEqual({
      key: 'chat-blocks',
      title: 'Follow up 2 blocks in chat groups',
      detail: 'A member blocked someone. Check in with them',
      href: '/concerns/blocks',
      alert: { level: 'amber', label: 'Needs checking' },
    });
  });

  it('isn’t there with nothing to follow up', () => {
    expect(buildTodos({ ...base, chatBlocksWaiting: 0 }).some((t) => t.key === 'chat-blocks')).toBe(false);
    expect(buildTodos(base).some((t) => t.key === 'chat-blocks')).toBe(false);
  });
});
