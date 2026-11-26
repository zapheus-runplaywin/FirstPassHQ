/**
 * A message being written is kept while the app is open
 * (src/lib/message-draft.ts): for the member who wrote it only, in memory
 * only, and forgotten once it is sent or someone else uses the app.
 */
import {
  draftHasWords,
  forgetAllDrafts,
  forgetDraft,
  keepDraft,
  keptDraft,
  type MessageDraft,
} from '@/lib/message-draft';

const DRAFT: MessageDraft = {
  audience: 'group',
  role: null,
  teamId: 'team-1',
  body: 'Training moves to 6pm',
  question: 'none',
  ownAnswers: ['', '', '', ''],
  shareTotals: false,
};

beforeEach(forgetAllDrafts);

it('keeps what a member was writing', () => {
  keepDraft('coach', DRAFT);
  expect(keptDraft('coach')).toEqual(DRAFT);
});

it('never hands one member another member’s draft, and drops it when someone else asks', () => {
  keepDraft('coach', DRAFT);
  expect(keptDraft('manager')).toBeNull();
  // The phone changed hands: the coach's words don't wait for them.
  expect(keptDraft('coach')).toBeNull();
});

it('gives nobody a draft while nobody is signed in', () => {
  keepDraft('coach', DRAFT);
  expect(keptDraft(undefined)).toBeNull();
  expect(keptDraft('coach')).toBeNull();
});

it('keeps nothing for nobody', () => {
  keepDraft(undefined, DRAFT);
  expect(keptDraft(undefined)).toBeNull();
});

it('forgets a draft once its words are deleted', () => {
  keepDraft('coach', DRAFT);
  keepDraft('coach', { ...DRAFT, body: '   ' });
  expect(keptDraft('coach')).toBeNull();
});

it('counts answers typed for a question as words worth keeping', () => {
  expect(draftHasWords({ body: '', ownAnswers: ['', '', '', ''] })).toBe(false);
  expect(draftHasWords({ body: '', ownAnswers: ['Bus', '', '', ''] })).toBe(true);
  expect(draftHasWords({ body: 'Hello', ownAnswers: [] })).toBe(true);
});

it('forgets a draft once it is sent, but only its own writer’s', () => {
  keepDraft('coach', DRAFT);
  forgetDraft('manager');
  expect(keptDraft('coach')).toEqual(DRAFT);
  forgetDraft('coach');
  expect(keptDraft('coach')).toBeNull();
});

it('keeps the newest version as it is written', () => {
  keepDraft('coach', DRAFT);
  keepDraft('coach', { ...DRAFT, body: 'Training moves to 6:30pm' });
  expect(keptDraft('coach')?.body).toBe('Training moves to 6:30pm');
});
