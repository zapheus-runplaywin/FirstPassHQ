/**
 * Administration > Calendars (src/app/admin/calendars.tsx) and Fixtures
 * (admin/fixtures.tsx), as an admin uses them: exactly what each screen
 * writes, the link checks, and what PlayHQ's answers show (section 10 of the
 * user guide, "Calendars" and "Fixtures"). Only admins reach these screens;
 * the route tests cover that.
 */
import { fireEvent, screen, within } from 'expo-router/testing-library';

import CalendarsScreen from '@/app/admin/calendars';
import FixturesScreen from '@/app/admin/fixtures';
import type { PlayhqCompetition } from '@/lib/playhq';
import { supabase } from '@/lib/supabase';
import type { Fixture, PlayhqSeason, Team } from '@/lib/types';

import { openScreen, resetClub, settle, TEAM, TEAM_B } from './helpers/harness';
import {
  failTableWrite,
  input,
  isDisabled,
  isSelected,
  recordTables,
  type,
  writes,
  type TableQuery,
} from './helpers/settings-forms';

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

// Each test settles a whole screen several times; leave room on a busy machine.
jest.setTimeout(30000);
jest.mock('@/lib/log', () => {
  const lines = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { ...jest.requireActual('@/lib/log'), logger: () => lines, __lines: lines };
});

const rpc = () => supabase.rpc as jest.Mock;
const callsTo = (name: string) =>
  (rpc().mock.calls as [string, Record<string, unknown>][])
    .filter(([n]) => n === name)
    .map(([, args]) => args);
const logLines = () =>
  (jest.requireMock('@/lib/log') as { __lines: Record<string, jest.Mock> }).__lines;

beforeEach(() => {
  resetClub();
  rpc().mockClear();
  Object.values(logLines()).forEach((m) => m.mockClear());
});

const SQUAD: Team = { ...TEAM, id: 'squad-open', name: 'Open Squad', kind: 'squad', sort_order: 0 };
const TEAMS: Team[] = [SQUAD, TEAM, TEAM_B];

// ---------------------------------------------------------------------------
// Calendars

type CalendarRow = {
  id: string;
  name: string;
  url: string;
  team_id: string | null;
  committee_only: boolean;
  color: string | null;
};

const CLUB_CAL: CalendarRow = {
  id: 'cal-club',
  name: 'Club calendar',
  url: 'https://outlook.example/club.ics',
  team_id: null,
  committee_only: false,
  color: null,
};
const COMMITTEE_CAL: CalendarRow = {
  ...CLUB_CAL,
  id: 'cal-committee',
  name: 'Committee dates',
  url: 'webcal://outlook.example/committee.ics',
  committee_only: true,
  color: 'violet',
};
const TEAM_CAL: CalendarRow = { ...CLUB_CAL, id: 'cal-team', name: 'Open A games', team_id: TEAM.id };
const OLD_TEAM_CAL: CalendarRow = { ...CLUB_CAL, id: 'cal-old', name: 'Old team', team_id: 'gone' };

let log: TableQuery[];

async function openCalendars(calendars: CalendarRow[] = []) {
  const recorder = recordTables(['calendars']);
  log = recorder.log;
  await openScreen('admin', { 'admin/calendars': CalendarsScreen }, '/admin/calendars', {
    calendars,
    teams: TEAMS,
  }, { tableHandlers: recorder.handlers });
}

const calendarReads = () =>
  log.filter((q) => q.table === 'calendars' && q.calls.some((c) => c.method === 'select')).length;

async function add() {
  fireEvent.press(screen.getByText('Add calendar'));
  await settle();
}

describe('Calendars', () => {
  it('says there are none yet', async () => {
    await openCalendars();
    expect(screen.getByText('No calendars yet. Add the club calendar below.')).toBeTruthy();
  });

  it('lists each calendar with who it’s shown to and its link', async () => {
    await openCalendars([CLUB_CAL, COMMITTEE_CAL, TEAM_CAL, OLD_TEAM_CAL]);
    expect(screen.getByText('Shown to Everyone in the club')).toBeTruthy();
    expect(screen.getByText('Shown to the committee')).toBeTruthy();
    expect(screen.getByText('Shown to Open A')).toBeTruthy();
    // A team that isn't this season's any more.
    expect(screen.getByText('Shown to Team')).toBeTruthy();
    expect(screen.getByText('webcal://outlook.example/committee.ics')).toBeTruthy();
  });

  it('offers Everyone, the Committee and each current squad and team', async () => {
    await openCalendars();
    for (const label of ['Everyone', 'Committee', 'Open Squad', 'Open A', '17 & Under A']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(isSelected('Everyone')).toBe(true);
  });

  it.each(['outlook.example/club.ics', 'http://outlook.example/club.ics', '', 'ftp://x'])(
    'refuses the link “%s”, which isn’t an https:// or webcal:// link',
    async (link) => {
      await openCalendars();
      type('ICS link', link);
      await add();
      expect(screen.getByText('Paste the ICS link from Outlook. It starts with https://')).toBeTruthy();
      expect(writes(log, 'calendars')).toEqual([]);
    },
  );

  it('adds the club calendar under its default name, trimming the link', async () => {
    await openCalendars();
    type('ICS link', '  https://outlook.example/club.ics  ');
    await add();
    expect(writes(log, 'calendars')).toEqual([
      {
        method: 'insert',
        values: {
          name: 'Club calendar',
          url: 'https://outlook.example/club.ics',
          team_id: null,
          committee_only: false,
          color: null,
        },
        filters: [],
      },
    ]);
  });

  it('adds a committee calendar from a webcal:// link', async () => {
    await openCalendars();
    type('ICS link', 'WEBCAL://outlook.example/committee.ics');
    fireEvent.press(screen.getByText('Committee'));
    await add();
    expect(writes(log, 'calendars')[0].values).toEqual({
      name: 'Committee calendar',
      url: 'WEBCAL://outlook.example/committee.ics',
      team_id: null,
      committee_only: true,
      color: null,
    });
  });

  it('adds a team calendar with its own name and colour, then clears the form and reloads', async () => {
    await openCalendars();
    const readsBefore = calendarReads();
    type('ICS link', 'https://outlook.example/open-a.ics');
    type('Name (optional)', '  Open A games  ');
    fireEvent.press(screen.getByText('Open A'));
    fireEvent.press(screen.getByLabelText('Violet'));
    await add();
    expect(writes(log, 'calendars')[0].values).toEqual({
      name: 'Open A games',
      url: 'https://outlook.example/open-a.ics',
      team_id: TEAM.id,
      committee_only: false,
      color: 'violet',
    });
    expect(input('ICS link').props.value).toBe('');
    expect(input('Name (optional)').props.value).toBe('');
    expect(calendarReads()).toBe(readsBefore + 1);
  });

  it('names a team calendar after the team when left unnamed', async () => {
    await openCalendars();
    type('ICS link', 'https://outlook.example/u17.ics');
    fireEvent.press(screen.getByText('17 & Under A'));
    await add();
    expect(writes(log, 'calendars')[0].values).toMatchObject({ name: '17 & Under A calendar', team_id: TEAM_B.id });
  });

  it('starts each audience on its own colour until one is picked', async () => {
    await openCalendars();
    const selected = () =>
      ['Yellow', 'Pink', 'Blue', 'Green'].filter(
        (c) => screen.getByLabelText(c).props.accessibilityState?.selected,
      );
    expect(selected()).toEqual(['Yellow']);
    fireEvent.press(screen.getByText('Committee'));
    expect(selected()).toEqual(['Pink']);
    fireEvent.press(screen.getByText('Open Squad'));
    expect(selected()).toEqual(['Blue']);
    fireEvent.press(screen.getByText('Open A'));
    expect(selected()).toEqual(['Green']);
  });

  it('shows why the database refused a new calendar and keeps what was typed', async () => {
    await openCalendars();
    failTableWrite('calendars', 'insert', 'new row violates row-level security policy');
    type('ICS link', 'https://outlook.example/club.ics');
    await add();
    expect(screen.getByText('new row violates row-level security policy')).toBeTruthy();
    expect(input('ICS link').props.value).toBe('https://outlook.example/club.ics');
  });

  it('changes a calendar’s name and link', async () => {
    await openCalendars([CLUB_CAL]);
    fireEvent.press(screen.getByText('Edit name or link'));
    type('Name', 'Thunder club');
    type('ICS link', ' https://outlook.example/new.ics ', 0);
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(writes(log, 'calendars')).toEqual([
      {
        method: 'update',
        values: { name: 'Thunder club', url: 'https://outlook.example/new.ics' },
        filters: [['id', 'cal-club']],
      },
    ]);
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('keeps the old name when the new one is left empty', async () => {
    await openCalendars([CLUB_CAL]);
    fireEvent.press(screen.getByText('Edit name or link'));
    type('Name', '   ');
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(writes(log, 'calendars')[0].values).toEqual({ name: 'Club calendar', url: CLUB_CAL.url });
  });

  it('refuses a changed link that isn’t an ICS link', async () => {
    await openCalendars([CLUB_CAL]);
    fireEvent.press(screen.getByText('Edit name or link'));
    type('ICS link', 'outlook.example', 0);
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getAllByText('Paste the ICS link from Outlook. It starts with https://')).toHaveLength(1);
    expect(writes(log, 'calendars')).toEqual([]);
  });

  it('cancelling an edit puts the saved name and link back', async () => {
    await openCalendars([CLUB_CAL]);
    fireEvent.press(screen.getByText('Edit name or link'));
    type('Name', 'Something else');
    fireEvent.press(screen.getByText('Cancel'));
    fireEvent.press(screen.getByText('Edit name or link'));
    expect(input('Name').props.value).toBe('Club calendar');
    expect(writes(log, 'calendars')).toEqual([]);
  });

  it('shows a refused change on the calendar and stays editing', async () => {
    await openCalendars([CLUB_CAL]);
    failTableWrite('calendars', 'update', 'Only admins can change calendars');
    fireEvent.press(screen.getByText('Edit name or link'));
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Only admins can change calendars')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('changes a calendar’s colour straight away', async () => {
    await openCalendars([CLUB_CAL]);
    // The card's swatches come before the new calendar's.
    fireEvent.press(screen.getAllByLabelText('Pink')[0]);
    await settle();
    expect(writes(log, 'calendars')).toEqual([
      { method: 'update', values: { color: 'pink' }, filters: [['id', 'cal-club']] },
    ]);
  });

  it('asks again before deleting, and Keep it cancels', async () => {
    await openCalendars([CLUB_CAL]);
    fireEvent.press(screen.getByText('Delete'));
    expect(screen.getByText('Tap again to delete')).toBeTruthy();
    expect(writes(log, 'calendars')).toEqual([]);
    fireEvent.press(screen.getByText('Keep it'));
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(writes(log, 'calendars')).toEqual([]);
  });

  it('deletes only that calendar on the second tap', async () => {
    await openCalendars([CLUB_CAL, TEAM_CAL]);
    fireEvent.press(screen.getAllByText('Delete')[1]);
    fireEvent.press(screen.getByText('Tap again to delete'));
    await settle();
    expect(writes(log, 'calendars')).toEqual([
      { method: 'delete', values: undefined, filters: [['id', 'cal-team']] },
    ]);
  });

  it('shows a refused delete', async () => {
    await openCalendars([CLUB_CAL]);
    failTableWrite('calendars', 'delete', 'Not allowed');
    fireEvent.press(screen.getByText('Delete'));
    fireEvent.press(screen.getByText('Tap again to delete'));
    await settle();
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Fixtures

const LINK = 'https://www.playhq.com/netball-australia/org/sample-assoc/winter-2026/ec69e46d/fixture';
const SAVED_URL = 'https://www.playhq.com/netball-australia/org/sample-assoc/winter-2026/ec69e46d';

function game(id: string, date: string, home: string | null, away: string | null, status: string | null = null) {
  const team = (t: string | null) => (t ? { id: t, name: t === 'ph-1' ? 'Sample Thunder' : t === 'ph-2' ? 'Rockets' : 'Sample Lightning' } : null);
  return {
    id,
    date,
    time: '10:00',
    timezone: 'Australia/Perth',
    round: 'Round 1',
    is_final: false,
    grade: 'Open',
    venue: 'State Netball Centre',
    court: 'Court 3',
    status,
    home: team(home),
    away: team(away),
  };
}

const COMPETITION: PlayhqCompetition = {
  id: 'comp-1',
  name: 'Winter League 2026',
  teams: [
    { id: 'ph-1', name: 'Sample Thunder', grade: 'Open' },
    { id: 'ph-2', name: 'Rockets', grade: 'Open' },
    { id: 'ph-3', name: 'Sample Lightning', grade: null },
  ],
  games: [
    game('g1', '2026-10-25', 'ph-1', 'ph-2'),
    game('g2', '2026-09-01', 'ph-2', 'ph-1'),
    game('g3', '2026-10-30', 'ph-3', null, 'BYE'),
    game('g4', '2026-11-08', 'ph-3', 'ph-2'),
  ],
};

const invoke = () => (supabase as unknown as { functions: { invoke: jest.Mock } }).functions.invoke;

function answerWith(competition: PlayhqCompetition | null, error: unknown = null) {
  invoke().mockResolvedValue({ data: competition, error });
}

const SAVED: PlayhqSeason = {
  playhq_season_id: 'comp-1',
  name: 'Winter League 2026',
  url: SAVED_URL,
  season: 2026,
  imported_at: '2026-10-10T02:00:00Z',
  playhq_teams: [
    { playhq_team_id: 'ph-1', playhq_name: 'Sample Thunder', team_id: TEAM.id },
    { playhq_team_id: 'ph-3', playhq_name: 'Sample Lightning', team_id: null },
  ],
};

const UPCOMING: Fixture[] = [
  {
    id: 'f1',
    team_id: TEAM.id,
    team_name: 'Open A',
    opponent: 'Rockets',
    round_name: 'Round 2',
    grade_name: 'Open',
    starts_at: '2026-10-25T02:00:00Z',
    time_tbc: false,
    venue: 'State Netball Centre',
    court: 'Court 3',
    is_home: true,
    status: null,
  },
  {
    id: 'f2',
    team_id: TEAM.id,
    team_name: 'Open A',
    opponent: null,
    round_name: 'Round 3',
    grade_name: 'Open',
    starts_at: '2026-11-01T02:00:00Z',
    time_tbc: true,
    venue: null,
    court: null,
    is_home: null,
    status: 'BYE',
  },
];

async function openFixtures(
  { saved = [] as PlayhqSeason[], teams = TEAMS, fixtures = [] as Fixture[] } = {},
  options: { rpcs?: Record<string, unknown>; rpcErrors?: Record<string, string> } = {},
) {
  await openScreen('admin', { 'admin/fixtures': FixturesScreen }, '/admin/fixtures', {
    playhq_seasons: saved,
    fixtures,
    teams,
  }, { rpcs: { save_playhq_fixtures: 2, ...options.rpcs }, rpcErrors: options.rpcErrors });
}

async function lookUp(link = LINK) {
  type('Add a PlayHQ competition', link);
  fireEvent.press(screen.getByText('Look up'));
  await settle();
}

/** Links a PlayHQ team to one of ours. */
function link(playhqName: string, ours: string) {
  fireEvent.press(screen.getByText(playhqName));
  let card = screen.getByText(playhqName).parent;
  while (card && within(card).queryAllByText(ours).length === 0) card = card.parent;
  fireEvent.press(within(card!).getAllByText(ours).at(-1)!);
}

async function importGames(label: RegExp = /^Import games for/) {
  fireEvent.press(screen.getByText(label));
  await settle();
}

describe('Fixtures', () => {
  it('can’t look up an empty link', async () => {
    await openFixtures();
    expect(isDisabled('Look up')).toBe(true);
  });

  it('refuses a link that isn’t a PlayHQ competition, logging only its length', async () => {
    await openFixtures();
    await lookUp('https://example.com/my-team?secret=1');
    expect(screen.getByText(/^Paste the link to the competition on playhq\.com/)).toBeTruthy();
    expect(invoke()).not.toHaveBeenCalled();
    expect(logLines().warn).toHaveBeenCalledWith('Not a PlayHQ competition link', { length: 36 });
  });

  it('asks the club’s PlayHQ service for the competition in the link', async () => {
    await openFixtures();
    answerWith(COMPETITION);
    await lookUp();
    expect(invoke()).toHaveBeenCalledWith('playhq', {
      body: { tenant: 'netball-australia', seasonCode: 'ec69e46d' },
    });
    expect(screen.getByText('Winter League 2026')).toBeTruthy();
    expect(screen.getByText('PlayHQ answered in 0 ms with 3 teams.')).toBeTruthy();
    expect(screen.getByText('1 game in the last 12 months, 2 scheduled in the next 12 months.')).toBeTruthy();
  });

  it('lists the teams with the club’s short name, and finds others by name', async () => {
    await openFixtures();
    answerWith(COMPETITION);
    await lookUp();
    expect(screen.getByText('Sample Thunder')).toBeTruthy();
    expect(screen.getByText('Sample Lightning')).toBeTruthy();
    expect(screen.queryByText('Rockets')).toBeNull();
    type('Find a team', 'rock');
    expect(screen.getByText('Rockets')).toBeTruthy();
    expect(screen.queryByText('Sample Thunder')).toBeNull();
    type('Find a team', 'zzz');
    expect(screen.getByText('No teams match.')).toBeTruthy();
  });

  it('says when no team has the club’s short name', async () => {
    await openFixtures();
    answerWith({ ...COMPETITION, teams: [{ id: 'ph-2', name: 'Rockets', grade: null }] });
    await lookUp();
    expect(screen.getByText('No team names have “Sample” in them. Find our teams by name.')).toBeTruthy();
  });

  it('warns in red when PlayHQ has no games within 12 months', async () => {
    await openFixtures();
    answerWith({ ...COMPETITION, games: [game('old', '2024-01-01', 'ph-1', 'ph-2')] });
    await lookUp();
    expect(
      screen.getByText('PlayHQ has no games within 12 months of today. Check the link is for the right season.'),
    ).toBeTruthy();
  });

  it.each([
    [{ name: 'FunctionsFetchError', message: 'x' }, 'Couldn’t reach the club’s server. Check your connection and try again.'],
    [{ name: 'FunctionsHttpError', message: 'x' }, 'Couldn’t reach PlayHQ'],
  ])('says which part failed when the look-up fails (%p)', async (error, message) => {
    await openFixtures();
    answerWith(null, error);
    await lookUp();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText('Winter League 2026')).toBeNull();
  });

  it('can’t import until one of our teams is linked', async () => {
    await openFixtures();
    answerWith(COMPETITION);
    await lookUp();
    expect(screen.getByText('Import games for 0 teams')).toBeTruthy();
    expect(isDisabled('Import games for 0 teams')).toBe(true);
  });

  it('offers only this season’s squads and teams, and counts our teams’ games once linked', async () => {
    await openFixtures();
    answerWith(COMPETITION);
    await lookUp();
    fireEvent.press(screen.getByText('Sample Thunder'));
    for (const name of ['Not one of ours', 'Open Squad', 'Open A', '17 & Under A']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    fireEvent.press(screen.getAllByText('Open A').at(-1)!);
    expect(screen.getByText('Import games for 1 team')).toBeTruthy();
    expect(screen.getByText('Our teams: 1 game in the last 12 months, 1 in the next 12 months.')).toBeTruthy();
  });

  it('saves the competition and its linked team, then each linked team’s games', async () => {
    await openFixtures();
    answerWith(COMPETITION);
    await lookUp();
    link('Sample Thunder', 'Open A');
    await importGames();
    expect(callsTo('admin_save_playhq_season')).toEqual([
      {
        p_season_id: 'comp-1',
        p_name: 'Winter League 2026',
        p_url: SAVED_URL,
        p_season: 2026,
        p_teams: [{ playhq_team_id: 'ph-1', playhq_name: 'Sample Thunder', team_id: TEAM.id }],
      },
    ]);
    expect(callsTo('save_playhq_fixtures')).toEqual([
      {
        p_playhq_team_id: 'ph-1',
        p_games: [
          expect.objectContaining({ id: 'g1', date: '2026-10-25', opponent: 'Rockets', is_home: true, venue: 'State Netball Centre', court: 'Court 3' }),
          expect.objectContaining({ id: 'g2', date: '2026-09-01', opponent: 'Rockets', is_home: false }),
        ],
      },
    ]);
    expect(screen.getByText('Saved 2 games from Winter League 2026.')).toBeTruthy();
    // Back to adding a competition.
    expect(input('Add a PlayHQ competition').props.value).toBe('');
  });

  it('saves a team unlinked again as not ours, and imports no games for it', async () => {
    await openFixtures();
    answerWith(COMPETITION);
    await lookUp();
    link('Sample Thunder', 'Open A');
    link('Sample Lightning', '17 & Under A');
    link('Sample Lightning', 'Not one of ours');
    await importGames(/^Import games for 1 team$/);
    expect(callsTo('admin_save_playhq_season')[0].p_teams).toEqual([
      { playhq_team_id: 'ph-1', playhq_name: 'Sample Thunder', team_id: TEAM.id },
      { playhq_team_id: 'ph-3', playhq_name: 'Sample Lightning', team_id: '' },
    ]);
    expect(callsTo('save_playhq_fixtures').map((c) => c.p_playhq_team_id)).toEqual(['ph-1']);
  });

  it('marks a bye as a bye with no opponent', async () => {
    await openFixtures();
    answerWith(COMPETITION);
    await lookUp();
    link('Sample Lightning', 'Open A');
    await importGames();
    expect(callsTo('save_playhq_fixtures')[0].p_games).toEqual([
      expect.objectContaining({ id: 'g3', status: 'BYE', opponent: null, is_home: null }),
      expect.objectContaining({ id: 'g4', opponent: 'Rockets', is_home: true }),
    ]);
  });

  it('shows a refused save and imports no games', async () => {
    await openFixtures({}, { rpcErrors: { admin_save_playhq_season: 'Only admins can import fixtures' } });
    answerWith(COMPETITION);
    await lookUp();
    link('Sample Thunder', 'Open A');
    await importGames();
    expect(screen.getByText('Only admins can import fixtures')).toBeTruthy();
    expect(callsTo('save_playhq_fixtures')).toEqual([]);
    expect(screen.getByText('Import games for 1 team')).toBeTruthy();
  });

  it('shows a refused game import', async () => {
    await openFixtures({}, { rpcErrors: { save_playhq_fixtures: 'Team not found' } });
    answerWith(COMPETITION);
    await lookUp();
    link('Sample Thunder', 'Open A');
    await importGames();
    expect(screen.getByText('Team not found')).toBeTruthy();
    expect(screen.queryByText(/^Saved /)).toBeNull();
  });

  it('asks which club season when last season still runs alongside the new one', async () => {
    const next = { ...TEAM, id: 'team-2027', name: 'Open A', season: 2027 };
    await openFixtures({ teams: [...TEAMS, next] });
    answerWith(COMPETITION);
    await lookUp();
    expect(isSelected('2027–28')).toBe(true);
    fireEvent.press(screen.getByText('2026–27'));
    link('Sample Thunder', 'Open A (2026–27)');
    await importGames();
    expect(callsTo('admin_save_playhq_season')[0]).toMatchObject({
      p_season: 2026,
      p_teams: [{ playhq_team_id: 'ph-1', playhq_name: 'Sample Thunder', team_id: TEAM.id }],
    });
  });

  it('cancelling a look-up goes back to adding a competition', async () => {
    await openFixtures();
    answerWith(COMPETITION);
    await lookUp();
    fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByText('Winter League 2026')).toBeNull();
    expect(screen.getByText('Look up')).toBeTruthy();
    expect(callsTo('admin_save_playhq_season')).toEqual([]);
  });

  it('lists saved competitions with their linked teams and when they were updated', async () => {
    await openFixtures({
      saved: [
        SAVED,
        { ...SAVED, playhq_season_id: 'comp-2', name: 'Summer Cup', imported_at: null, playhq_teams: [] },
        { ...SAVED, playhq_season_id: 'comp-3', name: 'Old Cup', playhq_teams: [{ playhq_team_id: 'x', playhq_name: 'Thunder 2024', team_id: 'gone' }] },
      ],
    });
    expect(screen.getByText('2026–27 · Sample Thunder → Open A')).toBeTruthy();
    expect(screen.getByText('2026–27 · No teams linked')).toBeTruthy();
    expect(screen.getByText('2026–27 · Thunder 2024 → archived')).toBeTruthy();
    expect(screen.getByText('Not imported')).toBeTruthy();
    expect(screen.getAllByText(/^Updated /)).toHaveLength(2);
  });

  it('refreshes a saved competition’s linked teams only, and shows the PlayHQ check on it', async () => {
    await openFixtures({ saved: [SAVED] });
    answerWith(COMPETITION);
    fireEvent.press(screen.getByText('Refresh from PlayHQ'));
    await settle();
    expect(invoke()).toHaveBeenCalledWith('playhq', {
      body: { tenant: 'netball-australia', seasonCode: 'ec69e46d' },
    });
    expect(callsTo('admin_save_playhq_season')).toEqual([]);
    expect(callsTo('save_playhq_fixtures').map((c) => c.p_playhq_team_id)).toEqual(['ph-1']);
    expect(screen.getByText('Updated 2 games from Winter League 2026.')).toBeTruthy();
    expect(screen.getByText('PlayHQ check')).toBeTruthy();
    expect(screen.getByText('Our teams: 1 game in the last 12 months, 1 in the next 12 months.')).toBeTruthy();
  });

  it('shows why a refresh failed', async () => {
    await openFixtures({ saved: [SAVED] });
    answerWith(null, { name: 'FunctionsFetchError', message: 'offline' });
    fireEvent.press(screen.getByText('Refresh from PlayHQ'));
    await settle();
    expect(screen.getByText('Couldn’t reach the club’s server. Check your connection and try again.')).toBeTruthy();
    expect(callsTo('save_playhq_fixtures')).toEqual([]);
  });

  it('Change teams opens the saved competition with its links and season', async () => {
    await openFixtures({ saved: [{ ...SAVED, season: 2026 }] });
    answerWith(COMPETITION);
    fireEvent.press(screen.getByText('Change teams'));
    await settle();
    expect(screen.getByText('Import games for 1 team')).toBeTruthy();
    expect(screen.getByText('Open · Open A')).toBeTruthy();
    await importGames();
    expect(callsTo('admin_save_playhq_season')[0]).toMatchObject({
      p_url: SAVED_URL,
      p_season: 2026,
      p_teams: [
        { playhq_team_id: 'ph-1', playhq_name: 'Sample Thunder', team_id: TEAM.id },
        { playhq_team_id: 'ph-3', playhq_name: 'Sample Lightning', team_id: '' },
      ],
    });
  });

  it('lists the coming matches, with byes and times to be confirmed', async () => {
    await openFixtures({ fixtures: UPCOMING });
    expect(screen.getByText('Coming up')).toBeTruthy();
    expect(screen.getByText('Open A v Rockets')).toBeTruthy();
    expect(screen.getByText('Open A · Bye')).toBeTruthy();
    expect(screen.getByText(/^Round 2 · .* · State Netball Centre Court 3$/)).toBeTruthy();
    expect(screen.getByText(/^Round 3 · .*, time to be confirmed$/)).toBeTruthy();
  });

  it('shows no Coming up list without fixtures', async () => {
    await openFixtures();
    expect(screen.queryByText('Coming up')).toBeNull();
  });
});
