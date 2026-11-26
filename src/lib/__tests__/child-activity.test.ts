import { keepNewFrom, newFromTime, newHeading, splitByNew } from '@/lib/child-activity';

const at = (happened_at: string, summary = happened_at) => ({ kind: 'staff', summary, happened_at });

// Newest first, as the database gives them.
const LIST = [
  at('2026-11-20T05:58:00Z'),
  at('2026-11-19T09:37:00Z', 'consent a'),
  at('2026-11-19T09:37:00Z', 'consent b'),
  at('2026-11-18T02:12:00Z'),
];

describe('newFromTime', () => {
  it('is when the oldest new change happened', () => {
    expect(newFromTime(LIST, 1)).toBe('2026-11-20T05:58:00Z');
    expect(newFromTime(LIST, 3)).toBe('2026-11-19T09:37:00Z');
  });

  it('is null when nothing is new', () => {
    expect(newFromTime(LIST, 0)).toBeNull();
    expect(newFromTime([], 4)).toBeNull();
  });

  it('stays inside the list when the count is larger, and ignores nonsense', () => {
    // The count looks back over 500 changes; the list shows 100.
    expect(newFromTime(LIST, 900)).toBe('2026-11-18T02:12:00Z');
    expect(newFromTime(LIST, -2)).toBeNull();
    expect(newFromTime(LIST, Number.NaN)).toBeNull();
    expect(newFromTime(LIST, 1.7)).toBe('2026-11-20T05:58:00Z');
  });
});

describe('keepNewFrom', () => {
  it('keeps the first answer while the parent is on the screen', () => {
    expect(keepNewFrom(null, '2026-11-19T09:37:00Z')).toBe('2026-11-19T09:37:00Z');
    expect(keepNewFrom('2026-11-19T09:37:00Z', null)).toBe('2026-11-19T09:37:00Z');
    expect(keepNewFrom('2026-11-19T09:37:00Z', '2026-11-21T00:00:00Z')).toBe('2026-11-19T09:37:00Z');
    expect(keepNewFrom(null, null)).toBeNull();
  });
});

describe('splitByNew', () => {
  it('puts everything under Earlier when nothing is new', () => {
    expect(splitByNew(LIST, null)).toEqual({ fresh: [], earlier: LIST });
  });

  it('splits at the oldest new change, keeping changes at the same moment together', () => {
    const { fresh, earlier } = splitByNew(LIST, '2026-11-19T09:37:00Z');
    expect(fresh.map((e) => e.summary)).toEqual(['2026-11-20T05:58:00Z', 'consent a', 'consent b']);
    expect(earlier.map((e) => e.summary)).toEqual(['2026-11-18T02:12:00Z']);
  });

  it('compares moments, not the way the time is written', () => {
    const list = [at('2026-11-19T17:37:00+08:00', 'perth'), at('2026-11-19T09:36:59Z', 'older')];
    const { fresh, earlier } = splitByNew(list, '2026-11-19T09:37:00.000Z');
    expect(fresh.map((e) => e.summary)).toEqual(['perth']);
    expect(earlier.map((e) => e.summary)).toEqual(['older']);
  });

  it('marks a change that arrived after the first look as new too', () => {
    const list = [at('2026-11-22T00:00:00Z', 'arrived later'), ...LIST];
    expect(splitByNew(list, '2026-11-20T05:58:00Z').fresh.map((e) => e.summary)).toEqual([
      'arrived later',
      '2026-11-20T05:58:00Z',
    ]);
  });
});

describe('newHeading', () => {
  it('says how many are new', () => {
    expect(newHeading(1)).toBe('1 new since you last looked');
    expect(newHeading(4)).toBe('4 new since you last looked');
  });
});
