/**
 * Administration > Awards: the list (src/app/admin/awards/index.tsx), one
 * award's standings ([id].tsx) and the award form (edit.tsx), as an admin
 * uses them (section 10 of the user guide, "Awards").
 *
 * The rules: a new award needs a name, a closing date, roles that vote,
 * squads or teams unless the whole club votes, names for a listed award and a
 * preseason closing date for a weighted match award. Ages are 1 to 99, the
 * minimum below the "must be under" age. Once anyone has voted only some
 * settings change, the ages aren't sent and the award can't be removed. A
 * duplicate gets no dates and picks the squads and teams with the same names.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen } from 'expo-router/testing-library';

import AdminAwardScreen from '@/app/admin/awards/[id]';
import EditAwardScreen from '@/app/admin/awards/edit';
import AdminAwardsScreen from '@/app/admin/awards/index';
import { endOfDay } from '@/lib/awards';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Award, AwardResult, AwardTurnout, Team } from '@/lib/types';

import { openScreen, resetClub, settle, TEAM, TEAM_B } from './helpers/harness';
import { isDisabled, isSelected, type } from './helpers/settings-forms';

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

// Each test settles a whole screen several times; leave room on a busy machine.
jest.setTimeout(30000);

const rpc = () => supabase.rpc as jest.Mock;
const callsTo = (name: string) =>
  (rpc().mock.calls as [string, Record<string, unknown>][])
    .filter(([n]) => n === name)
    .map(([, args]) => args);

beforeEach(() => {
  resetClub();
  rpc().mockClear();
});

function Placeholder() {
  return null;
}

const SQUAD: Team = { ...TEAM, id: 'squad-open', name: 'Open Squad', kind: 'squad', sort_order: 0 };
const TEAMS: Team[] = [SQUAD, TEAM, TEAM_B];

function award(extra: Partial<Award> = {}): Award {
  return {
    id: 'aw-1',
    season: 2026,
    name: 'Volunteer of the year',
    description: 'Who helped most',
    closes_at: '2026-11-30T15:59:00Z',
    club_wide: true,
    per_group: false,
    voter_roles: ['member'],
    nominees: 'members',
    points: [1],
    by_match: false,
    match_vote_hours: 48,
    preseason_weight: 0,
    preseason_closes_at: null,
    annual: false,
    copied_from: null,
    nominee_min_age: null,
    nominee_max_age: null,
    nominee_age_on: null,
    award_groups: [],
    award_candidates: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The list

async function openList(awards: Award[], teams: Team[] = TEAMS) {
  await openScreen(
    'admin',
    { 'admin/awards/index': AdminAwardsScreen, 'admin/awards/edit': Placeholder, 'admin/awards/[id]': Placeholder },
    '/admin/awards',
    { awards, teams },
  );
}

describe('the awards list', () => {
  it('shows this season’s awards with who votes for whom and when they close', async () => {
    await openList([
      award(),
      award({ id: 'aw-2', name: 'Coaches award', club_wide: false, voter_roles: ['coach', 'manager'], nominees: 'athletes', points: [3, 2, 1], award_groups: [{ team_id: TEAM.id }, { team_id: 'gone' }] }),
      award({ id: 'aw-old', season: 2025, name: 'Last year’s award' }),
    ]);
    expect(screen.getByText('Volunteer of the year')).toBeTruthy();
    expect(screen.getByText('Every member across the club vote for any member · One vote')).toBeTruthy();
    expect(screen.getByText('Coaches, Managers in Open A, Archived group vote for athletes · 3-2-1 votes')).toBeTruthy();
    expect(screen.getAllByText(/^Closes /)).toHaveLength(2);
    expect(screen.queryByText('Last year’s award')).toBeNull();
  });

  it('switches to an earlier season', async () => {
    await openList([award(), award({ id: 'aw-old', season: 2025, name: 'Last year’s award', closes_at: '2025-11-30T00:00:00Z' })]);
    expect(isSelected('2026–27')).toBe(true);
    await fireEvent.press(screen.getByText('2025–26'));
    expect(screen.getByText('Last year’s award')).toBeTruthy();
    expect(screen.getByText(/^Closed /)).toBeTruthy();
    expect(screen.queryByText('Volunteer of the year')).toBeNull();
  });

  it('says when a season has no awards, with no season chips for one season', async () => {
    await openList([]);
    expect(screen.getByText('No awards for 2026–27 yet.')).toBeTruthy();
    expect(screen.queryByText('2025–26')).toBeNull();
  });

  it('opens New award and an award', async () => {
    await openList([award()]);
    await fireEvent.press(screen.getByText('New award'));
    await settle();
    expect(screen).toHavePathname('/admin/awards/edit');
    await act(() => router.back());
    await settle();
    await fireEvent.press(screen.getByText('Volunteer of the year'));
    await settle();
    expect(screen).toHavePathname('/admin/awards/aw-1');
  });
});

// ---------------------------------------------------------------------------
// One award

async function openAward(
  a: Award | null,
  { results = [] as AwardResult[], turnout = [] as AwardTurnout[], fixtures = [] as unknown[], missing = 0 } = {},
) {
  await openScreen(
    'admin',
    {
      'admin/awards/[id]': AdminAwardScreen,
      'admin/awards/edit': Placeholder,
      'admin/reports/award': Placeholder,
    },
    '/admin/awards/aw-1',
    { teams: TEAMS, fixtures },
    {
      tableHandlers: { awards: (q) => (q.eq('id') === 'aw-1' && a ? [a] : []) },
      rpcs: { award_results: results, award_turnout: turnout, admin_award_missing_birthdays: missing },
    },
  );
}

function result(nominee_name: string, score: number, extra: Partial<AwardResult> = {}): AwardResult {
  return { team_id: null, team_name: null, nominee_name, preseason_points: 0, match_points: score, votes: score, score, ...extra };
}

describe('one award', () => {
  it('shows nothing for an award the database doesn’t return', async () => {
    await openAward(null);
    expect(screen.queryByText('Edit award')).toBeNull();
  });

  it('shows its settings and the standings in order, in points', async () => {
    await openAward(award(), { results: [result('Jo Smith', 3), result('Sam Lee', 1)] });
    expect(screen.getByText('Who helped most')).toBeTruthy();
    expect(screen.getByText('1. Jo Smith')).toBeTruthy();
    expect(screen.getByText('3 points')).toBeTruthy();
    expect(screen.getByText('2. Sam Lee')).toBeTruthy();
    expect(screen.getByText('1 point')).toBeTruthy();
    expect(screen.getByText(/^2026–27 · Closes /)).toBeTruthy();
    expect(screen.getByText('Only admins see results. Nobody, admins included, can see who voted for whom.')).toBeTruthy();
    // Still open: no full results report.
    expect(screen.queryByText('Full results report')).toBeNull();
    expect(callsTo('award_results')).toEqual([{ p_award_id: 'aw-1' }]);
    expect(callsTo('admin_award_missing_birthdays')).toEqual([]);
  });

  it('says when nobody has voted', async () => {
    await openAward(award());
    expect(screen.getByText('No votes yet.')).toBeTruthy();
  });

  it('offers the full results report once voting has closed', async () => {
    await openAward(award({ closes_at: '2026-10-01T00:00:00Z' }));
    await fireEvent.press(screen.getByText('Full results report'));
    await settle();
    expect(screen).toHavePathname('/admin/reports/award');
  });

  it('opens Edit and Duplicate for this award', async () => {
    await openAward(award());
    await fireEvent.press(screen.getByText('Edit award'));
    await settle();
    expect(screen).toHavePathnameWithParams('/admin/awards/edit?id=aw-1');
    await act(() => router.back());
    await settle();
    await fireEvent.press(screen.getByText('Duplicate'));
    await settle();
    expect(screen).toHavePathnameWithParams('/admin/awards/edit?from=aw-1');
  });

  it('lists the names to vote for on a listed award', async () => {
    await openAward(award({ nominees: 'listed', award_candidates: [{ id: 'c1', name: 'Umpire One' }, { id: 'c2', name: 'Umpire Two' }] }));
    expect(screen.getByText('Nominees: Umpire One, Umpire Two')).toBeTruthy();
  });

  it('counts possible nominees with no date of birth on an age-limited award', async () => {
    await openAward(award({ nominee_min_age: 16, nominee_max_age: 21 }), { missing: 2 });
    expect(callsTo('admin_award_missing_birthdays')).toEqual([{ p_award_id: 'aw-1' }]);
    expect(screen.getByText(/^2 possible nominees have no date of birth, so they can’t be voted for\./)).toBeTruthy();
  });

  it('says it once for a single nominee', async () => {
    await openAward(award({ nominee_max_age: 21 }), { missing: 1 });
    expect(screen.getByText(/^1 possible nominee has no date of birth/)).toBeTruthy();
  });

  it('doesn’t count birthdays for listed names', async () => {
    await openAward(award({ nominees: 'listed', nominee_max_age: 21 }), { missing: 2 });
    expect(callsTo('admin_award_missing_birthdays')).toEqual([]);
    expect(screen.queryByText(/no date of birth/)).toBeNull();
  });

  it('shows a weighted award’s shares, each group’s standings and who has voted', async () => {
    const a = award({
      club_wide: false,
      per_group: true,
      by_match: true,
      preseason_weight: 25,
      preseason_closes_at: '2026-10-30T00:00:00Z',
      award_groups: [{ team_id: TEAM.id }, { team_id: TEAM_B.id }],
    });
    await openAward(a, {
      results: [result('Jo Smith', 62.5, { team_id: TEAM.id, preseason_points: 3, match_points: 5 })],
      turnout: [
        { team_id: TEAM.id, team_name: 'Open A', fixture_id: null, fixture_label: null, starts_at: null, preseason: true, ballots: 4, voters: 9 },
        { team_id: TEAM.id, team_name: 'Open A', fixture_id: 'f1', fixture_label: 'Round 1 v Rockets', starts_at: '2026-10-11T02:00:00Z', preseason: false, ballots: 6, voters: 9 },
      ],
      fixtures: [{ team_id: TEAM.id, opponent: 'Comets', round_name: 'Round 3', starts_at: '2026-10-25T02:00:00Z' }],
    });
    expect(screen.getByText('62.5%')).toBeTruthy();
    expect(screen.getByText('25% from the preseason vote, 75% from matches. Points: Jo Smith 3 + 5.')).toBeTruthy();
    expect(screen.getByText('Preseason')).toBeTruthy();
    expect(screen.getByText('4 of 9')).toBeTruthy();
    expect(screen.getByText(/^Round 1 v Rockets · /)).toBeTruthy();
    expect(screen.getByText(/^Next match: Round 3 v Comets · .*\. Its vote opens when it starts\.$/)).toBeTruthy();
    // The other team has no linked games.
    expect(screen.getByText('No PlayHQ games are linked to 17 & Under A, so no match votes will open. Link it under Fixtures.')).toBeTruthy();
    expect(screen.getByText(/· Preseason vote closes /)).toBeTruthy();
  });

  it('never shows a preseason closing day on an award without a preseason vote', async () => {
    // Older awards could be saved with one left over from a match award.
    await openAward(award({ preseason_weight: 0, preseason_closes_at: '2026-10-30T00:00:00Z' }));
    expect(screen.getByText(/Closes /)).toBeTruthy();
    expect(screen.queryByText(/Preseason vote/)).toBeNull();
  });

  it('asks for only this award’s groups’ games that are still to come', async () => {
    const from = supabase.from as jest.Mock;
    await openAward(award({ club_wide: false, per_group: true, by_match: true, award_groups: [{ team_id: TEAM.id }] }));
    expect(from).toHaveBeenCalledWith('fixtures');
  });

  it('says there are no more matches once the linked ones are done', async () => {
    await openAward(
      award({ club_wide: false, per_group: true, by_match: true, award_groups: [{ team_id: TEAM.id }] }),
      { turnout: [{ team_id: TEAM.id, team_name: 'Open A', fixture_id: 'f1', fixture_label: 'Round 1', starts_at: null, preseason: false, ballots: 1, voters: 2 }] },
    );
    expect(screen.getByText('No more matches from PlayHQ.')).toBeTruthy();
    expect(screen.getByText('Round 1')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The award form

type FormOptions = {
  url?: string;
  awards?: Award[];
  turnout?: AwardTurnout[];
  fixtures?: { team_id: string }[];
  copyGroups?: { name: string; kind: string }[];
  teams?: Team[];
  rpcErrors?: Record<string, string>;
};

/** Opens the form from the awards list, so Remove can go back to it. */
async function openForm({ url = '/admin/awards/edit', awards = [], turnout = [], fixtures = [], copyGroups = [], teams = TEAMS, rpcErrors = {} }: FormOptions = {}) {
  await openScreen(
    'admin',
    { 'admin/awards/index': Placeholder, 'admin/awards/edit': EditAwardScreen, 'admin/awards/[id]': Placeholder },
    '/admin/awards',
    { fixtures, teams },
    {
      tableHandlers: {
        awards: (q) => {
          const id = q.eq('id');
          return id ? awards.filter((a) => a.id === id) : awards.map(({ id: i, name, season }) => ({ id: i, name, season }));
        },
        teams: (q) => (q.calls.some((c) => c.method === 'in') ? copyGroups : undefined),
      },
      rpcs: { award_turnout: turnout, admin_save_award: 'aw-new', admin_set_award_ages: null, admin_delete_award: null },
      rpcErrors,
    },
  );
  await act(() => router.push(url));
  await settle();
}

const section = (title: string) => fireEvent.press(screen.getByText(title));

async function saveAward() {
  await fireEvent.press(screen.getByText('Save award'));
  await settle();
}

const DEFAULT_SAVE = {
  p_id: null,
  p_season: 2026,
  p_name: 'Volunteer of the year',
  p_description: '',
  p_closes_at: endOfDay('2026-11-17'),
  p_club_wide: true,
  p_per_group: false,
  p_voter_roles: ['member'],
  p_nominees: 'members',
  p_points: [1],
  p_by_match: false,
  p_match_vote_hours: 48,
  p_preseason_weight: 0,
  p_preseason_closes_at: null,
  p_annual: false,
  p_group_ids: [],
  p_candidates: [],
};

describe('a new award', () => {
  it('needs a name before it can be saved', async () => {
    await openForm();
    expect(screen.getByText('Still needed: a name.')).toBeTruthy();
    expect(isDisabled('Save award')).toBe(true);
    await type('Name', '   ');
    expect(isDisabled('Save award')).toBe(true);
  });

  it('saves a whole-club award that closes in 30 days, then opens it', async () => {
    await openForm();
    expect(screen.getByText(`2026–27 · closes ${formatDateString('2026-11-17')}`)).toBeTruthy();
    await type('Name', 'Volunteer of the year');
    await saveAward();
    expect(callsTo('admin_save_award')).toEqual([DEFAULT_SAVE]);
    expect(callsTo('admin_set_award_ages')).toEqual([
      { p_award_id: 'aw-new', p_min_age: null, p_max_age: null, p_age_on: null },
    ]);
    expect(screen).toHavePathname('/admin/awards/aw-new');
  });

  it('saves the chosen closing day, description and ballot', async () => {
    await openForm();
    await type('Name', 'Volunteer of the year');
    await type('Description', 'Think about the whole season');
    await section('Season and closing date');
    await fireEvent.press(screen.getByLabelText(new Date(2026, 10, 20).toDateString()));
    await section('Ballot');
    await fireEvent.press(screen.getByText('3-2-1 votes'));
    await saveAward();
    expect(callsTo('admin_save_award')[0]).toMatchObject({
      p_description: 'Think about the whole season',
      p_closes_at: endOfDay('2026-11-20'),
      p_points: [3, 2, 1],
    });
  });

  it('needs squads or teams when chosen groups vote, and saves them', async () => {
    await openForm();
    await type('Name', 'Best and fairest');
    await section('Voters');
    await fireEvent.press(screen.getByText('Chosen squads and teams'));
    expect(screen.getByText('Still needed: squads or teams.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Open A'));
    await fireEvent.press(screen.getByText('17 & Under A'));
    await fireEvent.press(screen.getByText('17 & Under A'));
    await saveAward();
    expect(callsTo('admin_save_award')[0]).toMatchObject({
      p_club_wide: false,
      p_per_group: false,
      p_group_ids: [TEAM.id],
    });
  });

  it('sends no groups for a whole-club award, even after some were picked', async () => {
    await openForm();
    await type('Name', 'Club award');
    await section('Voters');
    await fireEvent.press(screen.getByText('Chosen squads and teams'));
    await fireEvent.press(screen.getByText('Open A'));
    await fireEvent.press(screen.getByText('The whole club'));
    await saveAward();
    expect(callsTo('admin_save_award')[0]).toMatchObject({ p_club_wide: true, p_per_group: false, p_group_ids: [] });
  });

  it('chooses the roles that vote: Every member on its own, or named roles', async () => {
    await openForm();
    await type('Name', 'Coaches choice');
    await section('Voters');
    await fireEvent.press(screen.getByText('Athletes'));
    await fireEvent.press(screen.getByText('Coaches'));
    expect(isSelected('Every member')).toBe(false);
    await fireEvent.press(screen.getByText('Athletes'));
    await saveAward();
    expect(callsTo('admin_save_award')[0].p_voter_roles).toEqual(['coach']);
  });

  it('needs at least one role that votes', async () => {
    await openForm();
    await type('Name', 'Nobody votes');
    await section('Voters');
    await fireEvent.press(screen.getByText('Coaches'));
    await fireEvent.press(screen.getByText('Coaches'));
    expect(screen.getByText('Still needed: roles that vote.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Every member'));
    expect(screen.queryByText(/^Still needed/)).toBeNull();
  });

  it('saves a match award with a preseason vote and its own closing day', async () => {
    await openForm({ fixtures: [{ team_id: TEAM.id }, { team_id: TEAM.id }] });
    await type('Name', 'Match MVP');
    await section('Voters');
    await fireEvent.press(screen.getByText('Chosen squads and teams'));
    await fireEvent.press(screen.getByText('Open A'));
    await fireEvent.press(screen.getByText('A winner for each'));
    await section('Ballot');
    await fireEvent.press(screen.getByText('After every match'));
    expect(screen.getByText('Open A: 2 games from PlayHQ.')).toBeTruthy();
    await fireEvent.press(screen.getByText('3 days'));
    await fireEvent.press(screen.getByText('25%'));
    expect(screen.getByText(/The result is 25% the share of preseason points and 75% the share of match points\./)).toBeTruthy();
    await saveAward();
    expect(callsTo('admin_save_award')[0]).toMatchObject({
      p_club_wide: false,
      p_per_group: true,
      p_by_match: true,
      p_match_vote_hours: 72,
      p_preseason_weight: 25,
      p_preseason_closes_at: endOfDay('2026-11-01'),
      p_group_ids: [TEAM.id],
    });
  });

  it('warns when a match award’s team has no PlayHQ games', async () => {
    await openForm();
    await type('Name', 'Match MVP');
    await section('Voters');
    await fireEvent.press(screen.getByText('Chosen squads and teams'));
    await fireEvent.press(screen.getByText('Open Squad'));
    await fireEvent.press(screen.getByText('A winner for each'));
    await section('Ballot');
    await fireEvent.press(screen.getByText('After every match'));
    expect(screen.getByText('No PlayHQ games linked to Open Squad')).toBeTruthy();
    expect(
      screen.getByText('Open Squad: no PlayHQ games are linked, so no match votes will open. Link it under Fixtures, or choose the team its games are linked to.'),
    ).toBeTruthy();
  });

  it('never sends match voting or a preseason share for a single-winner award', async () => {
    await openForm();
    await type('Name', 'Match MVP');
    await section('Voters');
    await fireEvent.press(screen.getByText('Chosen squads and teams'));
    await fireEvent.press(screen.getByText('Open A'));
    await fireEvent.press(screen.getByText('A winner for each'));
    await section('Ballot');
    await fireEvent.press(screen.getByText('After every match'));
    await fireEvent.press(screen.getByText('25%'));
    // Back to one winner: the match options go.
    await fireEvent.press(screen.getByText('One winner'));
    expect(screen.queryByText('Match votes stay open for')).toBeNull();
    expect(screen.queryByText('Preseason vote closes')).toBeNull();
    expect(screen.getByText(/once, before it closes$/)).toBeTruthy();
    await saveAward();
    expect(callsTo('admin_save_award')[0]).toMatchObject({
      p_per_group: false,
      p_by_match: false,
      p_preseason_weight: 0,
      p_preseason_closes_at: null,
    });
  });

  it('doesn’t ask for a preseason closing day once the award has one winner', async () => {
    // A copy of a past award starts with no preseason closing day.
    await openForm({ url: '/admin/awards/edit?from=aw-1', awards: [award()] });
    await section('Voters');
    await fireEvent.press(screen.getByText('Chosen squads and teams'));
    await fireEvent.press(screen.getByText('Open A'));
    await fireEvent.press(screen.getByText('A winner for each'));
    await section('Ballot');
    await fireEvent.press(screen.getByText('After every match'));
    await fireEvent.press(screen.getByText('25%'));
    expect(screen.getByText(/^Still needed: .*preseason/)).toBeTruthy();
    await fireEvent.press(screen.getByText('One winner'));
    // Its closing day is still needed, as for any copy.
    expect(screen.getByText(/^Still needed: /)).toBeTruthy();
    expect(screen.queryByText(/^Still needed: .*preseason/)).toBeNull();
  });

  it('saves listed names, one per line, trimmed, and has no age limit for them', async () => {
    await openForm();
    await type('Name', 'Umpire of the year');
    await section('Nominees');
    await fireEvent.press(screen.getByText('Names I list'));
    expect(screen.getByText('Still needed: names to vote for.')).toBeTruthy();
    await type('Names, one per line', ' Jo Smith \n\n Sam Lee\n');
    expect(screen.getByText('2 listed names')).toBeTruthy();
    expect(screen.queryByText('Age restricted')).toBeNull();
    await saveAward();
    expect(callsTo('admin_save_award')[0]).toMatchObject({ p_nominees: 'listed', p_candidates: ['Jo Smith', 'Sam Lee'] });
    expect(callsTo('admin_set_award_ages')[0]).toMatchObject({ p_min_age: null, p_max_age: null, p_age_on: null });
  });

  describe('age limits', () => {
    async function setAges(min: string, max: string) {
      await openForm();
      await type('Name', 'Rising Star');
      await section('Age restricted');
      await fireEvent.press(screen.getByText('Set ages'));
      await type('Minimum age', min);
      await type('Must be under', max);
    }

    it.each([
      ['', '', 'enter a minimum or maximum age'],
      ['0', '', 'ages must be 1 to 99'],
      ['21', '16', 'the minimum age must be below the maximum'],
      ['16', '16', 'the minimum age must be below the maximum'],
    ])('refuses minimum “%s” and under “%s”: %s', async (min, max, problem) => {
      await setAges(min, max);
      expect(screen.getByText(`Still needed: ${problem}.`)).toBeTruthy();
      expect(screen.getByText(`Not finished: ${problem}`)).toBeTruthy();
      expect(isDisabled('Save award')).toBe(true);
    });

    it('keeps only digits in the ages', async () => {
      await setAges('1a6', '2-1');
      expect(screen.getByText('Aged 16 to 20 on the day voting closes')).toBeTruthy();
    });

    it('saves minimum 16 and under 21 as aged 16 to 20 on the closing day', async () => {
      await setAges('16', '21');
      await saveAward();
      expect(callsTo('admin_set_award_ages')).toEqual([
        { p_award_id: 'aw-new', p_min_age: 16, p_max_age: 21, p_age_on: null },
      ]);
    });

    it.each([
      ['16', '', 'Aged 16 or over on the day voting closes', 16, null],
      ['', '21', 'Under 21 on the day voting closes', null, 21],
    ])('saves just one age (%s, %s)', async (min, max, summary, pMin, pMax) => {
      await setAges(min, max);
      expect(screen.getByText(summary)).toBeTruthy();
      await saveAward();
      expect(callsTo('admin_set_award_ages')[0]).toMatchObject({ p_min_age: pMin, p_max_age: pMax });
    });

    it('needs the day ages are measured on when one is to be chosen, and saves it', async () => {
      await setAges('', '21');
      await fireEvent.press(screen.getByText('A day I choose'));
      expect(screen.getByText('Still needed: choose the day ages are measured on.')).toBeTruthy();
      await fireEvent.press(screen.getAllByLabelText(new Date(2026, 9, 31).toDateString()).at(-1)!);
      await saveAward();
      expect(callsTo('admin_set_award_ages')[0]).toMatchObject({ p_max_age: 21, p_age_on: '2026-10-31' });
    });

    it('sends no ages when switched back to Any age', async () => {
      await setAges('16', '21');
      await fireEvent.press(screen.getByText('Any age'));
      await saveAward();
      expect(callsTo('admin_set_award_ages')[0]).toMatchObject({ p_min_age: null, p_max_age: null, p_age_on: null });
    });
  });

  it('shows a refused save and doesn’t set ages or leave the form', async () => {
    await openForm({ rpcErrors: { admin_save_award: 'Only admins can manage awards' } });
    await type('Name', 'Volunteer of the year');
    await saveAward();
    expect(screen.getByText('Only admins can manage awards')).toBeTruthy();
    expect(callsTo('admin_set_award_ages')).toEqual([]);
    expect(screen).toHavePathname('/admin/awards/edit');
  });

  it('shows refused ages and stays on the form', async () => {
    await openForm({ rpcErrors: { admin_set_award_ages: 'Choose ages between 1 and 99' } });
    await type('Name', 'Volunteer of the year');
    await saveAward();
    expect(screen.getByText('Choose ages between 1 and 99')).toBeTruthy();
    expect(screen).toHavePathname('/admin/awards/edit');
  });

  it('offers to start from the newest award of each name, and has no Remove', async () => {
    await openForm({
      awards: [
        award({ id: 'aw-2026', name: 'Volunteer of the year' }),
        award({ id: 'aw-2025', season: 2025, name: 'Volunteer of the year' }),
        award({ id: 'aw-coach', name: 'Coach award' }),
      ],
    });
    expect(screen.getByText('Start from a past award')).toBeTruthy();
    expect(screen.getAllByText('Volunteer of the year')).toHaveLength(1);
    expect(screen.getByText('Coach award')).toBeTruthy();
    expect(screen.queryByText('Remove award')).toBeNull();
  });
});

describe('changing an award', () => {
  const SAVED = award({
    club_wide: false,
    per_group: true,
    voter_roles: ['athlete', 'partner' as never],
    points: [3, 2, 1],
    award_groups: [{ team_id: TEAM.id }],
    nominee_min_age: 16,
    nominee_max_age: 21,
    nominee_age_on: '2027-01-01',
    annual: true,
  });

  it('loads its settings and saves them back under its id, dropping roles that no longer exist', async () => {
    await openForm({ url: '/admin/awards/edit?id=aw-1', awards: [SAVED] });
    expect(screen.queryByText('Start from a past award')).toBeNull();
    await saveAward();
    expect(callsTo('admin_save_award')).toEqual([
      {
        ...DEFAULT_SAVE,
        p_id: 'aw-1',
        p_description: 'Who helped most',
        p_closes_at: endOfDay('2026-11-30'),
        p_club_wide: false,
        p_per_group: true,
        p_voter_roles: ['athlete'],
        p_points: [3, 2, 1],
        p_annual: true,
        p_group_ids: [TEAM.id],
      },
    ]);
    expect(callsTo('admin_set_award_ages')).toEqual([
      { p_award_id: 'aw-new', p_min_age: 16, p_max_age: 21, p_age_on: '2027-01-01' },
    ]);
  });

  it('removes an award nobody has voted in, after asking', async () => {
    await openForm({ url: '/admin/awards/edit?id=aw-1', awards: [SAVED] });
    await fireEvent.press(screen.getByText('Remove award'));
    expect(screen.getByText('Nobody has voted yet, so nothing else is lost.')).toBeTruthy();
    expect(callsTo('admin_delete_award')).toEqual([]);
    await fireEvent.press(screen.getAllByText('Remove award').at(-1)!);
    await settle();
    expect(callsTo('admin_delete_award')).toEqual([{ p_id: 'aw-1' }]);
    expect(screen).toHavePathname('/admin/awards');
  });

  it('shows a refused removal and stays', async () => {
    await openForm({ url: '/admin/awards/edit?id=aw-1', awards: [SAVED], rpcErrors: { admin_delete_award: 'People have voted' } });
    await fireEvent.press(screen.getByText('Remove award'));
    await fireEvent.press(screen.getAllByText('Remove award').at(-1)!);
    await settle();
    expect(screen.getByText('People have voted')).toBeTruthy();
    expect(screen).toHavePathname('/admin/awards/edit');
  });

  it('once anyone has voted, locks the settings, keeps the ages as they are and can’t be removed', async () => {
    await openForm({
      url: '/admin/awards/edit?id=aw-1',
      awards: [SAVED],
      turnout: [{ team_id: TEAM.id, team_name: 'Open A', fixture_id: null, fixture_label: null, starts_at: null, preseason: false, ballots: 1, voters: 5 }],
    });
    expect(screen.getByText(/^People have voted, so only the name, description, closing dates/)).toBeTruthy();
    expect(screen.queryByText('Remove award')).toBeNull();
    await section('Voters');
    expect(screen.queryByText('Who votes')).toBeNull();
    await type('Name', 'Renamed award');
    await saveAward();
    expect(callsTo('admin_save_award')[0]).toMatchObject({ p_id: 'aw-1', p_name: 'Renamed award' });
    expect(callsTo('admin_set_award_ages')).toEqual([]);
    expect(screen).toHavePathname('/admin/awards/aw-new');
  });

  it('asks who voted only for its own id', async () => {
    await openForm({ url: '/admin/awards/edit?id=aw-1', awards: [SAVED] });
    expect(callsTo('award_turnout')).toEqual([{ p_award_id: 'aw-1' }]);
  });
});

describe('duplicating an award', () => {
  const PAST = award({
    id: 'aw-past',
    season: 2025,
    club_wide: false,
    per_group: true,
    award_groups: [{ team_id: 'old-open-a' }, { team_id: 'old-mixed' }],
    preseason_closes_at: '2025-11-01T00:00:00Z',
  });

  it('copies the settings with no dates, and picks the squads and teams with the same names', async () => {
    await openForm({
      url: '/admin/awards/edit?from=aw-past',
      awards: [PAST],
      copyGroups: [
        { name: 'Open A', kind: 'team' },
        { name: 'Mixed Open A', kind: 'team' },
      ],
    });
    expect(
      screen.getByText(/^Copied from Volunteer of the year \(2025–26\)\. Choose when voting closes, and check the rest before saving\. 1 squad or team has no match by name in 2026–27\.$/),
    ).toBeTruthy();
    expect(screen.getByText('2026–27 · closing date not chosen')).toBeTruthy();
    expect(screen.getByText('Still needed: when voting closes.')).toBeTruthy();
    expect(callsTo('award_turnout')).toEqual([]);
    // The closing date section opens by itself.
    await fireEvent.press(screen.getByLabelText(new Date(2026, 9, 31).toDateString()));
    await saveAward();
    expect(callsTo('admin_save_award')[0]).toMatchObject({
      p_id: null,
      p_season: 2026,
      p_closes_at: endOfDay('2026-10-31'),
      p_preseason_closes_at: null,
      p_group_ids: [TEAM.id],
      p_per_group: true,
    });
  });

  it('starts a new award from a past one picked on the form', async () => {
    await openForm({ awards: [PAST], copyGroups: [] });
    await fireEvent.press(screen.getByText('Volunteer of the year'));
    await settle();
    expect(screen).toHavePathnameWithParams('/admin/awards/edit?from=aw-past');
    expect(screen.getByText(/^Copied from Volunteer of the year \(2025–26\)\./)).toBeTruthy();
  });
});
