/**
 * Taking attendance (src/app/attendance/new.tsx), from "Taking attendance"
 * in section 6 of docs/user-guide.md.
 *
 * Coaches and managers pick one of their own squads or teams (or start with
 * it chosen when they lead only one), any current squad for a whole-squad
 * event, or the whole club. Today's calendar event suggests the session's
 * name and time. Everyone must be marked before saving, and attendance already
 * taken for the group within 3 hours is called out so it isn't taken twice.
 * The database (`save_attendance`) decides whether the member may save it.
 */
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';

import TakeAttendanceScreen from '@/app/attendance/new';
import { formatSentAt } from '@/lib/format';

import { argsOf, clearCalls, field, isDisabled, isSelected, rpcNames, type } from './helpers/forms';
import {
  openScreen,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  TEAM_B,
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

type Who = PersonaName | Persona;

let replace: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
});
afterEach(() => replace.mockRestore());

/** A team inside the Open A squad: members take attendance for the squad or this team. */
const SQUAD = { ...TEAM, id: 'squad-open', name: 'Open Squad', kind: 'squad' as const, sort_order: 0 };
/** 17 & Under A sits inside the squad. */
const IN_SQUAD = { ...TEAM_B, squad_id: SQUAD.id };
const TEAMS = [SQUAD, TEAM, IN_SQUAD];

const ROSTER = [
  { profile_id: 'a1', full_name: 'Alice Athlete' },
  { profile_id: 'a2', full_name: 'Bea Athlete' },
  { profile_id: 'a3', full_name: null },
];

function ics(...events: { uid: string; summary: string; start: string; end: string }[]) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`, `SUMMARY:${e.summary}`, `DTSTART:${e.start}`, `DTEND:${e.end}`, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n');
}

// Now is 02:00 UTC on Sunday 18 October.
const TEAM_ICS = ics(
  { uid: 'training', summary: 'Sunday training', start: '20261018T013000Z', end: '20261018T030000Z' },
  { uid: 'tomorrow', summary: 'Monday training', start: '20261019T013000Z', end: '20261019T030000Z' },
);
const CLUB_ICS = ics(
  { uid: 'clinic', summary: 'Umpiring clinic', start: '20261018T023000Z', end: '20261018T040000Z' },
  { uid: 'later', summary: 'Presentation night', start: '20261018T100000Z', end: '20261018T120000Z' },
);

const CALENDARS = [
  { id: 'c1', name: 'Club', url: 'https://example.test/club.ics', committee_only: false, color: null, team: null },
  { id: 'c2', name: 'x', url: 'https://example.test/team.ics', committee_only: false, color: null, team: { name: TEAM.name, kind: 'team' } },
];

function serve(feeds: Record<string, string>) {
  globalThis.fetch = jest.fn(async (url: string) =>
    feeds[url]
      ? { ok: true, status: 200, text: async () => feeds[url] }
      : { ok: false, status: 404, text: async () => '' },
  ) as unknown as typeof fetch;
}

async function open(
  who: Who,
  { calendars = [] as unknown[], feeds = {} as Record<string, string>, ...options }: BackendOptions & { calendars?: unknown[]; feeds?: Record<string, string> } = {},
) {
  serve(feeds);
  await openScreen(who, { 'attendance/new': TakeAttendanceScreen }, '/attendance/new', { teams: TEAMS, calendars, fixtures: [] }, {
    ...options,
    rpcs: {
      attendance_roster: ROSTER,
      nearby_attendance_sessions: [],
      absences_on: [],
      injured_on: [],
      save_attendance: 'sess-new',
      ...options.rpcs,
    },
  });
  await settle();
}

function markAll(present: boolean[]) {
  const label = (p: boolean) => (p ? 'Present' : 'Absent');
  const buttons = (p: boolean) => screen.getAllByRole('radio').filter((r) => within(r).queryByText(label(p)));
  present.forEach((p, i) => fireEvent.press(buttons(p)[i]));
}

async function save() {
  fireEvent.press(screen.getByText('Save attendance'));
  await settle();
}

describe('who the attendance is for', () => {
  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['manager', 'manager'],
  ])('a %s who leads one group starts with it chosen, and its roster loaded', async (_l, who) => {
    await open(who);
    expect(screen.getByText('Your squads and teams')).toBeTruthy();
    expect(isSelected(TEAM.name)).toBe(true);
    expect(argsOf('attendance_roster')).toEqual([{ p_team_id: TEAM.id }]);
    expect(screen.getByText('Alice Athlete')).toBeTruthy();
    expect(screen.getByText('Unnamed athlete')).toBeTruthy();
  });

  it('offers other current squads for a whole-squad event, and the whole club', async () => {
    await open('coach');
    expect(screen.getByText('Whole squad')).toBeTruthy();
    expect(screen.getByText(SQUAD.name)).toBeTruthy();
    // Teams inside a squad are only offered when the member leads them.
    expect(screen.queryByText(TEAM_B.name)).toBeNull();
    expect(screen.getByText('Whole club')).toBeTruthy();
  });

  it('calls it Another team in a club without squads', async () => {
    setClubFeatures({ squads: false });
    await open('coach');
    expect(screen.getByText('Another team')).toBeTruthy();
  });

  it('a member who leads no group chooses from every squad or the whole club', async () => {
    await open('committee');
    expect(screen.getByText('Who is it for?')).toBeTruthy();
    expect(screen.queryByText('Save attendance')).toBeNull();
    expect(rpcNames()).not.toContain('attendance_roster');
    fireEvent.press(screen.getByText('Whole club'));
    await settle();
    // The whole club is no squad or team.
    expect(argsOf('attendance_roster')).toEqual([{ p_team_id: null }]);
  });

  it('an admin leads every group, so picks one first', async () => {
    await open('admin');
    expect(screen.getByText('Your squads and teams')).toBeTruthy();
    expect(screen.getByText(TEAM_B.name)).toBeTruthy();
    expect(rpcNames()).not.toContain('attendance_roster');
    fireEvent.press(screen.getByText(TEAM_B.name));
    await settle();
    expect(argsOf('attendance_roster')).toEqual([{ p_team_id: TEAM_B.id }]);
  });

  it('changing the group starts a fresh register', async () => {
    await open('coach');
    markAll([true]);
    fireEvent.press(screen.getByText(SQUAD.name));
    await settle();
    expect(argsOf('attendance_roster').pop()).toEqual({ p_team_id: SQUAD.id });
    expect(screen.getByText('0 of 3 present · 3 not marked')).toBeTruthy();
  });
});

describe('marking and saving', () => {
  it('needs a session name', async () => {
    await open('coach');
    markAll([true, false, true]);
    await save();
    expect(screen.getByText('Name the session, for example Tuesday training.')).toBeTruthy();
    expect(rpcNames()).not.toContain('save_attendance');
  });

  it('needs everyone marked', async () => {
    await open('coach');
    type('Session', 'Tuesday training');
    markAll([true]);
    await save();
    expect(screen.getByText('Mark everyone present or absent first.')).toBeTruthy();
    expect(rpcNames()).not.toContain('save_attendance');
  });

  it('saves the marks with the time it was taken, then opens the record', async () => {
    await open('coach');
    type('Session', 'Tuesday training');
    markAll([true, false, true]);
    expect(screen.getByText('2 of 3 present')).toBeTruthy();
    await save();
    expect(argsOf('save_attendance')).toEqual([
      {
        p_session_id: null,
        p_team_id: TEAM.id,
        p_name: 'Tuesday training',
        p_held_at: '2026-10-18T02:00:00.000Z',
        p_marks: [
          { profile_id: 'a1', present: true },
          { profile_id: 'a2', present: false },
          { profile_id: 'a3', present: true },
        ],
      },
    ]);
    expect(replace).toHaveBeenCalledWith({ pathname: '/attendance/[id]', params: { id: 'sess-new' } });
  });

  it('Mark the rest present keeps the absent ones', async () => {
    await open('coach');
    type('Session', 'Training');
    markAll([false]);
    fireEvent.press(screen.getByText('Mark the rest present'));
    expect(screen.queryByText('Mark the rest present')).toBeNull();
    await save();
    expect(argsOf('save_attendance')[0]?.p_marks).toEqual([
      { profile_id: 'a1', present: false },
      { profile_id: 'a2', present: true },
      { profile_id: 'a3', present: true },
    ]);
  });

  it('a club-wide session is saved with no squad or team', async () => {
    await open('coach');
    fireEvent.press(screen.getByText('Whole club'));
    await settle();
    type('Session', 'Club clinic');
    fireEvent.press(screen.getByText('Mark the rest present'));
    await save();
    expect(argsOf('save_attendance')[0]).toMatchObject({ p_team_id: null, p_name: 'Club clinic' });
  });

  it('shows the database’s refusal and stays', async () => {
    await open('coach', { rpcErrors: { save_attendance: 'Only the group’s coaches and managers can take its attendance.' } });
    type('Session', 'Training');
    fireEvent.press(screen.getByText('Mark the rest present'));
    await save();
    expect(screen.getByText('Only the group’s coaches and managers can take its attendance.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('says when the group has no athletes to mark', async () => {
    await open('coach', { rpcs: { attendance_roster: [] } });
    expect(screen.getByText('There are no athletes in this squad or team yet.')).toBeTruthy();
  });

  it('notes who was reported away or injured that day', async () => {
    await open('coach', {
      rpcs: {
        absences_on: [{ profile_id: 'a2', category: 'Illness', reason: null, from_day: '2026-10-18', to_day: '2026-10-18', reported_by_name: 'Sample Guardian' }],
        injured_on: [{ profile_id: 'a1', expected_return: null }],
      },
    });
    expect(screen.getByText('Away: Illness')).toBeTruthy();
    expect(screen.getByText(/^Injured/)).toBeTruthy();
    expect(argsOf('absences_on')).toContainEqual({ p_team_id: TEAM.id, p_day: '2026-10-18' });
  });
});

describe('attendance already taken nearby', () => {
  const NEARBY = [{ id: 'sess-earlier', name: 'Morning session', held_at: '2026-10-18T00:30:00Z', taken_by_name: 'Sample manager' }];

  it('warns when the group’s attendance was taken within 3 hours, and links to it', async () => {
    await open('coach', { rpcs: { nearby_attendance_sessions: NEARBY } });
    expect(argsOf('nearby_attendance_sessions')).toContainEqual({ p_team_id: TEAM.id, p_held_at: '2026-10-18T02:00:00.000Z' });
    expect(screen.getByText('Attendance may already have been taken')).toBeTruthy();
    expect(
      screen.getByText(
        `Sample manager took attendance for “Morning session” at ${formatSentAt(new Date('2026-10-18T00:30:00Z'))}. Two sessions within 3 hours of each other is unusual.`,
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Open that record'));
    expect(replace).toHaveBeenCalledWith({ pathname: '/attendance/[id]', params: { id: 'sess-earlier' } });
  });

  it('still lets them save a different session', async () => {
    await open('coach', { rpcs: { nearby_attendance_sessions: NEARBY } });
    type('Session', 'Afternoon session');
    fireEvent.press(screen.getByText('Mark the rest present'));
    expect(isDisabled('Save attendance')).toBe(false);
    await save();
    expect(argsOf('save_attendance')).toHaveLength(1);
  });

  it('names someone when the taker is unknown, and shows no warning when there is none', async () => {
    await open('coach', { rpcs: { nearby_attendance_sessions: [{ ...NEARBY[0], taken_by_name: null }] } });
    expect(screen.getByText(/^Someone took attendance for “Morning session”/)).toBeTruthy();
  });

  it('shows no warning when nothing was taken nearby', async () => {
    await open('coach');
    expect(screen.queryByText('Attendance may already have been taken')).toBeNull();
  });
});

describe('today’s calendar', () => {
  const feeds = { 'https://example.test/club.ics': CLUB_ICS, 'https://example.test/team.ics': TEAM_ICS };

  it('suggests the group’s own event on now over a club one, with its start time', async () => {
    await open('coach', { calendars: CALENDARS, feeds });
    expect(field('Session').props.value).toBe('Sunday training');
    expect(screen.getByText(/^Suggested from the calendar: it’s on now, from /)).toBeTruthy();
    // Today's timed events only: not tomorrow's.
    expect(screen.getByText('From today’s calendar')).toBeTruthy();
    expect(screen.queryByText(/^Monday training/)).toBeNull();
    await settle();
    markAll([true, true, true]);
    await save();
    expect(argsOf('save_attendance')[0]).toMatchObject({
      p_name: 'Sunday training',
      p_held_at: '2026-10-18T01:30:00.000Z',
    });
  });

  it('picking another of today’s events uses its name and time', async () => {
    await open('coach', { calendars: CALENDARS, feeds });
    fireEvent.press(screen.getByText(new RegExp('^Presentation night · ')));
    await settle();
    expect(field('Session').props.value).toBe('Presentation night');
    expect(screen.queryByText(/^Suggested from the calendar/)).toBeNull();
    fireEvent.press(screen.getByText('Mark the rest present'));
    await save();
    expect(argsOf('save_attendance')[0]).toMatchObject({
      p_name: 'Presentation night',
      p_held_at: '2026-10-18T10:00:00.000Z',
    });
  });

  it('a typed name replaces the suggestion, keeping the event’s time', async () => {
    await open('coach', { calendars: CALENDARS, feeds });
    type('Session', 'Extra shooting');
    expect(screen.queryByText(/^Suggested from the calendar/)).toBeNull();
    fireEvent.press(screen.getByText('Mark the rest present'));
    await save();
    expect(argsOf('save_attendance')[0]).toMatchObject({
      p_name: 'Extra shooting',
      p_held_at: '2026-10-18T01:30:00.000Z',
    });
  });

  it('for the whole club, only club events are suggested', async () => {
    await open('coach', { calendars: CALENDARS, feeds });
    fireEvent.press(screen.getByText('Whole club'));
    await settle();
    expect(field('Session').props.value).toBe('Umpiring clinic');
    expect(screen.queryByText(/^Sunday training · /)).toBeNull();
  });
});
