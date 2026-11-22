import { isMinor, isUnder13 } from '@/lib/age';
import { today } from '@/lib/check-ins';
import {
  CLUB_TIME_ZONES,
  DEFAULT_CLUB_TIME_ZONE,
  clubDay,
  clubTimeZone,
  clubToday,
  isTimeZone,
  setClubTimeZone,
  timeZoneLabel,
} from '@/lib/club-time';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));

// Moments are given in UTC, so these mean the same wherever the tests run.
function setNow(iso: string) {
  jest.useFakeTimers().setSystemTime(new Date(iso));
}

afterEach(() => {
  jest.useRealTimers();
  setClubTimeZone(null);
});

describe('clubDay', () => {
  it('is Perth’s day either side of Perth’s midnight (4 pm UTC)', () => {
    expect(clubDay('2026-11-22T15:59:59Z', 'Australia/Perth')).toBe('2026-11-22');
    expect(clubDay('2026-11-22T16:00:00Z', 'Australia/Perth')).toBe('2026-11-23');
    expect(clubDay('2026-11-22T16:00:01Z', 'Australia/Perth')).toBe('2026-11-23');
  });

  it('is the club’s day while the UTC day is still yesterday', () => {
    expect(clubDay('2026-11-22T23:59:59Z', 'Australia/Perth')).toBe('2026-11-23');
    expect(clubDay('2026-11-22T23:59:59Z', 'UTC')).toBe('2026-11-22');
  });

  it('crosses into a new year at the club’s midnight', () => {
    expect(clubDay('2026-12-31T15:59:59Z', 'Australia/Perth')).toBe('2026-12-31');
    expect(clubDay('2026-12-31T16:00:00Z', 'Australia/Perth')).toBe('2027-01-01');
  });

  it('follows daylight saving in Sydney', () => {
    // Summer, UTC+11: midnight is 1 pm UTC.
    expect(clubDay('2026-11-22T12:59:59Z', 'Australia/Sydney')).toBe('2026-11-22');
    expect(clubDay('2026-11-22T13:00:00Z', 'Australia/Sydney')).toBe('2026-11-23');
    // Winter, UTC+10: midnight is 2 pm UTC.
    expect(clubDay('2026-06-22T13:59:59Z', 'Australia/Sydney')).toBe('2026-06-22');
    expect(clubDay('2026-06-22T14:00:00Z', 'Australia/Sydney')).toBe('2026-06-23');
  });

  it('takes a Date, a stored timestamp or milliseconds', () => {
    const moment = '2026-11-22T16:30:00Z';
    expect(clubDay(new Date(moment), 'Australia/Perth')).toBe('2026-11-23');
    expect(clubDay(moment, 'Australia/Perth')).toBe('2026-11-23');
    expect(clubDay(Date.parse(moment), 'Australia/Perth')).toBe('2026-11-23');
  });

  it('pads single-digit months and days', () => {
    expect(clubDay('2026-03-04T02:00:00Z', 'Australia/Perth')).toBe('2026-03-04');
  });

  it('uses the device’s own day until the club’s zone is known', () => {
    const moment = new Date(2026, 10, 22, 23, 30);
    expect(clubDay(moment)).toBe('2026-11-22');
  });

  it('uses the device’s own day for a zone the device doesn’t know', () => {
    const moment = new Date(2026, 10, 22, 23, 30);
    expect(clubDay(moment, 'Mars/Olympus_Mons')).toBe('2026-11-22');
  });
});

describe('the club’s zone', () => {
  it('is set from Club settings', () => {
    setClubTimeZone('Australia/Sydney');
    expect(clubTimeZone()).toBe('Australia/Sydney');
  });

  it('ignores a zone the device doesn’t know, and blanks', () => {
    setClubTimeZone('Australia/Sydney');
    setClubTimeZone('Mars/Olympus_Mons');
    expect(clubTimeZone()).toBeNull();
    setClubTimeZone('');
    expect(clubTimeZone()).toBeNull();
    setClubTimeZone(undefined);
    expect(clubTimeZone()).toBeNull();
  });

  it('decides today', () => {
    setNow('2026-11-22T16:30:00Z');
    setClubTimeZone('Australia/Perth');
    expect(clubToday()).toBe('2026-11-23');
    setClubTimeZone('Australia/Sydney');
    expect(clubToday()).toBe('2026-11-23');
    setClubTimeZone('Pacific/Pago_Pago');
    expect(clubToday()).toBe('2026-11-22');
  });

  it('decides the check-in day', () => {
    setNow('2026-11-22T16:30:00Z');
    setClubTimeZone('Australia/Perth');
    expect(today()).toBe('2026-11-23');
  });
});

describe('ages on the club’s day', () => {
  it('turns 18 at the club’s midnight, not UTC’s', () => {
    setClubTimeZone('Australia/Perth');
    setNow('2026-11-22T15:59:59Z');
    expect(isMinor('2008-11-23', false)).toBe(true);
    setNow('2026-11-22T16:00:00Z');
    expect(isMinor('2008-11-23', false)).toBe(false);
  });

  it('is 13 at the club’s midnight', () => {
    setClubTimeZone('Australia/Perth');
    setNow('2026-11-22T15:59:59Z');
    expect(isUnder13('2013-11-23')).toBe(true);
    setNow('2026-11-22T16:00:00Z');
    expect(isUnder13('2013-11-23')).toBe(false);
  });

  it('has a 29 February birthday on 1 March in other years, as the database does', () => {
    setClubTimeZone('Australia/Perth');
    setNow('2026-02-28T04:00:00Z');
    expect(isMinor('2008-02-29', false)).toBe(true);
    setNow('2026-03-01T04:00:00Z');
    expect(isMinor('2008-02-29', false)).toBe(false);
  });
});

describe('the zones admins choose from', () => {
  it('starts with Perth, the zone a new club has', () => {
    expect(DEFAULT_CLUB_TIME_ZONE).toBe('Australia/Perth');
    expect(CLUB_TIME_ZONES[0].value).toBe(DEFAULT_CLUB_TIME_ZONE);
  });

  it('are all zones the device knows, once each', () => {
    for (const zone of CLUB_TIME_ZONES) expect(isTimeZone(zone.value)).toBe(true);
    expect(new Set(CLUB_TIME_ZONES.map((z) => z.value)).size).toBe(CLUB_TIME_ZONES.length);
  });

  it('are named by city', () => {
    expect(timeZoneLabel('Australia/Perth')).toBe('Perth (Western Australia)');
    expect(timeZoneLabel('Australia/Hobart')).toBe('Hobart (Tasmania)');
  });

  it('names a zone saved some other way readably', () => {
    expect(timeZoneLabel('America/Los_Angeles')).toBe('America/Los Angeles');
  });

  it('names Perth when nothing is saved', () => {
    expect(timeZoneLabel(null)).toBe('Perth (Western Australia)');
  });

  it('knows a real zone from a made-up one', () => {
    expect(isTimeZone('Australia/Perth')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone(null)).toBe(false);
  });
});
