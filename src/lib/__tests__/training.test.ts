import { formatDateString } from '@/lib/injuries';
import { audienceLabel, countsLabel, currentSeason, dueLabel, isOutstanding } from '@/lib/training';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

const TODAY = new Date(2026, 9, 18, 12);

describe('isOutstanding', () => {
  it('is true for training to do or sent back', () => {
    expect(isOutstanding({ status: 'to_do' })).toBe(true);
    expect(isOutstanding({ status: 'sent_back' })).toBe(true);
  });

  it('is false once submitted or approved', () => {
    expect(isOutstanding({ status: 'submitted' })).toBe(false);
    expect(isOutstanding({ status: 'approved' })).toBe(false);
  });
});

describe('dueLabel', () => {
  it('says Due up to and including the day', () => {
    expect(dueLabel('2026-10-18', TODAY)).toBe(`Due ${formatDateString('2026-10-18')}`);
    expect(dueLabel('2027-03-31', TODAY)).toBe(`Due ${formatDateString('2027-03-31')}`);
  });

  it('says Overdue after the day', () => {
    expect(dueLabel('2026-10-17', TODAY)).toBe(`Overdue since ${formatDateString('2026-10-17')}`);
  });
});

describe('audienceLabel', () => {
  it('lists roles in the order offered', () => {
    expect(audienceLabel(['coach', 'athlete'], null)).toBe('Athletes and Coaches, all squads and teams');
    expect(audienceLabel(['guardian', 'coach', 'athlete'], null)).toBe(
      'Athletes, Coaches and Guardians, all squads and teams',
    );
  });

  it('names the groups', () => {
    expect(audienceLabel(['athlete'], ['17 & Under Squad'])).toBe('Athletes in 17 & Under Squad');
    expect(audienceLabel(['athlete'], ['Open A', 'Open B'])).toBe('Athletes in Open A and Open B');
  });

  it('says when no groups are chosen', () => {
    expect(audienceLabel(['athlete'], [])).toBe('Athletes · no squads or teams chosen');
  });

  it('says Nobody with no roles', () => {
    expect(audienceLabel([], null)).toBe('Nobody, all squads and teams');
    // Guests can't be asked to do training.
    expect(audienceLabel(['guest'], null)).toBe('Nobody, all squads and teams');
  });
});

describe('currentSeason', () => {
  it('uses the newest season with squads and teams', () => {
    expect(currentSeason([2024, 2026, 2025], TODAY)).toBe(2026);
  });

  it('otherwise starts the club year in May', () => {
    expect(currentSeason([], new Date(2026, 3, 30))).toBe(2025);
    expect(currentSeason([], new Date(2026, 4, 1))).toBe(2026);
    expect(currentSeason([], new Date(2027, 0, 15))).toBe(2026);
  });
});

describe('countsLabel', () => {
  it('says when nobody has to do it', () => {
    expect(countsLabel(undefined)).toBe('Nobody has to complete it yet');
    expect(
      countsLabel({ requirement_id: 'r', required: 0, approved: 0, submitted: 0, outstanding: 0 }),
    ).toBe('Nobody has to complete it yet');
  });

  it('counts approvals and those waiting to be checked', () => {
    expect(
      countsLabel({ requirement_id: 'r', required: 12, approved: 4, submitted: 2, outstanding: 6 }),
    ).toBe('4 of 12 approved · 2 waiting to be checked');
    expect(
      countsLabel({ requirement_id: 'r', required: 12, approved: 4, submitted: 0, outstanding: 8 }),
    ).toBe('4 of 12 approved');
  });
});
