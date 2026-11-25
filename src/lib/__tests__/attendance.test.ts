import {
  filledFromAbsences,
  marksToSave,
  percent,
  presentLabel,
  withReportedAbsences,
} from '@/lib/attendance';

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

describe('reported absences in a new register', () => {
  const register = [
    { profile_id: 'a1', full_name: 'Alice', present: null },
    { profile_id: 'a2', full_name: 'Bea', present: null },
    { profile_id: 'a3', full_name: 'Cal', present: true },
    { profile_id: 'a4', full_name: 'Dee', present: false },
  ];

  it('marks an unmarked athlete who was reported away as Absent', () => {
    expect(withReportedAbsences(register, ['a2']).map((m) => m.present)).toEqual([
      null,
      false,
      true,
      false,
    ]);
    expect(filledFromAbsences(register, ['a2'])).toEqual(['a2']);
  });

  it('never changes a mark made by hand', () => {
    expect(withReportedAbsences(register, ['a3', 'a4']).map((m) => m.present)).toEqual([
      null,
      null,
      true,
      false,
    ]);
    expect(filledFromAbsences(register, ['a3', 'a4'])).toEqual([]);
  });

  it('leaves the register alone with nobody away, or only people outside it', () => {
    expect(withReportedAbsences(register, [])).toEqual(register);
    expect(withReportedAbsences(register, ['someone-else'])).toEqual(register);
    expect(filledFromAbsences(register, ['someone-else'])).toEqual([]);
  });

  it('does not change the register it was given', () => {
    const before = JSON.stringify(register);
    withReportedAbsences(register, ['a1', 'a2']);
    expect(JSON.stringify(register)).toBe(before);
  });
});
