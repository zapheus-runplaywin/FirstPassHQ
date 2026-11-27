/**
 * @jest-environment node
 */
// The phone link works without signing in, so these pin what it gives (names,
// times and places only), that a wrong or missing key gets a plain "Not
// found", that the key is never logged or echoed, and that the file it makes
// reads back in the app's own calendar reader as the same events.

import { parseIcs } from '@/lib/calendar';

import { dayStamp, escapeText, fold, handleFeed, toIcs, utcStamp, type Feed, type FeedEvent } from '../feed';

const NOW = new Date('2026-11-28T01:02:03Z');
const KEY = 'a1'.repeat(24);

const event = (changes: Partial<FeedEvent> = {}): FeedEvent => ({
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Quiz night',
  all_day: false,
  starts_at: '2026-12-05T10:00:00+00:00',
  ends_at: '2026-12-05T13:00:00+00:00',
  day: '2026-12-05',
  end_day: '2026-12-05',
  location: 'Clubrooms, 12 Stadium Road',
  cancelled: false,
  changed_at: '2026-11-20T03:00:00+00:00',
  ...changes,
});

const feed = (events: FeedEvent[] = [event()]): Feed => ({ name: 'West Coast Thunder', events });

function deps(answer: Feed | null | Error = feed()) {
  const errors: string[] = [];
  const asked: string[] = [];
  return {
    errors,
    asked,
    deps: {
      logger: { error: (message: string) => errors.push(message) },
      now: () => NOW,
      async feed(token: string) {
        asked.push(token);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

const get = (query: string, method = 'GET') =>
  new Request(`https://club.example.test/functions/v1/calendar-feed${query}`, { method });

describe('the pieces of a calendar file', () => {
  it('writes a moment in UTC and a day as a date', () => {
    expect(utcStamp(new Date('2026-12-05T18:00:00+08:00'))).toBe('20261205T100000Z');
    expect(dayStamp('2026-12-05')).toBe('20261205');
    expect(dayStamp('2026-12-31', 1)).toBe('20270101');
    expect(dayStamp('2028-02-28', 1)).toBe('20280229');
  });

  it('escapes commas, semicolons, backslashes and line breaks', () => {
    expect(escapeText('Court 1, Hall; back\\door\nUpstairs\r\nLeft')).toBe('Court 1\\, Hall\; back\\\\door\\nUpstairs\\nLeft');
  });

  it('folds long lines at 75 bytes without splitting a character', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    const folded = fold(line).split('\r\n');
    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    expect(folded.map((part, i) => (i === 0 ? part : part.slice(1))).join('')).toBe(line);
    expect(fold('SUMMARY:Short')).toBe('SUMMARY:Short');
  });
});

describe('toIcs', () => {
  it('writes a timed event with its name, time and place', () => {
    const ics = toIcs(feed(), NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:West Coast Thunder\r\n');
    expect(ics).toContain('UID:11111111-1111-1111-1111-111111111111@firstpass-hq\r\n');
    expect(ics).toContain('DTSTAMP:20261128T010203Z\r\n');
    expect(ics).toContain('LAST-MODIFIED:20261120T030000Z\r\n');
    expect(ics).toContain('DTSTART:20261205T100000Z\r\n');
    expect(ics).toContain('DTEND:20261205T130000Z\r\n');
    expect(ics).toContain('SUMMARY:Quiz night\r\n');
    expect(ics).toContain('LOCATION:Clubrooms\\, 12 Stadium Road\r\n');
    expect(ics).not.toContain('STATUS:CANCELLED');
  });

  it('writes an all-day event from the club’s days, ending the day after its last', () => {
    const ics = toIcs(feed([event({ all_day: true, day: '2026-12-05', end_day: '2026-12-06', location: null })]), NOW);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261205\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20261207\r\n');
    expect(ics).not.toContain('LOCATION');
  });

  it('marks a cancelled event in its name and status, so every calendar app shows it’s off', () => {
    const ics = toIcs(feed([event({ cancelled: true })]), NOW);
    expect(ics).toContain('SUMMARY:Cancelled: Quiz night\r\n');
    expect(ics).toContain('STATUS:CANCELLED\r\n');
  });

  it('gives an empty calendar when there are no events', () => {
    const ics = toIcs(feed([]), NOW);
    expect(ics).not.toContain('VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('writes nothing beyond what it was given: no notes, no people', () => {
    const extra = { ...event(), note: 'Ring Sam on 0400 000 000', created_by_name: 'Cam Roberts' } as FeedEvent;
    const ics = toIcs(feed([extra]), NOW);
    expect(ics).not.toMatch(/0400|Cam Roberts|DESCRIPTION|ORGANIZER|ATTENDEE/);
  });

  it('uses now when an event has no change time, or one it can’t read', () => {
    expect(toIcs(feed([event({ changed_at: null })]), NOW)).toContain('LAST-MODIFIED:20261128T010203Z');
    expect(toIcs(feed([event({ changed_at: 'nonsense' })]), NOW)).toContain('LAST-MODIFIED:20261128T010203Z');
  });

  it('reads back in the app’s own calendar reader as the same events', () => {
    const ics = toIcs(
      feed([
        event({ title: 'Quiz night, round 2; bring a pen', location: 'Hall A, upstairs' }),
        event({ id: '22222222-2222-2222-2222-222222222222', title: 'Carnival', all_day: true, day: '2026-12-12', end_day: '2026-12-13', location: null }),
        event({ id: '33333333-3333-3333-3333-333333333333', title: `Long ${'name '.repeat(30)}end`, starts_at: '2026-12-20T02:00:00Z', ends_at: '2026-12-20T03:00:00Z' }),
      ]),
      NOW,
    );
    const read = parseIcs(ics, { id: 'c', name: 'Club', clubWide: true, color: '#fff' }, new Date('2026-11-01T00:00:00Z'), new Date('2027-01-31T00:00:00Z'));
    expect(read.map((e) => e.title)).toEqual([
      'Quiz night, round 2; bring a pen',
      'Carnival',
      `Long ${'name '.repeat(30)}end`,
    ]);
    expect(read[0].start.toISOString()).toBe('2026-12-05T10:00:00.000Z');
    expect(read[0].end.toISOString()).toBe('2026-12-05T13:00:00.000Z');
    expect(read[0].location).toBe('Hall A, upstairs');
    expect(read[1].allDay).toBe(true);
    expect([read[1].start.getMonth(), read[1].start.getDate()]).toEqual([11, 12]);
    expect([read[1].end.getMonth(), read[1].end.getDate()]).toEqual([11, 14]);
  });
});

describe('handleFeed', () => {
  it('gives the calendar file for a good key', async () => {
    const { deps: d, asked } = deps();
    const response = await handleFeed(get(`?t=${KEY}`), d);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await response.text()).toContain('SUMMARY:Quiz night');
    expect(asked).toEqual([KEY]);
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await handleFeed(get(`?t=${KEY}`, 'HEAD'), deps().deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('says only Not found when the database knows no such link', async () => {
    const response = await handleFeed(get(`?t=${KEY}`), deps(null).deps);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([
    ['no key', ''],
    ['an empty key', '?t='],
    ['a short key', '?t=abc123'],
    ['a key with other characters', `?t=${'zz'.repeat(24)}`],
    ['capital letters', `?t=${'A1'.repeat(24)}`],
    ['a key that tries SQL', `?t=${encodeURIComponent("' or 1=1 --")}`],
    ['a very long key', `?t=${'a'.repeat(500)}`],
    ['the key under another name', `?token=${KEY}`],
  ])('says the same for %s, without asking the database', async (_name, query) => {
    const { deps: d, asked } = deps();
    const response = await handleFeed(get(query), d);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expect(asked).toEqual([]);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('refuses %s: the link is read only', async (method) => {
    const { deps: d, asked } = deps();
    const response = await handleFeed(get(`?t=${KEY}`, method), d);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(asked).toEqual([]);
  });

  it('asks the phone to try again later when the database fails, and never logs the key', async () => {
    const { deps: d, errors } = deps(new Error('calendar_phone_feed: 57014'));
    const response = await handleFeed(get(`?t=${KEY}`), d);
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('900');
    expect(await response.text()).toBe('Try again later');
    expect(errors).toEqual(['calendar-feed: calendar_phone_feed: 57014']);
    expect(errors.join(' ')).not.toContain(KEY);
  });

  it('never echoes the key back', async () => {
    for (const answer of [feed(), null]) {
      const response = await handleFeed(get(`?t=${KEY}`), deps(answer).deps);
      expect(await response.text()).not.toContain(KEY);
      expect([...response.headers.values()].join(' ')).not.toContain(KEY);
    }
  });
});
