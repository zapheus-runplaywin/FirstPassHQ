/**
 * Season KPIs: the list (src/app/kpis/index.tsx), one person's KPIs
 * (src/app/kpis/person.tsx) and adding or changing one (src/app/kpis/edit.tsx).
 *
 * Who sets KPIs for whom is the database's call (`season_kpi_people`,
 * `season_kpi_sheet` with `can_edit` and `can_update`): coaches set their
 * athletes', a head coach their assistants', the committee and admins
 * coaches' and managers'. Teammates never see each other's, and the committee
 * never sees athletes': for them the sheet comes back empty. The screens keep
 * to what it returns: only setters add KPIs, record results and write reviews;
 * the person and setters record progress; only the person confirms a review
 * and writes their own view; guardians and admins reading an athlete's only
 * read (user guide sections 3, 6, 8 and 10). Season KPIs are off until an
 * admin turns them on.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text, TextInput } from 'react-native';

import EditKpiScreen from '@/app/kpis/edit';
import KpisScreen from '@/app/kpis/index';
import KpiPersonScreen from '@/app/kpis/person';
import { formatDateString } from '@/lib/injuries';
import type { Kpi, KpiMeasure, KpiPerson, KpiReview, KpiSheet } from '@/lib/kpis';

import { clearCalls, fieldLabelled, onlyRpcCall, pushTo, rpcCalls, rpcNames } from './helpers/calls';
import {
  morePersonas,
  openScreen,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  TEAM_B,
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

// Each test fills in forms screen by screen; on a busy CI runner that can take
// longer than Jest's 5 second default.
jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  setClubFeatures({ kpis: true });
  clearCalls();
});

const placeholder = (route: string) =>
  function Shown() {
    return <Text>{`screen:${route}`}</Text>;
  };

const press = async (text: string | RegExp, index = 0) => {
  fireEvent.press(screen.getAllByText(text)[index]);
  await settle(6);
};

const fill = async (label: string, value: string) => {
  fireEvent.changeText(fieldLabelled(label), value);
  await settle(2);
};

// ---------------------------------------------------------------------------
// The list

function person(extra: Partial<KpiPerson> = {}): KpiPerson {
  return {
    profile_id: 'athlete',
    full_name: 'Sample athlete',
    team_id: TEAM.id,
    team_name: TEAM.name,
    team_kind: 'team',
    season: 2026,
    archived: false,
    team_role: 'athlete',
    coach_title: null,
    relation: 'self',
    kpi_count: 2,
    result_count: 1,
    review_count: 2,
    reviews_written: 1,
    reviews_confirmed: 0,
    ...extra,
  };
}

async function openList(who: Who, people: KpiPerson[]) {
  await openScreen(
    who,
    { 'kpis/index': KpisScreen, 'kpis/person': placeholder('kpis/person') },
    '/kpis',
    {},
    { rpcs: { season_kpi_people: people } },
  );
}

describe('the season KPIs list', () => {
  it('shows an athlete their own KPIs with results and reviews', async () => {
    await openList('athlete', [person()]);
    expect(screen.getByText('Yours')).toBeTruthy();
    expect(screen.getByText(TEAM.name)).toBeTruthy();
    expect(screen.getByText('Athlete')).toBeTruthy();
    expect(screen.getByText('2 KPIs · 1 of 2 results in · 1 of 2 reviews written · 1 not yet confirmed')).toBeTruthy();
  });

  it('opens a person’s KPIs for that squad or team', async () => {
    await openList('athlete', [person()]);
    await press(TEAM.name);
    expect(screen.getByText('screen:kpis/person')).toBeTruthy();
    expect(screen).toHaveSearchParams({ profile: 'athlete', team: TEAM.id });
  });

  it('shows a parent their child’s KPIs by name', async () => {
    await openList('guardian', [person({ profile_id: 'child-1', full_name: 'Sample Child', relation: 'guardian' })]);
    expect(screen.getByText('Your children')).toBeTruthy();
    expect(screen.getByText('Sample Child')).toBeTruthy();
    expect(screen.getByText(TEAM.name)).toBeTruthy();
    // A parent reads their child's; they don't see review counts.
    expect(screen.getByText('2 KPIs · 1 of 2 results in')).toBeTruthy();
  });

  it('lists the people a head coach sets KPIs for by group, coaches first', async () => {
    await openList('coach', [
      person({ profile_id: 'a2', full_name: 'Zoe Athlete', relation: 'setter', kpi_count: 0 }),
      person({ profile_id: 'a1', full_name: 'Amy Athlete', relation: 'setter', kpi_count: 1, result_count: 1, review_count: 1, reviews_written: 1, reviews_confirmed: 1 }),
      person({ profile_id: 'ac', full_name: 'Ali Assistant', relation: 'setter', team_role: 'coach', coach_title: 'assistant_coach', kpi_count: 3, result_count: 0, review_count: 2, reviews_written: 2, reviews_confirmed: 2 }),
      person({ profile_id: 'coach', full_name: 'Sample coach', relation: 'self', team_role: 'coach', coach_title: 'head_coach', kpi_count: 0 }),
    ]);
    expect(screen.getByText('Yours')).toBeTruthy();
    const names = screen.getAllByText(/^(Zoe Athlete|Amy Athlete|Ali Assistant)$/).map((n) => n.props.children);
    expect(names).toEqual(['Ali Assistant', 'Amy Athlete', 'Zoe Athlete']);
    expect(screen.getByText('3 KPIs · ✓ All 2 reviews written')).toBeTruthy();
    expect(screen.getByText('1 KPI · ✓ All results in · ✓ Review written')).toBeTruthy();
    expect(screen.getAllByText('No KPIs yet')).toHaveLength(2);
  });

  it('shows the committee only the coaches and managers the database returns', async () => {
    await openList('committee', [
      person({ profile_id: 'coach', full_name: 'Sample coach', relation: 'setter', team_role: 'coach', coach_title: 'head_coach' }),
      person({ profile_id: 'manager', full_name: 'Sample manager', relation: 'setter', team_role: 'manager' }),
    ]);
    expect(screen.getByText('Sample coach')).toBeTruthy();
    expect(screen.getByText('Head Coach')).toBeTruthy();
    expect(screen.getByText('Sample manager')).toBeTruthy();
    expect(screen.queryByText('Sample athlete')).toBeNull();
    expect(screen.queryByText('Yours')).toBeNull();
  });

  it('names each group’s season while two seasons run side by side', async () => {
    await openList('coach', [
      person({ relation: 'setter' }),
      person({ profile_id: 'a3', full_name: 'New Athlete', relation: 'setter', team_id: TEAM_B.id, team_name: TEAM.name, season: 2027 }),
    ]);
    expect(screen.getByText(`${TEAM.name} (2026–27)`)).toBeTruthy();
    expect(screen.getByText(`${TEAM.name} (2027–28)`)).toBeTruthy();
  });

  it('keeps archived seasons under Past seasons', async () => {
    await openList('athlete', [person({ archived: true, season: 2025 })]);
    expect(screen.getByText('Past seasons')).toBeTruthy();
    expect(screen.getByText(`${TEAM.name} (2025–26)`)).toBeTruthy();
    expect(screen.getByText('You’re not in a squad or team this season, so there are no KPIs to show.')).toBeTruthy();
  });

  it('says when there’s nothing this season', async () => {
    await openList('guest', []);
    expect(screen.getByText('You’re not in a squad or team this season, so there are no KPIs to show.')).toBeTruthy();
  });

  it('asks for nothing while the club has Season KPIs off', async () => {
    setClubFeatures({});
    await openList('athlete', [person()]);
    expect(rpcNames()).not.toContain('season_kpi_people');
    expect(screen.queryByText('Yours')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// One person's KPIs

function measure(extra: Partial<KpiMeasure> = {}): KpiMeasure {
  return {
    id: 'm1',
    title: null,
    kind: 'number',
    target: 85,
    unit: '%',
    lower_is_better: false,
    baseline: 60,
    current_value: 70,
    done: false,
    progress_by_name: 'Sample athlete',
    progress_at: '2026-10-10T00:00:00Z',
    ...extra,
  };
}

function kpi(extra: Partial<Kpi> = {}): Kpi {
  return {
    id: 'k1',
    format: 'kpi',
    title: 'Squad attendance',
    detail: 'Counted at every session',
    result: null,
    result_note: null,
    result_by_name: null,
    result_at: null,
    set_by_name: 'Sample coach',
    created_at: '2026-09-01T00:00:00Z',
    measures: [measure()],
    ...extra,
  };
}

const OKR = kpi({
  id: 'k2',
  format: 'okr',
  title: 'Become a reliable goal shooter',
  detail: null,
  measures: [
    measure({ id: 'm2', title: 'Shooting percentage', target: 80, unit: '%', baseline: null, current_value: 82 }),
    measure({ id: 'm3', title: 'Shooting drills done', kind: 'yes_no', target: null, unit: null, baseline: null, current_value: null, progress_by_name: null, progress_at: null }),
  ],
});

function review(extra: Partial<KpiReview> = {}): KpiReview {
  return {
    point_id: 'r1',
    name: 'Mid-season review',
    due_on: '2026-12-01',
    note: null,
    noted_by_name: null,
    noted_at: null,
    confirmed_at: null,
    self_review: null,
    self_reviewed_at: null,
    ...extra,
  };
}

function sheet(extra: Partial<KpiSheet> = {}): KpiSheet {
  return {
    profile_id: 'athlete',
    full_name: 'Sample athlete',
    team_id: TEAM.id,
    team_name: TEAM.name,
    team_kind: 'team',
    season: 2026,
    archived: false,
    team_role: 'athlete',
    coach_title: null,
    relation: 'self',
    can_edit: false,
    can_update: true,
    kpis: [kpi(), OKR],
    reviews: [review()],
    ...extra,
  };
}

async function openPerson(who: Who, shown: KpiSheet | null, errors: Record<string, string> = {}) {
  await openScreen(
    who,
    { 'kpis/person': KpiPersonScreen, 'kpis/edit': placeholder('kpis/edit') },
    `/kpis/person?profile=athlete&team=${TEAM.id}`,
    {},
    { rpcs: { season_kpi_sheet: shown }, rpcErrors: errors },
  );
}

const SETTER = { relation: 'setter' as const, can_edit: true, can_update: true };

describe('a person’s own KPIs', () => {
  it('asks for this person’s sheet in this group', async () => {
    await openPerson('athlete', sheet());
    expect(rpcCalls('season_kpi_sheet')).toEqual([{ p_profile_id: 'athlete', p_team_id: TEAM.id }]);
    expect(screen.getAllByText('Your season KPIs').length).toBeGreaterThan(0);
    expect(screen.getByText(`${TEAM.name} · 2026–27 · Athlete`)).toBeTruthy();
    expect(screen.getByText('Your coaches set these. Record your progress as the season goes, and add your own view at each review.')).toBeTruthy();
  });

  it('shows each measure’s target, start and progress', async () => {
    await openPerson('athlete', sheet());
    expect(screen.getByText('Squad attendance')).toBeTruthy();
    expect(screen.getByText('Counted at every session')).toBeTruthy();
    expect(screen.getAllByText('Set by Sample coach')).toHaveLength(2);
    expect(screen.getByText('Target 85% · started at 60%')).toBeTruthy();
    expect(screen.getByText('70% so far')).toBeTruthy();
    expect(screen.getByText('82% so far · ✓ On target')).toBeTruthy();
    expect(screen.getByText('Shooting percentage')).toBeTruthy();
    expect(screen.getByText('Not done yet')).toBeTruthy();
  });

  it('records progress on a number', async () => {
    await openPerson('athlete', sheet());
    fireEvent.changeText(screen.getByDisplayValue('70'), '7,5');
    await settle();
    await press('Save');
    expect(onlyRpcCall('record_kpi_progress')).toEqual({ p_measure_id: 'm1', p_value: 7.5, p_done: false });
    expect(rpcCalls('season_kpi_sheet')).toHaveLength(2);
  });

  it('won’t save progress that isn’t a number', async () => {
    await openPerson('athlete', sheet());
    fireEvent.changeText(screen.getByDisplayValue('70'), 'lots');
    await settle();
    await press('Save');
    expect(rpcCalls('record_kpi_progress')).toEqual([]);
  });

  it('marks a done-or-not measure done', async () => {
    await openPerson('athlete', sheet());
    await press('Mark as done');
    expect(onlyRpcCall('record_kpi_progress')).toEqual({ p_measure_id: 'm3', p_value: null, p_done: true });
  });

  it('shows why progress wasn’t saved', async () => {
    await openPerson('athlete', sheet(), { record_kpi_progress: 'This season is archived' });
    await press('Mark as done');
    expect(screen.getByText('This season is archived')).toBeTruthy();
  });

  it('never lets the person add KPIs or record their own result', async () => {
    await openPerson('athlete', sheet({ kpis: [kpi({ result: 'met', result_note: 'Hit 88%', result_by_name: 'Sample coach' })] }));
    expect(screen.queryByText('Add a KPI or OKR')).toBeNull();
    expect(screen.queryByText('Edit KPI')).toBeNull();
    expect(screen.queryByText('Save result')).toBeNull();
    expect(screen.getByText('Result: Met')).toBeTruthy();
    expect(screen.getByText('Hit 88%')).toBeTruthy();
    expect(screen.getByText('Recorded by Sample coach')).toBeTruthy();
  });

  it('confirms a written review was done, and adds their own view', async () => {
    await openPerson('athlete', sheet({ reviews: [review({ note: 'Strong first half', noted_by_name: 'Sample coach', noted_at: '2026-10-01T00:00:00Z' })] }));
    expect(screen.getByText('Mid-season review')).toBeTruthy();
    expect(screen.getByText(`Due ${formatDateString('2026-12-01')}`)).toBeTruthy();
    expect(screen.getByText('Strong first half')).toBeTruthy();
    await press('Confirm this review was done');
    expect(onlyRpcCall('confirm_kpi_review')).toEqual({ p_team_id: TEAM.id, p_point_id: 'r1' });
    await fill('Your own view (optional)', 'Going well');
    // The last Save is the review's; the others are each measure's.
    await press('Save', screen.getAllByText('Save').length - 1);
    expect(onlyRpcCall('save_kpi_self_review')).toEqual({ p_team_id: TEAM.id, p_point_id: 'r1', p_text: 'Going well' });
  });

  it('says a review not written yet is still to come, and that it was confirmed', async () => {
    await openPerson('athlete', sheet({
      reviews: [
        review(),
        review({ point_id: 'r2', name: 'End of season', note: 'Done', confirmed_at: '2026-10-12T00:00:00Z' }),
      ],
    }));
    expect(screen.getByText('Not written yet.')).toBeTruthy();
    expect(screen.getByText(/^✓ You confirmed it was done, /)).toBeTruthy();
  });

  it.each<[string, Who, string]>([
    ['an adult athlete', 'athlete', 'Your coaches and the club’s admins can see them. Your teammates can’t.'],
    ['an under-18 athlete', morePersonas.under18Athlete, 'Your coaches, your parents or guardians and the club’s admins can see them. Your teammates can’t.'],
  ])('tells %s who sees their KPIs', async (_l, who, text) => {
    await openPerson(who, sheet());
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('tells a coach who sets and sees theirs', async () => {
    await openPerson('coach', sheet({ team_role: 'coach', coach_title: 'assistant_coach', full_name: 'Sample coach' }));
    expect(screen.getByText(/^Your head coach and the committee set these\./)).toBeTruthy();
    expect(screen.getByText(/^The committee and admins can see them, and your head coach if you’re an assistant coach\. Athletes and parents can’t\./)).toBeTruthy();
  });

  it('lets nobody change an archived season’s KPIs', async () => {
    await openPerson('athlete', sheet({ archived: true, can_update: false, reviews: [review({ note: 'Done' })] }));
    expect(screen.getByText('This season is archived, so these KPIs can be read but not changed.')).toBeTruthy();
    expect(screen.queryByText('Mark as done')).toBeNull();
    expect(screen.queryByText('Confirm this review was done')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  });
});

describe('KPIs the member sets for someone', () => {
  it('lets a coach add a KPI for their athlete', async () => {
    await openPerson('coach', sheet(SETTER));
    expect(screen.getByText(/^Add KPIs or OKRs, record results at the end of the season/)).toBeTruthy();
    await press('Add a KPI or OKR');
    expect(screen.getByText('screen:kpis/edit')).toBeTruthy();
    expect(screen).toHaveSearchParams({ profile: 'athlete', team: TEAM.id, name: 'Sample athlete' });
  });

  it('opens a KPI to edit', async () => {
    await openPerson('coach', sheet(SETTER));
    await press('Edit OKR');
    expect(screen).toHaveSearchParams({ profile: 'athlete', team: TEAM.id, name: 'Sample athlete', kpi: 'k2' });
  });

  it('stops adding at 10 KPIs', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => kpi({ id: `k${i}`, title: `KPI ${i}` }));
    await openPerson('coach', sheet({ ...SETTER, kpis: ten }));
    expect(screen.queryByText('Add a KPI or OKR')).toBeNull();
  });

  it('records a result with a note, and clears it', async () => {
    await openPerson('coach', sheet({ ...SETTER, kpis: [kpi()] }));
    await press('Partly met');
    fireEvent.changeText(fieldLabelled('Note on the result (optional)'), 'Close');
    await settle();
    await press('Save result');
    expect(onlyRpcCall('set_kpi_result')).toEqual({ p_kpi_id: 'k1', p_result: 'partly_met', p_note: 'Close' });
  });

  it('clears a recorded result', async () => {
    await openPerson('coach', sheet({ ...SETTER, kpis: [kpi({ result: 'met', result_by_name: 'Sample coach' })] }));
    await press('Met');
    await press('Clear result');
    expect(onlyRpcCall('set_kpi_result')).toEqual({ p_kpi_id: 'k1', p_result: null, p_note: '' });
  });

  it('writes the review, and waits for the person to confirm it', async () => {
    await openPerson('coach', sheet({ ...SETTER, reviews: [review()] }));
    await fill('Your review of Sample athlete', 'Good progress');
    await press('Save', screen.getAllByText('Save').length - 1);
    expect(onlyRpcCall('save_kpi_review')).toEqual({
      p_profile_id: 'athlete',
      p_team_id: TEAM.id,
      p_point_id: 'r1',
      p_note: 'Good progress',
    });
  });

  it('says the person hasn’t confirmed a review yet', async () => {
    await openPerson('coach', sheet({ ...SETTER, reviews: [review({ note: 'Good' })] }));
    expect(screen.getByText('Waiting for Sample athlete to confirm it was done.')).toBeTruthy();
    expect(screen.queryByText('Confirm this review was done')).toBeNull();
  });

  it('removes the person’s own view only after asking once more', async () => {
    await openPerson('coach', sheet({ ...SETTER, reviews: [review({ self_review: 'Something unkind' })] }));
    expect(screen.getByText('Something unkind')).toBeTruthy();
    await press('Remove');
    expect(screen.getByText('Remove what Sample athlete wrote? Do this only if it shouldn’t be here.')).toBeTruthy();
    await press('Remove it');
    expect(onlyRpcCall('remove_kpi_self_review')).toEqual({ p_profile_id: 'athlete', p_team_id: TEAM.id, p_point_id: 'r1' });
  });

  it('can’t write the person’s own view for them', async () => {
    await openPerson('coach', sheet({ ...SETTER, reviews: [review()] }));
    expect(() => fieldLabelled('Your own view (optional)')).toThrow();
  });

  it('says when no review dates are set', async () => {
    await openPerson('coach', sheet({ ...SETTER, reviews: [] }));
    expect(screen.getByText(/^No review dates have been set for this season yet\./)).toBeTruthy();
  });
});

describe('reading someone else’s KPIs', () => {
  it('lets a parent read their child’s, with nothing to change', async () => {
    await openPerson('guardian', sheet({
      relation: 'guardian',
      can_update: false,
      reviews: [review({ note: 'Great', noted_by_name: 'Sample coach', self_review: 'I agree' }), review({ point_id: 'r2', name: 'Not written' })],
    }));
    expect(screen.getByText('Set by their coaches. You can read them and how the season is going.')).toBeTruthy();
    expect(screen.getByText('Great')).toBeTruthy();
    expect(screen.getByText('Their own view')).toBeTruthy();
    // A review with nothing in it isn't shown to a reader.
    expect(screen.queryByText('Not written')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
    expect(screen.queryByText('Mark as done')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  });

  it('lets an admin read an athlete’s, which only their coaches change', async () => {
    await openPerson('admin', sheet({ relation: 'viewer', can_update: false }));
    expect(screen.getByText('Set by their coaches. As an admin you can read them; only their coaches change them.')).toBeTruthy();
    expect(screen.queryByText('Add a KPI or OKR')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  });

  it.each<[string, Who]>([
    ['committee member', 'committee'],
    ['teammate', 'athlete'],
    ['guest', 'guest'],
  ])('tells a %s an athlete’s KPIs aren’t available to them', async (_l, who) => {
    await openPerson(who, null);
    expect(screen.getByText('These KPIs aren’t available to you.')).toBeTruthy();
    expect(screen.queryByText('Squad attendance')).toBeNull();
  });

  it('shows why the KPIs didn’t load', async () => {
    await openPerson('athlete', null, { season_kpi_sheet: 'Season KPIs are off' });
    expect(screen.getByText('These KPIs didn’t load. Try again.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Adding or changing one

async function openEdit(query: string, shown: KpiSheet | null = null, errors: Record<string, string> = {}) {
  await openScreen(
    'coach',
    { 'kpis/person': placeholder('kpis/person'), 'kpis/edit': EditKpiScreen },
    `/kpis/person?profile=athlete&team=${TEAM.id}`,
    {},
    { rpcs: { season_kpi_sheet: shown }, rpcErrors: errors },
  );
  await pushTo(`/kpis/edit?profile=athlete&team=${TEAM.id}&name=Sample%20athlete${query}`);
}

const saved = () => onlyRpcCall('save_season_kpi');

describe('adding a KPI or OKR', () => {
  it('saves a KPI with its measure exactly as filled in, then goes back', async () => {
    await openEdit('');
    expect(screen.getByText('For Sample athlete')).toBeTruthy();
    await fill('KPI', 'Squad attendance');
    await fill('Details (optional)', 'Every session');
    await fill('Target', '85');
    await fill('Unit (optional)', '%');
    await fill('Starting point (optional)', '60,5');
    await press('Add KPI');
    expect(saved()).toEqual({
      p_kpi_id: null,
      p_profile_id: 'athlete',
      p_team_id: TEAM.id,
      p_format: 'kpi',
      p_title: 'Squad attendance',
      p_detail: 'Every session',
      p_measures: [
        { id: null, title: '', kind: 'number', target: 85, unit: '%', lower_is_better: false, baseline: 60.5 },
      ],
    });
    expect(screen).toHavePathname('/kpis/person');
  });

  it('won’t save without a name and a target', async () => {
    await openEdit('');
    await press('Add KPI');
    await fill('KPI', 'Turnovers');
    await press('Add KPI');
    expect(rpcCalls('save_season_kpi')).toEqual([]);
  });

  it('refuses targets that aren’t numbers', async () => {
    await openEdit('');
    await fill('KPI', 'Turnovers');
    await fill('Target', 'two');
    expect(screen.getByText('Targets and starting points must be numbers.')).toBeTruthy();
    await press('Add KPI');
    expect(rpcCalls('save_season_kpi')).toEqual([]);
  });

  it('saves Lower is better', async () => {
    await openEdit('');
    await fill('KPI', 'Turnovers');
    await fill('Target', '2');
    await press('Lower is better');
    await press('Add KPI');
    expect(saved().p_measures).toEqual([expect.objectContaining({ lower_is_better: true, target: 2, baseline: null })]);
  });

  it('saves a done-or-not measure with no target', async () => {
    await openEdit('');
    await fill('KPI', 'Finish the course');
    await press('Done or not done');
    await press('Add KPI');
    expect(saved().p_measures).toEqual([
      { id: null, title: '', kind: 'yes_no', target: null, unit: '', lower_is_better: false, baseline: null },
    ]);
  });

  it('saves an OKR with key results, each named', async () => {
    await openEdit('');
    await press('OKR: objective and key results');
    await fill('Objective', 'Become a reliable goal shooter');
    fireEvent.changeText(screen.getByPlaceholderText('For example, shooting percentage'), 'Shooting percentage');
    await fill('Target', '80');
    await press('Add a key result');
    fireEvent.changeText(screen.getAllByPlaceholderText('For example, shooting percentage')[1], 'Drills done');
    await press('Done or not done', 1);
    await press('Add OKR');
    expect(saved()).toMatchObject({
      p_format: 'okr',
      p_title: 'Become a reliable goal shooter',
      p_measures: [
        { id: null, title: 'Shooting percentage', kind: 'number', target: 80 },
        { id: null, title: 'Drills done', kind: 'yes_no', target: null },
      ],
    });
  });

  it('won’t save an OKR with an unnamed key result', async () => {
    await openEdit('');
    await press('OKR: objective and key results');
    await fill('Objective', 'Lead the defence');
    await press('Done or not done');
    await press('Add OKR');
    expect(rpcCalls('save_season_kpi')).toEqual([]);
  });

  it('has up to 5 key results, and keeps only the first when switched back to a KPI', async () => {
    await openEdit('');
    await press('OKR: objective and key results');
    for (let i = 0; i < 4; i++) await press('Add a key result');
    expect(screen.getByText('Key result 5')).toBeTruthy();
    expect(screen.queryByText('Add a key result')).toBeNull();
    await press('Remove key result', 4);
    expect(screen.queryByText('Key result 5')).toBeNull();
    await press('KPI: one measure');
    expect(screen.getByText('Measure')).toBeTruthy();
    expect(screen.queryByText('Key result 2')).toBeNull();
  });

  it('shows the database’s refusal and stays', async () => {
    await openEdit('', null, { save_season_kpi: 'Only their coaches set an athlete’s KPIs' });
    await fill('KPI', 'Attendance');
    await fill('Target', '85');
    await press('Add KPI');
    expect(screen.getByText('Only their coaches set an athlete’s KPIs')).toBeTruthy();
    expect(screen).toHavePathname('/kpis/edit');
  });
});

describe('changing a KPI', () => {
  const existing = sheet({ ...SETTER, kpis: [kpi(), OKR] });

  it('fills the form from the KPI and keeps each measure’s id', async () => {
    await openEdit('&kpi=k2', existing);
    expect(screen.getByDisplayValue('Become a reliable goal shooter')).toBeTruthy();
    expect(screen.getByDisplayValue('Shooting percentage')).toBeTruthy();
    expect(screen.getByDisplayValue('80')).toBeTruthy();
    expect(screen.getByText('Progress already recorded stays with each measure you keep.')).toBeTruthy();
    await press('Save');
    expect(saved()).toEqual({
      p_kpi_id: 'k2',
      p_profile_id: 'athlete',
      p_team_id: TEAM.id,
      p_format: 'okr',
      p_title: 'Become a reliable goal shooter',
      p_detail: '',
      p_measures: [
        { id: 'm2', title: 'Shooting percentage', kind: 'number', target: 80, unit: '%', lower_is_better: false, baseline: null },
        { id: 'm3', title: 'Shooting drills done', kind: 'yes_no', target: null, unit: '', lower_is_better: false, baseline: null },
      ],
    });
    expect(screen).toHavePathname('/kpis/person');
  });

  it('removes it only after asking once more', async () => {
    await openEdit('&kpi=k1', existing);
    await press('Remove KPI');
    expect(screen.getByText('Remove it, with its progress and result? This can’t be undone.')).toBeTruthy();
    expect(rpcCalls('delete_season_kpi')).toEqual([]);
    await press('Remove it');
    expect(onlyRpcCall('delete_season_kpi')).toEqual({ p_kpi_id: 'k1' });
    expect(screen).toHavePathname('/kpis/person');
  });

  it('shows why it couldn’t be removed', async () => {
    await openEdit('&kpi=k1', existing, { delete_season_kpi: 'Not yours to remove' });
    await press('Remove KPI');
    await press('Remove it');
    expect(screen.getByText('Not yours to remove')).toBeTruthy();
  });
});
