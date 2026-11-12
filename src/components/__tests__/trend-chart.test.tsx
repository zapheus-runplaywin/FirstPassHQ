/**
 * The check-in trend charts (src/components/trend-chart.tsx), from "Check-in
 * averages" in section 8 and "Athletes' check-ins" in section 6 of
 * docs/user-guide.md: one chart per question on a 1 to 5 scale, each day a
 * three-day average, and how many checked in each day. Days with too few
 * check-ins have no scores (the database leaves them null), so no number is
 * ever shown for them. Tapping a day shows its numbers.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CheckInTrends } from '@/components/trend-chart';
import { formatShortDay } from '@/lib/format';
import { parseDateString } from '@/lib/injuries';
import type { CheckInTrendDay } from '@/lib/types';

jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club-choice', () =>
  jest.requireActual('../../__tests__/helpers/harness').clubChoiceModuleMock(),
);
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-18T02:00:00Z') }));
afterEach(() => jest.useRealTimers());

function day(d: string, extra: Partial<CheckInTrendDay> = {}): CheckInTrendDay {
  return {
    day: d,
    checked_in_count: 4,
    window_count: 11,
    flagged_count: 0,
    avg_sleep: 3.25,
    avg_soreness: 2.5,
    avg_stress: 4,
    avg_mood: 3.75,
    ...extra,
  };
}

const short = (d: string) => formatShortDay(parseDateString(d));

const DAYS = [
  day('2026-10-14', { checked_in_count: 1, window_count: 1, flagged_count: null, avg_sleep: null, avg_soreness: null, avg_stress: null, avg_mood: null }),
  day('2026-10-15', { checked_in_count: 2, avg_sleep: 4.5, avg_mood: 4 }),
  day('2026-10-16', { checked_in_count: 6, flagged_count: 2, avg_sleep: '2.0' as unknown as number }),
  // Today has too few check-ins over its three days for scores.
  day('2026-10-17', { checked_in_count: 0, window_count: 2, flagged_count: null, avg_sleep: null, avg_soreness: null, avg_stress: null, avg_mood: null }),
];

/** The value shown beside each chart's title, top to bottom. */
function values() {
  return ['Sleep', 'Soreness', 'Stress', 'Mood', 'Checked in'].map((title) => {
    // The header row holds the title and the value.
    let row = screen.getByText(title);
    const texts = () => row.queryAll((n) => n.type === 'Text', { includeSelf: true });
    while (texts().length < 2) row = row.parent!;
    return texts()[1].props.children;
  });
}

async function layOut(width = 332) {
  // The note's parent is the View whose onLayout sizes the charts.
  await fireEvent(screen.getByText(/^Averages out of 5/).parent!, 'layout', {
    nativeEvent: { layout: { width, height: 600 } },
  });
}

it('shows nothing with no days', async () => {
  await render(<CheckInTrends days={[]} />);
  expect(screen.toJSON()).toBeNull();
});

it('opens on the latest day with scores, never one without', async () => {
  await render(<CheckInTrends days={DAYS} />);
  expect(screen.getByText(`${short('2026-10-16')} · 6 checked in · 11 over 3 days · 2 flagged`)).toBeTruthy();
  expect(values()).toEqual(['2.0', '2.5', '4.0', '3.8', 6]);
});

it('says when no day has enough check-ins for scores', async () => {
  await render(<CheckInTrends days={[DAYS[0], DAYS[3]]} />);
  expect(screen.getByText('Not enough check-ins yet')).toBeTruthy();
  expect(values()).toEqual(['–', '–', '–', '–', '–']);
});

it('labels the first and last day, and explains the flag line', async () => {
  await render(<CheckInTrends days={DAYS} />);
  expect(screen.getByText(short('2026-10-14'))).toBeTruthy();
  expect(screen.getByText(short('2026-10-17'))).toBeTruthy();
  expect(screen.getByText(/The red line is 2: a score at or below it flags an athlete\./)).toBeTruthy();
});

describe('once laid out', () => {
  it('draws a tap target for each day in each chart', async () => {
    await render(<CheckInTrends days={DAYS} />);
    expect(screen.queryAllByLabelText('Day 1 of 4')).toHaveLength(0);
    await layOut();
    // Four question charts and the count chart.
    expect(screen.getAllByLabelText('Day 1 of 4')).toHaveLength(5);
    expect(screen.getAllByLabelText('Day 4 of 4')).toHaveLength(5);
  });

  it('tapping a day shows its numbers in every chart, and tapping it again goes back', async () => {
    await render(<CheckInTrends days={DAYS} />);
    await layOut();
    await fireEvent.press(screen.getAllByLabelText('Day 2 of 4')[0]);
    expect(screen.getByText(`${short('2026-10-15')} · 2 checked in · 11 over 3 days`)).toBeTruthy();
    expect(values()).toEqual(['4.5', '2.5', '4.0', '4.0', 2]);
    await fireEvent.press(screen.getAllByLabelText('Day 2 of 4')[4]);
    expect(values()).toEqual(['2.0', '2.5', '4.0', '3.8', 6]);
  });

  it('a day without scores shows dashes, but still its count', async () => {
    await render(<CheckInTrends days={DAYS} />);
    await layOut();
    await fireEvent.press(screen.getAllByLabelText('Day 4 of 4')[4]);
    expect(screen.getByText(`${short('2026-10-17')} · 0 checked in · 2 over 3 days`)).toBeTruthy();
    expect(values()).toEqual(['–', '–', '–', '–', 0]);
  });

  it('copes with a single day', async () => {
    await render(<CheckInTrends days={[DAYS[1]]} />);
    await layOut();
    expect(screen.getAllByLabelText('Day 1 of 1')).toHaveLength(5);
    expect(values()).toEqual(['4.5', '2.5', '4.0', '4.0', 2]);
  });

  it('draws nothing too narrow to plot', async () => {
    await render(<CheckInTrends days={DAYS} />);
    await layOut(20);
    expect(screen.queryAllByLabelText('Day 1 of 4')).toHaveLength(0);
  });
});
