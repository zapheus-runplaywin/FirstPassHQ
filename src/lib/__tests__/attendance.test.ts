import { marksToSave, percent, presentLabel } from '@/lib/attendance';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));

describe('presentLabel', () => {
  it('counts who was present', () => {
    expect(presentLabel(12, 15)).toBe('12 of 15 present');
    expect(presentLabel(0, 0)).toBe('0 of 0 present');
  });
});

describe('percent', () => {
  it('rounds to a whole percent', () => {
    expect(percent(12, 15)).toBe('80%');
    expect(percent(1, 3)).toBe('33%');
    expect(percent(2, 3)).toBe('67%');
    expect(percent(0, 5)).toBe('0%');
    expect(percent(5, 5)).toBe('100%');
  });

  it('is blank with nothing to count', () => {
    expect(percent(0, 0)).toBe('');
  });
});

describe('marksToSave', () => {
  it('keeps only athletes who were marked', () => {
    expect(
      marksToSave([
        { profile_id: 'a', full_name: 'A', present: true },
        { profile_id: 'b', full_name: 'B', present: null },
        { profile_id: 'c', full_name: 'C', present: false },
      ]),
    ).toEqual([
      { profile_id: 'a', present: true },
      { profile_id: 'c', present: false },
    ]);
  });

  it('is empty when nobody was marked', () => {
    expect(marksToSave([{ profile_id: 'a', full_name: null, present: null }])).toEqual([]);
  });
});
