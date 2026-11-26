/**
 * A message being written, kept while the app is open, so leaving New
 * message to check a time on the calendar doesn't lose it. It is kept in the
 * app's memory only, for the member who wrote it: it is never saved to the
 * phone or sent anywhere, and it is gone when the app closes, when the
 * message is sent, or as soon as a different member uses the app.
 */
import type { QuestionChoice } from '@/lib/message-questions';
import type { AppRole, MessageAudience } from '@/lib/types';

export type MessageDraft = {
  audience: MessageAudience;
  role: AppRole | null;
  teamId: string | null;
  body: string;
  question: QuestionChoice;
  ownAnswers: string[];
  shareTotals: boolean;
};

/** One member's draft at a time: whose it is, and what they wrote. */
let kept: { userId: string; draft: MessageDraft } | null = null;

/** Whether there is anything in a draft worth keeping: words, or answers typed. */
export function draftHasWords(draft: Pick<MessageDraft, 'body' | 'ownAnswers'>) {
  return !!draft.body.trim() || draft.ownAnswers.some((answer) => answer.trim());
}

/** Keeps the draft, or forgets it once there is nothing typed. */
export function keepDraft(userId: string | undefined, draft: MessageDraft) {
  if (!userId) return;
  kept = draftHasWords(draft) ? { userId, draft } : null;
}

/**
 * The member's own draft, if they left one. Anyone else asking gets nothing,
 * and the draft is dropped: a phone that changed hands doesn't carry a
 * half-written message with it.
 */
export function keptDraft(userId: string | undefined): MessageDraft | null {
  if (!kept) return null;
  if (kept.userId !== userId) {
    kept = null;
    return null;
  }
  return kept.draft;
}

/** Forgets the member's draft: it was sent, or they chose to start again. */
export function forgetDraft(userId: string | undefined) {
  if (kept?.userId === userId) kept = null;
}

/** Forgets whatever is kept, so each test starts with nothing half written. */
export function forgetAllDrafts() {
  kept = null;
}
