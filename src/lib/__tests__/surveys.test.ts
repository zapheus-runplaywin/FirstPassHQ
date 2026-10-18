import {
  answeredText,
  answerText,
  childCopyLabel,
  closingDay,
  endOfDayIso,
  isTeamPoll,
  openingDay,
  startOfDayIso,
  surveyAnswersSeenBy,
  surveyAudienceLabel,
  surveysToAnswer,
  surveyWaitText,
  type MySurvey,
} from '@/lib/surveys';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));
jest.mock('@/lib/messages', () => ({ useCaptainedGroupIds: jest.fn() }));

function mySurvey(overrides: Partial<MySurvey>): MySurvey {
  return {
    id: 's',
    title: 'Season survey',
    identity: 'anonymous',
    opens_at: '2026-10-01T00:00:00Z',
    closes_at: '2026-10-30T00:00:00Z',
    created_by_name: null,
    for_child_names: null,
    from_child: false,
    responded: false,
    is_open: true,
    everyone_answers: false,
    ...overrides,
  };
}

describe('surveyWaitText', () => {
  const survey = { identity: 'anonymous' as const, everyone_answers: false, results_at_percent: null };

  it('explains each wait', () => {
    expect(surveyWaitText('closing', survey)).toContain('once the survey closes');
    expect(surveyWaitText('everyone', survey)).toBe(
      'Everyone must answer, so results show once everyone has answered or the survey closes.',
    );
    expect(surveyWaitText('percent', { ...survey, results_at_percent: 50 })).toBe(
      'Results show once 50% have answered, or the survey closes.',
    );
  });

  it('only says nobody can be picked out when answers are not named', () => {
    expect(surveyWaitText('min', survey)).toBe(
      'Results show once at least 3 people have answered, so nobody can be picked out.',
    );
    expect(surveyWaitText('min', { ...survey, identity: 'named' })).toBe(
      'Results show once at least 3 people have answered.',
    );
  });
});

describe('answeredText', () => {
  it('gives the count and rounded percent', () => {
    expect(answeredText(4, 12)).toBe('4 of 12 answered (33%)');
    expect(answeredText(0, 0)).toBe('0 of 0 answered (0%)');
  });
});

describe('surveyAudienceLabel', () => {
  it('names who it went to', () => {
    expect(surveyAudienceLabel('club', null, null)).toBe('Everyone in the club');
    expect(surveyAudienceLabel('role', 'coach', null)).toBe('All coaches');
    expect(surveyAudienceLabel('role', 'volunteer', null)).toBe('All temporary helpers');
    expect(surveyAudienceLabel('role', null, null)).toBe('A role');
    expect(surveyAudienceLabel('group', null, 'Open Squad')).toBe('Open Squad');
    expect(surveyAudienceLabel('group', null, null)).toBe('A squad or team');
  });
});

describe('closingDay and openingDay', () => {
  it('give the last day open, so midnight closes the day before', () => {
    expect(closingDay(new Date(2026, 9, 18).toISOString())).toBe('2026-10-17');
    expect(closingDay(new Date(2026, 9, 18, 9).toISOString())).toBe('2026-10-18');
  });

  it('give the opening day', () => {
    expect(openingDay(new Date(2026, 9, 18, 9).toISOString())).toBe('2026-10-18');
  });
});

describe('startOfDayIso and endOfDayIso', () => {
  it('cover the local day', () => {
    expect(startOfDayIso('2026-10-17')).toBe(new Date(2026, 9, 17).toISOString());
    expect(endOfDayIso('2026-10-17')).toBe(new Date(2026, 9, 18).toISOString());
    expect(endOfDayIso('2026-12-31')).toBe(new Date(2027, 0, 1).toISOString());
  });

  it('round-trip with closingDay and openingDay', () => {
    expect(closingDay(endOfDayIso('2026-10-17'))).toBe('2026-10-17');
    expect(openingDay(startOfDayIso('2026-10-17'))).toBe('2026-10-17');
  });
});

describe('surveyAnswersSeenBy', () => {
  it('says who sees the answers', () => {
    const base = { share_with_committee: false, share_with_admins: false };
    expect(surveyAnswersSeenBy({ ...base, sent_as: 'committee' })).toBe(
      'whoever sent it, the committee and admins',
    );
    expect(surveyAnswersSeenBy({ ...base, sent_as: 'captain' })).toBe(
      'whoever sent it and the group’s coaches and managers',
    );
    expect(surveyAnswersSeenBy({ sent_as: 'leader', share_with_committee: true, share_with_admins: true })).toBe(
      'whoever sent it, the committee and admins',
    );
    expect(surveyAnswersSeenBy({ ...base, sent_as: 'leader', share_with_admins: true })).toBe(
      'whoever sent it and admins',
    );
    expect(surveyAnswersSeenBy({ ...base, sent_as: 'leader' })).toBe('whoever sent it');
  });
});

describe('isTeamPoll', () => {
  it('is up to 5 questions without written answers', () => {
    expect(isTeamPoll([])).toBe(true);
    expect(isTeamPoll(Array(5).fill({ kind: 'choice' }))).toBe(true);
    expect(isTeamPoll([{ kind: 'rating' }, { kind: 'multi_choice' }])).toBe(true);
  });

  it('is not a poll with 6 questions or a written answer', () => {
    expect(isTeamPoll(Array(6).fill({ kind: 'choice' }))).toBe(false);
    expect(isTeamPoll([{ kind: 'choice' }, { kind: 'text' }])).toBe(false);
  });
});

describe('surveysToAnswer', () => {
  it('keeps open surveys the member has not answered themselves', () => {
    const todo = mySurvey({ id: 'a' });
    expect(
      surveysToAnswer([
        todo,
        mySurvey({ id: 'b', responded: true }),
        mySurvey({ id: 'c', is_open: false }),
        mySurvey({ id: 'd', for_child_names: ['Jo'] }),
      ]),
    ).toEqual([todo]);
  });
});

describe('childCopyLabel', () => {
  it('names the children it went to', () => {
    expect(childCopyLabel(['Jordan'])).toBe('Sent to Jordan. Your copy shows what they’re asked.');
    expect(childCopyLabel(['Jordan', 'Sam'])).toBe('Sent to Jordan and Sam. Your copy shows what they’re asked.');
    expect(childCopyLabel(['A', 'B', 'C'])).toBe('Sent to A, B and C. Your copy shows what they’re asked.');
  });

  it('says when a child sent it', () => {
    expect(childCopyLabel(['Jordan'], true)).toBe(
      'Copied to you because Jordan sent it. Your copy shows what they asked.',
    );
  });
});

describe('answerText', () => {
  const answer = { question_id: 'q', choices: null, rating: null, text: null };

  it('gives a rating out of the maximum', () => {
    expect(answerText({ kind: 'rating', options: null, rating_max: 5 }, { ...answer, rating: 4 })).toBe(
      '4 out of 5',
    );
  });

  it('gives written answers', () => {
    expect(answerText({ kind: 'text', options: null, rating_max: null }, { ...answer, text: 'Great' })).toBe(
      'Great',
    );
    expect(answerText({ kind: 'text', options: null, rating_max: null }, answer)).toBe('');
  });

  it('gives the chosen options', () => {
    const q = { kind: 'multi_choice', options: ['Monday', 'Tuesday', 'Thursday'], rating_max: null };
    expect(answerText(q, { ...answer, choices: [1, 2] })).toBe('Tuesday, Thursday');
    expect(answerText(q, answer)).toBe('');
  });
});
