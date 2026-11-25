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

import CalendarScreen from '@/app/(tabs)/calendar';
import EventScreen from '@/app/event/[id]';
import { formatDay } from '@/lib/format';

import { clearCalls, recordTable } from './helpers/forms';
import {
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  type BackendOptions,
  type Persona,
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

// ---------------------------------------------------------------------------
// What a member can do about a session, from its page ("A session's page" in
// section 3 of docs/user-guide.md). The rules are in src/lib/session.ts and
// tested there for every kind of member; here each kind of member opens a
// real session of the team and sees only their own shortcuts.

describe('what a member can do about a session', () => {
  /** Open A's match later today (TODAY is 10 am on 18 October in Perth). */
  const TODAY_MATCH = { ...FIXTURES[0], id: 'today', team_id: TEAM.id, starts_at: '2026-10-18T09:00:00Z' };
  const NEXT_WEEK = { ...TODAY_MATCH, id: 'next-week', starts_at: '2026-10-24T02:00:00Z' };
  const TITLES = [
    'Can’t make it',
    'Sample Child can’t make it',
    'Take attendance',
    'Session plan',
    'Add a session plan',
    'Check-ins',
  ];
  const shown = () => TITLES.filter((t) => screen.queryByText(t) !== null);

  /** A parent who has followed their child into Open A. */
  const parentInTeam: Persona = {
    ...personas.guardian,
    memberships: [{ team_role: 'guardian', coach_title: null, selection: null, team: TEAM }],
  };
  const CHECK_INS = [
    { team_id: TEAM.id, team_name: TEAM.name, team_kind: 'team', squad_id: null, athlete_count: 10, checked_in_count: 7, flagged_count: 1 },
  ];

  async function openSession(who: PersonaName | Persona, match = TODAY_MATCH, options: BackendOptions = {}) {
    serve(FEEDS);
    await openScreen(who, { 'event/[id]': EventScreen }, `/event/${encodeURIComponent(`fixture:${match.id}`)}`, { calendars: CALENDARS }, {
      ...options,
      tableHandlers: { fixtures: () => [match], ...options.tableHandlers },
    });
    await settle();
    expect(screen.getByText('Open A v Sample Storm')).toBeTruthy();
  }

  it.each<[string, PersonaName | Persona, string[]]>([
    ['an athlete in the team', 'athlete', ['Can’t make it']],
    ['a parent whose child is in the team', parentInTeam, ['Sample Child can’t make it']],
    ['a parent whose child is not in the team', 'guardian', []],
    ['the team’s coach', 'coach', ['Take attendance', 'Add a session plan', 'Check-ins']],
    ['the team’s manager', 'manager', ['Take attendance']],
    ['the team’s physio', 'physio', []],
    ['a committee member', 'committee', []],
    ['an admin', 'admin', ['Take attendance', 'Add a session plan']],
    ['a guest', 'guest', []],
    ['a coach who is stood down', 'stoodDownCoach', []],
    ['a coach whose check has expired', 'coachExpiredCheck', []],
  ])('%s has the shortcuts for them', async (_label, who, expected) => {
    await openSession(who, TODAY_MATCH, { rpcs: { check_in_summary: CHECK_INS } });
    expect(shown()).toEqual(expected);
  });

  it('an athlete says they can’t make it, with the session’s day filled in', async () => {
    await openSession('athlete', NEXT_WEEK);
    await fireEvent.press(screen.getByText('Can’t make it'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/attendance/absence',
      params: { id: 'athlete', day: '2026-10-24' },
    });
  });

  it('a parent says their child can’t make it', async () => {
    await openSession(parentInTeam, NEXT_WEEK);
    await fireEvent.press(screen.getByText('Sample Child can’t make it'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/attendance/absence',
      params: { id: 'child-1', name: 'Sample Child', day: '2026-10-24' },
    });
  });

  it('a coach takes attendance for this team and this session', async () => {
    await openSession('coach');
    await fireEvent.press(screen.getByText('Take attendance'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/attendance/new',
      params: { team: TEAM.id, event: 'fixture:today' },
    });
  });

  it('a coach isn’t offered attendance for a session that hasn’t come yet', async () => {
    await openSession('coach', NEXT_WEEK);
    expect(shown()).toEqual(['Add a session plan']);
  });

  it('a coach sees how many have checked in, and opens the team’s check-ins', async () => {
    await openSession('coach', TODAY_MATCH, { rpcs: { check_in_summary: CHECK_INS } });
    expect(screen.getByText('7 of 10 checked in today · 1 flagged')).toBeTruthy();
    await fireEvent.press(screen.getByText('Check-ins'));
    expect(push).toHaveBeenCalledWith({ pathname: '/check-ins', params: { team: TEAM.id } });
  });

  it('an athlete opens the plan a coach shared for this session', async () => {
    await openSession('athlete', TODAY_MATCH, {
      rpcs: {
        shared_session_plans: [
          { id: 'plan-1', team_id: TEAM.id, title: 'Centre pass set plays', session_on: '2026-10-18' },
          { id: 'plan-2', team_id: TEAM.id, title: 'Another day', session_on: '2026-10-20' },
        ],
      },
    });
    expect(screen.getByText('Centre pass set plays')).toBeTruthy();
    expect(screen.queryByText('Another day')).toBeNull();
    await fireEvent.press(screen.getByText('Session plan'));
    expect(push).toHaveBeenCalledWith({ pathname: '/session-plans/[id]', params: { id: 'plan-1' } });
  });

  it('a coach with a plan for the session opens it, and isn’t asked to add another', async () => {
    await openSession('coach', TODAY_MATCH, {
      tableHandlers: {
        session_plans: () => [{ id: 'plan-9', team_id: TEAM.id, title: 'My plan', session_on: '2026-10-18' }],
      },
    });
    expect(shown()).toEqual(['Take attendance', 'Session plan']);
  });

  it('a coach adds a plan with the team and session filled in', async () => {
    await openSession('coach');
    await fireEvent.press(screen.getByText('Add a session plan'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/session-plans/edit',
      params: { team: TEAM.id, event: 'fixture:today' },
    });
  });

  it.each([
    ['attendance', 'coach', ['Add a session plan', 'Check-ins']],
    ['attendance', 'athlete', []],
    ['sessionPlans', 'coach', ['Take attendance', 'Check-ins']],
    ['checkIns', 'coach', ['Take attendance', 'Add a session plan']],
  ] as const)('with %s switched off, %s has: %j', async (feature, who, expected) => {
    setClubFeatures({ [feature]: false });
    await openSession(who, TODAY_MATCH, { rpcs: { check_in_summary: CHECK_INS } });
    expect(shown()).toEqual(expected);
  });

  it('a session that has finished no longer offers Can’t make it', async () => {
    // Its own id: events already loaded are kept by id.
    await openSession('athlete', { ...TODAY_MATCH, id: 'this-morning', starts_at: '2026-10-18T00:00:00Z' });
    expect(shown()).toEqual([]);
  });

  // Sessions from the club's own calendars: who each calendar is shown to
  // decides whether it is a session athletes attend (src/lib/session.ts).
  describe('on a calendar an admin has added', () => {
    const audience = (kind: string, value: Partial<AudienceRow> = {}): AudienceRow => ({
      kind,
      role: null,
      post: null,
      team_id: null,
      team: null,
      ...value,
    });

    /** Opens a session at 5 pm today on a calendar shown to that audience. Each has its own id. */
    async function openOn(who: PersonaName | Persona, uid: string, calendar: Partial<CalendarRow>) {
      const url = `https://example.test/${uid}.ics`;
      serve({ [url]: ics({ uid, summary: 'Evening session', start: '20261018T090000Z', end: '20261018T103000Z' }) });
      const row: CalendarRow = { id: `cal-${uid}`, name: 'Sessions', url, color: null, team: null, calendar_audiences: [], ...calendar };
      await openScreen(who, { 'event/[id]': EventScreen }, `/event/${encodeURIComponent(`${uid}:2026-10-18T09:00:00.000Z`)}`, { calendars: [row] }, {
        tableHandlers: { fixtures: () => [] },
      });
      await settle();
      expect(screen.getByText('Evening session')).toBeTruthy();
    }

    it('shown to a team: its athlete can say they can’t make it, and its coach takes its register', async () => {
      const toTeam = { calendar_audiences: [audience('team', { team_id: TEAM.id, team: { kind: 'team' } })] };
      await openOn('athlete', 'to-team-athlete', toTeam);
      expect(shown()).toEqual(['Can’t make it']);
    });

    it('shown to a team: its coach takes that team’s register', async () => {
      await openOn('coach', 'to-team-coach', {
        calendar_audiences: [audience('team', { team_id: TEAM.id, team: { kind: 'team' } })],
      });
      await fireEvent.press(screen.getByText('Take attendance'));
      expect(push).toHaveBeenCalledWith({
        pathname: '/attendance/new',
        params: { team: TEAM.id, event: 'to-team-coach:2026-10-18T09:00:00.000Z' },
      });
    });

    it('shown to another team: nobody in Open A is offered anything', async () => {
      const elsewhere = { calendar_audiences: [audience('team', { team_id: 'team-x', team: { kind: 'team' } })] };
      await openOn('athlete', 'elsewhere-athlete', elsewhere);
      expect(shown()).toEqual([]);
    });

    it('a team’s calendar from before calendars had audiences works the same way', async () => {
      await openOn('athlete', 'old-team', {
        team: { id: TEAM.id, name: TEAM.name, kind: 'team' } as CalendarRow['team'],
      });
      expect(shown()).toEqual(['Can’t make it']);
    });

    it('shown to everyone: any athlete can say they can’t make it', async () => {
      await openOn('athlete', 'everyone-athlete', { calendar_audiences: [audience('everyone')] });
      expect(shown()).toEqual(['Can’t make it']);
    });

    it('shown to everyone: a committee member takes the whole club’s register', async () => {
      await openOn('committee', 'everyone-committee', { calendar_audiences: [audience('everyone')] });
      await fireEvent.press(screen.getByText('Take attendance'));
      expect(push).toHaveBeenCalledWith({
        pathname: '/attendance/new',
        params: { team: 'club', event: 'everyone-committee:2026-10-18T09:00:00.000Z' },
      });
    });

    it('shown to athletes by role: any athlete can say they can’t make it', async () => {
      await openOn('athlete', 'athletes-role', { calendar_audiences: [audience('role', { role: 'athlete' })] });
      expect(shown()).toEqual(['Can’t make it']);
    });

    // A committee meeting isn't a session athletes attend.
    it.each<PersonaName>(['committee', 'admin', 'coach', 'athlete', 'guardian'])(
      'shown only to the committee: %s is offered nothing',
      async (who) => {
        await openOn(who, `committee-only-${who}`, {
          calendar_audiences: [audience('role', { role: 'committee' })],
        });
        expect(shown()).toEqual([]);
        expect(screen.queryByTestId('session-actions')).toBeNull();
      },
    );

    it('shown only to a safeguarding post: nothing is offered', async () => {
      await openOn('admin', 'post-only', {
        calendar_audiences: [audience('post', { post: 'child_safety_officer' })],
      });
      expect(shown()).toEqual([]);
    });
  });
});
