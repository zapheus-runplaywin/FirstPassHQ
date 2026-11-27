/**
 * Squad and team events added in the app: the Add button on the calendar,
 * the form (src/app/event/edit.tsx), and what a coach or manager can do on
 * an event's page (src/components/team-event-manage.tsx). From "Squad and
 * team events" in sections 3 and 6 of docs/user-guide.md.
 *
 * The database decides who may add, change and see an event
 * (supabase/tests/team-events.sql). These check what each kind of member is
 * offered, what the form sends, and that the calendar shows it afterwards.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import CalendarScreen from '@/app/(tabs)/calendar';
import EventScreen from '@/app/event/[id]';
import EditEventScreen from '@/app/event/edit';
import { CalendarColors } from '@/constants/calendar-colors';
import { formatDay } from '@/lib/format';
import { formatDateString } from '@/lib/injuries';
import type { TeamEventRow } from '@/lib/team-events';
import { refreshEvents } from '@/lib/use-events';

import { argsOf, clearCalls, field, isSelected, rpcNames, type } from './helpers/forms';
import {
  colourOf,
  openScreen,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  TEAM_B,
  toneOf,
  type BackendOptions,
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

/** An event in Open A, two days from today (TODAY is Sunday 18 October 2026). */
const row = (changes: Partial<TeamEventRow> = {}): TeamEventRow => ({
  id: 'e1',
  team_id: TEAM.id,
  team_name: 'Open A',
  team_kind: 'team',
  kind: 'training',
  title: 'Tuesday training',
  starts_at: '2026-10-20T10:00:00Z',
  ends_at: '2026-10-20T11:30:00Z',
  all_day: false,
  day: '2026-10-20',
  end_day: '2026-10-20',
  start_time: '18:00',
  end_time: '19:30',
  location: 'Court 1',
  note: 'Bring bibs',
  staff_only: false,
  series_id: null,
  cancelled_at: null,
  cancelled_by_name: null,
  created_by_name: 'Casey Coach',
  can_manage: false,
  ...changes,
});

let push: jest.SpyInstance;
let back: jest.SpyInstance;

beforeEach(() => {
  resetClub();
  setClubFeatures({ teamEvents: true });
  clearCalls();
  // Forget the event an earlier test loaded, so each page loads its own.
  refreshEvents('team-event:e1');
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
  globalThis.fetch = jest.fn(async () => ({ ok: false, status: 404, text: async () => '' })) as unknown as typeof fetch;
});
afterEach(() => {
  push.mockRestore();
  back.mockRestore();
});

type Setup = {
  rows?: TeamEventRow[];
  teams?: (typeof TEAM)[];
  reserved?: string[];
  options?: BackendOptions;
  tables?: Record<string, unknown[]>;
};

function backend({ rows = [row()], teams = [TEAM], reserved = [], options = {}, tables = {} }: Setup) {
  return {
    tables: { calendars: [], fixtures: [], teams, ...tables },
    options: {
      ...options,
      rpcs: { team_events_between: rows, reserved_calendar_colours: reserved, ...options.rpcs },
    },
  };
}

async function openCalendar(who: PersonaName, setup: Setup = {}) {
  const { tables, options } = backend(setup);
  await openScreen(who, { calendar: CalendarScreen }, '/calendar', tables, options);
  await settle();
}

async function openEvent(who: PersonaName, setup: Setup = {}, id = 'e1') {
  const { tables, options } = backend(setup);
  await openScreen(who, { 'event/[id]': EventScreen }, `/event/${encodeURIComponent(`team-event:${id}`)}`, tables, options);
  await settle();
}

async function openForm(who: PersonaName, setup: Setup = {}, query = '') {
  const { tables, options } = backend({ rows: [], ...setup });
  await openScreen(who, { 'event/edit': EditEventScreen }, `/event/edit${query}`, tables, options);
  await settle();
}

const saved = () => argsOf('save_team_event')[0];

// ---------------------------------------------------------------------------
describe('squad and team events on the calendar', () => {
  it('lists an event under its squad’s or team’s name', async () => {
    await openCalendar('athlete');
    expect(screen.getByText('Tuesday training')).toBeTruthy();
    expect(screen.getByLabelText(/^Tuesday training, .* · Court 1, Open A$/)).toBeTruthy();
  });

  it('asks the database for the events between today and three months ahead', async () => {
    await openCalendar('athlete');
    expect(argsOf('team_events_between')[0]).toEqual({
      p_from: new Date(2026, 9, 18).toISOString(),
      p_to: new Date(2027, 0, 18).toISOString(),
    });
  });

  it('keeps a cancelled event on the list, struck through and marked cancelled', async () => {
    await openCalendar('athlete', { rows: [row({ cancelled_at: '2026-10-19T00:00:00Z', cancelled_by_name: 'Emery Manager' })] });
    const label = screen.getByLabelText(/^Tuesday training, Cancelled · /);
    expect(label).toBeTruthy();
    expect(screen.getByText('Tuesday training').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ textDecorationLine: 'line-through' })]),
    );
  });

  it('has a filter for the squad or team', async () => {
    await openCalendar('athlete', {
      rows: [row(), row({ id: 'e2', team_id: TEAM_B.id, team_name: '17 & Under A', title: 'Juniors training' })],
      teams: [TEAM, TEAM_B],
    });
    await fireEvent.press(screen.getAllByText('17 & Under A')[0]);
    expect(screen.getByText('Juniors training')).toBeTruthy();
    expect(screen.queryByText('Tuesday training')).toBeNull();
  });

  it('with the feature off, asks for no events and shows none', async () => {
    setClubFeatures({ teamEvents: false });
    await openCalendar('coach');
    expect(rpcNames()).not.toContain('team_events_between');
    expect(screen.queryByText('Tuesday training')).toBeNull();
    expect(screen.queryByText('Add an event')).toBeNull();
  });

  it.each(['coach', 'manager', 'admin'] as const)('offers Add an event to a %s', async (who) => {
    await openCalendar(who);
    expect(screen.getByText('Add an event')).toBeTruthy();
  });

  it.each(['athlete', 'guardian', 'physio', 'committee', 'guest', 'coachExpiredCheck', 'stoodDownCoach'] as const)(
    'doesn’t offer it to a %s',
    async (who) => {
      await openCalendar(who);
      expect(screen.queryByText('Add an event')).toBeNull();
    },
  );

  it('offers it on an empty calendar too, so the first event can be added', async () => {
    await openCalendar('coach', { rows: [] });
    expect(screen.getByText('Nothing on the calendar yet.')).toBeTruthy();
    expect(screen.getByText('Add an event')).toBeTruthy();
  });

  it('starts the new event on the day being looked at', async () => {
    await openCalendar('coach');
    await fireEvent.press(screen.getByLabelText('Next week'));
    await fireEvent.press(screen.getByLabelText(new Date(2026, 9, 22).toDateString()));
    await fireEvent.press(screen.getByText('Add an event'));
    expect(push).toHaveBeenCalledWith({ pathname: '/event/edit', params: { day: '2026-10-22' } });
  });

  it('and for the squad or team the calendar is filtered to', async () => {
    await openCalendar('coach');
    await fireEvent.press(screen.getAllByText('Open A')[0]);
    await fireEvent.press(screen.getByText('Add an event'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/event/edit',
      params: { day: '2026-10-18', team: TEAM.id },
    });
  });
});

// ---------------------------------------------------------------------------
describe('colours nobody has to pick', () => {
  const nameColour = () => colourOf(screen.getByText('Open A'));

  it('a team’s events show in the first colour no calendar uses', async () => {
    await openEvent('athlete', { reserved: ['yellow', 'pink'] });
    expect(nameColour()).toBe(CalendarColors.blue.hex);
  });

  it('keeping clear of a colour an admin picked for a calendar', async () => {
    await openEvent('athlete', { reserved: ['blue', 'yellow'] });
    expect(nameColour()).toBe(CalendarColors.green.hex);
  });

  it('the second team takes the next colour', async () => {
    await openEvent('athlete', { teams: [TEAM_B, TEAM], reserved: [] });
    expect(nameColour()).toBe(CalendarColors.green.hex);
  });

  it('a team from an earlier season falls back to the usual team colour', async () => {
    await openEvent('athlete', { teams: [] });
    expect(nameColour()).toBe(CalendarColors.green.hex);
  });
});

describe('a squad’s or team’s own Outlook calendar', () => {
  const ICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:gym',
    'SUMMARY:Gym session',
    'DTSTART:20261021T090000Z',
    'DTEND:20261021T100000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const calendar = (color: string | null, audiences: { kind: string; role: string | null; team_id: string | null }[]) => ({
    id: 'cal-team',
    name: 'Open A gym',
    url: 'https://example.test/gym.ics',
    color,
    team: null,
    calendar_audiences: audiences.map((a) => ({ post: null, team: a.team_id ? { kind: 'team' } : null, ...a })),
  });
  const forTeam = [{ kind: 'team', role: null, team_id: TEAM.id }];

  async function openGym(calendars: unknown[], reserved: string[]) {
    globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => ICS })) as unknown as typeof fetch;
    await openScreen(
      'athlete',
      { 'event/[id]': EventScreen },
      `/event/${encodeURIComponent('gym:2026-10-21T09:00:00.000Z')}`,
      { calendars, fixtures: [], teams: [TEAM] },
      { rpcs: { team_events_between: [], reserved_calendar_colours: reserved } },
    );
    await settle();
  }
  beforeEach(() => refreshEvents('gym:2026-10-21T09:00:00.000Z'));

  it('with no colour picked, shows in the team’s colour', async () => {
    await openGym([calendar(null, forTeam)], ['blue']);
    expect(colourOf(screen.getByText('Open A gym'))).toBe(CalendarColors.green.hex);
  });

  it('keeps a colour an admin picked for it', async () => {
    await openGym([calendar('teal', forTeam)], ['teal']);
    expect(colourOf(screen.getByText('Open A gym'))).toBe(CalendarColors.teal.hex);
  });

  it('a calendar shown to a role as well keeps the club’s usual colour', async () => {
    await openGym([calendar(null, [...forTeam, { kind: 'role', role: 'physio', team_id: null }])], ['blue']);
    expect(colourOf(screen.getByText('Open A gym'))).toBe(CalendarColors.yellow.hex);
  });
});

// ---------------------------------------------------------------------------
describe('an event’s page', () => {
  it('shows a member the event, who added it, and nothing to change it with', async () => {
    await openEvent('athlete');
    expect(screen.getByText('Tuesday training')).toBeTruthy();
    expect(screen.getByText('Court 1')).toBeTruthy();
    expect(screen.getByText('Bring bibs')).toBeTruthy();
    expect(screen.getByText('Added by Casey Coach')).toBeTruthy();
    expect(screen.queryByTestId('event-manage')).toBeNull();
    expect(screen.queryByText('Change')).toBeNull();
    expect(screen.queryByText('Cancel event')).toBeNull();
    expect(screen.queryByText('Added by mistake? Remove it')).toBeNull();
  });

  it('says when an event is for coaches and managers only', async () => {
    await openEvent('coach', { rows: [row({ staff_only: true, can_manage: true })] });
    expect(screen.getByText('Coaches and managers only')).toBeTruthy();
  });

  it('shows an event over several days from its first day to its last', async () => {
    await openEvent('athlete', { rows: [row({ all_day: true, day: '2026-10-23', end_day: '2026-10-25' })] });
    expect(
      screen.getByText(`${formatDay(new Date(2026, 9, 23))} to ${formatDay(new Date(2026, 9, 25))}`),
    ).toBeTruthy();
  });

  it('lets its coach open it to change', async () => {
    await openEvent('coach', { rows: [row({ can_manage: true })] });
    await fireEvent.press(screen.getByText('Change'));
    expect(push).toHaveBeenCalledWith({ pathname: '/event/edit', params: { id: 'team-event:e1' } });
  });

  it('cancels only after asking, and then loads the calendar again', async () => {
    await openEvent('coach', { rows: [row({ can_manage: true })] });
    await fireEvent.press(screen.getByText('Cancel event'));
    expect(argsOf('cancel_team_event')).toHaveLength(0);
    expect(screen.getByText(/It stays on the calendar, marked cancelled/)).toBeTruthy();
    // A one-off event has no later weeks to offer.
    expect(screen.queryByText('Cancel this and later weeks')).toBeNull();
    clearCalls();
    await fireEvent.press(screen.getByText('Cancel this one'));
    await settle();
    expect(argsOf('cancel_team_event')).toEqual([{ p_id: 'e1', p_following: false }]);
    expect(rpcNames()).toContain('team_events_between');
    expect(back).not.toHaveBeenCalled();
    expect(screen.queryByTestId('event-confirm')).toBeNull();
  });

  it('can be talked out of cancelling', async () => {
    await openEvent('coach', { rows: [row({ can_manage: true })] });
    await fireEvent.press(screen.getByText('Cancel event'));
    await fireEvent.press(screen.getByText('Keep it on'));
    expect(argsOf('cancel_team_event')).toHaveLength(0);
    expect(screen.getByText('Cancel event')).toBeTruthy();
  });

  it('offers this and later weeks for a weekly event', async () => {
    await openEvent('manager', { rows: [row({ can_manage: true, series_id: 's1' })] });
    await fireEvent.press(screen.getByText('Cancel event'));
    await fireEvent.press(screen.getByText('Cancel this and later weeks'));
    await settle();
    expect(argsOf('cancel_team_event')).toEqual([{ p_id: 'e1', p_following: true }]);
  });

  it('shows a cancelled event as cancelled, with who cancelled it, and offers to put it back', async () => {
    await openEvent('coach', {
      rows: [row({ can_manage: true, cancelled_at: '2026-10-19T00:00:00Z', cancelled_by_name: 'Emery Manager' })],
    });
    const status = screen.getByText('Cancelled by Emery Manager');
    expect(toneOf(status)).toBe('attention');
    expect(screen.queryByText('Cancel event')).toBeNull();
    await fireEvent.press(screen.getByText('Put it back on'));
    await settle();
    expect(argsOf('restore_team_event')).toEqual([{ p_id: 'e1' }]);
  });

  it('a member sees a cancelled event as cancelled, with no shortcuts for a session that isn’t on', async () => {
    await openEvent('athlete', { rows: [row({ cancelled_at: '2026-10-19T00:00:00Z', cancelled_by_name: 'Emery Manager' })] });
    expect(screen.getByText('Cancelled by Emery Manager')).toBeTruthy();
    expect(screen.queryByTestId('session-actions')).toBeNull();
    expect(screen.queryByText('Put it back on')).toBeNull();
  });

  it('removes an event added by mistake after asking, and leaves its page', async () => {
    await openEvent('coach', { rows: [row({ can_manage: true })] });
    await fireEvent.press(screen.getByText('Added by mistake? Remove it'));
    expect(screen.getByText(/It comes off the calendar altogether/)).toBeTruthy();
    expect(argsOf('remove_team_event')).toHaveLength(0);
    await fireEvent.press(screen.getByText('Remove this one'));
    await settle();
    expect(argsOf('remove_team_event')).toEqual([{ p_id: 'e1', p_following: false }]);
    expect(back).toHaveBeenCalled();
  });

  it('removes this and later weeks of a weekly event', async () => {
    await openEvent('coach', { rows: [row({ can_manage: true, series_id: 's1' })] });
    await fireEvent.press(screen.getByText('Added by mistake? Remove it'));
    await fireEvent.press(screen.getByText('Remove this and later weeks'));
    await settle();
    expect(argsOf('remove_team_event')).toEqual([{ p_id: 'e1', p_following: true }]);
  });

  it('doesn’t offer to remove an event that has started: it can only be cancelled', async () => {
    await openEvent('coach', {
      rows: [row({ can_manage: true, starts_at: '2026-10-18T01:00:00Z', ends_at: '2026-10-18T03:00:00Z', day: '2026-10-18', end_day: '2026-10-18' })],
    });
    expect(screen.getByText('Cancel event')).toBeTruthy();
    expect(screen.queryByText('Added by mistake? Remove it')).toBeNull();
  });

  it('says why when the database refuses, and stays on the question', async () => {
    await openEvent('coach', {
      rows: [row({ can_manage: true })],
      options: { rpcErrors: { cancel_team_event: 'Squad and team events are turned off' } },
    });
    await fireEvent.press(screen.getByText('Cancel event'));
    await fireEvent.press(screen.getByText('Cancel this one'));
    await settle();
    expect(screen.getByText('Squad and team events are turned off.')).toBeTruthy();
    expect(screen.getByTestId('event-confirm')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('adding an event', () => {
  it('opens ready for a training today for the coach’s own team', async () => {
    await openForm('coach');
    expect(screen.getByText('For Open A')).toBeTruthy();
    expect(isSelected('Training')).toBe(true);
    expect(field('Name').props.value).toBe('Training');
    expect(screen.getByTestId('event-day').props.children).toBe(formatDateString('2026-10-18'));
    expect(isSelected('Just this once')).toBe(true);
    expect(screen.getByText('Add to the calendar')).toBeTruthy();
  });

  it('saves a training with just a time and a place, then goes back to a calendar that loads again', async () => {
    await openForm('coach');
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('1½ hours'));
    expect(field('Finishes').props.value).toBe('7:30 pm');
    await type('Where', 'Court 1');
    clearCalls();
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toEqual({
      p_id: null,
      p_team_id: TEAM.id,
      p_kind: 'training',
      p_title: 'Training',
      p_day: '2026-10-18',
      p_end_day: null,
      p_all_day: false,
      p_start: '18:00',
      p_end: '19:30',
      p_location: 'Court 1',
      p_note: null,
      p_staff_only: false,
      p_repeat_until: null,
    });
    expect(back).toHaveBeenCalled();
    expect(rpcNames()).toContain('team_events_between');
  });

  it('names the event after its kind until the member types a name of their own', async () => {
    await openForm('coach');
    await fireEvent.press(screen.getByText('Game'));
    expect(field('Name').props.value).toBe('Game');
    await fireEvent.press(screen.getByText('Meeting'));
    expect(field('Name').props.value).toBe('Team meeting');
    await type('Name', 'Parents’ night');
    await fireEvent.press(screen.getByText('Social'));
    expect(field('Name').props.value).toBe('Parents’ night');
    await type('Starts', '7pm');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({ p_kind: 'social', p_title: 'Parents’ night' });
  });

  it('offers a finish time only once the start can be read', async () => {
    await openForm('coach');
    expect(screen.getByText('Write a time like 6pm or 18:00.')).toBeTruthy();
    expect(screen.queryByText('1 hour')).toBeNull();
    await type('Starts', '18:15');
    await fireEvent.press(screen.getByText('2 hours'));
    expect(field('Finishes').props.value).toBe('8:15 pm');
    expect(isSelected('2 hours')).toBe(true);
    expect(isSelected('1 hour')).toBe(false);
  });

  it('doesn’t offer a finish past midnight', async () => {
    await openForm('coach');
    await type('Starts', '10:30 pm');
    expect(screen.getByText('1 hour')).toBeTruthy();
    expect(screen.queryByText('1½ hours')).toBeNull();
    expect(screen.queryByText('2 hours')).toBeNull();
  });

  it('says what’s missing, and saves nothing', async () => {
    await openForm('coach');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    expect(screen.getByText('Give a start time, or make it all day.')).toBeTruthy();
    await type('Starts', 'evening');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    expect(screen.getByText('Write times like 6:00 pm or 18:00.')).toBeTruthy();
    await type('Starts', '6pm');
    await type('Name', ' ');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    expect(screen.getByText('Give the event a name.')).toBeTruthy();
    expect(argsOf('save_team_event')).toHaveLength(0);
    expect(back).not.toHaveBeenCalled();
  });

  it('picks the day from the week, and moves between weeks', async () => {
    await openForm('coach');
    await fireEvent.press(screen.getByLabelText('Next week'));
    await fireEvent.press(screen.getByLabelText('Next week'));
    await fireEvent.press(screen.getByLabelText(new Date(2026, 9, 27).toDateString()));
    expect(screen.getByTestId('event-day').props.children).toBe(formatDateString('2026-10-27'));
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({ p_day: '2026-10-27' });
  });

  it('starts on the day and team it was opened for', async () => {
    await openForm('admin', { teams: [TEAM, TEAM_B] }, `?day=2026-10-22&team=${TEAM_B.id}`);
    expect(screen.getByTestId('event-day').props.children).toBe(formatDateString('2026-10-22'));
    expect(isSelected('17 & Under A')).toBe(true);
  });

  it('says what the squad or team already has on that day', async () => {
    await openForm('coach', { rows: [row({ can_manage: true })] }, '?day=2026-10-20');
    expect(screen.getByText('Already on that day: Tuesday training.')).toBeTruthy();
  });

  it('repeats weekly, for 8 weeks unless changed, and says how many events it adds', async () => {
    await openForm('coach');
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Every week'));
    expect(screen.getByText(`8 weeks, until ${formatDateString('2026-12-06')}`)).toBeTruthy();
    expect(screen.getByText('Add 8 events')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('One week more'));
    expect(screen.getByText('Add 9 events')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('One week fewer'));
    await fireEvent.press(screen.getByText('12 weeks'));
    expect(screen.getByText(`12 weeks, until ${formatDateString('2027-01-03')}`)).toBeTruthy();
    await fireEvent.press(screen.getByText('Add 12 events'));
    await settle();
    expect(saved()).toMatchObject({ p_day: '2026-10-18', p_repeat_until: '2027-01-03' });
  });

  it('going back to just this once sends no repeat', async () => {
    await openForm('coach');
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Every week'));
    await fireEvent.press(screen.getByText('Just this once'));
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({ p_repeat_until: null });
  });

  it('an all-day event needs no times, and can run for several days', async () => {
    await openForm('coach');
    await fireEvent(screen.getByLabelText('All day'), 'valueChange', true);
    expect(screen.queryByText('Starts')).toBeNull();
    expect(screen.getByText('One day')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('One day more'));
    await fireEvent.press(screen.getByLabelText('One day more'));
    expect(screen.getByText(`3 days, until ${formatDateString('2026-10-20')}`)).toBeTruthy();
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({ p_all_day: true, p_start: null, p_end: null, p_day: '2026-10-18', p_end_day: '2026-10-20' });
  });

  it('a longer event keeps its length when its first day moves', async () => {
    await openForm('coach');
    await fireEvent(screen.getByLabelText('All day'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('One day more'));
    await fireEvent.press(screen.getByLabelText('Next week'));
    await fireEvent.press(screen.getByLabelText(new Date(2026, 9, 23).toDateString()));
    expect(screen.getByText(`2 days, until ${formatDateString('2026-10-24')}`)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('One day fewer'));
    expect(screen.getByText('One day')).toBeTruthy();
  });

  it('keeps who sees it and the note folded away, with a line saying what’s set', async () => {
    await openForm('coach');
    expect(screen.getByText('Whole team · no note')).toBeTruthy();
    expect(screen.queryByText('Coaches and managers only')).toBeNull();
    await fireEvent.press(screen.getByText('Who sees it, and a note'));
    await fireEvent.press(screen.getByText('Coaches and managers only'));
    expect(screen.getByText('Only this team’s coaches and managers, and admins, see it.')).toBeTruthy();
    await type('Note (optional)', 'Selection chat');
    expect(screen.getByText('Coaches and managers only · with a note')).toBeTruthy();
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({ p_staff_only: true, p_note: 'Selection chat' });
  });

  it('fills in the times and place of the team’s last training, and says so', async () => {
    await openForm('coach', { rows: [row({ can_manage: true })] });
    expect(field('Name').props.value).toBe('Tuesday training');
    expect(field('Starts').props.value).toBe('6:00 pm');
    expect(field('Finishes').props.value).toBe('7:30 pm');
    expect(field('Where').props.value).toBe('Court 1');
    expect(screen.getByText('Filled in from this team’s last training. Change anything that’s different.')).toBeTruthy();
    // Another kind has nothing to copy, so only the name changes.
    await fireEvent.press(screen.getByText('Meeting'));
    expect(field('Name').props.value).toBe('Team meeting');
    expect(screen.queryByText(/Filled in from/)).toBeNull();
  });

  it('offers places the team has used, one tap to fill in', async () => {
    await openForm('coach', { rows: [row({ can_manage: true, kind: 'game', location: 'State Netball Centre' })] });
    expect(field('Where').props.value).toBe('');
    await fireEvent.press(screen.getByText('State Netball Centre'));
    expect(field('Where').props.value).toBe('State Netball Centre');
    // The place now in the box isn't offered again.
    expect(screen.queryAllByText('State Netball Centre')).toHaveLength(0);
  });

  it('an admin picks which squad or team it’s for', async () => {
    await openForm('admin', { teams: [TEAM, TEAM_B] });
    expect(screen.queryByText(/^For Open A$/)).toBeNull();
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    expect(screen.getByText('Choose the squad or team it’s for.')).toBeTruthy();
    await fireEvent.press(screen.getByText('17 & Under A'));
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({ p_team_id: TEAM_B.id });
  });

  it('a manager adds one for their team too', async () => {
    await openForm('manager');
    expect(screen.getByText('For Open A')).toBeTruthy();
  });

  it.each(['athlete', 'guardian', 'physio', 'committee'] as const)(
    'tells a %s who adds events instead of showing the form',
    async (who) => {
      await openForm(who);
      expect(screen.getByText(/Events are added by the coaches and managers of a squad or team/)).toBeTruthy();
      expect(screen.queryByText('Add to the calendar')).toBeNull();
    },
  );

  it('says why when the database refuses, and keeps the form', async () => {
    await openForm('coach', { options: { rpcErrors: { save_team_event: 'Choose a day within 12 months of today' } } });
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(screen.getByText('Choose a day within 12 months of today.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
    expect(field('Starts').props.value).toBe('6pm');
  });
});

// ---------------------------------------------------------------------------
describe('changing an event', () => {
  const weekly = row({ can_manage: true, series_id: 's1', staff_only: true });

  it('opens with the event as it is, on the club’s own day and times', async () => {
    await openForm('coach', { rows: [weekly] }, '?id=team-event%3Ae1');
    expect(screen.getByText('For Open A')).toBeTruthy();
    expect(field('Name').props.value).toBe('Tuesday training');
    expect(screen.getByTestId('event-day').props.children).toBe(formatDateString('2026-10-20'));
    expect(field('Starts').props.value).toBe('6:00 pm');
    expect(field('Finishes').props.value).toBe('7:30 pm');
    expect(field('Where').props.value).toBe('Court 1');
    expect(screen.getByText('Coaches and managers only · with a note')).toBeTruthy();
    // A change is to this one event: no repeat is offered.
    expect(screen.queryByText('Every week')).toBeNull();
    expect(screen.getByText('This changes this one only. The other weeks stay as they are.')).toBeTruthy();
  });

  it('saves the change to that event alone', async () => {
    await openForm('coach', { rows: [weekly] }, '?id=team-event%3Ae1');
    await type('Starts', '5pm');
    await type('Finishes', '6pm');
    await fireEvent.press(screen.getByText('Save changes'));
    await settle();
    expect(saved()).toMatchObject({
      p_id: 'e1',
      p_title: 'Tuesday training',
      p_day: '2026-10-20',
      p_start: '17:00',
      p_end: '18:00',
      p_staff_only: true,
      p_note: 'Bring bibs',
      p_repeat_until: null,
    });
    expect(back).toHaveBeenCalled();
  });

  it('changing the kind keeps the name the event already has', async () => {
    await openForm('coach', { rows: [row({ can_manage: true })] }, '?id=team-event%3Ae1');
    await fireEvent.press(screen.getByText('Game'));
    expect(field('Name').props.value).toBe('Tuesday training');
    expect(field('Starts').props.value).toBe('6:00 pm');
  });

  it('opens an all-day event over several days as it is', async () => {
    await openForm('coach', { rows: [row({ can_manage: true, all_day: true, day: '2026-10-23', end_day: '2026-10-25' })] }, '?id=team-event%3Ae1');
    expect(screen.getByText(`3 days, until ${formatDateString('2026-10-25')}`)).toBeTruthy();
    expect(screen.queryByText('Starts')).toBeNull();
  });

  it('someone who can’t change it is told who can', async () => {
    await openForm('coach', { rows: [row({ can_manage: false })] }, '?id=team-event%3Ae1');
    expect(screen.getByText('Only this squad’s or team’s coaches and managers can change its events.')).toBeTruthy();
    expect(screen.queryByText('Save changes')).toBeNull();
  });

  it('an event that has gone says so', async () => {
    await openForm('coach', { rows: [] }, '?id=team-event%3Agone');
    expect(screen.getByText('This event is no longer on the calendar.')).toBeTruthy();
  });
});
