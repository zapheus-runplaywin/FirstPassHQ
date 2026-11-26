/**
 * What the attendance screens show each kind of member once they're open:
 * the list (src/app/attendance/index.tsx), one register ([id].tsx) and an
 * athlete's own attendance for them and their family (family/[id].tsx).
 *
 * Coaches, managers, the committee and admins take attendance; coaches, the
 * committee and admins also see each athlete's record (`useCanTakeAttendance`,
 * `useCanViewAttendance`, section 11 of the user guide). Whether a register
 * can be corrected (`can_edit`), which absences show as Away notes, and which
 * sessions an athlete's page lists come from the database, so the tests seed
 * what it would return and check the screen shows that and no more.
 */
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';

import AttendanceSessionScreen from '@/app/attendance/[id]';
import FamilyAttendanceScreen from '@/app/attendance/family/[id]';
import AttendanceScreen from '@/app/attendance/index';
import type { AbsenceToReview, UpcomingAbsence } from '@/lib/absences';
import { supabase } from '@/lib/supabase';
import type { AttendanceMark, AttendanceSession } from '@/lib/types';

import {
  morePersonas,
  onATablet,
  openScreen,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
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

const rpcNames = () => ((supabase.rpc as jest.Mock).mock.calls as [string][]).map(([n]) => n);

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
});

function session(extra: Partial<AttendanceSession> = {}): AttendanceSession {
  return {
    id: 'sess-1',
    club_wide: false,
    team_id: TEAM.id,
    team_name: TEAM.name,
    name: 'Tuesday training',
    held_at: '2026-10-13T08:00:00Z',
    taken_by_name: 'Sample coach',
    present_count: 1,
    marked_count: 2,
    can_edit: false,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The attendance list

const AWAY: UpcomingAbsence[] = [
  {
    id: 'abs-1',
    athlete_id: 'child-1',
    athlete_name: 'Sample Child',
    from_day: '2026-10-20',
    to_day: '2026-10-20',
    category: 'Planned holidays',
    reason: 'Bali',
    reported_by_name: 'Sample Guardian',
  },
];

const TO_REVIEW: AbsenceToReview[] = [
  { ...AWAY[0], id: 'abs-2', athlete_name: 'Newly Away', withdrawn: false, changed_at: '2026-10-17T00:00:00Z' },
];

async function openList(who: Who, rpcs: Record<string, unknown> = {}) {
  await openScreen(who, { 'attendance/index': AttendanceScreen }, '/attendance', {}, {
    rpcs: {
      attendance_sessions_list: [session()],
      upcoming_absences: [],
      athlete_attendance_summary: [
        { profile_id: 'child-1', full_name: 'Sample Child', session_count: 4, present_count: 3, last_present_at: null },
      ],
      absences_to_review: [],
      ...rpcs,
    },
  });
}

describe('the attendance list', () => {
  const TAKERS: [string, Who, { athletes: boolean }][] = [
    ['coach', 'coach', { athletes: true }],
    ['assistant coach', morePersonas.assistantCoach, { athletes: true }],
    ['athlete who also coaches', morePersonas.athleteCoach, { athletes: true }],
    ['committee member', 'committee', { athletes: true }],
    ['admin', 'admin', { athletes: true }],
    // Managers take attendance but don't see athletes' records.
    ['manager', 'manager', { athletes: false }],
  ];

  it.each(TAKERS)('lets a %s take attendance', async (_l, who, { athletes }) => {
    await openList(who);
    expect(screen.getByText('Take attendance')).toBeTruthy();
    expect(screen.getByText('Tuesday training')).toBeTruthy();
    expect(screen.queryAllByText('Athletes').length > 0).toBe(athletes);
    expect(rpcNames().includes('athlete_attendance_summary')).toBe(athletes);
  });

  const NOT_TAKERS: Who[] = [
    'physio',
    'athlete',
    'guardian',
    'guest',
    'coachExpiredCheck',
    'stoodDownCoach',
    'stoodDownAdmin',
    morePersonas.committeeExpiredCheck,
  ];

  it.each(NOT_TAKERS)('gives %p no Take attendance and no athletes’ records', async (who) => {
    await openList(who, { attendance_sessions_list: [] });
    expect(screen.queryByText('Take attendance')).toBeNull();
    expect(screen.queryByText('Athletes')).toBeNull();
    expect(rpcNames()).not.toContain('athlete_attendance_summary');
    expect(screen.getByText('No attendance has been taken yet.')).toBeTruthy();
  });

  it('shows an athlete’s record on the Athletes tab', async () => {
    await openList('committee');
    await fireEvent.press(screen.getByText('Athletes'));
    await settle();
    expect(screen.getByText('Sample Child')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('At 3 of 4 sessions')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['manager', 'manager'],
  ])('asks a %s to review new and changed absences', async (_l, who) => {
    await openList(who, { absences_to_review: TO_REVIEW });
    expect(screen.getByText('New or changed absences')).toBeTruthy();
    expect(screen.getByText('Newly Away')).toBeTruthy();
    expect(screen.getByText('Mark as reviewed')).toBeTruthy();
  });

  it.each<Who>(['committee', 'admin', 'physio', 'athlete', 'stoodDownCoach'])(
    'never asks %p to review absences, as they lead no group',
    async (who) => {
      await openList(who, { absences_to_review: TO_REVIEW });
      expect(screen.queryByText('New or changed absences')).toBeNull();
      expect(rpcNames()).not.toContain('absences_to_review');
    },
  );

  it('lists who is away soon, as the database returns them', async () => {
    await openList('coach', { upcoming_absences: AWAY });
    expect(screen.getByText('Away in the next 4 weeks')).toBeTruthy();
    expect(screen.getByText('Sample Child')).toBeTruthy();
    expect(screen.getByText(/Planned holidays · Bali · told by Sample Guardian/)).toBeTruthy();
  });

  it('shows no Away list when the database returns nobody', async () => {
    await openList('physio');
    expect(screen.queryByText('Away in the next 4 weeks')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// One register

const REGISTER: AttendanceMark[] = [
  { profile_id: 'child-1', full_name: 'Sample Child', present: false },
  { profile_id: 'a-2', full_name: 'Second Athlete', present: true },
  { profile_id: 'a-3', full_name: 'Third Athlete', present: null },
];

async function openRegister(who: Who, shown: AttendanceSession | null, rpcs: Record<string, unknown> = {}) {
  await openScreen(who, { 'attendance/[id]': AttendanceSessionScreen }, '/attendance/sess-1', {}, {
    rpcs: {
      attendance_sessions_list: shown ? [shown] : [],
      attendance_register: REGISTER,
      absences_on: [
        { profile_id: 'child-1', category: 'Illness', reason: null, from_day: '2026-10-13', to_day: '2026-10-13', reported_by_name: 'Sample Guardian' },
      ],
      injured_on: [{ profile_id: 'a-3', expected_return: '2026-10-31' }],
      ...rpcs,
    },
  });
}

describe('one register', () => {
  it('says so when the database doesn’t return the session', async () => {
    await openRegister('coach', null);
    expect(screen.getByText('This attendance record isn’t available.')).toBeTruthy();
    expect(screen.queryByText('Change attendance')).toBeNull();
  });

  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['manager', 'manager'],
    ['admin', 'admin'],
  ])('lets a %s who can correct it change the marks', async (_l, who) => {
    await openRegister(who, session({ can_edit: true }));
    expect(screen.queryByText('Present')).toBeTruthy(); // read-only marks first
    await fireEvent.press(screen.getByText('Change attendance'));
    expect(screen.getByText('Save changes')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(REGISTER.length * 2);
    expect(screen.getByText('Session')).toBeTruthy(); // the name can be changed too
  });

  it.each<[string, Who]>([
    ['committee member who doesn’t lead the group', 'committee'],
    ['coach of another group', 'coach'],
    ['physio', 'physio'],
  ])('shows a %s the register read-only', async (_l, who) => {
    await openRegister(who, session({ can_edit: false }));
    expect(screen.queryByText('Change attendance')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('Absent')).toBeTruthy();
    expect(screen.getByText('Present')).toBeTruthy();
    expect(screen.getByText('Not marked')).toBeTruthy();
    expect(screen.getByText('1 of 3 present · 1 not marked')).toBeTruthy();
  });

  it('notes who was reported away or injured that day, never the injury itself', async () => {
    await openRegister('coach', session({ can_edit: true }));
    expect(screen.getByText('Away: Illness')).toBeTruthy();
    expect(screen.getByText(/^Injured, back /)).toBeTruthy();
    expect(screen.queryByText(/Hamstring/)).toBeNull();
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'absences_on',
      { p_team_id: TEAM.id, p_day: '2026-10-13' },
    ]);
  });

  it('shows no notes when the database returns none for the member', async () => {
    await openRegister('committee', session(), { absences_on: [], injured_on: [] });
    expect(screen.queryByText(/^Away/)).toBeNull();
    expect(screen.queryByText(/^Injured/)).toBeNull();
  });

  // Changed 2026-11-19 (Matt): turning Injuries off pauses open injuries, it
  // doesn't end them, so whoever takes attendance still needs to know.
  it('still shows who is injured when the club has Injuries off', async () => {
    setClubFeatures({ injuries: false });
    await openRegister('coach', session());
    expect(screen.getByText(/^Injured, back/)).toBeTruthy();
    expect(rpcNames()).toContain('injured_on');
    expect(screen.getByText('Away: Illness')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// An athlete's own attendance, for them and their family

const SESSIONS = [
  { session_id: 's1', team_name: TEAM.name, name: 'Thursday training', held_at: '2026-10-15T08:00:00Z', present: false },
  { session_id: 's2', team_name: TEAM.name, name: 'Tuesday training', held_at: '2026-10-13T08:00:00Z', present: true },
];

const ABSENCES = [
  {
    id: 'abs-past',
    from_day: '2026-10-15',
    to_day: '2026-10-15',
    category: 'Illness',
    reason: null,
    reported_by_name: 'Sample Guardian',
    reported_as: 'guardian',
    created_at: '2026-10-14T00:00:00Z',
    withdrawn_at: null,
  },
  {
    id: 'abs-soon',
    from_day: '2026-10-22',
    to_day: '2026-10-24',
    category: 'Planned holidays',
    reason: 'Bali',
    reported_by_name: 'Sample Guardian',
    reported_as: 'guardian',
    created_at: '2026-10-17T00:00:00Z',
    withdrawn_at: null,
  },
  {
    id: 'abs-withdrawn',
    from_day: '2026-10-28',
    to_day: '2026-10-28',
    category: 'Other',
    reason: 'Changed plans',
    reported_by_name: 'Sample Guardian',
    reported_as: 'guardian',
    created_at: '2026-10-16T00:00:00Z',
    withdrawn_at: '2026-10-17T00:00:00Z',
  },
];

/** `family` is whether the database counts the member as the athlete or their guardian. */
async function openFamily(who: Who, url: string, family = true) {
  await openScreen(who, { 'attendance/family/[id]': FamilyAttendanceScreen }, url, {}, {
    rpcs: {
      athlete_attendance: SESSIONS,
      my_absences: family ? ABSENCES : [],
      is_athlete_or_guardian: family,
    },
  });
}

describe('an athlete’s attendance for them and their family', () => {
  it('shows an athlete their own attendance', async () => {
    await openFamily('athlete', '/attendance/family/athlete');
    expect(screen.getByText('My attendance')).toBeTruthy();
    expect(screen.getByText(/^Whether your coaches marked you present or absent/)).toBeTruthy();
    expect(screen.getByText('Report an absence')).toBeTruthy();
    expect(screen.getByText('At 1 of 2 sessions · 50%')).toBeTruthy();
  });

  it('shows a guardian their child’s attendance by name', async () => {
    await openFamily('guardian', '/attendance/family/child-1?name=Sample%20Child');
    expect(screen.getByText('Sample Child')).toBeTruthy();
    expect(
      screen.getByText(/^Whether Sample Child was marked present or absent at each session\./),
    ).toBeTruthy();
    expect(screen.getByText('Report an absence')).toBeTruthy();
  });

  it('marks a missed session that was reported, and lists only absences still to come', async () => {
    await openFamily('guardian', '/attendance/family/child-1?name=Sample%20Child');
    expect(screen.getByText('Absent, reported')).toBeTruthy();
    expect(screen.getByText('Present')).toBeTruthy();
    // Upcoming and not withdrawn: one, with Withdraw.
    expect(screen.getByText(/^Planned holidays · Bali · Reported by Sample Guardian/)).toBeTruthy();
    expect(screen.getAllByText('Withdraw')).toHaveLength(1);
    expect(screen.queryByText(/Changed plans/)).toBeNull();
    expect(screen.queryByText(/^Illness · Reported by/)).toBeNull();
  });

  it('shows only the sessions the database returns, never other athletes', async () => {
    await openFamily('athlete', '/attendance/family/athlete');
    expect(screen.getByText('Thursday training')).toBeTruthy();
    expect(screen.getByText('Tuesday training')).toBeTruthy();
    expect(screen.queryByText('Second Athlete')).toBeNull();
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'athlete_attendance',
      { p_profile_id: 'athlete', p_since: '2026-07-19' },
    ]);
  });

  it.each<[string, Who]>([
    // The route lets any guardian in, so a coach who is a parent can reach
    // another athlete's page; report_absence still refuses them.
    ['coach who is a guardian of another child', morePersonas.coachGuardian],
    ['guardian of another child', 'guardian'],
  ])('shows a %s the attendance read-only, with no absences to report or withdraw', async (_l, who) => {
    await openFamily(who, '/attendance/family/a-2?name=Second%20Athlete', false);
    expect(screen.getByText('Second Athlete')).toBeTruthy();
    expect(screen.getByText('Thursday training')).toBeTruthy();
    expect(screen.queryByText('Report an absence')).toBeNull();
    expect(screen.queryByText('Withdraw')).toBeNull();
    expect(screen.queryByText('Reported absences')).toBeNull();
    expect(screen.queryByText(/other parents or guardians see this too/)).toBeNull();
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'is_athlete_or_guardian',
      { p_athlete_id: 'a-2' },
    ]);
  });

  it('says when nothing is coming up or recorded', async () => {
    await openScreen(
      'athlete',
      { 'attendance/family/[id]': FamilyAttendanceScreen },
      '/attendance/family/athlete',
      {},
      { rpcs: { athlete_attendance: [], my_absences: [], is_athlete_or_guardian: true } },
    );
    expect(screen.getByText('None coming up.')).toBeTruthy();
    expect(screen.getByText('No sessions in this period')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// On a tablet: a session's register opens beside the list

describe('the attendance list on a tablet', () => {
  onATablet();

  let push: jest.SpyInstance;
  beforeEach(() => {
    push = jest.spyOn(router, 'push').mockImplementation(() => {});
  });
  afterEach(() => push.mockRestore());

  const THURSDAY = session({ id: 'sess-2', name: 'Thursday training', can_edit: true });

  async function open(who: Who, sessions = [session({ can_edit: true }), THURSDAY]) {
    await openList(who, {
      attendance_sessions_list: sessions,
      attendance_register: REGISTER,
      absences_on: [],
      injured_on: [],
    });
  }
  const beside = () => within(screen.getByTestId('detail-pane'));
  const list = () => within(screen.getByTestId('list-pane'));
  const calls = (name: string) =>
    ((supabase.rpc as jest.Mock).mock.calls as [string, unknown][]).filter(([n]) => n === name);

  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['manager', 'manager'],
    ['committee member', 'committee'],
    ['admin', 'admin'],
  ])('shows a %s the sessions with no register open until one is tapped', async (_l, who) => {
    await open(who);
    expect(beside().getByText('Choose a session to open its register here.')).toBeTruthy();
    expect(list().getByText('Tuesday training')).toBeTruthy();
    expect(calls('attendance_register')).toHaveLength(0);
  });

  it('opens the tapped session’s register beside the list', async () => {
    await open('coach');
    await fireEvent.press(list().getByText('Thursday training'));
    await settle();
    expect(push).not.toHaveBeenCalled();
    expect(calls('attendance_register')).toEqual([['attendance_register', { p_session_id: 'sess-2' }]]);
    expect(beside().getByText('Second Athlete')).toBeTruthy();
    expect(beside().getByText('Change attendance')).toBeTruthy();
    expect(list().getByText('Tuesday training')).toBeTruthy();
    expect(list().queryByText('Second Athlete')).toBeNull();
  });

  it('keeps the sessions in one column beside the register', async () => {
    await open('coach');
    expect(list().queryByTestId('columns')).toBeNull();
    expect(list().queryByTestId('card-grid-2')).toBeNull();
    expect(list().queryByTestId('card-grid-3')).toBeNull();
  });

  it('shows the register read-only to someone who can’t correct it, as its own screen does', async () => {
    await open('committee', [session({ can_edit: false })]);
    await fireEvent.press(list().getByText('Tuesday training'));
    await settle();
    expect(beside().getByText('1 of 3 present · 1 not marked')).toBeTruthy();
    expect(beside().queryByText('Change attendance')).toBeNull();
    expect(beside().queryAllByRole('radio')).toHaveLength(0);
  });

  it('reloads the list when the marks are saved, and keeps the register open', async () => {
    await open('coach');
    await fireEvent.press(list().getByText('Tuesday training'));
    await settle();
    await fireEvent.press(beside().getByText('Change attendance'));
    const before = calls('attendance_sessions_list').length;
    await fireEvent.press(beside().getByText('Save changes'));
    await settle();
    expect(calls('save_attendance')).toHaveLength(1);
    // Once for the register, once for the list beside it.
    expect(calls('attendance_sessions_list').length).toBe(before + 2);
    expect(beside().getByText('Second Athlete')).toBeTruthy();
  });

  it('still opens an athlete’s record on its own screen, which has its own rule on who may open it', async () => {
    await open('committee');
    await fireEvent.press(list().getByText('Athletes'));
    await settle();
    await fireEvent.press(list().getByText('Sample Child'));
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/attendance/athlete/[id]' }),
    );
    expect(beside().getByText('Choose a session to open its register here.')).toBeTruthy();
  });

  it.each<Who>(['physio', 'athlete', 'guardian', 'stoodDownCoach'])(
    'gives %p, who the database returns no sessions to, nothing to open',
    async (who) => {
      await open(who, []);
      expect(list().getByText('No attendance has been taken yet.')).toBeTruthy();
      expect(beside().getByText('Choose a session to open its register here.')).toBeTruthy();
      expect(calls('attendance_register')).toHaveLength(0);
    },
  );
});

describe('the attendance list on a phone', () => {
  it('opens a session’s register on its own screen', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    try {
      await openList('coach');
      expect(screen.queryByTestId('list-detail')).toBeNull();
      await fireEvent.press(screen.getByText('Tuesday training'));
      expect(push).toHaveBeenCalledWith({ pathname: '/attendance/[id]', params: { id: 'sess-1' } });
    } finally {
      push.mockRestore();
    }
  });
});
