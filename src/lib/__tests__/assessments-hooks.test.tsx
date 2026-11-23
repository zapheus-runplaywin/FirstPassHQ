/**
 * Who could sit on a selection panel (useCanBeSelector) and the rounds Home
 * shows them (useMySelectionRounds). The database decides who is on which
 * panel; these only decide who is asked.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useAssessmentsOn, useCanBeSelector, useMySelectionRounds, type MyRound } from '@/lib/assessments';
import type { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { AppRole, Profile, TeamMembership, TeamRole } from '@/lib/types';

type Auth = ReturnType<typeof useAuth>;

let mockAuth: Partial<Auth>;
let mockOn = true;
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/club', () => ({ useFeature: (key: string) => key === 'selectionAssessments' && mockOn }));
jest.mock('expo-router', () => ({
  // Runs the focus callback once on mount, as opening the screen does.
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));

// CI runs in UTC; a check's expiry is compared with today.
beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-23T02:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
  mockOn = true;
  (supabase.rpc as jest.Mock).mockReset();
});
afterEach(() => jest.useRealTimers());

function profile(role: AppRole, extra: Partial<Profile> = {}): Profile {
  return {
    id: 'me',
    role,
    extra_roles: [],
    status: 'approved',
    stood_down_at: null,
    wwcc_number: '123456A',
    wwcc_expires_on: '2029-01-01',
    ...extra,
  } as Profile;
}

const inGroup = (team_role: TeamRole) => [{ team_role } as TeamMembership];

function auth(p: Profile | null, extra: Partial<Auth> = {}): Partial<Auth> {
  return { profile: p, memberships: [], exemption: null, wwccApplication: null, ...extra };
}

const NO_CHECK = { wwcc_number: null, wwcc_expires_on: null };

describe('useCanBeSelector', () => {
  it.each<[string, Partial<Auth>, boolean]>([
    ['a coach', auth(profile('coach')), true],
    ['an admin', auth(profile('admin')), true],
    ['an athlete who also coaches', auth(profile('athlete', { extra_roles: ['coach'] })), true],
    ['a statistician placed in a team as a coach', auth(profile('statistician'), { memberships: inGroup('coach') }), true],
    ['a guest with a current check', auth(profile('guest')), true],
    ['a guest with no check', auth(profile('guest', NO_CHECK)), false],
    ['a guest whose check has expired', auth(profile('guest', { wwcc_expires_on: '2026-11-22' })), false],
    ['a guest who is stood down', auth(profile('guest', { stood_down_at: '2026-10-01T00:00:00Z' })), false],
    [
      'a guest with a volunteer exemption',
      auth(profile('guest', NO_CHECK), { exemption: { valid: true } as Auth['exemption'] }),
      true,
    ],
    [
      'a guest with an ended volunteer exemption',
      auth(profile('guest', NO_CHECK), { exemption: { valid: false } as Auth['exemption'] }),
      false,
    ],
    [
      'a guest with an application in force',
      auth(profile('guest', NO_CHECK), { wwccApplication: { valid: true } as Auth['wwccApplication'] }),
      true,
    ],
    ['a manager', auth(profile('manager'), { memberships: inGroup('manager') }), false],
    ['a physio', auth(profile('physio')), false],
    ['the committee', auth(profile('committee')), false],
    ['an athlete', auth(profile('athlete'), { memberships: inGroup('athlete') }), false],
    ['a guardian', auth(profile('guardian')), false],
    ['a temporary helper', auth(profile('volunteer')), false],
    ['a coach waiting for approval', auth(profile('coach', { status: 'pending' }), { memberships: inGroup('coach') }), false],
    ['someone signed out', auth(null), false],
  ])('%s', async (_name, who, expected) => {
    mockAuth = who;
    expect((await renderHook(() => useCanBeSelector())).result.current).toBe(expected);
  });
});

describe('useMySelectionRounds', () => {
  const ROUNDS = [{ id: 'r1', name: '2027 selection phase' }] as MyRound[];
  const answer = (data: unknown) => (supabase.rpc as jest.Mock).mockResolvedValue({ data, error: null });

  async function rounds() {
    const hook = await renderHook(() => useMySelectionRounds());
    await act(async () => {});
    return hook;
  }

  it('reads the feature switch', async () => {
    mockAuth = auth(profile('coach'));
    expect((await renderHook(() => useAssessmentsOn())).result.current).toBe(true);
    mockOn = false;
    expect((await renderHook(() => useAssessmentsOn())).result.current).toBe(false);
  });

  it('gives a coach the rounds whose panel they are on', async () => {
    mockAuth = auth(profile('coach'));
    answer(ROUNDS);
    const { result } = await rounds();
    expect(result.current.selectionRounds).toEqual(ROUNDS);
    expect((supabase.rpc as jest.Mock).mock.calls).toEqual([['my_selection_rounds']]);
  });

  it('gives no rounds when the database answers nothing', async () => {
    mockAuth = auth(profile('coach'));
    answer(null);
    expect((await rounds()).result.current.selectionRounds).toEqual([]);
  });

  it('reads again when asked, as Home does on pull to refresh', async () => {
    mockAuth = auth(profile('coach'));
    answer([]);
    const { result } = await rounds();
    answer(ROUNDS);
    await act(async () => {
      await result.current.reloadSelectionRounds();
    });
    expect(result.current.selectionRounds).toEqual(ROUNDS);
  });

  it('never asks while the feature is off', async () => {
    mockAuth = auth(profile('coach'));
    mockOn = false;
    answer(ROUNDS);
    const { result } = await rounds();
    expect(result.current.selectionRounds).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('never asks for a member who couldn’t be on a panel', async () => {
    mockAuth = auth(profile('athlete'), { memberships: inGroup('athlete') });
    answer(ROUNDS);
    const { result } = await rounds();
    expect(result.current.selectionRounds).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
