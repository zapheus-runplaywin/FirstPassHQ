/**
 * Training load prompts on screen (20261028000000_load_monitoring.sql): the
 * coach's Training load list and "Talked with them", what a parent sees once
 * a coach has checked in (and never before, and never the note), the
 * athlete's own line, the Child Safety Officer's patterns, the Club settings
 * choices, and the "Training load flags" switch. Which flags come back is the
 * database's rule, so the tests seed what it would return. Every flag shown
 * names its published source.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import ClubSettingsScreen from '@/app/admin/club';
import CheckInScreen from '@/app/check-in';
import AthleteCheckInsScreen from '@/app/check-ins/athlete/[id]';
import CheckInsScreen from '@/app/check-ins/index';
import TrainingLoadScreen from '@/app/check-ins/load';
import ConcernsScreen from '@/app/concerns/index';
import LoadPatternsScreen from '@/app/concerns/load';
import type { AthleteLoad, CoachLoadRow, LoadPatternRow } from '@/lib/load-monitoring';
import { LOAD_SOURCES } from '@/lib/load-sources';
import type { SessionLog } from '@/lib/types';

import { argsOf, clearCalls, rpcNames } from './helpers/forms';
import {
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  settle,
  type BackendOptions,
  type Persona,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  useAdminPushNotifications: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));

type Who = PersonaName | Persona;

let openURL: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  setClubFeatures({ trainingLoad: true });
  clearCalls();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => openURL.mockRestore());

const CAVEAT = /^Training load is a conversation starter, not a diagnosis\. These figures/;

function load(extra: Partial<AthleteLoad> = {}): AthleteLoad {
  return {
    flags: [],
    ratio: 1.1,
    weeks_before: 3,
    reviewed_on: null,
    reviewer_name: null,
    reviewed_flags: null,
    review_note: null,
    adult: true,
    ...extra,
  };
}

function session(day: string, minutes: number, rpe: number): SessionLog {
  return {
    id: `s-${day}-${minutes}`,
    athlete_id: 'child-1',
    day,
    kind: 'training',
    minutes,
    rpe,
    updated_at: `${day}T08:00:00Z`,
  };
}

async function press(text: string | RegExp) {
  fireEvent.press(screen.getByText(text));
  await settle();
}

// ---------------------------------------------------------------------------
// The coach's list

const ROWS: CoachLoadRow[] = [
  {
    athlete_id: 'a1',
    athlete_name: 'Sample Athlete',
    flags: ['ratio', 'wellbeing'],
    ratio: 1.64,
    minutes_7d: 420,
    sessions_7d: 7,
    reviewed_on: null,
    reviewer_name: null,
  },
  {
    athlete_id: 'a2',
    athlete_name: 'Sample Junior',
    flags: ['hours'],
    ratio: null,
    minutes_7d: 905,
    sessions_7d: 8,
    reviewed_on: '2026-10-17',
    reviewer_name: 'Sample Coach',
  },
];

async function openList(options: BackendOptions = {}) {
  await openScreen('coach', { 'check-ins/load': TrainingLoadScreen }, '/check-ins/load', {}, options);
}

describe('the coach’s training load list', () => {
  it('lists athletes to talk with first, then those talked with, with the reasons', async () => {
    await openList({ rpcs: { coach_load_flags: ROWS } });
    expect(rpcNames()).toContain('coach_load_flags');
    expect(screen.getByText('Worth a chat')).toBeTruthy();
    expect(screen.getByText('Talked with this week')).toBeTruthy();
    expect(screen.getByText('Load jumped: the last 7 days are well above the last 4 weeks')).toBeTruthy();
    expect(screen.getByText('Also 2 or more low check-ins in the last 7 days')).toBeTruthy();
    expect(screen.getByText('More hours of sport in 7 days than their age in years')).toBeTruthy();
    expect(screen.getByText('7 sessions · 420 min in the last 7 days · ratio 1.64')).toBeTruthy();
    expect(screen.getByText(/905 min in the last 7 days · Sample Coach talked with them/)).toBeTruthy();
  });

  it('carries the caveat', async () => {
    await openList({ rpcs: { coach_load_flags: [] } });
    expect(screen.getByText('No training load flags this week.')).toBeTruthy();
    expect(screen.getByText(CAVEAT)).toBeTruthy();
  });

  it('opens the sources behind the flags, each linking to the paper', async () => {
    await openList({ rpcs: { coach_load_flags: ROWS } });
    expect(screen.queryByText(LOAD_SOURCES.jayanthi2015.finding)).toBeNull();
    await press('Where these flags come from');
    expect(screen.getByText(LOAD_SOURCES.jayanthi2015.finding)).toBeTruthy();
    expect(screen.getByText(LOAD_SOURCES.gabbett2016.finding)).toBeTruthy();
    expect(screen.getByText(LOAD_SOURCES.saw2016.finding)).toBeTruthy();
    fireEvent.press(screen.getByText(/^Jayanthi et al\. 2015: /));
    expect(openURL).toHaveBeenCalledWith('https://doi.org/10.1177/0363546514567298');
  });

  it('shows the database’s refusal', async () => {
    await openList({ rpcErrors: { coach_load_flags: 'Only coaches see training load flags' } });
    expect(screen.getByText('Only coaches see training load flags.')).toBeTruthy();
  });
});

describe('the Check-ins screen', () => {
  it('gives a coach a Training load card with how many are worth a chat', async () => {
    await openScreen('coach', { 'check-ins/index': CheckInsScreen }, '/check-ins', {}, {
      rpcs: { coach_load_flag_count: 2 },
    });
    expect(screen.getByText('Training load')).toBeTruthy();
    expect(screen.getByText('2 athletes worth a chat about their training this week')).toBeTruthy();
  });

  it('shows no card and asks nothing while the club has training load flags off', async () => {
    setClubFeatures({});
    await openScreen('coach', { 'check-ins/index': CheckInsScreen }, '/check-ins', {}, {
      rpcs: { coach_load_flag_count: 2 },
    });
    expect(screen.queryByText('Training load')).toBeNull();
    expect(rpcNames()).not.toContain('coach_load_flag_count');
  });
});

// ---------------------------------------------------------------------------
// One athlete's page

async function openAthlete(who: Who, athleteLoad: AthleteLoad | null, rows: SessionLog[] = [], options: BackendOptions = {}) {
  await openScreen(
    who,
    { 'check-ins/athlete/[id]': AthleteCheckInsScreen },
    '/check-ins/athlete/child-1?name=Sample%20Child',
    { session_logs: rows },
    { ...options, rpcs: { athlete_load: athleteLoad, ...options.rpcs } },
  );
}

describe('an athlete’s training load, for their coach', () => {
  it('shows the flags with their sources and lets the coach mark that they talked', async () => {
    await openAthlete('coach', load({ flags: ['ratio', 'injury'], ratio: 1.64 }), [session('2026-10-18', 60, 7)]);
    expect(argsOf('athlete_load')).toContainEqual({ p_athlete: 'child-1' });
    expect(screen.getByText('Worth a chat')).toBeTruthy();
    expect(screen.getByText(/Load jumped/)).toBeTruthy();
    expect(screen.getByText(/Logged a session while an injury with restrictions isn’t cleared/)).toBeTruthy();
    expect(screen.getByText(/comes from the club’s own injury record/)).toBeTruthy();
    expect(screen.getByText('Load ratio (last 7 days against the last 28): 1.64.', { exact: false })).toBeTruthy();
    await press('Why this flag');
    expect(screen.getByText(LOAD_SOURCES.gabbett2016.finding)).toBeTruthy();
    expect(screen.getByText(LOAD_SOURCES.impellizzeri2020.finding)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Note for coaches (optional)'), '  Easing off this week  ');
    await press('Talked with them');
    expect(argsOf('review_load_flag')).toEqual([{ p_athlete: 'child-1', p_note: 'Easing off this week' }]);
  });

  it('sends no note when the coach leaves it blank', async () => {
    await openAthlete('coach', load({ flags: ['hours'] }));
    await press('Talked with them');
    expect(argsOf('review_load_flag')).toEqual([{ p_athlete: 'child-1', p_note: null }]);
  });

  it('shows the database’s refusal', async () => {
    await openAthlete('coach', load({ flags: ['hours'] }), [], {
      rpcErrors: { review_load_flag: 'Only the athlete’s coaches can mark this' },
    });
    await press('Talked with them');
    expect(screen.getByText('Only the athlete’s coaches can mark this')).toBeTruthy();
  });

  it('shows who talked with them and the coaches’ note once marked', async () => {
    await openAthlete(
      'coach',
      load({
        flags: ['ratio'],
        reviewed_on: '2026-10-17',
        reviewer_name: 'Sample Coach',
        reviewed_flags: ['ratio'],
        review_note: 'Busy week',
      }),
    );
    expect(screen.getByText(/Sample Coach talked with them on .*Their flags are closed for 7 days\./)).toBeTruthy();
    expect(screen.getByText('Note (coaches only): Busy week')).toBeTruthy();
    expect(screen.queryByText('Talked with them')).toBeNull();
  });

  it('says when there are no flags, and when there isn’t enough history for the ratio', async () => {
    await openAthlete('coach', load({ ratio: null, weeks_before: 1 }));
    expect(screen.getByText('No load flags this week.')).toBeTruthy();
    expect(screen.getByText(/Load ratio: not enough sessions yet\. Prompts for a rise in load start once/)).toBeTruthy();
  });

  it('shows effort, monotony and strain, which never flag', async () => {
    await openAthlete('coach', load(), [
      session('2026-10-12', 60, 5),
      session('2026-10-14', 60, 5),
      session('2026-10-16', 60, 5),
      session('2026-10-18', 60, 5),
    ]);
    expect(screen.getByText('Average effort, last 7 days: 5 out of 10.')).toBeTruthy();
    expect(screen.getByText(/^Monotony 1\.2 and strain 1440, last 7 days\. Shown for interest: no cut-off is proven/)).toBeTruthy();
    await press('About these numbers');
    expect(screen.getByText(LOAD_SOURCES.foster1998.finding)).toBeTruthy();
  });

  it('draws fitness, fatigue and form for an adult, never for an under 18', async () => {
    await openAthlete('coach', load({ adult: true }), [session('2026-10-18', 60, 7)]);
    expect(screen.getByText('Fitness, fatigue and form')).toBeTruthy();
    await press('About this chart');
    expect(screen.getByText(LOAD_SOURCES.coggan.finding)).toBeTruthy();
  });

  it('draws no fitness chart for an under 18', async () => {
    await openAthlete('coach', load({ adult: false }), [session('2026-10-18', 60, 7)]);
    expect(screen.queryByText('Fitness, fatigue and form')).toBeNull();
    expect(screen.getByText(CAVEAT)).toBeTruthy();
  });
});

describe('an athlete’s training load, for a parent', () => {
  it('shows nothing before a coach has checked in', async () => {
    await openAthlete('guardian', load({ flags: null, ratio: null, weeks_before: null, adult: false }));
    expect(screen.queryByText('Training load')).toBeNull();
    expect(screen.queryByText(CAVEAT)).toBeNull();
  });

  it('shows a calm card once a coach has, with what it was about and the sources, never the note', async () => {
    await openAthlete(
      'guardian',
      load({
        flags: null,
        ratio: null,
        weeks_before: null,
        adult: false,
        reviewed_on: '2026-10-17',
        reviewer_name: 'Sample Coach',
        reviewed_flags: ['hours'],
      }),
    );
    expect(screen.getByText('Training load')).toBeTruthy();
    expect(
      screen.getByText(
        'Sample Coach checked in with Sample Child about their training load. The club noticed they did more hours of sport in the week than their age in years. Coaches review training load as part of looking after every athlete.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Note \(coaches only\)/)).toBeNull();
    expect(screen.queryByText('Talked with them')).toBeNull();
    expect(screen.queryByText(/Load ratio/)).toBeNull();
    expect(screen.getByText(CAVEAT)).toBeTruthy();
    await press('Why the club looks at this');
    expect(screen.getByText(LOAD_SOURCES.jayanthi2015.finding)).toBeTruthy();
  });

  it('shows nothing and asks nothing while the club has training load flags off', async () => {
    setClubFeatures({});
    await openAthlete('guardian', load({ flags: null, reviewed_on: '2026-10-17', reviewer_name: 'Sample Coach' }));
    expect(screen.queryByText(/checked in with Sample Child/)).toBeNull();
    expect(rpcNames()).not.toContain('athlete_load');
  });
});

describe('the athlete’s own line', () => {
  async function openCheckIn(athleteLoad: AthleteLoad) {
    await openScreen('athlete', { 'check-in': CheckInScreen }, '/check-in', {}, {
      rpcs: { athlete_load: athleteLoad },
    });
  }

  it('is gentle when they’re flagged, with the source', async () => {
    await openCheckIn(load({ flags: ['hours'] }));
    expect(screen.getByText('A big week')).toBeTruthy();
    expect(screen.getByText(/You did more hours of sport this week than your age in years/)).toBeTruthy();
    expect(screen.getByText(/Your coach may check in about how you’re going\. It’s not a warning/)).toBeTruthy();
    await press('Why this flag');
    expect(screen.getByText(LOAD_SOURCES.jayanthi2015.finding)).toBeTruthy();
  });

  it('isn’t there without a flag', async () => {
    await openCheckIn(load());
    expect(screen.queryByText('A big week')).toBeNull();
  });

  it('asks athletes to rate soon after and to log other sport', async () => {
    await openCheckIn(load());
    expect(screen.getByText(/Rate each session about 30 minutes after it ends, and log school, representative/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The Child Safety Officer

const officer: Persona = { ...personas.coach, isSafeguardingOfficer: true };

const PATTERNS: LoadPatternRow[] = [
  { athlete_id: 'c1', athlete_name: 'Sample Junior', pattern: 'hours_2_weeks', since: '2026-10-11' },
  { athlete_id: 'c1', athlete_name: 'Sample Junior', pattern: 'with_wellbeing', since: '2026-10-18' },
];

describe('training load patterns for the Child Safety Officer', () => {
  it('lists each child’s patterns and when they started, with the caveat', async () => {
    await openScreen(officer, { 'concerns/load': LoadPatternsScreen }, '/concerns/load', {}, {
      rpcs: { load_patterns: PATTERNS },
    });
    expect(screen.getByText('Sample Junior')).toBeTruthy();
    expect(screen.getByText(/^More hours of sport than their age, 2 weeks running · since /)).toBeTruthy();
    expect(screen.getByText(/^A load flag alongside 2 or more low check-ins this week · since /)).toBeTruthy();
    expect(screen.getByText(CAVEAT)).toBeTruthy();
    expect(screen.getByText('Raise a concern')).toBeTruthy();
  });

  it('says when there’s nothing to look at', async () => {
    await openScreen(officer, { 'concerns/load': LoadPatternsScreen }, '/concerns/load', {}, {
      rpcs: { load_patterns: [] },
    });
    expect(screen.getByText('No training load patterns to look at.')).toBeTruthy();
  });

  it('shows the database’s refusal to anyone else', async () => {
    await openScreen('admin', { 'concerns/load': LoadPatternsScreen }, '/concerns/load', {}, {
      rpcErrors: { load_patterns: 'Only the Child Safety Officer sees training load patterns' },
    });
    expect(screen.getByText('Only the Child Safety Officer sees training load patterns.')).toBeTruthy();
  });

  it('gives the officer a button on the concerns register, with the count', async () => {
    await openScreen(officer, { 'concerns/index': ConcernsScreen }, '/concerns', {}, {
      rpcs: { concern_register: [], wellbeing_flag_alerts: 0, load_pattern_alerts: 1 },
    });
    expect(screen.getByText('Training load patterns (1 to look at)')).toBeTruthy();
  });

  it('gives no button while the club has training load flags off', async () => {
    setClubFeatures({});
    await openScreen(officer, { 'concerns/index': ConcernsScreen }, '/concerns', {}, {
      rpcs: { concern_register: [], wellbeing_flag_alerts: 0, load_pattern_alerts: 1 },
    });
    expect(screen.queryByText(/Training load patterns/)).toBeNull();
    expect(rpcNames()).not.toContain('load_pattern_alerts');
  });
});

// ---------------------------------------------------------------------------
// Club settings

const RETENTION_RPCS = {
  physios_get_club_messages: false,
  load_monitoring_settings: { ratio_flag: 'from_1_5', hours_flag: true },
};

describe('Club settings: training load flags', () => {
  it('offers only published values, with their sources, and saves the admin’s choice', async () => {
    await openScreen('admin', { 'admin/club': ClubSettingsScreen }, '/admin/club', {}, { rpcs: RETENTION_RPCS });
    expect(screen.getByText('Save training load flags')).toBeTruthy();
    expect(screen.getByText('Gabbett 2016’s “danger zone”. Fewer, clearer prompts. The default.')).toBeTruthy();
    await press('Above 1.3');
    expect(screen.getByText('Above Gabbett 2016’s 0.8 to 1.3 “sweet spot”. Earlier, more frequent prompts.')).toBeTruthy();
    fireEvent(screen.getByLabelText('Hours over age (under 18s)'), 'valueChange', false);
    await press('Save training load flags');
    expect(argsOf('admin_set_load_monitoring')).toEqual([{ p_ratio_flag: 'above_1_3', p_hours_flag: false }]);
    expect(screen.getByText('Training load flags saved.')).toBeTruthy();
  });

  it('shows the database’s refusal', async () => {
    await openScreen('admin', { 'admin/club': ClubSettingsScreen }, '/admin/club', {}, {
      rpcs: RETENTION_RPCS,
      rpcErrors: { admin_set_load_monitoring: 'Only admins can change training load flags' },
    });
    await press('Save training load flags');
    expect(screen.getByText('Only admins can change training load flags')).toBeTruthy();
  });

  it('hides the choices until the club turns the feature on', async () => {
    setClubFeatures({});
    await openScreen('admin', { 'admin/club': ClubSettingsScreen }, '/admin/club', {}, { rpcs: RETENTION_RPCS });
    expect(screen.queryByText('Save training load flags')).toBeNull();
    expect(screen.getByLabelText('Training load flags')).toBeTruthy();
  });
});
