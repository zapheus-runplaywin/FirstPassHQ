/**
 * Training load prompts (20261028000000_load_monitoring.sql): how each flag
 * is worded for coaches, athletes and parents, the published source behind
 * each, and the coach-only numbers worked out from session logs (Foster's
 * monotony and strain, average effort, and TrainingPeaks-style fitness,
 * fatigue and form).
 */
import {
  averageEffort,
  dailyLoads,
  fitnessFatigue,
  FLAG_WORDS,
  groupLoadPatterns,
  LOAD_CAVEAT,
  monotonyAndStrain,
  parentLine,
  PATTERN_WORDS,
  RATIO_CHOICES,
  sourcesFor,
  type LoadFlag,
} from '@/lib/load-monitoring';
import { LOAD_SOURCES } from '@/lib/load-sources';
import { buildTodos } from '@/lib/todos';
import type { SessionLog } from '@/lib/types';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn(), useFeature: jest.fn() }));
jest.mock('@/lib/messages', () => ({ useCaptainedGroupIds: jest.fn() }));

function log(day: string, minutes: number, rpe: number): SessionLog {
  return {
    id: `${day}-${minutes}-${rpe}`,
    athlete_id: 'a',
    day,
    kind: 'training',
    minutes,
    rpe,
    updated_at: `${day}T08:00:00Z`,
  };
}

const FLAGS: LoadFlag[] = ['ratio', 'hours', 'injury', 'wellbeing'];

describe('sources', () => {
  it('links every source to a DOI or the publisher’s page over https', () => {
    for (const s of Object.values(LOAD_SOURCES)) {
      expect(s.url).toMatch(/^https:\/\/(doi\.org\/10\.|www\.trainingpeaks\.com\/)/);
      expect(s.title.length).toBeGreaterThan(10);
      expect(s.finding.length).toBeGreaterThan(20);
    }
  });

  it('keys every source by its own key', () => {
    for (const [key, s] of Object.entries(LOAD_SOURCES)) expect(s.key).toBe(key);
  });

  it('rests every science flag on a published source; the injury flag on the club’s record', () => {
    expect(FLAG_WORDS.ratio.sources).toEqual(['gabbett2016', 'murray2017', 'impellizzeri2020']);
    expect(FLAG_WORDS.hours.sources).toEqual(['jayanthi2015']);
    expect(FLAG_WORDS.wellbeing.sources).toEqual(['saw2016']);
    expect(FLAG_WORDS.injury.sources).toEqual([]);
  });

  it('lists each source once, in flag order', () => {
    expect(sourcesFor(['hours', 'ratio', 'wellbeing', 'hours'])).toEqual([
      'jayanthi2015',
      'gabbett2016',
      'murray2017',
      'impellizzeri2020',
      'saw2016',
    ]);
    expect(sourcesFor([])).toEqual([]);
    expect(sourcesFor(['injury'])).toEqual([]);
  });

  it('offers admins only published ratio values, 1.5 first as the default', () => {
    expect(RATIO_CHOICES.map((c) => c.value)).toEqual(['from_1_5', 'above_1_3', 'off']);
    expect(RATIO_CHOICES[0].detail).toMatch(/Gabbett 2016/);
    expect(RATIO_CHOICES[1].detail).toMatch(/0\.8 to 1\.3/);
  });
});

describe('wording', () => {
  it('words every flag for coaches, athletes and parents', () => {
    for (const f of FLAGS) {
      expect(FLAG_WORDS[f].coach).toBeTruthy();
      expect(FLAG_WORDS[f].athlete).toBeTruthy();
      expect(FLAG_WORDS[f].parent).toBeTruthy();
    }
  });

  it('never uses alarming words for parents or athletes', () => {
    const calm = [...FLAGS.map((f) => FLAG_WORDS[f].parent), ...FLAGS.map((f) => FLAG_WORDS[f].athlete)];
    for (const line of calm) expect(line).not.toMatch(/risk|danger|warning|injury risk|%/i);
  });

  it('tells a parent who checked in and what it was about', () => {
    expect(parentLine('Sam', 'Casey Coach', ['hours'])).toBe(
      'Casey Coach checked in with Sam about their training load. The club noticed they did more hours of sport in the week than their age in years. Coaches review training load as part of looking after every athlete.',
    );
  });

  it('joins several reasons into one sentence', () => {
    expect(parentLine('Sam', 'Casey Coach', ['ratio', 'hours', 'wellbeing'])).toContain(
      'The club noticed their training was well up on the weeks before, they did more hours of sport in the week than their age in years and they also had some low check-ins that week.',
    );
    expect(parentLine('Sam', 'Casey Coach', ['ratio', 'wellbeing'])).toContain(
      'their training was well up on the weeks before and they also had some low check-ins that week.',
    );
  });

  it('says nothing about reasons when there are none', () => {
    expect(parentLine('Sam', 'Casey Coach', [])).toBe(
      'Casey Coach checked in with Sam about their training load. Coaches review training load as part of looking after every athlete.',
    );
  });

  it('carries the caveat that load isn’t for decisions', () => {
    expect(LOAD_CAVEAT).toMatch(/^Training load is a conversation starter, not a diagnosis\./);
    expect(LOAD_CAVEAT).toMatch(/must not be relied on for selection, medical or return-to-play decisions/);
  });

  it('words each Child Safety Officer pattern', () => {
    expect(Object.keys(PATTERN_WORDS).sort()).toEqual(['hours_2_weeks', 'not_followed_up', 'with_wellbeing']);
  });
});

describe('daily loads', () => {
  it('totals each day and fills days with no sessions', () => {
    expect(
      dailyLoads([log('2026-10-16', 60, 5), log('2026-10-16', 30, 2), log('2026-10-18', 10, 1)], '2026-10-15', '2026-10-18'),
    ).toEqual([
      { day: '2026-10-15', load: 0 },
      { day: '2026-10-16', load: 360 },
      { day: '2026-10-17', load: 0 },
      { day: '2026-10-18', load: 10 },
    ]);
  });

  it('counts a session dated after the last day (another time zone) on the last day', () => {
    expect(dailyLoads([log('2026-10-19', 10, 2)], '2026-10-18', '2026-10-18')).toEqual([
      { day: '2026-10-18', load: 20 },
    ]);
  });

  it('crosses a month end', () => {
    expect(dailyLoads([], '2026-10-31', '2026-11-01').map((d) => d.day)).toEqual(['2026-10-31', '2026-11-01']);
  });
});

describe('monotony and strain (Foster 1998)', () => {
  it('is the week’s mean daily load over its spread, and load times that', () => {
    // 300 on four days, 0 on three: mean 171.4, sd 148.5.
    const logs = ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-18'].map((d) => log(d, 60, 5));
    expect(monotonyAndStrain(logs, '2026-10-18')).toEqual({ monotony: 1.2, strain: 1440 });
  });

  it('is higher when every day is hard', () => {
    const logs = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'].map((d) =>
      log(d, 60, 6),
    );
    logs.push(log('2026-10-18', 50, 6));
    expect(monotonyAndStrain(logs, '2026-10-18')!.monotony).toBeGreaterThan(2);
  });

  it('is null with no sessions, or when every day is the same', () => {
    expect(monotonyAndStrain([], '2026-10-18')).toBeNull();
    const same = ['12', '13', '14', '15', '16', '17', '18'].map((d) => log(`2026-10-${d}`, 60, 5));
    expect(monotonyAndStrain(same, '2026-10-18')).toBeNull();
  });

  it('ignores sessions before the 7 days', () => {
    expect(monotonyAndStrain([log('2026-10-11', 60, 5)], '2026-10-18')).toBeNull();
  });
});

describe('average effort', () => {
  it('averages the sessions in range to one place', () => {
    expect(averageEffort([log('2026-10-17', 60, 6), log('2026-10-18', 30, 7), log('2026-10-18', 30, 7)], '2026-10-12', '2026-10-18')).toBe(6.7);
  });

  it('is null with no sessions in range', () => {
    expect(averageEffort([log('2026-10-01', 60, 6)], '2026-10-12', '2026-10-18')).toBeNull();
  });
});

describe('fitness, fatigue and form (TrainingPeaks)', () => {
  it('moves fitness 1/42 and fatigue 1/7 of the way to each day’s load', () => {
    const [first, second] = fitnessFatigue([log('2026-10-17', 42, 10)], '2026-10-17', '2026-10-18');
    // 420 load: fitness 10, fatigue 60, form -50.
    expect(first).toEqual({ day: '2026-10-17', fitness: 10, fatigue: 60, form: -50 });
    // A rest day: both fade, fatigue faster, so form rises.
    expect(second.fitness).toBe(10);
    expect(second.fatigue).toBe(51);
    expect(second.form).toBe(-42);
  });

  it('settles at the daily load with steady training, form near zero', () => {
    const logs = Array.from({ length: 300 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + i));
      return log(d.toISOString().slice(0, 10), 60, 5);
    });
    const days = fitnessFatigue(logs, '2026-01-01', '2026-10-27');
    const last = days[days.length - 1];
    expect(last.fitness).toBeGreaterThan(295);
    expect(last.fatigue).toBe(300);
    expect(Math.abs(last.form)).toBeLessThan(5);
  });

  it('gives every day, oldest first', () => {
    expect(fitnessFatigue([], '2026-10-16', '2026-10-18').map((d) => d.day)).toEqual([
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
  });
});

describe('the Child Safety Officer’s patterns', () => {
  it('groups by child in name order', () => {
    expect(
      groupLoadPatterns([
        { athlete_id: 'b', athlete_name: 'Zoe', pattern: 'with_wellbeing', since: '2026-10-18' },
        { athlete_id: 'a', athlete_name: 'Ari', pattern: 'hours_2_weeks', since: '2026-10-11' },
        { athlete_id: 'b', athlete_name: 'Zoe', pattern: 'not_followed_up', since: '2026-10-11' },
      ]),
    ).toEqual([
      { id: 'a', name: 'Ari', patterns: [{ pattern: 'hours_2_weeks', since: '2026-10-11' }] },
      {
        id: 'b',
        name: 'Zoe',
        patterns: [
          { pattern: 'with_wellbeing', since: '2026-10-18' },
          { pattern: 'not_followed_up', since: '2026-10-11' },
        ],
      },
    ]);
  });
});

describe('to-dos', () => {
  const todos = (overrides: Partial<Parameters<typeof buildTodos>[0]> = {}) =>
    buildTodos({
      userId: 'me',
      injuries: [],
      pendingCount: 0,
      needsCheckIn: false,
      flaggedAthletes: 0,
      today: new Date('2026-10-18T09:00:00Z'),
      ...overrides,
    });

  it('asks a coach to talk with athletes who have load flags', () => {
    expect(todos({ loadFlags: 2 }).find((t) => t.key === 'load-flags')).toMatchObject({
      title: 'Talk with 2 athletes about their training load',
      detail: 'A conversation starter from the sessions they log, not a diagnosis',
      href: '/check-ins/load',
    });
    expect(todos({ loadFlags: 1 }).find((t) => t.key === 'load-flags')?.title).toBe(
      'Talk with 1 athlete about their training load',
    );
  });

  it('asks the Child Safety Officer to look at children’s patterns', () => {
    expect(todos({ loadPatternAlerts: 1 }).find((t) => t.key === 'load-patterns')).toMatchObject({
      title: 'Look at 1 child’s training load',
      href: '/concerns/load',
    });
    expect(todos({ loadPatternAlerts: 3 }).find((t) => t.key === 'load-patterns')?.title).toBe(
      'Look at 3 children’s training load',
    );
  });

  it('adds nothing with no flags or patterns', () => {
    const keys = todos().map((t) => t.key);
    expect(keys).not.toContain('load-flags');
    expect(keys).not.toContain('load-patterns');
  });
});
