/**
 * Selection assessments: the criteria and their checks, the picture built
 * from observations (counts and a trail, never a score), the lines the lists
 * show, the checks on an observation before it is saved, and the Selection
 * audit report, which must never carry a rating, evidence or a criterion's
 * name. The database repeats every check (supabase/tests/
 * selection-assessments.sql). Dates are passed in, so nothing here depends
 * on today.
 */
import {
  DEFAULT_SCALE,
  MAX_GROUPS,
  MAX_ITEMS,
  STALE_DAYS,
  addGroup,
  addItem,
  adminRoundLine,
  athleteLine,
  buildPicture,
  criteriaKeys,
  criteriaProblem,
  criteriaSummary,
  daysBetween,
  makeCriteria,
  newKey,
  observationProblem,
  INDEPENDENT_NOTE,
  isIndependentChoice,
  panelNotes,
  ratingLines,
  removeGroup,
  removeItem,
  renameGroup,
  renameItem,
  renameStep,
  roundDates,
  roundsLabel,
  selectionAuditReport,
  setRating,
  slug,
  starterCriteria,
  tallyLabel,
  type AdminRound,
  type Criteria,
  type MyRound,
  type Observation,
  type ObservationDraft,
  type PanelMember,
  type SelectionAudit,
  type SheetAthlete,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';

// The module loads auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

const CRITERIA: Criteria = makeCriteria([
  { name: 'Technical ability', items: ['Passing', 'Catching'] },
  { name: 'Coachability', scale: ['Developing', 'Meets standard', 'Exceeds standard'], items: ['Accepts feedback'] },
  { name: 'Team focus', items: ['Supports teammates'] },
]);

function observation(extra: Partial<Observation> = {}): Observation {
  return {
    id: 'o1',
    author_name: 'Casey Coach',
    mine: false,
    can_change: false,
    context: 'training',
    observed_on: '2026-11-20',
    note: 'Clean release under pressure',
    corrects_id: null,
    created_at: '2026-11-20T08:00:00Z',
    ratings: [{ item_key: 'passing', rating: 2 }],
    ...extra,
  };
}

describe('keys', () => {
  it.each([
    ['Passing & delivery', 'passing-delivery'],
    ['  Court awareness  ', 'court-awareness'],
    ['Team-first behaviour', 'team-first-behaviour'],
    ['!!!', 'item'],
    ['', 'item'],
  ])('slug of "%s" is "%s"', (name, key) => {
    expect(slug(name)).toBe(key);
  });

  it('keeps a slug to 34 characters', () => {
    expect(slug('a'.repeat(60))).toHaveLength(34);
  });

  it('gives a new key that nothing else uses', () => {
    expect(newKey('Speed', [])).toBe('speed');
    expect(newKey('Speed', ['speed'])).toBe('speed-2');
    expect(newKey('Speed', ['speed', 'speed-2'])).toBe('speed-3');
  });

  it('lists every key, groups and items', () => {
    expect(criteriaKeys(CRITERIA)).toEqual([
      'technical-ability',
      'passing',
      'catching',
      'coachability',
      'accepts-feedback',
      'team-focus',
      'supports-teammates',
    ]);
  });

  it('gives a group and an item of the same name different keys, and the usual scale', () => {
    const made = makeCriteria([{ name: 'Speed', items: ['Speed', 'Speed'] }]);
    expect(criteriaKeys(made)).toEqual(['speed', 'speed-2', 'speed-3']);
    expect(made.groups[0].scale).toEqual(DEFAULT_SCALE);
    expect(made.groups[0].scale).not.toBe(DEFAULT_SCALE);
  });
});

describe('the netball example', () => {
  const starter = starterCriteria();

  it('has nine groups and 33 items, each with a three-step scale, and passes the checks', () => {
    expect(starter.groups).toHaveLength(9);
    expect(criteriaSummary(starter)).toBe('9 groups, 33 items');
    for (const group of starter.groups) expect(group.scale).toHaveLength(3);
    expect(criteriaProblem(starter)).toBeNull();
    expect(new Set(criteriaKeys(starter)).size).toBe(42);
  });

  it('uses “Developing” for the personal qualities, and its own scale for positions', () => {
    const scaleOf = (name: string) => starter.groups.find((g) => g.name === name)?.scale;
    expect(scaleOf('Technical ability')).toEqual(['Below standard', 'Meets standard', 'Exceeds standard']);
    expect(scaleOf('Coachability')).toEqual(['Developing', 'Meets standard', 'Exceeds standard']);
    expect(scaleOf('Positional suitability')).toEqual(['Developing', 'Suitable', 'Highly suitable']);
  });

  it('names nothing after a club or an association', () => {
    expect(JSON.stringify(starter)).not.toMatch(/wcmmna|thunder/i);
  });
});

describe('criteriaProblem', () => {
  const one = (change: (c: Criteria) => Criteria) => criteriaProblem(change(CRITERIA));

  it('passes good criteria', () => {
    expect(criteriaProblem(CRITERIA)).toBeNull();
  });

  it('needs a group', () => {
    expect(criteriaProblem({ groups: [] })).toBe('Add at least one group of criteria.');
  });

  it(`allows ${MAX_GROUPS} groups and no more`, () => {
    const groups = (n: number) =>
      makeCriteria(Array.from({ length: n }, (_, i) => ({ name: `Group ${i + 1}`, items: [`Item ${i + 1}`] })));
    expect(criteriaProblem(groups(MAX_GROUPS))).toBeNull();
    expect(criteriaProblem(groups(MAX_GROUPS + 1))).toBe('Keep the criteria to 20 groups.');
  });

  it('needs each group named, in 60 characters', () => {
    expect(one((c) => renameGroup(c, 'coachability', '  '))).toBe('Name each group.');
    expect(one((c) => renameGroup(c, 'coachability', 'a'.repeat(60)))).toBeNull();
    expect(one((c) => renameGroup(c, 'coachability', 'a'.repeat(61)))).toBe(`Keep “${'a'.repeat(20)}…” to 60 characters.`);
  });

  it('needs all three steps named, in 30 characters', () => {
    expect(one((c) => renameStep(c, 'coachability', 1, ' '))).toBe('Name all three steps on the scale for “Coachability”.');
    expect(
      one((c) => ({ groups: c.groups.map((g) => (g.key === 'coachability' ? { ...g, scale: ['Low', 'High'] } : g)) })),
    ).toBe('Name all three steps on the scale for “Coachability”.');
    expect(one((c) => renameStep(c, 'coachability', 2, 'a'.repeat(30)))).toBeNull();
    expect(one((c) => renameStep(c, 'coachability', 2, 'a'.repeat(31)))).toBe(
      'Keep each step on the scale for “Coachability” to 30 characters.',
    );
  });

  it(`needs one to ${MAX_ITEMS} named items in each group`, () => {
    expect(one((c) => removeItem(c, 'team-focus', 'supports-teammates'))).toBe('Add at least one item to “Team focus”.');
    expect(one((c) => renameItem(c, 'team-focus', 'supports-teammates', ''))).toBe('Name each item in “Team focus”.');
    expect(one((c) => renameItem(c, 'team-focus', 'supports-teammates', 'a'.repeat(61)))).toBe(
      'Keep each item in “Team focus” to 60 characters.',
    );
    const items = (n: number) => makeCriteria([{ name: 'Big', items: Array.from({ length: n }, (_, i) => `Item ${i}`) }]);
    expect(criteriaProblem(items(MAX_ITEMS))).toBeNull();
    expect(criteriaProblem(items(MAX_ITEMS + 1))).toBe('Keep “Big” to 12 items.');
  });

  it('refuses two criteria with one key', () => {
    const twice: Criteria = {
      groups: [
        { key: 'a', name: 'A', scale: DEFAULT_SCALE, items: [{ key: 'x', name: 'X' }] },
        { key: 'b', name: 'B', scale: DEFAULT_SCALE, items: [{ key: 'x', name: 'X again' }] },
      ],
    };
    expect(criteriaProblem(twice)).toBe('Two criteria share a key. Remove one and add it again.');
  });
});

describe('criteriaSummary', () => {
  it.each<[Criteria, string]>([
    [{ groups: [] }, 'Not set up yet'],
    [makeCriteria([{ name: 'A', items: ['x'] }]), '1 group, 1 item'],
    [CRITERIA, '3 groups, 4 items'],
  ])('%#', (criteria, text) => {
    expect(criteriaSummary(criteria)).toBe(text);
  });
});

describe('editing criteria', () => {
  it('adds a blank group with one blank item and the usual scale, with new keys', () => {
    const next = addGroup(CRITERIA);
    expect(next.groups).toHaveLength(4);
    expect(next.groups[3]).toEqual({ key: 'group', name: '', scale: DEFAULT_SCALE, items: [{ key: 'item', name: '' }] });
    const again = addGroup(next);
    expect(again.groups[4].key).toBe('group-2');
    expect(again.groups[4].items[0].key).toBe('item-2');
    expect(CRITERIA.groups).toHaveLength(3);
  });

  it('starts blank criteria with keys that differ', () => {
    const first = addGroup({ groups: [] });
    expect(criteriaKeys(first)).toEqual(['group', 'item']);
  });

  it('removes and renames one group, leaving the others', () => {
    expect(removeGroup(CRITERIA, 'coachability').groups.map((g) => g.key)).toEqual(['technical-ability', 'team-focus']);
    const renamed = renameGroup(CRITERIA, 'coachability', 'Attitude');
    expect(renamed.groups.map((g) => g.name)).toEqual(['Technical ability', 'Attitude', 'Team focus']);
    expect(renamed.groups[1].key).toBe('coachability');
  });

  it('renames one step of one group', () => {
    const next = renameStep(CRITERIA, 'coachability', 0, 'Emerging');
    expect(next.groups[1].scale).toEqual(['Emerging', 'Meets standard', 'Exceeds standard']);
    expect(next.groups[0].scale).toEqual(DEFAULT_SCALE);
  });

  it('adds, renames and removes an item in one group', () => {
    const added = addItem(CRITERIA, 'team-focus');
    expect(added.groups[2].items).toEqual([
      { key: 'supports-teammates', name: 'Supports teammates' },
      { key: 'item', name: '' },
    ]);
    expect(added.groups[0].items).toHaveLength(2);
    const renamed = renameItem(added, 'team-focus', 'item', 'Respect');
    expect(renamed.groups[2].items[1]).toEqual({ key: 'item', name: 'Respect' });
    expect(renamed.groups[2].items[0].name).toBe('Supports teammates');
    expect(removeItem(renamed, 'team-focus', 'item').groups[2].items).toEqual([
      { key: 'supports-teammates', name: 'Supports teammates' },
    ]);
    expect(removeItem(CRITERIA, 'technical-ability', 'passing').groups[2].items).toHaveLength(1);
  });
});

describe('buildPicture', () => {
  const observations = [
    observation({ id: 'o3', observed_on: '2026-11-22', ratings: [{ item_key: 'passing', rating: 3 }] }),
    observation({ id: 'o1', observed_on: '2026-11-18', ratings: [{ item_key: 'passing', rating: 1 }] }),
    observation({
      id: 'o2',
      author_name: 'Sam Selector',
      observed_on: '2026-11-20',
      ratings: [
        { item_key: 'passing', rating: null },
        { item_key: 'accepts-feedback', rating: 2 },
      ],
    }),
  ];
  const picture = buildPicture(CRITERIA, observations);

  it('counts observations and selectors, with no total or average anywhere', () => {
    expect(picture.observations).toBe(3);
    expect(picture.selectors).toBe(2);
    expect(Object.keys(picture).sort()).toEqual(['groups', 'missing', 'observations', 'selectors']);
    expect(JSON.stringify(picture)).not.toMatch(/score|average|total|rank/i);
  });

  it('tallies each step and keeps the ratings in date order, oldest first', () => {
    const passing = picture.groups[0].items[0];
    expect(passing).toEqual({ key: 'passing', name: 'Passing', count: 3, selectors: 2, tally: [1, 0, 1], trail: [1, 3] });
  });

  it('orders ratings seen on one day by when they were written', () => {
    const sameDay = buildPicture(CRITERIA, [
      observation({ id: 'b', created_at: '2026-11-20T09:00:00Z', ratings: [{ item_key: 'passing', rating: 3 }] }),
      observation({ id: 'a', created_at: '2026-11-20T07:00:00Z', ratings: [{ item_key: 'passing', rating: 1 }] }),
    ]);
    expect(sameDay.groups[0].items[0].trail).toEqual([1, 3]);
  });

  it('counts an item that was seen but not rated, without a rating', () => {
    const only = buildPicture(CRITERIA, [observation({ ratings: [{ item_key: 'catching', rating: null }] })]);
    expect(only.groups[0].items[1]).toMatchObject({ count: 1, tally: [0, 0, 0], trail: [] });
  });

  it('ignores a step outside 1 to 3', () => {
    const odd = buildPicture(CRITERIA, [observation({ ratings: [{ item_key: 'passing', rating: 4 }] })]);
    expect(odd.groups[0].items[0]).toMatchObject({ count: 1, tally: [0, 0, 0], trail: [] });
  });

  it('counts an observation once in a group, however many of its items it is about', () => {
    const both = buildPicture(CRITERIA, [
      observation({
        ratings: [
          { item_key: 'passing', rating: 2 },
          { item_key: 'catching', rating: 2 },
        ],
      }),
    ]);
    expect(both.groups[0].count).toBe(1);
  });

  it('names the groups nobody has written about', () => {
    expect(picture.groups.map((g) => g.count)).toEqual([3, 1, 0]);
    expect(picture.missing).toEqual(['Team focus']);
    expect(buildPicture(CRITERIA, []).missing).toEqual(['Technical ability', 'Coachability', 'Team focus']);
  });

  it('leaves the observations in the order it was given', () => {
    expect(observations.map((o) => o.id)).toEqual(['o3', 'o1', 'o2']);
  });
});

describe('tallyLabel and ratingLines', () => {
  it('writes an item’s ratings in words', () => {
    expect(tallyLabel(DEFAULT_SCALE, [0, 2, 1])).toBe('Meets standard ×2, Exceeds standard ×1');
    expect(tallyLabel(DEFAULT_SCALE, [1, 0, 0])).toBe('Below standard ×1');
    expect(tallyLabel(DEFAULT_SCALE, [0, 0, 0])).toBe('Not rated');
    expect(tallyLabel(['Low'], [0, 0, 2])).toBe('Step 3 ×2');
  });

  it('names what an observation is about, in the criteria’s order, with each group’s own scale', () => {
    expect(
      ratingLines(CRITERIA, [
        { item_key: 'accepts-feedback', rating: 1 },
        { item_key: 'catching', rating: null },
        { item_key: 'passing', rating: 3 },
        { item_key: 'gone', rating: 2 },
      ]),
    ).toEqual(['Passing: Exceeds standard', 'Catching', 'Accepts feedback: Developing']);
  });
});

describe('daysBetween', () => {
  it.each([
    ['2026-11-23', '2026-11-23', 0],
    ['2026-11-09', '2026-11-23', 14],
    ['2026-12-31', '2027-01-01', 1],
    ['2026-11-23', '2026-11-20', -3],
  ])('%s to %s is %i', (from, to, days) => {
    expect(daysBetween(from, to)).toBe(days);
  });
});

describe('athleteLine', () => {
  const athlete = (extra: Partial<SheetAthlete> = {}): SheetAthlete => ({
    id: 'a',
    name: 'Jordan Junior',
    is_minor: true,
    observations: 3,
    my_observations: 1,
    assessors: 2,
    groups_covered: 2,
    last_observed_on: '2026-11-20',
    ...extra,
  });

  it('points out an athlete with nothing written, while the round is open', () => {
    expect(athleteLine(athlete({ observations: 0 }), 9, '2026-11-23')).toEqual({ text: 'Nothing written yet', nudge: true });
    expect(athleteLine(athlete({ observations: 0 }), 9, '2026-11-23', true)).toEqual({
      text: 'Nothing written yet',
      nudge: false,
    });
  });

  it('says how much is written and how many groups it covers', () => {
    expect(athleteLine(athlete(), 9, '2026-11-23')).toEqual({
      text: '3 observations from 2 selectors · 2 of 9 groups',
      nudge: false,
    });
    expect(athleteLine(athlete({ observations: 1, assessors: 1 }), 9, '2026-11-23').text).toBe(
      '1 observation from 1 selector · 2 of 9 groups',
    );
  });

  it(`points out nothing for ${STALE_DAYS} days, and not a day sooner`, () => {
    expect(athleteLine(athlete({ last_observed_on: '2026-11-10' }), 9, '2026-11-23').nudge).toBe(false);
    expect(athleteLine(athlete({ last_observed_on: '2026-11-09' }), 9, '2026-11-23')).toEqual({
      text: '3 observations from 2 selectors · 2 of 9 groups · nothing for 14 days',
      nudge: true,
    });
  });

  it('never nudges once the round is closed, or without a last date', () => {
    expect(athleteLine(athlete({ last_observed_on: '2026-10-01' }), 9, '2026-11-23', true).nudge).toBe(false);
    expect(athleteLine(athlete({ last_observed_on: null }), 9, '2026-11-23').nudge).toBe(false);
  });
});

describe('observationProblem', () => {
  const draft = (extra: Partial<ObservationDraft> = {}): ObservationDraft => ({
    context: 'training',
    observedOn: '2026-11-20',
    note: 'Won three intercepts',
    ratings: [{ item_key: 'passing', rating: 2 }],
    ...extra,
  });
  const problem = (extra: Partial<ObservationDraft>) => observationProblem(draft(extra), '2026-11-23', '2026-11-16');

  it('passes a full observation, on the first day of the round and today', () => {
    expect(problem({})).toBeNull();
    expect(problem({ observedOn: '2026-11-16' })).toBeNull();
    expect(problem({ observedOn: '2026-11-23' })).toBeNull();
  });

  it('needs where and when', () => {
    expect(problem({ context: null })).toBe('Choose where you saw it.');
    expect(problem({ observedOn: null })).toBe('Choose the day you saw it.');
  });

  it('refuses a day in the future or before the round', () => {
    expect(problem({ observedOn: '2026-11-24' })).toBe('The day can’t be in the future.');
    expect(problem({ observedOn: '2026-11-15' })).toBe(`The round started on ${formatDateString('2026-11-16')}.`);
  });

  it('needs at least one of the criteria', () => {
    expect(problem({ ratings: [] })).toBe('Choose at least one of the criteria.');
  });

  it('takes a rating with no evidence, or evidence with no rating, but not neither', () => {
    expect(problem({ note: '' })).toBeNull();
    expect(problem({ ratings: [{ item_key: 'passing', rating: null }] })).toBeNull();
    expect(problem({ note: '   ', ratings: [{ item_key: 'passing', rating: null }] })).toBe(
      'Write what you saw, or rate at least one of the criteria.',
    );
  });

  it('keeps the evidence to 1,000 characters', () => {
    expect(problem({ note: 'a'.repeat(1000) })).toBeNull();
    expect(problem({ note: 'a'.repeat(1001) })).toBe('Keep the evidence to 1,000 characters.');
  });
});

describe('setRating', () => {
  const start = [{ item_key: 'passing', rating: 2 }];

  it('tags an item with a step, replacing the step it had', () => {
    expect(setRating([], 'passing', 2)).toEqual(start);
    expect(setRating(start, 'passing', 3)).toEqual([{ item_key: 'passing', rating: 3 }]);
    expect(setRating(start, 'catching', 1)).toEqual([...start, { item_key: 'catching', rating: 1 }]);
  });

  it('tags an item as seen without a rating', () => {
    expect(setRating(start, 'passing', null)).toEqual([{ item_key: 'passing', rating: null }]);
  });

  it('takes an item off, leaving the others', () => {
    expect(setRating([...start, { item_key: 'catching', rating: 1 }], 'passing', undefined)).toEqual([
      { item_key: 'catching', rating: 1 },
    ]);
    expect(start).toEqual([{ item_key: 'passing', rating: 2 }]);
  });
});

describe('the lines lists show', () => {
  const myRound = (extra: Partial<MyRound> = {}): MyRound => ({
    id: 'r1',
    name: '2027 selection phase',
    team_name: '17 & Under squad',
    starts_on: '2026-11-16',
    ends_on: '2026-12-20',
    closed_at: null,
    athletes: 14,
    my_observations: 3,
    ...extra,
  });

  it('writes a round’s dates', () => {
    expect(roundDates(myRound())).toBe(`${formatDateString('2026-11-16')} to ${formatDateString('2026-12-20')}`);
  });

  it('tells Home what is open', () => {
    expect(roundsLabel([myRound()])).toBe('2027 selection phase · 14 athletes');
    expect(roundsLabel([myRound({ athletes: 1 })])).toBe('2027 selection phase · 1 athlete');
    expect(roundsLabel([myRound(), myRound({ id: 'r2' }), myRound({ id: 'r3', closed_at: '2026-11-01T00:00:00Z' })])).toBe(
      '2 selection rounds open',
    );
    expect(roundsLabel([myRound({ closed_at: '2026-11-01T00:00:00Z' })])).toBe('Past selection rounds');
  });
});

const member = (extra: Partial<PanelMember> = {}): PanelMember => ({
  profile_id: 'p1',
  name: 'Casey Coach',
  added_at: '2026-11-16T01:00:00Z',
  added_by_name: 'Alex Admin',
  removed_at: null,
  removed_by_name: null,
  declared_conflict: false,
  can_assess: true,
  own_children: 0,
  ...extra,
});

describe('what an admin is told about the panel', () => {
  it('says nothing about a member with nothing to note', () => {
    expect(panelNotes(member())).toEqual([]);
  });

  it('notes a declared conflict, their own children and lost access, in that order', () => {
    expect(panelNotes(member({ declared_conflict: true, own_children: 2, can_assess: false }))).toEqual([
      'Declared a conflict of interest this season',
      'Can’t assess 2 athletes in this round: their own child',
      'No access now: stood down, left or without a current check',
    ]);
    expect(panelNotes(member({ own_children: 1 }))).toEqual(['Can’t assess 1 athlete in this round: their own child']);
  });

  it('doesn’t report lost access for someone already off the panel', () => {
    expect(panelNotes(member({ can_assess: false, removed_at: '2026-11-20T00:00:00Z' }))).toEqual([]);
  });

  it('says first when a selector is independent, and keeps it for one who has left', () => {
    expect(panelNotes(member({ independent: true }))).toEqual(['Independent: a guest with no other role in the club']);
    expect(panelNotes(member({ independent: true, declared_conflict: true }))).toEqual([
      'Independent: a guest with no other role in the club',
      'Declared a conflict of interest this season',
    ]);
    expect(panelNotes(member({ independent: true, removed_at: '2026-11-20T00:00:00Z' }))).toEqual([INDEPENDENT_NOTE]);
    expect(panelNotes(member({ independent: false }))).toEqual([]);
  });

  it('counts only a guest with no other role as an independent choice', () => {
    const person = (roles: string[]) => ({ profile_id: 'g1', name: 'Indy', roles, cleared: true });
    expect(isIndependentChoice(person(['guest']))).toBe(true);
    expect(isIndependentChoice(person(['guest', 'coach']))).toBe(false);
    expect(isIndependentChoice(person(['coach', 'guest']))).toBe(false);
    expect(isIndependentChoice(person(['coach']))).toBe(false);
    expect(isIndependentChoice(person(['admin']))).toBe(false);
    expect(isIndependentChoice(person([]))).toBe(false);
  });

  it('puts the independent note in the audit report’s panel, without flagging it', () => {
    const report = selectionAuditReport({
      round: {
        id: 'r1', name: 'R', team_name: 'T', season: 2027, starts_on: '2026-11-16', ends_on: '2026-12-20',
        opened_at: '2026-11-15T02:00:00Z', opened_by_name: null, closed_at: null, closed_by_name: null,
        criteria_groups: 1, criteria_items: 1, athletes: 0, observations: 0, today: '2026-11-23',
      },
      panel: [member({ name: 'Indy Independent', independent: true }), member()],
      selectors: [],
      athletes: [],
    });
    const panel = report.sections.find((section) => section.title === 'The panel')!;
    expect(panel.rows[0].cells[3]).toBe('Independent: a guest with no other role in the club');
    expect(panel.rows[0].flag).toBe(false);
    expect(panel.rows[1].cells[3]).toBe('');
  });

  it('counts only the people on the panel now in a round’s line', () => {
    const round: AdminRound = {
      id: 'r1',
      team_id: 't1',
      team_name: '17 & Under squad',
      season: 2027,
      name: '2027 selection phase',
      starts_on: '2026-11-16',
      ends_on: '2026-12-20',
      closed_at: null,
      created_at: '2026-11-16T01:00:00Z',
      athletes: 14,
      observations: 1,
      panel: [member(), member({ profile_id: 'p2', removed_at: '2026-11-20T00:00:00Z' })],
    };
    expect(adminRoundLine(round)).toBe('1 selector on the panel · 14 athletes · 1 observation');
    expect(adminRoundLine({ ...round, panel: [member(), member({ profile_id: 'p3' })], athletes: 1, observations: 0 })).toBe(
      '2 selectors on the panel · 1 athlete · 0 observations',
    );
  });
});

describe('the Selection audit report', () => {
  const audit = (extra: Partial<SelectionAudit> = {}, round: Partial<SelectionAudit['round']> = {}): SelectionAudit => ({
    round: {
      id: 'r1',
      name: '2027 selection phase',
      team_name: '17 & Under squad',
      season: 2027,
      starts_on: '2026-11-16',
      ends_on: '2026-12-20',
      opened_at: '2026-11-15T02:00:00Z',
      opened_by_name: 'Alex Admin',
      closed_at: null,
      closed_by_name: null,
      criteria_groups: 9,
      criteria_items: 33,
      athletes: 2,
      observations: 5,
      today: '2026-11-23',
      ...round,
    },
    panel: [
      member(),
      member({ profile_id: 'p2', name: 'Sam Selector', declared_conflict: true }),
      member({
        profile_id: 'p3',
        name: 'Drew Lapsed',
        removed_at: '2026-11-20T03:00:00Z',
        removed_by_name: 'Alex Admin',
        added_by_name: null,
      }),
    ],
    selectors: [
      {
        name: 'Casey Coach',
        on_panel: true,
        observations: 4,
        athletes_covered: 2,
        groups_covered: 5,
        first_on: '2026-11-17',
        last_on: '2026-11-22',
        weeks_active: 2,
        training: 3,
        game: 1,
        trial: 0,
        other: 0,
        without_evidence: 1,
        written_late: 0,
        corrections: 1,
      },
      {
        name: 'Sam Selector',
        on_panel: true,
        observations: 0,
        athletes_covered: 0,
        groups_covered: 0,
        first_on: null,
        last_on: null,
        weeks_active: 0,
        training: 0,
        game: 0,
        trial: 0,
        other: 0,
        without_evidence: 0,
        written_late: 0,
        corrections: 0,
      },
      {
        name: 'Drew Lapsed',
        on_panel: false,
        observations: 1,
        athletes_covered: 1,
        groups_covered: 1,
        first_on: '2026-11-18',
        last_on: '2026-11-18',
        weeks_active: 1,
        training: 0,
        game: 0,
        trial: 1,
        other: 0,
        without_evidence: 0,
        written_late: 1,
        corrections: 0,
      },
    ],
    athletes: [
      { name: 'Jordan Junior', is_minor: true, observations: 5, selectors: 2, groups_covered: 5, last_observed_on: '2026-11-22' },
      { name: null, is_minor: false, observations: 0, selectors: 0, groups_covered: 0, last_observed_on: null },
    ],
    ...extra,
  });
  const report = selectionAuditReport(audit());
  const section = (title: string, from = report) => from.sections.find((s) => s.title === title)!;
  const d = formatDateString;

  it('is titled for the round and prints landscape', () => {
    expect(report.title).toBe('Selection audit report');
    expect(report.subtitle).toBe(`2027 selection phase · 17 & Under squad · ${d('2026-11-16')} to ${d('2026-12-20')}`);
    expect(report.landscape).toBe(true);
  });

  it('counts the athletes, the panel now, the observations and the athletes with nothing', () => {
    expect(report.stats).toEqual([
      { label: 'Athletes', value: 2 },
      { label: 'On the panel', value: 2 },
      { label: 'Observations', value: 5 },
      { label: 'Athletes with nothing written', value: 1 },
    ]);
  });

  it('lists the round’s steps, with who opened it', () => {
    expect(section('The round').rows).toEqual([
      { cells: ['Round opened, with its own copy of the criteria', d('2026-11-15'), 'Alex Admin'] },
      { cells: ['Criteria the round uses', '', '9 groups, 33 items'] },
      { cells: ['Selection phase starts', d('2026-11-16'), ''] },
      { cells: ['Selection phase ends', d('2026-12-20'), ''] },
      { cells: ['Round closed', 'Still open', ''], flag: false },
    ]);
  });

  it('flags a round still open after its end date, and not on its last day', () => {
    const late = selectionAuditReport(audit({}, { today: '2026-12-21' }));
    expect(section('The round', late).rows[4]).toEqual({ cells: ['Round closed', 'Still open', ''], flag: true });
    const lastDay = selectionAuditReport(audit({}, { today: '2026-12-20' }));
    expect(section('The round', lastDay).rows[4].flag).toBe(false);
  });

  it('says who closed the round and when, and copes with nobody named', () => {
    const closed = selectionAuditReport(
      audit({}, { closed_at: '2026-12-22T04:00:00Z', closed_by_name: 'Alex Admin', criteria_groups: 1, criteria_items: 1 }),
    );
    expect(section('The round', closed).rows[4]).toEqual({ cells: ['Round closed', d('2026-12-22'), 'Alex Admin'] });
    expect(section('The round', closed).rows[1].cells[2]).toBe('1 group, 1 item');
    const unnamed = selectionAuditReport(audit({}, { closed_at: '2026-12-22T04:00:00Z', opened_by_name: null }));
    expect(section('The round', unnamed).rows[0].cells[2]).toBe('');
    expect(section('The round', unnamed).rows[4].cells[2]).toBe('');
  });

  it('lists everyone who has been on the panel, with who added and removed them', () => {
    expect(section('The panel').rows).toEqual([
      { cells: ['Casey Coach', `${d('2026-11-16')} by Alex Admin`, '', ''], flag: false },
      {
        cells: ['Sam Selector', `${d('2026-11-16')} by Alex Admin`, '', 'Declared a conflict of interest this season'],
        flag: true,
      },
      { cells: ['Drew Lapsed', d('2026-11-16'), `${d('2026-11-20')} by Alex Admin`, ''], flag: false },
    ]);
  });

  it('flags a panel member who has lost access, and not one already removed', () => {
    const lost = selectionAuditReport(
      audit({
        panel: [
          member({ can_assess: false, own_children: 1 }),
          member({ can_assess: false, declared_conflict: true, removed_at: '2026-11-20T03:00:00Z' }),
        ],
      }),
    );
    const rows = section('The panel', lost).rows;
    expect(rows[0].flag).toBe(true);
    expect(rows[0].cells[3]).toBe(
      'Can’t assess 1 athlete in this round: their own child\nNo access now: stood down, left or without a current check',
    );
    expect(rows[1].flag).toBe(false);
    expect(rows[1].cells[2]).toBe(d('2026-11-20'));
  });

  it('shows what each selector wrote as counts and dates, flagging a panel member who wrote nothing', () => {
    const wrote = section('What each selector wrote');
    expect(wrote.columns.map((c) => c.label)).toEqual([
      'Selector',
      'Obs.',
      'Athletes',
      'Groups',
      'First',
      'Last',
      'Weeks',
      'Training / game / trial / other',
      'No evidence',
      'Late',
      'Corrections',
    ]);
    expect(wrote.rows).toEqual([
      {
        cells: ['Casey Coach', '4', '2', '5', d('2026-11-17'), d('2026-11-22'), '2', '3 / 1 / 0 / 0', '1', '0', '1'],
        flag: false,
      },
      { cells: ['Sam Selector', '0', '0', '0', '', '', '0', '0 / 0 / 0 / 0', '0', '0', '0'], flag: true },
      {
        cells: [
          'Drew Lapsed (not on the panel now)',
          '1',
          '1',
          '1',
          d('2026-11-18'),
          d('2026-11-18'),
          '1',
          '0 / 0 / 1 / 0',
          '0',
          '1',
          '0',
        ],
        flag: false,
      },
    ]);
    expect(wrote.note).toContain('out of the 2 in the round');
    expect(wrote.note).toContain('out of the 9 groups');
  });

  it('doesn’t flag someone who wrote nothing and is no longer on the panel', () => {
    const gone = audit();
    gone.selectors[1].on_panel = false;
    expect(section('What each selector wrote', selectionAuditReport(gone)).rows[1].flag).toBe(false);
  });

  it('shows how much evidence there is about each athlete, flagging none', () => {
    expect(section('Evidence about each athlete').rows).toEqual([
      { cells: ['Jordan Junior (under 18)', '5', '2', '5 of 9', d('2026-11-22')], flag: false },
      { cells: ['Athlete', '0', '0', '0 of 9', ''], flag: true },
    ]);
  });

  it('says so when a section is empty', () => {
    const empty = selectionAuditReport(audit({ panel: [], selectors: [], athletes: [] }));
    expect(section('The panel', empty).empty).toBe('Nobody is on the panel.');
    expect(section('What each selector wrote', empty).empty).toBe('Nobody has written anything yet.');
    expect(section('Evidence about each athlete', empty).empty).toBe('There are no athletes in the round.');
    expect(empty.stats?.[1].value).toBe(0);
  });

  it('ends by saying what it leaves out, who has written nothing, and that building it is recorded', () => {
    expect(report.footnote).toBe(
      'This report shows how the selection work was done, not what was said: it holds no ratings, evidence, recommendations or names of criteria, and nothing in it ranks athletes. 1 panel member has written nothing yet. Building this report is recorded in the record views of each athlete under 18 in the round.',
    );
    const two = audit();
    two.selectors[0].observations = 0;
    expect(selectionAuditReport(two).footnote).toContain('2 panel members have written nothing yet.');
    const none = audit();
    none.selectors[1].observations = 2;
    expect(selectionAuditReport(none).footnote).not.toContain('written nothing yet');
  });

  it('has nowhere for a rating, a line of evidence or a criterion’s name', () => {
    const labels = report.sections.flatMap((s) => s.columns.map((c) => c.label)).join(' ');
    expect(labels).not.toMatch(/rating|score|rank|recommend/i);
    expect(JSON.stringify(report)).not.toMatch(/Meets standard|Exceeds standard|Below standard|Developing/);
  });
});
