import {
  kindLabel,
  loadChange,
  loggableDays,
  MAX_MINUTES,
  RPE_LABELS,
  sessionLine,
  sessionLoad,
  sessionProblem,
  weeklyLoads,
} from '@/lib/session-logs';
import type { SessionKind, SessionLog } from '@/lib/types';

function log(day: string, minutes: number, rpe: number, kind: SessionKind = 'training'): SessionLog {
  return { id: `${day}-${minutes}-${rpe}`, athlete_id: 'a', day, kind, minutes, rpe, updated_at: `${day}T08:00:00Z` };
}

describe('session load', () => {
  it('is minutes times effort', () => {
    expect(sessionLoad({ minutes: 90, rpe: 6 })).toBe(540);
    expect(sessionLoad({ minutes: 1, rpe: 1 })).toBe(1);
  });

  it('reads as one line', () => {
    expect(sessionLine({ kind: 'game', minutes: 60, rpe: 9 })).toBe('Game · 60 min · effort 9 · load 540');
  });

  it.each<[SessionKind, string]>([
    ['training', 'Training'],
    ['game', 'Game'],
    ['gym', 'Gym'],
    ['other', 'Other'],
  ])('names %s as %s', (kind, label) => {
    expect(kindLabel(kind)).toBe(label);
  });

  it('names an unknown kind Other', () => {
    expect(kindLabel('swim' as SessionKind)).toBe('Other');
  });

  it('labels every effort from 1 to 10', () => {
    expect(Object.keys(RPE_LABELS).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(RPE_LABELS[1]).toBe('Very easy');
    expect(RPE_LABELS[10]).toBe('Maximal');
  });
});

describe('weekly loads', () => {
  const today = '2026-10-18';

  it('totals four seven-day weeks ending today, newest first', () => {
    const weeks = weeklyLoads(
      [
        log('2026-10-18', 90, 6),
        log('2026-10-12', 60, 5),
        log('2026-10-11', 30, 2),
        log('2026-10-05', 45, 4),
        log('2026-09-21', 60, 8),
        log('2026-09-20', 60, 8),
      ],
      today,
    );
    expect(weeks).toEqual([
      { from: '2026-10-12', to: '2026-10-18', sessions: 2, minutes: 150, load: 840 },
      { from: '2026-10-05', to: '2026-10-11', sessions: 2, minutes: 75, load: 240 },
      { from: '2026-09-28', to: '2026-10-04', sessions: 0, minutes: 0, load: 0 },
      { from: '2026-09-21', to: '2026-09-27', sessions: 1, minutes: 60, load: 480 },
    ]);
  });

  it('counts a session logged for tomorrow (another time zone) in this week', () => {
    expect(weeklyLoads([log('2026-10-19', 30, 3)], today, 1)[0].sessions).toBe(1);
  });

  it('can give any number of weeks, across a month end', () => {
    const weeks = weeklyLoads([], '2026-11-02', 2);
    expect(weeks.map((w) => [w.from, w.to])).toEqual([
      ['2026-10-27', '2026-11-02'],
      ['2026-10-20', '2026-10-26'],
    ]);
  });

  it('is empty with no weeks', () => {
    expect(weeklyLoads([log(today, 1, 1)], today, 0)).toEqual([]);
  });
});

describe('load change', () => {
  const week = (load: number, sessions = 1) => ({ from: 'x', to: 'y', sessions, minutes: 0, load });

  it('compares this week with the average of earlier weeks that have sessions', () => {
    expect(loadChange([week(1400), week(1000), week(0, 0), week(1000)])).toBe('Up 40% on the 2 weeks before');
    expect(loadChange([week(700), week(1000), week(1000), week(1000)])).toBe('Down 30% on the 3 weeks before');
  });

  it('says the week before when there is only one', () => {
    expect(loadChange([week(500), week(1000)])).toBe('Down 50% on the week before');
  });

  it('says when it is the same', () => {
    expect(loadChange([week(1000), week(1000)])).toBe('The same as the week before');
  });

  it('counts a week with no sessions this week as down 100%', () => {
    expect(loadChange([week(0, 0), week(800)])).toBe('Down 100% on the week before');
  });

  it('has nothing to say without an earlier week', () => {
    expect(loadChange([week(1000)])).toBeNull();
    expect(loadChange([week(1000), week(0, 0)])).toBeNull();
    expect(loadChange([])).toBeNull();
  });
});

describe('logging', () => {
  it('offers today and the past week, newest first', () => {
    expect(loggableDays('2026-10-02')).toEqual([
      '2026-10-02',
      '2026-10-01',
      '2026-09-30',
      '2026-09-29',
      '2026-09-28',
      '2026-09-27',
      '2026-09-26',
      '2026-09-25',
    ]);
  });

  it.each([
    ['', 5],
    ['  ', 5],
    ['0', 5],
    ['-5', 5],
    ['1.5', 5],
    ['abc', 5],
    [String(MAX_MINUTES + 1), 5],
  ])('refuses %j minutes', (minutes, rpe) => {
    expect(sessionProblem(minutes, rpe)).toBe('Enter the minutes, from 1 to 300.');
  });

  it('needs an effort', () => {
    expect(sessionProblem('60', null)).toBe('Choose how hard it felt, from 1 to 10.');
  });

  it.each(['1', ' 90 ', '300'])('accepts %j minutes with an effort', (minutes) => {
    expect(sessionProblem(minutes, 1)).toBeNull();
  });
});
