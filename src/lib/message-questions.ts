/**
 * Questions on messages: one question with 2 to 4 answers the sender sets.
 * Members tap one answer, once; a parent or guardian can answer for their
 * child under 18. Names are seen only by whoever sent it, the squad or
 * team's coaches and managers, and admins. The database
 * (20261120300000_message_questions.sql) applies every rule again.
 */

export const MAX_ANSWERS = 4;
export const MAX_ANSWER_LENGTH = 30;

export type QuestionChoice = 'none' | 'yes-no' | 'yes-no-unsure' | 'got-it' | 'own';

/** Ready-made answers, in the order they're offered. */
export const QUESTION_PRESETS: { value: Exclude<QuestionChoice, 'none' | 'own'>; label: string; options: string[] }[] = [
  { value: 'yes-no', label: 'Yes / No', options: ['Yes', 'No'] },
  { value: 'yes-no-unsure', label: 'Yes / No / Not sure', options: ['Yes', 'No', 'Not sure'] },
  { value: 'got-it', label: 'Got it / Not sure', options: ['Got it', 'Not sure'] },
];

/** The answers a choice offers; `own` are the sender's own, as typed. */
export function answersFor(choice: QuestionChoice, own: string[]): string[] | null {
  if (choice === 'none') return null;
  if (choice === 'own') return own.map((o) => o.trim()).filter(Boolean);
  return QUESTION_PRESETS.find((p) => p.value === choice)?.options ?? null;
}

/** Why a set of answers can't be sent, or null when it can. */
export function answersProblem(answers: string[]): string | null {
  if (answers.length < 2 || answers.length > MAX_ANSWERS) return 'Give 2 to 4 answers.';
  if (answers.some((a) => a.length > MAX_ANSWER_LENGTH)) {
    return `Answers can be up to ${MAX_ANSWER_LENGTH} characters.`;
  }
  if (new Set(answers.map((a) => a.toLowerCase())).size !== answers.length) {
    return 'Each answer must be different.';
  }
  return null;
}

/** An answer that means the sender should follow up, such as "Not sure". */
export function isFollowUpAnswer(answer: string) {
  return /not sure|unsure|maybe|question|\?/i.test(answer);
}

export type QuestionAnswer = {
  profile_id: string;
  name: string;
  answer: number;
  answered_by_name: string | null;
  answered_by_parent: boolean;
  answered_at: string;
};

export type ChildAnswer = {
  id: string;
  name: string;
  answer: number | null;
  answered_by_name: string | null;
  answered_by_parent: boolean;
  answered_at: string | null;
};

/** What `message_question` returns for one viewer. */
export type MessageQuestion = {
  options: string[];
  closed: boolean;
  totals_shared: boolean;
  can_close: boolean;
  my_answer: number | null;
  my_answer_by_name: string | null;
  /** True when a parent or guardian gave the member's answer for them. */
  my_answer_by_parent: boolean;
  can_answer_myself: boolean;
  children: ChildAnswer[];
  /** Counts per answer, to whoever sees names, and to everyone when shared. */
  totals: number[] | null;
  /** Names, only to whoever sent it, its coaches and managers, and admins. */
  answers: QuestionAnswer[] | null;
  not_answered: string[] | null;
};

export type AnswerGroup = {
  index: number;
  option: string;
  followUp: boolean;
  people: QuestionAnswer[];
};

/**
 * Answers grouped by choice, in the sender's order, with any "Not sure" style
 * group marked to follow up and listed first.
 */
export function groupAnswers(question: Pick<MessageQuestion, 'options' | 'answers'>): AnswerGroup[] {
  const groups = question.options.map((option, index) => ({
    index,
    option,
    followUp: isFollowUpAnswer(option),
    people: (question.answers ?? []).filter((a) => a.answer === index),
  }));
  return [...groups.filter((g) => g.followUp), ...groups.filter((g) => !g.followUp)];
}

/** "Yes, answered by Logan Parent" when a parent answered for the member. */
export function answerLine(
  options: string[],
  answer: number | null,
  byName: string | null,
  byParent: boolean,
) {
  if (answer === null || answer === undefined) return null;
  const option = options[answer] ?? 'An answer';
  return byParent && byName ? `${option}, answered by ${byName}` : option;
}

/** What the inbox says about a message's question. */
export function questionTag(forChildren: string[] | null, answer: number | null) {
  if (forChildren?.length) return 'Question: open to see or give your child’s answer';
  return answer === null ? 'Question: tap to answer' : 'Question: answered';
}
