import { parseIcs } from '@/lib/calendar';

const CALENDAR = { id: 'c1', name: 'Open A', clubWide: false, color: '#336699' };

/** An ICS file with these events, each a list of lines. */
function ics(...events: string[][]) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n');
}

const OCTOBER = [new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z')] as const;

function parse(text: string, range: readonly [Date, Date] = OCTOBER) {
  return parseIcs(text, CALENDAR, range[0], range[1]);
}

describe('parseIcs', () => {
  it('reads a single event', () => {
    const [event, ...rest] = parse(
      ics([
        'UID:training-1',
        'DTSTART:20261020T090000Z',
        'DTEND:20261020T103000Z',
        'SUMMARY:Training',
        'LOCATION:Court 1',
        'DESCRIPTION:Bring water',
      ]),
    );
    expect(rest).toEqual([]);
    expect(event).toEqual({
      id: 'training-1:2026-10-20T09:00:00.000Z',
      title: 'Training',
      start: new Date('2026-10-20T09:00:00Z'),
      end: new Date('2026-10-20T10:30:00Z'),
      allDay: false,
      location: 'Court 1',
      description: 'Bring water',
      calendarId: 'c1',
      calendarName: 'Open A',
      clubWide: false,
      color: '#336699',
      // Who the calendar is for: nobody in particular unless the calendar says so.
      teamIds: [],
      forAthletes: false,
    });
  });

  it('marks each event with who its calendar is for', () => {
    const text = ics(['UID:t1', 'DTSTART:20261020T090000Z', 'DTEND:20261020T103000Z', 'SUMMARY:Training']);
    const [event] = parseIcs(
      text,
      { ...CALENDAR, teamIds: ['team-1', 'team-2'], forAthletes: true },
      OCTOBER[0],
      OCTOBER[1],
    );
    expect(event.teamIds).toEqual(['team-1', 'team-2']);
    expect(event.forAthletes).toBe(true);
  });

  it('fills in a missing title and leaves out blank details', () => {
    const [event] = parse(ics(['UID:x', 'DTSTART:20261020T090000Z', 'DTEND:20261020T100000Z']));
    expect(event.title).toBe('Untitled event');
    expect(event.location).toBeNull();
    expect(event.description).toBeNull();
  });

  it('reads all-day events', () => {
    const [event] = parse(
      ics(['UID:camp', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261026', 'SUMMARY:Camp']),
    );
    expect(event.allDay).toBe(true);
    expect([event.start.getFullYear(), event.start.getMonth(), event.start.getDate()]).toEqual([2026, 9, 24]);
    expect([event.end.getFullYear(), event.end.getMonth(), event.end.getDate()]).toEqual([2026, 9, 26]);
  });

  it('reads times in a zone defined in the file', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VTIMEZONE',
      'TZID:W. Australia Standard Time',
      'BEGIN:STANDARD',
      'DTSTART:16010101T000000',
      'TZOFFSETFROM:+0800',
      'TZOFFSETTO:+0800',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:perth',
      'DTSTART;TZID=W. Australia Standard Time:20261020T170000',
      'DTEND;TZID=W. Australia Standard Time:20261020T183000',
      'SUMMARY:Training',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [event] = parse(text);
    expect(event.start).toEqual(new Date('2026-10-20T09:00:00Z'));
    expect(event.end).toEqual(new Date('2026-10-20T10:30:00Z'));
  });

  it('gives an event without an end no length', () => {
    const [event] = parse(ics(['UID:x', 'DTSTART:20261020T090000Z', 'SUMMARY:Meeting']));
    expect(event.end).toEqual(event.start);
  });

  it('keeps only events that overlap the range', () => {
    const events = parse(
      ics(
        ['UID:before', 'DTSTART:20260930T090000Z', 'DTEND:20260930T100000Z'],
        ['UID:ends-at-start', 'DTSTART:20260930T230000Z', 'DTEND:20261001T000000Z'],
        ['UID:overlaps-start', 'DTSTART:20260930T230000Z', 'DTEND:20261001T010000Z'],
        ['UID:inside', 'DTSTART:20261015T090000Z', 'DTEND:20261015T100000Z'],
        ['UID:starts-at-end', 'DTSTART:20261101T000000Z', 'DTEND:20261101T010000Z'],
      ),
    );
    expect(events.map((e) => e.id.split(':')[0])).toEqual(['overlaps-start', 'inside']);
  });

  it('keeps an event with no length at the start of the range', () => {
    const events = parse(ics(['UID:x', 'DTSTART:20261001T000000Z']));
    expect(events).toHaveLength(1);
  });

  it('sorts events by start time', () => {
    const events = parse(
      ics(
        ['UID:late', 'DTSTART:20261025T090000Z', 'DTEND:20261025T100000Z'],
        ['UID:early', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z'],
        ['UID:middle', 'DTSTART:20261015T090000Z', 'DTEND:20261015T100000Z'],
      ),
    );
    expect(events.map((e) => e.id.split(':')[0])).toEqual(['early', 'middle', 'late']);
  });

  it('leaves out cancelled events', () => {
    const events = parse(
      ics(
        ['UID:off', 'DTSTART:20261015T090000Z', 'DTEND:20261015T100000Z', 'STATUS:CANCELLED'],
        ['UID:on', 'DTSTART:20261016T090000Z', 'DTEND:20261016T100000Z', 'STATUS:CONFIRMED'],
      ),
    );
    expect(events.map((e) => e.id.split(':')[0])).toEqual(['on']);
  });

  describe('recurring events', () => {
    const weekly = [
      'UID:weekly',
      'DTSTART:20261006T090000Z',
      'DTEND:20261006T100000Z',
      'SUMMARY:Training',
      'RRULE:FREQ=WEEKLY;COUNT=6',
    ];

    it('expands each occurrence in the range, with its own id', () => {
      const events = parse(ics(weekly));
      expect(events.map((e) => e.start.toISOString())).toEqual([
        '2026-10-06T09:00:00.000Z',
        '2026-10-13T09:00:00.000Z',
        '2026-10-20T09:00:00.000Z',
        '2026-10-27T09:00:00.000Z',
      ]);
      expect(new Set(events.map((e) => e.id)).size).toBe(4);
      expect(events[1].end).toEqual(new Date('2026-10-13T10:00:00Z'));
    });

    it('starts at the range when the series started earlier', () => {
      const events = parse(ics(weekly), [new Date('2026-10-15T00:00:00Z'), new Date('2026-11-30T00:00:00Z')]);
      expect(events.map((e) => e.start.toISOString())).toEqual([
        '2026-10-20T09:00:00.000Z',
        '2026-10-27T09:00:00.000Z',
        '2026-11-03T09:00:00.000Z',
        '2026-11-10T09:00:00.000Z',
      ]);
    });

    it('leaves out excluded dates', () => {
      const events = parse(ics([...weekly, 'EXDATE:20261013T090000Z']));
      expect(events.map((e) => e.start.toISOString())).toEqual([
        '2026-10-06T09:00:00.000Z',
        '2026-10-20T09:00:00.000Z',
        '2026-10-27T09:00:00.000Z',
      ]);
    });

    it('uses a moved occurrence in place of the original', () => {
      const events = parse(
        ics(weekly, [
          'UID:weekly',
          'RECURRENCE-ID:20261013T090000Z',
          'DTSTART:20261014T180000Z',
          'DTEND:20261014T190000Z',
          'SUMMARY:Training (moved)',
        ]),
      );
      expect(events.map((e) => [e.start.toISOString(), e.title])).toEqual([
        ['2026-10-06T09:00:00.000Z', 'Training'],
        ['2026-10-14T18:00:00.000Z', 'Training (moved)'],
        ['2026-10-20T09:00:00.000Z', 'Training'],
        ['2026-10-27T09:00:00.000Z', 'Training'],
      ]);
    });

    it('leaves out a cancelled occurrence', () => {
      const events = parse(
        ics(weekly, [
          'UID:weekly',
          'RECURRENCE-ID:20261020T090000Z',
          'DTSTART:20261020T090000Z',
          'DTEND:20261020T100000Z',
          'STATUS:CANCELLED',
        ]),
      );
      expect(events.map((e) => e.start.toISOString())).toEqual([
        '2026-10-06T09:00:00.000Z',
        '2026-10-13T09:00:00.000Z',
        '2026-10-27T09:00:00.000Z',
      ]);
    });

    it('shows a moved occurrence whose series is missing', () => {
      const events = parse(
        ics([
          'UID:orphan',
          'RECURRENCE-ID:20261013T090000Z',
          'DTSTART:20261014T090000Z',
          'DTEND:20261014T100000Z',
          'SUMMARY:Moved',
        ]),
      );
      expect(events.map((e) => e.title)).toEqual(['Moved']);
    });

    it('expands recurring all-day events', () => {
      const events = parse(
        ics(['UID:gala', 'DTSTART;VALUE=DATE:20261003', 'DTEND;VALUE=DATE:20261004', 'RRULE:FREQ=WEEKLY;UNTIL=20261017']),
      );
      expect(events.every((e) => e.allDay)).toBe(true);
      expect(events.map((e) => e.start.getDate())).toEqual([3, 10, 17]);
    });

    it('stops an endless rule at the end of the range', () => {
      const events = parse(
        ics(['UID:daily', 'DTSTART:20261001T090000Z', 'DTEND:20261001T093000Z', 'RRULE:FREQ=DAILY']),
      );
      expect(events).toHaveLength(31);
    });

    it('stops a runaway rule after 500 occurrences', () => {
      const events = parse(
        ics(['UID:hourly', 'DTSTART:20261001T000000Z', 'DTEND:20261001T000100Z', 'RRULE:FREQ=HOURLY']),
      );
      expect(events).toHaveLength(500);
    });

    it('shows a weekly event that started years before the range', () => {
      const events = parse(
        ics(['UID:old-weekly', 'DTSTART:20150106T090000Z', 'DTEND:20150106T100000Z', 'RRULE:FREQ=WEEKLY']),
      );
      expect(events.map((e) => e.start.toISOString())).toEqual([
        '2026-10-06T09:00:00.000Z',
        '2026-10-13T09:00:00.000Z',
        '2026-10-20T09:00:00.000Z',
        '2026-10-27T09:00:00.000Z',
      ]);
    });

    it('shows a daily event that started more than 500 days before the range', () => {
      const events = parse(
        ics(['UID:old-daily', 'DTSTART:20230101T070000Z', 'DTEND:20230101T080000Z', 'RRULE:FREQ=DAILY']),
      );
      expect(events).toHaveLength(31);
    });

    it('caps the steps through an endless rule that started long ago', () => {
      const events = parse(
        ics(['UID:old-hourly', 'DTSTART:20200101T000000Z', 'DTEND:20200101T000100Z', 'RRULE:FREQ=HOURLY']),
      );
      expect(events).toHaveLength(0);
    });
  });
});
