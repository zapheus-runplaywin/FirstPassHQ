/**
 * Questions on messages (src/lib/message-questions.ts): the ready-made
 * answers, the checks before sending (the database checks them again), and
 * how answers are grouped for the sender with "Not sure" first to follow up.
 */
import {
  answerLine,
  answersFor,
  answersProblem,
  groupAnswers,
  isFollowUpAnswer,
  QUESTION_PRESETS,
  questionTag,
  questionTagTone,
  type QuestionAnswer,
} from '@/lib/message-questions';

describe('answersFor', () => {
  it('asks nothing when no question is chosen', () => {
    expect(answersFor('none', ['Yes', 'No'])).toBeNull();
  });

  it('gives each ready-made set', () => {
    expect(answersFor('yes-no', [])).toEqual(['Yes', 'No']);
    expect(answersFor('yes-no-unsure', [])).toEqual(['Yes', 'No', 'Not sure']);
    expect(answersFor('got-it', [])).toEqual(['Got it', 'Not sure']);
  });

  it('every ready-made set can be sent as it is', () => {
    for (const preset of QUESTION_PRESETS) expect(answersProblem(preset.options)).toBeNull();
  });

  it('trims the sender’s own answers and drops blank ones', () => {
    expect(answersFor('own', [' Car ', '', 'Bus', '   '])).toEqual(['Car', 'Bus']);
  });
});

describe('answersProblem', () => {
  it.each([
    [[], 'Give 2 to 4 answers.'],
    [['Yes'], 'Give 2 to 4 answers.'],
    [['A', 'B', 'C', 'D', 'E'], 'Give 2 to 4 answers.'],
    [['Yes', 'x'.repeat(31)], 'Answers can be up to 30 characters.'],
    [['Yes', 'YES'], 'Each answer must be different.'],
  ])('refuses %j', (answers, problem) => {
    expect(answersProblem(answers)).toBe(problem);
  });

  it.each([[['Yes', 'No']], [['A', 'B', 'C', 'D']], [['Yes', 'x'.repeat(30)]]])('accepts %j', (answers) => {
    expect(answersProblem(answers)).toBeNull();
  });
});

describe('isFollowUpAnswer', () => {
  it.each(['Not sure', 'unsure', 'Maybe', 'I have a question', '???'])('%s means follow up', (a) => {
    expect(isFollowUpAnswer(a)).toBe(true);
  });
  it.each(['Yes', 'No', 'Got it', 'Coming'])('%s doesn’t', (a) => {
    expect(isFollowUpAnswer(a)).toBe(false);
  });
});

describe('groupAnswers', () => {
  const person = (profile_id: string, answer: number, byParent = false): QuestionAnswer => ({
    profile_id,
    name: profile_id,
    answer,
    answered_by_name: byParent ? 'Logan Parent' : profile_id,
    answered_by_parent: byParent,
    answered_at: '2026-11-20T06:00:00Z',
  });

  it('groups names by answer and lists Not sure first, to follow up', () => {
    const groups = groupAnswers({
      options: ['Yes', 'No', 'Not sure'],
      answers: [person('Kai', 1), person('Jordan', 0, true), person('Morgan', 2), person('Sam', 0)],
    });
    expect(groups.map((g) => [g.option, g.followUp, g.people.map((p) => p.name)])).toEqual([
      ['Not sure', true, ['Morgan']],
      ['Yes', false, ['Jordan', 'Sam']],
      ['No', false, ['Kai']],
    ]);
  });

  it('shows every answer, even with nobody in it', () => {
    expect(groupAnswers({ options: ['Yes', 'No'], answers: [] }).map((g) => g.people.length)).toEqual([0, 0]);
  });

  it('copes with names not being sent (a member who can’t see them)', () => {
    expect(groupAnswers({ options: ['Yes', 'No'], answers: null })).toHaveLength(2);
  });
});

describe('answerLine', () => {
  it('names the parent who answered for a child', () => {
    expect(answerLine(['Yes', 'No'], 0, 'Logan Parent', true)).toBe('Yes, answered by Logan Parent');
  });
  it('is just the answer when the member gave it', () => {
    expect(answerLine(['Yes', 'No'], 1, 'Kai Senior', false)).toBe('No');
  });
  it('is nothing before an answer', () => {
    expect(answerLine(['Yes', 'No'], null, null, false)).toBeNull();
  });
});

describe('questionTagTone', () => {
  it('marks the member’s own question while it is still to answer', () => {
    expect(questionTagTone(null, null)).toBe('attention');
    expect(questionTagTone([], null)).toBe('attention');
  });
  it('is done once they answer, whichever answer they gave', () => {
    expect(questionTagTone(null, 0)).toBe('done');
    expect(questionTagTone(null, 2)).toBe('done');
  });
  it('stays quiet on a child’s question, answered here or not', () => {
    expect(questionTagTone(['child-1'], null)).toBe('quiet');
    expect(questionTagTone(['child-1'], 1)).toBe('quiet');
  });
});

describe('questionTag', () => {
  it('asks the member to answer', () => {
    expect(questionTag(null, null)).toBe('Question: tap to answer');
  });
  it('says when they have', () => {
    expect(questionTag(null, 0)).toBe('Question: answered');
  });
  it('points a parent to their child’s answer', () => {
    expect(questionTag(['child-1'], null)).toBe('Question: open to see or give your child’s answer');
  });
});
