/**
 * Selection rounds, part 5 (release an assessment): the head coach's release
 * screen in each state, the bulk release, the athlete's and parent's row
 * under Selection, and the assessment screen they read, which has nothing to
 * type into or press but folding a group. What is released, and to whom, is
 * the database's call (supabase/tests/selection-release.sql).
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import ReleaseScreen from '@/app/assessments/release';
import SelectionAssessmentScreen from '@/app/selection-assessment';
import SelectionScreen from '@/app/selection';
import { makeCriteria, type AthleteRelease, type ReleasedAssessment, type RoundSheet } from '@/lib/assessments';

import { clearCalls, onlyRpcCall, rpcCalls, rpcNames } from './helpers/calls';
import { openScreen, resetClub, setClubFeatures, settle, type BackendOptions } from './helpers/harness';

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

const CRITERIA = makeCriteria([
  { name: 'Technical ability', items: ['Passing', 'Catching'] },
  { name: 'Mental', items: ['Focus'] },
]);
const [TECH, MENTAL] = CRITERIA.groups;

function release(extra: Partial<AthleteRelease> = {}): AthleteRelease {
  return {
    round_id: 'r1',
    round_name: 'Trials',
    phase: 1,
    round_number: 2,
    team_name: '17 & Under squad',
    criteria_set_name: 'Junior criteria',
    closed: false,
    criteria: CRITERIA,
    athlete_id: 'a1',
    athlete_name: 'Mia Chen',
    is_minor: true,
    can_release: true,
    my_summary_signed: true,
    my_name: 'Casey Coach',
    summary: {
      ratings: [{ item_key: TECH.items[0].key, rating: 2 }],
      recommendation: 'Select',
      strengths: 'Reads the play',
      priorities: 'Left-hand pass',
      comments: '',
    },
    release: null,
    ...extra,
  };
}

async function openRelease(r: AthleteRelease | null = release(), options: BackendOptions = {}) {
  await openScreen(
    'coach',
    { 'assessments/release': ReleaseScreen, 'assessments/summary': placeholder('assessments/summary') },
    '/assessments/release?round=r1&athlete=a1',
    {},
    { rpcs: { athlete_release: r, release_assessment: 'x1', withdraw_assessment_release: null }, ...options },
  );
}

describe('releasing one athlete’s assessment, for the head coach', () => {
  it('asks for that athlete in that round', async () => {
    await openRelease();
    expect(onlyRpcCall('athlete_release')).toEqual({ p_round_id: 'r1', p_athlete_id: 'a1' });
  });

  it('asks for a signed summary first', async () => {
    await openRelease(release({ summary: null, my_summary_signed: false }));
    expect(screen.getByText('Sign your summary of Mia Chen first. What Mia Chen sees is taken from it.')).toBeTruthy();
    await press('Open my summary');
    expect(screen.getByText('screen:assessments/summary')).toBeTruthy();
  });

  it('starts with ratings, strengths and priorities ticked, and empty parts greyed', async () => {
    await openRelease();
    const ticked = (label: string) => screen.getByLabelText(label).props.accessibilityState;
    expect(ticked('Ratings')).toMatchObject({ checked: true });
    expect(ticked('Strengths')).toMatchObject({ checked: true });
    expect(ticked('Development priorities')).toMatchObject({ checked: true });
    expect(ticked('Recommendation')).toMatchObject({ checked: false });
    expect(ticked('Comments')).toMatchObject({ checked: false, disabled: true });
    expect(screen.getByText('Nothing written')).toBeTruthy();
    expect(screen.getByText('Off unless you tick it')).toBeTruthy();
    expect(screen.getByText('1 of 2 groups')).toBeTruthy();
    expect(screen.getByText(/Mia Chen is under 18\. Their verified parents and guardians read this assessment/)).toBeTruthy();
  });

  it('says how many groups have no step when choosing groups', async () => {
    await openRelease();
    await press('Choose groups');
    expect(screen.getByLabelText(TECH.name)).toBeTruthy();
    expect(screen.queryByLabelText(MENTAL.name)).toBeNull();
    expect(screen.getByText('1 group has no step in your summary')).toBeTruthy();
  });

  it('previews what Mia will see, and changes with the ticks', async () => {
    await openRelease();
    await press('See it as Mia Chen will');
    expect(screen.getByText('Reads the play')).toBeTruthy();
    expect(screen.queryByText('Select')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Strengths'));
    await settle(2);
    expect(screen.queryByText('Reads the play')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Recommendation'));
    await settle(2);
    expect(screen.getByText('Select')).toBeTruthy();
  });

  it('releases only after the confirm, with the ticks', async () => {
    await openRelease();
    await press('Release to Mia Chen');
    expect(rpcNames()).not.toContain('release_assessment');
    expect(screen.getByText('Release this to Mia Chen and their verified parents?')).toBeTruthy();
    clearCalls();
    await press('Release');
    expect(onlyRpcCall('release_assessment')).toEqual({
      p_round_id: 'r1',
      p_athlete_id: 'a1',
      p_parts: { groups: [TECH.key], strengths: true, priorities: true, comments: false, recommendation: false },
    });
  });

  it('shows the database’s refusal', async () => {
    await openRelease(release(), { rpcErrors: { release_assessment: 'Only the head coach can release an assessment' } });
    await press('Release to Mia Chen');
    await press('Release');
    expect(screen.getByText('Only the head coach can release an assessment')).toBeTruthy();
  });

  const RELEASED = {
    parts: { groups: [TECH.key], strengths: true, priorities: false, comments: false, recommendation: false },
    released_at: '2026-10-14T01:00:00Z',
    released_by_name: 'Casey Coach',
    seen_at: null as string | null,
  };

  it('shows a release with its parts and takes it back after a warning', async () => {
    await openRelease(release({ release: RELEASED }));
    expect(screen.getByText(/^Released /)).toBeTruthy();
    expect(screen.getByText('Not read yet.')).toBeTruthy();
    expect(screen.getByText('Ratings for 1 of 2 groups, strengths')).toBeTruthy();
    await press('Take it back');
    expect(screen.getByText(/will no longer see this assessment/)).toBeTruthy();
    clearCalls();
    await press('Take it back');
    expect(onlyRpcCall('withdraw_assessment_release')).toEqual({ p_round_id: 'r1', p_athlete_id: 'a1' });
  });

  it('says when it was first read', async () => {
    await openRelease(release({ release: { ...RELEASED, seen_at: '2026-10-15T01:00:00Z' } }));
    expect(screen.getByText(/^Mia Chen or a parent first read it on /)).toBeTruthy();
  });

  it('is read only once the round is closed', async () => {
    await openRelease(release({ closed: true, can_release: false, release: RELEASED }));
    expect(screen.getByText('This round is closed. An admin can open it again.')).toBeTruthy();
    expect(screen.queryByText('Take it back')).toBeNull();
  });

  it('shows another selector the release, or “Not released.”, with nothing to press', async () => {
    await openRelease(release({ can_release: false, summary: null, release: RELEASED }));
    expect(screen.getByText('Ratings for 1 of 2 groups, strengths')).toBeTruthy();
    expect(screen.queryByText('Take it back')).toBeNull();
    await openRelease(release({ can_release: false, summary: null }));
    expect(screen.getByText('Not released.')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });
});

describe('releasing to everyone signed', () => {
  const SHEET = {
    id: 'r1', name: 'Trials', team_name: '17 & Under squad', starts_on: '2026-10-05', ends_on: '2026-11-29', closed: false,
    criteria: CRITERIA, today: '2026-10-18', hidden: 0, phase: 1, round_number: 2,
    athletes: ['a1', 'a2', 'a3', 'a4'].map((id, n) => ({
      id, name: `Athlete ${n + 1}`, is_minor: true, observations: 1, my_observations: 1, assessors: 1, groups_covered: 1, last_observed_on: null,
    })),
  } as unknown as RoundSheet;

  it('counts who will be released, who already is and who isn’t signed, and releases them', async () => {
    await openScreen('coach', { 'assessments/release': ReleaseScreen }, '/assessments/release?round=r1', {}, {
      rpcs: {
        selection_round_sheet: SHEET,
        selection_round_summaries: [
          { athlete_id: 'a1', mine: 'signed', signed: 1 },
          { athlete_id: 'a2', mine: 'signed', signed: 1 },
          { athlete_id: 'a3', mine: 'signed', signed: 1 },
          { athlete_id: 'a4', mine: 'draft', signed: 0 },
        ],
        selection_round_releases: [{ athlete_id: 'a3', seen: false }],
        release_assessments: 2,
      },
    });
    expect(screen.getByText('Will be released: 2 athletes')).toBeTruthy();
    expect(screen.getByText('Already released: 1 (not changed)')).toBeTruthy();
    expect(screen.getByText('Not signed yet: 1')).toBeTruthy();
    await press('Release to 2 athletes');
    expect(screen.getByText(/Parents of the under 18s read theirs at the same time\./)).toBeTruthy();
    clearCalls();
    await press('Release');
    expect(onlyRpcCall('release_assessments')).toEqual({
      p_round_id: 'r1',
      p_parts: { groups: [TECH.key, MENTAL.key], strengths: true, priorities: true, comments: false, recommendation: false },
    });
    expect(screen.getByText('Released to 2 athletes.')).toBeTruthy();
  });
});

function released(extra: Partial<ReleasedAssessment> = {}): ReleasedAssessment {
  return {
    round_id: 'r1', round_name: 'Trials', phase: 1, round_number: 2, team_name: '17 & Under squad',
    criteria_set_name: 'Senior criteria', athlete_id: 'a1', athlete_name: 'Mia Chen', is_me: true,
    from_name: 'Sam Rivera', released_on: '2026-10-14', is_new: true,
    strengths: 'Reads the play', priorities: 'Left-hand pass', comments: null, recommendation: null,
    groups: [
      { name: 'Technical ability', scale: ['Below standard', 'Meets standard', 'Exceeds standard'], items: [{ name: 'Passing', step: 'Meets standard' }] },
      { name: 'Mental', scale: ['Below standard', 'Meets standard', 'Exceeds standard'], items: [{ name: 'Focus', step: 'Exceeds standard' }] },
    ],
    ...extra,
  };
}

describe('a released assessment, for the athlete and their parents', () => {
  async function openSelection(who: 'athlete' | 'guardian', list: ReleasedAssessment[]) {
    await openScreen(who, { selection: SelectionScreen, 'selection-assessment': placeholder('selection-assessment') }, '/selection', {}, {
      rpcs: { my_selection_info: [], my_selection_feedback: [], my_released_assessments: list },
    });
  }

  it('puts the athlete’s row first, with New, and opens it', async () => {
    await openSelection('athlete', [released()]);
    expect(screen.getByText('Your assessment · New')).toBeTruthy();
    expect(screen.getByText(/^From Sam Rivera, /)).toBeTruthy();
    await press('Your assessment · New');
    expect(screen.getByText('screen:selection-assessment')).toBeTruthy();
  });

  it('names a parent’s child, and drops New once read', async () => {
    await openSelection('guardian', [released({ is_me: false, is_new: false })]);
    expect(screen.getByText('Mia Chen’s assessment')).toBeTruthy();
  });

  async function openAssessment(list: ReleasedAssessment[], who: 'athlete' | 'guardian' = 'athlete') {
    await openScreen(who, { 'selection-assessment': SelectionAssessmentScreen }, '/selection-assessment?round=r1&athlete=a1', {}, {
      rpcs: { my_released_assessments: list, mark_assessment_release_seen: null },
    });
  }

  it('shows the released parts, the first group open, and marks it read once', async () => {
    await openAssessment([released()]);
    expect(screen.getByText('Your assessment')).toBeTruthy();
    expect(screen.getByText('Phase 1, Round 2 · Trials · Senior criteria')).toBeTruthy();
    expect(screen.getByText('Reads the play')).toBeTruthy();
    expect(screen.getByText('Left-hand pass')).toBeTruthy();
    expect(screen.queryByText('Recommendation')).toBeNull();
    expect(screen.getByText('Passing: Meets standard')).toBeTruthy();
    expect(screen.queryByText('Focus: Exceeds standard')).toBeNull();
    expect(screen.getByText('You can’t reply here. Talk to your coach if you have a question.')).toBeTruthy();
    expect(rpcCalls('mark_assessment_release_seen')).toEqual([{ p_round_id: 'r1', p_athlete_id: 'a1' }]);
  });

  it('has nothing to type into and nothing to press but folding a group', async () => {
    await openAssessment([released()]);
    expect(screen.container.queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
    const buttons = screen.queryAllByRole('button');
    expect(buttons.map((b) => b.props.accessibilityState?.expanded !== undefined)).toEqual(buttons.map(() => true));
    await press('Mental · 1');
    expect(screen.getByText('Focus: Exceeds standard')).toBeTruthy();
  });

  it('shows a parent their child’s', async () => {
    await openAssessment([released({ is_me: false })], 'guardian');
    expect(screen.getByText('Mia Chen’s assessment')).toBeTruthy();
  });

  it('says when it has been taken back', async () => {
    await openAssessment([]);
    expect(screen.getByText('This assessment isn’t shared now.')).toBeTruthy();
  });
});
