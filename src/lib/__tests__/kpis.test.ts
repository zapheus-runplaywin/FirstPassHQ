import {
  amount,
  kpiCountLabel,
  onTarget,
  progressLabel,
  progressShare,
  reviewCountLabel,
  targetLabel,
  whoSeesLabel,
  whoSetsLabel,
  type KpiMeasure,
  type KpiPerson,
} from '@/lib/kpis';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));

function measure(overrides: Partial<KpiMeasure> = {}): KpiMeasure {
  return {
    id: 'm',
    title: null,
    kind: 'number',
    target: 10,
    unit: null,
    lower_is_better: false,
    baseline: null,
    current_value: null,
    done: false,
    progress_by_name: null,
    progress_at: null,
    ...overrides,
  };
}

function person(overrides: Partial<KpiPerson> = {}): KpiPerson {
  return {
    profile_id: 'p',
    full_name: 'Sam Sample',
    team_id: 't',
    team_name: 'Open A',
    team_kind: 'team',
    season: 2026,
    archived: false,
    team_role: 'athlete',
    coach_title: null,
    relation: 'setter',
    kpi_count: 3,
    result_count: 0,
    review_count: 3,
    reviews_written: 0,
    reviews_confirmed: 0,
    ...overrides,
  };
}

describe('amount', () => {
  it('formats numbers with units', () => {
    expect(amount(60, null)).toBe('60');
    expect(amount(60, '%')).toBe('60%');
    expect(amount(12, 'sessions')).toBe('12 sessions');
    expect(amount(1234.567, 'm')).toBe('1,234.57 m');
  });

  it('is blank with no value', () => {
    expect(amount(null, '%')).toBe('');
  });

  it('shows zero', () => {
    expect(amount(0, '%')).toBe('0%');
  });
});

describe('targetLabel', () => {
  it('describes the target', () => {
    expect(targetLabel(measure({ target: 75, unit: '%' }))).toBe('Target 75%');
    expect(targetLabel(measure({ target: 2, lower_is_better: true }))).toBe('Target 2 or fewer');
    expect(targetLabel(measure({ kind: 'yes_no' }))).toBe('Done or not done');
  });
});

describe('progressLabel', () => {
  it('describes progress', () => {
    expect(progressLabel(measure({ current_value: 68, unit: '%' }))).toBe('68% so far');
    expect(progressLabel(measure())).toBe('No progress recorded yet');
    expect(progressLabel(measure({ kind: 'yes_no', done: true }))).toBe('✓ Done');
    expect(progressLabel(measure({ kind: 'yes_no' }))).toBe('Not done yet');
  });
});

describe('onTarget', () => {
  it('compares progress with the target', () => {
    expect(onTarget(measure({ current_value: 10 }))).toBe(true);
    expect(onTarget(measure({ current_value: 9 }))).toBe(false);
    expect(onTarget(measure({ lower_is_better: true, target: 2, current_value: 2 }))).toBe(true);
    expect(onTarget(measure({ lower_is_better: true, target: 2, current_value: 3 }))).toBe(false);
  });

  it('is false without progress or a target', () => {
    expect(onTarget(measure())).toBe(false);
    expect(onTarget(measure({ target: null, current_value: 5 }))).toBe(false);
  });

  it('uses done for yes or no measures', () => {
    expect(onTarget(measure({ kind: 'yes_no', done: true }))).toBe(true);
    expect(onTarget(measure({ kind: 'yes_no', done: false }))).toBe(false);
  });
});

describe('progressShare', () => {
  it('is 0 or 1 for yes or no measures', () => {
    expect(progressShare(measure({ kind: 'yes_no', done: true }))).toBe(1);
    expect(progressShare(measure({ kind: 'yes_no' }))).toBe(0);
  });

  it('is 0 without progress or a target', () => {
    expect(progressShare(measure())).toBe(0);
    expect(progressShare(measure({ target: null, current_value: 3 }))).toBe(0);
  });

  it('counts up from the baseline, or zero', () => {
    expect(progressShare(measure({ current_value: 5 }))).toBe(0.5);
    expect(progressShare(measure({ baseline: 4, current_value: 7 }))).toBe(0.5);
    expect(progressShare(measure({ current_value: 15 }))).toBe(1);
    expect(progressShare(measure({ baseline: 4, current_value: 2 }))).toBe(0);
  });

  it('is all or nothing when the target is not above the baseline', () => {
    expect(progressShare(measure({ baseline: 12, current_value: 10 }))).toBe(1);
    expect(progressShare(measure({ baseline: 12, current_value: 9 }))).toBe(0);
  });

  it('counts down for lower is better', () => {
    const down = { lower_is_better: true, target: 2 };
    expect(progressShare(measure({ ...down, current_value: 2 }))).toBe(1);
    expect(progressShare(measure({ ...down, baseline: 10, current_value: 6 }))).toBe(0.5);
    // Without a baseline it counts down from twice the target.
    expect(progressShare(measure({ ...down, current_value: 3 }))).toBe(0.5);
    expect(progressShare(measure({ ...down, current_value: 8 }))).toBe(0);
    expect(progressShare(measure({ ...down, baseline: 1, current_value: 3 }))).toBe(0);
  });
});

describe('reviewCountLabel', () => {
  it('is null without review dates or KPIs', () => {
    expect(reviewCountLabel(person({ review_count: 0 }))).toBeNull();
    expect(reviewCountLabel(person({ kpi_count: 0 }))).toBeNull();
  });

  it('counts reviews written', () => {
    expect(reviewCountLabel(person())).toBe('0 of 3 reviews written');
    expect(reviewCountLabel(person({ reviews_written: 2, reviews_confirmed: 2 }))).toBe(
      '2 of 3 reviews written',
    );
  });

  it('ticks when all are written', () => {
    expect(reviewCountLabel(person({ reviews_written: 3, reviews_confirmed: 3 }))).toBe(
      '✓ All 3 reviews written',
    );
    expect(reviewCountLabel(person({ review_count: 1, reviews_written: 1, reviews_confirmed: 1 }))).toBe(
      '✓ Review written',
    );
  });

  it('adds reviews not yet confirmed', () => {
    expect(reviewCountLabel(person({ reviews_written: 3, reviews_confirmed: 1 }))).toBe(
      '✓ All 3 reviews written · 2 not yet confirmed',
    );
  });
});

describe('kpiCountLabel', () => {
  it('counts KPIs and results', () => {
    expect(kpiCountLabel(0, 0)).toBe('No KPIs yet');
    expect(kpiCountLabel(1, 0)).toBe('1 KPI');
    expect(kpiCountLabel(3, 1)).toBe('3 KPIs · 1 of 3 results in');
    expect(kpiCountLabel(3, 3)).toBe('3 KPIs · ✓ All results in');
  });
});

describe('whoSetsLabel and whoSeesLabel', () => {
  it('says who sets them', () => {
    expect(whoSetsLabel('athlete', null)).toBe('Your coaches');
    expect(whoSetsLabel('coach', 'assistant_coach')).toBe('Your head coach and the committee');
    expect(whoSetsLabel('coach', 'head_coach')).toBe('The committee');
    expect(whoSetsLabel('manager', null)).toBe('The committee');
  });

  it('tells athletes under 18 their parents can see them, and never teammates', () => {
    expect(whoSeesLabel('athlete', true)).toBe(
      'Your coaches, your parents or guardians and the club’s admins can see them. Your teammates can’t.',
    );
    expect(whoSeesLabel('athlete', false)).toBe(
      'Your coaches and the club’s admins can see them. Your teammates can’t.',
    );
    expect(whoSeesLabel('coach', false)).toContain('Athletes and parents can’t.');
  });
});
