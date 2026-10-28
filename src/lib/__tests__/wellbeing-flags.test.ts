import { act, renderHook, waitFor } from '@testing-library/react-native';

import { supabase } from '@/lib/supabase';
import {
  groupWellbeingFlags,
  REPEAT_FLAGS,
  useWellbeingFlagAlerts,
  WELLBEING_FLAG_DAYS,
  type WellbeingFlag,
} from '@/lib/wellbeing-flags';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect(effect: () => void) {
      React.useEffect(effect, [effect]);
    },
  };
});

const rpc = jest.mocked(supabase.rpc);
const answers = (data: unknown) => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data, error: null } as never);
};

const flag = (extra: Partial<WellbeingFlag>): WellbeingFlag => ({
  athlete_id: 'a1',
  athlete_name: 'Sample Athlete',
  day: '2026-10-18',
  lowest_score: 2,
  flags_in_7_days: 1,
  ...extra,
});

describe('wellbeing flags', () => {
  it('puts the officer on notice at 3 flags in 7 days, over 14 days of flags', () => {
    expect(REPEAT_FLAGS).toBe(3);
    expect(WELLBEING_FLAG_DAYS).toBe(14);
  });

  it('is empty with no flags', () => {
    expect(groupWellbeingFlags([])).toEqual([]);
  });

  it('groups each athlete’s days, newest first, with the lowest score', () => {
    const [athlete] = groupWellbeingFlags([
      flag({ day: '2026-10-14', lowest_score: 1, flags_in_7_days: 2 }),
      flag({ day: '2026-10-17', lowest_score: 2, flags_in_7_days: 2 }),
    ]);
    expect(athlete).toEqual({
      id: 'a1',
      name: 'Sample Athlete',
      days: [
        { day: '2026-10-17', lowestScore: 2 },
        { day: '2026-10-14', lowestScore: 1 },
      ],
      inLast7Days: 2,
      repeated: false,
    });
  });

  it('marks an athlete flagged on 3 or more days in 7, and only them', () => {
    const grouped = groupWellbeingFlags([
      flag({ athlete_id: 'two', athlete_name: 'Two', flags_in_7_days: 2 }),
      flag({ athlete_id: 'three', athlete_name: 'Three', flags_in_7_days: 3 }),
      flag({ athlete_id: 'four', athlete_name: 'Four', flags_in_7_days: 4 }),
    ]);
    expect(Object.fromEntries(grouped.map((a) => [a.id, a.repeated]))).toEqual({
      two: false,
      three: true,
      four: true,
    });
  });

  it('lists repeated flags first, then the most recently flagged, then by name', () => {
    const grouped = groupWellbeingFlags([
      flag({ athlete_id: 'old', athlete_name: 'Avery', day: '2026-10-10', flags_in_7_days: 0 }),
      flag({ athlete_id: 'new-b', athlete_name: 'Blake', day: '2026-10-18' }),
      flag({ athlete_id: 'new-a', athlete_name: 'Alex', day: '2026-10-18' }),
      flag({ athlete_id: 'repeat', athlete_name: 'Zed', day: '2026-10-12', flags_in_7_days: 3 }),
    ]);
    expect(grouped.map((a) => a.id)).toEqual(['repeat', 'new-a', 'new-b', 'old']);
  });
});

describe('useWellbeingFlagAlerts', () => {
  it('asks the database, and reports the officer and how many were flagged 3 times', async () => {
    answers(2);
    const { result } = await renderHook(() => useWellbeingFlagAlerts(true));
    await waitFor(() => expect(result.current).toEqual({ isOfficer: true, repeated: 2 }));
    expect(rpc).toHaveBeenCalledWith('wellbeing_flag_alerts');
  });

  it('reports the officer with nobody flagged 3 times', async () => {
    answers(0);
    const { result } = await renderHook(() => useWellbeingFlagAlerts(true));
    await waitFor(() => expect(result.current).toEqual({ isOfficer: true, repeated: 0 }));
  });

  it('treats a null answer as not the officer', async () => {
    answers(null);
    const { result } = await renderHook(() => useWellbeingFlagAlerts(true));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(result.current).toEqual({ isOfficer: false, repeated: 0 });
  });

  it('treats anything but a number as not the officer', async () => {
    answers('2');
    const { result } = await renderHook(() => useWellbeingFlagAlerts(true));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current).toEqual({ isOfficer: false, repeated: 0 });
  });

  it('never asks, and reports nothing, when not enabled', async () => {
    answers(2);
    const { result } = await renderHook(() => useWellbeingFlagAlerts(false));
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current).toEqual({ isOfficer: false, repeated: 0 });
  });

  it('stops reporting when turned off after an answer', async () => {
    answers(3);
    const { result, rerender } = await renderHook(({ on }: { on: boolean }) => useWellbeingFlagAlerts(on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.repeated).toBe(3));
    rerender({ on: false });
    expect(result.current).toEqual({ isOfficer: false, repeated: 0 });
  });

  it('asks once it is turned on', async () => {
    answers(1);
    const { result, rerender } = await renderHook(({ on }: { on: boolean }) => useWellbeingFlagAlerts(on), {
      initialProps: { on: false },
    });
    expect(rpc).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(result.current).toEqual({ isOfficer: true, repeated: 1 }));
  });
});
