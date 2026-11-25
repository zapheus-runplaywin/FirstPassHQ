/**
 * What the check-ins screens (src/app/check-ins/index.tsx and athlete/[id].tsx)
 * show each kind of member once they're open.
 *
 * Coaches see their own athletes day by day, names, scores and notes; the
 * committee, physios and admins see only squad and team averages, never an
 * individual (section 11 of the user guide, and `useCanSeeCheckInOverview`).
 * A coach whose role is paused sees neither. Which athletes are on a coach's
 * board, and which check-ins an athlete's page holds, come from the database,
 * which leaves out an under-18 until a parent or guardian consents, so the
 * tests seed what it would return and check the screen shows that.
 */
import { fireEvent, screen } from 'expo-router/testing-library';

import AthleteCheckInsScreen from '@/app/check-ins/athlete/[id]';
import CheckInsScreen from '@/app/check-ins/index';
import { supabase } from '@/lib/supabase';
import type { CheckIn, CheckInBoardRow, CheckInOverviewRow, CheckInSummary } from '@/lib/types';

import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  type Persona,
  type PersonaName,
  type QueryInfo,
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

const SUMMARY: CheckInSummary[] = [
  {
    team_id: TEAM.id,
    team_name: TEAM.name,
    team_kind: 'team',
    squad_id: null,
    athlete_count: 3,
    checked_in_count: 2,
    flagged_count: 1,
  },
];

const BOARD: CheckInBoardRow[] = [
  {
    athlete_id: 'a-low',
    full_name: 'Low Sleeper',
    sleep: 2,
    soreness: 4,
    stress: 3,
    mood: 4,
    note: 'Exams this week',
    checked_in_at: '2026-10-17T22:00:00Z',
  },
  {
    athlete_id: 'a-fine',
    full_name: 'Fine Athlete',
    sleep: 4,
    soreness: 4,
    stress: 4,
    mood: 5,
    note: null,
    checked_in_at: '2026-10-17T22:30:00Z',
  },
  {
    athlete_id: 'a-missing',
    full_name: 'Not Yet',
    sleep: null,
    soreness: null,
    stress: null,
    mood: null,
    note: null,
    checked_in_at: null,
  },
];

const OVERVIEW: CheckInOverviewRow[] = [
  {
    team_id: TEAM.id,
    team_name: TEAM.name,
    team_kind: 'team',
    season: 2026,
    athlete_count: 12,
    checked_in_count: 9,
    flagged_count: 2,
    avg_sleep: 3.5,
    avg_soreness: 4,
    avg_stress: 3.25,
    avg_mood: 4.1,
  },
  {
    // Fewer than 3 check-ins: no scores, so they can't point to one athlete.
    team_id: 'team-u16',
    team_name: 'Under 16',
    team_kind: 'squad',
    season: 2026,
    athlete_count: 10,
    checked_in_count: 2,
    flagged_count: null,
    avg_sleep: null,
    avg_soreness: null,
    avg_stress: null,
    avg_mood: null,
  },
];

const AVERAGES = 'Sleep 3.5 · Soreness 4.0 · Stress 3.3 · Mood 4.1';

const rpcNames = () => ((supabase.rpc as jest.Mock).mock.calls as [string][]).map(([n]) => n);

/**
 * Opens the screen with a backend that answers every check-in RPC, as if
 * the member could see everything: the screen must still only show what
 * their role allows.
 */
async function openCheckIns(who: Who, rpcs: Record<string, unknown> = {}, url = '/check-ins') {
  await openScreen(who, { 'check-ins/index': CheckInsScreen }, url, { teams: [TEAM] }, {
    rpcs: {
      check_in_summary: SUMMARY,
      check_in_board: BOARD,
      check_in_overview: OVERVIEW,
      check_in_trend: [],
      ...rpcs,
    },
  });
}

/** Text only each part of the screen shows. */
const PARTS = {
  dayByDay: 'Your squads and teams',
  athleteNames: 'Low Sleeper',
  notes: '“Exams this week”',
  overview: 'Club overview',
  averages: AVERAGES,
} as const;
type Part = keyof typeof PARTS;

function shownParts() {
  return (Object.keys(PARTS) as Part[]).filter((p) => screen.queryAllByText(PARTS[p]).length > 0);
}

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
  (supabase.from as jest.Mock).mockClear();
});

describe('the check-ins screen', () => {
  const COACHES: [string, Who][] = [
    ['coach', 'coach'],
    ['assistant coach', morePersonas.assistantCoach],
    ['coach who is also a guardian', morePersonas.coachGuardian],
    ['athlete who also coaches', morePersonas.athleteCoach],
  ];

  it.each(COACHES)('shows a %s their athletes day by day, with names and notes', async (_l, who) => {
    await openCheckIns(who);
    expect(shownParts()).toEqual(['dayByDay', 'athleteNames', 'notes']);
    expect(screen.getByText(/^2 of 3 checked in · 1 flagged\./)).toBeTruthy();
    expect(screen.getByText('Check in with')).toBeTruthy();
    expect(screen.getByText('Low sleep')).toBeTruthy();
    expect(screen.getByText('Feeling good')).toBeTruthy();
    expect(screen.getByText('Fine Athlete')).toBeTruthy();
    expect(screen.getByText('Not checked in')).toBeTruthy();
    expect(screen.getByText('Not Yet')).toBeTruthy();
  });

  const AVERAGES_ONLY: [string, Who][] = [
    ['committee member', 'committee'],
    ['physio', 'physio'],
    ['Head Physio', morePersonas.headPhysio],
    ['admin', 'admin'],
    ['admin whose check lapsed', 'adminExpiredCheck'],
  ];

  it.each(AVERAGES_ONLY)('shows a %s squad and team averages only, never an athlete', async (_l, who) => {
    await openCheckIns(who);
    expect(shownParts()).toEqual(['overview', 'averages']);
    expect(screen.getByText('Team · 9 of 12 checked in')).toBeTruthy();
    expect(screen.getByText('2 flagged')).toBeTruthy();
    expect(screen.getByText('Scores show once 3 athletes have checked in')).toBeTruthy();
    expect(screen.queryByText('Fine Athlete')).toBeNull();
    expect(screen.queryByText('Not Yet')).toBeNull();
    // They never ask for a coach's board or summary.
    expect(rpcNames()).not.toContain('check_in_board');
    expect(rpcNames()).not.toContain('check_in_summary');
  });

  it('shows an admin who also coaches both the overview and their own athletes', async () => {
    await openCheckIns({
      ...personas.coach,
      profile: { ...personas.coach.profile!, role: 'admin', extra_roles: ['coach'] },
    });
    expect(shownParts()).toEqual(['dayByDay', 'athleteNames', 'notes', 'overview', 'averages']);
  });

  const NEITHER: [string, Who][] = [
    ['manager', 'manager'],
    ['athlete', 'athlete'],
    ['guardian', 'guardian'],
    ['guest', 'guest'],
    // Paused roles: their memberships and roles are left out.
    ['coach whose check lapsed', 'coachExpiredCheck'],
    ['stood-down coach', 'stoodDownCoach'],
    ['stood-down admin', 'stoodDownAdmin'],
    ['committee member whose check lapsed', morePersonas.committeeExpiredCheck],
  ];

  it.each(NEITHER)('shows a %s no athletes and no averages', async (_l, who) => {
    await openCheckIns(who);
    expect(shownParts()).toEqual([]);
    expect(rpcNames()).not.toContain('check_in_board');
    expect(rpcNames()).not.toContain('check_in_overview');
  });

  it('hides a squad whose squad phase is complete from its coach', async () => {
    const coach = personas.coach;
    await openCheckIns({
      ...coach,
      memberships: [
        { ...coach.memberships[0], team: { ...TEAM, kind: 'squad', selections_completed_at: '2026-09-01T00:00:00Z' } },
      ],
    });
    expect(shownParts()).toEqual([]);
  });

  it('tells a coach with no group so', async () => {
    await openCheckIns('coach', { check_in_summary: [] });
    expect(screen.getByText(/You don’t coach a squad that’s still in its squad phase/)).toBeTruthy();
    expect(rpcNames()).not.toContain('check_in_board');
  });

  it('tells a coach under-18s show once a guardian consents, when the board is empty', async () => {
    await openCheckIns('coach', { check_in_board: [] });
    expect(
      screen.getByText(
        'No athletes to show. Athletes under 18 show here once a parent or guardian gives consent.',
      ),
    ).toBeTruthy();
  });

  it('offers the whole club in Trends only to those who see the overview', async () => {
    await openCheckIns('committee');
    await fireEvent.press(screen.getByText('Trends'));
    await settle();
    expect(screen.getByText('Whole club')).toBeTruthy();
  });

  it('offers a coach only their own groups in Trends', async () => {
    await openCheckIns('coach', { check_in_overview: OVERVIEW });
    await fireEvent.press(screen.getByText('Trends'));
    await settle();
    expect(screen.queryByText('Whole club')).toBeNull();
    expect(screen.getByText(TEAM.name)).toBeTruthy();
    expect(screen.queryByText('Under 16')).toBeNull();
  });

  it('tells a member with no groups there’s nothing to trend', async () => {
    await openCheckIns('manager');
    await fireEvent.press(screen.getByText('Trends'));
    await settle();
    expect(screen.getByText('There’s no squad or team to show yet.')).toBeTruthy();
  });

  it('says only team averages when the club doesn’t use squads', async () => {
    setClubFeatures({ squads: false });
    await openCheckIns('committee');
    expect(screen.getByText(/^Average scores out of 5 for each team\./)).toBeTruthy();
  });
});


describe('opened from a session on the calendar', () => {
  const SECOND = { ...SUMMARY[0], team_id: 'team-second', team_name: 'Second team' };
  const boardTeams = () =>
    ((supabase.rpc as jest.Mock).mock.calls as [string, { p_team_id?: string }][])
      .filter(([name]) => name === 'check_in_board')
      .map(([, args]) => args.p_team_id);

  it('starts on the session’s squad or team when the coach has it', async () => {
    await openCheckIns('coach', { check_in_summary: [SUMMARY[0], SECOND] }, '/check-ins?team=team-second');
    expect(boardTeams().pop()).toBe('team-second');
  });

  it('starts on their first as usual for a team that isn’t theirs', async () => {
    await openCheckIns('coach', { check_in_summary: [SUMMARY[0], SECOND] }, '/check-ins?team=someone-elses');
    expect(boardTeams()).toEqual(expect.arrayContaining([TEAM.id]));
    expect(boardTeams()).not.toContain('someone-elses');
  });
});

// ---------------------------------------------------------------------------
// One athlete's check-ins

function checkIn(day: string, extra: Partial<CheckIn> = {}): CheckIn {
  return {
    id: `ci-${day}`,
    athlete_id: 'child-1',
    day,
    sleep: 4,
    soreness: 4,
    stress: 4,
    mood: 4,
    note: null,
    updated_at: `${day}T08:00:00Z`,
    ...extra,
  };
}

async function openAthlete(who: Who, rows: CheckIn[]) {
  await openScreen(
    who,
    { 'check-ins/athlete/[id]': AthleteCheckInsScreen },
    '/check-ins/athlete/child-1?name=Sample%20Child',
    { check_ins: rows },
  );
}

describe('one athlete’s check-ins', () => {
  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['guardian', 'guardian'],
  ])('shows a %s the last four weeks the database returns, notes and low scores', async (_l, who) => {
    await openAthlete(who, [
      checkIn('2026-10-18', { sleep: 1, note: 'Bad night' }),
      checkIn('2026-10-12'),
    ]);
    expect(screen.getByText('The last four weeks. Scores are 1 (bad) to 5 (good).')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Low sleep')).toBeTruthy();
    expect(screen.getByText('“Bad night”')).toBeTruthy();
    expect(screen.getByText('Sleep 1 · Soreness 4 · Stress 4 · Mood 4')).toBeTruthy();
    expect(screen.getAllByText(/^Sleep \d · /)).toHaveLength(2);
  });

  it('asks only for this athlete’s last 28 days, and records the view', async () => {
    const asked: QueryInfo[] = [];
    await openScreen(
      'coach',
      { 'check-ins/athlete/[id]': AthleteCheckInsScreen },
      '/check-ins/athlete/child-1',
      {},
      { tableHandlers: { check_ins: (q) => (asked.push(q), []) } },
    );
    expect(asked).toHaveLength(1);
    expect(asked[0].eq('athlete_id')).toBe('child-1');
    expect(asked[0].calls).toContainEqual({ method: 'gte', args: ['day', '2026-09-20'] });
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'log_record_view',
      { p_subject_id: 'child-1', p_kind: 'check_ins', p_record_id: null },
    ]);
  });

  it.each<[string, Who]>([
    // The database gives individual check-ins only to the athlete, their
    // guardians and their coaches; the committee and physios get averages.
    ['committee member', 'committee'],
    ['physio', 'physio'],
    ['admin', 'admin'],
  ])('shows a %s nothing but the empty message when the database returns no rows', async (_l, who) => {
    await openAthlete(who, []);
    expect(screen.getByText('No check-ins yet.')).toBeTruthy();
    expect(screen.queryByText(/^Sleep \d · /)).toBeNull();
  });
});
