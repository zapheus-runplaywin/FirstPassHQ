/**
 * Calendars kept in the app: admins add their events, and coaches, managers
 * and committee members suggest one for an admin to answer. The Add button on
 * the calendar, the form (src/app/event/edit.tsx), the event's page
 * (src/components/team-event-manage.tsx) and the admin's list of suggestions
 * (src/app/admin/event-suggestions.tsx). From "Calendars kept in the app" in
 * sections 6 and 10 of docs/user-guide.md.
 *
 * The database decides who may add, suggest, answer and see
 * (supabase/tests/hq-calendars.sql). These check what each kind of member is
 * offered, what each button sends, and what a suggestion looks like while it
 * waits and once it's declined.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import CalendarScreen from '@/app/(tabs)/calendar';
import EventSuggestionsScreen from '@/app/admin/event-suggestions';
import EventScreen from '@/app/event/[id]';
import EditEventScreen from '@/app/event/edit';
import type { HqCalendarChoice, HqEventRow } from '@/lib/team-events';
import { refreshEvents } from '@/lib/use-events';

import { argsOf, clearCalls, field, isSelected, rpcNames, type } from './helpers/forms';
import {
  openScreen,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
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

jest.setTimeout(30000);

/** The club's calendar, kept in the app and shown to everyone. */
const CLUB_CAL = {
  id: 'cal-1',
  name: 'Club calendar',
  url: null,
  in_hq: true,
  color: 'green',
  team: null,
  calendar_audiences: [{ kind: 'everyone', role: null, post: null, team_id: null, team: null }],
};

/** What `hq_calendars_to_add_to` answers for an admin, and for someone who suggests. */
const ADDS: HqCalendarChoice = { id: 'cal-1', name: 'Club calendar', color: 'green', everyone: true, suggest: false };
const SUGGESTS: HqCalendarChoice = { ...ADDS, suggest: true };

/** An event on the club's calendar, five days from today (TODAY is Sunday 18 October 2026). */
const row = (changes: Partial<HqEventRow> = {}): HqEventRow => ({
  id: 'h1',
  calendar_id: 'cal-1',
  calendar_name: 'Club calendar',
  kind: 'social',
  title: 'Trivia night',
  starts_at: '2026-10-23T10:00:00Z',
  ends_at: '2026-10-23T13:00:00Z',
  all_day: false,
  day: '2026-10-23',
  end_day: '2026-10-23',
  start_time: '18:00',
  end_time: '21:00',
  location: 'Clubrooms',
  note: 'Bring a plate',
  series_id: null,
  status: 'on',
  cancelled_at: null,
  cancelled_by_name: null,
  created_by_name: 'Alex Admin',
  decided_by_name: null,
  decline_reason: null,
  mine: false,
  can_manage: false,
  ...changes,
});

/** A suggestion as the admin gets it, and as the coach who made it gets it. */
const forAdmin = (changes: Partial<HqEventRow> = {}) =>
  row({ status: 'suggested', created_by_name: 'Casey Coach', can_manage: true, ...changes });
const own = (changes: Partial<HqEventRow> = {}) =>
  row({ status: 'suggested', created_by_name: 'Casey Coach', can_manage: true, mine: true, ...changes });

let push: jest.SpyInstance;
let back: jest.SpyInstance;
let fetchMock: jest.Mock;

beforeEach(() => {
  resetClub();
  clearCalls();
  refreshEvents('hq-event:h1');
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
  fetchMock = jest.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  push.mockRestore();
  back.mockRestore();
});

type Setup = { rows?: HqEventRow[]; choices?: HqCalendarChoice[]; options?: BackendOptions };

function backend({ rows = [row()], choices = [], options = {} }: Setup) {
  return {
    tables: { calendars: [CLUB_CAL], fixtures: [], teams: [TEAM] },
    options: {
      ...options,
      rpcs: { hq_events_between: rows, hq_calendars_to_add_to: choices, team_events_between: [], ...options.rpcs },
    },
  };
}

async function openCalendar(who: PersonaName, setup: Setup = {}) {
  const { tables, options } = backend(setup);
  await openScreen(who, { calendar: CalendarScreen }, '/calendar', tables, options);
  await settle();
}

async function openEvent(who: PersonaName, setup: Setup = {}) {
  const { tables, options } = backend(setup);
  await openScreen(who, { 'event/[id]': EventScreen }, `/event/${encodeURIComponent('hq-event:h1')}`, tables, options);
  await settle();
}

async function openForm(who: PersonaName, setup: Setup = {}, query = '') {
  const { tables, options } = backend({ rows: [], ...setup });
  await openScreen(who, { 'event/edit': EditEventScreen }, `/event/edit${query}`, tables, options);
  await settle();
}

async function openSuggestions(setup: Setup = {}) {
  const { tables, options } = backend(setup);
  await openScreen('admin', { 'admin/event-suggestions': EventSuggestionsScreen }, '/admin/event-suggestions', tables, options);
  await settle();
}

const saved = () => argsOf('save_hq_event')[0];

// ---------------------------------------------------------------------------
describe('a calendar kept in the app, on the calendar', () => {
  it('shows its events to a member, with no link read', async () => {
    await openCalendar('athlete');
    expect(screen.getByText('Trivia night')).toBeTruthy();
    expect(rpcNames()).toContain('hq_events_between');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['athlete', 'guardian', 'physio'] as const)('offers a %s nothing to add', async (who) => {
    await openCalendar(who);
    expect(screen.queryByText('Add an event')).toBeNull();
    expect(screen.queryByText('Suggest an event')).toBeNull();
  });

  it('an admin adds an event', async () => {
    await openCalendar('admin', { choices: [ADDS] });
    await fireEvent.press(screen.getByText('Add an event'));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/event/edit' }));
  });

  it.each(['coach', 'manager', 'committee'] as const)(
    'a %s with no squad or team events to add suggests one instead',
    async (who) => {
      await openCalendar(who, { choices: [SUGGESTS] });
      expect(screen.queryByText('Add an event')).toBeNull();
      await fireEvent.press(screen.getByText('Suggest an event'));
      expect(push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/event/edit' }));
    },
  );

  it('a coach who also adds their team’s events keeps Add an event', async () => {
    setClubFeatures({ teamEvents: true });
    await openCalendar('coach', { choices: [SUGGESTS] });
    expect(screen.getByText('Add an event')).toBeTruthy();
    expect(screen.queryByText('Suggest an event')).toBeNull();
  });

  it('offers nothing where the admin takes no suggestions', async () => {
    await openCalendar('committee', { choices: [] });
    expect(screen.queryByText('Suggest an event')).toBeNull();
  });

  it('marks the member’s own suggestion while it waits', async () => {
    await openCalendar('coach', { rows: [own()], choices: [SUGGESTS] });
    expect(screen.getByLabelText(/^Trivia night, Suggested · /)).toBeTruthy();
  });

  it('marks one that wasn’t added', async () => {
    await openCalendar('coach', { rows: [own({ status: 'declined' })], choices: [SUGGESTS] });
    expect(screen.getByLabelText(/^Trivia night, Not added · /)).toBeTruthy();
  });

  it('tells an admin how many suggestions wait, and opens the list', async () => {
    await openCalendar('admin', {
      rows: [forAdmin(), forAdmin({ id: 'h2', title: 'Working bee' }), row({ id: 'h3', title: 'AGM' })],
      choices: [ADDS],
    });
    await fireEvent.press(screen.getByText('2 suggested events to answer'));
    expect(push).toHaveBeenCalledWith('/admin/event-suggestions');
  });

  it('says nothing of suggestions when none wait, or to anyone but an admin', async () => {
    await openCalendar('admin', { choices: [ADDS] });
    expect(screen.queryByText(/to answer$/)).toBeNull();
  });

  it('a declined suggestion leaves the admin’s calendar', async () => {
    await openCalendar('admin', { rows: [row({ status: 'declined', created_by_name: 'Casey Coach' })], choices: [ADDS] });
    expect(screen.queryByText('Trivia night')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('adding to a calendar kept in the app', () => {
  it('an admin adds an event straight onto the calendar', async () => {
    await openForm('admin', { choices: [ADDS] });
    expect(screen.getByText('For Club calendar')).toBeTruthy();
    expect(screen.queryByTestId('suggest-note')).toBeNull();
    // A club calendar's audience is the calendar's: no "coaches and managers only".
    expect(screen.queryByText('Who sees it, and a note')).toBeNull();
    expect(screen.getByText('A note')).toBeTruthy();
    await type('Name', 'Trivia night');
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({
      p_id: null,
      p_calendar_id: 'cal-1',
      p_title: 'Trivia night',
      p_all_day: false,
      p_start: '18:00',
      p_repeat_until: null,
    });
    expect(argsOf('save_team_event')).toHaveLength(0);
    expect(back).toHaveBeenCalled();
  });

  it('an admin picks between a squad or team and the calendar', async () => {
    setClubFeatures({ teamEvents: true });
    await openForm('admin', { choices: [ADDS] });
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    expect(screen.getByText('Choose what it’s for.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Club calendar'));
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({ p_calendar_id: 'cal-1' });
  });

  it('opens on the calendar the member was looking at', async () => {
    setClubFeatures({ teamEvents: true });
    await openForm('admin', { choices: [ADDS] }, '?calendar=cal-1');
    await type('Name', 'Trivia night');
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({ p_calendar_id: 'cal-1' });
  });

  it('starts on Other with no name, since a club’s events are rarely training', async () => {
    await openForm('admin', { choices: [ADDS] });
    expect(isSelected('Other')).toBe(true);
    expect(field('Name').props.value).toBe('');
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Add to the calendar'));
    expect(argsOf('save_hq_event')).toHaveLength(0);
  });

  it('fills in from the calendar’s last event of the kind picked', async () => {
    await openForm('admin', { rows: [row({ title: 'Quiz night', location: 'Court 3' })], choices: [ADDS] });
    await fireEvent.press(screen.getByText('Social'));
    expect(field('Name').props.value).toBe('Quiz night');
    expect(field('Where').props.value).toBe('Court 3');
    expect(field('Starts').props.value).toBe('6:00 pm');
  });
});

describe('suggesting an event', () => {
  it.each(['coach', 'manager', 'committee'] as const)('a %s sends one to an admin, and is told what happens', async (who) => {
    await openForm(who, { choices: [SUGGESTS] });
    expect(screen.getByText('For Club calendar')).toBeTruthy();
    expect(screen.getByTestId('suggest-note').props.children).toMatch(
      /An admin checks it before it goes on the calendar. Until then only you and admins see it./,
    );
    expect(screen.queryByText('Add to the calendar')).toBeNull();
    await type('Name', 'Trivia night');
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Send to an admin'));
    await settle();
    expect(saved()).toMatchObject({ p_id: null, p_calendar_id: 'cal-1', p_title: 'Trivia night' });
    expect(back).toHaveBeenCalled();
  });

  it('a coach chooses between adding for their team and suggesting for the club', async () => {
    setClubFeatures({ teamEvents: true });
    await openForm('coach', { choices: [SUGGESTS] });
    expect(screen.queryByTestId('suggest-note')).toBeNull();
    await fireEvent.press(screen.getByText('Club calendar'));
    expect(screen.getByTestId('suggest-note')).toBeTruthy();
    expect(screen.getByText('Send to an admin')).toBeTruthy();
    await fireEvent.press(screen.getByText('Open A'));
    expect(screen.queryByTestId('suggest-note')).toBeNull();
    expect(screen.getByText('Add to the calendar')).toBeTruthy();
  });

  it('says how many weeks of a weekly one are sent', async () => {
    await openForm('committee', { choices: [SUGGESTS] });
    await type('Name', 'Committee meeting');
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Repeats'));
    await fireEvent.press(screen.getByText('Every week'));
    await fireEvent.press(screen.getByText('Send 8 events to an admin'));
    await settle();
    expect(saved()).toMatchObject({ p_repeat_until: expect.stringMatching(/^2026-1[12]-\d\d$/) });
  });

  it('says why when the database refuses, and keeps the form', async () => {
    await openForm('committee', {
      choices: [SUGGESTS],
      options: { rpcErrors: { save_hq_event: 'This calendar isn’t taking suggestions' } },
    });
    await type('Name', 'Trivia night');
    await type('Starts', '6pm');
    await fireEvent.press(screen.getByText('Send to an admin'));
    await settle();
    expect(screen.getByText('This calendar isn’t taking suggestions.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it.each(['athlete', 'guardian', 'physio'] as const)('a %s is told who adds events instead', async (who) => {
    await openForm(who);
    expect(screen.getByText(/There’s nothing you can add an event to/)).toBeTruthy();
    expect(screen.queryByText('Send to an admin')).toBeNull();
  });

  it('the person who suggested it changes it while it waits', async () => {
    await openForm('coach', { rows: [own()], choices: [SUGGESTS] }, `?id=${encodeURIComponent('hq-event:h1')}`);
    expect(field('Name').props.value).toBe('Trivia night');
    await type('Where', 'Town hall');
    await fireEvent.press(screen.getByText('Save changes'));
    await settle();
    expect(saved()).toMatchObject({ p_id: 'h1', p_location: 'Town hall', p_repeat_until: null });
  });

  it('an admin changing a suggestion is told saving adds it', async () => {
    await openForm('admin', { rows: [forAdmin()], choices: [ADDS] }, `?id=${encodeURIComponent('hq-event:h1')}`);
    await type('Where', 'Town hall');
    await fireEvent.press(screen.getByText('Save and add to the calendar'));
    await settle();
    expect(saved()).toMatchObject({ p_id: 'h1', p_location: 'Town hall' });
  });

  it('nobody else changes a calendar’s event', async () => {
    await openForm('coach', { rows: [row()], choices: [SUGGESTS] }, `?id=${encodeURIComponent('hq-event:h1')}`);
    expect(screen.getByText('Only admins can change this calendar’s events.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('a suggestion, as an admin answers it', () => {
  it('says who suggested it and that it isn’t on the calendar yet', async () => {
    await openEvent('admin', { rows: [forAdmin()] });
    expect(screen.getByText('Suggested by Casey Coach. Not on the calendar yet')).toBeTruthy();
    expect(screen.getByText('Add to the calendar')).toBeTruthy();
    expect(screen.getByText('Change it first')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
    // Nothing to cancel: it was never on.
    expect(screen.queryByText('Cancel event')).toBeNull();
  });

  it('adds it to the calendar in one tap, and stays on it', async () => {
    await openEvent('admin', { rows: [forAdmin()] });
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(argsOf('decide_event_suggestion')).toEqual([{ p_id: 'h1', p_accept: true, p_reason: null }]);
    expect(back).not.toHaveBeenCalled();
  });

  it('adds every week of a weekly one, and says what changing it first does', async () => {
    await openEvent('admin', { rows: [forAdmin({ series_id: 's1' })] });
    expect(screen.getByText(/Changing it first adds this week only/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Add every week to the calendar'));
    await settle();
    expect(argsOf('decide_event_suggestion')).toEqual([{ p_id: 'h1', p_accept: true, p_reason: null }]);
  });

  it('opens the form to change it first', async () => {
    await openEvent('admin', { rows: [forAdmin()] });
    await fireEvent.press(screen.getByText('Change it first'));
    expect(push).toHaveBeenCalledWith({ pathname: '/event/edit', params: { id: 'hq-event:h1' } });
  });

  it('declines only with a reason, which the person who suggested it sees', async () => {
    await openEvent('admin', { rows: [forAdmin()] });
    await fireEvent.press(screen.getByText('Decline'));
    expect(screen.getByText(/Casey Coach sees your reason. Nobody else sees the suggestion./)).toBeTruthy();
    await fireEvent.press(screen.getByText('Decline it'));
    expect(screen.getByText('Say why, so they know.')).toBeTruthy();
    expect(argsOf('decide_event_suggestion')).toHaveLength(0);
    await type('Why', 'The hall is booked that night');
    await fireEvent.press(screen.getByText('Decline it'));
    await settle();
    expect(argsOf('decide_event_suggestion')).toEqual([
      { p_id: 'h1', p_accept: false, p_reason: 'The hall is booked that night' },
    ]);
    expect(back).toHaveBeenCalled();
  });

  it('can be talked out of declining', async () => {
    await openEvent('admin', { rows: [forAdmin()] });
    await fireEvent.press(screen.getByText('Decline'));
    await fireEvent.press(screen.getByText('Go back'));
    expect(screen.getByText('Add to the calendar')).toBeTruthy();
    expect(argsOf('decide_event_suggestion')).toHaveLength(0);
  });

  it('says why when the database refuses', async () => {
    await openEvent('admin', {
      rows: [forAdmin()],
      options: { rpcErrors: { decide_event_suggestion: 'This suggestion was already answered' } },
    });
    await fireEvent.press(screen.getByText('Add to the calendar'));
    await settle();
    expect(screen.getByText('This suggestion was already answered.')).toBeTruthy();
  });
});

describe('a suggestion, as the person who made it sees it', () => {
  it('says it’s waiting, and offers to change it or take it back', async () => {
    await openEvent('coach', { rows: [own()] });
    expect(screen.getByText('Suggested by you. Waiting for an admin')).toBeTruthy();
    expect(screen.getByText('Change')).toBeTruthy();
    expect(screen.queryByText('Add to the calendar')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();
    await fireEvent.press(screen.getByText('Take it back'));
    expect(screen.getByText('Take this suggestion away?')).toBeTruthy();
    expect(screen.getByText('It was never on the calendar, so nobody else notices.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Take this one away'));
    await settle();
    expect(argsOf('remove_hq_event')).toEqual([{ p_id: 'h1', p_following: false }]);
    expect(back).toHaveBeenCalled();
  });

  it('takes back this and later weeks of a weekly one', async () => {
    await openEvent('committee', { rows: [own({ series_id: 's1' })] });
    await fireEvent.press(screen.getByText('Take it back'));
    await fireEvent.press(screen.getByText('Take away this and later weeks'));
    await settle();
    expect(argsOf('remove_hq_event')).toEqual([{ p_id: 'h1', p_following: true }]);
  });

  it('shows why one wasn’t added, and clears it away', async () => {
    await openEvent('coach', {
      rows: [
        own({
          status: 'declined',
          can_manage: false,
          decided_by_name: 'Alex Admin',
          decline_reason: 'The hall is booked that night',
        }),
      ],
    });
    expect(screen.getByText('Not added to the calendar by Alex Admin')).toBeTruthy();
    expect(screen.getByText('Why it wasn’t added')).toBeTruthy();
    expect(screen.getByText('The hall is booked that night')).toBeTruthy();
    // Declined is the end of it: there is no way to answer back, only to clear it.
    expect(screen.queryByText('Change')).toBeNull();
    await fireEvent.press(screen.getByText('Clear it away'));
    await fireEvent.press(screen.getByText('Take this one away'));
    await settle();
    expect(argsOf('remove_hq_event')).toEqual([{ p_id: 'h1', p_following: false }]);
  });
});

describe('an event on a calendar kept in the app', () => {
  it('a member reads it and is offered nothing', async () => {
    await openEvent('athlete');
    expect(screen.getByText('Trivia night')).toBeTruthy();
    expect(screen.getByText('Added by Alex Admin')).toBeTruthy();
    expect(screen.queryByTestId('event-manage')).toBeNull();
  });

  it('says who suggested one an admin accepted', async () => {
    await openEvent('athlete', { rows: [row({ created_by_name: 'Casey Coach', decided_by_name: 'Alex Admin' })] });
    expect(screen.getByText('Suggested by Casey Coach')).toBeTruthy();
  });

  it('an admin cancels it, after being asked', async () => {
    await openEvent('admin', { rows: [row({ can_manage: true })] });
    await fireEvent.press(screen.getByText('Cancel event'));
    expect(argsOf('cancel_hq_event')).toHaveLength(0);
    await fireEvent.press(screen.getByText('Cancel this one'));
    await settle();
    expect(argsOf('cancel_hq_event')).toEqual([{ p_id: 'h1', p_following: false }]);
    expect(argsOf('cancel_team_event')).toHaveLength(0);
  });

  it('an admin puts a cancelled one back on', async () => {
    await openEvent('admin', {
      rows: [row({ can_manage: true, cancelled_at: '2026-10-18T00:00:00Z', cancelled_by_name: 'Alex Admin' })],
    });
    await fireEvent.press(screen.getByText('Put it back on'));
    await settle();
    expect(argsOf('restore_hq_event')).toEqual([{ p_id: 'h1' }]);
  });

  it('an admin removes one added by mistake, this and later weeks', async () => {
    await openEvent('admin', { rows: [row({ can_manage: true, series_id: 's1' })] });
    await fireEvent.press(screen.getByText('Added by mistake? Remove it'));
    await fireEvent.press(screen.getByText('Remove this and later weeks'));
    await settle();
    expect(argsOf('remove_hq_event')).toEqual([{ p_id: 'h1', p_following: true }]);
    expect(back).toHaveBeenCalled();
  });

  it('an admin opens the form to change it', async () => {
    await openEvent('admin', { rows: [row({ can_manage: true })] });
    await fireEvent.press(screen.getByText('Change'));
    expect(push).toHaveBeenCalledWith({ pathname: '/event/edit', params: { id: 'hq-event:h1' } });
  });
});

// ---------------------------------------------------------------------------
describe('the admin’s list of suggested events', () => {
  it('lists each one waiting, soonest first, with who suggested it and for which calendar', async () => {
    await openSuggestions({
      rows: [
        forAdmin({ id: 'h2', title: 'Working bee', starts_at: '2026-10-30T01:00:00Z', ends_at: '2026-10-30T03:00:00Z', day: '2026-10-30', end_day: '2026-10-30', created_by_name: 'Morgan Manager' }),
        forAdmin(),
        row({ id: 'h3', title: 'AGM' }),
      ],
    });
    expect(screen.getByText(/Only you, the other admins and the person who suggested each one see these/)).toBeTruthy();
    expect(screen.getByText('Casey Coach · Club calendar')).toBeTruthy();
    expect(screen.getByText('Morgan Manager · Club calendar')).toBeTruthy();
    expect(screen.queryByText('AGM')).toBeNull();
    const titles = screen.getAllByText(/^(Trivia night|Working bee)$/).map((t) => t.props.children);
    expect(titles).toEqual(['Trivia night', 'Working bee']);
    await fireEvent.press(screen.getByText('Working bee'));
    expect(push).toHaveBeenCalledWith({ pathname: '/event/[id]', params: { id: 'hq-event:h2' } });
  });

  it('lists a weekly one once, with how many weeks', async () => {
    await openSuggestions({
      rows: [
        forAdmin({ series_id: 's1' }),
        forAdmin({ id: 'h2', series_id: 's1', starts_at: '2026-10-30T10:00:00Z', ends_at: '2026-10-30T13:00:00Z', day: '2026-10-30', end_day: '2026-10-30' }),
        forAdmin({ id: 'h3', series_id: 's1', starts_at: '2026-11-06T10:00:00Z', ends_at: '2026-11-06T13:00:00Z', day: '2026-11-06', end_day: '2026-11-06' }),
      ],
    });
    expect(screen.getAllByText('Trivia night')).toHaveLength(1);
    expect(screen.getByText(/ · weekly, 3 weeks$/)).toBeTruthy();
  });

  it('says so when none wait', async () => {
    await openSuggestions({ rows: [row()] });
    expect(screen.getByText(/^No suggested events are waiting\./)).toBeTruthy();
  });
});
