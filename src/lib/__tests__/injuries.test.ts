import {
  formatDateString,
  injuriesSummary,
  isImageDocument,
  parseDateString,
  toCsv,
  toDateString,
} from '@/lib/injuries';
import type { Injury } from '@/lib/types';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));

function injury(waiting_for_me = false): Injury {
  return {
    id: 'i',
    athlete_id: 'a',
    athlete_name: 'Sam Sample',
    body_area: 'Ankle',
    description: '',
    injured_on: '2026-10-01',
    restrictions: null,
    expected_return: null,
    status: 'injured',
    coach_endorsed_by: null,
    cleared_at: null,
    created_at: '2026-10-01T00:00:00Z',
    last_update_at: null,
    can_report: false,
    waiting_for_me,
  };
}

describe('injuriesSummary', () => {
  it('says when there are none', () => {
    expect(injuriesSummary([])).toBe('No current injuries');
  });

  it('counts injuries and those waiting for the member', () => {
    expect(injuriesSummary([injury()])).toBe('1 current injury');
    expect(injuriesSummary([injury(true), injury(), injury(true)])).toBe(
      '3 current injuries · 2 waiting for you',
    );
  });
});

describe('toDateString and parseDateString', () => {
  it('use the local calendar day', () => {
    expect(toDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(toDateString(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('parse a day to local midnight', () => {
    expect(parseDateString('2026-10-07')).toEqual(new Date(2026, 9, 7));
  });

  it('round-trip', () => {
    expect(toDateString(parseDateString('2024-02-29'))).toBe('2024-02-29');
  });
});

describe('formatDateString', () => {
  it('formats the local day with the phone locale', () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(2026, 9, 7));
    expect(formatDateString('2026-10-07')).toBe(expected);
  });
});

describe('isImageDocument', () => {
  it('knows photos', () => {
    expect(isImageDocument('a/b/123-photo.jpg')).toBe(true);
    expect(isImageDocument('a/b/123-photo.JPEG')).toBe(true);
    expect(isImageDocument('x.png')).toBe(true);
    expect(isImageDocument('x.heic')).toBe(true);
    expect(isImageDocument('x.HEIF')).toBe(true);
  });

  it('treats everything else as a PDF', () => {
    expect(isImageDocument('a/b/letter.pdf')).toBe(false);
    expect(isImageDocument('photo.jpg.pdf')).toBe(false);
    expect(isImageDocument('jpg')).toBe(false);
  });
});

describe('toCsv', () => {
  it('quotes every value and joins rows with CRLF', () => {
    expect(
      toCsv([
        ['Name', 'Count'],
        ['Sam', 3],
      ]),
    ).toBe('"Name","Count"\r\n"Sam","3"');
  });

  it('escapes quotes and keeps commas and line breaks inside a value', () => {
    expect(toCsv([['Say "hi", then\nleave']])).toBe('"Say ""hi"", then\nleave"');
  });

  it('writes nulls as blanks', () => {
    expect(toCsv([[null, 'x']])).toBe('"","x"');
  });

  it('stops text running as a spreadsheet formula', () => {
    expect(toCsv([['=SUM(A1)', '+1', '-1', '@x', '\tx', '\rx']])).toBe(
      `"'=SUM(A1)","'+1","'-1","'@x","'\tx","'\rx"`,
    );
  });

  it('leaves negative numbers alone', () => {
    expect(toCsv([[-5]])).toBe('"-5"');
  });

  it('is empty with no rows', () => {
    expect(toCsv([])).toBe('');
  });
});
