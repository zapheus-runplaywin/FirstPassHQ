import { Platform } from 'react-native';

import { parseIcs } from './calendar';

/**
 * Tidies a pasted calendar link: drops spaces and line breaks, which a paste
 * from an email or a note can slip into the middle of a long Outlook link.
 */
export function cleanCalendarUrl(url: string) {
  return url.replace(/\s+/g, '');
}

/** Outlook's published links start with https:// (or webcal://). */
export function isCalendarUrl(url: string) {
  return /^(https|webcal):\/\/\S+$/i.test(url);
}

export const NOT_A_LINK = 'Paste the ICS link from Outlook. It starts with https://';
export const HTML_LINK =
  'That’s Outlook’s web page link (it ends in .html). Use the ICS link instead, which ends in .ics.';
const WEB_PAGE =
  'That link opens a web page, not a calendar file. Use the ICS link from Outlook, which ends in .ics.';

/** Outlook publishes each calendar twice: calendar.html to view, calendar.ics to subscribe. */
function isHtmlLink(url: string) {
  return /\.html?$/i.test(url.split(/[?#]/)[0]);
}

/**
 * Downloads a calendar link before it's saved, so a broken or incomplete link
 * is refused with a reason instead of leaving every member's calendar showing
 * "Couldn't load". Returns the reason, or null when the link is a calendar the
 * app can read.
 */
export async function checkCalendarUrl(url: string): Promise<string | null> {
  if (!isCalendarUrl(url)) return NOT_A_LINK;
  if (isHtmlLink(url)) return HTML_LINK;
  let response: Response;
  try {
    response = await fetch(url.replace(/^webcal:\/\//i, 'https://'));
  } catch {
    // In a web browser the calendar's site may refuse to be read from another
    // site (CORS), so a failed download there says nothing about the link.
    if (Platform.OS === 'web') return null;
    return 'Couldn’t reach that link. Check you’re online and the whole link was pasted.';
  }
  if (!response.ok) {
    return `That link didn’t work (error ${response.status}). Copy the ICS link from Outlook again and paste the whole of it.`;
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return 'Couldn’t reach that link. Check you’re online and the whole link was pasted.';
  }
  if (!text.includes('BEGIN:VCALENDAR')) {
    return WEB_PAGE;
  }
  try {
    const now = new Date();
    parseIcs(text, { id: 'check', name: 'check', clubWide: true, color: '#000000' }, now, now);
  } catch {
    return 'That calendar file couldn’t be read. Copy the ICS link from Outlook again.';
  }
  return null;
}
