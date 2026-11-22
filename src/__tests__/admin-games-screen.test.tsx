/**
 * Administration's Games page (src/app/admin/games.tsx): the club's games
 * recorded in FirstPass Vantage, newest first, with who recorded each and
 * whether it was finished. It lists games only, never an athlete's figures
 * (user guide section 10).
 */
import { fireEvent, screen } from 'expo-router/testing-library';

import AdminGamesScreen from '@/app/admin/games';
import type { AdminGame } from '@/lib/game-stats';

import { clearCalls, rpcCalls } from './helpers/calls';
import { openScreen, resetClub, settle, type BackendOptions } from './helpers/harness';

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

jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  clearCalls();
});

function game(n: number, extra: Partial<AdminGame> = {}): AdminGame {
  return {
    id: `game-${n}`,
    team_name: 'Open A',
    us: 'Sample Thunder',
    them: `Opponent ${n}`,
    round_name: `Round ${n}`,
    status: 'final',
    created_at: '2026-10-11T08:00:00Z',
    finished_at: '2026-10-11T09:10:00Z',
    recorder_name: 'Sample statistician',
    events: 200 + n,
    from_fixture: true,
    ...extra,
  };
}

const open = (options: BackendOptions) =>
  openScreen('admin', { 'admin/games': AdminGamesScreen }, '/admin/games', {}, options);

describe('the Games page', () => {
  it('lists each recorded game with who recorded it and where it is up to', async () => {
    await open({
      rpcs: {
        admin_games: [
          game(3),
          game(2, { status: 'live', finished_at: null, recorder_name: null, events: 1 }),
          game(1, { status: 'setup', from_fixture: false, round_name: null, events: 0 }),
        ],
      },
    });
    expect(rpcCalls('admin_games')).toEqual([{ p_limit: 50, p_offset: 0 }]);
    expect(screen.getByText('Sample Thunder v Opponent 3')).toBeTruthy();
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(screen.getByText('Recorded by Sample statistician · 203 events')).toBeTruthy();
    expect(screen.getByText('Being recorded')).toBeTruthy();
    expect(screen.getByText('No recorder named · 1 event')).toBeTruthy();
    expect(screen.getByText('Set up, not started · Not from the fixture list')).toBeTruthy();
    expect(screen.getAllByText(/^Round \d · Open A · /)).toHaveLength(2);
    // A short list has no more to show.
    expect(screen.queryByText('Show earlier games')).toBeNull();
  });

  it('says when no games have been recorded', async () => {
    await open({ rpcs: { admin_games: [] } });
    expect(screen.getByText('No games have been recorded yet.')).toBeTruthy();
  });

  it('shows earlier games a page at a time, without repeating one', async () => {
    const first = Array.from({ length: 50 }, (_, i) => game(100 - i));
    await open({
      rpcHandlers: {
        admin_games: (args) => (args.p_offset === 0 ? first : [game(51), game(50), game(49)]),
      },
    });
    expect(screen.queryByText('Sample Thunder v Opponent 49')).toBeNull();
    await fireEvent.press(screen.getByText('Show earlier games'));
    await settle(6);
    expect(rpcCalls('admin_games').at(-1)).toEqual({ p_limit: 50, p_offset: 50 });
    expect(screen.getByText('Sample Thunder v Opponent 49')).toBeTruthy();
    expect(screen.getAllByText('Sample Thunder v Opponent 51')).toHaveLength(1);
    expect(screen.queryByText('Show earlier games')).toBeNull();
  });

  it('says why the list couldn’t be read', async () => {
    await open({ rpcErrors: { admin_games: 'Couldn’t read the games' } });
    expect(screen.getByText('Couldn’t read the games')).toBeTruthy();
    expect(screen.queryByText('No games have been recorded yet.')).toBeNull();
  });
});
