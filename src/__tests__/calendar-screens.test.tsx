/**
 * The calendar (src/app/calendar.tsx) and one event (event/[id].tsx), with
 * the events they load (src/lib/use-events.ts). From "Calendar" in section 3
 * of docs/user-guide.md.
 *
 * The database decides which calendars a member gets (the club's, their
 * squads' and teams', and the committee's for the committee). Each calendar's
 * ICS file is fetched and cached, so the last copy still shows offline, and
 * PlayHQ fixtures for the member's teams join them. Members waiting for
 * approval see nothing.
 */
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import CalendarScreen from '@/app/calendar';
import EventScreen from '@/app/event/[id]';
import { formatDay } from '@/lib/format';

import { clearCalls, recordTable } from './helpers/forms';
import {
  openScreen,
  resetClub,
  settle,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  openURL: jest.fn(async () => true),
}));

const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage') as {
  clear(): Promise<void>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function ics(...events: { uid: string; summary: string; start: string; end: string; location?: string; description?: string }[]) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sample//EN',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `SUMMARY:${e.summary}`,
      `DTSTART:${e.start}`,
      `DTEND:${e.end}`,
      ...(e.location ? [`LOCATION:${e.location}`] : []),
      ...(e.description ? [`DESCRIPTION:${e.description}`] : []),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n');
}

const CLUB_ICS = ics(
  { uid: 'agm', summary: 'Club AGM', start: '20261020T100000Z', end: '20261020T110000Z', location: 'Clubrooms\\, 1 Sample St' },
  { uid: 'old', summary: 'Last month’s quiz night', start: '20260920T100000Z', end: '20260920T110000Z' },
);
const TEAM_ICS = ics({
  uid: 'training',
  summary: 'Open A training',
  start: '20261021T090000Z',
  end: '20261021T103000Z',
  description: 'Bring bibs. Drills at https://example.test/drills.',
});

type AudienceRow = { kind: string; role: string | null; post: string | null; team_id: string | null; team: { kind: string } | null };
type CalendarRow = {
  id: string;
  name: string;
  url: string;
  color: string | null;
  team: { name: string; kind: string } | null;
  calendar_audiences: AudienceRow[];
};

const CALENDARS: CalendarRow[] = [
  { id: 'cal-club', name: 'Club', url: 'webcal://example.test/club.ics', color: null, team: null, calendar_audiences: [{ kind: 'everyone', role: null, post: null, team_id: null, team: null }] },
  { id: 'cal-team', name: 'ignored', url: 'https://example.test/open-a.ics', color: 'violet', team: { name: 'Open A', kind: 'team' }, calendar_audiences: [{ kind: 'team', role: null, post: null, team_id: 'team-x', team: { kind: 'team' } }] },
];

const FIXTURES = [
  {
    id: 'f1',
    team_id: 'team-open-a',
    team_name: 'Open A',
    opponent: 'Sample Storm',
    round_name: 'Round 3',
    grade_name: 'Division 1',
    starts_at: '2026-10-24T02:00:00Z',
    time_tbc: false,
    venue: 'State Netball Centre',
    court: 'Court 4',
    is_home: false,
    team: { kind: 'team' },
  },
];

type Feeds = Record<string, string | number>;
let fetchMock: jest.Mock;

function serve(feeds: Feeds) {
  fetchMock = jest.fn(async (url: string) => {
    const body = feeds[url];
    if (typeof body === 'number' || body === undefined) {
      return { ok: false, status: typeof body === 'number' ? body : 404, text: async () => '' };
    }
    return { ok: true, status: 200, text: async () => body };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const FEEDS: Feeds = {
  'https://example.test/club.ics': CLUB_ICS,
  'https://example.test/open-a.ics': TEAM_ICS,
};

let fixtures: ReturnType<typeof recordTable>;
let push: jest.SpyInstance;

beforeEach(async () => {
  resetClub();
  clearCalls();
  await AsyncStorage.clear();
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
});
afterEach(() => push.mockRestore());

async function openCalendar(who: PersonaName = 'athlete', feeds: Feeds = FEEDS, calendars = CALENDARS) {
  serve(feeds);
  fixtures = recordTable(() => FIXTURES);
  await openScreen(who, { calendar: CalendarScreen }, '/calendar', { calendars }, {
    tableHandlers: { fixtures: fixtures.handler },
  });
  await settle();
}

const rowLabels = () =>
  screen
    .getAllByRole('button')
    .map((b) => b.props.accessibilityLabel as string | undefined)
    .filter((l): l is string => !!l && /, (Club|Open A)$/.test(l));

describe('the calendar list', () => {
  it('lists events from today on, from every calendar and the fixtures, in time order', async () => {
    await openCalendar();
    expect(screen.getByText('Club AGM')).toBeTruthy();
    expect(screen.getByText('Open A training')).toBeTruthy();
    expect(screen.getByText('Open A v Sample Storm')).toBeTruthy();
    // Past events aren't loaded until the member steps back.
    expect(screen.queryByText('Last month’s quiz night')).toBeNull();
    const titles = rowLabels().map((l) => l.split(',')[0]);
    expect(titles).toEqual(['Club AGM', 'Open A training', 'Open A v Sample Storm']);
  });

  it('fetches webcal links over https', async () => {
    await openCalendar();
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/club.ics');
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/open-a.ics');
  });

  it('asks for fixtures from today to three months ahead', async () => {
    await openCalendar();
    expect(fixtures.queries[0]).toEqual(
      expect.arrayContaining([
        { method: 'gte', args: ['starts_at', '2026-10-18T00:00:00.000Z'] },
        { method: 'lt', args: ['starts_at', '2027-01-18T00:00:00.000Z'] },
      ]),
    );
    expect(screen.getByText(`Showing events up to ${formatDay(new Date(2027, 0, 18))}.`)).toBeTruthy();
  });

  it('a fixture shows its venue and court, and an away game says so', async () => {
    await openCalendar();
    const label = rowLabels().find((l) => l.startsWith('Open A v Sample Storm'))!;
    expect(label).toMatch(/ · State Netball Centre, Court 4, Open A$/);
  });

  it('filters to the club calendar or one team’s', async () => {
    await openCalendar();
    expect(screen.getByText('All')).toBeTruthy();
    await fireEvent.press(screen.getByText('Club'));
    expect(screen.getByText('Club AGM')).toBeTruthy();
    expect(screen.queryByText('Open A training')).toBeNull();
    await fireEvent.press(screen.getAllByText('Open A')[0]);
    expect(screen.queryByText('Club AGM')).toBeNull();
    expect(screen.getByText('Open A training')).toBeTruthy();
  });

  it('shows a calendar shared with roles or posts under its own name, as its own filter (21 November 2026)', async () => {
    const physioIcs = ics({ uid: 'screening', summary: 'Physio screening day', start: '20261022T010000Z', end: '20261022T030000Z' });
    await openCalendar(
      'physio',
      { ...FEEDS, 'https://example.test/physio.ics': physioIcs },
      [
        ...CALENDARS,
        {
          id: 'cal-physio',
          name: 'Physio and safeguarding',
          url: 'https://example.test/physio.ics',
          color: null,
          team: null,
          calendar_audiences: [
            { kind: 'role', role: 'physio', post: null, team_id: null, team: null },
            { kind: 'post', role: null, post: 'child_safety_officer', team_id: null, team: null },
          ],
        },
      ],
    );
    expect(screen.getByText('Physio screening day')).toBeTruthy();
    await fireEvent.press(screen.getByText('Club'));
    expect(screen.queryByText('Physio screening day')).toBeNull();
    await fireEvent.press(screen.getAllByText('Physio and safeguarding')[0]);
    expect(screen.getByText('Physio screening day')).toBeTruthy();
    expect(screen.queryByText('Club AGM')).toBeNull();
  });

  it('opens an event when tapped', async () => {
    await openCalendar();
    await fireEvent.press(screen.getByText('Club AGM'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/event/[id]',
      params: { id: 'agm:2026-10-20T10:00:00.000Z' },
    });
  });

  it('names a calendar that wouldn’t load, and still shows the rest', async () => {
    await openCalendar('athlete', { 'https://example.test/club.ics': CLUB_ICS, 'https://example.test/open-a.ics': 500 });
    expect(screen.getByText("Couldn't load Open A. Pull down to try again.")).toBeTruthy();
    expect(screen.getByText('Club AGM')).toBeTruthy();
  });

  it('treats a page that isn’t a calendar as a failure', async () => {
    await openCalendar('athlete', { 'https://example.test/club.ics': '<html>Sign in</html>', 'https://example.test/open-a.ics': TEAM_ICS });
    expect(screen.getByText("Couldn't load Club. Pull down to try again.")).toBeTruthy();
  });

  it('keeps each calendar it loads, and shows the saved copy when offline', async () => {
    await openCalendar();
    expect(await AsyncStorage.getItem('ics-cache:webcal://example.test/club.ics')).toBe(CLUB_ICS);
    clearCalls();
    await openCalendar('athlete', {});
    expect(screen.getByText('Club AGM')).toBeTruthy();
    expect(screen.getByText('Open A training')).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it('says when there is nothing on', async () => {
    serve({});
    fixtures = recordTable(() => []);
    await openScreen('athlete', { calendar: CalendarScreen }, '/calendar', { calendars: [] }, {
      tableHandlers: { fixtures: fixtures.handler },
    });
    await settle();
    expect(screen.getByText('Nothing on the calendar yet.')).toBeTruthy();
  });

  it('a member waiting for approval gets no calendars at all', async () => {
    await openCalendar('pending');
    expect(screen.getByText('Nothing on the calendar yet.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixtures.queries).toHaveLength(0);
  });

  it('Load more reaches three months further, up to 12 months ahead', async () => {
    await openCalendar();
    for (const months of [6, 9, 12]) {
      await fireEvent.press(screen.getByText('Load more'));
      await settle();
      const until = new Date(2026, 9 + months, 18);
      const suffix = months === 12 ? ', 12 months ahead.' : '.';
      expect(screen.getByText(`Showing events up to ${formatDay(until)}${suffix}`)).toBeTruthy();
    }
    expect(screen.queryByText('Load more')).toBeNull();
  });
});

describe('the month view', () => {
  it('shows this month’s events, and a tapped day’s only', async () => {
    await openCalendar();
    await fireEvent.press(screen.getByText('Month'));
    await settle();
    expect(screen.getByText('Club AGM')).toBeTruthy();
    expect(screen.getByText('Open A training')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(new Date(2026, 9, 20).toDateString()));
    expect(screen.getByText('Club AGM')).toBeTruthy();
    expect(screen.queryByText('Open A training')).toBeNull();
    await fireEvent.press(screen.getByLabelText(new Date(2026, 9, 22).toDateString()));
    expect(screen.getByText('Nothing on this day.')).toBeTruthy();
  });

  it('stepping back a month loads the past 12 months', async () => {
    await openCalendar();
    await fireEvent.press(screen.getByText('Month'));
    await settle();
    await fireEvent.press(screen.getByLabelText('Previous month'));
    await settle();
    expect(screen.getByText('Last month’s quiz night')).toBeTruthy();
    expect(fixtures.queries[fixtures.queries.length - 1]).toContainEqual({
      method: 'gte',
      args: ['starts_at', '2025-10-01T00:00:00.000Z'],
    });
  });
});

describe('one event', () => {
  async function openEvent(id: string, who: PersonaName = 'athlete', rows = FIXTURES) {
    serve(FEEDS);
    fixtures = recordTable(() => rows);
    await openScreen(who, { 'event/[id]': EventScreen }, `/event/${encodeURIComponent(id)}`, { calendars: CALENDARS }, {
      tableHandlers: { fixtures: fixtures.handler },
    });
    await settle();
  }

  it('shows a fixture opened from a link, loading the calendars itself', async () => {
    // A fixture no list has loaded yet.
    const home = { ...FIXTURES[0], id: 'f2', opponent: 'Sample Breeze', is_home: true, round_name: null };
    await openEvent('fixture:f2', 'athlete', [home] as unknown as typeof FIXTURES);
    expect(fetchMock).toHaveBeenCalled();
    expect(screen.getByText('Open A v Sample Breeze')).toBeTruthy();
    expect(screen.getByText('Division 1 · Home')).toBeTruthy();
  });

  it('shows a fixture’s team, venue, round and grade', async () => {
    await openEvent('fixture:f1');
    expect(screen.getByText('Open A v Sample Storm')).toBeTruthy();
    expect(screen.getByText('Open A')).toBeTruthy();
    expect(screen.getByText('State Netball Centre, Court 4')).toBeTruthy();
    expect(screen.getByText('Round 3 · Division 1 · Away')).toBeTruthy();
  });

  it('opens the address in maps and copies it', async () => {
    await openEvent('fixture:f1');
    await fireEvent.press(screen.getByText('State Netball Centre, Court 4'));
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://maps.apple.com/?q=State%20Netball%20Centre%2C%20Court%204',
    );
    await fireEvent.press(screen.getByLabelText('Copy address'));
    await settle();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('State Netball Centre, Court 4');
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('makes web addresses in the notes tappable', async () => {
    await openEvent('training:2026-10-21T09:00:00.000Z');
    expect(screen.getByText('Notes')).toBeTruthy();
    await fireEvent.press(screen.getByText('https://example.test/drills'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.test/drills');
  });

  it('says when an event is no longer on the calendar', async () => {
    await openEvent('gone:2026-10-01T00:00:00.000Z');
    expect(screen.getByText('This event is no longer on the calendar.')).toBeTruthy();
  });

  it('a member waiting for approval can’t open an event by link', async () => {
    await openEvent('fixture:f9', 'pending');
    expect(screen.getByText('This event is no longer on the calendar.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
