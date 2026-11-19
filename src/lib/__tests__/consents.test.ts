import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  asksCheckIns,
  consentKindsShown,
  consentsNeeded,
  consentTodoDetail,
  needsConsent,
  useClubPolicies,
  type ChildConsent,
  type ClubPolicies,
} from '@/lib/consents';
import { supabase } from '@/lib/supabase';

function child(overrides: Partial<ChildConsent>): ChildConsent {
  return {
    athlete_id: 'child-1',
    full_name: 'Sam Sample',
    data: false,
    health: false,
    publish: false,
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

  it('never asks for the live stream consent, which is optional', () => {
    expect(consentsNeeded([child({ data: true, health: true, publish: false })])).toEqual([]);
    const missing = child({ publish: true });
    expect(consentsNeeded([missing])).toEqual([missing]);
  });

  it('leaves out children while the guardian is not verified', () => {
    expect(consentsNeeded([child({ can_consent: false })])).toEqual([]);
  });

  it('is empty with no children', () => {
    expect(consentsNeeded([])).toEqual([]);
  });
});

describe('consent follows the feature switches', () => {
  it('asks for check-in consent only while Daily check-ins is on', () => {
    expect(asksCheckIns(child({ check_ins_on: true }))).toBe(true);
    expect(asksCheckIns(child({ check_ins_on: false }))).toBe(false);
    // Before the database says (an older database), it is asked as before.
    expect(asksCheckIns(child({}))).toBe(true);
  });

  it('drops the unanswered check-in ask when Daily check-ins is off', () => {
    const healthGiven = child({ health: true, check_ins_on: false });
    expect(needsConsent(healthGiven)).toBe(false);
    expect(consentsNeeded([healthGiven])).toEqual([]);
  });

  it('asks again once Daily check-ins is back on, if check-in consent was never given', () => {
    expect(needsConsent(child({ health: true, check_ins_on: true }))).toBe(true);
  });

  it('doesn’t ask again when check-in consent was given before', () => {
    expect(needsConsent(child({ data: true, health: true, check_ins_on: true }))).toBe(false);
    expect(needsConsent(child({ data: true, health: true, check_ins_on: false }))).toBe(false);
  });

  it('always asks for health consent, which covers medical details', () => {
    expect(needsConsent(child({ data: true, check_ins_on: false }))).toBe(true);
    expect(needsConsent(child({ check_ins_on: false }))).toBe(true);
  });

  it('never asks a parent who isn’t verified yet', () => {
    expect(needsConsent(child({ can_consent: false, check_ins_on: true }))).toBe(false);
  });

  it('uses the database’s answer when it gives one', () => {
    expect(needsConsent(child({ needs_consent: false }))).toBe(false);
    expect(needsConsent(child({ data: true, health: true, needs_consent: true }))).toBe(true);
  });

  it('says what the to-do is still asking', () => {
    expect(consentTodoDetail(child({}))).toBe('Choose who sees their check-ins and injury details');
    expect(consentTodoDetail(child({ health: true }))).toBe('Choose who sees their check-ins');
    expect(consentTodoDetail(child({ check_ins_on: false }))).toBe(
      'Choose who sees their injury and medical details',
    );
    expect(consentTodoDetail(child({ data: true }))).toBe(
      'Choose who sees their injury and medical details',
    );
  });

  it('shows check-in and stream questions only while their features are on', () => {
    expect(consentKindsShown(child({}))).toEqual(['data', 'health', 'publish']);
    expect(consentKindsShown(child({ check_ins_on: false }))).toEqual(['health', 'publish']);
    expect(consentKindsShown(child({ streams_on: false }))).toEqual(['data', 'health']);
    expect(consentKindsShown(child({ check_ins_on: false, streams_on: false }))).toEqual([
      'health',
    ]);
  });

  it('keeps showing a consent already given while its feature is off, so it can be withdrawn', () => {
    expect(
      consentKindsShown(
        child({
          data: true,
          publish: true,
          check_ins_on: false,
          streams_on: false,
        }),
      ),
    ).toEqual(['data', 'health', 'publish']);
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
