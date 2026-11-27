/**
 * Selection rounds, part 3 (committee auditors per round, 27 November 2026):
 * the Selection audits card on Today, the auditor's list of rounds, a round
 * in three tabs, an athlete's whole assessment read only, and the admin's
 * Auditors tab.
 *
 * Who audits what, and that an auditor never reads their own child's
 * assessment, is the database's call (supabase/tests/selection-auditors.sql).
 * The screens show what each function returns and the database's refusal.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import AdminRoundScreen from '@/app/admin/assessments/round';
import TodayScreen from '@/app/(tabs)/index';
import AuditAthleteScreen from '@/app/audits/athlete';
import AuditsScreen from '@/app/audits/index';
import AuditRoundScreen from '@/app/audits/round';
import {
  auditAthleteLine,
  auditorNotes,
  auditsHomeHref,
  auditsLabel,
  makeCriteria,
  personHistoryLine,
  type AdminRound,
  type AuditorAssessment,
  type AuditRound,
  type MyAudit,
  type RoundAuditor,
} from '@/lib/assessments';

import { clearCalls, onlyRpcCall, rpcCalls, rpcNames } from './helpers/calls';
import { inTabs, openScreen, resetClub, setClubFeatures, settle, type BackendOptions } from './helpers/harness';

const HomeScreen = inTabs(TodayScreen);

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
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system', () => {
  class MockFile {
    static written: { uri: string; bytes: Uint8Array }[] = [];
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`;
    }
    write(bytes: Uint8Array) {
      MockFile.written.push({ uri: this.uri, bytes });
    }
  }
  return { File: MockFile, Paths: { cache: 'file:///cache' } };
});


jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  setClubFeatures({ selectionAssessments: true });
  clearCalls();
});

const placeholder = (route: string) =>
  function Shown() {
    return <Text>{`screen:${route}`}</Text>;
  };

const press = async (text: string | RegExp, index = 0) => {
  await fireEvent.press(screen.getAllByText(text)[index]);
  await settle(6);
};

// The harness's today is 18 October 2026.
const CRITERIA = makeCriteria([{ name: 'Technical ability', items: ['Passing', 'Catching'] }]);

function audit(extra: Partial<MyAudit> = {}): MyAudit {
  return {
    id: 'r1',
    name: 'Phase 1, Round 1',
    phase: 1,
    round_number: 1,
    team_name: '17 & Under squad',
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed_at: null,
    criteria_set_name: 'Netball',
    athletes: 3,
    observations: 7,
    ...extra,
  };
}

function auditRound(extra: Partial<AuditRound> = {}): AuditRound {
  return {
    id: 'r1',
    name: 'Phase 1, Round 1',
    phase: 1,
    round_number: 1,
    team_name: '17 & Under squad',
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed: false,
    criteria: CRITERIA,
    criteria_set_name: 'Netball',
    criteria_set_version: 1,
    today: '2026-10-18',
    hidden: 0,
    panel: [
      { name: 'Casey Coach', added_at: '2026-10-04T01:00:00Z', added_by_name: 'Sample admin', removed_at: null, removed_by_name: null },
    ],
    auditors: [
      { name: 'Ari Auditor', added_at: '2026-10-04T01:00:00Z', added_by_name: 'Sample admin', removed_at: null, removed_by_name: null },
    ],
    athletes: [
      { id: 'a1', name: 'Jordan Junior', is_minor: true, observations: 3, selectors: 2, summaries_signed: 1, selectors_on_panel: 2, feedback: 'shared' },
      { id: 'a2', name: 'Kai Senior', is_minor: false, observations: 1, selectors: 1, summaries_signed: 0, selectors_on_panel: 2, feedback: 'none' },
    ],
    ...extra,
  } as AuditRound;
}

function assessment(extra: Partial<AuditorAssessment> = {}): AuditorAssessment {
  return {
    round_id: 'r1',
    round_name: 'Phase 1, Round 1',
    phase: 1,
    round_number: 1,
    team_name: '17 & Under squad',
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed: false,
    criteria: CRITERIA,
    today: '2026-10-18',
    athlete_id: 'a1',
    athlete_name: 'Jordan Junior',
    is_minor: true,
    observations: [],
    summaries: [
      {
        id: 's1',
        author_name: 'Casey Coach',
        ratings: [],
        recommendation: 'Select',
        strengths: 'Reads the play',
        priorities: 'Left hand',
        comments: '',
        signed_at: '2026-10-16T03:00:00Z',
      },
    ],
    unsigned: 1,
    summary_events: [{ author_name: 'Casey Coach', kind: 'signed', late: false, by_name: 'Casey Coach', at: '2026-10-16T03:00:00Z' }],
    feedback: { draft: true },
    feedback_events: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Helpers

describe('auditor helpers', () => {
  const auditor = (extra: Partial<RoundAuditor> = {}): RoundAuditor => ({
    profile_id: 'p1',
    name: 'Ari Auditor',
    added_at: '2026-10-04T01:00:00Z',
    added_by_name: null,
    removed_at: null,
    removed_by_name: null,
    can_audit: true,
    own_children: 0,
    is_admin: false,
    other_rounds: 0,
    ...extra,
  });

  it('notes nothing for a plain auditor', () => {
    expect(auditorNotes(auditor())).toEqual([]);
  });

  it('notes own children, admin, a lapsed check and other rounds, in that order', () => {
    expect(auditorNotes(auditor({ own_children: 2, is_admin: true, can_audit: false, other_rounds: 1 }))).toEqual([
      'Can’t check 2 athletes in this round: their own child',
      'Also an admin',
      'Can’t audit now: needs a current Working With Children Check',
      'Audits 1 other round',
    ]);
  });

  it('says nothing about the check for someone already taken off', () => {
    expect(auditorNotes(auditor({ can_audit: false, removed_at: '2026-10-10T00:00:00Z' }))).toEqual([]);
  });

  it('names the one round, or counts several', () => {
    expect(auditsLabel([audit()])).toBe('Phase 1, Round 1');
    expect(auditsLabel([audit(), audit({ id: 'r2' }), audit({ id: 'r3' })])).toBe('3 rounds to audit');
    expect(auditsHomeHref([audit()])).toEqual({ pathname: '/audits/round', params: { id: 'r1' } });
    expect(auditsHomeHref([audit(), audit({ id: 'r2' })])).toBe('/audits');
  });

  it('counts an athlete’s observations, selectors and summaries', () => {
    expect(auditAthleteLine(auditRound().athletes[0])).toBe('3 observations by 2 selectors · 1 of 2 summaries signed');
    expect(auditAthleteLine(auditRound().athletes[1])).toBe('1 observation by 1 selector · 0 of 2 summaries signed');
  });

  it('writes a person’s history', () => {
    const p = { name: 'Ari', added_at: '2026-10-04T01:00:00Z', added_by_name: 'Sam', removed_at: null, removed_by_name: null };
    expect(personHistoryLine(p)).toMatch(/^Ari: added .* by Sam$/);
    expect(personHistoryLine({ ...p, independent: true, removed_at: '2026-10-10T00:00:00Z', removed_by_name: 'Lee' })).toMatch(
      /^Ari \(independent\): added .*, removed .* by Lee$/,
    );
  });
});

// ---------------------------------------------------------------------------
// Today

describe('the Selection audits card on Today', () => {
  async function openHome(audits: MyAudit[], who: 'committee' | 'coach' = 'committee') {
    await openScreen(
      who,
      { index: HomeScreen, audits: placeholder('audits'), 'audits/round': placeholder('audits/round') },
      '/',
      {},
      { rpcs: { my_selection_audits: audits } },
    );
  }

  it('names the one round a committee member audits, and opens it', async () => {
    await openHome([audit()]);
    expect(screen.getByText('Selection audits')).toBeTruthy();
    await press('Phase 1, Round 1');
    expect(screen.getByText('screen:audits/round')).toBeTruthy();
  });

  it('counts three rounds and opens the list', async () => {
    await openHome([audit(), audit({ id: 'r2' }), audit({ id: 'r3' })]);
    await press('3 rounds to audit');
    expect(screen.getByText('screen:audits')).toBeTruthy();
  });

  it('shows no card when they audit nothing', async () => {
    await openHome([]);
    expect(screen.queryByText('Selection audits')).toBeNull();
  });

  it('never asks for a coach who isn’t on the committee', async () => {
    await openHome([audit()], 'coach');
    expect(rpcNames()).not.toContain('my_selection_audits');
    expect(screen.queryByText('Selection audits')).toBeNull();
  });

  it('never asks with the switch off', async () => {
    setClubFeatures({ selectionAssessments: false });
    await openHome([audit()]);
    expect(rpcNames()).not.toContain('my_selection_audits');
  });
});

// ---------------------------------------------------------------------------
// The list and a round

describe('the rounds an auditor audits', () => {
  it('lists each round with its squad, dates, criteria and counts, and opens one', async () => {
    await openScreen('committee', { audits: AuditsScreen, 'audits/round': placeholder('audits/round') }, '/audits', {}, {
      rpcs: { my_selection_audits: [audit(), audit({ id: 'r2', name: 'Phase 1, Round 2', round_number: 2, closed_at: '2026-10-10T00:00:00Z' })] },
    });
    expect(screen.getAllByText(/17 & Under squad · .* · Netball/).length).toBe(2);
    expect(screen.getAllByText('3 athletes · 7 observations').length).toBe(2);
    expect(screen.getByText('Phase 1, Round 2 (closed)')).toBeTruthy();
    await press('Phase 1, Round 1');
    expect(screen.getByText('screen:audits/round')).toBeTruthy();
  });

  it('says when they audit nothing', async () => {
    await openScreen('committee', { audits: AuditsScreen }, '/audits', {}, { rpcs: { my_selection_audits: [] } });
    expect(screen.getByText(/You don’t audit a selection round/)).toBeTruthy();
  });
});

describe('a round, for its auditor', () => {
  async function openRound(round: AuditRound | null = auditRound(), options: BackendOptions = {}) {
    await openScreen(
      'committee',
      {
        'audits/round': AuditRoundScreen,
        'audits/athlete': placeholder('audits/athlete'),
      },
      '/audits/round?id=r1',
      {},
      { rpcs: { auditor_selection_round: round, admin_selection_audit: null }, ...options },
    );
  }

  it('asks for that round and says it is read only', async () => {
    await openRound();
    expect(onlyRpcCall('auditor_selection_round')).toEqual({ p_round_id: 'r1' });
    expect(screen.getByText(/You can read everything and change nothing/)).toBeTruthy();
  });

  it('lists the athletes with their counts and shared feedback, and opens one', async () => {
    await openRound();
    expect(screen.getByText('Athletes (2)')).toBeTruthy();
    expect(screen.getByText('3 observations by 2 selectors · 1 of 2 summaries signed')).toBeTruthy();
    expect(screen.getAllByText('Feedback shared').length).toBe(1);
    await press('Jordan Junior');
    expect(screen.getByText('screen:audits/athlete')).toBeTruthy();
  });

  it('says how many athletes are left out because they are the auditor’s own children', async () => {
    await openRound(auditRound({ hidden: 1 }));
    expect(screen.getByText(/1 athlete isn’t listed because you are their parent or guardian/)).toBeTruthy();
    await openRound(auditRound({ hidden: 2 }));
    expect(screen.getByText(/2 athletes aren’t listed/)).toBeTruthy();
  });

  it('shows the panel and auditors with their history', async () => {
    await openRound();
    await press('Panel', 0);
    expect(screen.getByText(/^Casey Coach: added/)).toBeTruthy();
    expect(screen.getByText(/^Ari Auditor: added/)).toBeTruthy();
  });

  it('opens the audit report on the Report tab', async () => {
    await openRound();
    await press('Report');
    expect(rpcNames()).toContain('admin_selection_audit');
  });

  it('has no button that changes anything', async () => {
    await openRound();
    for (const word of [/Add/, /Take/, /Close/, /Save/, /Share/, /Sign/]) {
      expect(screen.queryAllByRole('button', { name: word })).toEqual([]);
    }
  });

  it('shows the database’s refusal and nothing else', async () => {
    await openRound(null, { rpcErrors: { auditor_selection_round: 'You don’t audit this round' } });
    expect(screen.getByText('You don’t audit this round')).toBeTruthy();
    expect(screen.queryByText(/Athletes \(/)).toBeNull();
  });
});

describe('an athlete’s assessment, for the round’s auditor', () => {
  async function openAthlete(a: AuditorAssessment | null = assessment(), options: BackendOptions = {}) {
    await openScreen('committee', { 'audits/athlete': AuditAthleteScreen }, '/audits/athlete?round=r1&athlete=a1', {}, {
      rpcs: { auditor_athlete_assessment: a },
      ...options,
    });
  }

  it('asks for that athlete in that round, with four tabs', async () => {
    await openAthlete();
    expect(onlyRpcCall('auditor_athlete_assessment')).toEqual({ p_round_id: 'r1', p_athlete_id: 'a1' });
    for (const tab of ['Picture', 'Observations (0)', 'Summaries (1)', 'Feedback']) expect(screen.getByText(tab)).toBeTruthy();
    expect(screen.getByText('Nothing written yet.')).toBeTruthy();
  });

  it('shows each signed summary, who hasn’t signed and the signing history', async () => {
    await openAthlete();
    await press('Summaries (1)');
    expect(screen.getByText('Recommendation: Select')).toBeTruthy();
    expect(screen.getByText('Strengths: Reads the play')).toBeTruthy();
    expect(screen.getByText('1 selector hasn’t signed.')).toBeTruthy();
    expect(screen.getByText('Signing history')).toBeTruthy();
  });

  it('says a draft exists without showing its words', async () => {
    await openAthlete();
    await press('Feedback');
    expect(screen.getByText('The head coach has a draft that isn’t shared.')).toBeTruthy();
  });

  it('says when there is no feedback', async () => {
    await openAthlete(assessment({ feedback: null }));
    await press('Feedback');
    expect(screen.getByText('No feedback for this athlete.')).toBeTruthy();
  });

  it('has nothing to press that changes anything, on any tab', async () => {
    await openAthlete();
    for (const tab of ['Picture', 'Observations (0)', 'Summaries (1)', 'Feedback']) {
      await press(tab);
      for (const word of [/Add/, /Take/, /Save/, /Share/, /Sign/, /Reopen/, /Correct/, /Write/]) {
        expect(screen.queryAllByRole('button', { name: word })).toEqual([]);
      }
    }
  });

  it('shows the database’s refusal for the auditor’s own child', async () => {
    await openAthlete(null, { rpcErrors: { auditor_athlete_assessment: 'You can’t read your own child’s assessment' } });
    expect(screen.getByText('You can’t read your own child’s assessment')).toBeTruthy();
    expect(screen.queryByText('Picture')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The admin's Auditors tab

describe('the Auditors tab, for an admin', () => {
  const ROUND: AdminRound = {
    id: 'r1',
    team_id: 't1',
    team_name: '17 & Under squad',
    season: 2027,
    name: 'Phase 1, Round 1',
    phase: 1,
    round_number: 1,
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed_at: null,
    created_at: '2026-10-04T01:00:00Z',
    athletes: 14,
    observations: 22,
    panel: [],
  } as unknown as AdminRound;
  const AUDITOR: RoundAuditor = {
    profile_id: 'p1',
    name: 'Ari Auditor',
    added_at: '2026-10-04T01:00:00Z',
    added_by_name: 'Sample admin',
    removed_at: null,
    removed_by_name: null,
    can_audit: true,
    own_children: 1,
    is_admin: false,
    other_rounds: 0,
  };
  const CHOICES = [
    { profile_id: 'p2', name: 'Lee Last', cleared: true, on_panel: false, audited_last: true },
    { profile_id: 'p3', name: 'Pat Panel', cleared: true, on_panel: true, audited_last: false },
    { profile_id: 'p4', name: 'Nico Nocheck', cleared: false, on_panel: false, audited_last: false },
    { profile_id: 'p5', name: 'Sam Spare', cleared: true, on_panel: false, audited_last: false },
  ];

  async function openTab(auditors: RoundAuditor[], options: BackendOptions = {}) {
    await openScreen('admin', { 'admin/assessments/round': AdminRoundScreen }, '/admin/assessments/round?id=r1', {}, {
      rpcs: {
        admin_selection_rounds: [ROUND],
        admin_selection_auditors: auditors,
        admin_selection_auditor_choices: CHOICES,
        admin_add_selection_auditor: null,
        admin_remove_selection_auditor: null,
      },
      ...options,
    });
    await press(/^Auditors \(/);
  }

  it('says nobody audits the round yet', async () => {
    await openTab([]);
    expect(screen.getByText('Auditors (0)')).toBeTruthy();
    expect(screen.getByText('Nobody audits this round yet.')).toBeTruthy();
  });

  it('shows an auditor with their notes and takes them off', async () => {
    await openTab([AUDITOR]);
    expect(screen.getByText('Can’t check 1 athlete in this round: their own child')).toBeTruthy();
    clearCalls();
    await press('Take Ari Auditor off as auditor');
    expect(onlyRpcCall('admin_remove_selection_auditor')).toEqual({ p_round_id: 'r1', p_profile_id: 'p1' });
  });

  it('lists past auditors under “No longer an auditor”', async () => {
    await openTab([{ ...AUDITOR, removed_at: '2026-10-10T00:00:00Z', removed_by_name: 'Sample admin' }]);
    expect(screen.getByText('No longer an auditor')).toBeTruthy();
    expect(screen.getByText('Nobody audits this round yet.')).toBeTruthy();
  });

  it('groups last round’s auditors first, says who can’t be added, and adds one', async () => {
    await openTab([]);
    await press('Add an auditor');
    expect(screen.getByText('Audited this squad’s last round')).toBeTruthy();
    expect(screen.getByText('Everyone else on the committee')).toBeTruthy();
    expect(screen.getByText('Pat Panel: on this round’s panel')).toBeTruthy();
    expect(screen.getByText('Nico Nocheck: needs a current Working With Children Check first')).toBeTruthy();
    expect(screen.queryByText('Add Pat Panel')).toBeNull();
    clearCalls();
    await press('Add Lee Last');
    expect(onlyRpcCall('admin_add_selection_auditor')).toEqual({ p_round_id: 'r1', p_profile_id: 'p2' });
    expect(rpcCalls('admin_selection_auditors').length).toBeGreaterThan(0);
  });

  it('shows the database’s refusal to add', async () => {
    await openTab([], { rpcErrors: { admin_add_selection_auditor: 'They are on this round’s panel' } });
    await press('Add an auditor');
    await press('Add Lee Last');
    expect(screen.getByText('They are on this round’s panel')).toBeTruthy();
  });
});
