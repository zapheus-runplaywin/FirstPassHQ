/**
 * useConductTodos: the code of conduct acceptances the signed-in member owes
 * this season, for the Home to-do list. role-access.test.tsx checks who it
 * asks the server for; these check what it hands back and when it reloads.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { useAuth } from '@/lib/auth';
import { useConductTodos, type ConductTodo } from '@/lib/conduct';
import { supabase } from '@/lib/supabase';

let mockStatus: string | null = 'approved';
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ profile: mockStatus ? { status: mockStatus } : null }) as ReturnType<typeof useAuth>,
}));

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect(effect: () => void) {
      React.useEffect(effect, [effect]);
    },
  };
});

const todo = (overrides: Partial<ConductTodo> = {}): ConductTodo => ({
  profile_id: 'child-1',
  full_name: 'Jo Sample',
  for_child: true,
  statement: 'I accept the code of conduct for Jo Sample.',
  code_of_conduct_url: 'https://example.com/conduct.pdf',
  ...overrides,
});

const rpc = jest.mocked(supabase.rpc);

function answers(...results: (ConductTodo[] | null)[]) {
  rpc.mockReset();
  for (const data of results) rpc.mockResolvedValueOnce({ data, error: null } as never);
}

beforeEach(() => {
  mockStatus = 'approved';
});

it('loads the acceptances an approved member owes', async () => {
  const owed = [todo(), todo({ profile_id: 'me', full_name: 'Sam Sample', for_child: false })];
  answers(owed);
  const { result } = renderHook(() => useConductTodos());
  expect(result.current.conductTodos).toEqual([]);
  await waitFor(() => expect(result.current.conductTodos).toEqual(owed));
  expect(rpc).toHaveBeenCalledWith('my_conduct_todos');
});

it('shows none when the server sends nothing back', async () => {
  answers(null);
  const { result } = renderHook(() => useConductTodos());
  await waitFor(() => expect(rpc).toHaveBeenCalled());
  await act(async () => {});
  expect(result.current.conductTodos).toEqual([]);
});

it.each([['waiting for approval', 'pending'], ['turned down', 'rejected'], ['signed out', null]])(
  'asks for nothing and shows nothing while %s',
  async (_label, status) => {
    mockStatus = status;
    answers([todo()]);
    const { result } = renderHook(() => useConductTodos());
    await act(async () => {});
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.conductTodos).toEqual([]);
    await act(() => result.current.reloadConductTodos());
    expect(rpc).not.toHaveBeenCalled();
  },
);

it('loads once the member is approved', async () => {
  mockStatus = 'pending';
  answers([todo()]);
  const { result, rerender } = renderHook(() => useConductTodos());
  await act(async () => {});
  expect(rpc).not.toHaveBeenCalled();
  mockStatus = 'approved';
  rerender({});
  await waitFor(() => expect(result.current.conductTodos).toEqual([todo()]));
});

it('reloads on request, so an acceptance leaves the list', async () => {
  answers([todo()], []);
  const { result } = renderHook(() => useConductTodos());
  await waitFor(() => expect(result.current.conductTodos).toHaveLength(1));
  await act(() => result.current.reloadConductTodos());
  expect(result.current.conductTodos).toEqual([]);
  expect(rpc).toHaveBeenCalledTimes(2);
});
