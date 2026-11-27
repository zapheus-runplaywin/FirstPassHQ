/**
 * Events on a calendar kept in the app, and suggestions for one
 * (src/lib/team-events.ts, src/lib/calendar-import.ts): how a row shows, what
 * the form sends, which suggestions wait for an admin, and what moving a
 * linked calendar in hands to the database. The database decides who may do
 * what (supabase/tests/hq-calendars.sql).
 */
import type { CalendarEvent } from '@/lib/calendar';
import { importEvents, MAX_IMPORT_EVENTS, readCalendarForImport } from '@/lib/calendar-import';
import {
  declinedSuggestions,
  hqEventId,
  hqToCalendarEvent,
  lastEventLike,
  placeSuggestions,
  saveEventArgs,
  startedFrom,
  toCalendarEvent,
  waitingSuggestions,
  type EventForm,
  type HqEventRow,
  type TeamEventRow,
} from '@/lib/team-events';

const LOOK = { color: '#2E7D32', clubWide: true, teamIds: [], forAthletes: false };

const row = (changes: Partial<HqEventRow> = {}): HqEventRow => ({
  id: 'h1',
  calendar_id: 'cal-1',
  calendar_name: 'Club calendar',
  kind: 'social',
  title: 'Trivia night',
  starts_at: '2026-12-04T10:00:00Z',
  ends_at: '2026-12-04T13:00:00Z',
  all_day: false,
  day: '2026-12-04',
  end_day: '2026-12-04',
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

const event = (changes: Partial<HqEventRow> = {}) => hqToCalendarEvent(row(changes), LOOK);

const form = (changes: Partial<EventForm> = {}): EventForm => ({
  teamId: null,
  calendarId: 'cal-1',
  kind: 'social',
  title: 'Trivia night',
  day: '2026-12-04',
  allDay: false,
  endDay: null,
  startText: '6pm',
  endText: '9pm',
  location: ' Clubrooms ',
  note: ' Bring a plate ',
  staffOnly: false,
  repeatWeeks: 0,
  ...changes,
});

describe('hqToCalendarEvent', () => {
  it('shows an event under its calendar’s name, colour and audience', () => {
    expect(event()).toMatchObject({
      id: 'hq-event:h1',
      title: 'Trivia night',
      allDay: false,
      location: 'Clubrooms',
      description: 'Bring a plate',
      calendarId: 'cal-1',
      calendarName: 'Club calendar',
      clubWide: true,
      color: '#2E7D32',
      teamIds: [],
      forAthletes: false,
      cancelled: false,
    });
    expect(event().start.toISOString()).toBe('2026-12-04T10:00:00.000Z');
    expect(event().end.toISOString()).toBe('2026-12-04T13:00:00.000Z');
    expect(hqEventId('h1')).toBe('hq-event:h1');
  });

  it('keeps the club’s day and times, the calendar, and who may change it, for the form', () => {
    expect(event({ can_manage: true, series_id: 's1', mine: true }).teamEvent).toEqual({
      id: 'h1',
      teamId: null,
      hqCalendarId: 'cal-1',
      kind: 'social',
      day: '2026-12-04',
      endDay: '2026-12-04',
      startTime: '18:00',
      endTime: '21:00',
      staffOnly: false,
      seriesId: 's1',
      cancelledByName: null,
      createdByName: 'Alex Admin',
      canManage: true,
      mine: true,
      decidedByName: null,
      declineReason: null,
    });
  });

  it('builds an all-day event from the club’s days, the last day included', () => {
    const camp = event({ all_day: true, day: '2026-12-05', end_day: '2026-12-06' });
    expect([camp.start.getFullYear(), camp.start.getMonth(), camp.start.getDate()]).toEqual([2026, 11, 5]);
    expect([camp.end.getMonth(), camp.end.getDate()]).toEqual([11, 7]);
  });

  it('marks a suggestion and a declined one, and nothing on an event that’s on the calendar', () => {
    expect(event().pending).toBeUndefined();
    expect('pending' in event()).toBe(false);
    expect(event({ status: 'suggested' }).pending).toBe('suggested');
    const declined = event({ status: 'declined', decline_reason: 'The hall is booked', decided_by_name: 'Alex Admin' });
    expect(declined.pending).toBe('declined');
    expect(declined.teamEvent).toMatchObject({ declineReason: 'The hall is booked', decidedByName: 'Alex Admin' });
  });

  it('marks a cancelled event, with who cancelled it', () => {
    const off = event({ cancelled_at: '2026-12-01T00:00:00Z', cancelled_by_name: 'Alex Admin' });
    expect(off.cancelled).toBe(true);
    expect(off.teamEvent?.cancelledByName).toBe('Alex Admin');
  });
});

describe('saveEventArgs for a calendar kept in the app', () => {
  const sent = (f: EventForm, id: string | null = null) => {
    const result = saveEventArgs(f, id);
    if ('error' in result) throw new Error(result.error);
    return result;
  };

  it('goes to save_hq_event with the calendar, and no squad, team or staff-only', () => {
    expect(sent(form())).toEqual({
      rpc: 'save_hq_event',
      args: {
        p_id: null,
        p_calendar_id: 'cal-1',
        p_kind: 'social',
        p_title: 'Trivia night',
        p_day: '2026-12-04',
        p_end_day: null,
        p_all_day: false,
        p_start: '18:00',
        p_end: '21:00',
        p_location: 'Clubrooms',
        p_note: 'Bring a plate',
        p_repeat_until: null,
      },
    });
  });

  it('a squad’s or team’s event still goes to save_team_event', () => {
    expect(sent(form({ calendarId: null, teamId: 'team-a' })).rpc).toBe('save_team_event');
    expect(sent(form({ calendarId: undefined, teamId: 'team-a' })).args).toMatchObject({ p_team_id: 'team-a' });
  });

  it('sends the last day of a weekly repeat, but never when changing one', () => {
    expect(sent(form({ repeatWeeks: 4 })).args.p_repeat_until).toBe('2026-12-25');
    expect(sent(form({ repeatWeeks: 4 }), 'h1').args.p_repeat_until).toBeNull();
  });

  it('asks what it’s for when neither a calendar nor a squad or team is picked', () => {
    expect(saveEventArgs(form({ calendarId: null }), null)).toEqual({ error: 'Choose what it’s for.' });
  });

  it('asks for the same things as any event', () => {
    expect(saveEventArgs(form({ title: ' ' }), null)).toHaveProperty('error');
    expect(saveEventArgs(form({ startText: '' }), null)).toHaveProperty('error');
    expect(saveEventArgs(form({ startText: '9pm', endText: '6pm' }), null)).toHaveProperty('error');
  });
});

describe('suggestions waiting for an admin', () => {
  const NOW = new Date('2026-12-01T00:00:00Z');
  const suggested = (changes: Partial<HqEventRow>) => event({ status: 'suggested', ...changes });

  it('lists the ones still to come, soonest first', () => {
    const list = waitingSuggestions(
      [
        suggested({ id: 'later', starts_at: '2026-12-20T10:00:00Z', ends_at: '2026-12-20T11:00:00Z' }),
        suggested({ id: 'sooner', starts_at: '2026-12-10T10:00:00Z', ends_at: '2026-12-10T11:00:00Z' }),
      ],
      NOW,
    );
    expect(list.map((s) => [s.event.id, s.weeks])).toEqual([
      ['hq-event:sooner', 1],
      ['hq-event:later', 1],
    ]);
  });

  it('lists a weekly one once, at its first week still to come, with how many weeks wait', () => {
    const list = waitingSuggestions(
      [
        suggested({ id: 'w3', series_id: 's', starts_at: '2026-12-18T10:00:00Z', ends_at: '2026-12-18T11:00:00Z' }),
        suggested({ id: 'w0', series_id: 's', starts_at: '2026-11-27T10:00:00Z', ends_at: '2026-11-27T11:00:00Z' }),
        suggested({ id: 'w1', series_id: 's', starts_at: '2026-12-04T10:00:00Z', ends_at: '2026-12-04T11:00:00Z' }),
        suggested({ id: 'w2', series_id: 's', starts_at: '2026-12-11T10:00:00Z', ends_at: '2026-12-11T11:00:00Z' }),
      ],
      NOW,
    );
    expect(list).toHaveLength(1);
    expect(list[0].event.id).toBe('hq-event:w1');
    expect(list[0].weeks).toBe(3);
  });

  it('leaves out events on the calendar, declined ones, past ones and squad and team events', () => {
    const teamRow = { id: 'e1', team_id: 'team-a', team_name: 'Open A', team_kind: 'team', kind: 'training', title: 'Training', starts_at: '2026-12-10T10:00:00Z', ends_at: '2026-12-10T11:00:00Z', all_day: false, day: '2026-12-10', end_day: '2026-12-10', start_time: '18:00', end_time: '19:00', location: null, note: null, staff_only: false, series_id: null, cancelled_at: null, cancelled_by_name: null, created_by_name: null, can_manage: false } as TeamEventRow;
    expect(
      waitingSuggestions(
        [
          event(),
          event({ status: 'declined' }),
          suggested({ starts_at: '2026-11-20T10:00:00Z', ends_at: '2026-11-20T11:00:00Z' }),
          toCalendarEvent(teamRow, '#fff'),
        ],
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('the member’s own declined suggestions', () => {
  const NOW = new Date('2026-12-01T00:00:00Z');
  const declined = (changes: Partial<HqEventRow>) => event({ status: 'declined', mine: true, ...changes });

  it('lists the ones still to come, soonest first, a weekly one once', () => {
    const list = declinedSuggestions(
      [
        declined({ id: 'b', starts_at: '2026-12-20T10:00:00Z', ends_at: '2026-12-20T11:00:00Z' }),
        declined({ id: 'w2', series_id: 's', starts_at: '2026-12-11T10:00:00Z', ends_at: '2026-12-11T11:00:00Z' }),
        declined({ id: 'w1', series_id: 's', starts_at: '2026-12-04T10:00:00Z', ends_at: '2026-12-04T11:00:00Z' }),
      ],
      NOW,
    );
    expect(list.map((e) => e.id)).toEqual(['hq-event:w1', 'hq-event:b']);
  });

  it('leaves out someone else’s, past ones, and ones still waiting', () => {
    expect(
      declinedSuggestions(
        [
          declined({ mine: false }),
          declined({ starts_at: '2026-11-20T10:00:00Z', ends_at: '2026-11-20T11:00:00Z' }),
          event({ status: 'suggested', mine: true }),
        ],
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('starting from last time on a calendar kept in the app', () => {
  const events: CalendarEvent[] = [
    event({ id: 'old', starts_at: '2026-11-06T10:00:00Z', start_time: '17:00', end_time: '19:00', location: 'Old hall' }),
    event({ id: 'new', starts_at: '2026-11-20T10:00:00Z', title: 'Quiz night' }),
    event({ id: 'waiting', status: 'suggested', starts_at: '2026-11-27T10:00:00Z', start_time: '06:00', location: 'Elsewhere' }),
    event({ id: 'other', calendar_id: 'cal-2', starts_at: '2026-11-28T10:00:00Z', start_time: '20:00' }),
  ];
  const blank = form({ calendarId: null, title: '', startText: '', endText: '', location: '' });
  const untouched = { title: false, times: false, place: false };

  it('finds that calendar’s latest event of the kind, never a suggestion or another calendar’s', () => {
    expect(lastEventLike(events, null, 'social', 'cal-1')?.id).toBe('hq-event:new');
    expect(lastEventLike(events, null, 'social', 'cal-2')?.id).toBe('hq-event:other');
    expect(lastEventLike(events, null, 'meeting', 'cal-1')).toBeNull();
    // A squad's or team's search never finds a calendar's event.
    expect(lastEventLike(events, 'team-a', 'social')).toBeNull();
  });

  it('fills in the name, times and place from last time, and drops the squad or team', () => {
    const { form: next, filledFrom } = startedFrom({ ...blank, teamId: 'team-a' }, events, 'team-a', 'social', untouched, 'cal-1');
    expect(next).toMatchObject({
      teamId: null,
      calendarId: 'cal-1',
      title: 'Quiz night',
      startText: '6:00 pm',
      endText: '9:00 pm',
      location: 'Clubrooms',
    });
    expect(filledFrom).toBe('social');
  });

  it('names a calendar’s meeting plainly, not as a team’s', () => {
    expect(startedFrom(blank, events, null, 'meeting', untouched, 'cal-1').form.title).toBe('Meeting');
    expect(startedFrom(blank, events, 'team-a', 'meeting', untouched).form.title).toBe('Team meeting');
  });

  it('offers that calendar’s places first, then the club’s', () => {
    const places = placeSuggestions(
      [
        event({ id: 'a', location: 'Clubrooms' }),
        event({ id: 'b', location: 'Clubrooms' }),
        event({ id: 'c', location: 'Oval' }),
        event({ id: 'd', calendar_id: 'cal-2', location: 'Town hall' }),
      ],
      null,
      3,
      'cal-1',
    );
    expect(places.slice(0, 2)).toEqual(['Clubrooms', 'Oval']);
    expect(places).toContain('Town hall');
  });
});

describe('moving a linked calendar in', () => {
  const base: CalendarEvent = {
    id: 'x',
    title: 'Committee meeting',
    start: new Date('2026-12-02T11:00:00Z'),
    end: new Date('2026-12-02T12:30:00Z'),
    allDay: false,
    location: 'Clubrooms',
    description: 'Agenda to follow',
    calendarId: 'import',
    calendarName: '',
    clubWide: false,
    color: '',
  };

  it('hands a timed event over as its two moments', () => {
    expect(importEvents([base])).toEqual([
      {
        title: 'Committee meeting',
        all_day: false,
        starts_at: '2026-12-02T11:00:00.000Z',
        ends_at: '2026-12-02T12:30:00.000Z',
        location: 'Clubrooms',
        note: 'Agenda to follow',
      },
    ]);
  });

  it('hands an all-day event over as days, the last day included', () => {
    // A calendar file ends an all-day event on the day after its last day.
    const camp = { ...base, allDay: true, start: new Date(2026, 11, 5), end: new Date(2026, 11, 7), location: null, description: null };
    expect(importEvents([camp])).toEqual([
      { title: 'Committee meeting', all_day: true, day: '2026-12-05', end_day: '2026-12-06', location: null, note: null },
    ]);
    const oneDay = { ...camp, end: new Date(2026, 11, 6) };
    expect(importEvents([oneDay])[0]).toMatchObject({ day: '2026-12-05', end_day: '2026-12-05' });
    // One with no length still lands on its own day.
    const noLength = { ...camp, end: new Date(2026, 11, 5) };
    expect(importEvents([noLength])[0]).toMatchObject({ day: '2026-12-05', end_day: '2026-12-05' });
  });

  describe('reading the link', () => {
    const FROM = new Date(2025, 10, 1);
    const TO = new Date(2027, 11, 1);
    const ics = (events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
    const vevent = (uid: string, start: string, end: string, summary: string) =>
      ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${summary}`, 'END:VEVENT'].join('\r\n');
    const serve = (text: string, ok = true) => {
      globalThis.fetch = jest.fn(async () => ({ ok, status: ok ? 200 : 404, text: async () => text })) as unknown as typeof fetch;
    };

    it('reads a webcal link over https and gives its events with the first and last', async () => {
      serve(
        ics([
          vevent('b', '20261210T100000Z', '20261210T110000Z', 'Working bee'),
          vevent('a', '20261202T110000Z', '20261202T123000Z', 'Committee meeting'),
        ]),
      );
      const reading = await readCalendarForImport('webcal://example.com/club.ics', FROM, TO);
      expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/club.ics');
      if ('error' in reading) throw new Error(reading.error);
      expect(reading.events.map((e) => e.title)).toEqual(['Committee meeting', 'Working bee']);
      expect(reading.first?.toISOString()).toBe('2026-12-02T11:00:00.000Z');
      expect(reading.last?.toISOString()).toBe('2026-12-10T10:00:00.000Z');
    });

    it('leaves out events outside the two years the calendar shows', async () => {
      serve(ics([vevent('old', '20200101T100000Z', '20200101T110000Z', 'Long ago')]));
      const reading = await readCalendarForImport('https://example.com/club.ics', FROM, TO);
      expect(reading).toEqual({ events: [], first: null, last: null });
    });

    it('says so when the link can’t be reached', async () => {
      serve('', false);
      expect(await readCalendarForImport('https://example.com/club.ics', FROM, TO)).toEqual({
        error: 'The link couldn’t be read just now. Check your connection and try again.',
      });
      globalThis.fetch = jest.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch;
      expect(await readCalendarForImport('https://example.com/club.ics', FROM, TO)).toHaveProperty('error');
    });

    it('refuses a calendar with more events than the database takes', async () => {
      const many = Array.from({ length: MAX_IMPORT_EVENTS + 1 }, (_, i) => {
        const minute = String(i % 60).padStart(2, '0');
        const hour = String(Math.floor(i / 60) % 24).padStart(2, '0');
        const day = String(1 + Math.floor(i / 1440)).padStart(2, '0');
        return vevent(`u${i}`, `202612${day}T${hour}${minute}00Z`, `202612${day}T${hour}${minute}30Z`, `Event ${i}`);
      });
      serve(ics(many));
      const reading = await readCalendarForImport('https://example.com/club.ics', FROM, TO);
      expect(reading).toHaveProperty('error');
      expect((reading as { error: string }).error).toMatch(/the most it can bring in is 5,000/);
    });
  });
});
