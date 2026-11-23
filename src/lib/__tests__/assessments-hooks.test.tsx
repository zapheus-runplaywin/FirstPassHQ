/**
 * Who could sit on a selection panel (useCanBeSelector) and the rounds Home
 * shows them (useMySelectionRounds). The database decides who is on which
 * panel; these only decide who is asked.
 */
import { act, renderHook } from '@testing-library/react-native';

import {
  useAssessmentsOn,
  useCanBeSelector,
  useCanSeeSelectionInfo,
  useMySelectionInfo,
  useMySelectionRounds,
  useMySelectionTodos,
  type MyRound,
  type SelectionInfo,
  type SelectionTodo,
} from '@/lib/assessments';
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

describe('useMySelectionTodos', () => {
  const TODOS = [{ kind: 'date', round_id: 'r1', milestone_id: 'm1' }] as SelectionTodo[];
  const answer = (data: unknown) => (supabase.rpc as jest.Mock).mockResolvedValue({ data, error: null });

  async function todos() {
    const hook = await renderHook(() => useMySelectionTodos());
    await act(async () => {});
    return hook;
  }

  it.each<[string, Partial<Auth>]>([
    ['a coach', auth(profile('coach'))],
    ['an admin', auth(profile('admin'))],
    ['a guest with a current check', auth(profile('guest'))],
  ])('asks for %s’s selection to-dos', async (_name, who) => {
    mockAuth = who;
    answer(TODOS);
    const { result } = await todos();
    expect(result.current.selectionTodos).toEqual(TODOS);
    expect((supabase.rpc as jest.Mock).mock.calls).toEqual([['my_selection_todos']]);
  });

  it.each<[string, Partial<Auth>]>([
    ['an athlete', auth(profile('athlete'), { memberships: inGroup('athlete') })],
    ['a guardian', auth(profile('guardian'))],
    ['a manager', auth(profile('manager'), { memberships: inGroup('manager') })],
    ['the committee', auth(profile('committee'))],
    ['a physio', auth(profile('physio'))],
    ['a guest with no check', auth(profile('guest', NO_CHECK))],
    ['someone signed out', auth(null)],
  ])('never asks for %s', async (_name, who) => {
    mockAuth = who;
    answer(TODOS);
    const { result } = await todos();
    expect(result.current.selectionTodos).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('gives none when the database answers nothing, and reads again when asked', async () => {
    mockAuth = auth(profile('coach'));
    answer(null);
    const { result } = await todos();
    expect(result.current.selectionTodos).toEqual([]);
    answer(TODOS);
    await act(async () => {
      await result.current.reloadSelectionTodos();
    });
    expect(result.current.selectionTodos).toEqual(TODOS);
  });

  it('never asks while the feature is off, even when told to read again', async () => {
    mockAuth = auth(profile('coach'));
    mockOn = false;
    answer(TODOS);
    const { result } = await todos();
    await act(async () => {
      await result.current.reloadSelectionTodos();
    });
    expect(result.current.selectionTodos).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('who sees a round’s criteria and dates', () => {
  const INFO = [{ round_id: 'r1', athlete_id: 'me', is_me: true }] as SelectionInfo[];
  const answer = (data: unknown) => (supabase.rpc as jest.Mock).mockResolvedValue({ data, error: null });

  async function info() {
    const hook = await renderHook(() => useMySelectionInfo());
    await act(async () => {});
    return hook;
  }

  const CASES: [string, Partial<Auth>, boolean][] = [
    ['an athlete', auth(profile('athlete')), true],
    ['a guardian', auth(profile('guardian')), true],
    ['a coach who also plays', auth(profile('coach', { extra_roles: ['athlete'] })), true],
    ['a coach placed in a team as an athlete', auth(profile('coach'), { memberships: inGroup('athlete') }), true],
    ['a coach', auth(profile('coach'), { memberships: inGroup('coach') }), false],
    ['an admin', auth(profile('admin')), false],
    ['a manager', auth(profile('manager'), { memberships: inGroup('manager') }), false],
    ['the committee', auth(profile('committee')), false],
    ['a physio', auth(profile('physio')), false],
    ['a guest', auth(profile('guest')), false],
    ['a temporary helper', auth(profile('volunteer')), false],
    ['an athlete waiting for approval', auth(profile('athlete', { status: 'pending' })), false],
    ['someone signed out', auth(null), false],
  ];

  it.each(CASES)('%s', async (_name, who, expected) => {
    mockAuth = who;
    expect((await renderHook(() => useCanSeeSelectionInfo())).result.current).toBe(expected);
    answer(INFO);
    const { result } = await info();
    expect(result.current.selectionInfo).toEqual(expected ? INFO : []);
    expect((supabase.rpc as jest.Mock).mock.calls).toEqual(expected ? [['my_selection_info']] : []);
  });

  it.each(CASES.filter(([, , expected]) => expected))('not %s while the feature is off', async (_name, who) => {
    mockAuth = who;
    mockOn = false;
    expect((await renderHook(() => useCanSeeSelectionInfo())).result.current).toBe(false);
    answer(INFO);
    const { result } = await info();
    await act(async () => {
      await result.current.reloadSelectionInfo();
    });
    expect(result.current.selectionInfo).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('gives none when the database answers nothing, and reads again when asked', async () => {
    mockAuth = auth(profile('athlete'));
    answer(null);
    const { result } = await info();
    expect(result.current.selectionInfo).toEqual([]);
    answer(INFO);
    await act(async () => {
      await result.current.reloadSelectionInfo();
    });
    expect(result.current.selectionInfo).toEqual(INFO);
  });
});
