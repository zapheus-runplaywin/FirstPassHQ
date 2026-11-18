import { formatDate, isMinor, isUnder13, parseDate, under13Message } from '@/lib/age';

// Local-time "now" so the tests mean the same in any time zone.
function setToday(year: number, month: number, day: number) {
  jest.useFakeTimers().setSystemTime(new Date(year, month - 1, day, 12));
}

afterEach(() => {
  jest.useRealTimers();
});

describe('formatDate', () => {
  it('turns YYYY-MM-DD into DD/MM/YYYY', () => {
    expect(formatDate('2010-03-14')).toBe('14/03/2010');
  });

  it('is blank for no date', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
  });
});

describe('parseDate', () => {
  it('reads years from 1900 to 2100 only', () => {
    expect(parseDate('31/12/1899')).toBeUndefined();
    expect(parseDate('01/01/1900')).toBe('1900-01-01');
    expect(parseDate('31/12/2100')).toBe('2100-12-31');
    expect(parseDate('01/01/2101')).toBeUndefined();
    expect(parseDate('01/01/0500')).toBeUndefined();
  });

  it('reads DD/MM/YYYY', () => {
    expect(parseDate('14/03/2010')).toBe('2010-03-14');
  });

  it('reads one-digit days and months', () => {
    expect(parseDate('1/2/2010')).toBe('2010-02-01');
  });

  it('accepts dots and dashes as separators', () => {
    expect(parseDate('14.03.2010')).toBe('2010-03-14');
    expect(parseDate('14-03-2010')).toBe('2010-03-14');
  });

  it('ignores spaces around the date', () => {
    expect(parseDate('  14/03/2010 ')).toBe('2010-03-14');
  });

  it('is null when blank', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('   ')).toBeNull();
  });

  it('is undefined for text that is not a date', () => {
    expect(parseDate('yesterday')).toBeUndefined();
    expect(parseDate('2010-03-14')).toBeUndefined();
    expect(parseDate('14/03/10')).toBeUndefined();
    expect(parseDate('14/03/2010x')).toBeUndefined();
    expect(parseDate('114/03/2010')).toBeUndefined();
  });

  it('is undefined for days that do not exist', () => {
    expect(parseDate('31/04/2010')).toBeUndefined();
    expect(parseDate('32/01/2010')).toBeUndefined();
    expect(parseDate('00/01/2010')).toBeUndefined();
  });

  it('is undefined for years 0 to 99 typed with leading zeros', () => {
    expect(parseDate('01/01/0050')).toBeUndefined();
    expect(parseDate('01/01/0000')).toBeUndefined();
    expect(parseDate('10/13/2010')).toBeUndefined();
    expect(parseDate('10/00/2010')).toBeUndefined();
  });

  it('knows leap years', () => {
    expect(parseDate('29/02/2024')).toBe('2024-02-29');
    expect(parseDate('29/02/2000')).toBe('2000-02-29');
    expect(parseDate('29/02/2023')).toBeUndefined();
    expect(parseDate('29/02/1900')).toBeUndefined();
  });

  it('round-trips with formatDate', () => {
    expect(formatDate(parseDate('05/11/2008'))).toBe('05/11/2008');
  });
});

describe('isMinor', () => {
  it('uses the admin choice without a date of birth', () => {
    expect(isMinor(null, true)).toBe(true);
    expect(isMinor(null, false)).toBe(false);
    expect(isMinor(undefined, true)).toBe(true);
    expect(isMinor('', false)).toBe(false);
  });

  it('is true the day before the 18th birthday', () => {
    setToday(2026, 10, 17);
    expect(isMinor('2008-10-18', false)).toBe(true);
  });

  it('is false on the 18th birthday', () => {
    setToday(2026, 10, 18);
    expect(isMinor('2008-10-18', true)).toBe(false);
  });

  it('is false after the 18th birthday, whatever the admin chose', () => {
    setToday(2026, 10, 19);
    expect(isMinor('2008-10-18', true)).toBe(false);
    expect(isMinor('1980-01-01', true)).toBe(false);
  });

  it('is true for young children, whatever the admin chose', () => {
    setToday(2026, 10, 18);
    expect(isMinor('2016-05-01', false)).toBe(true);
  });

  it('counts a 29 February birthday as 1 March in other years', () => {
    // Same as the database: date of birth > current_date - 18 years.
    setToday(2026, 2, 28);
    expect(isMinor('2008-02-29', false)).toBe(true);
    setToday(2026, 3, 1);
    expect(isMinor('2008-02-29', false)).toBe(false);
  });

  it('turns over at the start of the day, not part way through it', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 18, 0, 0, 1));
    expect(isMinor('2008-10-18', false)).toBe(false);
    jest.setSystemTime(new Date(2026, 9, 17, 23, 59, 59));
    expect(isMinor('2008-10-18', false)).toBe(true);
  });
});

describe('isUnder13', () => {
  it('is false with no date of birth: not known, so no', () => {
    expect(isUnder13(null)).toBe(false);
    expect(isUnder13(undefined)).toBe(false);
    expect(isUnder13('')).toBe(false);
  });

  it('is true the day before the 13th birthday', () => {
    setToday(2026, 11, 17);
    expect(isUnder13('2013-11-18')).toBe(true);
  });

  it('is false on the 13th birthday', () => {
    setToday(2026, 11, 18);
    expect(isUnder13('2013-11-18')).toBe(false);
  });

  it('is false for teenagers and adults, true for young children', () => {
    setToday(2026, 11, 18);
    expect(isUnder13('2010-01-01')).toBe(false);
    expect(isUnder13('1980-06-30')).toBe(false);
    expect(isUnder13('2019-05-01')).toBe(true);
    expect(isUnder13('2026-11-18')).toBe(true);
  });

  it('counts a 29 February birthday as 1 March in other years', () => {
    // Same as the database: date of birth > current_date - 13 years.
    setToday(2025, 2, 28);
    expect(isUnder13('2012-02-29')).toBe(true);
    setToday(2025, 3, 1);
    expect(isUnder13('2012-02-29')).toBe(false);
  });

  it('turns over at the start of the day, not part way through it', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 18, 0, 0, 1));
    expect(isUnder13('2013-11-18')).toBe(false);
    jest.setSystemTime(new Date(2026, 10, 17, 23, 59, 59));
    expect(isUnder13('2013-11-18')).toBe(true);
  });

  it('is under 18 too, whenever it is under 13', () => {
    setToday(2026, 11, 18);
    expect(isMinor('2013-11-19', false)).toBe(true);
  });
});

describe('under13Message', () => {
  it('is the words the database sends, so the join screen knows them', () => {
    expect(under13Message).toBe(
      'FirstPass HQ is for members aged 13 and over. If you’re a parent or guardian, enter your own date of birth.',
    );
  });
});
