import { act, renderHook, waitFor } from '@testing-library/react-native';

import { consentsNeeded, useClubPolicies, type ChildConsent, type ClubPolicies } from '@/lib/consents';
import { supabase } from '@/lib/supabase';

function child(overrides: Partial<ChildConsent>): ChildConsent {
  return {
    athlete_id: 'child-1',
    full_name: 'Sam Sample',
    data: false,
    health: false,
    can_consent: true,
    ...overrides,
  };
}

describe('consentsNeeded', () => {
  it('lists children missing either consent', () => {
    const none = child({ athlete_id: 'a' });
    const dataOnly = child({ athlete_id: 'b', data: true });
    const healthOnly = child({ athlete_id: 'c', health: true });
    expect(consentsNeeded([none, dataOnly, healthOnly])).toEqual([none, dataOnly, healthOnly]);
  });

  it('leaves out children with both consents', () => {
    expect(consentsNeeded([child({ data: true, health: true })])).toEqual([]);
  });

  it('leaves out children while the guardian is not verified', () => {
    expect(consentsNeeded([child({ can_consent: false })])).toEqual([]);
  });

  it('is empty with no children', () => {
    expect(consentsNeeded([])).toEqual([]);
  });
});

describe('useClubPolicies', () => {
  const rpc = jest.mocked(supabase.rpc);
  const answer = (data: ClubPolicies | null) => {
    const maybeSingle = jest.fn().mockResolvedValue({ data, error: null });
    rpc.mockReset().mockReturnValue({ maybeSingle } as never);
  };

  it('is null while loading, then the club’s policy links', async () => {
    const policies: ClubPolicies = {
      privacy_policy_url: 'https://example.com/privacy.pdf',
      safeguarding_policy_url: 'https://example.com/safeguarding.pdf',
      code_of_conduct_url: null,
      policy_version: '2026-1',
    };
    // The answer waits until the loading state has been checked: render now
    // finishes every update it can before handing back.
    let reply!: (value: unknown) => void;
    const maybeSingle = jest.fn(() => new Promise((resolve) => (reply = resolve)));
    rpc.mockReset().mockReturnValue({ maybeSingle } as never);
    const { result } = await renderHook(() => useClubPolicies());
    expect(result.current).toBeNull();
    await act(async () => reply({ data: policies, error: null }));
    await waitFor(() => expect(result.current).toEqual(policies));
    expect(rpc).toHaveBeenCalledWith('club_policies');
  });

  it('stays null when the club has none recorded', async () => {
    answer(null);
    const { result } = await renderHook(() => useClubPolicies());
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it('asks once, not on every render', async () => {
    answer(null);
    const { rerender } = await renderHook(() => useClubPolicies());
    await act(async () => {});
    await rerender({});
    await rerender({});
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
