/**
 * The check an admin's calendar link goes through before it's saved
 * (src/lib/calendar-url.ts). A wrong link, such as Outlook's web page link
 * instead of its ICS link, used to save fine and then left every member's
 * calendar showing "Couldn't load" (21 November 2026).
 */
import { Platform } from 'react-native';

import { checkCalendarUrl, cleanCalendarUrl, HTML_LINK, isCalendarUrl, NOT_A_LINK } from '../calendar-url';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:1',
  'DTSTART:20261201T090000Z',
  'DTEND:20261201T100000Z',
  'SUMMARY:Training',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const OUTLOOK = 'https://outlook.office365.com/owa/calendar/abc@club.example/def/calendar';

let fetchMock: jest.Mock;
function serve(answer: { ok?: boolean; status?: number; body?: string } | 'offline') {
  fetchMock = jest.fn(async () => {
    if (answer === 'offline') throw new TypeError('Network request failed');
    return { ok: answer.ok ?? true, status: answer.status ?? 200, text: async () => answer.body ?? '' };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const originalOS = Platform.OS;
afterEach(() => {
  Platform.OS = originalOS;
});

describe('cleanCalendarUrl', () => {
  it('drops spaces and line breaks a paste slipped into the link', () => {
    expect(cleanCalendarUrl(`  ${OUTLOOK.slice(0, 30)}\n ${OUTLOOK.slice(30)}.ics \t`)).toBe(`${OUTLOOK}.ics`);
  });
});

describe('isCalendarUrl', () => {
  it.each([`${OUTLOOK}.ics`, 'webcal://outlook.example/club.ics', 'HTTPS://x.test/a.ics'])('accepts %s', (url) => {
    expect(isCalendarUrl(url)).toBe(true);
  });
  it.each(['', 'https://', 'http://x.test/a.ics', 'ftp://x', 'outlook.example/club.ics', 'https://x.test/a b.ics'])(
    'refuses “%s”',
    (url) => {
      expect(isCalendarUrl(url)).toBe(false);
    },
  );
});

describe('checkCalendarUrl', () => {
  it('passes a link that downloads a calendar file the app can read', async () => {
    serve({ body: ICS });
    expect(await checkCalendarUrl(`${OUTLOOK}.ics`)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(`${OUTLOOK}.ics`);
  });

  it('downloads a webcal:// link over https', async () => {
    serve({ body: ICS });
    expect(await checkCalendarUrl('webcal://outlook.example/club.ics')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://outlook.example/club.ics');
  });

  it('refuses something that isn’t an https:// or webcal:// link without downloading it', async () => {
    serve({ body: ICS });
    expect(await checkCalendarUrl('outlook.example/club.ics')).toBe(NOT_A_LINK);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([`${OUTLOOK}.html`, `${OUTLOOK}.HTML`, `${OUTLOOK}.htm`, `${OUTLOOK}.html?x=1`, `${OUTLOOK}.html#top`])(
    'names Outlook’s web page link %s without downloading it',
    async (url) => {
      serve({ body: ICS });
      expect(await checkCalendarUrl(url)).toBe(HTML_LINK);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('refuses a link that opens a web page rather than a calendar file', async () => {
    serve({ body: '<!DOCTYPE html><html><body>Calendar</body></html>' });
    expect(await checkCalendarUrl('https://outlook.example/view')).toBe(
      'That link opens a web page, not a calendar file. Use the ICS link from Outlook, which ends in .ics.',
    );
  });

  it.each([404, 500])('refuses a link that answers with error %i', async (status) => {
    serve({ ok: false, status });
    expect(await checkCalendarUrl(`${OUTLOOK}.ics`)).toBe(
      `That link didn’t work (error ${status}). Copy the ICS link from Outlook again and paste the whole of it.`,
    );
  });

  it('refuses a calendar file the app can’t read', async () => {
    serve({ body: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nnot ics at all' });
    expect(await checkCalendarUrl(`${OUTLOOK}.ics`)).toBe(
      'That calendar file couldn’t be read. Copy the ICS link from Outlook again.',
    );
  });

  it('refuses a link it can’t reach on a phone', async () => {
    serve('offline');
    expect(await checkCalendarUrl(`${OUTLOOK}.ics`)).toBe(
      'Couldn’t reach that link. Check you’re online and the whole link was pasted.',
    );
  });

  it('lets a link through in a web browser when the download is blocked, since the site may refuse other sites', async () => {
    Platform.OS = 'web';
    serve('offline');
    expect(await checkCalendarUrl(`${OUTLOOK}.ics`)).toBeNull();
  });

  it('still refuses Outlook’s web page link in a web browser', async () => {
    Platform.OS = 'web';
    serve('offline');
    expect(await checkCalendarUrl(`${OUTLOOK}.html`)).toBe(HTML_LINK);
  });
});
