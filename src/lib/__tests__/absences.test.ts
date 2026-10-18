import { absenceDays, absenceOn, absenceWhy, awayLabel, injuredLabel } from '@/lib/absences';
import { formatDateString } from '@/lib/injuries';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));

describe('absenceWhy', () => {
  it('joins the reason and details', () => {
    expect(absenceWhy({ category: 'Planned holidays', reason: 'Bali' })).toBe('Planned holidays · Bali');
  });

  it('uses whichever is given', () => {
    expect(absenceWhy({ category: 'Illness', reason: null })).toBe('Illness');
    expect(absenceWhy({ category: null, reason: 'School camp' })).toBe('School camp');
  });

  it('is null when neither is given', () => {
    expect(absenceWhy({ category: null, reason: null })).toBeNull();
    expect(absenceWhy({ category: '', reason: '' })).toBeNull();
  });
});

describe('absenceDays', () => {
  it('gives one day', () => {
    expect(absenceDays({ from_day: '2026-10-09', to_day: '2026-10-09' })).toBe(
      formatDateString('2026-10-09'),
    );
  });

  it('gives a range', () => {
    expect(absenceDays({ from_day: '2026-10-09', to_day: '2026-10-11' })).toBe(
      `${formatDateString('2026-10-09')} to ${formatDateString('2026-10-11')}`,
    );
  });
});

describe('awayLabel', () => {
  it('says why when known', () => {
    expect(awayLabel({ category: 'Planned event', reason: 'School camp' })).toBe(
      'Away: Planned event · School camp',
    );
  });

  it('says reported away otherwise', () => {
    expect(awayLabel({ category: null, reason: null })).toBe('Reported away');
  });
});

describe('absenceOn', () => {
  const absences = [
    { id: 'a', from_day: '2026-10-01', to_day: '2026-10-03' },
    { id: 'b', from_day: '2026-10-09', to_day: '2026-10-09' },
  ];

  it('finds the absence covering a day, first and last days included', () => {
    expect(absenceOn(absences, '2026-10-01')?.id).toBe('a');
    expect(absenceOn(absences, '2026-10-02')?.id).toBe('a');
    expect(absenceOn(absences, '2026-10-03')?.id).toBe('a');
    expect(absenceOn(absences, '2026-10-09')?.id).toBe('b');
  });

  it('is undefined on other days', () => {
    expect(absenceOn(absences, '2026-09-30')).toBeUndefined();
    expect(absenceOn(absences, '2026-10-04')).toBeUndefined();
    expect(absenceOn([], '2026-10-04')).toBeUndefined();
  });
});

describe('injuredLabel', () => {
  it('says when they are expected back', () => {
    expect(injuredLabel('2026-10-24')).toBe(`Injured, back ${formatDateString('2026-10-24')}`);
  });

  it('says injured without a date', () => {
    expect(injuredLabel(null)).toBe('Injured');
  });
});
