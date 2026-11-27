// The phone link for a club-wide calendar kept in the app: turns what the
// database gives for a link's key into a calendar file a phone's calendar
// app subscribes to. Kept apart from index.ts so Jest can test it.
//
// What goes out is only what public.calendar_phone_feed gives: each event's
// name, time, place and whether it's cancelled. The key in the link is the
// only way in, so it is never logged and never echoed back, and a wrong key
// gets the same plain "Not found" as any other wrong address.

export type FeedEvent = {
  id: string;
  title: string;
  all_day: boolean;
  starts_at: string;
  ends_at: string;
  /** The club's own days for an all-day event, the last day included. */
  day: string;
  end_day: string;
  location: string | null;
  cancelled: boolean;
  changed_at: string | null;
};

export type Feed = { name: string; events: FeedEvent[] };

export type Deps = {
  /** What the link gives, or null when the key is unknown or the link is off. */
  feed(token: string): Promise<Feed | null>;
  logger: { error(message: string): void };
  now?: () => Date;
};

/** The keys the database makes are 48 hex characters; anything else isn't asked about. */
const KEY = /^[0-9a-f]{32,128}$/;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A moment as a calendar file writes it, in UTC: 20261204T100000Z. */
export function utcStamp(date: Date) {
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** A day ("2026-12-05") as a calendar file writes it, moved on by `days`. */
export function dayStamp(day: string, days = 0) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/** Text as a calendar file needs it: backslashes, commas, semicolons and line breaks escaped. */
export function escapeText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\;');
}

const encoder = new TextEncoder();

/** One line folded so no line is over 75 bytes, never splitting a character. */
export function fold(line: string) {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // Continuation lines start with a space, which counts.
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** The calendar file for a link: every event, cancelled ones marked. */
export function toIcs(feed: Feed, now: Date) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FirstPass HQ//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(feed.name)}`,
    // Ask calendar apps to look again each hour; most choose their own pace.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of feed.events) {
    const changed = event.changed_at ? new Date(event.changed_at) : now;
    lines.push('BEGIN:VEVENT', `UID:${event.id}@firstpass-hq`, `DTSTAMP:${utcStamp(now)}`);
    lines.push(`LAST-MODIFIED:${utcStamp(Number.isNaN(changed.getTime()) ? now : changed)}`);
    if (event.all_day) {
      // A calendar file ends an all-day event on the day after its last day.
      lines.push(`DTSTART;VALUE=DATE:${dayStamp(event.day)}`, `DTEND;VALUE=DATE:${dayStamp(event.end_day, 1)}`);
    } else {
      lines.push(`DTSTART:${utcStamp(new Date(event.starts_at))}`, `DTEND:${utcStamp(new Date(event.ends_at))}`);
    }
    lines.push(`SUMMARY:${escapeText(event.cancelled ? `Cancelled: ${event.title}` : event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.cancelled) lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const PLAIN = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
};

const notFound = () => new Response('Not found', { status: 404, headers: PLAIN });

/** Answers one request for a phone link. */
export async function handleFeed(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...PLAIN, Allow: 'GET, HEAD' } });
  }
  let token: string | null;
  try {
    token = new URL(request.url).searchParams.get('t');
  } catch {
    return notFound();
  }
  if (!token || !KEY.test(token)) return notFound();

  let feed: Feed | null;
  try {
    feed = await deps.feed(token);
  } catch (error) {
    // Never the key or the address: only what went wrong.
    deps.logger.error(`calendar-feed: ${error instanceof Error ? error.message : 'failed'}`);
    // "Try again later", so a calendar app keeps what it has instead of emptying.
    return new Response('Try again later', { status: 503, headers: { ...PLAIN, 'Retry-After': '900' } });
  }
  if (!feed) return notFound();

  const body = toIcs(feed, deps.now ? deps.now() : new Date());
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="calendar.ics"',
      // The link is a key: nothing shared may keep a copy.
      'Cache-Control': 'private, max-age=300',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
