/**
 * The club's calendar day, the same rule as the database's club_today().
 *
 * Moments are stored in UTC. "Today" is the day in the club's time zone,
 * which an admin chooses in Club settings > Club options (Perth unless
 * changed). The app uses it wherever a day is sent to the database or
 * compared with one, so a phone set to another zone, or a moment near
 * midnight, can't put the app and the database a day apart.
 *
 * ClubProvider sets the zone once the club's settings load. Until then (or if
 * the device can't work in that zone) the device's own day is used, as before.
 */

/** The zone a club starts in, as the database's club_settings default. */
export const DEFAULT_CLUB_TIME_ZONE = 'Australia/Perth';

/** The zones an admin can choose, with the cities members know them by. */
export const CLUB_TIME_ZONES: readonly { value: string; label: string }[] = [
  { value: 'Australia/Perth', label: 'Perth (Western Australia)' },
  { value: 'Australia/Darwin', label: 'Darwin (Northern Territory)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (South Australia)' },
  { value: 'Australia/Broken_Hill', label: 'Broken Hill (New South Wales)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (Queensland)' },
  { value: 'Australia/Sydney', label: 'Sydney (New South Wales and the ACT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (Victoria)' },
  { value: 'Australia/Hobart', label: 'Hobart (Tasmania)' },
  { value: 'Australia/Lord_Howe', label: 'Lord Howe Island' },
  { value: 'Pacific/Auckland', label: 'Auckland (New Zealand)' },
];

let clubZone: string | null = null;

/** Whether this device can work out days in a zone. */
export function isTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Called by ClubProvider with the zone from Club settings. */
export function setClubTimeZone(timeZone: string | null | undefined) {
  clubZone = isTimeZone(timeZone) ? timeZone : null;
}

/** The zone days are worked out in now, or null for the device's own. */
export function clubTimeZone() {
  return clubZone;
}

/** A city name for a zone, such as "Perth (Western Australia)". */
export function timeZoneLabel(timeZone: string | null | undefined) {
  const name = timeZone || DEFAULT_CLUB_TIME_ZONE;
  return CLUB_TIME_ZONES.find((z) => z.value === name)?.label ?? name.replace(/_/g, ' ');
}

function deviceDay(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The club's calendar day at a moment, such as "2026-11-23". Takes a Date or
 * a stored timestamp such as "2026-11-22T16:00:00Z".
 */
export function clubDay(at: Date | string | number, timeZone: string | null = clubZone) {
  const date = at instanceof Date ? at : new Date(at);
  if (!timeZone) return deviceDay(date);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    const [year, month, day] = [part('year'), part('month'), part('day')];
    if (!year || !month || !day) return deviceDay(date);
    return `${year}-${month}-${day}`;
  } catch {
    return deviceDay(date);
  }
}

/** The club's calendar day now, such as "2026-11-23". */
export function clubToday(now: Date = new Date(), timeZone: string | null = clubZone) {
  return clubDay(now, timeZone);
}
