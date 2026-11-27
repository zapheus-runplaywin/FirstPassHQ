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
  flip,
  input,
  isOn,
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

type AudienceRow = { kind: string; role: string | null; post: string | null; team_id: string | null };
type CalendarRow = {
  id: string;
  name: string;
  url: string | null;
  color: string | null;
  calendar_audiences: AudienceRow[];
  in_hq?: boolean;
  takes_suggestions?: boolean;
  moved_in_at?: string | null;
  moved_in_by_name?: string | null;
  hq_calendar_events?: { count: number }[];
};

const everyone: AudienceRow = { kind: 'everyone', role: null, post: null, team_id: null };
const role = (r: string): AudienceRow => ({ kind: 'role', role: r, post: null, team_id: null });
const post = (p: string): AudienceRow => ({ kind: 'post', role: null, post: p, team_id: null });
const group = (id: string): AudienceRow => ({ kind: 'team', role: null, post: null, team_id: id });

const CLUB_CAL: CalendarRow = {
  id: 'cal-club',
  name: 'Club calendar',
  url: 'https://outlook.example/club.ics',
  color: null,
  calendar_audiences: [everyone],
};
const COMMITTEE_CAL: CalendarRow = {
  ...CLUB_CAL,
  id: 'cal-committee',
  name: 'Committee dates',
  url: 'webcal://outlook.example/committee.ics',
  color: 'violet',
  calendar_audiences: [role('committee')],
};
const TEAM_CAL: CalendarRow = { ...CLUB_CAL, id: 'cal-team', name: 'Open A games', calendar_audiences: [group(TEAM.id)] };
const OLD_TEAM_CAL: CalendarRow = { ...CLUB_CAL, id: 'cal-old', name: 'Old team', calendar_audiences: [group('gone')] };
const MIXED_CAL: CalendarRow = {
  ...CLUB_CAL,
  id: 'cal-mixed',
  name: 'Physio and safeguarding',
  calendar_audiences: [role('statistician'), role('physio'), post('child_safety_officer'), group(SQUAD.id)],
};
const NOBODY_CAL: CalendarRow = { ...CLUB_CAL, id: 'cal-nobody', name: 'Added the old way', calendar_audiences: [] };

let log: TableQuery[];

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
/** Each link an admin saves is downloaded first; answers by link, a calendar file otherwise. */
let feeds: Record<string, string | number>;
let fetchMock: jest.Mock;
beforeEach(() => {
  feeds = {};
  fetchMock = jest.fn(async (url: string) => {
    const body = feeds[url] ?? ICS;
    if (typeof body === 'number') return { ok: false, status: body, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

async function openCalendars(calendars: CalendarRow[] = [], rpcErrors: Record<string, string> = {}) {
  const recorder = recordTables(['calendars']);
  log = recorder.log;
  await openScreen('admin', { 'admin/calendars': CalendarsScreen }, '/admin/calendars', {
    calendars,
    teams: TEAMS,
  }, { tableHandlers: recorder.handlers, rpcErrors });
}

const calendarReads = () =>
  log.filter((q) => q.table === 'calendars' && q.calls.some((c) => c.method === 'select')).length;
const saves = () => callsTo('admin_save_calendar');
/** Whether the first chip with this text (the card being edited) is selected. */
function chipSelected(text: string) {
  let node: ReturnType<typeof screen.getByText> | null = screen.getAllByText(text)[0];
  while (node && node.props.accessibilityState === undefined) node = node.parent;
  return node?.props.accessibilityState?.selected === true;
}

async function add() {
  await fireEvent.press(screen.getByText('Add calendar'));
  await settle();
}

/** Saves a new calendar with a good link, shown to these choices. */
async function addShownTo(...labels: string[]) {
  await type('ICS link', 'https://outlook.example/new.ics');
  for (const label of labels) await fireEvent.press(screen.getAllByText(label).at(-1)!);
  await add();
}

describe('Calendars', () => {
  it('says there are none yet', async () => {
    await openCalendars();
    expect(screen.getByText('No calendars yet. Add the club calendar below.')).toBeTruthy();
  });

  it('lists each calendar with who it’s shown to and its link', async () => {
    await openCalendars([CLUB_CAL, COMMITTEE_CAL, TEAM_CAL, OLD_TEAM_CAL, MIXED_CAL, NOBODY_CAL]);
    expect(screen.getByText('Shown to Everyone in the club')).toBeTruthy();
    expect(screen.getByText('Shown to Committee')).toBeTruthy();
    expect(screen.getByText('Shown to Open A')).toBeTruthy();
    // A team that isn't this season's any more.
    expect(screen.getByText('Shown to 1 earlier squad or team')).toBeTruthy();
    expect(
      screen.getByText('Shown to Physios, Statisticians, Child Safety Officers and Open Squad'),
    ).toBeTruthy();
    expect(screen.getByText('Shown to Admins only (choose who sees it)')).toBeTruthy();
    expect(screen.getByText('webcal://outlook.example/committee.ics')).toBeTruthy();
  });

  it('offers everyone, each role, each safeguarding post and each current squad and team', async () => {
    await openCalendars();
    expect(isSelected('Everyone in the club')).toBe(false);
    for (const label of [
      'Committee',
      'Coaches',
      'Managers',
      'Physios',
      'Statisticians',
      'Athletes',
      'Parents and guardians',
      'Guests',
      'Child Safety Officers',
      'Complaints Managers',
      'WWC Registration Officers',
      'Open Squad',
      'Open A',
      '17 & Under A',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('hides the other choices while Everyone is ticked', async () => {
    await openCalendars();
    await fireEvent.press(screen.getByText('Everyone in the club'));
    expect(isSelected('Everyone in the club')).toBe(true);
    expect(screen.queryByText('Physios')).toBeNull();
    expect(screen.getByText('Every approved member, including guests. Not temporary helpers.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Everyone in the club'));
    expect(screen.getByText('Physios')).toBeTruthy();
  });

  it('won’t add a calendar shown to nobody (need to know)', async () => {
    await openCalendars();
    await type('ICS link', 'https://outlook.example/club.ics');
    await add();
    expect(screen.getByText('Choose who sees this calendar.')).toBeTruthy();
    expect(saves()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['outlook.example/club.ics', 'http://outlook.example/club.ics', '', 'ftp://x'])(
    'refuses the link “%s”, which isn’t an https:// or webcal:// link',
    async (link) => {
      await openCalendars();
      await type('ICS link', link);
      await fireEvent.press(screen.getByText('Everyone in the club'));
      await add();
      expect(screen.getByText('Paste the ICS link from Outlook. It starts with https://')).toBeTruthy();
      expect(saves()).toEqual([]);
    },
  );

  it('adds the club calendar under its default name, trimming the link', async () => {
    await openCalendars();
    await type('ICS link', '  https://outlook.example/club.ics  ');
    await fireEvent.press(screen.getByText('Everyone in the club'));
    await add();
    expect(saves()).toEqual([
      {
        p_id: null,
        p_name: 'Club calendar',
        p_url: 'https://outlook.example/club.ics',
        p_color: null,
        p_everyone: true,
        p_roles: [],
        p_team_ids: [],
        p_posts: [],
      },
    ]);
    expect(writes(log, 'calendars')).toEqual([]);
  });

  it('adds a calendar for physios, statisticians and guests', async () => {
    await openCalendars();
    await addShownTo('Physios', 'Statisticians', 'Guests');
    expect(saves()[0]).toMatchObject({
      p_name: 'Calendar',
      p_everyone: false,
      p_roles: ['physio', 'statistician', 'guest'],
      p_team_ids: [],
      p_posts: [],
    });
  });

  it('adds a calendar for the safeguarding posts and a squad', async () => {
    await openCalendars();
    await addShownTo('Child Safety Officers', 'Complaints Managers', 'Open Squad');
    expect(saves()[0]).toMatchObject({
      p_roles: [],
      p_team_ids: [SQUAD.id],
      p_posts: ['child_safety_officer', 'complaints_manager'],
    });
  });

  it('untapping a choice takes it off', async () => {
    await openCalendars();
    await addShownTo('Guests', 'Coaches', 'Guests');
    expect(saves()[0]).toMatchObject({ p_roles: ['coach'] });
  });

  it('sends only Everyone when Everyone is ticked after other choices', async () => {
    await openCalendars();
    await addShownTo('Guests', 'Open A', 'Everyone in the club');
    expect(saves()[0]).toMatchObject({ p_everyone: true, p_roles: [], p_team_ids: [], p_posts: [] });
  });

  it('refuses Outlook’s web page link and saves nothing (21 November 2026)', async () => {
    await openCalendars();
    await type('ICS link', 'https://outlook.example/owa/calendar/abc/calendar.html');
    await fireEvent.press(screen.getByText('Everyone in the club'));
    await add();
    expect(
      screen.getByText('That’s Outlook’s web page link (it ends in .html). Use the ICS link instead, which ends in .ics.'),
    ).toBeTruthy();
    expect(saves()).toEqual([]);
    expect(input('ICS link').props.value).toBe('https://outlook.example/owa/calendar/abc/calendar.html');
  });

  it('downloads a new link first and refuses one that isn’t a calendar file', async () => {
    feeds['https://outlook.example/page'] = '<html><body>Calendar</body></html>';
    await openCalendars();
    await type('ICS link', 'https://outlook.example/page');
    await fireEvent.press(screen.getByText('Everyone in the club'));
    await add();
    expect(fetchMock).toHaveBeenCalledWith('https://outlook.example/page');
    expect(
      screen.getByText('That link opens a web page, not a calendar file. Use the ICS link from Outlook, which ends in .ics.'),
    ).toBeTruthy();
    expect(saves()).toEqual([]);
  });

  it('refuses a new link that answers with an error', async () => {
    feeds['https://outlook.example/club.ics'] = 404;
    await openCalendars();
    await type('ICS link', 'https://outlook.example/club.ics');
    await fireEvent.press(screen.getByText('Everyone in the club'));
    await add();
    expect(
      screen.getByText('That link didn’t work (error 404). Copy the ICS link from Outlook again and paste the whole of it.'),
    ).toBeTruthy();
    expect(saves()).toEqual([]);
  });

  it('takes out line breaks a paste slipped into the middle of the link', async () => {
    await openCalendars();
    await type('ICS link', 'https://outlook.example/owa/\n  calendar/club.ics');
    await fireEvent.press(screen.getByText('Everyone in the club'));
    await add();
    expect(saves()[0]).toMatchObject({ p_url: 'https://outlook.example/owa/calendar/club.ics' });
  });

  it('adds a committee calendar from a webcal:// link', async () => {
    await openCalendars();
    await type('ICS link', 'WEBCAL://outlook.example/committee.ics');
    await fireEvent.press(screen.getByText('Committee'));
    await add();
    expect(saves()[0]).toMatchObject({
      p_name: 'Committee calendar',
      p_url: 'WEBCAL://outlook.example/committee.ics',
      p_roles: ['committee'],
    });
  });

  it('offers twelve colours, and says squads and teams take the ones no calendar uses', async () => {
    await openCalendars();
    for (const colour of ['Yellow', 'Blue', 'Green', 'Pink', 'Orange', 'Violet', 'Light blue', 'Dark blue', 'Red', 'Lime', 'Teal', 'Magenta']) {
      expect(screen.getAllByLabelText(colour).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByText(
        'The colour you pick is kept for this calendar. Squads and teams take theirs from the colours no calendar uses.',
      ),
    ).toBeTruthy();
  });

  it('saves one of the newer colours', async () => {
    await openCalendars();
    await type('ICS link', 'https://outlook.example/physio.ics');
    await fireEvent.press(screen.getByText('Physios'));
    await fireEvent.press(screen.getAllByLabelText('Teal').at(-1)!);
    await add();
    expect(saves()[0]).toMatchObject({ p_color: 'teal', p_roles: ['physio'] });
  });

  it('adds a team calendar with its own name and colour, then clears the form and reloads', async () => {
    await openCalendars();
    const readsBefore = calendarReads();
    await type('ICS link', 'https://outlook.example/open-a.ics');
    await type('Name (optional)', '  Open A games  ');
    await fireEvent.press(screen.getByText('Open A'));
    await fireEvent.press(screen.getByLabelText('Violet'));
    await add();
    expect(saves()[0]).toEqual({
      p_id: null,
      p_name: 'Open A games',
      p_url: 'https://outlook.example/open-a.ics',
      p_color: 'violet',
      p_everyone: false,
      p_roles: [],
      p_team_ids: [TEAM.id],
      p_posts: [],
    });
    expect(input('ICS link').props.value).toBe('');
    expect(input('Name (optional)').props.value).toBe('');
    expect(isSelected('Open A')).toBe(false);
    expect(calendarReads()).toBe(readsBefore + 1);
  });

  it('names a team calendar after the team when left unnamed', async () => {
    await openCalendars();
    await addShownTo('17 & Under A');
    expect(saves()[0]).toMatchObject({ p_name: '17 & Under A calendar', p_team_ids: [TEAM_B.id] });
  });

  it('starts each audience on its own colour until one is picked', async () => {
    await openCalendars();
    const selected = () =>
      ['Yellow', 'Pink', 'Blue', 'Green'].filter(
        (c) => screen.getByLabelText(c).props.accessibilityState?.selected,
      );
    expect(selected()).toEqual(['Yellow']);
    await fireEvent.press(screen.getByText('Committee'));
    expect(selected()).toEqual(['Pink']);
    await fireEvent.press(screen.getByText('Committee'));
    await fireEvent.press(screen.getByText('Open Squad'));
    expect(selected()).toEqual(['Blue']);
    await fireEvent.press(screen.getByText('Open Squad'));
    await fireEvent.press(screen.getByText('Open A'));
    expect(selected()).toEqual(['Green']);
    // A mix takes the club's colour.
    await fireEvent.press(screen.getByText('Physios'));
    expect(selected()).toEqual(['Yellow']);
  });

  it('shows why the database refused a new calendar and keeps what was typed', async () => {
    await openCalendars([], { admin_save_calendar: 'Only admins can change calendars' });
    await type('ICS link', 'https://outlook.example/club.ics');
    await fireEvent.press(screen.getByText('Everyone in the club'));
    await add();
    expect(screen.getByText('Only admins can change calendars')).toBeTruthy();
    expect(input('ICS link').props.value).toBe('https://outlook.example/club.ics');
  });

  it('changes a calendar’s name and link, keeping who sees it', async () => {
    await openCalendars([MIXED_CAL]);
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    await type('Name', 'Thunder club');
    await type('ICS link', ' https://outlook.example/new.ics ', 0);
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(saves()).toEqual([
      {
        p_id: 'cal-mixed',
        p_name: 'Thunder club',
        p_url: 'https://outlook.example/new.ics',
        p_color: null,
        p_everyone: false,
        p_roles: ['statistician', 'physio'],
        p_team_ids: [SQUAD.id],
        p_posts: ['child_safety_officer'],
      },
    ]);
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('changes who sees a calendar: from everyone to guests and WWC officers', async () => {
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    expect(chipSelected('Everyone in the club')).toBe(true);
    await fireEvent.press(screen.getAllByText('Everyone in the club')[0]);
    await fireEvent.press(screen.getAllByText('Guests')[0]);
    await fireEvent.press(screen.getAllByText('WWC Registration Officers')[0]);
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(saves()[0]).toMatchObject({
      p_id: 'cal-club',
      p_everyone: false,
      p_roles: ['guest'],
      p_posts: ['wwc_officer'],
      p_team_ids: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('won’t save a calendar changed to be shown to nobody', async () => {
    await openCalendars([COMMITTEE_CAL]);
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    await fireEvent.press(screen.getAllByText('Committee')[0]);
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Choose who sees this calendar.')).toBeTruthy();
    expect(saves()).toEqual([]);
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('refuses a changed link that opens a web page, and stays editing', async () => {
    feeds['https://outlook.example/new.html.page'] = '<html></html>';
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    await type('ICS link', 'https://outlook.example/new.html.page', 0);
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(
      screen.getByText('That link opens a web page, not a calendar file. Use the ICS link from Outlook, which ends in .ics.'),
    ).toBeTruthy();
    expect(saves()).toEqual([]);
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('doesn’t download the link again when only the name changes', async () => {
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    await type('Name', 'Thunder club');
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saves()[0]).toMatchObject({ p_name: 'Thunder club', p_url: CLUB_CAL.url, p_everyone: true });
  });

  it('keeps the old name when the new one is left empty', async () => {
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    await type('Name', '   ');
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(saves()[0]).toMatchObject({ p_name: 'Club calendar', p_url: CLUB_CAL.url });
  });

  it('refuses a changed link that isn’t an ICS link', async () => {
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    await type('ICS link', 'outlook.example', 0);
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getAllByText('Paste the ICS link from Outlook. It starts with https://')).toHaveLength(1);
    expect(saves()).toEqual([]);
  });

  it('cancelling an edit puts the saved name, link and audience back', async () => {
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    await type('Name', 'Something else');
    await fireEvent.press(screen.getAllByText('Everyone in the club')[0]);
    await fireEvent.press(screen.getByText('Cancel'));
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    expect(input('Name').props.value).toBe('Club calendar');
    expect(chipSelected('Everyone in the club')).toBe(true);
    expect(saves()).toEqual([]);
  });

  it('shows a refused change on the calendar and stays editing', async () => {
    await openCalendars([CLUB_CAL], { admin_save_calendar: 'Only admins can change calendars' });
    await fireEvent.press(screen.getByText('Change name, link or who sees it'));
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Only admins can change calendars')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('changes a calendar’s colour straight away', async () => {
    await openCalendars([CLUB_CAL]);
    // The card's swatches come before the new calendar's.
    await fireEvent.press(screen.getAllByLabelText('Pink')[0]);
    await settle();
    expect(writes(log, 'calendars')).toEqual([
      { method: 'update', values: { color: 'pink' }, filters: [['id', 'cal-club']] },
    ]);
  });

  it('asks again before deleting, and Keep it cancels', async () => {
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Delete'));
    expect(screen.getByText('Tap again to delete')).toBeTruthy();
    expect(writes(log, 'calendars')).toEqual([]);
    await fireEvent.press(screen.getByText('Keep it'));
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(writes(log, 'calendars')).toEqual([]);
  });

  it('deletes only that calendar on the second tap', async () => {
    await openCalendars([CLUB_CAL, TEAM_CAL]);
    await fireEvent.press(screen.getAllByText('Delete')[1]);
    await fireEvent.press(screen.getByText('Tap again to delete'));
    await settle();
    expect(writes(log, 'calendars')).toEqual([
      { method: 'delete', values: undefined, filters: [['id', 'cal-team']] },
    ]);
  });

  it('shows a refused delete', async () => {
    await openCalendars([CLUB_CAL]);
    failTableWrite('calendars', 'delete', 'Not allowed');
    await fireEvent.press(screen.getByText('Delete'));
    await fireEvent.press(screen.getByText('Tap again to delete'));
    await settle();
    expect(screen.getByText('Not allowed')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Calendars kept in the app (user guide section 10, "Calendars")

const SUGGEST = 'Coaches, managers and committee can suggest events';
const APP_CAL: CalendarRow = {
  id: 'cal-app',
  name: 'Club events',
  url: null,
  color: 'green',
  calendar_audiences: [everyone],
  in_hq: true,
  takes_suggestions: true,
  moved_in_at: null,
  moved_in_by_name: null,
  hq_calendar_events: [{ count: 3 }],
};
const appSaves = () => callsTo('admin_save_hq_calendar');
const moves = () => callsTo('admin_move_calendar_into_hq');
const vevent = (uid: string, start: string, end: string, summary: string) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${summary}`, 'END:VEVENT'].join('\r\n');
const feed = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');

describe('Calendars kept in the app', () => {
  it('adds one with no link, taking suggestions unless switched off', async () => {
    await openCalendars();
    expect(screen.getByText('ICS link')).toBeTruthy();
    await fireEvent.press(screen.getByText('In the app'));
    expect(screen.queryByText('ICS link')).toBeNull();
    expect(screen.getByText(/You add its events here in the app/)).toBeTruthy();
    expect(isOn(SUGGEST)).toBe(true);
    expect(screen.getByText(/nobody else sees it until an admin adds it/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Everyone in the club'));
    await add();
    expect(appSaves()).toEqual([
      {
        p_id: null,
        p_name: 'Club calendar',
        p_color: null,
        p_everyone: true,
        p_roles: [],
        p_team_ids: [],
        p_posts: [],
        p_takes_suggestions: true,
      },
    ]);
    // No link, so nothing is downloaded and the link's save isn't used.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saves()).toEqual([]);
  });

  it('adds one only admins add to', async () => {
    await openCalendars();
    await fireEvent.press(screen.getByText('In the app'));
    await flip(SUGGEST, false);
    expect(screen.getByText('Only admins add events to it.')).toBeTruthy();
    await type('Name (optional)', 'Committee dates');
    await fireEvent.press(screen.getAllByText('Committee').at(-1)!);
    await add();
    expect(appSaves()).toEqual([
      expect.objectContaining({ p_name: 'Committee dates', p_roles: ['committee'], p_takes_suggestions: false }),
    ]);
  });

  it('still won’t add one shown to nobody', async () => {
    await openCalendars();
    await fireEvent.press(screen.getByText('In the app'));
    await add();
    expect(screen.getByText('Choose who sees this calendar.')).toBeTruthy();
    expect(appSaves()).toEqual([]);
  });

  it('goes back to a link when An Outlook link is picked again', async () => {
    await openCalendars();
    await fireEvent.press(screen.getByText('In the app'));
    await fireEvent.press(screen.getByText('An Outlook link'));
    expect(screen.getByText('ICS link')).toBeTruthy();
    expect(screen.queryByLabelText(SUGGEST)).toBeNull();
  });

  it('keeps the form to add another folded away once calendars are listed', async () => {
    await openCalendars([CLUB_CAL]);
    expect(screen.queryByText('Where it’s kept')).toBeNull();
    expect(screen.queryByText('Add calendar')).toBeNull();
    await fireEvent.press(screen.getByText('Add another calendar'));
    expect(screen.getByText('Where it’s kept')).toBeTruthy();
    await fireEvent.press(screen.getByText('In the app'));
    await fireEvent.press(screen.getAllByText('Committee').at(-1)!);
    await add();
    expect(appSaves()).toHaveLength(1);
    // Saved, it folds away again.
    expect(screen.queryByText('Where it’s kept')).toBeNull();
    expect(screen.getByText('Add another calendar')).toBeTruthy();
  });

  it('Cancel folds the form away without saving', async () => {
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Add another calendar'));
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByText('Where it’s kept')).toBeNull();
    expect(appSaves()).toEqual([]);
    expect(saves()).toEqual([]);
  });

  it('opens the form straight away when there are no calendars yet', async () => {
    await openCalendars();
    expect(screen.getByText('Where it’s kept')).toBeTruthy();
    expect(screen.queryByText('Add another calendar')).toBeNull();
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('lists it with how many events it holds, not a link, and nothing to move', async () => {
    await openCalendars([APP_CAL, CLUB_CAL]);
    expect(screen.getByText('Kept in the app · 3 events · takes suggestions')).toBeTruthy();
    expect(screen.getByText('Change name or who sees it')).toBeTruthy();
    // Only the linked calendar offers to move in.
    expect(screen.getAllByText('Move into the app')).toHaveLength(1);
  });

  it('says when it was moved in from Outlook, and by whom', async () => {
    await openCalendars([
      {
        ...APP_CAL,
        takes_suggestions: false,
        hq_calendar_events: [{ count: 1 }],
        moved_in_at: '2026-10-12T04:00:00Z',
        moved_in_by_name: 'Alex Admin',
      },
    ]);
    expect(screen.getByText(/^Kept in the app · 1 event\. Moved in from Outlook on .*Oct.* by Alex Admin$/)).toBeTruthy();
  });

  it('changes its name, who sees it and whether it takes suggestions, with no link to check', async () => {
    await openCalendars([APP_CAL]);
    await fireEvent.press(screen.getByText('Change name or who sees it'));
    await type('Name', 'Club social');
    await flip(SUGGEST, false);
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(appSaves()).toEqual([
      {
        p_id: 'cal-app',
        p_name: 'Club social',
        p_color: 'green',
        p_everyone: true,
        p_roles: [],
        p_team_ids: [],
        p_posts: [],
        p_takes_suggestions: false,
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns how many events go with it before deleting', async () => {
    await openCalendars([APP_CAL]);
    await fireEvent.press(screen.getByText('Delete'));
    expect(writes(log, 'calendars')).toEqual([]);
    await fireEvent.press(screen.getByText('Tap again to delete it and its 3 events'));
    await settle();
    expect(writes(log, 'calendars')).toEqual([{ method: 'delete', values: undefined, filters: [['id', 'cal-app']] }]);
  });
});

describe('Moving a linked calendar into the app', () => {
  const TWO = feed(
    vevent('a', '20261020T100000Z', '20261020T113000Z', 'Committee meeting'),
    vevent('b', '20261205T020000Z', '20261205T040000Z', 'Working bee'),
  );

  it('reads the link first and says what comes across, changing nothing yet', async () => {
    feeds[CLUB_CAL.url!] = TWO;
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Move into the app'));
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(CLUB_CAL.url);
    expect(screen.getByText('Move Club calendar into the app?')).toBeTruthy();
    expect(screen.getByText(/^The link has 2 events, from .* to .*\. They are copied into the app\.$/)).toBeTruthy();
    expect(screen.getByText(/the app stops reading Outlook/)).toBeTruthy();
    expect(screen.getByText(/This can’t be undone/)).toBeTruthy();
    expect(moves()).toEqual([]);
  });

  it('moves the events in on the second tap', async () => {
    feeds[CLUB_CAL.url!] = TWO;
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Move into the app'));
    await settle();
    await fireEvent.press(screen.getByText('Move 2 events into the app'));
    await settle();
    expect(moves()).toEqual([
      {
        p_id: 'cal-club',
        p_events: [
          {
            title: 'Committee meeting',
            all_day: false,
            starts_at: '2026-10-20T10:00:00.000Z',
            ends_at: '2026-10-20T11:30:00.000Z',
            location: null,
            note: null,
          },
          {
            title: 'Working bee',
            all_day: false,
            starts_at: '2026-12-05T02:00:00.000Z',
            ends_at: '2026-12-05T04:00:00.000Z',
            location: null,
            note: null,
          },
        ],
      },
    ]);
    expect(screen.queryByText('Move Club calendar into the app?')).toBeNull();
  });

  it('Keep it in Outlook changes nothing', async () => {
    feeds[CLUB_CAL.url!] = TWO;
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Move into the app'));
    await settle();
    await fireEvent.press(screen.getByText('Keep it in Outlook'));
    expect(moves()).toEqual([]);
    expect(screen.getByText('Move into the app')).toBeTruthy();
    expect(screen.getByText(CLUB_CAL.url!)).toBeTruthy();
  });

  it('a link with nothing on it starts the calendar empty', async () => {
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Move into the app'));
    await settle();
    expect(screen.getByText(/so the calendar starts empty/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Move it into the app'));
    await settle();
    expect(moves()).toEqual([{ p_id: 'cal-club', p_events: [] }]);
  });

  it('won’t offer to move a link it can’t read', async () => {
    feeds[CLUB_CAL.url!] = 500;
    await openCalendars([CLUB_CAL]);
    await fireEvent.press(screen.getByText('Move into the app'));
    await settle();
    expect(screen.getByText('The link couldn’t be read just now. Check your connection and try again.')).toBeTruthy();
    expect(screen.queryByText('Move Club calendar into the app?')).toBeNull();
    expect(moves()).toEqual([]);
  });

  it('shows why the database refused, and keeps asking', async () => {
    feeds[CLUB_CAL.url!] = TWO;
    await openCalendars([CLUB_CAL], { admin_move_calendar_into_hq: 'Only admins move calendars' });
    await fireEvent.press(screen.getByText('Move into the app'));
    await settle();
    await fireEvent.press(screen.getByText('Move 2 events into the app'));
    await settle();
    expect(screen.getByText('Only admins move calendars')).toBeTruthy();
    expect(screen.getByText('Move Club calendar into the app?')).toBeTruthy();
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
  await type('Add a PlayHQ competition', link);
  await fireEvent.press(screen.getByText('Look up'));
  await settle();
}

/** Links a PlayHQ team to one of ours. */
async function link(playhqName: string, ours: string) {
  await fireEvent.press(screen.getByText(playhqName));
  let card = screen.getByText(playhqName).parent;
  while (card && within(card).queryAllByText(ours).length === 0) card = card.parent;
  await fireEvent.press(within(card!).getAllByText(ours).at(-1)!);
}

async function importGames(label: RegExp = /^Import games for/) {
  await fireEvent.press(screen.getByText(label));
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
    await type('Find a team', 'rock');
    expect(screen.getByText('Rockets')).toBeTruthy();
    expect(screen.queryByText('Sample Thunder')).toBeNull();
    await type('Find a team', 'zzz');
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
    await fireEvent.press(screen.getByText('Sample Thunder'));
    for (const name of ['Not one of ours', 'Open Squad', 'Open A', '17 & Under A']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    await fireEvent.press(screen.getAllByText('Open A').at(-1)!);
    expect(screen.getByText('Import games for 1 team')).toBeTruthy();
    expect(screen.getByText('Our teams: 1 game in the last 12 months, 1 in the next 12 months.')).toBeTruthy();
  });

  it('saves the competition and its linked team, then each linked team’s games', async () => {
    await openFixtures();
    answerWith(COMPETITION);
    await lookUp();
    await link('Sample Thunder', 'Open A');
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
    await link('Sample Thunder', 'Open A');
    await link('Sample Lightning', '17 & Under A');
    await link('Sample Lightning', 'Not one of ours');
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
    await link('Sample Lightning', 'Open A');
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
    await link('Sample Thunder', 'Open A');
    await importGames();
    expect(screen.getByText('Only admins can import fixtures')).toBeTruthy();
    expect(callsTo('save_playhq_fixtures')).toEqual([]);
    expect(screen.getByText('Import games for 1 team')).toBeTruthy();
  });

  it('shows a refused game import', async () => {
    await openFixtures({}, { rpcErrors: { save_playhq_fixtures: 'Team not found' } });
    answerWith(COMPETITION);
    await lookUp();
    await link('Sample Thunder', 'Open A');
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
    await fireEvent.press(screen.getByText('2026–27'));
    await link('Sample Thunder', 'Open A (2026–27)');
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
    await fireEvent.press(screen.getByText('Cancel'));
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
    await fireEvent.press(screen.getByText('Refresh from PlayHQ'));
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
    await fireEvent.press(screen.getByText('Refresh from PlayHQ'));
    await settle();
    expect(screen.getByText('Couldn’t reach the club’s server. Check your connection and try again.')).toBeTruthy();
    expect(callsTo('save_playhq_fixtures')).toEqual([]);
  });

  it('Change teams opens the saved competition with its links and season', async () => {
    await openFixtures({ saved: [{ ...SAVED, season: 2026 }] });
    answerWith(COMPETITION);
    await fireEvent.press(screen.getByText('Change teams'));
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
