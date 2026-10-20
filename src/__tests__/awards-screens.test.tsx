/**
 * Award votes open to the member (src/app/awards/index.tsx) and a ballot
 * (src/app/awards/vote.tsx).
 *
 * Who may vote, and for whom, is the database's call (`award_slots`,
 * `award_nominees`, `save_award_ballot`): the screens only show the votes it
 * returns and refuse a vote that isn't among them. A ballot has one pick per
 * place, first place first; tapping a pick takes it off and the places after
 * it move up; it can be changed until it closes. Votes are secret (user guide
 * section 3, "Club awards").
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import AwardsScreen from '@/app/awards/index';
import VoteScreen from '@/app/awards/vote';
import { formatDateTime } from '@/lib/format';
import type { AwardNominee, AwardSlot } from '@/lib/types';

import { clearCalls, onlyRpcCall, pushTo, rpcCalls } from './helpers/calls';
import {
  openScreen,
  resetClub,
  settle,
  TEAM,
  type Persona,
  type PersonaName,
  type QueryCall,
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

// Each test fills in forms screen by screen; on a busy CI runner that can take
// longer than Jest's 5 second default.
jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
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

const CLOSES = '2026-10-25T09:00:00Z';

function slot(extra: Partial<AwardSlot> = {}): AwardSlot {
  return {
    award_id: 'aw1',
    award_name: 'Players’ player',
    description: 'Who lifted the team most this season?',
    points: [3, 2, 1],
    nominees: 'athletes',
    team_id: TEAM.id,
    team_name: TEAM.name,
    fixture_id: null,
    fixture_label: null,
    preseason: false,
    closes_at: CLOSES,
    voted: false,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The list

async function openList(who: Who, slots: AwardSlot[]) {
  await openScreen(
    who,
    { 'awards/index': AwardsScreen, 'awards/vote': placeholder('awards/vote'), 'admin/awards': placeholder('admin/awards') },
    '/awards',
    {},
    { rpcs: { award_slots: slots } },
  );
}

describe('the award votes list', () => {
  it('lists votes waiting first, then ones already cast', async () => {
    await openList('athlete', [
      slot({ award_id: 'aw2', award_name: 'Coach MVP', points: [1], fixture_id: 'fx1', fixture_label: 'Round 3 v Swans', voted: true }),
      slot(),
    ]);
    expect(screen.getByText('Waiting for your vote')).toBeTruthy();
    expect(screen.getByText('Voted')).toBeTruthy();
    const order = screen.getAllByText(/^(Players’ player|Coach MVP)$/).map((n) => n.props.children);
    expect(order).toEqual(['Players’ player', 'Coach MVP']);
    expect(screen.getByText(`${TEAM.name} · Round 3 v Swans`)).toBeTruthy();
    expect(screen.getByText(`3-2-1 votes · Closes ${formatDateTime(new Date(CLOSES))}`)).toBeTruthy();
    expect(screen.getByText(`One vote · Closes ${formatDateTime(new Date(CLOSES))}`)).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
  });

  it('says votes are secret', async () => {
    await openList('athlete', []);
    expect(
      screen.getByText(
        'Votes are secret. Only club admins see the results, and nobody sees who you voted for. You can change your vote until it closes.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('There are no votes open for you right now. Match votes open when the game starts.'),
    ).toBeTruthy();
  });

  it('opens a vote with what it’s for', async () => {
    await openList('athlete', [slot({ preseason: true })]);
    expect(screen.getByText(`${TEAM.name} · Preseason`)).toBeTruthy();
    await press('Players’ player');
    expect(screen.getByText('screen:awards/vote')).toBeTruthy();
    expect(screen).toHaveSearchParams({ award: 'aw1', team: TEAM.id, fixture: '', preseason: '1' });
  });

  it('lets only admins manage awards', async () => {
    await openList('admin', []);
    await press('Manage awards');
    expect(screen.getByText('screen:admin/awards')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['committee member', 'committee'],
    ['coach', 'coach'],
    ['athlete', 'athlete'],
    ['stood-down admin', 'stoodDownAdmin'],
  ])('gives a %s no way to manage awards', async (_l, who) => {
    await openList(who, []);
    expect(screen.queryByText('Manage awards')).toBeNull();
  });

  it.each<[string, Who]>([
    ['pending member', 'pending'],
  ])('asks for no votes for a %s', async (_l, who) => {
    await openList(who, [slot()]);
    expect(rpcCalls('award_slots')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A ballot

const NOMINEES: AwardNominee[] = [
  { id: 'n1', is_candidate: false, name: 'Amy Athlete' },
  { id: 'n2', is_candidate: false, name: 'Ben Athlete' },
  { id: 'n3', is_candidate: false, name: 'Cat Athlete' },
  { id: 'n4', is_candidate: true, name: 'Dan Listed' },
];

let ballotQueries: QueryCall[][] = [];

async function openVote(
  who: Who,
  {
    slots = [slot()],
    nominees = NOMINEES,
    ballot = null as { award_votes: { rank: number; nominee_id: string | null; candidate_id: string | null }[] } | null,
    query = `award=aw1&team=${TEAM.id}&fixture=&preseason=`,
    error,
  }: { slots?: AwardSlot[]; nominees?: AwardNominee[]; ballot?: { award_votes: { rank: number; nominee_id: string | null; candidate_id: string | null }[] } | null; query?: string; error?: string } = {},
) {
  ballotQueries = [];
  await openScreen(
    who,
    { 'awards/index': placeholder('awards/index'), 'awards/vote': VoteScreen },
    '/awards',
    { award_ballots: ballot ? [ballot] : [] },
    {
      rpcs: { award_slots: slots, award_nominees: nominees },
      rpcErrors: error ? { save_award_ballot: error } : {},
      tableHandlers: {
        award_ballots: (q) => {
          ballotQueries.push(q.calls);
          return undefined;
        },
      },
    },
  );
  await pushTo(`/awards/vote?${query}`);
}

const picked = (name: string, place: string) => screen.getByLabelText(`${name}, ${place}`);

describe('voting', () => {
  it('asks for this award’s nominees in this team', async () => {
    await openVote('athlete');
    expect(ballotQueries[0]).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['team_id', TEAM.id] },
        { method: 'is', args: ['fixture_id', null] },
      ]),
    );
    expect(rpcCalls('award_nominees')).toEqual([{ p_award_id: 'aw1', p_team_id: TEAM.id }]);
    expect(screen.getAllByText('Players’ player').length).toBeGreaterThan(0);
    expect(screen.getByText('Who lifted the team most this season?')).toBeTruthy();
    expect(screen.getByText('Tap 3 people in order, first place first. 1st gets 3, 2nd gets 2, 3rd gets 1.')).toBeTruthy();
  });

  it('casts a 3-2-1 ballot in the order tapped, then goes back', async () => {
    await openVote('athlete');
    await press('Cat Athlete');
    await press('Amy Athlete');
    await press('Dan Listed');
    expect(picked('Cat Athlete', '1st')).toBeTruthy();
    expect(screen.getByText('1st · 3')).toBeTruthy();
    expect(screen.getByText('3rd · 1')).toBeTruthy();
    await press('Vote');
    expect(onlyRpcCall('save_award_ballot')).toEqual({
      p_award_id: 'aw1',
      p_team_id: TEAM.id,
      p_fixture_id: null,
      p_preseason: false,
      p_picks: ['n3', 'n1', 'n4'],
    });
    expect(screen).toHavePathname('/awards');
  });

  it('won’t cast a ballot until every place is filled', async () => {
    await openVote('athlete');
    await press('Amy Athlete');
    await press('Ben Athlete');
    await press('Vote');
    expect(rpcCalls('save_award_ballot')).toEqual([]);
  });

  it('takes a pick off when tapped again and moves the places after it up', async () => {
    await openVote('athlete');
    await press('Amy Athlete');
    await press('Ben Athlete');
    await press('Cat Athlete');
    await press('Amy Athlete');
    expect(picked('Ben Athlete', '1st')).toBeTruthy();
    expect(picked('Cat Athlete', '2nd')).toBeTruthy();
    expect(screen.getByLabelText('Amy Athlete')).toBeTruthy();
  });

  it('takes no more picks than there are places', async () => {
    await openVote('athlete');
    for (const n of ['Amy Athlete', 'Ben Athlete', 'Cat Athlete', 'Dan Listed']) await press(n);
    expect(screen.getByLabelText('Dan Listed')).toBeTruthy();
    await press('Vote');
    expect(onlyRpcCall('save_award_ballot').p_picks).toEqual(['n1', 'n2', 'n3']);
  });

  it('has as many places as nominees when there are fewer nominees than points', async () => {
    await openVote('athlete', { nominees: NOMINEES.slice(0, 2) });
    expect(screen.getByText('Tap 2 people in order, first place first. 1st gets 3, 2nd gets 2.')).toBeTruthy();
    await press('Ben Athlete');
    await press('Amy Athlete');
    await press('Vote');
    expect(onlyRpcCall('save_award_ballot').p_picks).toEqual(['n2', 'n1']);
  });

  it('takes one pick for a one-vote award, and moves it when another is tapped', async () => {
    const match = slot({ points: [1], fixture_id: 'fx1', fixture_label: 'Round 3 v Swans' });
    await openVote('coach', { slots: [match], query: `award=aw1&team=${TEAM.id}&fixture=fx1&preseason=` });
    expect(screen.getByText('Tap who you’re voting for.')).toBeTruthy();
    await press('Amy Athlete');
    expect(screen.getByText('✓')).toBeTruthy();
    // A second tap doesn't add a second pick.
    await press('Ben Athlete');
    await press('Vote');
    expect(onlyRpcCall('save_award_ballot')).toEqual({
      p_award_id: 'aw1',
      p_team_id: TEAM.id,
      p_fixture_id: 'fx1',
      p_preseason: false,
      p_picks: ['n1'],
    });
  });

  it('shows the member’s current ballot to change, first place first', async () => {
    await openVote('athlete', {
      slots: [slot({ voted: true })],
      ballot: {
        award_votes: [
          { rank: 3, nominee_id: null, candidate_id: 'n4' },
          { rank: 1, nominee_id: 'n2', candidate_id: null },
          { rank: 2, nominee_id: 'n1', candidate_id: null },
        ],
      },
    });
    expect(picked('Ben Athlete', '1st')).toBeTruthy();
    expect(picked('Amy Athlete', '2nd')).toBeTruthy();
    expect(picked('Dan Listed', '3rd')).toBeTruthy();
    await press('Dan Listed');
    await press('Cat Athlete');
    await press('Change my vote');
    expect(onlyRpcCall('save_award_ballot').p_picks).toEqual(['n2', 'n1', 'n3']);
  });

  it('asks for the member’s ballot for this exact vote', async () => {
    await openVote('athlete', { slots: [slot({ team_id: null, team_name: null, preseason: true })], query: 'award=aw1&team=&fixture=&preseason=1' });
    expect(ballotQueries).toHaveLength(1);
    expect(ballotQueries[0]).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['award_id', 'aw1'] },
        { method: 'eq', args: ['preseason', true] },
        { method: 'is', args: ['team_id', null] },
        { method: 'is', args: ['fixture_id', null] },
      ]),
    );
    await press('Amy Athlete');
    await press('Ben Athlete');
    await press('Cat Athlete');
    await press('Vote');
    expect(onlyRpcCall('save_award_ballot')).toMatchObject({ p_team_id: null, p_fixture_id: null, p_preseason: true });
  });

  it('refuses a vote that’s closed or isn’t open to the member', async () => {
    await openVote('guardian', { slots: [] });
    expect(screen.getByText('This vote has closed, or isn’t open to you.')).toBeTruthy();
    expect(screen.queryByText('Amy Athlete')).toBeNull();
    expect(screen.queryByText('Vote')).toBeNull();
  });

  it('refuses a vote for another team’s award', async () => {
    await openVote('athlete', { slots: [slot({ team_id: 'team-other' })] });
    expect(screen.getByText('This vote has closed, or isn’t open to you.')).toBeTruthy();
  });

  it('says when there’s nobody to vote for', async () => {
    await openVote('athlete', { nominees: [] });
    expect(screen.getByText('There’s nobody to vote for yet.')).toBeTruthy();
    expect(screen.queryByText('Vote')).toBeNull();
  });

  it('shows the database’s refusal and keeps the picks', async () => {
    await openVote('athlete', { error: 'You can’t vote for yourself' });
    await press('Amy Athlete');
    await press('Ben Athlete');
    await press('Cat Athlete');
    await press('Vote');
    expect(screen.getByText('You can’t vote for yourself')).toBeTruthy();
    expect(picked('Amy Athlete', '1st')).toBeTruthy();
    expect(screen).toHavePathname('/awards/vote');
  });
});
