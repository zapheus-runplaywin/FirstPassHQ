/**
 * The Club tab for the committee and admins: everything they look after,
 * grouped by the job into five areas, with a count where work is waiting (and
 * that work shown under its area, opened or not) and a search over all of it.
 *
 * Nothing here decides who may see anything. The cards are the ones
 * src/lib/home.tsx already shows the member, and the links are the admin's own
 * menu (src/lib/admin-menu.ts); this only sorts what the member already has
 * into areas, and searches it. An entry no area names goes to the end of Club
 * setup, so nothing a member could reach can go missing.
 */
import type { IconName } from '@/components/icon';
import type { AdminMenuItem } from '@/lib/admin-menu';
import type { HomeCard } from '@/lib/home-layout';

export type ClubAreaName = 'people' | 'safety' | 'season' | 'reports' | 'setup';

export const CLUB_AREAS: { name: ClubAreaName; title: string; icon: IconName }[] = [
  { name: 'people', title: 'People', icon: 'users' },
  { name: 'safety', title: 'Safety and conduct', icon: 'shield' },
  { name: 'season', title: 'Season', icon: 'calendar' },
  { name: 'reports', title: 'Reports and registers', icon: 'bar-chart-2' },
  { name: 'setup', title: 'Club setup', icon: 'sliders' },
];

/**
 * What each area holds, most used first: a card by its name, an admin's link
 * by the screen it opens.
 */
export const AREA_ENTRIES: Record<ClubAreaName, string[]> = {
  // Who is in the club, and how they are going.
  people: [
    '/admin',
    // Check-ins, attendance, then injuries: the order Home had them (Matt, 2026-11-12).
    'checkIns',
    'attendance',
    'injuries',
    'surveys',
    '/admin/squads',
    '/admin/invite',
    '/admin/captains',
  ],
  safety: ['concerns', '/admin/safeguarding', '/admin/conduct', 'integrity', '/admin/training'],
  season: [
    'selectionAssessments',
    'selectionAudits',
    'sessionPlans',
    'kpis',
    '/admin/seasons',
    '/admin/fixtures',
    '/admin/games',
    '/admin/assessments',
    '/admin/awards',
    '/admin/kpi-reviews',
  ],
  reports: ['reports', '/admin/reports', 'registers'],
  setup: [
    '/admin/club/features',
    '/admin/club/options',
    '/admin/club/brand',
    '/admin/calendars',
    '/admin/chat-groups',
    '/admin/absence-reasons',
    '/admin/club/records',
    '/admin/club-password',
  ],
};

/** The cards the Club tab can hold, with the words its search and summaries use. */
export const CLUB_CARDS: Partial<
  Record<HomeCard, { title: string; short: string; keywords: string[] }>
> = {
  concerns: { title: 'Concerns', short: 'concerns', keywords: ['register', 'safeguarding'] },
  checkIns: { title: 'Check-ins', short: 'check-ins', keywords: ['wellbeing', 'feeling'] },
  attendance: { title: 'Attendance', short: 'attendance', keywords: ['sessions', 'absences'] },
  injuries: { title: 'Injuries', short: 'injuries', keywords: ['clearances', 'medical'] },
  sessionPlans: { title: 'Session plans', short: 'session plans', keywords: ['training'] },
  reports: {
    title: 'Reports',
    short: 'reports',
    keywords: [
      'working with children',
      'wwcc',
      'under 18s',
      'medical details',
      'integrity training',
      'attendance',
      'award results',
    ],
  },
  registers: {
    title: 'Registers',
    short: 'registers',
    keywords: ['policies', 'conflicts of interest'],
  },
  surveys: { title: 'Surveys', short: 'surveys', keywords: ['results', 'questions'] },
  integrity: {
    title: 'Integrity training',
    short: 'integrity training',
    keywords: ['certificates', 'courses'],
  },
  kpis: { title: 'Season KPIs', short: 'season KPIs', keywords: ['goals', 'reviews'] },
  selectionAssessments: {
    title: 'Selection assessments',
    short: 'selection assessments',
    keywords: ['rounds', 'panel'],
  },
  selectionAudits: {
    title: 'Selection audits',
    short: 'selection audits',
    keywords: ['rounds', 'auditor'],
  },
};

/** Work waiting behind one entry: how much, and the line that says so. */
export type ClubWaiting = { count: number; text: string };

/** One thing in the Club tab: a card with its live line, or an admin's link. */
export type ClubEntry = {
  /** The card's name, or the screen the link opens. */
  key: string;
  area: ClubAreaName;
  title: string;
  short: string;
  /** Everything the search looks through, in lower case. */
  words: string;
  card?: HomeCard;
  link?: AdminMenuItem;
  waiting: number;
  waitingText?: string;
};

export type ClubArea = {
  name: ClubAreaName;
  title: string;
  icon: IconName;
  entries: ClubEntry[];
  /** What is inside, as one line. */
  summary: string;
  /** How much work is waiting in the area. */
  waiting: number;
};

const areaOf = (key: string): ClubAreaName =>
  CLUB_AREAS.find((area) => AREA_ENTRIES[area.name].includes(key))?.name ?? 'setup';

const placeIn = (key: string, area: ClubAreaName) => {
  const at = AREA_ENTRIES[area].indexOf(key);
  return at < 0 ? Number.MAX_SAFE_INTEGER : at;
};

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** How many things an area's summary names before it counts the rest. */
export const SUMMARY_NAMES = 3;

/** What is inside an area, as one short line: the first few by name, then how many more. */
function summaryOf(entries: ClubEntry[]) {
  const names = entries.map((entry) => entry.short);
  const more = names.length - SUMMARY_NAMES;
  return sentence(
    more > 0
      ? `${names.slice(0, SUMMARY_NAMES).join(', ')} and ${more} more`
      : names.join(', '),
  );
}

/**
 * The member's Club tab as areas: the hub cards they are shown (`cards`) and,
 * for an admin, their menu (`links`), each in its area and in the area's
 * order. Areas with nothing in them are left out.
 */
export function clubAreas({
  cards,
  links,
  waiting = {},
}: {
  cards: HomeCard[];
  links: AdminMenuItem[];
  /** Work waiting, by entry key. */
  waiting?: Record<string, ClubWaiting | undefined>;
}): ClubArea[] {
  const entries: ClubEntry[] = [];
  for (const card of cards) {
    const meta = CLUB_CARDS[card];
    // The Administration card is the admin's menu, which comes as links.
    if (!meta) continue;
    entries.push({
      key: card,
      area: areaOf(card),
      title: meta.title,
      short: meta.short,
      words: [meta.title, meta.short, ...meta.keywords].join(' ').toLowerCase(),
      card,
      waiting: 0,
    });
  }
  for (const link of links) {
    const key = String(link.href);
    entries.push({
      key,
      area: areaOf(key),
      title: link.title,
      short: link.short,
      words: [link.title, link.short, link.detail, ...link.keywords].join(' ').toLowerCase(),
      link,
      waiting: 0,
    });
  }
  for (const entry of entries) {
    const work = waiting[entry.key];
    if (work && work.count > 0) {
      entry.waiting = work.count;
      entry.waitingText = work.text;
    }
  }
  return CLUB_AREAS.map((area) => {
    const inside = entries
      .filter((entry) => entry.area === area.name)
      .sort((a, b) => placeIn(a.key, area.name) - placeIn(b.key, area.name));
    return {
      ...area,
      entries: inside,
      summary: summaryOf(inside),
      waiting: inside.reduce((sum, entry) => sum + entry.waiting, 0),
    };
  }).filter((area) => area.entries.length > 0);
}

/** With this many things or fewer, the Club tab lists them and has no areas. */
export const FLAT_LIMIT = 5;

/** One row of the Club tab: an area to open, or a thing shown as itself. */
export type ClubRow = { area: ClubArea; entry?: undefined } | { entry: ClubEntry; area?: undefined };

/**
 * The rows of the Club tab. A member with only a few things gets them as they
 * are; otherwise each area is a row that opens, and an area holding one thing
 * shows that thing in its place.
 */
export function clubRows(areas: ClubArea[]): ClubRow[] {
  const all = areas.flatMap((area) => area.entries);
  if (all.length <= FLAT_LIMIT) return all.map((entry) => ({ entry }));
  return areas.map((area) => (area.entries.length === 1 ? { entry: area.entries[0] } : { area }));
}

/**
 * What an area shows under its row: everything while it is open, and while it
 * is closed only what has work waiting, so that is never a tap further away.
 */
export const shownIn = (area: ClubArea, open: boolean) =>
  open ? area.entries : area.entries.filter((entry) => entry.waiting > 0);

/** How much work is waiting across the Club tab, for its button in the tab bar. */
export const clubWaitingTotal = (areas: ClubArea[]) =>
  areas.reduce((sum, area) => sum + area.waiting, 0);

/** The words of a search, in lower case. */
const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** The letters and numbers of some text, word by word, in lower case. */
const tokensOf = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The things in the member's Club tab that a search finds: every word typed
 * starts a word in the entry's name, its line or what it holds (so "cal"
 * finds Calendars and not "medical"). Entries whose name has the first word
 * come first. It only ever looks through what the member already has.
 */
export function searchClub(areas: ClubArea[], query: string): ClubEntry[] {
  const words = tokensOf(query);
  if (words.length === 0) return [];
  const starts = (text: string, word: string) =>
    tokensOf(text).some((token) => token.startsWith(word));
  const found = areas
    .flatMap((area) => area.entries)
    .filter((entry) => words.every((word) => starts(entry.words, word)));
  const inName = (entry: ClubEntry) => starts(entry.title, words[0]);
  return [...found.filter(inName), ...found.filter((entry) => !inName(entry))];
}

/** What a member search looks at. */
export type SearchableMember = {
  id: string;
  full_name: string | null;
  preferred_name?: string | null;
  email?: string | null;
  playhq_email?: string | null;
};

/** A search needs this many letters before it looks for members. */
export const MEMBER_SEARCH_MIN = 2;

/**
 * The members a search finds, by name or email: every word typed is in one of
 * them. People whose name starts with what was typed come first.
 */
export function searchMembers<T extends SearchableMember>(members: T[], query: string): T[] {
  const words = wordsOf(query);
  if (query.trim().length < MEMBER_SEARCH_MIN) return [];
  const text = (m: T) =>
    [m.full_name, m.preferred_name, m.email, m.playhq_email].filter(Boolean).join(' ').toLowerCase();
  const found = members.filter((m) => words.every((word) => text(m).includes(word)));
  const starts = (m: T) =>
    [m.full_name, m.preferred_name].some((name) => name?.toLowerCase().startsWith(words[0]));
  return [...found.filter(starts), ...found.filter((m) => !starts(m))];
}
