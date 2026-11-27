/**
 * Squad and team events added in the app (src/lib/team-events.ts): how a
 * row shows on the calendar, what the form sends, and what it fills in from
 * last time.
 */
import type { CalendarEvent } from '@/lib/calendar';
import {
  eventGroups,
  eventKindLabels,
  eventKinds,
  eventKindTitles,
  isEventKind,
  lastEventLike,
  manageErrorMessage,
  placeSuggestions,
  repeatUntil,
  saveEventArgs,
  shiftDay,
  startedFrom,
  teamEventId,
  timeAfter,
  toCalendarEvent,
  type EventForm,
  type TeamEventRow,
} from '@/lib/team-events';
import type { Team } from '@/lib/types';

const row = (changes: Partial<TeamEventRow> = {}): TeamEventRow => ({
  id: 'e1',
  team_id: 'team-a',
  team_name: 'Open A',
  team_kind: 'team',
  kind: 'training',
  title: 'Training',
  starts_at: '2026-12-01T10:00:00Z',
  ends_at: '2026-12-01T11:30:00Z',
  all_day: false,
  day: '2026-12-01',
  end_day: '2026-12-01',
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

const form = (changes: Partial<EventForm> = {}): EventForm => ({
  teamId: 'team-a',
  kind: 'training',
  title: 'Training',
  day: '2026-12-01',
  allDay: false,
  endDay: null,
  startText: '6pm',
  endText: '7:30 pm',
  location: ' Court 1 ',
  note: '',
  staffOnly: false,
  repeatWeeks: 0,
  ...changes,
});

const team = (id: string, kind: 'squad' | 'team' = 'team'): Team => ({
  id,
  name: id,
  sort_order: 0,
  kind,
  season: 2026,
  squad_id: null,
  selections_completed_at: null,
});

describe('the kinds of event', () => {
  it('each has a label, and all but Other a name to start with', () => {
    for (const kind of eventKinds) {
      expect(eventKindLabels[kind]).toBeTruthy();
      expect(!!eventKindTitles[kind]).toBe(kind !== 'other');
    }
  });

  it('knows its own kinds only', () => {
    expect(isEventKind('game')).toBe(true);
    expect(isEventKind('party')).toBe(false);
    expect(isEventKind(null)).toBe(false);
    expect(isEventKind(undefined)).toBe(false);
  });
});

describe('toCalendarEvent', () => {
  it('shows a timed event at its moment, under its squad’s or team’s name and colour', () => {
    const event = toCalendarEvent(row(), '#123456');
    expect(event).toMatchObject({
      id: 'team-event:e1',
      title: 'Training',
      allDay: false,
      location: 'Court 1',
      description: 'Bring bibs',
      calendarId: 'team:team-a',
      calendarName: 'Open A',
      clubWide: false,
      color: '#123456',
      teamIds: ['team-a'],
      cancelled: false,
    });
    expect(event.start.toISOString()).toBe('2026-12-01T10:00:00.000Z');
    expect(event.end.toISOString()).toBe('2026-12-01T11:30:00.000Z');
    expect(teamEventId('e1')).toBe(event.id);
  });

  it('keeps the club’s own day and times, and who may change it, for the form', () => {
    const event = toCalendarEvent(row({ can_manage: true, series_id: 's1', staff_only: true }), '#fff');
    expect(event.teamEvent).toEqual({
      id: 'e1',
      teamId: 'team-a',
      kind: 'training',
      day: '2026-12-01',
      endDay: '2026-12-01',
      startTime: '18:00',
      endTime: '19:30',
      staffOnly: true,
      seriesId: 's1',
      cancelledByName: null,
      createdByName: 'Casey Coach',
      canManage: true,
    });
  });

  it('builds an all-day event from the club’s days, not the moments, so no zone can shift it', () => {
    const event = toCalendarEvent(
      row({ all_day: true, day: '2026-12-05', end_day: '2026-12-07', starts_at: '2026-12-04T16:00:00Z', ends_at: '2026-12-07T16:00:00Z' }),
      '#fff',
    );
    expect(event.allDay).toBe(true);
    expect([event.start.getFullYear(), event.start.getMonth(), event.start.getDate(), event.start.getHours()]).toEqual([2026, 11, 5, 0]);
    // The midnight after its last day.
    expect([event.end.getMonth(), event.end.getDate(), event.end.getHours()]).toEqual([11, 8, 0]);
  });

  it('marks a cancelled event, with who cancelled it', () => {
    const event = toCalendarEvent(row({ cancelled_at: '2026-11-30T01:00:00Z', cancelled_by_name: 'Emery Manager' }), '#fff');
    expect(event.cancelled).toBe(true);
    expect(event.teamEvent?.cancelledByName).toBe('Emery Manager');
  });
});

describe('eventGroups', () => {
  const teams = [team('a'), team('b'), team('c')];
  const memberships = [
    { team: { id: 'a' }, team_role: 'coach' },
    { team: { id: 'b' }, team_role: 'manager' },
    { team: { id: 'c' }, team_role: 'athlete' },
  ];

  it('is the squads and teams a member coaches or manages', () => {
    expect(eventGroups(teams, memberships, false).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('is none for an athlete, a parent or a physio', () => {
    for (const team_role of ['athlete', 'guardian', 'physio']) {
      expect(eventGroups(teams, [{ team: { id: 'a' }, team_role }], false)).toEqual([]);
    }
  });

  it('is every current squad and team for an admin', () => {
    expect(eventGroups(teams, [], true)).toEqual(teams);
  });

  it('leaves out a squad from an earlier season the member still coaches', () => {
    expect(eventGroups([team('a')], [{ team: { id: 'old' }, team_role: 'coach' }], false)).toEqual([]);
  });
});

describe('times and days', () => {
  it('works out a finish time from a start and a length', () => {
    expect(timeAfter('18:00', 90)).toBe('19:30');
    expect(timeAfter('09:05', 60)).toBe('10:05');
    expect(timeAfter('22:00', 119)).toBe('23:59');
  });

  it('offers no finish time that passes midnight', () => {
    expect(timeAfter('22:00', 120)).toBeNull();
    expect(timeAfter('23:30', 60)).toBeNull();
  });

  it('moves a day on, across a month and a year', () => {
    expect(shiftDay('2026-12-01', 7)).toBe('2026-12-08');
    expect(shiftDay('2026-12-29', 7)).toBe('2027-01-05');
    expect(shiftDay('2026-12-01', -1)).toBe('2026-11-30');
  });

  it('a weekly event for 8 weeks ends 7 weeks after it starts', () => {
    expect(repeatUntil('2026-12-01', 8)).toBe('2027-01-19');
    expect(repeatUntil('2026-12-01', 2)).toBe('2026-12-08');
  });
});

describe('saveEventArgs', () => {
  const args = (f: EventForm, id: string | null = null) => {
    const result = saveEventArgs(f, id);
    if ('error' in result) throw new Error(result.error);
    return result.args;
  };
  const error = (f: EventForm, id: string | null = null) => {
    const result = saveEventArgs(f, id);
    return 'error' in result ? result.error : null;
  };

  it('sends a new timed event with typed times read as clock times', () => {
    expect(args(form())).toEqual({
      p_id: null,
      p_team_id: 'team-a',
      p_kind: 'training',
      p_title: 'Training',
      p_day: '2026-12-01',
      p_end_day: null,
      p_all_day: false,
      p_start: '18:00',
      p_end: '19:30',
      p_location: 'Court 1',
      p_note: null,
      p_staff_only: false,
      p_repeat_until: null,
    });
  });

  it('sends no finish time when none was given', () => {
    expect(args(form({ endText: ' ' })).p_end).toBeNull();
  });

  it('sends an all-day event without times, and its last day only when it runs longer', () => {
    expect(args(form({ allDay: true, endDay: null }))).toMatchObject({ p_all_day: true, p_start: null, p_end: null, p_end_day: null });
    expect(args(form({ allDay: true, endDay: '2026-12-01' })).p_end_day).toBeNull();
    expect(args(form({ allDay: true, endDay: '2026-12-03' })).p_end_day).toBe('2026-12-03');
  });

  it('ignores a last day left over on a timed event', () => {
    expect(args(form({ endDay: '2026-12-03' })).p_end_day).toBeNull();
  });

  it('sends the last day of a weekly repeat', () => {
    expect(args(form({ repeatWeeks: 8 })).p_repeat_until).toBe('2027-01-19');
    expect(args(form({ repeatWeeks: 0 })).p_repeat_until).toBeNull();
    expect(args(form({ repeatWeeks: 1 })).p_repeat_until).toBeNull();
  });

  it('never repeats an event being changed', () => {
    expect(args(form({ repeatWeeks: 8 }), 'e1')).toMatchObject({ p_id: 'e1', p_repeat_until: null });
  });

  it('sends who sees it and the note', () => {
    expect(args(form({ staffOnly: true, note: ' Bring bibs ' }))).toMatchObject({ p_staff_only: true, p_note: 'Bring bibs' });
  });

  it('asks for a squad or team on a new event, but not on one being changed', () => {
    expect(error(form({ teamId: null }))).toBe('Choose the squad or team it’s for.');
    expect(error(form({ teamId: null }), 'e1')).toBeNull();
  });

  it('asks for a name', () => {
    expect(error(form({ title: '  ' }))).toBe('Give the event a name.');
  });

  it('asks for a start time unless it’s all day', () => {
    expect(error(form({ startText: '' }))).toBe('Give a start time, or make it all day.');
    expect(error(form({ startText: '', allDay: true }))).toBeNull();
  });

  it('asks for times it can read', () => {
    expect(error(form({ startText: 'evening' }))).toBe('Write times like 6:00 pm or 18:00.');
    expect(error(form({ endText: 'late' }))).toBe('Write times like 6:00 pm or 18:00.');
  });

  it('asks for a finish after the start', () => {
    expect(error(form({ startText: '6pm', endText: '5pm' }))).toBe('The finish time must be after the start.');
    expect(error(form({ startText: '6pm', endText: '6pm' }))).toBe('The finish time must be after the start.');
  });

  it('asks for a last day on or after the first, and at most 14 days in all', () => {
    expect(error(form({ allDay: true, endDay: '2026-11-30' }))).toBe('The last day must be on or after the first.');
    expect(error(form({ allDay: true, endDay: '2026-12-14' }))).toBeNull();
    expect(error(form({ allDay: true, endDay: '2026-12-15' }))).toBe('An event can run for up to 14 days.');
  });
});

describe('starting from last time', () => {
  const past = (changes: Partial<TeamEventRow>) => toCalendarEvent(row(changes), '#fff');
  const events: CalendarEvent[] = [
    past({ id: 'old', starts_at: '2026-11-10T10:00:00Z', start_time: '17:00', end_time: '18:00', location: 'Old hall' }),
    past({ id: 'new', starts_at: '2026-11-24T10:00:00Z', start_time: '18:00', end_time: '19:30', location: 'Court 1', title: 'Squad training' }),
    past({ id: 'off', starts_at: '2026-11-27T10:00:00Z', start_time: '06:00', end_time: '07:00', cancelled_at: '2026-11-26T00:00:00Z' }),
    past({ id: 'game', kind: 'game', starts_at: '2026-11-28T02:00:00Z', start_time: '10:00', end_time: '11:00', location: 'Away' }),
    past({ id: 'other-team', team_id: 'team-b', starts_at: '2026-11-29T10:00:00Z', start_time: '20:00', end_time: '21:00' }),
  ];
  const blank = form({ teamId: null, title: '', startText: '', endText: '', location: '' });
  const untouched = { title: false, times: false, place: false };

  it('finds the squad’s or team’s latest event of the kind, leaving out cancelled ones and other teams', () => {
    expect(lastEventLike(events, 'team-a', 'training')?.id).toBe('team-event:new');
    expect(lastEventLike(events, 'team-a', 'game')?.id).toBe('team-event:game');
    expect(lastEventLike(events, 'team-a', 'social')).toBeNull();
    expect(lastEventLike(events, 'team-c', 'training')).toBeNull();
  });

  it('fills in the name, times and place from last time', () => {
    const { form: next, filledFrom } = startedFrom(blank, events, 'team-a', 'training', untouched);
    expect(next).toMatchObject({ teamId: 'team-a', kind: 'training', title: 'Squad training', startText: '6:00 pm', endText: '7:30 pm', location: 'Court 1' });
    expect(filledFrom).toBe('training');
  });

  it('follows the kind picked', () => {
    const { form: next } = startedFrom(blank, events, 'team-a', 'game', untouched);
    expect(next).toMatchObject({ kind: 'game', startText: '10:00 am', endText: '11:00 am', location: 'Away' });
  });

  it('with nothing like it before, gives the kind’s usual name and leaves the rest', () => {
    const { form: next, filledFrom } = startedFrom(blank, events, 'team-a', 'meeting', untouched);
    expect(next).toMatchObject({ kind: 'meeting', title: 'Team meeting', startText: '', location: '' });
    expect(filledFrom).toBeNull();
  });

  it('leaves alone whatever the member typed themselves', () => {
    const mine = { ...blank, title: 'Beach session', startText: '7am', endText: '', location: 'City Beach' };
    const { form: next, filledFrom } = startedFrom(mine, events, 'team-a', 'training', { title: true, times: true, place: true });
    expect(next).toMatchObject({ title: 'Beach session', startText: '7am', endText: '', location: 'City Beach' });
    expect(filledFrom).toBeNull();
  });

  it('fills in only the place when the times were typed', () => {
    const { form: next, filledFrom } = startedFrom({ ...blank, startText: '7am' }, events, 'team-a', 'training', { title: false, times: true, place: false });
    expect(next).toMatchObject({ startText: '7am', location: 'Court 1' });
    expect(filledFrom).toBe('training');
  });

  it('doesn’t copy times from an all-day event', () => {
    const allDay = [past({ all_day: true, location: null })];
    const { form: next, filledFrom } = startedFrom(blank, allDay, 'team-a', 'training', untouched);
    expect(next.startText).toBe('');
    expect(filledFrom).toBeNull();
  });

  it('with no squad or team picked yet, only names it', () => {
    const { form: next } = startedFrom(blank, events, null, 'training', untouched);
    expect(next).toMatchObject({ teamId: null, title: 'Training', startText: '' });
  });
});

describe('placeSuggestions', () => {
  const at = (id: string, location: string | null, teamIds: string[] = ['team-a']): CalendarEvent => ({
    ...toCalendarEvent(row({ id, location }), '#fff'),
    teamIds,
  });

  it('offers the squad’s or team’s most used places first, then the club’s', () => {
    const events = [
      at('1', 'Court 1'),
      at('2', 'Court 1'),
      at('3', 'Gym'),
      at('4', 'Clubrooms', []),
      at('5', 'Clubrooms', []),
      at('6', 'Clubrooms', []),
    ];
    expect(placeSuggestions(events, 'team-a')).toEqual(['Court 1', 'Gym', 'Clubrooms']);
  });

  it('offers each place once, up to the limit, and skips events with no place', () => {
    const events = [at('1', 'A'), at('2', ' A '), at('3', 'B'), at('4', 'C'), at('5', 'D'), at('6', null)];
    expect(placeSuggestions(events, 'team-a')).toEqual(['A', 'B', 'C']);
    expect(placeSuggestions(events, 'team-a', 2)).toEqual(['A', 'B']);
  });

  it('offers the club’s places before a squad or team is picked', () => {
    expect(placeSuggestions([at('1', 'Court 1'), at('2', 'Gym', [])], null)).toEqual(['Court 1', 'Gym']);
  });
});

describe('manageErrorMessage', () => {
  it('gives the database’s reason as a sentence', () => {
    expect(manageErrorMessage('An event that has started can’t be removed. Cancel it instead')).toBe(
      'An event that has started can’t be removed. Cancel it instead.',
    );
    expect(manageErrorMessage('Give the event a name.')).toBe('Give the event a name.');
  });

  it('says something plain when there is none', () => {
    expect(manageErrorMessage(undefined)).toBe('That didn’t save. Try again.');
    expect(manageErrorMessage('  ')).toBe('That didn’t save. Try again.');
  });
});
