/**
 * The club's concern times and escalation chains (src/lib/concern-times.ts),
 * from "Concern times and escalation" in section 10 of docs/user-guide.md.
 * The database checks the same rules
 * (supabase/tests/concern-clocks-and-escalation.sql); these keep the screen's
 * checks and words in step with it.
 */
import {
  canAddPerson,
  otherLead,
  type ChainRow,
  type ChainStep,
  chainPayload,
  chainProblem,
  chainsFrom,
  chainSummary,
  clearanceLateness,
  DEFAULT_CONCERN_TIMES,
  postsForNextStep,
  TIME_FIELDS,
  timesFrom,
  timesProblem,
  timesText,
} from '@/lib/concern-times';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const CSO: ChainStep = { post: 'child_safety_officer', name: 'Child Safety Officer', wait_days: 7 };
const CM: ChainStep = { post: 'complaints_manager', name: 'Complaints Manager', wait_days: 7 };
const ADMINS: ChainStep = { post: 'admins', name: 'Admins', wait_days: 7 };
const GALE: ChainStep = { person: 'gale', name: 'Gale Committee', wait_days: 3 };

describe('timesFrom', () => {
  it('keeps the club’s times', () => {
    const row = { ...DEFAULT_CONCERN_TIMES, concern_important_days: 5, request_urgent_hours: 72 };
    expect(timesFrom(row)).toEqual(row);
  });

  it('starts from the defaults when nothing came back, or a value isn’t a whole number above 0', () => {
    expect(timesFrom(null)).toEqual(DEFAULT_CONCERN_TIMES);
    expect(timesFrom({ concern_urgent_days: '9', concern_important_days: 0, concern_refer_hours: 2.5 })).toEqual(
      DEFAULT_CONCERN_TIMES,
    );
  });

  it('starts every club on the agreed times', () => {
    expect(DEFAULT_CONCERN_TIMES).toEqual({
      concern_first_action_hours: 24,
      concern_refer_hours: 48,
      concern_important_days: 7,
      concern_urgent_days: 14,
      concern_escalate_days: 7,
      request_important_hours: 24,
      request_urgent_hours: 48,
      clearance_important_days: 3,
      clearance_urgent_days: 7,
    });
  });
});

describe('timesProblem', () => {
  const ok = timesText(DEFAULT_CONCERN_TIMES);

  it('accepts the defaults', () => {
    expect(timesProblem(ok)).toBeNull();
  });

  it('lists every time once, as text for the form', () => {
    expect(TIME_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_CONCERN_TIMES).sort());
    expect(ok.concern_first_action_hours).toBe('24');
  });

  it.each([
    ['concern_first_action_hours', '0', 'Hours must be between 1 and 720 (30 days)'],
    ['concern_refer_hours', '721', 'Hours must be between 1 and 720 (30 days)'],
    ['request_important_hours', 'x', 'Hours must be between 1 and 720 (30 days)'],
    ['concern_important_days', '0', 'Days must be between 1 and 30'],
    ['concern_escalate_days', '31', 'Days must be between 1 and 30'],
    ['clearance_important_days', '', 'Days must be between 1 and 30'],
    ['concern_urgent_days', '7', 'Urgent must come after Important'],
    ['request_urgent_hours', '24', 'Urgent must come after Important'],
    ['clearance_urgent_days', '2', 'Urgent must come after Important'],
  ] as const)('refuses %s of %j', (key, value, problem) => {
    expect(timesProblem({ ...ok, [key]: value })).toBe(problem);
  });

  it('takes the limits themselves', () => {
    expect(timesProblem({ ...ok, concern_first_action_hours: '1', concern_refer_hours: '720' })).toBeNull();
    expect(timesProblem({ ...ok, concern_escalate_days: '1', concern_urgent_days: '30' })).toBeNull();
    expect(timesProblem({ ...ok, concern_important_days: ' 8 ' })).toBeNull();
  });
});

describe('chainsFrom', () => {
  it('puts each lead post’s steps in order', () => {
    const rows: ChainRow[] = [
      { lead_post: 'complaints_manager', step_no: 2, target_post: null, target_person: 'gale', target_name: 'Gale Committee', wait_days: 3, can_act: false },
      { lead_post: 'complaints_manager', step_no: 1, target_post: 'child_safety_officer', target_person: null, target_name: 'Child Safety Officer', wait_days: 7, can_act: true },
      { lead_post: 'child_safety_officer', step_no: 1, target_post: 'admins', target_person: null, target_name: 'Admins', wait_days: 5, can_act: true },
    ];
    expect(chainsFrom(rows)).toEqual({
      complaints_manager: [
        { ...CSO, can_act: true },
        { ...GALE, can_act: false },
      ],
      child_safety_officer: [{ ...ADMINS, wait_days: 5, can_act: true }],
    });
  });

  it('is empty with no rows, and ignores a lead post it doesn’t know', () => {
    expect(chainsFrom([])).toEqual({ complaints_manager: [], child_safety_officer: [] });
    const odd = { lead_post: 'wwc_officer', step_no: 1, target_post: 'admins', target_person: null, target_name: 'Admins', wait_days: 7, can_act: true };
    expect(chainsFrom([odd as unknown as ChainRow])).toEqual({ complaints_manager: [], child_safety_officer: [] });
  });
});

describe('the next step', () => {
  it('never offers the chain’s own post, or one already in it', () => {
    expect(postsForNextStep('complaints_manager', [])).toEqual(['child_safety_officer', 'admins']);
    expect(postsForNextStep('child_safety_officer', [])).toEqual(['complaints_manager', 'admins']);
    expect(postsForNextStep('complaints_manager', [CSO])).toEqual(['admins']);
  });

  it('never offers the other post when it already has this one as backup (not both ways)', () => {
    expect(postsForNextStep('child_safety_officer', [], [CSO])).toEqual(['admins']);
    expect(postsForNextStep('complaints_manager', [], [CM])).toEqual(['admins']);
    // The other chain naming someone else, or Admins, changes nothing.
    expect(postsForNextStep('child_safety_officer', [], [GALE, ADMINS])).toEqual(['complaints_manager', 'admins']);
  });

  it('offers nothing after Admins, or once the chain has 4 steps', () => {
    expect(postsForNextStep('complaints_manager', [ADMINS])).toEqual([]);
    expect(canAddPerson([ADMINS])).toBe(false);
    const four = [GALE, { ...GALE, person: 'b' }, { ...GALE, person: 'c' }, { ...GALE, person: 'd' }];
    expect(postsForNextStep('complaints_manager', four)).toEqual([]);
    expect(canAddPerson(four)).toBe(false);
    expect(canAddPerson(four.slice(0, 3))).toBe(true);
  });
});

describe('chainProblem', () => {
  it('accepts a chain that never comes back on itself', () => {
    expect(chainProblem('complaints_manager', [CSO, GALE, ADMINS])).toBeNull();
    expect(chainProblem('complaints_manager', [])).toBeNull();
  });

  it('refuses a chain back to its own lead post (A to B, back to A)', () => {
    expect(chainProblem('complaints_manager', [CSO, CM])).toBe(
      'A chain can’t come back to a post or person already in it',
    );
  });

  it('refuses anyone twice (A to B to C to B)', () => {
    expect(chainProblem('complaints_manager', [CSO, GALE, { ...GALE, wait_days: 5 }])).toBe(
      'A chain can’t come back to a post or person already in it',
    );
  });

  it('refuses naming the other post when it already has this one as backup', () => {
    expect(chainProblem('child_safety_officer', [CM], [CSO, GALE])).toBe(
      'Child Safety Officer already backs up the Complaints Manager, so it can’t be the other way round too',
    );
    expect(chainProblem('complaints_manager', [GALE, CSO], [CM])).toBe(
      'Complaints Manager already backs up the Child Safety Officer, so it can’t be the other way round too',
    );
    expect(chainProblem('child_safety_officer', [CM], [GALE])).toBeNull();
    expect(chainProblem('child_safety_officer', [GALE], [CSO])).toBeNull();
  });

  it('refuses anything after Admins', () => {
    expect(chainProblem('complaints_manager', [ADMINS, GALE])).toBe(
      'Admins are the last stop, so nothing can come after them',
    );
  });

  it('refuses a wait outside 1 to 30 days, and more than 4 steps', () => {
    expect(chainProblem('complaints_manager', [{ ...CSO, wait_days: 0 }])).toBe('Wait between 1 and 30 days before each step');
    expect(chainProblem('complaints_manager', [{ ...CSO, wait_days: 31 }])).toBe('Wait between 1 and 30 days before each step');
    expect(chainProblem('complaints_manager', [{ ...CSO, wait_days: 1.5 }])).toBe('Wait between 1 and 30 days before each step');
    expect(chainProblem('complaints_manager', [{ ...CSO, wait_days: 30 }, { ...GALE, wait_days: 1 }])).toBeNull();
    const five = [CSO, GALE, { ...GALE, person: 'b' }, { ...GALE, person: 'c' }, { ...GALE, person: 'd' }];
    expect(chainProblem('complaints_manager', five)).toBe('A chain has at most 4 steps');
  });
});

describe('chainPayload', () => {
  it('sends a post or a person with its wait, and nothing else', () => {
    expect(chainPayload([CSO, GALE])).toEqual([
      { post: 'child_safety_officer', wait_days: 7 },
      { person: 'gale', wait_days: 3 },
    ]);
  });
});

describe('chainSummary', () => {
  it('ends at Admins, after the club’s days, when the chain doesn’t', () => {
    expect(chainSummary([CSO, GALE], 7)).toBe(
      'Child Safety Officer after 7 days, then Gale Committee after 3 days, then Admins after 7 days',
    );
    expect(chainSummary([], 1)).toBe('Admins after 1 day');
  });

  it('doesn’t add Admins twice', () => {
    expect(chainSummary([{ ...ADMINS, wait_days: 1 }], 7)).toBe('Admins after 1 day');
  });
});

describe('clearanceLateness', () => {
  const now = new Date('2026-11-24T00:00:00Z');
  const times = { clearance_important_days: 3, clearance_urgent_days: 7 };

  it('is on time before the club’s Important days', () => {
    expect(clearanceLateness('2026-11-21T00:00:01Z', times, now)).toBeNull();
  });

  it('is Important from 3 days, Urgent from 7', () => {
    expect(clearanceLateness('2026-11-21T00:00:00Z', times, now)).toBe('important');
    expect(clearanceLateness('2026-11-17T00:00:01Z', times, now)).toBe('important');
    expect(clearanceLateness('2026-11-17T00:00:00Z', times, now)).toBe('urgent');
  });

  it('is nothing with no time sent, a bad one, or one in the future', () => {
    expect(clearanceLateness(null, times, now)).toBeNull();
    expect(clearanceLateness(undefined, times, now)).toBeNull();
    expect(clearanceLateness('not a date', times, now)).toBeNull();
    expect(clearanceLateness('2026-11-25T00:00:00Z', times, now)).toBeNull();
  });
});

describe('otherLead', () => {
  it('is the other safeguarding post', () => {
    expect(otherLead('complaints_manager')).toBe('child_safety_officer');
    expect(otherLead('child_safety_officer')).toBe('complaints_manager');
  });
});
